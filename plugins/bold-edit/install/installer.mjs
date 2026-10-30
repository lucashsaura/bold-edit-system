#!/usr/bin/env node
// INSTALLER V1 (R10) — install · uninstall · update · status. Local, idempotente, sem rede, sem sudo.
// Cria SÓ: shim da CLI (bin dir do usuário), Skill pessoal e/ou de projeto (symlink ou cópia gerenciada),
// diretório de cache (se faltar) e o recibo. NUNCA: baixa/instala dependências, altera arquivos de shell/sistema,
// toca no DaVinci, apaga arquivos, sobrescreve Skill alheia (conflito → para; --replace-skill → backup, não apaga).
// O recibo lista o que o installer criou; uninstall remove só isso (dry-run é o padrão; --yes executa).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SKILL_NAME, SKILL_SOURCE, MARKER, COPY_MARKER, personalSkillDir, projectSkillDir, binDir, shimName, shimContent, receiptPath, stateDir, defaultSkillLink, claudeDir } from './paths.mjs';

const EXIT = { OK: 0, FAIL: 1, STOP: 3, UNAVAILABLE: 5, USAGE: 64 };
const SELF_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function parse(argv) {
  const o = { _: [], flags: new Set() }; const val = ['mode', 'project-dir', 'bin-dir', 'from', 'home'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && val.includes(a.slice(2).split('=')[0])) { const [k, ...r] = a.slice(2).split('='); o[k] = r.length ? r.join('=') : argv[++i]; }
    else if (a.startsWith('--')) o.flags.add(a.slice(2)); else o._.push(a);
  }
  return o;
}

export function context(o = {}, env = process.env, platform = process.platform) {
  const home = o.home ?? os.homedir();
  const e = { ...env, ...(o.home ? { HOME: o.home, USERPROFILE: o.home } : {}) };
  if (o.home) for (const k of ['CLAUDE_CONFIG_DIR', 'BOLD_BIN_DIR', 'BOLD_USER_CONFIG', 'BOLD_CACHE_DIR', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA']) delete e[k]; // --home = HOME isolado: nada vaza para o HOME real
  return { platform, env: e, home };
}

/** Valida um checkout do BOLD (o pacote em si). */
export function checkPackage(root) {
  const errs = [];
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { errs.push('package.json ilegível'); }
  if (pkg && pkg.name !== 'bold-edit-system') errs.push(`package.json name = ${pkg?.name} (esperado bold-edit-system)`);
  for (const f of ['bin/bold.mjs', `${SKILL_SOURCE}/SKILL.md`, 'core/product.mjs', 'config/defaults.json']) if (!fs.existsSync(path.join(root, f))) errs.push(`faltando: ${f}`);
  return { ok: !errs.length, errors: errs, version: pkg?.version ?? null, root };
}

const semver = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10) || 0);
export const cmpVersion = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };

const which = (cmd, env) => {
  for (const d of String(env.PATH ?? '').split(path.delimiter).filter(Boolean)) for (const ext of process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']) {
    const f = path.join(d, cmd + ext); try { if (fs.statSync(f).isFile()) return f; } catch { /* próximo */ }
  }
  return null;
};
const lexists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
/** Ancestral mais alto que ainda não existe (o que mkdir -p vai criar), ou null. */
const firstMissing = (dir) => { let top = null; let d = path.resolve(dir); while (!fs.existsSync(d)) { top = d; const up = path.dirname(d); if (up === d) break; d = up; } return top; };
/** Remove uma árvore de diretórios que só contém diretórios vazios (nunca arquivos). */
const removeEmptyTree = (d) => { try { if (!fs.lstatSync(d).isDirectory()) return false; for (const n of fs.readdirSync(d)) removeEmptyTree(path.join(d, n)); if (!fs.readdirSync(d).length) { fs.rmdirSync(d); return true; } } catch { /* ausente */ } return false; };
/** Remove diretórios vazios de `from` subindo até `stop` (inclusive) — só os que o installer criou. */
const pruneEmpty = (from, stop) => { if (!stop) return; let d = path.resolve(from); const s = path.resolve(stop); for (;;) { try { if (fs.readdirSync(d).length) return; fs.rmdirSync(d); } catch { return; } if (d === s) return; const up = path.dirname(d); if (up === d || !d.startsWith(s)) return; d = up; } };
const readReceipt = (ctx) => { try { return JSON.parse(fs.readFileSync(receiptPath(ctx), 'utf8')); } catch { return null; } };

/** Árvore → hash estável (para detectar cópia desatualizada). */
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { if (n === COPY_MARKER) continue; const f = path.join(d, n); const st = fs.statSync(f); if (st.isDirectory()) walk(f, `${rel}${n}/`); else h.update(`${rel}${n}\0`).update(fs.readFileSync(f)); } };
  walk(dir, ''); return h.digest('hex');
}

/** Estado de um alvo de Skill: absent | ours-link(ok|stale) | ours-copy(ok|stale) | foreign. */
function skillState(dest, srcDir, receipt) {
  if (!lexists(dest)) return { state: 'absent' };
  const st = fs.lstatSync(dest);
  const recorded = receipt?.artifacts?.find((a) => a.path === dest);
  if (st.isSymbolicLink()) {
    const t = fs.readlinkSync(dest); const abs = path.resolve(path.dirname(dest), t);
    if (abs === srcDir) return { state: 'ours-link', fresh: true };
    if (recorded?.type === 'symlink') return { state: 'ours-link', fresh: false, target: abs };
    return { state: 'foreign', detail: `symlink para outro destino (${abs})` };
  }
  if (st.isDirectory() && fs.existsSync(path.join(dest, COPY_MARKER))) return { state: 'ours-copy', fresh: treeHash(dest) === treeHash(srcDir) };
  return { state: 'foreign', detail: st.isDirectory() ? 'diretório existente que não foi criado pelo installer' : 'arquivo existente' };
}

/** PLANO (puro em relação ao disco: só lê). */
export function planInstall(ctx, boldHome, o = {}) {
  const actions = []; const receipt = readReceipt(ctx);
  const srcSkill = path.join(boldHome, SKILL_SOURCE);
  const link = o.copy ? 'copy' : defaultSkillLink(ctx.platform);
  if (!o.noCli) {
    const dir = o.binDir ?? binDir(ctx); const f = path.join(dir, shimName(ctx.platform)); const want = shimContent(ctx.platform, boldHome);
    if (!lexists(f)) actions.push({ kind: 'cli', path: f, action: 'create', type: 'file', content: want, dirCreate: !fs.existsSync(dir) ? dir : null, topCreate: firstMissing(dir) });
    else { const cur = fs.readFileSync(f, 'utf8'); if (cur === want) actions.push({ kind: 'cli', path: f, action: 'unchanged', type: 'file' }); else if (cur.includes(MARKER)) actions.push({ kind: 'cli', path: f, action: 'update', type: 'file', content: want }); else actions.push({ kind: 'cli', path: f, action: 'conflict', type: 'file', detail: 'já existe um "bold" que não é do installer: mantido (CLI não instalada)' }); }
  }
  const targets = [];
  if ((o.mode ?? 'personal') === 'personal') targets.push(['skill-personal', personalSkillDir(ctx)]);
  if (o.mode === 'project') { if (!o.projectDir || !fs.existsSync(o.projectDir)) throw Object.assign(new Error('--project-dir obrigatório e existente para --mode project'), { exit: EXIT.USAGE }); targets.push(['skill-project', projectSkillDir(path.resolve(o.projectDir), ctx.platform)]); }
  for (const [kind, dest] of targets) {
    const s = skillState(dest, srcSkill, receipt);
    const base = { kind, path: dest, type: link, source: srcSkill, parentCreate: !fs.existsSync(path.dirname(dest)) ? path.dirname(dest) : null, topCreate: firstMissing(path.dirname(dest)) };
    if (s.state === 'absent') actions.push({ ...base, action: 'create' });
    else if ((s.state === 'ours-link' && s.fresh && link === 'symlink') || (s.state === 'ours-copy' && s.fresh && link === 'copy')) actions.push({ ...base, action: 'unchanged' });
    else if (s.state === 'ours-link' || s.state === 'ours-copy') actions.push({ ...base, action: 'update', detail: s.state === 'ours-link' ? `relink (antes: ${s.target ?? 'outro modo'})` : 'cópia desatualizada' });
    else if (o.replaceSkill) actions.push({ ...base, action: 'replace', backup: `${dest}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`, detail: s.detail });
    else actions.push({ ...base, action: 'conflict', detail: `${s.detail}. Nada foi alterado; use --replace-skill para mover o existente para backup (nunca é apagado)` });
  }
  return { actions, receipt };
}

function copyTree(src, dest) { fs.cpSync(src, dest, { recursive: true, dereference: true, errorOnExist: true, force: false }); }

export function applyInstall(ctx, boldHome, plan, o) {
  const done = [];
  for (const a of plan.actions) {
    if (['unchanged', 'conflict'].includes(a.action)) { done.push(a); continue; }
    if (a.kind === 'cli') {
      if (a.dirCreate) fs.mkdirSync(a.dirCreate, { recursive: true });
      fs.writeFileSync(a.path, a.content, { mode: 0o755 }); done.push({ ...a, sha256: sha(a.content), createdDir: a.topCreate ?? null });
      continue;
    }
    if (a.parentCreate) fs.mkdirSync(a.parentCreate, { recursive: true });
    if (a.action === 'replace') fs.renameSync(a.path, a.backup); // nunca apaga: move para backup
    if (a.action === 'update') { const st = fs.lstatSync(a.path); if (st.isSymbolicLink()) fs.unlinkSync(a.path); else fs.rmSync(a.path, { recursive: true }); } // só artefato próprio (verificado no plano)
    if (a.type === 'symlink') fs.symlinkSync(a.source, a.path, 'dir');
    else { copyTree(a.source, a.path); fs.writeFileSync(path.join(a.path, COPY_MARKER), `${JSON.stringify({ marker: MARKER, source: a.source, tree_sha256: treeHash(a.source) }, null, 2)}\n`); }
    done.push({ ...a, createdDir: a.topCreate ?? null });
  }
  return done;
}

function cacheDir(ctx, boldHome) {
  const r = spawnSync(process.execPath, [path.join(boldHome, 'bin', 'bold.mjs'), 'config', '--json'], { encoding: 'utf8', env: ctx.env, cwd: ctx.home, timeout: 60000 });
  try { return JSON.parse(r.stdout).config.CACHE_DIR; } catch { return null; }
}

function writeReceipt(ctx, boldHome, version, mode, done, prev, extra = []) {
  const keep = (prev?.artifacts ?? []).filter((x) => !done.some((d) => d.path === x.path));
  const arts = [...keep, ...done.filter((d) => !['conflict'].includes(d.action) && (d.action !== 'unchanged' || (prev?.artifacts ?? []).some((x) => x.path === d.path))).map((d) => {
    const old = (prev?.artifacts ?? []).find((x) => x.path === d.path);
    if (d.action === 'unchanged' && old) return old;
    return { kind: d.kind, path: d.path, type: d.type, ...(d.source ? { source: d.source } : {}), ...(d.sha256 ? { sha256: d.sha256 } : {}), created_dirs: [d.createdDir].filter(Boolean), ...(d.backup ? { backup_of_previous: d.backup } : {}) };
  }), ...extra.filter((x) => !keep.some((k) => k.path === x.path))];
  const doc = { schema: 'bold.install-receipt/1', product_version: version, bold_home: boldHome, platform: ctx.platform, mode, installed_at: prev?.installed_at ?? new Date().toISOString(), artifacts: arts.sort((a, b) => a.path.localeCompare(b.path)) };
  const stTop = firstMissing(stateDir(ctx)); if (stTop) doc.state_dir_created = stTop; else if (prev?.state_dir_created) doc.state_dir_created = prev.state_dir_created;
  const same = prev && JSON.stringify({ ...prev, updated_at: undefined }) === JSON.stringify({ ...doc, updated_at: undefined });
  if (same) return { file: receiptPath(ctx), changed: false, doc: prev };
  doc.updated_at = new Date().toISOString();
  fs.mkdirSync(stateDir(ctx), { recursive: true });
  fs.writeFileSync(receiptPath(ctx), `${JSON.stringify(doc, null, 2)}\n`);
  return { file: receiptPath(ctx), changed: true, doc };
}

function prereqs(ctx) {
  const major = Number(process.versions.node.split('.')[0]);
  return { node: { version: process.versions.node, ok: major >= 20 }, optional: Object.fromEntries(['ffmpeg', 'ffprobe', 'python3', 'claude'].map((t) => [t, which(t, ctx.env)])) };
}

export function install(o, ctx, boldHome = SELF_HOME, log = () => {}) {
  const chk = checkPackage(boldHome); if (!chk.ok) return { exit: EXIT.FAIL, error: chk.errors };
  const pre = prereqs(ctx); if (!pre.node.ok) return { exit: EXIT.UNAVAILABLE, error: [`Node ${pre.node.version} < 20 (o installer não instala Node)`] };
  const plan = planInstall(ctx, boldHome, o);
  const conflicts = plan.actions.filter((a) => a.action === 'conflict' && a.kind !== 'cli');
  const out = { product_version: chk.version, bold_home: boldHome, platform: ctx.platform, platform_support: ctx.platform === 'darwin' ? 'SUPPORTED' : ctx.platform === 'win32' ? 'EXPERIMENTAL' : 'DEVELOPMENT_ONLY', prereqs: pre, claude_dir: claudeDir(ctx), dry_run: !!o.dryRun,
    actions: plan.actions.map(({ content, ...a }) => a) };
  if (conflicts.length) return { ...out, exit: EXIT.STOP, error: conflicts.map((c) => `${c.path}: ${c.detail}`) };
  if (o.dryRun) return { ...out, exit: EXIT.OK };
  const done = applyInstall(ctx, boldHome, plan, o);
  const extra = [];
  const cd = cacheDir(ctx, boldHome);
  if (cd && !fs.existsSync(cd)) { const top = firstMissing(cd); fs.mkdirSync(cd, { recursive: true }); extra.push({ kind: 'cache-dir', path: cd, type: 'dir', created_dirs: [top] }); out.actions.push({ kind: 'cache-dir', path: cd, action: 'create', type: 'dir' }); }
  else if (cd) out.actions.push({ kind: 'cache-dir', path: cd, action: 'unchanged', type: 'dir' });
  const rec = writeReceipt(ctx, boldHome, chk.version, o.mode ?? 'personal', done, plan.receipt, extra);
  out.receipt = { file: rec.file, changed: rec.changed };
  const shim = plan.actions.find((a) => a.kind === 'cli');
  out.path_hint = shim && shim.action !== 'conflict' && !String(ctx.env.PATH ?? '').split(path.delimiter).includes(path.dirname(shim.path)) ? `adicione ${path.dirname(shim.path)} ao PATH (o installer não altera arquivos de shell)` : null;
  if (!o.noDoctor) {
    const r = spawnSync(process.execPath, [path.join(boldHome, 'bin', 'bold.mjs'), 'doctor', '--json'], { encoding: 'utf8', env: ctx.env, cwd: ctx.home, timeout: 180000 });
    try { const j = JSON.parse(r.stdout); out.doctor = { status: j.status, summary: j.summary }; } catch { out.doctor = { status: 'UNKNOWN' }; }
  }
  return { ...out, exit: EXIT.OK };
}

export function uninstall(o, ctx) {
  const rec = readReceipt(ctx);
  if (!rec) return { exit: EXIT.OK, dry_run: !o.yes, actions: [], note: 'nenhuma instalação registrada (recibo ausente): nada a remover' };
  const actions = [];
  for (const a of rec.artifacts) {
    if (!lexists(a.path)) { actions.push({ ...a, action: 'already_absent' }); continue; }
    const st = fs.lstatSync(a.path); let ours = false; let why = '';
    if (a.type === 'symlink') ours = st.isSymbolicLink() && path.resolve(path.dirname(a.path), fs.readlinkSync(a.path)) === a.source, why = 'symlink não aponta mais para o pacote';
    else if (a.type === 'copy') ours = st.isDirectory() && fs.existsSync(path.join(a.path, COPY_MARKER)), why = 'cópia sem o marcador do installer';
    else if (a.type === 'file') ours = st.isFile() && fs.readFileSync(a.path, 'utf8').includes(MARKER), why = 'arquivo alterado (sem marcador)';
    else if (a.type === 'dir') { ours = st.isDirectory() && fs.readdirSync(a.path).length === 0; why = 'diretório não está vazio (conteúdo do usuário é preservado)'; }
    actions.push({ ...a, action: ours ? 'remove' : 'keep', ...(ours ? {} : { reason: why }) });
  }
  if (o.yes) {
    for (const a of actions.filter((x) => x.action === 'remove')) {
      if (a.type === 'symlink' || a.type === 'file') fs.unlinkSync(a.path); else if (a.type === 'copy') fs.rmSync(a.path, { recursive: true }); else if (a.type === 'dir') fs.rmdirSync(a.path);
      for (const d of a.created_dirs ?? []) pruneEmpty(path.dirname(a.path), d);
    }
    const kept = actions.filter((x) => x.action === 'keep');
    if (kept.length) fs.writeFileSync(receiptPath(ctx), `${JSON.stringify({ ...rec, artifacts: rec.artifacts.filter((x) => kept.some((k) => k.path === x.path)), updated_at: new Date().toISOString() }, null, 2)}\n`);
    else { fs.unlinkSync(receiptPath(ctx)); if (rec.state_dir_created) pruneEmpty(stateDir(ctx), rec.state_dir_created); }
    for (const d of [...rec.artifacts.flatMap((x) => x.created_dirs ?? []), rec.state_dir_created].filter(Boolean)) removeEmptyTree(d); // passada final: só diretórios VAZIOS criados pelo installer
  }
  return { exit: EXIT.OK, dry_run: !o.yes, receipt: receiptPath(ctx), actions, note: o.yes ? 'removido só o que o installer criou' : 'DRY-RUN: nada foi removido; rode com --yes para executar' };
}

export function update(o, ctx) {
  const rec = readReceipt(ctx);
  const from = o.from ? path.resolve(o.from) : rec?.bold_home ?? SELF_HOME;
  const chk = checkPackage(from); if (!chk.ok) return { exit: EXIT.FAIL, error: chk.errors };
  if (rec && cmpVersion(chk.version, rec.product_version) < 0 && !o.allowDowngrade) return { exit: EXIT.STOP, error: [`versão ${chk.version} < instalada ${rec.product_version} (use --allow-downgrade)`] };
  const r = install({ ...o, mode: o.mode ?? rec?.mode ?? 'personal' }, ctx, fs.realpathSync(from));
  return { ...r, update: { from_version: rec?.product_version ?? null, to_version: chk.version, from_home: rec?.bold_home ?? null, to_home: fs.realpathSync(from), user_config: 'preservada (nunca tocada)' } };
}

export function status(ctx) {
  const rec = readReceipt(ctx);
  return { exit: EXIT.OK, receipt: rec ? receiptPath(ctx) : null, installed: !!rec, product_version: rec?.product_version ?? null, bold_home: rec?.bold_home ?? null,
    artifacts: (rec?.artifacts ?? []).map((a) => ({ kind: a.kind, path: a.path, type: a.type, present: lexists(a.path) })), skill: SKILL_NAME };
}

function human(cmd, r) {
  const L = [`bold installer · ${cmd}${r.dry_run ? ' (DRY-RUN)' : ''} · exit ${r.exit}`];
  if (r.product_version) L.push(`  produto ${r.product_version} · BOLD_HOME ${r.bold_home ?? '—'} · ${r.platform ?? ''} ${r.platform_support ?? ''}`);
  for (const a of r.actions ?? []) L.push(`  ${String(a.action).padEnd(14)} ${String(a.kind).padEnd(15)} ${a.path}${a.detail ? `  (${a.detail})` : ''}${a.reason ? `  (${a.reason})` : ''}`);
  if (r.prereqs) L.push(`  Node ${r.prereqs.node.version} · opcionais: ${Object.entries(r.prereqs.optional).map(([k, v]) => `${k} ${v ? 'ok' : 'ausente'}`).join(' · ')}`);
  if (r.receipt) L.push(`  recibo: ${typeof r.receipt === 'string' ? r.receipt : r.receipt.file}`);
  if (r.doctor) L.push(`  doctor: ${r.doctor.status} ${r.doctor.summary ? JSON.stringify(r.doctor.summary) : ''}`);
  if (r.path_hint) L.push(`  ! ${r.path_hint}`);
  if (r.note) L.push(`  ${r.note}`);
  for (const e of r.error ?? []) L.push(`  ERRO: ${e}`);
  return `${L.join('\n')}\n`;
}

async function main(argv) {
  const a = parse(argv); const cmd = a._[0] ?? 'install';
  if (a.flags.has('help') || cmd === 'help') { process.stdout.write('uso: install.sh [install|uninstall|update|status] [--mode personal|project|none] [--project-dir D] [--bin-dir D] [--no-cli] [--copy] [--replace-skill] [--dry-run] [--yes] [--from CHECKOUT] [--allow-downgrade] [--no-doctor] [--json]\n'); return EXIT.OK; }
  const ctx = context({ home: a.home });
  const o = { mode: a.mode, projectDir: a['project-dir'], binDir: a['bin-dir'], noCli: a.flags.has('no-cli'), copy: a.flags.has('copy'), replaceSkill: a.flags.has('replace-skill'), dryRun: a.flags.has('dry-run'), yes: a.flags.has('yes'), from: a.from, allowDowngrade: a.flags.has('allow-downgrade'), noDoctor: a.flags.has('no-doctor') };
  if (o.mode && !['personal', 'project', 'none'].includes(o.mode)) { process.stderr.write('--mode personal|project|none\n'); return EXIT.USAGE; }
  let r;
  try {
    r = cmd === 'install' ? install(o, ctx) : cmd === 'uninstall' ? uninstall(o, ctx) : cmd === 'update' ? update(o, ctx) : cmd === 'status' ? status(ctx) : null;
  } catch (e) { r = { exit: e.exit ?? EXIT.FAIL, error: [e.message] }; }
  if (!r) { process.stderr.write(`comando desconhecido: ${cmd}\n`); return EXIT.USAGE; }
  process.stdout.write(a.flags.has('json') ? `${JSON.stringify(r, null, 2)}\n` : human(cmd, r));
  return r.exit;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
