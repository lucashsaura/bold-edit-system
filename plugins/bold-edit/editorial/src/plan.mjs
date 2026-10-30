// EDITORIAL PLAN (R9) → bold.editorial-plan/1. Pipeline: R8 (somente leitura) → sinais → candidatos → oferta
// principal → intenção do usuário → limiar do modo → densidade → legenda/placement/leitura → rota → validação.
// O plano é um RASCUNHO para revisão humana: nenhum write, nenhum render, nenhuma execução (outra camada).
import crypto from 'node:crypto';
import { analyze } from '../../transcript/src/analyze.mjs';
import { parseFps } from '../../transcript/src/time.mjs';
import { extractSignals } from './signals.mjs';
import { normalizeIntent, identityConstraints, isFocus, EditorialError, MODES } from './intent.mjs';
import { decideMoment, ACTIONS, P, PRIORITIES, subtitleInteraction, placementFor, readability, timeFields } from './decide.mjs';
import { densityParams, applyDensity, isVisual } from './density.mjs';
import { route } from './router.mjs';
import { validatePlan } from './validate.mjs';

export const SCHEMA = 'bold.editorial-plan/1';
export const ENGINE = 'bold-editorial@1';
export const RULES_VERSION = 'r9.1';
const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');
const gcdAspect = (w, h) => { const g = (a, b) => (b ? g(b, a % b) : a); const k = g(w, h); return `${w / k}:${h / k}`; };

/** Escolhe a transcrição do contexto (R8). Mais de uma sem seletor → TRANSCRIPT_AMBIGUOUS (fail-closed). */
export function selectTranscript(ctx, sel = null) {
  const ts = ctx.transcripts ?? [];
  if (!ts.length) throw new EditorialError('NO_TRANSCRIPT', 'o contexto não tem transcrição');
  const hit = sel ? ts.filter((t) => t.id === sel || t.timeline === sel || t.file === sel) : ts;
  if (!hit.length) throw new EditorialError('TRANSCRIPT_NOT_FOUND', `transcrição ${sel} não existe no contexto`);
  if (hit.length > 1) throw new EditorialError('TRANSCRIPT_AMBIGUOUS', `${hit.length} transcrições no contexto; informe --transcript-id`, { ids: hit.map((t) => t.id) });
  return hit[0];
}

/** Base de tempo/quadro: timeline do contexto (DaVinci, leitura) > transcrição DaVinci > usuário. Nunca inventada. */
export function timelineInfo({ ctx = null, doc, user = {} }) {
  const tlName = doc.source.davinci?.timeline ?? ctx?.components?.davinci?.target_timeline ?? null;
  const ins = (ctx?.components?.davinci?.inspected ?? []).find((t) => t.name === tlName) ?? null;
  const tb = doc.time_base;
  const fpsStr = ins?.fps ?? tb.fps ?? (user.fps ? parseFps(user.fps).exact : null);
  const fps = fpsStr ? parseFps(fpsStr) : null;
  const df = ins ? !!ins.drop_frame : tb.drop_frame ?? !!user.dropFrame;
  const origin = ins?.start_frame ?? tb.origin_frame ?? null;
  const res = ins?.resolution?.[0] ? ins.resolution : user.resolution ?? null;
  const aspect = res ? gcdAspect(res[0], res[1]) : user.aspect ?? null;
  const [aw, ah] = aspect ? aspect.split(':').map(Number) : [0, 0];
  const duration = ins?.duration_frames && fps ? Math.round(((ins.duration_frames * fps.den) / fps.num) * 1e6) / 1e6 : doc.duration;
  let subtitles = user.subtitles ?? null;
  if (!subtitles) subtitles = doc.source.format === 'davinci-subtitles' || (ins?.items?.subtitle ?? 0) > 0 ? 'present' : 'unknown';
  const overlays = fps && origin !== null ? (ctx?.relations?.asset_usage ?? []).filter((u) => u.timeline === tlName && u.track_type === 'video' && u.track > 1)
    .map((u) => ({ track: u.track, item: u.item, start: ((u.tl_in - origin) * fps.den) / fps.num, end: ((u.tl_out - origin) * fps.den) / fps.num })) : [];
  return { name: tlName, fps, fps_exact: fps?.exact ?? null, drop_frame: fps ? df : null, origin_frame: origin, duration, resolution: res, aspect,
    orientation: aw && ah ? (aw > ah ? 'horizontal' : ah > aw ? 'vertical' : 'square') : null, subtitles, overlays,
    source: ins ? 'davinci_context' : tb.fps ? `transcript_${tb.fps_source}` : user.fps ? 'user' : 'unknown' };
}

/**
 * @param {{ctx?:object|null, doc?:object, annotations?:object, assets?:object[], mediaPool?:object[], transcriptId?:string|null, mode?:string,
 *          intent?:object|null, intentText?:string|null, identity?:object|null, vocabulary?:object|null, user?:object, availability?:object|null}} o
 */
/** Legenda × motion POR SEGMENTO (decisão consolidada compara cada parte com a legenda do próprio trecho). */
function subtitlesFor(c, sig, tl, intent) {
  const h = c.visual_intent.hierarchy; const own = [h.primary, h.secondary, h.tertiary].filter((t) => t && !/^\(/.test(t));
  const parts = [[c.moment.segment_id, own], ...Object.entries(c.merged_text ?? {})];
  const per = parts.map(([id, els]) => ({ segment_id: id, ...subtitleInteraction(els, sig.moments.find((m) => m.segment_id === id).text, tl.subtitles, intent) }));
  const rank = { CONSIDER_HIDE_DUPLICATE: 2, KEEP_FOR_CONTEXT: 1, KEEP: 0 };
  const top = [...per].sort((a, b) => rank[b.status] - rank[a.status])[0];
  const { segment_id: _id, ...overall } = top;
  return per.length > 1 ? { ...overall, per_segment: per.map(({ write: _w, requires_approval: _r, subtitle_presence: _p, ...x }) => x) } : overall;
}

export function buildPlan(o) {
  const intent = normalizeIntent(o.intent ?? null, o.intentText ?? null);
  const mode = intent.mode ?? o.mode ?? 'BALANCED';
  if (!MODES.includes(mode)) throw new EditorialError('USAGE', `--mode ${MODES.join('|')}`);
  let doc = o.doc; let ann = o.annotations; let tId = null;
  if (o.ctx) { const t = selectTranscript(o.ctx, o.transcriptId ?? null); doc = t.doc; ann = t.annotations; tId = t.id; }
  if (!doc) throw new EditorialError('NO_TRANSCRIPT', 'informe --context ou --transcript');
  ann ??= analyze(doc, { vocabulary: o.vocabulary ?? null });
  const identity = identityConstraints(o.identity ?? null, intent);
  const assets = o.ctx?.assets ?? o.assets ?? []; const mediaPool = o.ctx?.relations?.media_pool ?? o.mediaPool ?? [];
  const tl = timelineInfo({ ctx: o.ctx ?? null, doc, user: o.user ?? {} });
  const sig = extractSignals(doc, ann, { vocabulary: o.vocabulary ?? {}, identity: o.identity ?? {} });
  const ctx = { intent, identity, assets, mediaPool, timeline: tl, duration: tl.duration, mode, seenGroups: new Map() };
  const cands = sig.moments.flatMap((m) => decideMoment(m, ctx));

  // oferta principal → CRITICAL (só uma)
  const offers = cands.filter((c) => c.action === 'OFFER_CARD');
  if (offers.length) { const main = [...offers].sort((a, b) => b.offer_score - a.offer_score || a.start - b.start)[0]; main.priority = P.CRITICAL; main.effects.push('context: principal condição comercial do vídeo → CRITICAL'); }
  // intenção do usuário (prioridade sobre heurística)
  const suppressed = [];
  const supp = (c, outcome, reason) => { suppressed.push({ c, outcome, reason }); c.suppressed = true; };
  for (const c of cands) {
    if (c.action === 'NO_ACTION') continue;
    const types = c.signals.map((s) => s.type);
    if (intent.avoid.includes(c.action)) { supp(c, 'USER_INTENT', `o usuário pediu para evitar ${c.action}`); continue; }
    if (intent.focus.length && isVisual(c.action)) {
      if (isFocus(intent, types)) { c.priority = Math.min(P.CRITICAL, c.priority + 1); c.effects.push(`user_intent: foco em ${intent.focus.join(',')} → +1 prioridade`); }
      else if (c.priority > P.LOW && c.priority < P.CRITICAL) { c.priority -= 1; c.effects.push(`user_intent: fora do foco (${intent.focus.join(',')}) → −1 prioridade`); }
    }
    if (intent.style === 'clean' && c.action === 'TYPOGRAPHY_MOTION') { c.reduced_from = c.action; c.action = 'TEXT_EMPHASIS'; c.effects.push('user_intent: estilo clean → TYPOGRAPHY_MOTION reduzido a TEXT_EMPHASIS'); }
  }
  // limiar do modo (+ orçamento de motion do usuário)
  const dp = densityParams(mode, intent);
  for (const c of cands) if (!c.suppressed && c.action !== 'NO_ACTION' && c.priority < P[dp.threshold]) supp(c, 'MODE_THRESHOLD', `prioridade ${PRIORITIES[c.priority]} abaixo do limiar ${dp.threshold} (${mode}${dp.budget ? `; orçamento ${dp.budget}` : ''})`);
  // densidade (só intervenções visuais)
  const vis = cands.filter((c) => !c.suppressed && isVisual(c.action));
  const { kept, outcomes } = applyDensity(vis, dp, { mode, intent });
  for (const oc of outcomes) if (oc.outcome === 'DROP' || oc.outcome === 'MERGE') supp(oc.candidate, oc.outcome, oc.reason);
  // áudio (só quando justificado: EXPRESSIVE sem estilo clean, ou música pedida)
  const extra = [];
  if (mode === 'EXPRESSIVE' && intent.style !== 'clean' && !intent.avoid.includes('SFX_CUE')) for (const k of kept) if (k.priority >= P.HIGH && !k.suppressed) {
    extra.push({ ...k, action: 'SFX_CUE', priority: P.LOW, rule: 'audio:accent', reason: `acento sonoro sutil na entrada de ${k.action} (${PRIORITIES[k.priority]}) — opcional no modo EXPRESSIVE`, start: k.start, end: Math.min(k.end, k.start + 0.5), visual_intent: null, candidate_assets: null, alternatives: [{ action: 'NO_ACTION', reason: 'sem som se a trilha já marcar o momento' }], effects: [], density: null, merged_from: undefined });
  }
  if (intent.music && sig.moments.length) { const m0 = sig.moments[0]; extra.push({ moment: m0, action: 'MUSIC_CUE', priority: P.MEDIUM, rule: 'audio:music_requested', reason: 'o usuário pediu música: cue de entrada da trilha no início (escolha da faixa = humana; sem download)', confidence: 'medium', signals: [], start: m0.start, end: m0.start, effects: ['user_intent: música pedida'], alternatives: [] }); }

  // monta as decisões finais (+ NO_ACTION onde nada visual restou)
  const finals = cands.filter((c) => !c.suppressed && (!isVisual(c.action) || kept.includes(c)) && c.action !== 'NO_ACTION');
  finals.push(...extra);
  // transição simples não empilha sobre uma intervenção visual que já marca a mudança de bloco
  for (const t of finals.filter((f) => f.action === 'TRANSITION_SUPPORT')) if (kept.some((k) => Math.abs(k.start - t.start) < 1)) { supp(t, 'DROP', 'a intervenção visual que começa aqui já marca a mudança de bloco'); finals.splice(finals.indexOf(t), 1); }
  const mergedSegs = new Set(kept.flatMap((k) => (k.merged_from ?? []).map((x) => x.segment)));
  for (const m of sig.moments) {
    if (mergedSegs.has(m.segment_id) && !finals.some((f) => f.moment.segment_id === m.segment_id && f.action !== 'NO_ACTION')) continue; // consolidado em outra decisão
    if (finals.some((f) => f.moment.segment_id === m.segment_id && isVisual(f.action))) continue;
    const own = cands.filter((c) => c.moment.segment_id === m.segment_id);
    const na = own.find((c) => c.action === 'NO_ACTION');
    if (na) finals.push(na);
    else {
      const why = suppressed.filter((s) => s.c.moment.segment_id === m.segment_id && isVisual(s.c.action)).map((s) => `${s.c.action}: ${s.outcome} (${s.reason})`);
      finals.push({ moment: m, action: 'NO_ACTION', priority: P.NONE, rule: 'no_action:after_review', reason: why.length ? `candidato(s) não mantidos — ${why.join('; ')}` : 'sem intervenção visual', confidence: 'medium', signals: m.signals, start: m.start, end: m.end, effects: [], alternatives: own.filter((c) => isVisual(c.action)).map((c) => ({ action: c.action, reason: c.reason })) });
    }
  }
  finals.sort((a, b) => a.start - b.start || (ACTIONS[a.action].visual ? 0 : 1) - (ACTIONS[b.action].visual ? 0 : 1) || a.action.localeCompare(b.action));
  const ids = new Map(finals.map((c, i) => [c, `d${String(i + 1).padStart(4, '0')}`]));
  const decisions = finals.map((c) => {
    const fam = ACTIONS[c.action].family; const visual = ACTIONS[c.action].visual;
    const text = c.visual_intent ? [c.visual_intent.hierarchy.primary, c.visual_intent.hierarchy.secondary, c.visual_intent.hierarchy.tertiary, ...(c.visual_intent.merged_content ?? [])].filter((t) => t && !/^\(/.test(t)) : [];
    const order = new Map(sig.moments.map((m, i) => [m.segment_id, i]));
    const segIds = [...new Set([c.moment.segment_id, ...(c.merged_from ?? []).map((x) => x.segment)])].sort((x, y) => order.get(x) - order.get(y));
    const segText = segIds.map((id) => sig.moments.find((m) => m.segment_id === id).text).join(' ');
    const d = {
      id: ids.get(c), transcript: tId ?? doc.source.name, timeline: tl.name, segment_ids: segIds, ...timeFields(c.start, c.end, tl),
      evidence: { transcript: segText, annotations: [...new Set(c.signals.map((s) => s.source).filter((x) => x.startsWith('r8:')).map((x) => x.split(':')[1]))].sort(),
        signal_sources: [...new Set(c.signals.map((s) => s.source))].sort(), assets: c.candidate_assets?.candidates?.map((a) => a.asset_id) ?? [],
        timeline_context: { fps: tl.fps_exact, drop_frame: tl.drop_frame, aspect: tl.aspect, subtitles: tl.subtitles, source: tl.source, visual_analysis: false } },
      signals: [...new Set(c.signals.map((s) => s.type))].sort(),
      decision: { action: c.action, family: fam, priority: PRIORITIES[c.priority], rule: c.rule, reason: c.reason, user_intent_effects: c.effects, ...(c.reduced_from ? { reduced_from: c.reduced_from } : {}) },
      visual_intent: c.visual_intent ?? null, candidate_assets: c.candidate_assets ?? null,
      subtitle_interaction: visual && text.length ? subtitlesFor(c, sig, tl, intent) : null,
      placement: visual ? placementFor(c, tl) : null,
      constraints: visual ? readability(text, c.end - c.start) : [],
      confidence: c.confidence ?? 'medium', alternatives: c.alternatives ?? [],
      density: visual ? { outcome: c.density?.outcome ?? 'KEEP', reason: c.density?.reason ?? 'sem conflito de densidade', ...(c.sequence ? { sequence: true } : {}), ...(c.merged_from?.length ? { merged_from: c.merged_from } : {}) } : null,
      approval: { required: c.action !== 'NO_ACTION', status: c.action === 'NO_ACTION' ? 'NOT_REQUIRED' : 'PENDING_HUMAN_REVIEW' },
    };
    d.route = route(d, { intent, availability: o.availability ?? null });
    return d;
  });
  const sup = suppressed.map((s) => ({ action: s.c.action, segment_id: s.c.moment.segment_id, start: Math.round(s.c.start * 1e6) / 1e6, end: Math.round(s.c.end * 1e6) / 1e6, priority: PRIORITIES[s.c.priority], outcome: s.outcome, reason: s.reason,
    ...(s.outcome === 'MERGE' ? { merged_into: ids.get(s.c.density?.merged_into) ?? null } : {}) })).sort((a, b) => a.start - b.start || a.action.localeCompare(b.action));
  const vis2 = decisions.filter((d) => ACTIONS[d.decision.action].visual);
  const plan = {
    schema: SCHEMA, engine: ENGINE, rules_version: RULES_VERSION, status: 'DRAFT_REQUIRES_HUMAN_REVIEW',
    execution: { allowed: false, boundary: 'R9 DECIDE; a execução (motion, DaVinci, render) é outra camada e só começa com um plano APROVADO por humano e as autorizações próprias de cada ação', writes: [] },
    mode, intent, identity: { present: identity.present, constraints: identity.constraints, references: identity.references ?? [] },
    inputs: { context_sha256: o.ctx ? sha(o.ctx) : null, transcript: { id: tId, source_name: doc.source.name, format: doc.source.format, sha256: ann.transcript.sha256 }, assets: assets.length, media_pool: mediaPool.length },
    timeline: { name: tl.name, fps: tl.fps_exact, drop_frame: tl.drop_frame, origin_frame: tl.origin_frame, duration: tl.duration, resolution: tl.resolution, aspect: tl.aspect, orientation: tl.orientation, subtitles: tl.subtitles, source: tl.source },
    signals: { counts: sig.counts, moments: sig.moments.map((m) => ({ segment_id: m.segment_id, start: m.start, end: m.end, signals: m.signals.map((s) => ({ type: s.type, evidence: s.evidence, strength: s.strength, source: s.source, ...(s.role ? { role: s.role } : {}) })) })) },
    density: { params: dp, visual_interventions: vis2.length, per_minute: tl.duration ? Math.round((vis2.length / tl.duration) * 60 * 100) / 100 : null },
    summary: { decisions: decisions.length, by_action: Object.fromEntries(Object.keys(ACTIONS).map((a) => [a, decisions.filter((d) => d.decision.action === a).length]).filter(([, n]) => n)), by_priority: Object.fromEntries(PRIORITIES.map((p) => [p, decisions.filter((d) => d.decision.priority === p).length])), suppressed: sup.length },
    decisions, suppressed: sup,
  };
  plan.validation = validatePlan(plan, { embedded: true });
  return plan;
}
