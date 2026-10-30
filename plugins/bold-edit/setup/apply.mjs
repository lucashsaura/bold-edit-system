// `bold setup apply` (R12.2 → R12.4): instala componentes PEDIDOS EXPLICITAMENTE, um a um, com confirmação por componente.
// Só instala o que o lock fixou (PINNED). Em modo de teste (loopback) só aceita o servidor local.
// Tipos (R12.4):
//   arquivo(s)    tar.gz/zip extraídos ou `file` copiado (ex.: modelo Whisper) — cada parte baixada e verificada individualmente
//   pip-offline   composto Python auxiliar (python-build-standalone) + wheel(s) → `pip --no-index --require-hashes` no STAGING
//   npm           `npm ci` com package.json/package-lock.json DO PACOTE (sha256 no lock; integrity sha512 por pacote)
// Portão de licença (Remotion): sem consentimento válido → LICENSE_REQUIRED, nada é baixado nem criado.
// Nada é escrito antes de existir pelo menos um componente CONFIRMADO. Tudo sob UM lock de execução.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { artifactFor } from './lock.mjs';
import { trustedLock } from './trust.mjs';
import { componentById } from './components.mjs';
import { download } from './download.mjs';
import { installArchive, installNpm, acquireLock, checkSpace, readActive, readReceipt, treeHash, recordSignature, DOWNLOADS } from './engine.mjs';
import { SetupError } from './errors.mjs';
import { appendSetupLog } from './log.mjs';
import { consentFor, consentText } from './consent.mjs';
import { REQUIRED as REMOTION_REQUIRED } from '../remotion/adapter/detect.mjs';
import { CODESIGN, isMachO, verifyByPolicy, recordMatches, signatureLabel, machoFiles, baselineValid } from './codesign.mjs';
import { auxPythonEnv } from '../core/config/aux-python.mjs';
import { stripInjection } from '../core/config/child-env.mjs';
import { safeRelative } from '../core/config/toolchain.mjs';
import { sandboxedRun } from './smoke-sandbox.mjs';
import { policyEnv as hfPolicyEnv, netAttempts as hfNetAttempts } from '../hyperframes/adapter/run.mjs';
import os from 'node:os';

/**
 * Teste leve: `--version`/`-version`. No macOS, binário Mach-O precisa de assinatura válida ANTES de ser executado
 * (R12.5B: /usr/bin/codesign por caminho absoluto; a identidade/Team ID é exigida antes, pela política do lock).
 */
export function defaultSmoke(file, bin) {
  if (bin === 'hyperframes') return { ok: false, detail: 'o teste leve do HyperFrames exige o Node gerenciado verificado (managedHyperframesSmoke)' };
  if (process.platform === 'darwin' && isMachO(file)) {
    const c = spawnSync(CODESIGN, ['--verify', '--strict', file], { encoding: 'utf8', timeout: 15000, shell: false, env: { PATH: '/usr/bin:/bin' } });
    if (c.status !== 0) return { ok: false, detail: 'assinatura de código inválida (codesign --verify)' };
  }
  const args = bin === 'ffmpeg' || bin === 'ffprobe' ? ['-hide_banner', '-version'] : ['--version'];
  const r = spawnSync(file, args, { encoding: 'utf8', timeout: 15000, windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(file), env: { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot } });
  if (r.status !== 0) return { ok: false, detail: `exit ${r.status}` };
  return { ok: true };
}

/** Portão depois do pip (R12.5C1B): política do lock na fase final; sem política ADHOC, no macOS, todo Mach-O novo precisa de assinatura válida. */
function postPipGate(it, o) {
  return (staging) => {
    if (it.codesign) {
      const v = verifyByPolicy(staging, it.bins, it.codesign, { phase: 'final', verifier: o.codesignVerifier, inspect: o.adhocInspect });
      if (!v.ok) throw new SetupError(v.code, `assinatura recusada DEPOIS do pip e ANTES do import — ${v.detail} (nada carregado nem ativado)`);
      if (it.codesign.policy === 'ADHOC_PINNED') return;
    }
    for (const rel of machoFiles(staging)) { const r = (o.baselineVerifier || baselineValid)(path.join(staging, rel)); if (!r.ok) throw new SetupError(r.code, `${rel}: ${r.detail} (import NÃO executado)`); }
  };
}

/**
 * Node GERENCIADO e VERIFICADO do toolchain (R12.5C3c-PRE) — o único Node que pode executar o CLI do HyperFrames no
 * teste leve. Nunca o `node` do PATH, nunca Homebrew/sistema/npx, sem fallback. Fonte: active.json + recibo; árvore
 * íntegra (hash contra o recibo); no macOS, o registro de assinatura precisa coincidir com a política REQUIRED do LOCK
 * (Team ID, hardened runtime) e a assinatura é re-verificada agora. Qualquer falha → SetupError (nada é executado).
 * @returns {string} caminho absoluto do executável
 */
export function verifiedManagedNode(root, { platform = process.platform, lock = null, verifier } = {}) {
  const fail = (code, detail) => { throw new SetupError(code, `Node gerenciado recusado para o teste leve do HyperFrames: ${detail} — nada foi executado (o node do PATH não é usado)`); };
  let active = null; try { active = readActive(root); } catch (e) { fail('MANAGED_NODE_UNVERIFIED', `active.json ilegível (${e.code ?? e.message})`); }
  const t = active?.tools?.node;
  if (!t) fail('MANAGED_NODE_MISSING', 'Node não instalado no toolchain gerenciado (instale com bold setup apply --components node)');
  if (!safeRelative(t.dir) || !safeRelative(t.bins?.node || '')) fail('MANAGED_NODE_UNVERIFIED', 'caminho inseguro no active.json');
  let entry = null; try { entry = readReceipt(root).entries.find((e) => e.tool === 'node' && e.dir === t.dir) ?? null; } catch (e) { fail('MANAGED_NODE_UNVERIFIED', `recibo ilegível (${e.code ?? e.message})`); }
  if (!entry || entry.tree_sha256 !== t.tree_sha256) fail('MANAGED_NODE_UNVERIFIED', 'versão ativa fora do recibo');
  const dir = path.join(root, t.dir); const bin = path.join(dir, t.bins.node);
  let h; try { h = treeHash(dir); } catch (e) { fail('MANAGED_NODE_MODIFIED', `árvore insegura (${e.code ?? e.message})`); }
  if (h.sha256 !== entry.tree_sha256) fail('MANAGED_NODE_MODIFIED', 'árvore do Node modificada desde a instalação (hash de árvore)');
  let real; try { real = fs.realpathSync(bin); } catch { fail('MANAGED_NODE_MISSING', `executável ausente: ${t.bins.node}`); }
  if (!real.startsWith(fs.realpathSync(dir) + path.sep)) fail('MANAGED_NODE_UNVERIFIED', 'executável fora da árvore do Node');
  if (platform === 'darwin') {
    const rec = t.codesign ?? entry.codesign ?? null;
    if (!rec) fail('MANAGED_NODE_UNVERIFIED', 'sem registro de assinatura (instalado antes da verificação)');
    let L; try { L = lock ?? trustedLock(); } catch (e) { fail('MANAGED_NODE_UNVERIFIED', `lock ilegível (${e.message})`); }
    const spec = L?.data?.components?.node?.platforms?.[active.platform]?.codesign ?? null;
    if (spec?.policy !== 'REQUIRED') fail('MANAGED_NODE_UNVERIFIED', `o lock não aprova assinatura do Node para ${active.platform}`);
    if (!recordMatches(rec, spec)) fail('MANAGED_NODE_UNVERIFIED', 'registro de assinatura ≠ política do lock');
    const v = verifyByPolicy(dir, t.bins, spec, { phase: 'final', verifier });
    if (!v.ok) fail('MANAGED_NODE_SIGNATURE', `${v.code}: ${v.detail}`);
  }
  return real;
}

/** Entrypoint JS do CLI (campo `bin` do package.json do pacote), dentro de node_modules e coerente com o .bin. */
function hyperframesEntry(file) {
  const nm = path.dirname(path.dirname(file)); const pkgDir = path.join(nm, 'hyperframes');
  let pkg; try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { return null; }
  const rel = String((typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.hyperframes) ?? '').replace(/^\.\//, '');
  if (!safeRelative(rel) || !/\.(c|m)?js$/.test(rel)) return null;
  let real; try { real = fs.realpathSync(path.join(pkgDir, rel)); } catch { return null; }
  if (!real.startsWith(fs.realpathSync(nm) + path.sep)) return null;
  if (process.platform !== 'win32') { try { if (fs.realpathSync(file) !== real) return null; } catch { return null; } }
  return real;
}

/**
 * Teste leve do HyperFrames (R12.5C3a → C3c-PRE): o entrypoint JS é executado DIRETAMENTE pelo Node gerenciado
 * verificado (caminho absoluto; sem shebang `env node`, sem PATH). PATH do processo = diretório privado contendo SÓ
 * `node` → esse mesmo Node (npx, curl, brew, git… não são encontrados pelo nome). Mesmo bloqueio do Core (policyEnv:
 * sem telemetria/update/auto-install/skills; net-guard em todo processo Node) + PUPPETEER_SKIP_DOWNLOAD; HOME e cache
 * de fontes temporários; sem variáveis DYLD_, LD_ ou NODE_OPTIONS herdadas. QUALQUER tentativa de rede → falha.
 * Só roda depois do portão de nativos npm (motor).
 */
export function hyperframesSmoke(file, { node, run = spawnSync, base = process.env } = {}) {
  if (!node || !path.isAbsolute(node)) return { ok: false, detail: 'Node gerenciado verificado não informado (o node do PATH não é usado)' };
  const entry = hyperframesEntry(file);
  if (!entry) return { ok: false, detail: 'entrypoint JS do HyperFrames ausente, fora do pacote ou incoerente com node_modules/.bin' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bold-hf-smoke-')); const netLog = path.join(dir, 'net.jsonl');
  try {
    const binDir = path.join(dir, 'bin'); fs.mkdirSync(binDir);
    let PATH = binDir; try { fs.symlinkSync(node, path.join(binDir, process.platform === 'win32' ? 'node.exe' : 'node')); } catch { PATH = path.dirname(node); }
    // base SEM DYLD_*/LD_*/NODE_OPTIONS; o policyEnv do Core acrescenta depois só o net-guard ao NODE_OPTIONS
    const env = { ...hfPolicyEnv(stripInjection({ PATH, HOME: dir, SystemRoot: base.SystemRoot }), { fontCacheDir: path.join(dir, 'fonts'), netLog }), PUPPETEER_SKIP_DOWNLOAD: '1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1' };
    const r = run(node, [entry, '--version'], { encoding: 'utf8', timeout: 60000, windowsHide: true, shell: false, env, cwd: dir });
    const net = hfNetAttempts(netLog);
    if (net.length) return { ok: false, detail: `tentativa de rede no teste leve: ${net.map((n) => `${n.kind}→${n.target}`).join(', ')}` };
    if (r.status !== 0) return { ok: false, detail: `exit ${r.status}` };
    return { ok: true, node, entry, env_keys: Object.keys(env) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Teste leve de produção: resolve e verifica o Node gerenciado AGORA e executa SOB ISOLAMENTO DO SO (R12.5C3c-B2:
 * macOS sandbox-exec, perfil deny default, autoverificação antes de cada execução). Sem Node verificado, fora do
 * macOS, sem sandbox ou com qualquer vetor aberto → recusa (nada é executado; sem fallback sem isolamento).
 * `sandbox`: SÓ testes — { readExtra, sandboxExec, transformProfile, report } (aceitos apenas em modo de teste).
 */
export function managedHyperframesSmoke(file, { root, lock = null, verifier, platform = process.platform, sandbox = {} } = {}) {
  let node; try { node = verifiedManagedNode(root, { lock, verifier, platform }); } catch (e) { return { ok: false, code: e.code, detail: `${e.code}: ${e.message}` }; }
  if (platform !== 'darwin') return { ok: false, code: 'SANDBOX_UNAVAILABLE', detail: 'SANDBOX_UNAVAILABLE: isolamento do SO para o teste leve só existe no macOS (sandbox-exec) — nada foi executado' };
  try {
    const run = sandboxedRun({ node, nodeDir: path.dirname(path.dirname(node)), packageDir: path.dirname(path.dirname(file)), ...sandbox });
    return hyperframesSmoke(file, { node, run });
  } catch (e) { if (e instanceof SetupError) return { ok: false, code: e.code, detail: `${e.code}: ${e.message}` }; throw e; }
}

const human = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** Texto da confirmação de UM componente (mostrado antes de qualquer download). */
export function describe(item) {
  const L = [];
  if (item.kind === 'npm') {
    L.push(`Instalar ${item.name} ${item.version} (${item.platform}) via npm ci?`,
      `  pacotes   ${item.npm.packages ?? '?'} (lockfile sha256 ${item.npm.lockfile_sha256}) · registro ${item.npm.registry}`,
      `  estimado  ~${human(item.npm.tarball_bytes_estimate ?? 0)} de pacotes (cada um conferido pelo integrity sha512 do lockfile)`);
  } else {
    const total = item.parts.reduce((n, p) => n + p.size, 0);
    L.push(`Instalar ${item.name} ${item.version} (${item.platform})${item.parts.length > 1 ? ` — ${item.parts.length} artefatos, cada um verificado` : ''}?`);
    for (const p of item.parts) {
      L.push(`  ${item.parts.length > 1 ? `[${p.id}] ` : ''}fonte     ${p.url}`);
      L.push(`  ${item.parts.length > 1 ? `[${p.id}] ` : ''}tamanho   ${human(p.size)} · sha256 ${p.sha256}`);
    }
    if (item.parts.length > 1) L.push(`  total     ${human(total)}`);
  }
  L.push(`  licença   ${item.license}${item.provider ? ` · ${item.provider}` : ''}`);
  if (item.codesign?.policy === 'REQUIRED') L.push(`  assinatura Developer ID · Team ID ${item.codesign.team_id} (verificada ANTES de executar/ativar)`);
  if (item.codesign?.policy === 'ADHOC_PINNED') L.push(`  assinatura ad-hoc com ${Object.keys(item.codesign.macho).length} CDHash fixados (GATE ${item.codesign.approved}) — verificados ANTES de executar/ativar`);
  if (item.consent) L.push(`  aceite    ${item.consent.license} · base "${item.consent.basis}" em ${item.consent.accepted_at}`);
  L.push(`  destino   ${item.dest}`);
  return L.join('\n');
}

const binsWithSubdir = (parts) => Object.fromEntries(parts.flatMap((p) => Object.entries(p.bins || {}).map(([b, rel]) => [b, p.subdir ? `${p.subdir}/${rel}` : rel])));

/** npm a usar: o do Node GERENCIADO (npm-cli.js), senão o `npm` do PATH. */
export function resolveNpm(root, platform, env = process.env) {
  try {
    const t = readActive(root)?.tools?.node;
    if (t) {
      const nodeBin = path.join(root, t.dir, t.bins.node);
      const cli = platform.startsWith('win32') ? path.join(root, t.dir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : path.join(root, t.dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (fs.existsSync(nodeBin) && fs.existsSync(cli)) return { cmd: nodeBin, args: [cli], source: 'toolchain' };
    }
  } catch { /* sem toolchain */ }
  const dirs = String(env.PATH || env.Path || '').split(platform.startsWith('win32') ? ';' : ':').filter(Boolean);
  for (const d of dirs) for (const n of platform.startsWith('win32') ? ['npm.cmd', 'npm.exe'] : ['npm']) { const f = path.join(d, n); if (fs.existsSync(f)) return { cmd: f, args: [], source: 'system-path' }; }
  return null;
}

/** Verificações pós-`npm ci` por componente (somente leitura do staging). */
const NPM_VERIFY = {
  hyperframes: (pin) => (staging) => {
    const v = JSON.parse(fs.readFileSync(path.join(staging, 'node_modules', 'hyperframes', 'package.json'), 'utf8')).version;
    if (v !== pin) throw new SetupError('NPM_VERIFY', `hyperframes ${v} ≠ pin ${pin}`);
    if (!fs.existsSync(path.join(staging, 'node_modules', 'puppeteer-core', 'package.json'))) throw new SetupError('NPM_VERIFY', 'puppeteer-core ausente');
  },
  remotion: (pin) => (staging) => {
    const ver = (p) => { try { return JSON.parse(fs.readFileSync(path.join(staging, 'node_modules', p, 'package.json'), 'utf8')).version; } catch { return null; } };
    for (const p of REMOTION_REQUIRED) if (!ver(p)) throw new SetupError('NPM_VERIFY', `${p} ausente`);
    for (const p of ['remotion', '@remotion/bundler', '@remotion/renderer']) if (ver(p) !== pin) throw new SetupError('NPM_VERIFY', `${p} ${ver(p)} ≠ pin ${pin}`);
    if (ver('react') !== ver('react-dom')) throw new SetupError('NPM_VERIFY', 'react/react-dom divergentes');
  },
};

/** pip OFFLINE no staging: só os wheels baixados e verificados, com --require-hashes; Python isolado (-I, --isolated). */
/**
 * pip OFFLINE no staging (R12.4) — executa o Python extraído, que já passou pelo preExecGate (fase extract).
 * R12.5C1B: (1) ambiente por allowlist (sem DYLD_*, LD_* nem PYTHON*), sempre com -I; (2) DEPOIS do pip e ANTES do `import PIL`
 * (que carrega as extensões nativas), `gate(staging)` verifica TODO Mach-O criado pelo pip (fase final da política).
 */
function pipOffline(item, run = spawnSync, gate = () => {}) {
  return async (staging) => {
    const py = path.join(staging, item.bins['python-aux']);
    const wheels = item.parts.filter((p) => p.format === 'file' && /\.whl$/.test(p.filename));
    if (!wheels.length) throw new SetupError('USAGE', 'pip-offline sem wheels');
    const scratch = `${staging}.pip`; fs.mkdirSync(scratch, { recursive: true });
    try {
      const req = wheels.map((w) => { const m = w.filename.match(/^([A-Za-z0-9_.]+)-([0-9][A-Za-z0-9.+]*)-/); if (!m) throw new SetupError('USAGE', `wheel inválido: ${w.filename}`); return `${m[1]}==${m[2]} --hash=sha256:${w.sha256}`; });
      fs.writeFileSync(path.join(scratch, 'requirements.txt'), `${req.join('\n')}\n`);
      const env = auxPythonEnv({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, { HOME: scratch, USERPROFILE: scratch, TMPDIR: scratch, PIP_CONFIG_FILE: path.join(scratch, 'none.conf'), PIP_NO_INPUT: '1' });
      const links = wheels.map((w) => ['--find-links', path.join(staging, w.subdir)]).flat();
      const r = run(py, ['-I', '-m', 'pip', 'install', '--isolated', '--no-index', '--no-cache-dir', '--disable-pip-version-check', '--no-deps', '--only-binary', ':all:', '--require-hashes', '--no-warn-script-location', ...links, '-r', path.join(scratch, 'requirements.txt')], { env, encoding: 'utf8', timeout: 10 * 60_000, windowsHide: true });
      if (r.status !== 0) throw new SetupError('PIP_FAILED', `pip offline falhou (exit ${r.status}): ${String(r.stderr || '').split('\n').slice(-3).join(' ').slice(0, 300)}`);
      gate(staging);   // extensões nativas do Pillow verificadas ANTES de qualquer import (que as carregaria)
      const pv = run(py, ['-I', '-B', '-c', 'import PIL;print(PIL.__version__)'], { env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
      const want = (wheels.find((w) => /^pillow-/i.test(w.filename))?.filename.match(/^[A-Za-z0-9_.]+-([0-9][A-Za-z0-9.+]*)-/) || [])[1];
      if (pv.status !== 0 || (want && pv.stdout.trim() !== want)) throw new SetupError('PIP_VERIFY', `Pillow não importa ou versão divergente (${pv.stdout.trim() || pv.status})`);
      for (const w of wheels) fs.rmSync(path.join(staging, w.subdir), { recursive: true, force: true });   // wheels já instalados: fora do diretório final
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  };
}

/**
 * @param {{components:string[], lock:object, platform:object, root:string, yes?:boolean, dryRun?:boolean,
 *          confirm?:(item:object, text:string)=>Promise<boolean>, archive?:string|null, allowLoopback?:boolean,
 *          freeBytes?:Function, marginBytes?:number, smoke?:Function, home?:string, download?:Function, limits?:object,
 *          consents?:Record<string,object>, npm?:{cmd:string,args?:string[]}, pins?:object, pipRunner?:Function, env?:object}} o
 */
export async function applyComponents(o) {
  const env = o.env || process.env;
  const ids = [...new Set(o.components || [])];
  if (!ids.length) throw new SetupError('USAGE', 'informe --components (lista explícita)');
  for (const id of ids) if (!componentById(id)) throw new SetupError('USAGE', `componente desconhecido: ${id}`);
  if (o.archive && ids.length !== 1) throw new SetupError('USAGE', '--archive vale para exatamente um componente');
  if (!o.platform.managed) throw new SetupError('UNSUPPORTED_PLATFORM', `plataforma ${o.platform.id} (${o.platform.support}) não é gerenciada`);
  const results = []; const items = [];
  for (const id of ids) {
    const c = componentById(id); const a = artifactFor(o.lock, id, o.platform.id, { allowLoopback: !!o.allowLoopback, packageRoot: o.packageRoot });
    if (a.state !== 'PINNED') { results.push({ id, result: 'NOT_INSTALLABLE', reason: a.reason || (a.state === 'NOT_PROVIDED' ? (a.entry?.notes || 'sem artefato gerenciado nesta plataforma') : a.state) }); continue; }
    const gate = a.entry.license_gate;
    const consent = gate ? (o.consents?.[id] ?? (fs.existsSync(o.root) ? consentFor(o.root, id) : null)) : null;
    if (gate && !consent) { results.push({ id, result: 'LICENSE_REQUIRED', reason: `aceite explícito necessário: bold setup consent --component ${id} --basis <base>`, terms: consentText(id) }); continue; }
    if (o.archive && (a.kind === 'npm' || a.parts.length !== 1)) throw new SetupError('USAGE', '--archive vale só para componente de artefato único');
    const base = { id, name: c.name, version: a.version, platform: o.platform.id, hosts: a.entry.hosts || [], license: a.license, provider: a.entry.provider ?? null,
      consent, bins: a.kind === 'npm' ? (a.entry.bins || {}) : binsWithSubdir(a.parts), paths: a.entry.paths || {}, dest: path.join(o.root, id, `${a.version}-${o.platform.id}`) };
    items.push(a.kind === 'npm' ? { ...base, kind: 'npm', npm: a.npm, parts: [], codesign: a.codesign || null } : { ...base, kind: 'archive', parts: a.parts, post: a.entry.post_install || null, codesign: a.codesign || null });
  }
  if (!items.length) return { ok: false, code: results.some((r) => r.result === 'LICENSE_REQUIRED') ? 'LICENSE_REQUIRED' : 'NOTHING_INSTALLABLE', dry_run: !!o.dryRun, results };
  if (o.dryRun) return { ok: true, code: 'DRY_RUN', dry_run: true, results: [...results, ...items.map((i) => ({ id: i.id, result: 'WOULD_INSTALL', version: i.version, kind: i.kind, parts: i.parts.map((p) => ({ id: p.id, url: p.url, sha256: p.sha256, size: p.size })), ...(i.npm ? { npm: { packages: i.npm.packages, lockfile_sha256: i.npm.lockfile_sha256 } } : {}), text: describe(i) }))] };

  // 1) idempotência, confirmação, espaço e pré-requisitos ANTES de qualquer escrita
  const todo = []; const migrate = [];
  for (const it of items) {
    let act = null; try { act = fs.existsSync(o.root) ? readActive(o.root)?.tools?.[it.id] : null; } catch { act = null; }
    if (act && act.version === it.version && fs.existsSync(path.join(o.root, act.dir))) {
      let same = false; try { same = treeHash(path.join(o.root, act.dir)).sha256 === act.tree_sha256; } catch { same = false; }
      // R12.5C3c-B: versão já instalada com árvore ≠ hash aprovado no lock → recusa (nada muda; sem reinstalação silenciosa)
      if (same && it.npm?.installed_tree_sha256 && act.tree_sha256 !== it.npm.installed_tree_sha256) { results.push({ id: it.id, result: 'INTEGRITY_FAIL', code: 'INTEGRITY_FAIL', version: it.version, reason: `árvore instalada ≠ hash aprovado no lock (${it.npm.installed_tree_sha256.slice(0, 12)}…) — nada foi alterado; desinstale e reinstale: bold setup uninstall --tool ${it.id}` }); continue; }
      if (same && (!it.codesign || recordMatches(act.codesign, it.codesign))) { results.push({ id: it.id, result: 'ALREADY_INSTALLED', version: it.version }); continue; }
      if (same) {
        // R12.5B — migração: versão já instalada SEM registro de assinatura (ou com outro) → verifica AGORA contra o lock;
        // nada é ativado nem trocado; só o registro é gravado (com confirmação). Falhou → recusado, nada muda.
        const v = verifyByPolicy(path.join(o.root, act.dir), act.bins, it.codesign, { phase: 'final', verifier: o.codesignVerifier, inspect: o.adhocInspect });
        if (!v.ok) { results.push({ id: it.id, result: 'CODESIGN_FAIL', code: v.code, version: it.version, reason: `assinatura recusada (${v.code}: ${v.detail}) — nada foi alterado; desinstale e reinstale: bold setup uninstall --tool ${it.id}` }); continue; }
        if (!o.yes) {
          if (!o.confirm) { results.push({ id: it.id, result: 'SIGNATURE_UNRECORDED', version: it.version, reason: 'assinatura verificada; use --yes para registrar' }); continue; }
          if (!(await o.confirm(it, `Registrar a assinatura verificada de ${it.name} ${it.version} (${signatureLabel(it.codesign) ?? '-'})? Nada será baixado nem ativado.`))) { results.push({ id: it.id, result: 'DECLINED' }); continue; }
        }
        migrate.push({ it, dir: act.dir, record: { ...v.record, migrated: true } });
        continue;
      }
    }
    if (it.kind === 'npm') {
      it.npmCmd = o.npm ?? resolveNpm(o.root, o.platform.id, env);
      if (!it.npmCmd) { results.push({ id: it.id, result: 'NOT_INSTALLABLE', reason: 'npm não encontrado (instale o Node gerenciado: --components node)' }); continue; }
      if (env.BOLD_SETUP_OFFLINE === '1' && !o.npm) throw new SetupError('OFFLINE', `modo offline (BOLD_SETUP_OFFLINE=1): npm ci contra ${it.npm.registry} recusado`);
    }
    if (!o.yes) {
      if (!o.confirm) throw new SetupError('CONFIRMATION_REQUIRED', 'sem terminal interativo: use --yes junto com --components para confirmar explicitamente');
      if (!(await o.confirm(it, describe(it)))) { results.push({ id: it.id, result: 'DECLINED' }); continue; }
    }
    const need = it.kind === 'npm' ? (it.npm.tarball_bytes_estimate ?? 0) * 3 : it.parts.reduce((n, p) => n + p.size + (p.installed_size ?? (p.format === 'file' ? 0 : p.size * 4)), 0);
    checkSpace(o.root, need, { freeBytes: o.freeBytes, marginBytes: o.marginBytes });
    it.need = need;
    todo.push(it);
  }
  if (!todo.length && !migrate.length) { const ok = results.every((r) => ['ALREADY_INSTALLED', 'DECLINED'].includes(r.result)); return { ok, code: ok ? 'OK' : 'PARTIAL', dry_run: false, results }; }

  // 2) instalação (e migrações de assinatura) sob UM lock
  const release = acquireLock(o.root);
  try {
    for (const m of migrate) {
      recordSignature({ root: o.root, tool: m.it.id, dir: m.dir, record: m.record, home: o.home });
      results.push({ id: m.it.id, result: 'ALREADY_INSTALLED', version: m.it.version, migrated: true, codesign: signatureLabel(m.record) });
    }
    for (const it of todo) {
      if (it.kind === 'npm') {
        const pin = it.version;
        const r = await installNpm({ root: o.root, tool: it.id, version: it.version, platform: it.platform, packageJson: it.npm.package_json_abs, lockfile: it.npm.lockfile_abs,
          expected: { package_json_sha256: it.npm.package_json_sha256, lockfile_sha256: it.npm.lockfile_sha256 }, npm: it.npmCmd, registry: it.npm.registry, bins: it.bins, paths: it.paths,
          license: it.license, source: `npm:${it.npm.lockfile}`, verify: NPM_VERIFY[it.id]?.(pin), expectTree: it.npm.installed_tree_sha256 ?? null, env: o.npmEnv, home: o.home, freeBytes: o.freeBytes, marginBytes: o.marginBytes, needBytes: it.need, lockHeld: true,
          // R12.5C3a: teste leve SÓ depois do portão de nativos (npmNativeGate) e, no HyperFrames, com o ambiente de bloqueio do Core
          smoke: it.id === 'hyperframes' ? (o.smoke ?? ((f) => managedHyperframesSmoke(f, { root: o.root, lock: o.lock, verifier: o.codesignVerifier, sandbox: o.smokeSandbox }))) : undefined, nativeGate: o.nativeGate, codesign: it.codesign, adhocInspect: o.adhocInspect });
        results.push({ id: it.id, result: r.idempotent ? 'ALREADY_INSTALLED' : 'INSTALLED', version: it.version, dir: r.dir, files: r.files, previous: r.previous });
        continue;
      }
      const files = []; const created = [];
      try {
        for (const p of it.parts) {
          let file = o.archive ? path.resolve(o.archive) : null;
          if (!file) {
            fs.mkdirSync(path.join(o.root, DOWNLOADS), { recursive: true });
            file = path.join(o.root, DOWNLOADS, `${it.id}-${p.id}-${it.version}-${it.platform}.${p.format === 'file' ? 'bin' : p.format}`);
            // resto de execução anterior DESTE setup (inclusive o .part de um download interrompido — processo morto):
            // removido SOB o lock, no diretório interno do toolchain; rmSync remove um symlink sem segui-lo. O downloader
            // continua abrindo o .part em modo exclusivo (wx). Mesmo comportamento do bootstrap (rm -f "$part").
            for (const f of [file, `${file}.part`]) { let st = null; try { st = fs.lstatSync(f); } catch { st = null; } if (st) fs.rmSync(f, { force: true }); }
            created.push(file);
            await (o.download || download)({ url: p.url, dest: file, expected: { sha256: p.sha256, size: p.size }, allowHosts: it.hosts, allowLoopbackHttp: !!o.allowLoopback });
          }
          files.push({ id: p.id, subdir: p.subdir, archive: file, format: p.format, filename: p.filename, strip: p.strip_components ?? 0, expected: { sha256: p.sha256, size: p.size }, installedSize: p.installed_size ?? undefined, source: p.url.replace(/\?.*$/, '') });
        }
        const post = it.post === 'pip-offline' ? pipOffline({ ...it, parts: files.map((f, i) => ({ ...it.parts[i], subdir: f.subdir })) }, o.pipRunner, postPipGate(it, o)) : undefined;
        const r = await installArchive({ root: o.root, tool: it.id, version: it.version, platform: it.platform, parts: files, bins: it.bins, paths: it.paths, license: it.license,
          source: it.parts.map((p) => p.url.replace(/\?.*$/, '')).join(' + '), smoke: o.smoke ?? defaultSmoke, codesign: it.codesign, codesignVerifier: o.codesignVerifier, postInstall: post, home: o.home, freeBytes: o.freeBytes, marginBytes: o.marginBytes, limits: o.limits, lockHeld: true });
        results.push({ id: it.id, result: r.idempotent ? 'ALREADY_INSTALLED' : 'INSTALLED', version: it.version, dir: r.dir, files: r.files, previous: r.previous, parts: it.parts.length, ...(r.codesign ? { codesign: r.codesign } : {}) });
      } finally {
        for (const f of created) fs.rmSync(f, { force: true });
        try { fs.rmdirSync(path.join(o.root, DOWNLOADS)); } catch { /* não vazio/ausente */ }
      }
    }
  } catch (e) {
    try { appendSetupLog(o.root, { event: 'apply', result: 'FAIL', code: e.code ?? 'ERROR', message: e.message }, { home: o.home }); } catch { /* best-effort */ }
    throw e;
  } finally { release(); }
  const ok = results.every((r) => ['INSTALLED', 'ALREADY_INSTALLED', 'DECLINED'].includes(r.result));
  return { ok, code: ok ? 'OK' : 'PARTIAL', dry_run: false, results };
}
