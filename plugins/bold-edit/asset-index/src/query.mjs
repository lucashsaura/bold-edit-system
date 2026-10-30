// CONSULTAS (R8) sobre bold.asset-index/1: busca (texto + filtros) e duplicatas. Somente leitura; `--verify`
// lê o conteúdo COMPLETO só dos candidatos a duplicata (nunca de tudo). Nada é apagado, movido ou renomeado.
import fs from 'node:fs';
import path from 'node:path';
import { fold } from '../../transcript/src/text.mjs';
import { sha256File, AssetError } from './scan.mjs';
import { TYPES } from './classify.mjs';
import { parseFps } from '../../transcript/src/time.mjs';

const bool = (v) => (v === undefined || v === null ? null : v === true || v === 'true' || v === '1' || v === 'yes' ? true : v === false || v === 'false' || v === '0' || v === 'no' ? false : (() => { throw new AssetError('USAGE', `valor booleano inválido: ${v}`); })());

/** Filtros: text, type (lista), orientation, alpha, fps (tolerância 0,01 ou fração exata), ext, tag, codec, minDuration, maxDuration, limit. */
export function searchAssets(index, f = {}) {
  const types = f.type ? String(f.type).toUpperCase().split(',') : null;
  if (types) for (const t of types) if (!TYPES.includes(t)) throw new AssetError('USAGE', `--type inválido: ${t} (${TYPES.join('|')})`);
  if (f.orientation && !['horizontal', 'vertical', 'square'].includes(f.orientation)) throw new AssetError('USAGE', '--orientation horizontal|vertical|square');
  const alpha = bool(f.alpha); const fps = f.fps != null ? parseFps(f.fps) : null;
  const terms = f.text ? fold(f.text).split(/\s+/).filter(Boolean) : [];
  const exts = f.ext ? String(f.ext).toLowerCase().replace(/\./g, '').split(',') : null;
  const hits = index.assets.filter((a) => {
    if (types && !types.includes(a.type)) return false;
    if (f.orientation && a.orientation !== f.orientation) return false;
    if (alpha !== null && a.alpha !== alpha) return false;
    if (fps && !(a.fps === fps.exact || (a.fps_float !== null && Math.abs(a.fps_float - fps.num / fps.den) < 0.01))) return false;
    if (exts && !exts.includes(a.ext)) return false;
    if (f.tag && !a.tags.includes(f.tag)) return false;
    if (f.codec && a.codec !== f.codec) return false;
    if (f.minDuration != null && !(a.duration >= Number(f.minDuration))) return false;
    if (f.maxDuration != null && !(a.duration <= Number(f.maxDuration))) return false;
    if (terms.length) { const hay = fold(`${a.rel_path} ${a.font_family ?? ''} ${a.tags.join(' ')}`); if (!terms.every((t) => hay.includes(t))) return false; }
    return true;
  });
  const limit = f.limit ? Number(f.limit) : null;
  return { schema: 'bold.asset-search/1', root: index.root.path, filters: { ...f, alpha }, count: hits.length, assets: limit ? hits.slice(0, limit) : hits };
}

/**
 * Duplicatas:
 *  - content: mesmo tamanho + mesma impressão (sha256 completo → CONFIRMED; só quick → CANDIDATE). verify=true lê
 *    o SHA-256 completo dos candidatos (somente leitura) e confirma ou separa.
 *  - same_name: MESMO nome em caminhos diferentes (nome não é identidade) com content_equal true/false/null.
 */
export function findDuplicates(index, { verify = false } = {}) {
  const groups = new Map();
  for (const a of index.assets) {
    const k = a.fingerprint.sha256 ? `sha:${a.fingerprint.sha256}` : a.fingerprint.quick ? `q:${a.size}:${a.fingerprint.quick}` : null;
    if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a);
  }
  const content = []; let verifiedReads = 0;
  for (const [k, as] of groups) {
    if (as.length < 2) continue;
    if (k.startsWith('sha:')) { content.push({ status: 'CONFIRMED', method: 'sha256', size: as[0].size, sha256: k.slice(4), paths: as.map((a) => a.rel_path) }); continue; }
    if (!verify) { content.push({ status: 'CANDIDATE', method: 'size+quick_fingerprint', size: as[0].size, paths: as.map((a) => a.rel_path) }); continue; }
    const by = new Map();
    for (const a of as) { if (!fs.existsSync(a.path)) continue; const h = sha256File(a.path); verifiedReads++; if (!by.has(h)) by.set(h, []); by.get(h).push(a.rel_path); }
    for (const [h, ps] of by) if (ps.length > 1) content.push({ status: 'CONFIRMED', method: 'sha256 (verify)', size: as[0].size, sha256: h, paths: ps });
  }
  const names = new Map();
  for (const a of index.assets) { const k = fold(a.name); if (!names.has(k)) names.set(k, []); names.get(k).push(a); }
  const sameName = [];
  for (const as of names.values()) {
    if (as.length < 2) continue;
    const hs = as.map((a) => a.fingerprint.sha256); const qs = as.map((a) => `${a.size}:${a.fingerprint.quick}`);
    const equal = hs.every(Boolean) ? hs.every((h) => h === hs[0]) : as.every((a) => a.fingerprint.quick) && !qs.every((q) => q === qs[0]) ? false : null;
    sameName.push({ name: as[0].name, content_equal: equal, paths: as.map((a) => a.rel_path), ids: as.map((a) => a.id) });
  }
  const ord = (x, y) => (x.paths[0] < y.paths[0] ? -1 : 1);
  return { schema: 'bold.asset-duplicates/1', root: index.root.path, verify, verified_full_reads: verifiedReads, content: content.sort(ord), same_name: sameName.sort(ord),
    note: 'somente leitura: nada é apagado, movido ou renomeado. O nome de arquivo NÃO é identidade.' };
}

export function findAsset(index, file) {
  const abs = path.resolve(file).normalize('NFC');
  let real = abs; try { real = fs.realpathSync(file).normalize('NFC'); } catch { /* removido */ }
  return index.assets.find((a) => a.path === abs || a.path === real) ?? null;
}
