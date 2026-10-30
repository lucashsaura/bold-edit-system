// SCAN (R8) → bold.asset-index/1. SOMENTE LEITURA na árvore escaneada (abre arquivos só com 'r'; nunca cria,
// move, renomeia, relinka ou toca mtime). Identidade = caminho canônico NFC relativo à raiz (NOME NÃO É IDENTIDADE).
// Hash: metadados sempre; conteúdo parcial (início+fim) em `auto`; SHA-256 completo só em arquivos pequenos ou sob
// demanda (`full`, `duplicates --verify`). Incremental: reaproveita registro se tamanho + mtime + inode não mudaram.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classify, orientation, CLASSIFIER_VERSION, SKIP_DIRS, SKIP_FILES } from './classify.mjs';
import { imageHeader, readHead, fontInfo } from './headers.mjs';
import { probeMediaAsync } from './probe.mjs';

export const SCHEMA = 'bold.asset-index/1';
export const ENGINE = 'bold-asset-index@1';
export const HASH_POLICIES = ['auto', 'none', 'full'];
export const QUICK_WINDOW = 65536;
export const FULL_HASH_AUTO_MAX = 1 << 20; // 1 MiB

export class AssetError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }

export const nfcPath = (p) => p.normalize('NFC');
const posix = (p) => p.split(path.sep).join('/');
const idFor = (rel) => `a_${crypto.createHash('sha256').update(nfcPath(rel)).digest('hex').slice(0, 16)}`;

export function sha256File(file) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(8 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** Impressão PARCIAL do conteúdo: sha256(tamanho ‖ primeiros 64 KiB ‖ últimos 64 KiB). Igual ≠ prova de igualdade. */
export function quickFingerprint(file, size) {
  const h = crypto.createHash('sha256'); h.update(`${size}:`);
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.min(size, QUICK_WINDOW); const a = Buffer.alloc(n); fs.readSync(fd, a, 0, n, 0); h.update(a);
    if (size > QUICK_WINDOW) { const m = Math.min(QUICK_WINDOW, size - QUICK_WINDOW); const b = Buffer.alloc(m); fs.readSync(fd, b, 0, m, size - m); h.update(b); }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** Percorre a árvore (ordem determinística, sem seguir symlinks de diretório). */
export function walk(rootAbs, { includeHidden = false } = {}) {
  const files = []; const skipped = [];
  const rec = (dirAbs, relDir) => {
    let ents;
    try { ents = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { skipped.push({ rel_path: relDir || '.', reason: `unreadable_dir:${e.code}` }); return; }
    ents.sort((a, b) => (nfcPath(a.name) < nfcPath(b.name) ? -1 : nfcPath(a.name) > nfcPath(b.name) ? 1 : 0));
    for (const e of ents) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name; const abs = path.join(dirAbs, e.name);
      const hidden = e.name.startsWith('.');
      if (e.isDirectory()) { if (SKIP_DIRS.has(e.name) || (hidden && !includeHidden)) skipped.push({ rel_path: nfcPath(rel), reason: 'skipped_dir' }); else rec(abs, rel); continue; }
      if (e.isSymbolicLink()) {
        let st; try { st = fs.statSync(abs); } catch { skipped.push({ rel_path: nfcPath(rel), reason: 'broken_symlink' }); continue; }
        if (st.isDirectory()) { skipped.push({ rel_path: nfcPath(rel), reason: 'symlink_dir_not_followed' }); continue; }
        if (st.isFile()) files.push({ abs, rel, symlink: true }); continue;
      }
      if (!e.isFile()) { skipped.push({ rel_path: nfcPath(rel), reason: 'not_regular_file' }); continue; }
      if (SKIP_FILES.has(e.name) || e.name.startsWith('._') || (hidden && !includeHidden)) { skipped.push({ rel_path: nfcPath(rel), reason: 'system_or_hidden_file' }); continue; }
      files.push({ abs, rel, symlink: false });
    }
  };
  rec(rootAbs, '');
  return { files, skipped };
}

function motionManifest(abs, name) {
  const man = path.join(path.dirname(abs), `${name.replace(/\.[^.]+$/, '')}.delivery.json`);
  if (!fs.existsSync(man)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(man, 'utf8'));
    if (m?.schema !== 'bold.delivery.manifest/1') return null;
    if (m.output && path.basename(String(m.output)) !== name) return null;
    return { manifest: path.basename(man), profile: m.profile?.id ?? null, frames: m.actual_frames ?? null, fps: m.fps ?? null, alpha_mode: m.alpha?.mode ?? null, output_sha256: m.output_sha256 ?? null };
  } catch { return null; }
}

/** Metadados de conteúdo (sem hash). ffprobe = null → mídia fica com probe UNAVAILABLE (honesto). */
async function describe(f, c, { ffprobe, probe }) {
  const r = { media: null, image: null, font: null, probe: { status: 'NOT_APPLICABLE', tool: null } };
  if (c.type === 'IMAGE') {
    try { const h = imageHeader(readHead(f.abs)); if (h) { r.image = { ...h, source: 'header' }; r.probe = { status: 'OK', tool: 'header' }; } } catch (e) { r.probe = { status: 'FAILED', tool: 'header', error: e.code ?? e.message }; }
  }
  if (c.type === 'FONT') { const fi = fontInfo(f.abs); r.font = fi; r.probe = { status: fi.parse === 'OK' ? 'OK' : 'PARTIAL', tool: 'sfnt', ...(fi.parse === 'OK' ? {} : { error: fi.parse }) }; }
  const wantsProbe = c.type === 'VIDEO' || c.type === 'AUDIO' || (c.type === 'IMAGE' && !r.image);
  if (wantsProbe) {
    if (!probe) r.probe = { status: 'SKIPPED', tool: null };
    else if (!ffprobe) r.probe = { status: 'UNAVAILABLE', tool: 'ffprobe' };
    else {
      const p = await probeMediaAsync(ffprobe, f.abs);
      if (p.status !== 'OK') r.probe = { status: 'FAILED', tool: 'ffprobe', error: p.error };
      else if (c.type === 'IMAGE') { const v = p.media.video; r.image = v ? { format: p.media.container, width: v.width, height: v.height, alpha: v.alpha, alpha_source: v.alpha_source, bit_depth: v.bit_depth, source: 'ffprobe' } : null; r.probe = { status: v ? 'OK' : 'FAILED', tool: 'ffprobe', ...(v ? {} : { error: 'sem stream de imagem' }) }; }
      else { r.media = p.media; r.probe = { status: 'OK', tool: 'ffprobe' }; }
    }
  }
  return r;
}


function record(f, st, c, d, hashes, rootAbs) {
  const rel = nfcPath(posix(f.rel)); const name = nfcPath(path.basename(f.rel));
  let type = c.type; const tags = [...c.tags];
  const v = d.media?.video && !d.media.video.still ? d.media.video : null;
  if (type === 'VIDEO' && d.media && !v && d.media.audio.length) { type = 'AUDIO'; tags.push('audio_only_container'); }
  const mm = type === 'VIDEO' ? motionManifest(f.abs, path.basename(f.abs)) : null;
  if (mm) { type = 'MOTION_MASTER'; tags.push('bold_delivery'); mm.verified = hashes.sha256 && mm.output_sha256 ? hashes.sha256 === mm.output_sha256 : null; }
  if (name.endsWith('.delivery.json')) tags.push('bold_delivery_manifest');
  const img = d.image; const w = v?.display_width ?? img?.width ?? null; const h = v?.display_height ?? img?.height ?? null;
  if (v?.alpha) tags.push('alpha_video');
  if (f.symlink) tags.push('symlink');
  const audio = d.media?.audio ?? [];
  return {
    id: idFor(rel), path: nfcPath(path.join(rootAbs, f.rel)), rel_path: rel, name, ext: c.ext, type, tags: [...new Set(tags)].sort(),
    size: st.size, mtime: new Date(st.mtimeMs).toISOString(), mtime_ms: st.mtimeMs, ino: st.ino,
    fingerprint: { meta: crypto.createHash('sha1').update(`${st.size}:${st.mtimeMs}:${st.ino}`).digest('hex').slice(0, 16), quick: hashes.quick, sha256: hashes.sha256 },
    width: w, height: h, orientation: orientation(w, h),
    alpha: v ? v.alpha : img ? img.alpha : null, alpha_source: v ? v.alpha_source : img ? img.alpha_source : null,
    duration: d.media?.duration ?? null, fps: v?.fps ?? null, fps_float: v?.fps_float ?? null, codec: v?.codec ?? audio[0]?.codec ?? null, pix_fmt: v?.pix_fmt ?? null,
    sample_rate: audio[0]?.sample_rate ?? null, channels: audio[0]?.channels ?? null, audio_streams: audio.length,
    font_family: d.font?.faces?.[0]?.family ?? null,
    dates: { mtime: new Date(st.mtimeMs).toISOString(), birthtime: st.birthtimeMs ? new Date(st.birthtimeMs).toISOString() : null, creation_time: d.media?.creation_time ?? null, creation_time_source: d.media?.creation_time ? 'container_tag' : null },
    media: d.media, image: d.image, font: d.font, motion_master: mm, probe: d.probe,
    sources: { type: mm ? 'extension+delivery_manifest' : d.media && type === 'AUDIO' && c.type === 'VIDEO' ? 'extension+ffprobe' : 'extension', identity: 'canonical_path_nfc', dates: 'filesystem', metadata: d.probe.tool },
  };
}

function hashesFor(f, size, policy) {
  if (policy === 'none') return { quick: null, sha256: null };
  const full = policy === 'full' || size <= FULL_HASH_AUTO_MAX;
  return { quick: quickFingerprint(f.abs, size), sha256: full ? sha256File(f.abs) : null };
}

/**
 * @param {{root:string, previous?:object|null, hash?:'auto'|'none'|'full', ffprobe?:string|null, probe?:boolean, includeHidden?:boolean, now?:Date, concurrency?:number}} o
 */
export async function scanAssets(o) {
  const hash = o.hash ?? 'auto';
  if (!HASH_POLICIES.includes(hash)) throw new AssetError('USAGE', `--hash ${HASH_POLICIES.join('|')}`);
  if (!fs.existsSync(o.root) || !fs.statSync(o.root).isDirectory()) throw new AssetError('ROOT_INVALID', 'raiz do scan não existe ou não é diretório');
  const rootAbs = nfcPath(fs.realpathSync(o.root));
  const prev = o.previous && o.previous.schema === SCHEMA && o.previous.root?.path === rootAbs && o.previous.classifier_version === CLASSIFIER_VERSION && o.previous.hash_policy === hash ? o.previous : null;
  const prevBy = new Map((prev?.assets ?? []).map((a) => [a.rel_path, a]));
  const { files, skipped } = walk(rootAbs, { includeHidden: !!o.includeHidden });
  const keys = new Map(); for (const f of files) { const k = nfcPath(posix(f.rel)); keys.set(k, (keys.get(k) ?? 0) + 1); }
  const stats = { files: 0, bytes: 0, reused: 0, read: 0, errors: 0 }; const changes = { added: [], changed: [], removed: [] };
  const results = new Array(files.length); let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++; const f = files[i]; const rel = nfcPath(posix(f.rel));
      let st; try { st = fs.statSync(f.abs); } catch (e) { skipped.push({ rel_path: rel, reason: `stat_failed:${e.code}` }); stats.errors++; continue; }
      const old = prevBy.get(rel);
      const same = old && old.size === st.size && old.mtime_ms === st.mtimeMs && old.ino === st.ino && !(old.probe?.status === 'UNAVAILABLE' && o.ffprobe);
      if (same) { results[i] = old; stats.reused++; continue; }
      try {
        const c = classify(path.basename(f.abs));
        const d = await describe(f, c, { ffprobe: o.ffprobe ?? null, probe: o.probe !== false });
        results[i] = record(f, st, c, d, hashesFor(f, st.size, hash), rootAbs); stats.read++;
        if (prev) (old ? changes.changed : changes.added).push(rel);
      } catch (e) { skipped.push({ rel_path: rel, reason: `unreadable:${e.code ?? e.message}` }); stats.errors++; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, 16)) }, worker));
  const assets = results.filter(Boolean);
  for (const a of assets) if ((keys.get(a.rel_path) ?? 0) > 1) a.identity_collision = true; // nomes NFC≠NFD coexistindo (FS sensível à forma)
  const seen = new Set(assets.map((a) => a.rel_path));
  if (prev) for (const a of prev.assets) if (!seen.has(a.rel_path)) changes.removed.push(a.rel_path);
  stats.files = assets.length; stats.bytes = assets.reduce((n, a) => n + a.size, 0);
  const byType = {}; for (const a of assets) byType[a.type] = (byType[a.type] ?? 0) + 1;
  return {
    schema: SCHEMA, engine: ENGINE, classifier_version: CLASSIFIER_VERSION, generated_at: (o.now ?? new Date()).toISOString(),
    root: { path: rootAbs, name: path.basename(rootAbs) }, hash_policy: hash,
    hash_rules: { meta: 'sha1(size:mtime_ms:ino) — sempre', quick: `sha256(size ‖ ${QUICK_WINDOW} B iniciais ‖ ${QUICK_WINDOW} B finais) — auto/full`, sha256: hash === 'full' ? 'todos' : hash === 'auto' ? `arquivos ≤ ${FULL_HASH_AUTO_MAX} B` : 'nenhum' },
    probe: { tool: o.ffprobe ? 'ffprobe' : null, available: !!o.ffprobe, enabled: o.probe !== false },
    incremental: { previous_used: !!prev, previous_generated_at: prev?.generated_at ?? null },
    stats: { ...stats, by_type: Object.fromEntries(Object.entries(byType).sort()) }, changes: prev ? { added: changes.added.sort(), changed: changes.changed.sort(), removed: changes.removed.sort() } : null,
    assets, skipped: skipped.sort((a, b) => (a.rel_path < b.rel_path ? -1 : 1)),
  };
}

/** Um arquivo avulso (sem índice, sem gravar nada): mesmo registro que o scan produziria com a pasta dele como raiz. */
export async function inspectFile(file, o = {}) {
  const abs = fs.realpathSync(file); const rootAbs = nfcPath(path.dirname(abs)); const f = { abs, rel: path.basename(abs), symlink: false };
  const st = fs.statSync(abs); const c = classify(path.basename(abs));
  const d = await describe(f, c, { ffprobe: o.ffprobe ?? null, probe: o.probe !== false });
  return record(f, st, c, d, hashesFor(f, st.size, o.hash ?? 'auto'), rootAbs);
}
