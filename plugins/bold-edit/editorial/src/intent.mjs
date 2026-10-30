// USER INTENT + IDENTIDADE (R9). A intenção explícita do usuário tem PRIORIDADE sobre as heurísticas.
// Estruturada (`bold.editorial-intent/1`) vence; texto livre (--intent-text) passa por um mapeador TRANSPARENTE
// (registra cada frase reconhecida). Identidade: SYSTEM ≠ TEMPLATE — referências viram regras, nunca cópia.
import { fold } from '../../transcript/src/text.mjs';

export class EditorialError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }

export const MODES = ['CONSERVATIVE', 'BALANCED', 'EXPRESSIVE'];
const FOCUS = ['HOOK', 'OFFER', 'CTA', 'PRODUCT', 'PRICE', 'PERCENTAGE', 'PROOF', 'BENEFIT', 'COMPARISON', 'PERSON', 'BRAND', 'LOCATION', 'DEADLINE'];
const KEYS = ['schema', 'mode', 'focus', 'motion_budget', 'style', 'pace', 'subtitles', 'avoid', 'music', 'editable_in_resolve', 'allow_template_copy', 'notes', 'source', 'text', 'matched'];

/** Mapeador de texto livre (pt/en). Só o que é reconhecido entra; o resto vai para `notes` sem efeito. */
const PHRASES = [
  [/promo[cç][aã]o|oferta|desconto|condi[cç][aã]o comercial|\bpromo\b|\boffer\b|\bsale\b/i, { focus: ['OFFER'] }],
  [/\bcta\b|chamada para a[cç][aã]o|call to action/i, { focus: ['CTA'] }],
  [/produto|\bproduct\b/i, { focus: ['PRODUCT'] }],
  [/n[aã]o quero muito motion|pouco motion|menos motion|sem muito motion|minimal|m[ií]nimo de motion|less motion|not much motion/i, { motion_budget: 'low' }],
  [/mais motion|bastante motion|expressiv|more motion/i, { motion_budget: 'high' }],
  [/\bclean\b|limp[oa]|discret[oa]|minimalista/i, { style: 'clean' }],
  [/edi[cç][aã]o r[aá]pida|ritmo r[aá]pido|din[aâ]mic|fast[- ]paced|\bfast edit/i, { pace: 'fast' }],
  [/n[aã]o mexa nas legendas|n[aã]o mexer nas legendas|manter (as )?legendas|don'?t touch (the )?subtitles|keep (the )?subtitles/i, { subtitles: 'do_not_touch' }],
  [/sem b-?roll|n[aã]o quero b-?roll|no b-?roll/i, { avoid: ['BROLL'] }],
  [/sem (som|sfx|efeitos? sonoros?)|no sfx/i, { avoid: ['SFX_CUE'] }],
  [/com m[uú]sica|trilha|with music/i, { music: true }],
  [/edit[aá]vel no (resolve|davinci)|editable in (resolve|davinci)/i, { editable_in_resolve: true }],
];

export function intentFromText(text) {
  const out = { schema: 'bold.editorial-intent/1', source: 'text_heuristic', text, matched: [] };
  for (const [rx, eff] of PHRASES) {
    const m = rx.exec(text); if (!m) continue;
    out.matched.push({ phrase: m[0], effect: eff });
    for (const [k, v] of Object.entries(eff)) out[k] = Array.isArray(v) ? [...new Set([...(out[k] ?? []), ...v])] : v;
  }
  if (!out.matched.length) out.notes = 'nenhuma restrição reconhecida no texto (sem efeito no plano)';
  return out;
}

/** Normaliza/valida a intenção. Estruturada > texto. Desconhecido → EditorialError (fail-closed). */
export function normalizeIntent(structured = null, text = null) {
  const s = structured ?? {}; const t = text ? intentFromText(text) : {};
  if (structured) for (const k of Object.keys(s)) if (!KEYS.includes(k)) throw new EditorialError('INTENT_INVALID', `chave de intenção desconhecida: ${k}`);
  const pick = (k) => (s[k] !== undefined ? s[k] : t[k]);
  const intent = { schema: 'bold.editorial-intent/1', source: structured && text ? 'structured+text' : structured ? 'structured' : text ? 'text_heuristic' : 'none',
    mode: pick('mode') ?? null, focus: [...new Set([...(s.focus ?? []), ...(s.focus ? [] : t.focus ?? [])])], motion_budget: pick('motion_budget') ?? 'normal', style: pick('style') ?? null,
    pace: pick('pace') ?? 'normal', subtitles: pick('subtitles') ?? 'allow_suggestions', avoid: [...new Set([...(s.avoid ?? []), ...(t.avoid ?? [])])], music: !!pick('music'),
    editable_in_resolve: !!pick('editable_in_resolve'), allow_template_copy: !!s.allow_template_copy, text: text ?? null, matched: t.matched ?? [], notes: s.notes ?? t.notes ?? null };
  if (intent.mode && !MODES.includes(intent.mode)) throw new EditorialError('INTENT_INVALID', `mode: ${MODES.join('|')}`);
  for (const f of intent.focus) if (!FOCUS.includes(f)) throw new EditorialError('INTENT_INVALID', `focus desconhecido: ${f}`);
  if (!['low', 'normal', 'high'].includes(intent.motion_budget)) throw new EditorialError('INTENT_INVALID', 'motion_budget: low|normal|high');
  if (!['fast', 'normal', 'slow'].includes(intent.pace)) throw new EditorialError('INTENT_INVALID', 'pace: fast|normal|slow');
  if (!['do_not_touch', 'allow_suggestions'].includes(intent.subtitles)) throw new EditorialError('INTENT_INVALID', 'subtitles: do_not_touch|allow_suggestions');
  return intent;
}

/**
 * Identidade opcional (`bold.identity/1`): cores (papéis), fontes, logos (caminhos), referências, formas, regras de
 * composição e de motion. Saída = RESTRIÇÕES de estilo. Referência nunca vira "copie o motion antigo".
 */
export function identityConstraints(id, intent) {
  if (!id) return { present: false, brand_names: [], logo_paths: [], constraints: ['sem identidade fornecida: usar tokens do projeto (motion-system §3.1); nenhuma cor/fonte fora dos tokens'] };
  if (id.schema !== 'bold.identity/1') throw new EditorialError('IDENTITY_INVALID', 'identidade: {"schema":"bold.identity/1", ...}');
  const c = [];
  if (id.colors) c.push(`cores por PAPEL: ${Object.keys(id.colors).join(', ')} (tokens do projeto)`);
  if (id.fonts?.length) c.push(`tipografia: ${id.fonts.join(', ')} (USER_PROVIDED; sem fallback silencioso)`);
  for (const r of id.composition_rules ?? []) c.push(`composição: ${r}`);
  for (const r of id.motion_rules ?? []) c.push(`motion: ${r}`);
  if (id.shapes?.length) c.push(`formas da marca: ${id.shapes.join(', ')} (como linguagem, não decoração)`);
  const refs = (id.references ?? []).map((r) => ({ kind: r.kind ?? 'reference', description: r.description ?? null, extracted_rules: r.extracted_rules ?? [],
    use: intent?.allow_template_copy ? 'COPY_ALLOWED_BY_USER' : 'EXTRACT_RULES_ONLY' }));
  if (refs.length) c.push(intent?.allow_template_copy ? 'referências: cópia autorizada explicitamente pelo usuário' : 'referências: extrair linguagem, hierarquia, ritmo, formas e tokens — NUNCA copiar layout/coreografia (SYSTEM ≠ TEMPLATE)');
  for (const r of refs) for (const rule of r.extracted_rules) c.push(`regra extraída: ${rule}`);
  return { present: true, brand_names: id.brand_names ?? [], logo_paths: id.logos ?? [], references: refs, constraints: c };
}

export const isFocus = (intent, types) => intent.focus.some((f) => types.includes(f));
export const folded = fold;
