// PLAN VALIDATOR (R9). Fail-closed: ERROR → FAIL (o plano não pode seguir para aprovação); WARNING → revisão.
// Vale para planos gerados E para planos editados à mão antes da aprovação.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate as schemaValidate } from '../../core/schema/validate.mjs';
import { ACTIONS, P } from './decide.mjs';
import { requiredGap } from './density.mjs';
import { toolCompatible } from './router.mjs';

const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'bold.editorial-plan.schema.json');
let schemaDoc = null;
export const planSchema = () => (schemaDoc ??= JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')));
const ASSET_ACTIONS = new Set(['PRODUCT_INSERT', 'IMAGE_INSERT', 'BROLL', 'LOGO_BRAND']);
const NEEDS_VISUAL_ANALYSIS = new Set(['TRACKED_CALLOUT', 'POINTER', 'CALLOUT']);

export function validatePlan(plan, { embedded = false } = {}) {
  const errors = []; const warnings = [];
  const E = (code, id, detail) => errors.push({ code, decision: id, detail }); const W = (code, id, detail) => warnings.push({ code, decision: id, detail });
  if (!embedded) for (const e of schemaValidate(planSchema(), plan).slice(0, 20)) E('SCHEMA', null, `${e.path ?? ''} ${e.message ?? JSON.stringify(e)}`);
  if (plan.execution?.allowed !== false || (plan.execution?.writes ?? []).length) E('EXECUTION_FORBIDDEN', null, 'R9 nunca executa: execution.allowed deve ser false e writes vazio');
  const dur = plan.timeline?.duration ?? null; const intent = plan.intent ?? {}; const dp = plan.density?.params ?? {};
  const ds = plan.decisions ?? [];
  for (const d of ds) {
    const a = d.decision?.action; const meta = ACTIONS[a];
    if (!meta) { E('UNKNOWN_ACTION', d.id, `ação fora do vocabulário: ${a}`); continue; }
    if (!d.decision.reason || !d.decision.rule) E('MISSING_REASON', d.id, 'toda decisão precisa de regra e motivo');
    if (a !== 'NO_ACTION' && !(d.evidence?.transcript && (d.signals?.length || /^(pacing|audio:music)/.test(d.decision.rule ?? '')))) E('NO_EVIDENCE', d.id, 'intervenção sem evidência (trecho + sinais)');
    if (!(d.end >= d.start) || d.start < 0 || (dur !== null && d.end > dur + 1e-6)) E('OUT_OF_TIMELINE', d.id, `[${d.start}, ${d.end}] fora de [0, ${dur}]`);
    if (meta.visual) {
      if (!d.route) E('MISSING_ROUTE', d.id, 'intervenção visual sem rota de ferramenta');
      if (d.placement && (d.placement.claims?.length || d.placement.status !== 'VISUAL_PLACEMENT_REQUIRES_REVIEW') && !d.evidence?.timeline_context?.visual_analysis) E('PLACEMENT_WITHOUT_VISUAL_EVIDENCE', d.id, 'afirmação de enquadramento sem análise visual');
      if (NEEDS_VISUAL_ANALYSIS.has(a) && !d.evidence?.timeline_context?.visual_analysis) E('CAPABILITY_MISSING', d.id, `${a} exige análise visual/tracking do plano, inexistente nesta Skill`);
      if (P[d.decision.priority] < P[dp.threshold ?? 'LOW']) E(intent.motion_budget === 'low' ? 'USER_INTENT_CONFLICT' : 'MODE_THRESHOLD_VIOLATION', d.id, `prioridade ${d.decision.priority} abaixo do limiar ${dp.threshold}`);
    }
    if (d.route && !toolCompatible(a, d.route.tool)) E('ROUTER_INCOMPATIBLE', d.id, `${a} → ${d.route.tool}`);
    for (const i of d.route?.issues ?? []) if (i.code !== 'PREFERRED_UNAVAILABLE') W(i.code, d.id, i.detail); else W('PREFERRED_UNAVAILABLE', d.id, i.detail);
    const ca = d.candidate_assets;
    if (ca) {
      if (['ASSET_AMBIGUOUS', 'NAME_ONLY_REQUIRES_REVIEW', 'NO_ASSET_FOUND'].includes(ca.status) && ca.recommended) E('ASSET_AMBIGUOUS', d.id, `${ca.status} com asset escolhido: nada pode ser escolhido silenciosamente`);
      else if (ca.status === 'ASSET_AMBIGUOUS' || ca.status === 'NAME_ONLY_REQUIRES_REVIEW') W(ca.status, d.id, ca.note);
      if (ASSET_ACTIONS.has(a) && ['NO_ASSET_FOUND', 'NO_TERMS'].includes(ca.status)) E('ASSET_MISSING', d.id, `${a} sem asset candidato`);
    } else if (ASSET_ACTIONS.has(a)) E('ASSET_MISSING', d.id, `${a} sem busca de asset`);
    const si = d.subtitle_interaction;
    if (si) {
      if (si.write !== false || si.requires_approval !== true) E('SUBTITLE_WRITE_FORBIDDEN', d.id, 'interação com legenda é sempre recomendação (write:false, aprovação humana)');
      if (intent.subtitles === 'do_not_touch' && si.status === 'CONSIDER_HIDE_DUPLICATE') E('USER_INTENT_CONFLICT', d.id, 'o usuário pediu para não mexer nas legendas');
      if (si.subtitle_presence === 'present' && si.duplicate_ratio >= 0.6 && si.status === 'KEEP' && intent.subtitles !== 'do_not_touch') W('DUPLICATION_UNFLAGGED', d.id, 'o motion repete a legenda e a duplicação não foi sinalizada');
    }
    if ((intent.avoid ?? []).includes(a)) E('USER_INTENT_CONFLICT', d.id, `o usuário pediu para evitar ${a}`);
  }
  // sobreposição e densidade entre intervenções visuais
  const vis = ds.filter((d) => ACTIONS[d.decision?.action]?.visual).sort((a, b) => a.start - b.start);
  for (let i = 1; i < vis.length; i++) {
    const a = vis[i - 1]; const b = vis[i]; const gap = b.start - a.end;
    if (gap < 0) E('OVERLAP_VISUAL', b.id, `sobrepõe ${a.id}`);
    else if (dp.min_gap !== undefined && gap < requiredGap({ action: a.decision.action }, { action: b.decision.action }, dp) && !(a.density?.sequence && b.density?.sequence)) E('DENSITY_EXCESSIVE', b.id, `${Math.round(gap * 100) / 100} s após ${a.id} (mínimo ${dp.min_gap} s)`);
  }
  if (dp.window) for (const a of vis) { const n = vis.filter((b) => b.start >= a.start && b.start < a.start + dp.window); if (n.length > dp.max_in_window && !n.every((x) => x.density?.sequence)) E('DENSITY_EXCESSIVE', a.id, `${n.length} intervenções em ${dp.window} s (teto ${dp.max_in_window})`); }
  const uniq = (xs) => { const s = new Set(); return xs.filter((x) => { const k = `${x.code}|${x.decision}|${x.detail}`; if (s.has(k)) return false; s.add(k); return true; }); };
  const e2 = uniq(errors); const w2 = uniq(warnings);
  return { status: e2.length ? 'FAIL' : w2.length ? 'WARN' : 'PASS', errors: e2, warnings: w2, approvable: !e2.length };
}
