// EDITORIAL DENSITY (R9). Intervenções VISUAIS próximas competem entre si. Regras por modo:
// respiro mínimo entre intervenções (min_gap), teto por janela, sobreposição sempre é conflito.
// Resultado por candidato: KEEP · MERGE (informação relacionada consolidada) · REDUCE (vira ênfase leve) · DROP.
// Sequências só ficam quando narrativamente justificadas (enumeração explícita na fala).
import { ACTIONS, P } from './decide.mjs';

export const DENSITY = {
  CONSERVATIVE: { threshold: 'HIGH', min_gap: 6, window: 10, max_in_window: 1, merge_max_span: 10 },
  BALANCED: { threshold: 'MEDIUM', min_gap: 3, window: 10, max_in_window: 2, merge_max_span: 10 },
  EXPRESSIVE: { threshold: 'LOW', min_gap: 1.5, window: 10, max_in_window: 3, merge_max_span: 10 },
};
const LIGHT = new Set(['TEXT_EMPHASIS']);
const REDUCIBLE = new Set(['TYPOGRAPHY_MOTION', 'INFO_CARD', 'PRODUCT_INSERT', 'BROLL', 'LOGO_BRAND', 'LOWER_THIRD']);
const ENUM = ['primeiro', 'segundo', 'terceiro', 'quarto', 'first', 'second', 'third', 'fourth'];

export function densityParams(mode, intent) {
  const p = { ...DENSITY[mode] };
  if (intent.motion_budget === 'low') Object.assign(p, { threshold: 'HIGH', min_gap: Math.max(p.min_gap, 8), max_in_window: 1, budget: 'low (intenção do usuário)' });
  if (intent.motion_budget === 'high') Object.assign(p, { threshold: 'LOW', budget: 'high (intenção do usuário)' });
  return p;
}

export const requiredGap = (a, b, p) => (LIGHT.has(a.action) || LIGHT.has(b.action) ? p.min_gap / 2 : p.min_gap);
const enumerated = (c) => c.moment?.signals?.some((s) => s.type === 'TRANSITION' && ENUM.includes(s.term ?? ''));

/** @param {object[]} visual candidatos visuais já filtrados · @returns {{kept, outcomes}} */
export function applyDensity(visual, p, { mode, intent }) {
  const list = [...visual].sort((a, b) => a.start - b.start || b.priority - a.priority);
  const kept = []; const outcomes = [];
  const out = (c, outcome, reason, extra = {}) => { c.density = { outcome, reason, ...extra }; outcomes.push({ candidate: c, outcome, reason, ...extra }); };
  for (const c of list) {
    const last = kept[kept.length - 1];
    if (!last) { kept.push(c); continue; }
    const gap = c.start - last.end; const need = requiredGap(c, last, p);
    if (gap >= need) { kept.push(c); continue; }
    const span = Math.max(c.end, last.end) - Math.min(c.start, last.start);
    if (c.group && c.group === last.group && span <= p.merge_max_span) {
      const [win, lose] = c.priority > last.priority ? [c, last] : [last, c];
      win.start = Math.min(win.start, lose.start); win.end = Math.max(win.end, lose.end);
      win.merged_from = [...(win.merged_from ?? []), { action: lose.action, segment: lose.moment.segment_id, primary: lose.visual_intent?.hierarchy?.primary ?? null }];
      const lh = lose.visual_intent?.hierarchy ?? {};
      if (win.visual_intent && lh.primary) win.visual_intent.merged_content = [...(win.visual_intent.merged_content ?? []), ...[lh.primary, lh.secondary, lh.tertiary].filter((t) => t && !/^\(/.test(t))];
      win.merged_text = { ...(win.merged_text ?? {}), [lose.moment.segment_id]: [lh.primary, lh.secondary, lh.tertiary].filter((t) => t && !/^\(/.test(t)) };
      win.signals = [...win.signals, ...lose.signals];
      out(lose, 'MERGE', `informação relacionada (${c.group}) a ${gap < 0 ? 'sobrepor' : `${Math.round(gap * 100) / 100} s`}: consolidada em uma intervenção`, { merged_into: win });
      if (win === c) kept[kept.length - 1] = c;
      continue;
    }
    if (gap >= 0 && enumerated(c) && enumerated(last) && mode !== 'CONSERVATIVE' && intent.motion_budget !== 'low') { c.sequence = true; last.sequence = true; out(c, 'KEEP', 'sequência narrativa justificada (enumeração explícita na fala)'); kept.push(c); continue; }
    const [hi, lo] = c.priority > last.priority ? [c, last] : [last, c];
    if (REDUCIBLE.has(lo.action) && lo.priority >= P.MEDIUM && gap >= p.min_gap / 2) {
      const from = lo.action; lo.action = 'TEXT_EMPHASIS'; lo.reduced_from = from;
      out(lo, 'REDUCE', `${from} a ${Math.round(gap * 100) / 100} s de ${hi.action} (respiro mínimo ${p.min_gap} s): reduzido a ênfase leve para não competir`);
      kept.push(c); // o reduzido (lo) fica; c entra (se c era o reduzido, entra reduzido)
      continue;
    }
    out(lo, 'DROP', `${lo.action} a ${Math.round(gap * 100) / 100} s de ${hi.action} de prioridade ${hi.priority >= lo.priority ? 'maior ou igual' : 'menor'}: sem respiro (mínimo ${p.min_gap} s) e sem relação para consolidar`);
    if (lo === last) kept[kept.length - 1] = c;
  }
  // teto por janela
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of kept) {
      const win = kept.filter((k) => k.start >= c.start && k.start < c.start + p.window);
      if (win.length > p.max_in_window && !win.every((k) => k.sequence)) {
        const lo = [...win].sort((a, b) => a.priority - b.priority || b.start - a.start)[0];
        out(lo, 'DROP', `${win.length} intervenções em ${p.window} s (teto ${p.max_in_window} no modo): removida a de menor prioridade`);
        kept.splice(kept.indexOf(lo), 1); changed = true; break;
      }
    }
  }
  for (const c of kept) if (!c.density) c.density = { outcome: 'KEEP', reason: 'sem conflito de densidade' };
  return { kept, outcomes };
}

export const isVisual = (action) => ACTIONS[action]?.visual === true;
