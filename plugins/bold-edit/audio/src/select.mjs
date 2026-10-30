// SELEÇÃO INTELIGENTE de efeitos do SFX Kit (R13) — não por nome: por categoria, descrição e tags, use_for/avoid_for,
// duração (fits_seconds / span_seconds dentro de adapt.rate), tipo de sincronia (sync.meets), intensidade (variant / level.tier),
// convivência com narração (avoid_for "On top of speech", under_voiceover_db) e estética do estilo.
// Cada ponto do score fica registrado (explicável). Só campos REAIS do sounds.json são lidos.
import { words } from './sfxkit.mjs';

/** Perfil de cada tipo de evento: categorias do kit, sincronia esperada e termos (inglês, como o kit) do momento. */
export const PROFILES = Object.freeze({
  appear: { cats: ['pops', 'appear-and-vanish', 'interface'], meets: ['instant'], terms: 'appearing appear pop in icons badges text card elements scaling up into view', prefer: { kind: 'in' } },
  disappear: { cats: ['pops', 'appear-and-vanish'], meets: ['instant', 'release'], terms: 'disappear disappearing vanish leaving out exit', prefer: { kind: 'out' } },
  move: { cats: ['whooshes', 'swishes-and-zips'], meets: ['move-peak'], terms: 'sliding slide panels moves move transitions sliding in cards', fit: true },
  flick: { cats: ['swishes-and-zips'], meets: ['move-peak'], terms: 'flicked flick text icons arrows quick', fit: true },
  land: { cats: ['impacts'], meets: ['instant'], terms: 'landing land landings settling into place drop', },
  title_land: { cats: ['impacts', 'cinematic-hits', 'booms-and-bass'], meets: ['instant'], terms: 'title setting into place landing logo slams big title', },
  reveal: { cats: ['risers-and-fallers', 'reverse-whooshes'], meets: ['arrival'], terms: 'reveal building up build leading into section', fit: true },
  transition: { cats: ['whooshes', 'reverse-whooshes'], meets: ['move-peak', 'arrival'], terms: 'scene transitions transition scene change sections between', fit: true },
  zoom_in: { cats: ['bounce-spin-zoom'], meets: ['arrival', 'instant'], terms: 'zoom zooming in', prefer: { kind: 'zoom-in' } },
  zoom_out: { cats: ['bounce-spin-zoom'], meets: ['arrival', 'instant', 'move-peak'], terms: 'zoom zooming out', prefer: { kind: 'zoom-out' } },
  camera_push: { cats: ['whooshes', 'risers-and-fallers'], meets: ['move-peak', 'arrival'], terms: 'slow camera drifts drift push large panels', fit: true },
  count: { cats: ['data'], meets: ['action-start'], terms: 'statistic counting up count countup percentage climbing', fit: true, prefer: { item: 'countup' } },
  number_land: { cats: ['data'], meets: ['instant'], terms: 'number land final value lands', prefer: { item: 'land' } },
  chart: { cats: ['data'], meets: ['action-start', 'instant'], terms: 'chart bar appears reveal grow', fit: true },
  draw: { cats: ['swishes-and-zips', 'writing-and-drawing'], meets: ['action-start', 'arrival', 'move-peak'], terms: 'line arrow drawing draw in lines', fit: true },
  typing: { cats: ['keyboard'], meets: ['action-start'], terms: 'typing keyboard text being typed', fit: true },
  click: { cats: ['interface'], meets: ['instant'], terms: 'button pressed tap click', },
  success: { cats: ['notifications'], meets: ['instant'], terms: 'success done correct complete', },
  error: { cats: ['notifications'], meets: ['instant'], terms: 'error wrong failure', },
  notify: { cats: ['notifications'], meets: ['instant'], terms: 'message arrives notification badge', },
  highlight: { cats: ['shimmers', 'tones'], meets: ['instant', 'action-start'], terms: 'highlight something special standout sparkle', },
  accent: { cats: ['pops', 'shimmers', 'tones'], meets: ['instant', 'action-start'], terms: 'accent highlight appear subtle soft', },
  logo_open: { cats: ['logo-stings'], meets: ['arrival', 'instant'], terms: 'opening logo title start intro', },
  logo_end: { cats: ['logo-stings', 'shimmers'], meets: ['arrival', 'instant'], terms: 'logo end outro closing', },
});

/** Estilos e o que pedem (intensidade, densidade, ganho, tags estéticas). */
export const STYLES = Object.freeze({
  minimal: { intensity: ['soft', 'subtle', 'light', 'small', 'minimal', 'airy'], avoid_intensity: ['hard', 'strong', 'heavy', 'massive', 'big'], gain_db: -3, min_gap_s: 2.5, min_importance: 3, max_per_10s: 3, aesthetic: [] },
  institutional: { intensity: ['soft', 'light', 'subtle', 'medium', 'warm', 'clear'], avoid_intensity: ['hard', 'massive', 'glitch'], gain_db: -2, min_gap_s: 1.6, min_importance: 2, max_per_10s: 5, aesthetic: [], speech_strict: true },
  motion: { intensity: ['medium', 'soft', 'firm', 'clear', 'light'], avoid_intensity: ['massive'], gain_db: 0, min_gap_s: 0.25, min_importance: 1, max_per_10s: 18, aesthetic: [] },
  cinematic: { intensity: ['medium', 'hard', 'strong', 'heavy', 'deep', 'big', 'large'], avoid_intensity: ['subtle'], gain_db: 0, min_gap_s: 0.8, min_importance: 2, max_per_10s: 8, aesthetic: ['cinematic'], prefer_cats: ['cinematic-hits', 'booms-and-bass', 'risers-and-fallers', 'reverse-whooshes'] },
});

const SIZE_WORDS = { small: ['small', 'light', 'tiny', 'short'], medium: ['medium'], large: ['large', 'big', 'heavy', 'deep', 'long'] };
const overlaps = (a0, a1, ranges) => ranges.some(([s, e]) => a0 < e && a1 > s);

/** Rate que encaixa um som num momento de `dur` s (regra do kit: span_seconds ÷ dur, dentro de adapt.rate). */
export function fitRate(s, dur) {
  const [lo, hi] = s.adapt.rate;
  if (!(dur > 0)) return { rate: 1, fits: null, delta: 0 };
  if (typeof s.span_seconds === 'number') {
    const want = s.span_seconds / dur; const rate = Math.min(hi, Math.max(lo, want));
    return { rate: Math.round(rate * 1e4) / 1e4, fits: Math.abs(rate - want) < 1e-6, delta: Math.abs(s.span_seconds / rate - dur) };
  }
  if (Array.isArray(s.fits_seconds)) { const [a, b] = s.fits_seconds; return { rate: 1, fits: dur >= a && dur <= b, delta: dur < a ? a - dur : dur > b ? dur - b : 0 }; }
  return { rate: 1, fits: null, delta: 0 };
}

/**
 * Pontua os sons do kit para um evento. ctx: { style, speech:[[s,e]], musicKey? }.
 * @returns {{id:string, score:number, rate:number, reasons:string[]}[]} melhores primeiro
 */
export function rankForEvent(kit, ev, ctx = {}) {
  const prof = PROFILES[ev.kind]; if (!prof) return [];
  const st = STYLES[ctx.style] ?? STYLES.motion;
  const terms = new Set(words(prof.terms));
  const speech = ctx.speech ?? [];
  const rows = [];
  for (const s of kit.sounds) {
    if (!prof.cats.includes(s.category)) continue;
    const R = []; let score = 0; const add = (n, why) => { score += n; R.push(`${n >= 0 ? '+' : ''}${n} ${why}`); };
    // 1) sincronia: o tipo de momento que o som encontra
    if (prof.meets.includes(s.sync.meets)) add(6, `sync.meets=${s.sync.meets}`); else add(-8, `sync.meets=${s.sync.meets} ≠ ${prof.meets.join('|')}`);
    // 2) texto real do kit: use_for, tags, descrição, nome
    const hit = (txt, w, label) => { const ws = new Set(words(txt)); let k = 0; for (const t of terms) if (ws.has(t)) k++; if (k) add(k * w, `${label} (${k})`); };
    hit(s.use_for.join(' '), 2, 'use_for'); hit(s.tags.join(' '), 2, 'tags'); hit(s.description, 1, 'description'); hit(s.name, 1, 'name');
    // 3) avoid_for: conflitos explícitos do próprio kit
    const avoid = s.avoid_for.join(' ').toLowerCase();
    const evSpan = [ev.start ?? ev.t, (ev.start ?? ev.t) + Math.max(ev.dur ?? 0, s.duration)];
    const onSpeech = overlaps(evSpan[0] - s.sync.at, evSpan[1], speech);
    if (onSpeech && s.avoid_for.some((a) => /^on top of speech/i.test(a))) add(st.speech_strict ? -60 : -25, 'avoid_for: "On top of speech" e há narração');
    if (ctx.style === 'minimal' && /energetic|bold|big, energetic/.test(avoid)) add(1, 'avoid_for energético (ok p/ minimal)');
    if (['minimal', 'institutional'].includes(ctx.style) && /calm|corporate|voiceover/.test(avoid)) add(-6, 'avoid_for: calmo/corporativo');
    if (ev.kind === 'move' && ev.dur && ev.dur < 0.3 && /quick|snappy/.test(avoid)) add(-6, 'avoid_for: movimento rápido');
    // 4) duração: fits_seconds / span_seconds dentro de adapt.rate
    if (prof.fit && ev.dur) {
      const f = fitRate(s, ev.dur);
      if (f.fits === true) add(10, `encaixa ${ev.dur.toFixed(2)} s${f.rate !== 1 ? ` (rate ${f.rate})` : ''}`);
      else if (f.fits === false) add(-Math.min(20, Math.round(f.delta * 30)), `fora do encaixe (${f.delta.toFixed(2)} s)`);
    }
    // 5) intensidade e tamanho (variant / level.tier — valores reais do kit)
    // intensidade ≠ tamanho: variant.intensity/surface + level.tier dizem a força; variant.size/weight/length, o porte
    const v = s.variant ?? {};
    const tierIsSize = [v.size, v.weight, v.length].includes(s.level.tier);       // pops: tier = porte; whooshes: tier = força
    const iv = [v.intensity, v.surface, tierIsSize ? null : s.level.tier].filter(Boolean).join(' ').toLowerCase(); const iw = new Set(words(iv));
    const sv = [v.size, v.weight, v.length].filter(Boolean).join(' ').toLowerCase(); const sw = new Set(words(sv));
    const vals = `${iv} ${sv}`;
    if (st.intensity.some((w) => iw.has(w))) add(4, `intensidade (${iv}) combina com ${ctx.style ?? 'motion'}`);
    if (st.avoid_intensity.some((w) => iw.has(w))) add(-6, `intensidade (${iv}) forte demais p/ ${ctx.style ?? 'motion'}`);
    if (ev.size && SIZE_WORDS[ev.size].some((w) => sw.has(w))) add(3, `tamanho ${ev.size} (${sv})`);
    else if (ev.size && Object.entries(SIZE_WORDS).some(([k, ws]) => k !== ev.size && ws.some((w) => sw.has(w)))) add(-2, `porte (${sv}) ≠ ${ev.size}`);
    if (prof.prefer) for (const [k, v] of Object.entries(prof.prefer)) if (s.variant?.[k] === v) add(5, `variant.${k}=${v}`);
    // 6) estética e narração
    if (st.prefer_cats?.includes(s.category)) add(4, `categoria cinematográfica (${s.category})`);
    else if (ctx.style !== 'cinematic' && ['cinematic-hits', 'booms-and-bass'].includes(s.category)) add(-5, `${s.category} só no estilo cinematic`);
    if (st.aesthetic.some((t) => s.tags.includes(t))) add(2, 'tag estética');
    if (onSpeech) add(Math.round((8 + s.under_voiceover_db) / 2), `sob narração: under_voiceover_db ${s.under_voiceover_db}`);
    if (ctx.musicKey && s.tuning) add(1, `afinado (${s.tuning})`);
    // 7) importância alta pede presença; baixa pede discrição
    if (ev.importance === 'low' && /hard|strong|heavy|massive/.test(vals)) add(-4, 'evento discreto');
    rows.push({ id: s.id, category: s.category, score, rate: prof.fit && ev.dur ? fitRate(s, ev.dur).rate : 1, on_speech: onSpeech, reasons: R });
  }
  return rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
