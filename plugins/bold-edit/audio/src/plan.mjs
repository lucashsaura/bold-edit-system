// PLANO DE SOM (R13): eventos → cues posicionados. DECIDIR ≠ EXECUTAR: o plano é um JSON revisável; nada é mixado aqui.
// Densidade por estilo (o BOLD NÃO põe efeito em todo corte): minimal = poucos e suaves; institutional = clareza da narração;
// motion = UI, movimentos, impactos e transições; cinematic = impactos, transições, risers e profundidade.
// Posição (regra do SFX Kit): início = t − sync.at ÷ rate. Início < 0 → começa em 0 e corta esse trecho do arquivo.
// Frames: cada cue cai num frame inteiro + um pad de silêncio de alguns ms (sincronia por AMOSTRA em Remotion e DaVinci).
import { parseFps, framesToTc, dropFrameInfo, secondsToFrames } from '../../transcript/src/time.mjs';
import { AudioError } from './errors.mjs';
import { IMPORTANCE } from './events.mjs';
import { rankForEvent, STYLES } from './select.mjs';

export const SAMPLE_RATE = 48000;
const MIN_SCORE = 12;                      // abaixo disso o kit não tem um bom candidato → fallback (Openverse / Earshot)
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const overlap = (a0, a1, ranges) => ranges.some(([s, e]) => a0 < e && a1 > s);

/** Distribui cues em lanes sem sobreposição (A1, A2, …) para a edição por cue no DaVinci. */
function assignLanes(cues) {
  const ends = [];
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    let lane = ends.findIndex((e) => e <= c.start + 1e-9);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = c.start + c.duration_tl; c.lane = lane + 1;
  }
  return ends.length;
}

/**
 * @param {{events:object, kit:object, style?:string, fps?:string|number, speech?:number[][], duration?:number, exclude?:string[]}} o
 */
export function buildSoundPlan({ events, kit, style = 'motion', fps = null, speech = [], duration = null, exclude = [] }) {
  if (!STYLES[style]) throw new AudioError('STYLE_INVALID', `estilo desconhecido: ${style} (${Object.keys(STYLES).join(', ')})`);
  const fpsRaw = fps ?? events.fps; if (fpsRaw === null || fpsRaw === undefined) throw new AudioError('FPS_MISSING', 'fps ausente (nunca é assumido): use --fps ou um motion.spec com brief.fps');
  const F = parseFps(fpsRaw); const df = dropFrameInfo(F) !== null;
  const st = STYLES[style];
  const dropped = []; const accepted = [];
  // 1) densidade: importância mínima do estilo; pedidos explícitos (SFX_CUE / cues manuais) passam
  const cand = events.events.filter((e) => {
    if (e.requested) return true;
    if (IMPORTANCE[e.importance] < st.min_importance) { dropped.push({ event_id: e.id, kind: e.kind, t: e.t, reason: `importância ${e.importance} abaixo do mínimo de ${style}` }); return false; }
    return true;
  });
  // 2) espaçamento e teto por janela de 10 s — mais importantes primeiro; whoosh→impacto da MESMA camada pode encostar
  const order = [...cand].sort((a, b) => (IMPORTANCE[b.importance] - IMPORTANCE[a.importance]) || (b.requested ? 1 : 0) - (a.requested ? 1 : 0) || a.t - b.t);
  for (const e of order) {
    // pedido explícito (SFX_CUE / cue manual) ignora o espaçamento do estilo, mas não uma colisão (< 0,12 s)
    const gap = e.requested ? 0.12 : st.min_gap_s;
    const near = accepted.find((x) => Math.abs(x.t - e.t) < gap && !(x.source?.ref && x.source.ref === e.source?.ref && Math.abs(x.t - e.t) >= 0.12));
    if (near) { dropped.push({ event_id: e.id, kind: e.kind, t: e.t, reason: `a ${Math.abs(near.t - e.t).toFixed(2)} s de ${near.id} (${near.kind}); espaçamento mínimo ${e.requested ? 'de colisão' : `de ${style}`} = ${gap} s` }); continue; }
    const win = accepted.filter((x) => Math.abs(x.t - e.t) < 5).length;
    if (win >= st.max_per_10s) { dropped.push({ event_id: e.id, kind: e.kind, t: e.t, reason: `teto de ${st.max_per_10s} sons por 10 s (${style})` }); continue; }
    accepted.push(e);
  }
  accepted.sort((a, b) => a.t - b.t);
  // 3) escolha + posição + ganho
  const cues = []; const fallbacks = [];
  for (const e of accepted) {
    const ranked = rankForEvent(kit, e, { style, speech }).filter((r) => !exclude.includes(r.id));
    const best = ranked[0];
    if (!best || best.score < MIN_SCORE) { fallbacks.push({ event_id: e.id, kind: e.kind, t: e.t, dur: e.dur ?? null, best_kit: best ? { id: best.id, score: best.score } : null, reason: 'sem candidato forte no SFX Kit', next: ['openverse', 'earshot'] }); continue; }
    const s = kit.byId.get(best.id); const rate = best.rate;
    let start = e.t - s.sync.at / rate; let trim = 0;
    if (start < 0) { trim = -start * rate; start = 0; }
    let durTl = (s.duration - trim) / rate; let cut = null;
    if (s.sync.meets === 'action-start' && e.dur && durTl > e.dur + 0.05) { cut = e.dur; durTl = e.dur; }   // "pode perder o fim, onde a ação termina"
    const bodyA = start + Math.max(0, s.timing.onset - trim) / rate; const bodyB = start + Math.max(0, s.timing.body_end - trim) / rate;
    const underVo = overlap(bodyA, bodyB, speech);
    const parts = { style: st.gain_db, under_voiceover: underVo ? s.under_voiceover_db : 0, importance: e.importance === 'low' ? -2 : 0 };
    const gain = parts.style + parts.under_voiceover + parts.importance;
    const frame = secondsToFrames(start, F); const frameT = (frame * F.den) / F.num; const pad = Math.max(0, start - frameT);
    cues.push({
      id: `c${String(cues.length + 1).padStart(3, '0')}`, event_id: e.id, kind: e.kind, t: r6(e.t), importance: e.importance, source: e.source ?? null,
      sound: { id: s.id, file: s.file, category: s.category, name: s.name, origin: `${kit.name} ${kit.version}`, license: kit.license, channels: s.channels, duration: s.duration, sha256: s.sha256 },
      sync: { at: s.sync.at, meets: s.sync.meets }, rate, start: r6(start), trim_start: r6(trim), cut_end: cut === null ? null : r6(cut), duration_tl: r6(durTl),
      start_frame: frame, pad_s: r6(pad), pad_samples: Math.round(pad * SAMPLE_RATE), timecode: framesToTc(frame, F, df),
      expected: { sync_point: r6(start + (s.sync.at - trim) / rate), onset: r6(start + Math.max(0, s.timing.onset - trim) / rate), peak: r6(start + Math.max(0, s.timing.peak - trim) / rate) },
      gain_db: gain, gain_parts: parts, under_voiceover: underVo,
      fades: { in_ms: trim > 0 ? 15 : 0, out_ms: cut !== null ? 40 : 0 },
      score: best.score, reasons: best.reasons, alternatives: ranked.slice(1, 4).map((r) => ({ id: r.id, score: r.score })),
    });
  }
  const lanes = assignLanes(cues);
  const end = Math.max(duration ?? events.duration ?? 0, ...cues.map((c) => c.start + c.duration_tl));
  return {
    schema: 'bold.sound-plan/1', status: 'DRAFT', style, fps: F.exact, fps_float: F.float, drop_frame: df, sample_rate: SAMPLE_RATE, duration: r6(end),
    library: { name: kit.name, version: kit.version, license: kit.license },
    source: events.source ?? null, speech: speech.map(([a, b]) => [r6(a), r6(b)]),
    summary: { events: events.events.length, cues: cues.length, dropped: dropped.length, fallbacks: fallbacks.length, lanes, per_10s: r6((cues.length / Math.max(end, 1)) * 10) },
    cues, dropped, fallbacks,
    notes: ['Rascunho para revisão: nada foi mixado, gravado no DaVinci ou renderizado.', 'Posição pela regra do kit: início = momento − sync.at ÷ rate; pad < 1 frame garante sincronia por amostra.'],
  };
}
