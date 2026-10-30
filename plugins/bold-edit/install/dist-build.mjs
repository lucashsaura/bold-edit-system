// DISTRIBUTION BUILD (R11). Reprodutível, a partir de um COMMIT (não do disco): lê a árvore git de `ref` e copia
// SOMENTE os arquivos INCLUDE do distribution-manifest.json para plugins/bold-edit/. A camada de marketplace
// (.claude-plugin/marketplace.json + README) é GERADA dos templates em distribution/. Sem timestamps → byte-idêntico.
// Fail-closed: arquivo versionado sem classe, EXCLUDE versionado, symlink ou submódulo → erro, nada é escrito.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDistribution, classifyPath } from './dist.mjs';
import { scanLeaks } from '../core/leak/scan.mjs';
import { testBlockEmpty } from '../setup/bootstrap-lock.mjs';
import { RETIRED_TEST_VARS } from '../setup/trust.mjs';
const RETIRED_RX = new RegExp(RETIRED_TEST_VARS.join('|'));   // variáveis do antigo modo de teste (R12.5 B3)

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_DIR = 'plugins/bold-edit';
export const LOCK = 'distribution-lock.json';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export class DistError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }

const git = (args, o = {}) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, ...o });

/** Árvore do commit: [{mode, type, sha, path}] (z-separado; caminhos com espaço/Unicode seguros). */
function tree(ref) {
  const out = git(['ls-tree', '-r', '-z', '--full-tree', ref]).toString('utf8');
  return out.split('\0').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); const [mode, type, s] = meta.split(' '); return { mode, type, sha: s, path: p }; });
}
function blob(objSha) { return git(['cat-file', 'blob', objSha]); }

export function plan(ref = 'HEAD') {
  const commit = git(['rev-parse', `${ref}^{commit}`]).toString().trim();
  const t = tree(commit); const dist = loadDistribution(ROOT);
  const problems = []; const include = []; const counts = { INCLUDE: 0, DEVELOPMENT_ONLY: 0, EXCLUDE: 0 };
  for (const e of t) {
    const c = classifyPath(e.path, dist);
    if (!c.class) problems.push({ path: e.path, problem: 'UNCLASSIFIED' });
    else counts[c.class]++;
    if (c.class === 'EXCLUDE') problems.push({ path: e.path, problem: 'EXCLUDE_TRACKED', rule: c.rule });
    if (c.class !== 'INCLUDE') continue;
    if (e.type !== 'blob' || e.mode === '120000') { problems.push({ path: e.path, problem: e.mode === '120000' ? 'SYMLINK' : `NOT_A_FILE:${e.type}` }); continue; }
    include.push({ ...e, rule: c.rule });
  }
  if (problems.length) throw new DistError('DIST_PLAN_INVALID', 'a árvore do commit não é distribuível (fail-closed)', problems);
  return { commit, include, counts, total: t.length };
}

/** Escreve a distribuição em `out` (que não pode existir, ou deve estar vazio). Retorna o lock. */
export function build(out, { ref = 'HEAD' } = {}) {
  const p = plan(ref);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new DistError('OUT_NOT_EMPTY', `diretório de saída não está vazio: ${out} (o build nunca sobrescreve)`);
  const files = [];
  const write = (rel, data, mode, origin, extra = {}) => {
    const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); fs.chmodSync(f, mode);
    files.push({ path: rel, size: data.length, sha256: sha(data), mode: mode === 0o755 ? '0755' : '0644', origin, ...extra });
  };
  for (const e of p.include) write(`${PLUGIN_DIR}/${e.path}`, blob(e.sha), e.mode === '100755' ? 0o755 : 0o644, `source:${e.path}`, { class: 'INCLUDE', rule: e.rule });
  const tplDir = 'distribution';
  const mkt = JSON.parse(git(['show', `${p.commit}:${tplDir}/marketplace.template.json`]).toString('utf8'));
  const pj = JSON.parse(blob(p.include.find((e) => e.path === '.claude-plugin/plugin.json').sha).toString('utf8'));
  const pkg = JSON.parse(blob(p.include.find((e) => e.path === 'package.json').sha).toString('utf8'));
  if (pj.version !== pkg.version) throw new DistError('VERSION_MISMATCH', `plugin.json ${pj.version} ≠ package.json ${pkg.version}`);
  if (mkt.plugins.some((x) => x.version)) throw new DistError('VERSION_IN_MARKETPLACE', 'a versão vive só no plugin.json (doc oficial: plugin.json vence e o validate avisa)');
  write('.claude-plugin/marketplace.json', Buffer.from(`${JSON.stringify(mkt, null, 2)}\n`), 0o644, `generated:${tplDir}/marketplace.template.json`);
  write('README.md', git(['show', `${p.commit}:${tplDir}/README.md`]), 0o644, `generated:${tplDir}/README.md`);
  // a licença também na raiz do repositório de distribuição (o mesmo arquivo do plugin, lido do commit)
  const lic = p.include.find((e) => e.path === 'LICENSE');
  if (lic) write('LICENSE', blob(lic.sha), 0o644, 'generated:LICENSE');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const content = sha(files.map((f) => `${f.path}\0${f.sha256}\0${f.mode}\n`).join(''));
  const lock = {
    schema: 'bold.distribution-lock/1', product: 'BOLD EDIT SYSTEM', version: pkg.version,
    marketplace: { name: mkt.name, plugin: mkt.plugins[0].name, plugin_dir: PLUGIN_DIR }, plugin: { name: pj.name, version: pj.version },
    source: { commit: p.commit, tracked_files: p.total, classes: p.counts, manifest: 'distribution-manifest.json' },
    totals: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) }, content_sha256: content,
    note: 'Inventário exato da distribuição (exceto este arquivo). Sem timestamps: o mesmo commit gera bytes idênticos.', files,
  };
  fs.writeFileSync(path.join(out, LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

const walk = (dir, rel = '') => fs.readdirSync(path.join(dir, rel)).sort().flatMap((n) => { const r = rel ? `${rel}/${n}` : n; const st = fs.lstatSync(path.join(dir, r)); return st.isDirectory() ? [`${r}/`, ...walk(dir, r)] : [r]; });

/** Auditoria do pacote CONSTRUÍDO (ou de um clone dele): lock ↔ disco, classes, proibidos, leak scan. */
/**
 * R12.5 B3 — política de confiança dos arquivos DISTRIBUÍDOS: [{path, rel, text}] → issues. Bootstraps com o bloco
 * BOLD-TEST vazio; nenhuma referência à injeção de teste fora de setup/trust.mjs; nenhuma variável do antigo modo de teste.
 */
export function trustPolicyIssues(files) {
  const issues = [];
  for (const f of files) {
    if (f.text === null || f.text === undefined) continue;
    if (/^bootstrap\/bootstrap\.(sh|ps1)$/.test(f.rel) && !testBlockEmpty(f.text)) issues.push({ code: 'TEST_HOOK_ENABLED', path: f.path, rule: 'bloco BOLD-TEST preenchido ou ausente' });
    if (f.rel === 'setup/trust.mjs') continue;
    // qualquer REFERÊNCIA (chamada, import com alias, reexportação) — não só a chamada literal
    if (/\binjectTestTrust\b/.test(f.text)) issues.push({ code: 'TEST_HOOK_CALL', path: f.path, rule: 'injeção de teste referenciada fora da suíte' });
    if (RETIRED_RX.test(f.text)) issues.push({ code: 'TEST_ENV_READ', path: f.path, rule: 'variável de modo de teste no código distribuído' });
  }
  return issues;
}

export function audit(dir, { localDenylists } = {}) {
  const issues = [];
  let lock; try { lock = JSON.parse(fs.readFileSync(path.join(dir, LOCK), 'utf8')); } catch { throw new DistError('LOCK_MISSING', `${LOCK} ausente ou ilegível`); }
  const entries = walk(dir);
  const filesOnDisk = entries.filter((e) => !e.endsWith('/') && e !== LOCK);
  const byPath = new Map(lock.files.map((f) => [f.path, f]));
  if (entries.includes('.git/') && !lock.allow_git) { /* clone de verificação: .git é do clone, não do pacote */ }
  for (const f of filesOnDisk.filter((x) => !x.startsWith('.git/'))) {
    const L = byPath.get(f);
    if (!L) { issues.push({ code: 'EXTRA_FILE', path: f }); continue; }
    const st = fs.lstatSync(path.join(dir, f));
    if (st.isSymbolicLink()) { issues.push({ code: 'SYMLINK', path: f }); continue; }
    const data = fs.readFileSync(path.join(dir, f));
    if (sha(data) !== L.sha256 || data.length !== L.size) issues.push({ code: 'HASH_MISMATCH', path: f });
    if (process.platform !== 'win32' && ((st.mode & 0o111) ? '0755' : '0644') !== L.mode) issues.push({ code: 'MODE_MISMATCH', path: f, expected: L.mode });
  }
  for (const L of lock.files) if (!fs.existsSync(path.join(dir, L.path))) issues.push({ code: 'MISSING_FILE', path: L.path });
  const dist = loadDistribution(ROOT);
  for (const L of lock.files.filter((x) => x.path.startsWith(`${PLUGIN_DIR}/`))) {
    const c = classifyPath(L.path.slice(PLUGIN_DIR.length + 1), dist).class;
    if (c !== 'INCLUDE') issues.push({ code: c ? `CLASS_${c}` : 'UNCLASSIFIED', path: L.path });
  }
  for (const L of lock.files.filter((x) => !x.path.startsWith(`${PLUGIN_DIR}/`))) if (!/^generated:/.test(L.origin)) issues.push({ code: 'UNEXPECTED_ROOT_FILE', path: L.path });
  const forbidden = [/(^|\/)\.git\//, /(^|\/)\.env(\.|$)/, /\.(log|jsonl)$/, /(^|\/)\.bold\//, /(^|\/)install-receipt\.json$/, /(^|\/)bold\.config\.json$/, /\.local\.denylist$/, /(^|\/)(renders|node_modules|__pycache__|logs|\.cache)\//];
  for (const L of lock.files) for (const rx of forbidden) if (rx.test(L.path)) issues.push({ code: 'FORBIDDEN_PATH', path: L.path, rule: String(rx) });
  const content = sha([...lock.files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path}\0${f.sha256}\0${f.mode}\n`).join(''));
  if (content !== lock.content_sha256) issues.push({ code: 'LOCK_CONTENT_HASH', expected: lock.content_sha256, actual: content });
  // R12.5 B3: nenhum caminho de teste que enfraqueça a confiança na distribuição — bloco BOLD-TEST vazio nos bootstraps,
  // nenhuma CHAMADA à injeção de teste fora de setup/trust.mjs, nenhuma leitura das antigas variáveis de modo de teste
  const shipped = lock.files.filter((x) => x.path.startsWith(`${PLUGIN_DIR}/`) && /\.(mjs|cjs|js|sh|ps1)$/.test(x.path));
  issues.push(...trustPolicyIssues(shipped.map((L) => { let text = null; try { text = fs.readFileSync(path.join(dir, L.path), 'utf8'); } catch { /* MISSING_FILE já acusado */ } return { path: L.path, rel: L.path.slice(PLUGIN_DIR.length + 1), text }; })));
  // leak scan: o plugin com a RAIZ DO PACOTE (vale a allowlist revisada por caminho relativo) + a camada de marketplace à parte
  const opt = localDenylists ? { localDenylists } : {};
  const leakPlugin = scanLeaks(path.join(dir, PLUGIN_DIR), opt); const leakRoot = scanLeaks(dir, opt);
  const leakFindings = [...leakPlugin.findings.map((x) => ({ ...x, file: `${PLUGIN_DIR}/${x.file}` })), ...leakRoot.findings.filter((x) => !x.file.startsWith(`${PLUGIN_DIR}/`) && !x.file.startsWith('.git/'))];
  const leak = { method: leakRoot.method, files_scanned: leakRoot.files_scanned, local_denylists_loaded: leakRoot.local_denylists_loaded, local_terms: leakRoot.local_terms };
  for (const x of leakFindings) issues.push({ code: 'LEAK', path: x.file, rule: x.rule });
  return { schema: 'bold.distribution-audit/1', status: issues.length ? 'FAIL' : 'PASS', dir, version: lock.version, files: lock.totals.files, bytes: lock.totals.bytes,
    content_sha256: lock.content_sha256, lock_sha256: sha(fs.readFileSync(path.join(dir, LOCK))), leak: { status: leakFindings.length ? 'FAIL' : 'PASS', method: leak.method, files_scanned: leak.files_scanned, local_denylists: leak.local_denylists_loaded, local_terms: leak.local_terms }, issues };
}

/** Compara dois builds byte a byte. */
export function compare(a, b) {
  const la = walk(a); const lb = walk(b); const diffs = [];
  if (JSON.stringify(la) !== JSON.stringify(lb)) diffs.push({ code: 'FILE_LIST_DIFFERS', only_a: la.filter((x) => !lb.includes(x)), only_b: lb.filter((x) => !la.includes(x)) });
  for (const f of la.filter((x) => !x.endsWith('/') && lb.includes(x))) if (!fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f)))) diffs.push({ code: 'CONTENT_DIFFERS', path: f });
  return { identical: !diffs.length, files: la.filter((x) => !x.endsWith('/')).length, diffs };
}
