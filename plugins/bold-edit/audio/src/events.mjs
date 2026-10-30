// EVENTOS SONOROS candidatos (R13) — a partir do que JÁ existe: motion.spec (camadas, câmera, transições),
// plano editorial (SFX_CUE, TRANSITION_SUPPORT e decisões visuais) ou uma lista manual de cues.
// Um evento NÃO é um som: é um momento com tipo, duração e importância. A escolha (e se haverá som) é do plano.
//   kind      appear | disappear | move | flick | land | title_land | reveal | transition | zoom_in | zoom_out | camera_push |
//             count | number_land | chart | draw | typing | click | success | error | notify | highlight | logo_open | logo_end | accent
//   t         o instante que o som deve ENCONTRAR (pico do movimento, chegada, primeiro frame da ação…), em segundos
//   start/dur o intervalo da ação (movimentos, contagens, builds), quando existe
import fs from 'node:fs';
import path from 'node:path';
import { AudioError } from './errors.mjs';

export const KINDS = Object.freeze(['appear', 'disappear', 'move', 'flick', 'land', 'title_land', 'reveal', 'transition', 'zoom_in', 'zoom_out', 'camera_push',
  'count', 'number_land', 'chart', 'draw', 'typing', 'click', 'success', 'error', 'notify', 'highlight', 'logo_open', 'logo_end', 'accent']);
export const IMPORTANCE = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });

/** Pico de um movimento conforme a curva (regra do GUIDE do SFX Kit: io = meio, out = ¼, in = ¾). */
export function movePeak(start, dur, ease = 'io') {
  const f = ease === 'out' ? 0.25 : ease === 'in' ? 0.75 : 0.5;
  return start + dur * f;
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function refDur(tokens, v, fps, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^\d+(\.\d+)?f$/.test(s)) return Number.parseFloat(s) / fps;
  const m = /^motion\.(\w+)$/.exec(s);
  if (m && typeof tokens?.motion?.duration?.[m[1]] === 'number') return tokens.motion.duration[m[1]];
  return fallback;
}
const easeName = (e, dflt) => (typeof e === 'string' ? (/(^|\.)(io|inout|in-out)$/.test(e) ? 'io' : /(^|\.)out$/.test(e) ? 'out' : /(^|\.)in$/.test(e) ? 'in' : dflt) : dflt);

/** motion.spec (bold.motion.spec/0) + tokens → eventos. Tempos relativos ao início da composição (+ offset). */
export function eventsFromMotionSpec(spec, { tokens = null, offset = 0 } = {}) {
  if (spec?.schema !== 'bold.motion.spec/0') throw new AudioError('SPEC_INVALID', 'não é bold.motion.spec/0');
  const fps = spec.brief?.fps; if (!(fps > 0)) throw new AudioError('FPS_MISSING', 'motion.spec sem brief.fps (o fps nunca é assumido)');
  const total = (spec.brief?.duration_frames ?? 0) / fps;
  const comp = spec.composition ?? {};
  const ev = []; let n = 0;
  const add = (o) => ev.push({ id: `e${String(++n).padStart(3, '0')}`, ...o, t: r6(o.t + offset), ...(o.start !== undefined ? { start: r6(o.start + offset) } : {}) });
  for (const L of comp.layers ?? []) {
    const m = L.motion ?? {}; const src = { type: 'motion.spec', ref: `${spec.id}#${L.id}`, pattern: L.pattern };
    const enter = refDur(tokens, m.enter, fps, 0.7); const exit = refDur(tokens, m.exit, fps, 0.3);
    const ease = easeName(m.ease, 'out'); const exitEase = easeName(m.exit_ease, 'in');
    const span = typeof L.region === 'object' ? (L.region.span ?? 4) : 12;
    const size = L.region === 'full' || span >= 7 ? 'large' : span >= 3 ? 'medium' : 'small';
    const reveal = m.reveal ?? 'up';
    const inT = L.in ?? 0; const outT = L.out ?? total;
    const exits = outT < total - 1e-6;
    switch (L.pattern) {
      case 'TITLE_REVEAL':
        if (reveal !== 'fade') add({ kind: 'move', t: movePeak(inT, enter, ease), start: inT, dur: enter, ease, importance: 'high', size, source: src });
        add({ kind: 'title_land', t: inT + enter, importance: 'high', size, source: src });
        break;
      case 'LOWER_THIRD':
        add({ kind: 'move', t: movePeak(inT, enter, ease), start: inT, dur: enter, ease, importance: 'medium', size: 'medium', source: src });
        break;
      case 'CARD_BUILD':
        add({ kind: 'appear', t: inT + enter, importance: 'medium', size, source: src });
        break;
      case 'IMAGE_REVEAL':
        add({ kind: 'move', t: movePeak(inT, enter, ease), start: inT, dur: enter, ease, importance: 'medium', size, source: src });
        break;
      case 'STAT_COUNTER':
        add({ kind: 'count', t: inT, start: inT, dur: enter, importance: 'medium', size, source: src });
        add({ kind: 'number_land', t: inT + enter, importance: 'medium', size, source: src });
        break;
      case 'MAP_PATH':
        add({ kind: 'draw', t: inT, start: inT, dur: enter, importance: 'medium', size, source: src });
        break;
      case 'CALLOUT':
        add({ kind: 'appear', t: inT + Math.min(enter, 0.3), importance: 'medium', size: 'small', source: src });
        break;
      case 'SECTION_TRANSITION':
        add({ kind: 'transition', t: inT + enter, start: inT, dur: enter, ease: 'in', importance: 'high', size: 'large', source: src });
        break;
      case 'SHAPE':
        add({ kind: 'appear', t: inT + enter, importance: 'low', size: 'small', source: src });
        break;
      case 'GRID_LINES':
        add({ kind: 'draw', t: inT, start: inT, dur: enter, importance: 'low', size: 'large', source: src });
        break;
      default:
        add({ kind: 'appear', t: inT + enter, importance: 'low', size, source: src });
    }
    if (exits && L.pattern !== 'SECTION_TRANSITION') add({ kind: 'move', t: movePeak(outT - exit, exit, exitEase), start: outT - exit, dur: exit, ease: exitEase, importance: 'low', size, exit: true, source: src });
  }
  const keys = comp.camera?.keys ?? [];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]; const b = keys[i]; const dur = b.at - a.at; const dz = (b.zoom ?? 1) - (a.zoom ?? 1);
    if (!(dur > 0) || Math.abs(dz) < 0.02) continue;
    const src = { type: 'motion.spec', ref: `${spec.id}#camera[${i}]` };
    if (dur >= 1) add({ kind: 'camera_push', t: movePeak(a.at, dur, easeName(b.ease, 'io')), start: a.at, dur, ease: easeName(b.ease, 'io'), importance: 'low', size: 'large', source: src });
    else add({ kind: dz > 0 ? 'zoom_in' : 'zoom_out', t: a.at + dur, start: a.at, dur, importance: 'medium', size: 'large', source: src });
  }
  return { schema: 'bold.sound-events/1', fps, fps_exact: Number.isInteger(fps) ? `${fps}/1` : null, duration: r6(total), source: { type: 'motion.spec', id: spec.id }, events: ev.sort((x, y) => x.t - y.t) };
}

const PRI = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const IMP = ['low', 'low', 'medium', 'high', 'critical'];
const VISUAL_KIND = { TEXT_EMPHASIS: 'appear', TYPOGRAPHY_MOTION: 'title_land', INFO_CARD: 'appear', OFFER_CARD: 'title_land', CTA: 'highlight', LOWER_THIRD: 'move',
  BROLL: 'transition', IMAGE_INSERT: 'appear', PRODUCT_INSERT: 'reveal', LOGO_BRAND: 'logo_end', CALLOUT: 'appear', POINTER: 'appear', TRACKED_CALLOUT: 'appear', TRANSITION_SUPPORT: 'transition' };

/** Plano editorial (bold.editorial-plan/1) → eventos. SFX_CUE herda o tipo da decisão visual que acentua. */
export function eventsFromEditorialPlan(plan) {
  if (plan?.schema !== 'bold.editorial-plan/1') throw new AudioError('PLAN_INVALID', 'não é bold.editorial-plan/1');
  const ev = []; let n = 0; let music = null;
  for (const d of plan.decisions ?? []) {
    const a = d.decision?.action; const pri = PRI[d.decision?.priority] ?? 1;
    const src = { type: 'editorial-plan', ref: d.id, action: a, ...(d.tl_in_tc ? { tc: d.tl_in_tc } : {}) };
    if (a === 'MUSIC_CUE') { music = { t: d.start, source: src }; continue; }
    if (a === 'SFX_CUE') { ev.push({ id: `e${String(++n).padStart(3, '0')}`, kind: 'accent', t: d.start, importance: IMP[Math.max(pri, 2)], size: 'small', source: { ...src, accent_of: d.rule }, requested: true }); continue; }
    const kind = VISUAL_KIND[a]; if (!kind) continue;
    const dur = Math.max(0, (d.end ?? d.start) - d.start);
    ev.push({ id: `e${String(++n).padStart(3, '0')}`, kind, t: kind === 'move' ? movePeak(d.start, Math.min(dur, 0.6), 'out') : d.start, ...(kind === 'move' ? { start: d.start, dur: Math.min(dur, 0.6), ease: 'out' } : {}), importance: IMP[pri], size: 'medium', source: src });
  }
  return { schema: 'bold.sound-events/1', fps: plan.timeline?.fps ?? null, fps_exact: plan.timeline?.fps ?? null, duration: plan.timeline?.duration ?? null, source: { type: 'editorial-plan', mode: plan.mode }, music_cue: music, events: ev.sort((x, y) => x.t - y.t) };
}

/** Lista manual: {fps, events:[{t|f, kind, dur?, ease?, importance?, size?}]} (f = frame). */
export function eventsFromCues(doc) {
  const fps = doc.fps ?? null;
  const list = Array.isArray(doc) ? doc : doc.events;
  if (!Array.isArray(list)) throw new AudioError('CUES_INVALID', 'esperado {fps, events:[…]}');
  const ev = list.map((e, i) => {
    if (!KINDS.includes(e.kind)) throw new AudioError('CUES_INVALID', `evento ${i}: kind "${e.kind}" desconhecido (válidos: ${KINDS.join(', ')})`);
    let t = e.t;
    if (t === undefined && e.f !== undefined) { if (!(fps > 0)) throw new AudioError('FPS_MISSING', 'cues em frames exigem fps'); t = e.f / fps; }
    if (typeof t !== 'number' || t < 0) throw new AudioError('CUES_INVALID', `evento ${i}: t/f ausente ou negativo`);
    return { id: e.id ?? `e${String(i + 1).padStart(3, '0')}`, kind: e.kind, t: r6(t), ...(e.dur ? { start: r6(e.start ?? t), dur: e.dur } : {}), ...(e.ease ? { ease: e.ease } : {}), importance: e.importance ?? 'medium', size: e.size ?? 'medium', source: { type: 'cues' }, ...(e.requested ? { requested: true } : {}) };
  });
  return { schema: 'bold.sound-events/1', fps, duration: doc.duration ?? null, source: { type: 'cues' }, events: ev.sort((x, y) => x.t - y.t) };
}

export function loadEvents(file, { tokens = null, offset = 0 } = {}) {
  let doc; try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new AudioError('INPUT_INVALID', `${path.basename(file)}: ${e.message}`); }
  if (doc.schema === 'bold.motion.spec/0') {
    let tk = tokens;
    if (!tk && typeof doc.tokens === 'string') { const tf = path.resolve(path.dirname(file), doc.tokens); try { tk = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch { tk = null; } }
    return eventsFromMotionSpec(doc, { tokens: tk, offset });
  }
  if (doc.schema === 'bold.editorial-plan/1') return eventsFromEditorialPlan(doc);
  if (doc.schema === 'bold.sound-events/1') return doc;
  return eventsFromCues(doc);
}
