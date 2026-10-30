// Isolamento do SO para o teste leve do HyperFrames gerenciado (R12.5C3c-B2) — macOS, `sandbox-exec`, perfil DENY DEFAULT.
// O kernel nega a toda a árvore de processos: rede (TCP, UDP, socket Unix — inclusive o resolvedor DNS do sistema),
// exec de qualquer coisa além do Node gerenciado verificado, escrita fora do diretório temporário do teste, leitura
// fora do mínimo (sistema, árvore do Node, pacote, net-guard do BOLD, diretório do teste), sinais a outros processos e
// IPC por nome. FAIL-CLOSED: antes de CADA teste leve, uma autoverificação roda sob o MESMO perfil e precisa observar
// o bloqueio de cada vetor; sem `sandbox-exec`, perfil recusado ou qualquer vetor aberto → SetupError, nada executado.
// Nenhuma regra é ampliada automaticamente. O net-guard do Core continua como segunda camada.
// Riscos aceitos (GATE B2): `sandbox-exec` é DEPRECATED; o canal herdado com o launchd não é cortado; validado só no
// macOS 26.5.2; código nativo malicioso dentro do Node fica fora das garantias (mitigação: nativos pinados por CDHash).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SetupError } from './errors.mjs';
import { trustAllowsSandboxHooks } from './trust.mjs';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** net-guard do Core: o teste leve o carrega por --import (leitura liberada SÓ para este arquivo). */
export const GUARD_FILE = fileURLToPath(new URL('../hyperframes/adapter/net-guard.mjs', import.meta.url));
/** caches que NUNCA podem ser lidos, mesmo que um diretório liberado os contenha (negação final, mesma operação) */
const SENSITIVE = (home) => [path.join(home, '.cache', 'hyperframes'), path.join(home, '.cache', 'puppeteer')];
const SYSTEM_READ = ['(subpath "/System")', '(subpath "/usr/lib")', '(literal "/dev/urandom")', '(literal "/dev/random")', '(literal "/dev/null")'];
const SAFE = /^\/[^"\\\u0000-\u001f\u007f]*$/;   // absoluto; sem aspas, barra invertida ou controle (o perfil é texto SBPL)

const fail = (code, detail) => { throw new SetupError(code, `teste leve do HyperFrames recusado: ${detail} — nada foi executado (sem fallback para execução sem isolamento)`); };
function safeReal(p, what) {
  let r; try { r = fs.realpathSync(p); } catch { fail('SANDBOX_PATH_UNSAFE', `${what} inexistente`); }
  if (!SAFE.test(r)) fail('SANDBOX_PATH_UNSAFE', `${what} com caracteres não admitidos no perfil`);
  return r;
}
const q = (s) => `"${s}"`;
const isAncestorOrSame = (a, b) => b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);

/**
 * Perfil do teste leve. Lança SANDBOX_PATH_UNSAFE se algum caminho for inseguro ou se um diretório liberado for o HOME
 * real (ou um ancestral dele) — o perfil nunca libera o HOME inteiro.
 * @param {{node:string, nodeDir:string, packageDir:string, workDir:string, guardFile?:string, home?:string, readExtra?:string[]}} o
 */
export function buildSmokeProfile({ node, nodeDir, packageDir, workDir, guardFile = GUARD_FILE, home = os.homedir(), readExtra = [] }) {
  const n = safeReal(node, 'Node gerenciado'); const nd = safeReal(nodeDir, 'árvore do Node'); const pk = safeReal(packageDir, 'pacote');
  const wd = safeReal(workDir, 'diretório do teste'); const gf = safeReal(guardFile, 'net-guard'); const h = safeReal(home, 'HOME');
  if (!isAncestorOrSame(nd, n)) fail('SANDBOX_PATH_UNSAFE', 'o Node não está dentro da árvore do Node');
  const extra = readExtra.map((p) => safeReal(p, 'leitura extra (teste)'));
  for (const [what, d] of [['árvore do Node', nd], ['pacote', pk], ['diretório do teste', wd], ...extra.map((e) => ['leitura extra (teste)', e])]) {
    if (isAncestorOrSame(d, h)) fail('SANDBOX_PATH_UNSAFE', `${what} liberaria o HOME inteiro`);
  }
  const sensitive = SENSITIVE(h).map((s) => { try { return fs.realpathSync(s); } catch { return s; } }).filter((s) => SAFE.test(s));
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    `(allow process-exec (literal ${q(n)}))`,
    '(allow file-read-metadata)',
    '(allow file-read-data (literal "/"))',
    `(allow file-read* ${SYSTEM_READ.join(' ')})`,
    `(allow file-read* (subpath ${q(nd)}) (subpath ${q(pk)}) (literal ${q(gf)}) (subpath ${q(wd)}))`,
    ...(extra.length ? [`(allow file-read* ${extra.map((e) => `(subpath ${q(e)})`).join(' ')})   ; SÓ com injeção de teste em processo`] : []),
    `(allow file-write* (subpath ${q(wd)}))`,
    '(allow file-write-data (literal "/dev/null"))',
    '(allow sysctl-read)',
    '(allow signal (target self))',
    // negação FINAL com a MESMA operação das liberações (uma negação específica `file-read-data` não seria vencida por
    // `file-read*`, e vice-versa: as regras precisam ser da mesma operação para a ordem valer)
    ...(sensitive.length ? [`(deny file-read* ${sensitive.map((s) => `(subpath ${q(s)})`).join(' ')})`] : []),
    '',
  ].join('\n');
}

// Sonda da autoverificação (CommonJS): só alvos LOCAIS — mesmo com o isolamento quebrado, nada sai da máquina.
const PROBE = String.raw`const net = require('net'), dgram = require('dgram'), fs = require('fs'), cp = require('child_process'), path = require('path');
const [work, outside, home] = process.argv.slice(2); const r = {};
const sock = (o) => new Promise((res) => { let s; try { s = net.connect(o); } catch (e) { return res(e.code || 'THROW'); } const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 2000); s.on('connect', () => { clearTimeout(t); s.destroy(); res('CONECTOU'); }); s.on('error', (e) => { clearTimeout(t); res(e.code); }); });
(async () => {
  r.tcp = await sock({ host: '127.0.0.1', port: 9 });
  r.unix_dns = await sock({ path: '/private/var/run/mDNSResponder' });
  r.udp = await new Promise((res) => { let s; try { s = dgram.createSocket('udp4'); } catch (e) { return res(e.code); } s.on('error', (e) => { try { s.close(); } catch {} res(e.code); }); try { s.send(Buffer.from('x'), 9, '127.0.0.1', (e) => { try { s.close(); } catch {} res(e ? e.code : 'ENVIADO'); }); } catch (e) { res(e.code); } });
  const x = cp.spawnSync('/usr/bin/true'); r.exec = x.error ? x.error.code : 'EXECUTOU';
  try { fs.writeFileSync(path.join(work, '.sandbox-ok'), '1'); r.write_in = 'OK'; } catch (e) { r.write_in = e.code; }
  try { fs.writeFileSync(outside, '1'); r.write_out = 'GRAVOU'; } catch (e) { r.write_out = e.code; }
  try { fs.readdirSync(home); r.read_home = 'LEU'; } catch (e) { r.read_home = e.code; }
  try { process.kill(process.ppid, 0); r.signal = 'PERMITIDO'; } catch (e) { r.signal = e.code; }
  process.stdout.write(JSON.stringify(r));
})();
`;
/** cada vetor precisa dar EXATAMENTE este resultado sob o perfil */
export const EXPECTED = Object.freeze({ tcp: 'EPERM', unix_dns: 'EPERM', udp: 'EPERM', exec: 'EPERM', write_in: 'OK', write_out: 'EPERM', read_home: 'EPERM', signal: 'EPERM' });

/** Autoverificação: roda a sonda sob o perfil EXATO e compara cada vetor. → {ok, observed, profile_sha256} ou SetupError. */
export function selfCheck(profile, { node, workDir, home = os.homedir(), sandboxExec = SANDBOX_EXEC, run = spawnSync } = {}) {
  if (process.platform !== 'darwin') fail('SANDBOX_UNAVAILABLE', 'isolamento do SO para o teste leve só existe no macOS (sandbox-exec)');
  if (!fs.existsSync(sandboxExec)) fail('SANDBOX_UNAVAILABLE', `${sandboxExec} ausente`);
  const probe = path.join(workDir, `.bold-sandbox-probe-${crypto.randomBytes(4).toString('hex')}.cjs`);
  const outside = path.join(os.tmpdir(), `bold-sandbox-canary-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(probe, PROBE);
  try {
    const r = run(sandboxExec, ['-p', profile, node, probe, workDir, outside, home], { encoding: 'utf8', timeout: 20000, cwd: workDir, env: { PATH: '/usr/bin:/bin', HOME: workDir } });
    if (r.error || r.status !== 0) fail('SANDBOX_UNAVAILABLE', `sandbox-exec não aplicou o perfil (exit ${r.status ?? r.signal ?? r.error?.code}: ${String(r.stderr || '').trim().split('\n').pop()?.slice(0, 120) || '-'})`);
    let observed; try { observed = JSON.parse(String(r.stdout).trim()); } catch { fail('SANDBOX_SELFTEST_FAIL', 'sonda sem resultado'); }
    const open = Object.entries(EXPECTED).filter(([k, v]) => observed[k] !== v).map(([k]) => `${k}=${observed[k]} (esperado ${EXPECTED[k]})`);
    if (open.length) fail('SANDBOX_SELFTEST_FAIL', `isolamento NÃO confirmado: ${open.join(', ')}`);
    return { ok: true, observed, profile_sha256: crypto.createHash('sha256').update(profile).digest('hex') };
  } finally { fs.rmSync(probe, { force: true }); fs.rmSync(outside, { force: true }); fs.rmSync(path.join(workDir, '.sandbox-ok'), { force: true }); }
}

/**
 * `run` para o `hyperframesSmoke`: monta o perfil para o diretório do teste, AUTOVERIFICA e só então executa o Node
 * gerenciado sob o MESMO perfil (mesma string). Qualquer falha → SetupError (o teste leve não roda).
 * `readExtra` (leitura adicional, nunca rede/exec/escrita) só é aceito com INJEÇÃO DE TESTE EM PROCESSO (setup/trust.mjs):
 * o Node do Homebrew usado pelos testes depende de bibliotecas em /opt/homebrew; o Node oficial gerenciado não.
 */
export function sandboxedRun({ node, nodeDir, packageDir, readExtra = [], sandboxExec = SANDBOX_EXEC, transformProfile = null, report = null }) {
  // ganchos de TESTE só com injeção de confiança de teste EM PROCESSO (R12.5 B3: nunca pelo ambiente)
  const hooks = readExtra.length || sandboxExec !== SANDBOX_EXEC || transformProfile;
  if (hooks && !trustAllowsSandboxHooks()) fail('SANDBOX_PATH_UNSAFE', 'leitura adicional / sandbox-exec alternativo / perfil transformado só com injeção de teste em processo');
  return (cmd, args, opts) => {
    if (fs.realpathSync(cmd) !== fs.realpathSync(node)) fail('SANDBOX_EXEC_MISMATCH', 'o teste leve só pode executar o Node gerenciado verificado');
    let profile = buildSmokeProfile({ node, nodeDir, packageDir, workDir: opts.cwd, readExtra });
    if (transformProfile) profile = transformProfile(profile);   // SÓ testes (perfil adulterado): a autoverificação precisa reprovar
    const sc = selfCheck(profile, { node, workDir: opts.cwd, sandboxExec });
    if (report) Object.assign(report, { profile, self_check: sc });
    const r = spawnSync(sandboxExec, ['-p', profile, cmd, ...args], opts);
    if (report) report.stdout = String(r.stdout ?? '').slice(0, 64 * 1024);
    return r;
  };
}
