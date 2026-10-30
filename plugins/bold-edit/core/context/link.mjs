// RELAÇÃO (R8, somente leitura): FILESYSTEM ASSET ↔ MEDIA POOL ITEM ↔ USO NA TIMELINE, por File Path normalizado
// (NFC + normalize; realpath quando o arquivo existe). Nome de arquivo NUNCA liga nada.
import fs from 'node:fs';
import path from 'node:path';

export function pathKey(p) {
  if (!p) return null;
  let r = path.normalize(String(p)).normalize('NFC');
  try { r = fs.realpathSync(r).normalize('NFC'); } catch { /* offline/inexistente: compara pelo caminho declarado */ }
  return r;
}

/** @param {object|null} index bold.asset-index/1 · @param {object} snap davinciSnapshot() */
export function linkDavinci(index, snap) {
  if (!snap?.available) return { available: false, reason: snap?.reason ?? 'NOT_REQUESTED', media_pool: [], usage: [], summary: null };
  const byKey = new Map((index?.assets ?? []).map((a) => [pathKey(a.path), a]));
  const pool = (snap.media ?? []).map((m) => {
    const k = pathKey(m.file_path); const a = k ? byKey.get(k) ?? null : null;
    return { name: m.name, bin: m.bin, type: m.type ?? null, unique_id: m.unique_id ?? null, file_path: m.file_path ?? null,
      exists_on_disk: m.file_path ? fs.existsSync(m.file_path) : null, asset_id: a?.id ?? null, asset_rel_path: a?.rel_path ?? null };
  });
  const usage = [];
  for (const tl of snap.inspected ?? []) {
    for (const kind of ['video', 'audio']) for (const tr of tl.tracks?.[kind] ?? []) for (const it of tr.items ?? []) {
      if (!it.file_path) continue;
      const a = byKey.get(pathKey(it.file_path)) ?? null;
      usage.push({ timeline: tl.name, track_type: kind, track: tr.index, item: it.name, file_path: it.file_path, asset_id: a?.id ?? null, asset_rel_path: a?.rel_path ?? null,
        tl_in: it.tl_in, tl_out: it.tl_out, tl_in_tc: it.tl_in_tc, tl_out_tc: it.tl_out_tc, media_pool_item: it.media_pool_item ?? null });
    }
  }
  const files = pool.filter((p) => p.file_path);
  return { available: true, media_pool: pool, usage,
    summary: { pool_items: pool.length, pool_with_file_path: files.length, pool_linked_to_index: files.filter((p) => p.asset_id).length,
      pool_file_missing_on_disk: files.filter((p) => p.exists_on_disk === false).length, timeline_uses: usage.length, uses_linked_to_index: usage.filter((u) => u.asset_id).length,
      index_assets_in_pool: index ? new Set(pool.map((p) => p.asset_id).filter(Boolean)).size : null } };
}
