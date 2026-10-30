// PROJECT CONTEXT (R8) → bold.project-context/1. Junta TRANSCRIPT + ASSET INDEX + DAVINCI (somente leitura) num
// retrato DESCRITIVO e derivado (cache reconstruível). Responde "o que existe e o que está acontecendo?" — nunca
// "o que fazer" (R9). Cada componente é opcional; ausência é declarada, não inventada.
import crypto from 'node:crypto';
import { linkDavinci } from './link.mjs';
import { searchAssets, findDuplicates } from '../../asset-index/src/query.mjs';
import { search } from '../../transcript/src/search.mjs';
import { summarize } from '../../transcript/src/normalize.mjs';
import { fold } from '../../transcript/src/text.mjs';

export const SCHEMA = 'bold.project-context/1';
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

function slimTimeline(tl) {
  const count = (k) => (tl.tracks?.[k] ?? []).reduce((n, t) => n + (t.items?.length ?? 0), 0);
  return { name: tl.name, unique_id: tl.unique_id ?? null, fps: tl.fps_exact ?? null, fps_float: tl.fps ?? null, drop_frame: tl.drop_frame ?? null, start_frame: tl.start_frame ?? null, start_tc: tl.start_tc ?? null,
    duration_frames: tl.duration_frames ?? null, resolution: tl.resolution ?? null,
    tracks: { video: (tl.tracks?.video ?? []).length, audio: (tl.tracks?.audio ?? []).length, subtitle: (tl.tracks?.subtitle ?? []).length },
    items: { video: count('video'), audio: count('audio'), subtitle: count('subtitle') }, markers: (tl.markers ?? []).map((m) => ({ tl_frame: m.tl_frame, tc: m.tc, color: m.color, name: m.name, note: m.note })) };
}

/**
 * @param {{index?:object|null, indexFile?:string|null, transcripts?:Array<{doc:object, annotations?:object|null, file?:string|null}>, davinci?:object|null, targetTimeline?:string|null, now?:Date}} o
 */
export function buildContext(o) {
  const dv = o.davinci ?? { available: false, reason: 'NOT_REQUESTED' };
  const target = o.targetTimeline ?? dv.current_timeline ?? null;
  if (o.targetTimeline && dv.available && dv.timelines && !dv.timelines.includes(o.targetTimeline)) throw Object.assign(new Error(`timeline alvo não existe: ${o.targetTimeline}`), { code: 'TIMELINE_NOT_FOUND' });
  const transcripts = (o.transcripts ?? []).map((t, i) => ({ id: `t${i + 1}`, file: t.file ?? null, sha256: sha(t.doc), timeline: t.doc.source.davinci?.timeline ?? null,
    summary: summarize(t.doc), doc: t.doc, annotations: t.annotations ?? null }));
  const links = linkDavinci(o.index ?? null, dv);
  return {
    schema: SCHEMA, generated_at: (o.now ?? new Date()).toISOString(), read_only: true,
    nature: 'DESCRITIVO (R8): o que existe e o que está acontecendo. Nenhuma decisão editorial (R9).',
    components: {
      asset_index: o.index ? { file: o.indexFile ?? null, root: o.index.root.path, generated_at: o.index.generated_at, stats: o.index.stats } : null,
      transcripts: transcripts.map((t) => ({ id: t.id, file: t.file, sha256: t.sha256, timeline: t.timeline, format: t.summary.format, segments: t.summary.segments, granularity: t.summary.granularity, annotations: t.annotations ? t.annotations.counts : null })),
      davinci: dv.available ? { available: true, product: dv.status?.product ?? null, version: dv.status?.version ?? null, page: dv.status?.page ?? null, project: dv.status?.project ?? null,
        timelines: dv.timelines ?? [], current_timeline: dv.current_timeline ?? null, target_timeline: target, inspected: (dv.inspected ?? []).map(slimTimeline) } : { available: false, reason: dv.reason ?? null, target_timeline: o.targetTimeline ?? null },
    },
    assets: o.index?.assets ?? [], asset_root: o.index?.root?.path ?? null,
    transcripts: transcripts.map(({ summary: _s, ...t }) => t),
    relations: { media_pool: links.media_pool, asset_usage: links.usage, summary: links.summary,
      transcript_timeline: transcripts.filter((t) => t.timeline).map((t) => ({ transcript: t.id, timeline: t.timeline })) },
  };
}

export const QUERIES = ['summary', 'timelines', 'speech', 'mentions', 'candidates', 'assets', 'usage', 'duplicates'];

/** Consultas de leitura sobre o contexto. `usage` por caminho; por NOME devolve TODOS os homônimos (nunca escolhe). */
export function queryContext(ctx, what, q = {}) {
  const tr = q.transcript ? ctx.transcripts.filter((t) => t.id === q.transcript || t.timeline === q.transcript) : q.timeline ? ctx.transcripts.filter((t) => t.timeline === q.timeline) : ctx.transcripts;
  if (what === 'summary') return { components: ctx.components, relations: ctx.relations.summary, assets: ctx.assets.length, transcripts: ctx.transcripts.length };
  if (what === 'timelines') return ctx.components.davinci;
  if (what === 'speech' || what === 'mentions') {
    if (what === 'mentions' && !q.text) throw Object.assign(new Error('mentions exige o termo'), { code: 'USAGE' });
    return { hits: tr.flatMap((t) => search(t.doc, what === 'mentions' ? q.text : '', { from: q.from ?? null, to: q.to ?? null, speaker: q.speaker ?? null }).hits.map((h) => ({ ...h, transcript: t.id, transcript_name: h.transcript, timeline: t.timeline }))) };
  }
  if (what === 'candidates') {
    const types = q.type ? String(q.type).split(',').map((s) => ({ cta: 'cta_candidate', offer: 'offer_mention', hook: 'hook_candidate', product: 'product_mention', emphasis: 'emphasis_candidate' }[s] ?? s)) : null;
    return { nature: 'CANDIDATOS descritivos (R8) — não são decisões', hits: tr.flatMap((t) => (t.annotations?.annotations ?? []).filter((a) => !types || types.includes(a.type)).map((a) => ({ transcript: t.id, timeline: t.timeline, ...a }))) };
  }
  if (what === 'assets') return searchAssets({ root: { path: ctx.asset_root }, assets: ctx.assets }, q);
  if (what === 'duplicates') return findDuplicates({ root: { path: ctx.asset_root }, assets: ctx.assets }, { verify: false });
  if (what === 'usage') {
    if (!q.text) throw Object.assign(new Error('usage exige caminho ou nome'), { code: 'USAGE' });
    const t = String(q.text); const isPath = t.includes('/') || t.includes('\\');
    const assets = ctx.assets.filter((a) => (isPath ? a.path === t.normalize('NFC') || a.rel_path === t.normalize('NFC') : fold(a.name) === fold(t)));
    const ids = new Set(assets.map((a) => a.id));
    const uses = ctx.relations.asset_usage.filter((u) => ids.has(u.asset_id) || (isPath && u.file_path?.normalize('NFC') === t.normalize('NFC')));
    return { query: t, matched_by: isPath ? 'path' : 'name (TODOS os homônimos; nome não é identidade)', assets: assets.map((a) => ({ id: a.id, rel_path: a.rel_path, path: a.path })),
      ambiguous: !isPath && assets.length > 1, media_pool: ctx.relations.media_pool.filter((p) => ids.has(p.asset_id)), usage: uses };
  }
  throw Object.assign(new Error(`consulta desconhecida: ${what} (${QUERIES.join('|')})`), { code: 'USAGE' });
}
