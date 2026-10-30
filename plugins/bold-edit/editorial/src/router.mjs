// MOTION ROUTER V1 (R9). Implementa o método de `references/decision-engine.md` (8 critérios 0–3 + regras) e o
// estende com DAVINCI_NATIVE e NONE. Escolhe pela INTENÇÃO/RESULTADO NECESSÁRIO — disponibilidade nunca decide:
// ela só gera `fallback` declarado. Capacidades vêm do estado validado (hyperframes-capabilities.md, fusion.md).
export const TOOLS = ['HYPERFRAMES', 'REMOTION', 'FUSION', 'DAVINCI_NATIVE', 'NONE'];
export const CRITERIA = ['COMPLEXITY', 'EDITABILITY', 'ALPHA', 'REUSABILITY', 'RENDER_COST', 'RESOLVE_DEPENDENCY', 'DATA_DRIVEN', 'VISUAL_COMPLEXITY'];

/** Estado real das ferramentas (não é disponibilidade; é o que cada uma é capaz de fazer nesta Skill). */
export const CAPABILITY = {
  HYPERFRAMES: { status: 'FROZEN_V1', strengths: ['typography', 'lockup', 'perspective', 'masks', 'per_char', 'kerning'], cannot: ['footage_interaction', 'tracking', 'embedded_media', 'data_series'] },
  REMOTION: { status: 'FROZEN_V1', strengths: ['data', 'lists', 'maps', 'charts', 'counter', 'cards', 'lower_third', 'series', 'camera'], cannot: ['footage_interaction', 'tracking'] },
  FUSION: { status: 'EXPERIMENTAL', strengths: ['footage_interaction', 'tracking', 'masking_footage', 'editable_in_resolve', 'blend'], cannot: [], note: 'sem módulo nesta Skill (fusion.md): só conhecimento; execução exige trabalho manual/validação' },
  DAVINCI_NATIVE: { status: 'AVAILABLE_VIA_EDIT', strengths: ['transform', 'crop', 'opacity', 'fade', 'simple_transition', 'basic_title', 'media_placement', 'cut', 'audio_placement'], cannot: ['advanced_typography', 'data_series', 'tracking'] },
  NONE: { status: 'N/A', strengths: [], cannot: [] },
};
const FALLBACK = { HYPERFRAMES: 'REMOTION', REMOTION: 'HYPERFRAMES', FUSION: 'DAVINCI_NATIVE', DAVINCI_NATIVE: 'NONE', NONE: null };
const FALLBACK_LOSS = { HYPERFRAMES: 'perde kerning/baseline exatos e split por caractere fiel', REMOTION: 'perde dados/séries/câmera; vira composição tipográfica fixa', FUSION: 'perde interação espacial com o footage (vira overlay fixo; exige revisão)', DAVINCI_NATIVE: 'sem intervenção' };

/** Necessidades derivadas da decisão (ação + intenção visual + sinais + user intent). */
export function needsOf(d, intent = {}) {
  const a = d.decision.action; const vi = d.visual_intent ?? {}; const sig = new Set((d.signals ?? []).map((s) => s.type));
  const levels = ['primary', 'secondary', 'tertiary'].filter((k) => vi.hierarchy?.[k]).length;
  return {
    none: a === 'NO_ACTION',
    footage_interaction: ['TRACKED_CALLOUT', 'POINTER'].includes(a) || !!vi.needs?.footage_interaction,
    audio: ['SFX_CUE', 'MUSIC_CUE'].includes(a), edit: ['CUT_CANDIDATE'].includes(a),
    media_placement: ['BROLL', 'IMAGE_INSERT', 'PRODUCT_INSERT', 'LOGO_BRAND'].includes(a) && !vi.needs?.animated,
    simple: ['TRANSITION_SUPPORT'].includes(a) || (a === 'TEXT_EMPHASIS' && (intent.style === 'clean' || levels <= 1)),
    data: !!vi.data?.values?.length || sig.has('COMPARISON') || a === 'INFO_CARD',
    series: !!vi.needs?.series, editable_in_resolve: !!intent.editable_in_resolve || !!vi.needs?.editable_in_resolve,
    typography: ['TYPOGRAPHY_MOTION', 'OFFER_CARD', 'CTA', 'TEXT_EMPHASIS', 'CALLOUT'].includes(a), levels,
    lower_third: a === 'LOWER_THIRD', overlay: !['NO_ACTION', 'CUT_CANDIDATE', 'SFX_CUE', 'MUSIC_CUE'].includes(a),
  };
}

export function scoreCriteria(n) {
  const c = (v) => Math.max(0, Math.min(3, v));
  return {
    COMPLEXITY: c(n.none || n.edit || n.audio ? 0 : n.lower_third ? 1 : n.data ? 2 : n.levels >= 3 ? 2 : n.levels),
    EDITABILITY: c(n.editable_in_resolve ? 3 : n.lower_third ? 2 : 0),
    ALPHA: c(n.overlay && !n.media_placement ? 3 : 0),
    REUSABILITY: c(n.series ? 3 : n.lower_third ? 2 : 0),
    RENDER_COST: c(n.footage_interaction ? 2 : n.data ? 1 : 0),
    RESOLVE_DEPENDENCY: c(n.footage_interaction ? 3 : n.media_placement || n.edit || n.audio || n.simple || n.editable_in_resolve ? 2 : 0),
    DATA_DRIVEN: c(n.data ? 3 : 0),
    VISUAL_COMPLEXITY: c(n.typography ? (n.levels >= 2 ? 3 : 2) : n.levels),
  };
}

/**
 * @param {object} d decisão do plano · @param {{intent?:object, availability?:object|null}} o
 *   availability: {HYPERFRAMES:true|false, ...} opcional — NUNCA muda a escolha; só declara fallback.
 */
export function route(d, o = {}) {
  const intent = o.intent ?? {}; const n = needsOf(d, intent); const s = scoreCriteria(n);
  let tool; let rule;
  if (n.none) [tool, rule] = ['NONE', 'R0: NO_ACTION — motion não agrega valor'];
  else if (n.footage_interaction || (s.RESOLVE_DEPENDENCY >= 2 && s.EDITABILITY >= 2 && s.COMPLEXITY <= 1)) [tool, rule] = ['FUSION', n.footage_interaction ? 'R1: interação espacial com o footage (tracking/máscara/pointer ligado a objeto)' : 'decision-engine §3.3: EDITABILITY e RESOLVE_DEPENDENCY ≥ 2 com COMPLEXITY ≤ 1'];
  else if (n.edit || n.audio || n.media_placement || n.simple) [tool, rule] = ['DAVINCI_NATIVE', n.edit ? 'R2: operação editorial (corte/pausa), não motion' : n.audio ? 'R2: posicionamento de áudio (SFX/música) na timeline' : n.media_placement ? 'R2: inserção de mídia com transform/crop/opacity simples' : 'R2: ajuste simples (fade/transição/título básico) — motion avançado não agrega'];
  else if (s.DATA_DRIVEN >= 2 || s.REUSABILITY >= 2 || n.lower_third) [tool, rule] = ['REMOTION', n.lower_third && s.DATA_DRIVEN < 2 ? 'decision-engine §3.1: LOWER_THIRD de série (pattern programático; EDITABILITY no Resolve não pedida)' : 'decision-engine §3.1: DATA_DRIVEN/REUSABILITY ≥ 2 (dados, listas, gráficos, contadores, cards)'];
  else if (n.typography && s.VISUAL_COMPLEXITY >= 2) [tool, rule] = ['HYPERFRAMES', 'decision-engine §3.2: a tipografia é o elemento (hierarquia/lockup, baseline e kerning exatos)'];
  else [tool, rule] = ['DAVINCI_NATIVE', 'decision-engine §3.4 desempate: menor custo de alteração tardia para um elemento simples'];
  const cap = CAPABILITY[tool]; const issues = [];
  if (tool === 'FUSION') issues.push({ code: 'CAPABILITY_EXPERIMENTAL', detail: cap.note });
  if (n.footage_interaction && !d.evidence?.timeline_context?.visual_analysis) issues.push({ code: 'CAPABILITY_MISSING', detail: 'requer análise visual/tracking do plano, que não existe nesta Skill — revisão humana' });
  let availability = { checked: false, available: null };
  let fallback = FALLBACK[tool] ? { tool: FALLBACK[tool], loss: FALLBACK_LOSS[tool] } : null;
  if (o.availability && tool !== 'NONE') {
    const av = o.availability[tool]; availability = { checked: true, available: av ?? null };
    if (av === false) issues.push({ code: 'PREFERRED_UNAVAILABLE', detail: `${tool} indisponível: a escolha NÃO muda; use o fallback declarado (${fallback?.tool ?? 'nenhum'}) só com aprovação` });
  }
  const backend = { HYPERFRAMES: 'hyperframes', REMOTION: 'remotion', FUSION: 'fusion' }[tool] ?? null;
  return {
    schema: 'bold.motion-route/1', decision_id: d.id, action: d.decision.action, tool, rule, capability_status: cap.status, scores: s, needs: n,
    rationale: `${tool}: ${rule}. Ação ${d.decision.action}${d.visual_intent?.purpose ? ` para "${d.visual_intent.purpose}"` : ''}.${fallback ? ` Fallback: ${fallback.tool} (${fallback.loss}).` : ''}`,
    fallback, availability, issues,
    motion_spec_decision: backend ? { backend, scores: s, rationale: `${rule}${fallback ? ` · fallback: ${fallback.tool.toLowerCase()} (${fallback.loss})` : ''}` } : null,
    not_based_on: ['disponibilidade', 'facilidade', 'uso anterior'],
  };
}

/** Compatibilidade ferramenta × ação (para o validator). */
export function toolCompatible(action, tool) {
  if (action === 'NO_ACTION') return tool === 'NONE';
  if (['TRACKED_CALLOUT', 'POINTER'].includes(action)) return tool === 'FUSION';
  if (['CUT_CANDIDATE', 'SFX_CUE', 'MUSIC_CUE'].includes(action)) return tool === 'DAVINCI_NATIVE';
  if (tool === 'NONE') return false;
  if (action === 'INFO_CARD' && tool === 'HYPERFRAMES') return true;
  return TOOLS.includes(tool);
}
