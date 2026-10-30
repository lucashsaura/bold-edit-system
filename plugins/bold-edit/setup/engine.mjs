// Engine do toolchain gerenciado (R12.1 local · R12.2 arquivos).
// install: diretório local (simulação/testes) OU arquivo .tar.gz/.zip já baixado e verificado →
//   staging → hash de árvore → binários + teste leve → rename atômico → active.json por último → recibo → log.
// verify · status · rollback · uninstall (dry-run por padrão; só o que está no recibo e com hash íntegro).
// Nunca apaga nada fora do recibo; symlinks só se relativos e dentro da própria árvore.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync as spawnSyncNpm } from 'node:child_process';
import { validate } from '../core/schema/validate.mjs';
import { ACTIVE_FILE, NODE_POINTER, safeRelative } from '../core/config/toolchain.mjs';
import { appendSetupLog } from './log.mjs';
import { SetupError } from './errors.mjs';
import { extractArchive, EXTRACT_LIMITS } from './extract.mjs';
import { verifyByPolicy, specFromRecord, legacyUnverified, baselineValid, signatureLabel, machoFiles, classifyMacho } from './codesign.mjs';
import { loadLock } from './lock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS = {
  active: JSON.parse(fs.readFileSync(path.join(HERE, 'schema', 'toolchain-active.schema.json'), 'utf8')),
  receipt: JSON.parse(fs.readFileSync(path.join(HERE, 'schema', 'toolchain-receipt.schema.json'), 'utf8')),
};
export const RECEIPT_FILE = 'receipt.json';
export const LOCK_NAME = '.lock';
export const STAGING = '.staging';
export const DOWNLOADS = '.downloads';
const MANAGED_ROOT_FILES = [ACTIVE_FILE, RECEIPT_FILE, NODE_POINTER];

export { SetupError };

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** sha256 de arquivo em blocos (memória limitada). */
export function fileSha256(file) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(1024 * 1024); let size = 0;
  try { for (;;) { const n = fs.readSync(fd, b, 0, b.length, null); if (!n) break; size += n; h.update(b.subarray(0, n)); } } finally { fs.closeSync(fd); }
  return { sha256: h.digest('hex'), size };
}

/**
 * Hash de árvore: caminho + sha256 + bit de execução (arquivos) ou alvo (symlinks), ordenado.
 * Symlink absoluto/que sai da árvore ou arquivo especial → falha fechada (UNSAFE_ARTIFACT).
 */
export function treeHash(dir) {
  const rows = []; let bytes = 0; let files = 0;
  const walk = (rel) => {
    for (const n of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${n}` : n; const abs = path.join(dir, r); const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        const t = fs.readlinkSync(abs);
        const res = path.posix.normalize(path.posix.join(path.posix.dirname(r), t));
        if (path.isAbsolute(t) || t.includes('\\') || res === '..' || res.startsWith('../')) throw new SetupError('UNSAFE_ARTIFACT', `symlink inseguro no artefato: ${r}`);
        rows.push(`${r}\0L:${t}\n`); continue;
      }
      if (st.isDirectory()) { walk(r); continue; }
      if (!st.isFile()) throw new SetupError('UNSAFE_ARTIFACT', `arquivo especial no artefato: ${r}`);
      const fh = fileSha256(abs); bytes += fh.size; files++;
      rows.push(`${r}\0${fh.sha256}\0${st.mode & 0o111 ? 'x' : '-'}\n`);
    }
  };
  walk('');
  return { sha256: sha(rows.join('')), files, bytes };
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
function writeTextAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file);
}

export function readActive(root) {
  const f = path.join(root, ACTIVE_FILE);
  if (!fs.existsSync(f)) return null;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const errs = validate(SCHEMAS.active, d);
  if (errs.length) throw new SetupError('ACTIVE_INVALID', 'active.json inválido (nada será alterado)', errs);
  return d;
}
export function readReceipt(root) {
  const f = path.join(root, RECEIPT_FILE);
  if (!fs.existsSync(f)) return { schema: 'bold.toolchain-receipt/1', entries: [] };
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const errs = validate(SCHEMAS.receipt, d);
  if (errs.length) throw new SetupError('RECEIPT_INVALID', 'receipt.json inválido (nada será alterado)', errs);
  return d;
}

/** Mutex por arquivo (O_EXCL). Lock de outro processo ainda vivo → LOCKED; morto → STALE_LOCK (exige ação manual). */
export function acquireLock(root, now = new Date()) {
  fs.mkdirSync(root, { recursive: true });
  const f = path.join(root, LOCK_NAME);
  try {
    const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now.toISOString() })); fs.closeSync(fd);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let holder = null; try { holder = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* ilegível */ }
    let alive = false; if (holder?.pid) { try { process.kill(holder.pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; } }
    throw new SetupError(alive ? 'LOCKED' : 'STALE_LOCK', alive ? `outro bold setup em execução (pid ${holder.pid})` : `lock órfão em ${f} — confira e remova manualmente`, holder);
  }
  return () => { try { fs.unlinkSync(f); } catch { /* já removido */ } };
}

/** Espaço livre no volume do toolchain (diretório existente mais próximo). */
export function freeBytesAt(dir) {
  let d = dir; while (d && !fs.existsSync(d)) { const p = path.dirname(d); if (p === d) return null; d = p; }
  try { const s = fs.statfsSync(d); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}
/** Exige espaço para o arquivo + conteúdo estimado + margem. Sem leitura possível → recusa (falha fechada). */
export function checkSpace(root, needBytes, { marginBytes = 256 * 1024 * 1024, freeBytes = freeBytesAt } = {}) {
  const free = freeBytes(root); const need = needBytes + marginBytes;
  if (free == null) throw new SetupError('SPACE_UNKNOWN', 'não foi possível medir o espaço livre');
  if (free < need) throw new SetupError('INSUFFICIENT_SPACE', `espaço insuficiente: ${free} B livres, ${need} B necessários (com margem)`, { free, need });
  return { free, need };
}

const binOk = (abs) => { try { const st = fs.statSync(abs); return st.isFile() && (process.platform === 'win32' || (st.mode & 0o111) !== 0); } catch { return false; } };
/** Versão ativa → registro de "anterior" (preserva o registro de assinatura). */
const versionRecord = (t) => ({ version: t.version, dir: t.dir, bins: t.bins, ...(t.paths ? { paths: t.paths } : {}), tree_sha256: t.tree_sha256, ...(t.codesign ? { codesign: t.codesign } : {}) });

/**
 * Política de assinatura de uma versão JÁ instalada (verify/rollback/migração), R12.5B:
 *  - tem registro gravado na instalação → re-verifica contra o registro;
 *  - sem registro, mas instalada da internet no macOS (anterior à política) → exige a spec REQUIRED do lock para a
 *    ferramenta/plataforma (sem spec = não verificável → recusa);
 *  - sem registro e sem origem na internet (artefato local/teste) → política não se aplica.
 * @returns {{applies:false}|{applies:true, spec:object|null, legacy:boolean}}
 */
function signaturePolicy(entry, version, platform, lock) {
  const rec = version?.codesign || entry?.codesign;
  if (rec) return { applies: true, spec: specFromRecord(rec), legacy: false };
  if (!legacyUnverified(entry ? { ...entry, platform: entry.platform || platform } : null)) return { applies: false };
  let spec = null;
  // identidade esperada vem SÓ do codesign REQUIRED do lock para ferramenta/plataforma (a URL não importa aqui)
  try { const cs = (lock ?? loadLock()).data?.components?.[entry.tool]?.platforms?.[platform]?.codesign; spec = ['REQUIRED', 'ADHOC_PINNED'].includes(cs?.policy) ? cs : null; } catch { spec = null; }
  return { applies: true, spec, legacy: true };
}
/** Verifica a assinatura de uma versão instalada; {ok, record?, code?, detail?}. */
function checkInstalledSignature(root, version, policy, verifier, now, inspect) {
  if (!policy.applies) return { ok: true, record: null };
  if (!policy.spec) return { ok: false, code: 'SIGNATURE_UNVERIFIED', detail: 'instalada antes da verificação de assinatura e sem identidade esperada no lock' };
  const v = verifyByPolicy(path.join(root, version.dir), version.bins, policy.spec, { phase: 'final', verifier, inspect, now });
  return v.ok ? { ok: true, record: policy.legacy ? { ...v.record, migrated: true } : (version.codesign ?? v.record) } : v;
}

function validateRequest({ tool, bins, paths = {} }) {
  if (!/^[a-z][a-z0-9-]*$/.test(tool)) throw new SetupError('USAGE', `nome de ferramenta inválido: ${tool}`);
  for (const rel of Object.values(bins)) if (!safeRelative(rel)) throw new SetupError('USAGE', `bin inseguro: ${rel}`);
  for (const rel of Object.values(paths)) if (rel !== '.' && !safeRelative(rel)) throw new SetupError('USAGE', `caminho inseguro: ${rel}`);
}

/**
 * Núcleo comum (com lock já obtido): staging pronto → verifica → ativa → recibo → log.
 * Retorna o resultado; em erro, remove SÓ o que criou (o staging é responsabilidade de quem chamou).
 */
function commitStaging(o, staging, artifact, expectTree) {
  const now = o.now || (() => new Date());
  const { root, tool, version, platform } = o;
  const dirRel = `${tool}/${version}-${platform}`;
  const final = path.join(root, dirRel);
  let createdFinal = false;
  try {
    const active = readActive(root) || { schema: 'bold.toolchain-active/1', platform, tools: {} };
    if (active.platform !== platform) throw new SetupError('PLATFORM_MISMATCH', `toolchain é ${active.platform}, artefato é ${platform}`);
    const receipt = readReceipt(root);
    const h = treeHash(staging);
    for (const [n, rel] of Object.entries(o.paths || {})) if (!fs.existsSync(rel === '.' ? staging : path.join(staging, rel))) throw new SetupError('PATH_MISSING', `caminho ${n} ausente: ${rel}`);
    if (expectTree && h.sha256 !== expectTree) throw new SetupError('INTEGRITY_FAIL', `hash não confere (esperado ${expectTree.slice(0, 12)}…, obtido ${h.sha256.slice(0, 12)}…)`);
    for (const [b, rel] of Object.entries(o.bins)) if (!binOk(path.join(staging, rel))) throw new SetupError('BIN_MISSING', `binário ${b} ausente ou não executável: ${rel}`);
    // R12.5B: assinatura ANTES de qualquer execução (teste leve) e antes da ativação; política vem do lock
    let signature = null;
    if (o.codesign) {
      const v = verifyByPolicy(staging, o.bins, o.codesign, { phase: 'final', verifier: o.codesignVerifier, inspect: o.adhocInspect, now: now() });
      if (!v.ok) throw new SetupError(v.code, `assinatura de código recusada — ${v.detail} (nada foi ativado)`, { bin: v.bin });
      signature = v.record;
    }
    if (o.smoke) for (const [b, rel] of Object.entries(o.bins)) { const r = o.smoke(path.join(staging, rel), b); if (!r?.ok) throw new SetupError('SMOKE_FAIL', `teste leve falhou: ${b}${r?.detail ? ` (${r.detail})` : ''}`); }
    if (fs.existsSync(final)) {
      const cur = treeHash(final);
      if (cur.sha256 !== h.sha256) throw new SetupError('CONFLICT', `${dirRel} já existe com outro conteúdo (nada foi alterado)`);
      fs.rmSync(staging, { recursive: true, force: true });
    } else {
      fs.mkdirSync(path.dirname(final), { recursive: true });
      fs.renameSync(staging, final); createdFinal = true;
    }
    const prev = active.tools[tool];
    const isSame = prev && prev.dir === dirRel;
    const at = now().toISOString();
    active.tools[tool] = { version, dir: dirRel, bins: o.bins, ...(o.paths && Object.keys(o.paths).length ? { paths: o.paths } : {}), tree_sha256: h.sha256, activated_at: at,
      ...(signature ? { codesign: signature } : {}), previous: isSame ? (prev.previous ?? null) : prev ? versionRecord(prev) : null };
    active.updated_at = at;
    const entries = receipt.entries.filter((e) => !(e.tool === tool && e.dir === dirRel));
    for (const e of entries) if (e.tool === tool) e.status = 'INACTIVE';
    entries.push({ tool, version, platform, dir: dirRel, tree_sha256: h.sha256, files: h.files, bytes: h.bytes, artifact, installed_at: at, status: 'ACTIVE', ...(signature ? { codesign: signature } : {}) });
    writeJsonAtomic(path.join(root, RECEIPT_FILE), { schema: 'bold.toolchain-receipt/1', entries });
    writeJsonAtomic(path.join(root, ACTIVE_FILE), active);
    if (o.bins.node) writeTextAtomic(path.join(root, NODE_POINTER), `${path.join(final, o.bins.node)}\n`);
    appendSetupLog(root, { event: 'install', tool, version, platform, result: 'OK', idempotent: !createdFinal, tree_sha256: h.sha256, files: h.files, artifact_sha256: artifact.sha256, ...(signature ? { codesign_team: signatureLabel(signature) } : {}) }, { home: o.home, now: now() });
    return { ok: true, tool, version, dir: dirRel, tree_sha256: h.sha256, files: h.files, bytes: h.bytes, idempotent: !createdFinal, previous: active.tools[tool].previous?.version ?? null, ...(signature ? { codesign: signatureLabel(signature) } : {}) };
  } catch (e) {
    if (createdFinal) fs.rmSync(final, { recursive: true, force: true });
    throw e;
  }
}

function failLog(o, e) {
  try { appendSetupLog(o.root, { event: 'install', tool: o.tool, version: o.version, platform: o.platform, result: 'FAIL', code: e.code ?? 'ERROR', message: e.message }, { home: o.home, now: (o.now || (() => new Date()))() }); } catch { /* best-effort */ }
}
const stagingDir = (root, tool) => path.join(root, STAGING, `${tool}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
const tidyStaging = (root) => { try { fs.rmdirSync(path.join(root, STAGING)); } catch { /* não vazio ou ausente */ } };

/**
 * Instala um DIRETÓRIO local (simulação e testes da Fase 1). Sem rede.
 * @param {{root:string, tool:string, version:string, platform:string, sourceDir:string, expected:{tree_sha256:string},
 *          bins:Record<string,string>, license:string, source:string, smoke?:Function, home?:string, now?:()=>Date}} o
 */
export function installLocal(o) {
  validateRequest(o);
  const release = acquireLock(o.root, (o.now || (() => new Date()))());
  const staging = stagingDir(o.root, o.tool);
  try {
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    fs.cpSync(o.sourceDir, staging, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    const pre = treeHash(staging);
    return commitStaging(o, staging, { kind: 'simulated-dir', name: path.basename(o.sourceDir), sha256: pre.sha256, size: pre.bytes, license: o.license, source: o.source }, o.expected.tree_sha256);
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); failLog(o, e); throw e; }
  finally { tidyStaging(o.root); release(); }
}

/**
 * Portão ANTES de executar qualquer binário extraído (R12.5C0) — usado antes do pós-instalação:
 *  1) bins declarados presentes e executáveis; 2) política do lock (`codesign` REQUIRED) → identidade completa;
 *  3) sem política, no macOS: todo bin Mach-O precisa de assinatura VÁLIDA (linha de base). A integridade do arquivo
 *  (sha256 + tamanho) já foi conferida antes da extração. Falha → SetupError; nada é executado.
 */
function preExecGate(o, staging) {
  for (const [b, rel] of Object.entries(o.bins)) if (!binOk(path.join(staging, rel))) throw new SetupError('BIN_MISSING', `binário ${b} ausente ou não executável: ${rel} (pós-instalação NÃO executado)`);
  if (o.codesign) {
    const v = verifyByPolicy(staging, o.bins, o.codesign, { phase: 'extract', verifier: o.codesignVerifier, inspect: o.adhocInspect });
    if (!v.ok) throw new SetupError(v.code, `assinatura de código recusada antes do pós-instalação — ${v.detail} (nada executado)`, { bin: v.bin });
    return;
  }
  for (const [b, rel] of Object.entries(o.bins)) {
    const r = (o.baselineVerifier || baselineValid)(path.join(staging, rel));
    if (!r.ok) throw new SetupError(r.code, `${b}: ${r.detail} (pós-instalação NÃO executado)`, { bin: b });
  }
}

/**
 * Instala UM OU MAIS arquivos (.tar.gz/.zip) locais já baixados — componente simples ou COMPOSTO (R12.3).
 * Cada parte: re-confere sha256 + tamanho contra o lock, depois extrai com o extrator seguro (componente composto: cada
 * parte na sua subpasta `<id>/`). Espaço checado antes, para a soma. Uma única ativação atômica no fim. Sem rede.
 * Forma simples (compatível com a R12.2): {archive, format, strip, expected}. Forma composta: {parts:[{id, subdir, archive,
 * format, strip, expected, installedSize?}]}; `bins` já vem com o prefixo da subpasta.
 */
export async function installArchive(o) {
  validateRequest(o);
  const parts = o.parts ?? [{ id: o.tool, subdir: null, archive: o.archive, format: o.format, strip: o.strip ?? 0, expected: o.expected, installedSize: o.installedSize }];
  if (!parts.length) throw new SetupError('USAGE', 'nenhuma parte para instalar');
  for (const p of parts) if (p.subdir !== null && p.subdir !== undefined && !/^[a-z][a-z0-9-]*$/.test(p.subdir)) throw new SetupError('USAGE', `subpasta inválida: ${p.subdir}`);
  const release = o.lockHeld ? () => {} : acquireLock(o.root, (o.now || (() => new Date()))());
  const staging = stagingDir(o.root, o.tool);
  try {
    const got = [];
    for (const p of parts) {
      const h = fileSha256(p.archive);
      if (h.size !== p.expected.size) throw new SetupError('SIZE_MISMATCH', `${p.id}: arquivo com ${h.size} B, lock diz ${p.expected.size} B`);
      if (h.sha256 !== p.expected.sha256) throw new SetupError('INTEGRITY_FAIL', `${p.id}: sha256 do arquivo não confere (esperado ${p.expected.sha256.slice(0, 12)}…, obtido ${h.sha256.slice(0, 12)}…)`);
      got.push(h);
    }
    const need = parts.reduce((n, p, i) => n + (p.installedSize ?? got[i].size * 4), 0);
    checkSpace(o.root, need, { freeBytes: o.freeBytes, marginBytes: o.marginBytes });
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    const limits = { ...EXTRACT_LIMITS, ...(o.limits || {}) };
    // format 'file' (R12.4): o artefato é o próprio arquivo (ex.: modelo Whisper, wheel) — copiado SEM extração
    const place = async (p, dest) => {
      if (p.format === 'file') {
        if (!p.filename || !safeRelative(p.filename) || p.filename.includes('/')) throw new SetupError('USAGE', `nome de arquivo inválido: ${p.filename}`);
        fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(p.archive, path.join(dest, p.filename), fs.constants.COPYFILE_EXCL);
      } else await extractArchive({ file: p.archive, format: p.format, dest, strip: p.strip ?? 0, limits });
    };
    if (parts.length === 1 && !parts[0].subdir) await place(parts[0], staging);
    else { fs.mkdirSync(staging); for (const p of parts) await place(p, path.join(staging, p.subdir)); }
    // gancho pós-extração no STAGING (ex.: pip offline com --require-hashes); falha = nada ativado.
    // R12.5C0: o gancho EXECUTA binários extraídos → antes dele, o mesmo portão de integridade/assinatura da ativação
    if (o.postInstall) { preExecGate(o, staging); await o.postInstall(staging); }
    const composite = parts.length > 1 || !!parts[0].subdir;
    const artifact = composite
      ? { kind: 'archive', name: parts.map((p) => path.basename(p.archive)).join(' + '), sha256: crypto.createHash('sha256').update(parts.map((p, i) => `${p.id}:${got[i].sha256}\n`).join('')).digest('hex'),
        size: got.reduce((n, g) => n + g.size, 0), license: o.license, source: o.source, parts: parts.map((p, i) => ({ id: p.id, name: path.basename(p.archive), sha256: got[i].sha256, size: got[i].size, ...(p.source ? { source: p.source } : {}) })) }
      : { kind: 'archive', name: path.basename(parts[0].archive), sha256: got[0].sha256, size: got[0].size, license: o.license, source: o.source };
    return commitStaging(o, staging, artifact, null);
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); failLog(o, e); throw e; }
  finally { tidyStaging(o.root); release(); }
}

/**
 * Instala um pacote npm com LOCKFILE FIXADO (R12.4): `npm ci` num staging, sem scripts, sem auditoria, com cache e
 * configs ISOLADOS (nunca usa ~/.npmrc nem ~/.npm), registro fixado. O npm confere o `integrity` (sha512) de cada
 * pacote contra o lockfile. Depois: verificação (`verify(staging)`), hash de árvore e ativação atômica.
 * @param {{root, tool, version, platform, packageJson:string, lockfile:string, expected:{package_json_sha256, lockfile_sha256},
 *          npm:{cmd:string, args?:string[]}, registry:string, bins, paths, license, source, verify?:(staging)=>void,
 *          env?:object, home?, now?, freeBytes?, marginBytes?, needBytes?:number, lockHeld?:boolean}} o
 */
/** package.json/lockfile do setup conferidos contra o lock + toda entrada só do registro fixado e com sha512 (antes do npm). */
export function checkNpmFiles({ packageJson, lockfile, expected, registry }) {
  const pj = fileSha256(packageJson); const lf = fileSha256(lockfile);
  if (pj.sha256 !== expected.package_json_sha256) throw new SetupError('INTEGRITY_FAIL', 'package.json do setup não confere com o lock');
  if (lf.sha256 !== expected.lockfile_sha256) throw new SetupError('INTEGRITY_FAIL', 'package-lock.json do setup não confere com o lock');
  const lock = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
  for (const [k, v] of Object.entries(lock.packages || {})) {
    if (!k || v.link) continue;
    if (v.resolved && !String(v.resolved).startsWith(registry)) throw new SetupError('NPM_UNTRUSTED_SOURCE', `${k}: resolved fora do registro fixado`);
    if (v.resolved && !/^sha512-/.test(v.integrity || '')) throw new SetupError('NPM_NO_INTEGRITY', `${k}: sem integrity sha512`);
  }
  return lf;
}

/** `npm ci` isolado (sem scripts, cache/config próprios, registro fixado) em `cwd` — usado pela instalação e pela medição. */
export function runNpmCi({ npm, cwd, scratch, registry, packageJson, lockfile, env: extra = {} }) {
  fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(scratch, { recursive: true });
  fs.copyFileSync(packageJson, path.join(cwd, 'package.json'));
  fs.copyFileSync(lockfile, path.join(cwd, 'package-lock.json'));
  const uc = path.join(scratch, 'user.npmrc'); const gc = path.join(scratch, 'global.npmrc'); fs.writeFileSync(uc, ''); fs.writeFileSync(gc, '');   // npm exige arquivos distintos
  const args = [...(npm.args || []), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--no-update-notifier',
    `--registry=${registry}`, `--cache=${path.join(scratch, 'cache')}`, `--userconfig=${uc}`, `--globalconfig=${gc}`];
  const env = { PATH: process.env.PATH, HOME: scratch, USERPROFILE: scratch, SystemRoot: process.env.SystemRoot, npm_config_update_notifier: 'false',
    PUPPETEER_SKIP_DOWNLOAD: '1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1', REMOTION_SKIP_BROWSER_DOWNLOAD: '1', ...extra };
  const r = spawnSyncNpm(npm.cmd, args, { cwd, env, encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(npm.cmd) });
  if (r.status !== 0) throw new SetupError('NPM_FAILED', `npm ci falhou (exit ${r.status}): ${String(r.stderr || r.error?.message || '').split('\n').slice(-3).join(' ').slice(0, 300)}`);
  return r;
}

/**
 * Portão de binários NATIVOS do npm (R12.5C3a) — depois do `npm ci` e ANTES de qualquer execução (teste leve, ativação).
 * No macOS, QUALQUER Mach-O em node_modules sem política de confiança aprovada para npm → NPM_NATIVE_UNVERIFIED (nenhuma
 * política npm existe ainda: ad-hoc não é aceito automaticamente e o ADHOC_PINNED do Pillow NÃO se estende ao npm).
 * O inventário (classe, Team ID, CDHash) vai no erro como evidência; nada é executado nem ativado.
 */
export function npmNativeGate(staging, { platform = process.platform, classify = classifyMacho } = {}) {
  if (platform !== 'darwin') return { ok: true, natives: [] };
  const natives = machoFiles(staging).map((rel) => ({ path: rel, ...classify(path.join(staging, rel)) }));
  if (!natives.length) return { ok: true, natives };
  const ex = natives.slice(0, 3).map((n) => `${n.path.replace(/^node_modules\//, '')} (${n.class})`).join(', ');
  throw new SetupError('NPM_NATIVE_UNVERIFIED', `${natives.length} binário(s) nativo(s) sem política de confiança aprovada: ${ex}${natives.length > 3 ? ' …' : ''} — nada foi executado nem ativado; meça com \`bold setup measure --component <id> --yes\` e aprove em GATE`, { natives });
}

/**
 * Integridade da árvore npm INSTALADA (R12.5C3b-A): todo pacote presente tem a versão EXATA do lockfile e nenhum pacote
 * fora do lockfile foi criado (o npm já conferiu o sha512 de cada tarball). Somente leitura.
 */
export function verifyNpmTree(dir, lockfile) {
  const lf = JSON.parse(fs.readFileSync(lockfile, 'utf8')); const nm = path.join(dir, 'node_modules'); let installed = 0;
  for (const [k, v] of Object.entries(lf.packages || {})) {
    if (!k || v.link) continue; const pj = path.join(dir, k, 'package.json');
    if (!fs.existsSync(pj)) { if (v.optional) continue; throw new SetupError('NPM_TREE_MISSING', `${k} (não opcional) ausente depois do npm ci`); }
    let ver = null; try { ver = JSON.parse(fs.readFileSync(pj, 'utf8')).version; } catch { ver = null; }
    if (ver !== v.version) throw new SetupError('NPM_TREE_VERSION', `${k}: instalado ${ver ?? '?'} ≠ lockfile ${v.version}`);
    installed++;
  }
  const top = fs.existsSync(nm) ? fs.readdirSync(nm).filter((n) => !n.startsWith('.')).flatMap((n) => (n.startsWith('@') ? fs.readdirSync(path.join(nm, n)).map((x) => `${n}/${x}`) : [n])) : [];
  const extra = top.filter((n) => !lf.packages?.[`node_modules/${n}`]);
  if (extra.length) throw new SetupError('NPM_TREE_UNEXPECTED', `pacote(s) fora do lockfile: ${extra.slice(0, 5).join(', ')}`);
  return { ok: true, installed };
}

export async function installNpm(o) {
  validateRequest(o);
  const release = o.lockHeld ? () => {} : acquireLock(o.root, (o.now || (() => new Date()))());
  const staging = stagingDir(o.root, o.tool);
  const scratch = `${staging}.npm`;            // cache/config isolados, FORA do diretório final
  try {
    const lf = checkNpmFiles(o);
    checkSpace(o.root, o.needBytes ?? 0, { freeBytes: o.freeBytes, marginBytes: o.marginBytes });
    runNpmCi({ npm: o.npm, cwd: staging, scratch, registry: o.registry, packageJson: o.packageJson, lockfile: o.lockfile, env: o.env || {} });
    // R12.5C3b-A — sequência ANTES de qualquer execução do HyperFrames (teste leve) ou ativação:
    // (1) integridade dos pacotes; (2) versões fixadas; (3) nativos: inventário + caminhos + versões + hashes + assinaturas/CDHash
    verifyNpmTree(staging, o.lockfile);
    if (o.verify) o.verify(staging);
    if (o.codesign?.policy === 'NPM_NATIVE_PINNED') {
      const v = verifyByPolicy(staging, o.bins, o.codesign, { inspect: o.adhocInspect });
      if (!v.ok) throw new SetupError(v.code, `binários nativos npm recusados — ${v.detail} (nada foi executado nem ativado)`);
    } else (o.nativeGate || npmNativeGate)(staging);   // sem política aprovada: qualquer Mach-O recusa (sem fallback)
    return commitStaging(o, staging, { kind: 'npm', name: `npm:${path.basename(path.dirname(o.lockfile))}`, sha256: lf.sha256, size: lf.size, license: o.license, source: o.source }, o.expectTree ?? null);   // R12.5C3c-B: árvore do LOCK antes do teste leve/ativação
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); failLog(o, e); throw e; }
  finally { fs.rmSync(scratch, { recursive: true, force: true }); tidyStaging(o.root); release(); }
}

/** Hash de árvore APROVADO no lock para a entrada do recibo (mesma versão do componente e plataforma), ou null. */
export function lockTreeFor(lock, e) {
  const c = lock?.data?.components?.[e.tool];
  return c && c.version === e.version ? (c.platforms?.[e.platform]?.npm?.installed_tree_sha256 ?? null) : null;
}

/**
 * Verificação somente leitura: recibo × disco × ponteiros. `deep:false` pula o rehash (doctor rápido).
 * R12.5C3c-B: com `lock`, a árvore também é comparada ao hash APROVADO no lock (fora do toolchain) — recibo e ponteiro
 * forjados junto com a árvore não bastam.
 */
export function verify(root, { deep = true, codesignVerifier, adhocInspect, lock = null } = {}) {
  if (!fs.existsSync(root)) return { status: 'EMPTY', root, entries: [], active: [], untracked: [], issues: [] };
  const receipt = readReceipt(root); const active = readActive(root);
  const issues = []; const entries = [];
  // bins de cada versão: registro de assinatura > ponteiro ativo > ponteiro "anterior"
  const versions = Object.values(active?.tools || {}).flatMap((t) => [t, t.previous].filter(Boolean));
  const binsFor = (e) => (e.codesign?.bins ? Object.fromEntries(Object.entries(e.codesign.bins).map(([b, v]) => [b, v.path])) : versions.find((v) => v.dir === e.dir)?.bins ?? {});
  for (const e of receipt.entries) {
    const abs = path.join(root, e.dir);
    if (!safeRelative(e.dir)) { issues.push({ code: 'UNSAFE_DIR', dir: e.dir }); continue; }
    if (!fs.existsSync(abs)) { entries.push({ tool: e.tool, version: e.version, status: 'MISSING' }); issues.push({ code: 'MISSING', dir: e.dir }); continue; }
    // R12.5B: instalação anterior à política (macOS, origem HTTPS, sem registro) é sinalizada mesmo na verificação rápida
    if (legacyUnverified(e)) issues.push({ code: 'SIGNATURE_UNVERIFIED', dir: e.dir, tool: e.tool, hint: `rode \`bold setup apply --components ${e.tool}\` para verificar e registrar a assinatura` });
    if (!deep) { entries.push({ tool: e.tool, version: e.version, status: 'PRESENT', receipt_status: e.status, ...(e.codesign ? { codesign: signatureLabel(e.codesign) } : {}) }); continue; }
    let h; try { h = treeHash(abs); } catch (err) { entries.push({ tool: e.tool, version: e.version, status: 'UNSAFE' }); issues.push({ code: err.code, dir: e.dir, message: err.message }); continue; }
    const ok = h.sha256 === e.tree_sha256;
    let st = ok ? 'PASS' : 'MODIFIED';
    if (ok && e.codesign) {
      const bins = binsFor(e);
      const v = verifyByPolicy(abs, bins, specFromRecord(e.codesign), { phase: 'final', verifier: codesignVerifier, inspect: adhocInspect });
      if (!v.ok) { st = 'SIGNATURE_FAIL'; issues.push({ code: 'SIGNATURE_FAIL', dir: e.dir, tool: e.tool, detail: `${v.code}: ${v.detail}` }); }
    } else if (ok && legacyUnverified(e)) st = 'SIGNATURE_UNVERIFIED';
    const want = lockTreeFor(lock, e);
    if (ok && want && h.sha256 !== want) { st = 'LOCK_TREE_MISMATCH'; issues.push({ code: 'LOCK_TREE_MISMATCH', dir: e.dir, tool: e.tool, detail: `árvore ${h.sha256.slice(0, 12)}… ≠ aprovada no lock ${want.slice(0, 12)}…` }); }
    entries.push({ tool: e.tool, version: e.version, status: st, receipt_status: e.status, ...(e.codesign ? { codesign: signatureLabel(e.codesign) } : {}) });
    if (!ok) issues.push({ code: 'MODIFIED', dir: e.dir });
  }
  const act = [];
  for (const [tool, t] of Object.entries(active?.tools || {})) {
    const inReceipt = receipt.entries.some((e) => e.dir === t.dir && e.tree_sha256 === t.tree_sha256);
    const bins = Object.entries(t.bins).map(([b, rel]) => ({ bin: b, ok: binOk(path.join(root, t.dir, rel)) }));
    act.push({ tool, version: t.version, in_receipt: inReceipt, bins });
    if (!inReceipt) issues.push({ code: 'ACTIVE_NOT_IN_RECEIPT', tool });
    for (const b of bins) if (!b.ok) issues.push({ code: 'BIN_MISSING', tool, bin: b.bin });
  }
  const known = new Set(receipt.entries.map((e) => e.dir.split('/')[0]));
  const untracked = fs.readdirSync(root).filter((n) => ![...MANAGED_ROOT_FILES, LOCK_NAME, STAGING, DOWNLOADS, 'logs', 'consent.json'].includes(n) && !known.has(n));
  return { status: issues.length ? 'FAIL' : receipt.entries.length ? 'PASS' : 'EMPTY', root, deep, entries, active: act, untracked, issues };
}

export function status(root) {
  if (!fs.existsSync(root)) return { exists: false, root, active: [], receipt_entries: 0, bytes: 0, locked: false };
  const receipt = readReceipt(root); const active = readActive(root);
  return {
    exists: true, root,
    platform: active?.platform ?? null,
    active: Object.entries(active?.tools || {}).map(([tool, t]) => ({ tool, version: t.version, dir: t.dir, previous: t.previous?.version ?? null, activated_at: t.activated_at ?? null, codesign: signatureLabel(t.codesign) })),
    receipt_entries: receipt.entries.length,
    bytes: receipt.entries.reduce((s, e) => s + (e.bytes || 0), 0),
    locked: fs.existsSync(path.join(root, LOCK_NAME)),
  };
}

/**
 * Rollback = troca de ponteiro para a versão anterior, depois de conferir a integridade E a assinatura dela (R12.5B:
 * a anterior é re-verificada contra o registro gravado; anterior sem registro instalada da internet no macOS só volta se
 * passar na spec do lock — e então o registro é gravado). Dry-run por padrão (a verificação roda também no dry-run).
 */
export function rollback({ root, tool, yes = false, home, now = () => new Date(), codesignVerifier, adhocInspect, lock }) {
  const active = fs.existsSync(root) ? readActive(root) : null;
  const t = active?.tools?.[tool];
  if (!t) return { ok: false, code: 'NOT_INSTALLED', tool, dry_run: !yes };
  if (!t.previous) return { ok: false, code: 'NO_PREVIOUS', tool, current: t.version, dry_run: !yes };
  const prevAbs = path.join(root, t.previous.dir);
  if (!safeRelative(t.previous.dir) || !fs.existsSync(prevAbs)) return { ok: false, code: 'PREVIOUS_MISSING', tool, previous: t.previous.version, dry_run: !yes };
  const h = treeHash(prevAbs);
  if (h.sha256 !== t.previous.tree_sha256) return { ok: false, code: 'PREVIOUS_MODIFIED', tool, previous: t.previous.version, dry_run: !yes };
  const prevEntry = readReceipt(root).entries.find((e) => e.dir === t.previous.dir) || null;
  const sig = checkInstalledSignature(root, t.previous, signaturePolicy(prevEntry, t.previous, active.platform, lock), codesignVerifier, now(), adhocInspect);
  if (!sig.ok) return { ok: false, code: sig.code === 'SIGNATURE_UNVERIFIED' ? 'PREVIOUS_SIGNATURE_UNVERIFIED' : 'PREVIOUS_CODESIGN_FAIL', tool, previous: t.previous.version, detail: `${sig.code}: ${sig.detail}`, dry_run: !yes };
  const plan = { tool, from: t.version, to: t.previous.version, ...(sig.record ? { codesign: signatureLabel(sig.record) } : {}) };
  if (!yes) return { ok: true, dry_run: true, plan, note: 'nada foi alterado; use --yes para aplicar' };
  const release = acquireLock(root, now());
  try {
    const cur = readActive(root); const c = cur.tools[tool];
    const at = now().toISOString();
    const prevRecord = sig.record ?? c.previous.codesign;
    cur.tools[tool] = { version: c.previous.version, dir: c.previous.dir, bins: c.previous.bins, ...(c.previous.paths ? { paths: c.previous.paths } : {}), tree_sha256: c.previous.tree_sha256, activated_at: at,
      ...(prevRecord ? { codesign: prevRecord } : {}), previous: versionRecord(c) };
    cur.updated_at = at;
    const receipt = readReceipt(root);
    for (const e of receipt.entries) {
      if (e.tool === tool) e.status = e.dir === c.previous.dir ? 'ACTIVE' : 'INACTIVE';
      if (e.dir === c.previous.dir && prevRecord && !e.codesign) e.codesign = prevRecord;
    }
    writeJsonAtomic(path.join(root, RECEIPT_FILE), receipt);
    writeJsonAtomic(path.join(root, ACTIVE_FILE), cur);
    if (cur.tools[tool].bins.node) writeTextAtomic(path.join(root, NODE_POINTER), `${path.join(root, cur.tools[tool].dir, cur.tools[tool].bins.node)}\n`);
    appendSetupLog(root, { event: 'rollback', tool, from: plan.from, to: plan.to, result: 'OK', ...(prevRecord ? { codesign_team: signatureLabel(prevRecord), migrated: !!prevRecord.migrated } : {}) }, { home, now: now() });
    return { ok: true, dry_run: false, plan };
  } finally { release(); }
}

/** O executável deste processo está dentro de algum diretório a remover? → dir relativo ou null (caminhos reais). */
function runningNodeIn(root, remove, execPath) {
  let exe; try { exe = fs.realpathSync(execPath); } catch { return null; }
  for (const r of remove) { let d; try { d = fs.realpathSync(path.join(root, r.dir)); } catch { continue; } if (exe.startsWith(d + path.sep)) return r.dir; }
  return null;
}

/**
 * Migração (R12.5B): grava o registro de assinatura numa versão JÁ instalada e verificada agora (nada é ativado nem
 * trocado; só active.json/receipt.json ganham `codesign`). Chamado por `setup apply` com o lock de execução obtido.
 */
export function recordSignature({ root, tool, dir, record, home, now = () => new Date() }) {
  const active = readActive(root); const receipt = readReceipt(root);
  const t = active?.tools?.[tool];
  if (!t || t.dir !== dir) throw new SetupError('NOT_INSTALLED', `${tool} não está ativo em ${dir}`);
  t.codesign = record;
  for (const e of receipt.entries) if (e.dir === dir) e.codesign = record;
  active.updated_at = now().toISOString();
  writeJsonAtomic(path.join(root, RECEIPT_FILE), receipt);
  writeJsonAtomic(path.join(root, ACTIVE_FILE), active);
  appendSetupLog(root, { event: 'signature-migrate', tool, dir, codesign_team: signatureLabel(record), result: 'OK' }, { home, now: now() });
  return { ok: true, tool, dir, team_id: record.team_id ?? null, codesign: signatureLabel(record) };
}

/**
 * Uninstall: DRY-RUN por padrão. Remove SÓ diretórios do recibo cujo hash ainda confere (modificados são preservados e
 * relatados), atualiza ponteiros/recibo e, se nada sobrar, remove os arquivos de controle do próprio setup.
 * Diretórios não rastreados, logs e arquivos alheios NUNCA são removidos.
 * R12.5B: remover o Node que ESTE processo está usando é permitido (o processo segue até o fim; no Unix o arquivo aberto
 * continua válido) e é relatado em `running_node` — a próxima execução usa BOLD_NODE_PATH/PATH.
 * @param {{root:string, tool?:string, yes?:boolean, home?:string, now?:()=>Date, execPath?:string}} o
 */
export function uninstall({ root, tool = null, yes = false, home, now = () => new Date(), execPath = process.execPath }) {
  if (!fs.existsSync(root)) return { ok: true, dry_run: !yes, code: 'NOTHING_INSTALLED', remove: [], keep: [] };
  const receipt = readReceipt(root);
  const targets = receipt.entries.filter((e) => !tool || e.tool === tool);
  if (!targets.length) return { ok: true, dry_run: !yes, code: 'NOTHING_INSTALLED', remove: [], keep: [] };
  const remove = []; const keep = [];
  for (const e of targets) {
    const abs = path.join(root, e.dir);
    if (!safeRelative(e.dir)) { keep.push({ dir: e.dir, reason: 'UNSAFE_DIR' }); continue; }
    if (!fs.existsSync(abs)) { remove.push({ dir: e.dir, tool: e.tool, version: e.version, state: 'ALREADY_MISSING' }); continue; }
    let h; try { h = treeHash(abs); } catch (err) { keep.push({ dir: e.dir, reason: err.code }); continue; }
    if (h.sha256 !== e.tree_sha256) keep.push({ dir: e.dir, reason: 'MODIFIED (preservado; confira manualmente)' });
    else remove.push({ dir: e.dir, tool: e.tool, version: e.version, bytes: e.bytes, state: 'MANAGED' });
  }
  const running = runningNodeIn(root, remove, execPath);
  if (!yes) return { ok: true, dry_run: true, remove, keep, running_node: running, note: 'nada foi removido; use --yes para aplicar' };
  const release = acquireLock(root, now());
  try {
    const active = readActive(root) || { schema: 'bold.toolchain-active/1', platform: receipt.entries[0]?.platform ?? 'darwin-arm64', tools: {} };
    for (const r of remove) {
      fs.rmSync(path.join(root, r.dir), { recursive: true, force: true });
      const parent = path.join(root, r.dir.split('/')[0]); try { fs.rmdirSync(parent); } catch { /* não vazio */ }
    }
    const removedDirs = new Set(remove.map((r) => r.dir));
    const entries = receipt.entries.filter((e) => !removedDirs.has(e.dir));
    for (const [t, a] of Object.entries(active.tools)) {
      if (removedDirs.has(a.dir)) delete active.tools[t];
      else if (a.previous && removedDirs.has(a.previous.dir)) a.previous = null;
    }
    const nodeGone = !active.tools.node;
    if (entries.length) {
      writeJsonAtomic(path.join(root, RECEIPT_FILE), { schema: 'bold.toolchain-receipt/1', entries });
      writeJsonAtomic(path.join(root, ACTIVE_FILE), { ...active, updated_at: now().toISOString() });
      if (nodeGone) fs.rmSync(path.join(root, NODE_POINTER), { force: true });
    } else {
      for (const f of MANAGED_ROOT_FILES) fs.rmSync(path.join(root, f), { force: true });
      for (const d of [STAGING, DOWNLOADS]) { try { fs.rmdirSync(path.join(root, d)); } catch { /* não vazio/ausente */ } }
    }
    appendSetupLog(root, { event: 'uninstall', tool: tool ?? '*', removed: remove.map((r) => r.dir), kept: keep.map((k) => k.dir), result: 'OK', ...(running ? { running_node: running } : {}) }, { home, now: now() });
    return { ok: true, dry_run: false, remove, keep, remaining_entries: entries.length, running_node: running };
  } finally { release(); }
}
