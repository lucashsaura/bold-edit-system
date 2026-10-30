// DECISION ENGINE (R9): sinais → decisões EXPLICÁVEIS (regra + motivo + evidência). NO_ACTION é uma decisão de
// primeira classe. Nada aqui executa: as decisões são PROPOSTAS para revisão humana (DECIDIR ≠ EXECUTAR).
import { normWords } from '../../transcript/src/text.mjs';
import { secondsToFrames, framesToTc, roundS } from '../../transcript/src/time.mjs';
import { matchAssets } from './match.mjs';
import { isFocus } from './intent.mjs';

export const ACTIONS = {
  NO_ACTION: { family: 'none', visual: false },
  TEXT_EMPHASIS: { family: 'text', visual: true }, TYPOGRAPHY_MOTION: { family: 'text', visual: true }, INFO_CARD: { family: 'graphic', visual: true },
  OFFER_CARD: { family: 'graphic', visual: true }, CTA: { family: 'graphic', visual: true }, LOWER_THIRD: { family: 'graphic', visual: true },
  BROLL: { family: 'asset', visual: true }, IMAGE_INSERT: { family: 'asset', visual: true }, PRODUCT_INSERT: { family: 'asset', visual: true }, LOGO_BRAND: { family: 'asset', visual: true },
  CALLOUT: { family: 'spatial', visual: true }, POINTER: { family: 'spatial', visual: true }, TRACKED_CALLOUT: { family: 'spatial', visual: true },
  TRANSITION_SUPPORT: { family: 'structure', visual: false }, SFX_CUE: { family: 'audio', visual: false }, MUSIC_CUE: { family: 'audio', visual: false },
  CUT_CANDIDATE: { family: 'pacing', visual: false },
};
export const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const P = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const COMMERCIAL = ['OFFER', 'PRICE', 'PERCENTAGE', 'DEADLINE', 'PAYMENT', 'CTA'];
const SYN = { off: 'desconto', x: 'vezes', discount: 'desconto' };
const STOP = new Set(['de', 'do', 'da', 'no', 'na', 'em', 'o', 'a', 'e', 'com', 'para', 'pra', 'os', 'as', 'um', 'uma', 'the', 'of', 'on', 'in', 'and', 'to']);
const READ_S_PER_WORD = 0.3; const READ_MIN_S = 1.0;

const words = (s) => normWords(s ?? '').map((w) => SYN[w] ?? w);
const pick = (sigs, ...types) => sigs.filter((s) => types.includes(s.type));
const first = (sigs, ...types) => pick(sigs, ...types)[0] ?? null;

function timeFields(start, end, tl) {
  const out = { start: roundS(start), end: roundS(end) };
  if (!tl?.fps) return out;
  const sf = secondsToFrames(start, tl.fps); const ef = secondsToFrames(end, tl.fps);
  out.start_frame = sf; out.end_frame = ef;
  if (tl.origin_frame !== null && tl.origin_frame !== undefined) { out.tl_in = tl.origin_frame + sf; out.tl_out = tl.origin_frame + ef; out.tl_in_tc = framesToTc(out.tl_in, tl.fps, !!tl.drop_frame); out.tl_out_tc = framesToTc(out.tl_out, tl.fps, !!tl.drop_frame); out.tc_origin = 'timeline'; }
  else { out.tl_in_tc = framesToTc(sf, tl.fps, !!tl.drop_frame); out.tl_out_tc = framesToTc(ef, tl.fps, !!tl.drop_frame); out.tc_origin = 'relative'; } // sem origem conhecida: TC desde 0, declarado
  return out;
}

/** Legenda × motion: duplicação visual. NUNCA desliga legenda — só recomenda, com aprovação humana. */
export function subtitleInteraction(textElements, segmentText, presence, intent) {
  const base = { write: false, requires_approval: true, subtitle_presence: presence };
  const motion = [...new Set(textElements.flatMap(words))].filter((w) => !STOP.has(w));
  if (presence === 'absent') return { ...base, status: 'KEEP', reason: 'sem legenda no intervalo: nada a coordenar' };
  if (!motion.length) return { ...base, status: 'KEEP', reason: 'motion sem texto' };
  const sub = new Set(words(segmentText).filter((w) => !STOP.has(w)));
  const inter = motion.filter((w) => sub.has(w)); const dup = inter.length / motion.length; const cov = sub.size ? inter.length / sub.size : 0;
  const metrics = { duplicate_ratio: roundS(dup), subtitle_coverage: roundS(cov), shared: inter };
  if (presence === 'unknown') return { ...base, status: 'KEEP', ...metrics, reason: 'presença de legenda desconhecida: confirmar antes de decidir sobre duplicação' };
  if (dup >= 0.6 && cov >= 0.5) {
    if (intent?.subtitles === 'do_not_touch') return { ...base, status: 'KEEP', ...metrics, reason: 'duplicação detectada, mas o usuário pediu para não mexer nas legendas' };
    return { ...base, status: 'CONSIDER_HIDE_DUPLICATE', ...metrics, reason: 'o motion repete a informação da legenda no mesmo intervalo; considerar ocultar a legenda neste trecho (decisão humana; nenhum write)' };
  }
  if (dup >= 0.6) return { ...base, status: 'KEEP_FOR_CONTEXT', ...metrics, reason: 'o motion repete parte da legenda, mas a legenda carrega contexto adicional' };
  return { ...base, status: 'KEEP', ...metrics, reason: 'motion e legenda trazem informação diferente' };
}

/** Placement honesto: só o que se SABE da timeline; enquadramento do frame é sempre revisão (sem análise visual). */
export function placementFor(d, tl) {
  const known = { aspect: tl?.aspect ?? null, orientation: tl?.orientation ?? null, resolution: tl?.resolution ?? null, interval_s: roundS(d.end - d.start),
    subtitle_zone: tl?.subtitles === 'present' ? 'inferior (~20% do quadro) — convenção de legenda, NÃO medida' : null,
    existing_overlays: (tl?.overlays ?? []).filter((o) => o.start < d.end && o.end > d.start).map((o) => ({ track: o.track, start: o.start, end: o.end, item: o.item })) };
  return { status: 'VISUAL_PLACEMENT_REQUIRES_REVIEW', known, unknown: ['posição do rosto/assunto', 'posição do produto em cena', 'regiões livres do quadro'],
    rules: ['title-safe 10%', 'não cobrir rosto nem produto (conferir no frame real)', ...(known.subtitle_zone ? ['evitar a zona provável da legenda'] : []), ...(known.existing_overlays.length ? ['há overlay existente em track superior no intervalo: coordenar camadas'] : [])],
    claims: [], note: tl?.aspect ? 'sem análise do frame: nenhuma afirmação sobre espaço livre' : 'sem dados da timeline (aspecto/resolução desconhecidos)' };
}

function readability(levels, interval) {
  const n = levels.flatMap((t) => normWords(t)).length; const need = Math.max(READ_MIN_S, roundS(n * READ_S_PER_WORD + 0.5));
  return interval + 1e-9 < need ? [`intervalo da fala (${roundS(interval)} s) menor que o tempo mínimo de leitura (${need} s): estender o hold além da fala ou simplificar o texto`] : [];
}

/** Uma decisão-candidata. `rule` e `reason` são obrigatórios (explicabilidade). */
function cand(m, action, priority, rule, reason, extra = {}) {
  return { moment: m, action, priority: P[priority], rule, reason, confidence: extra.confidence ?? 'medium', signals: extra.signals ?? [], visual_intent: extra.visual_intent ?? null,
    candidate_assets: extra.candidate_assets ?? null, alternatives: extra.alternatives ?? [], start: extra.start ?? m.start, end: extra.end ?? m.end, effects: [], group: extra.group ?? null };
}

function vi(purpose, primary, secondary, tertiary, behavior, ctx, extra = {}) {
  return { purpose, hierarchy: { primary, ...(secondary ? { secondary } : {}), ...(tertiary ? { tertiary } : {}) }, text_source: 'fala (literal; exige texto aprovado antes da execução)',
    behavior, style_constraints: [...ctx.identity.constraints, 'um protagonista por quadro', 'não cobrir rosto/produto', 'sem movimento decorativo persistente', ...(ctx.intent.style === 'clean' ? ['clean: sem elementos decorativos, entrada/saída curtas'] : [])], ...extra };
}

/** Candidatos de UM momento (segmento). */
export function decideMoment(m, ctx) {
  const S = m.signals; const out = []; const tl = ctx.timeline; const ratio = m.start / Math.max(ctx.duration, 1e-9);
  const pauseT = ctx.intent.pace === 'fast' ? 1.0 : 2.0;
  if (m.index > 0 && m.gap_before >= pauseT) out.push(cand(m, 'CUT_CANDIDATE', ctx.intent.pace === 'fast' ? 'MEDIUM' : 'LOW', 'pacing:pause', `pausa/silêncio de ${m.gap_before} s antes da fala${ctx.intent.pace === 'fast' ? ' (usuário pediu edição rápida)' : ''}`,
    { start: m.start - m.gap_before, end: m.start, confidence: 'high', signals: pick(S, 'TRANSITION') }));
  const quant = [...pick(S, 'PERCENTAGE').filter((s) => s.role === 'commercial'), ...pick(S, 'PRICE'), ...pick(S, 'OFFER').filter((s) => s.subtype === 'installment')];
  const offerTerms = pick(S, 'OFFER').filter((s) => !s.subtype && !/%\s?off/i.test(s.evidence));
  if (quant.length) {
    const tert = [first(S, 'PAYMENT'), first(S, 'DEADLINE') && first(S, 'DATE') ? { evidence: `${first(S, 'DEADLINE').evidence} ${first(S, 'DATE').evidence}` } : null].filter(Boolean).map((s) => s.evidence).join(' · ') || null;
    const primary = quant[0].evidence; const secondary = offerTerms[0]?.evidence ?? (pick(S, 'OFFER').find((s) => /%\s?off/i.test(s.evidence)) ? 'OFF' : null);
    out.push(cand(m, 'OFFER_CARD', 'HIGH', 'offer:quantified', `a fala contém uma condição comercial quantificada ("${primary}"${secondary ? ` + "${secondary}"` : ''}); valores e condições são difíceis de reter só pela fala`, {
      confidence: quant.every((q) => q.strength === 'high') ? 'high' : 'medium', signals: pick(S, ...COMMERCIAL, 'NUMBER', 'EMPHASIS'), group: 'commercial',
      visual_intent: vi('destacar condição comercial', primary, secondary, tert, ['valor principal entra primeiro, sincronizado à palavra quando houver timing por palavra', 'secundário resolve logo após a fala do valor', 'hold legível até o fim da frase', 'sai pela mesma lógica da entrada'], ctx),
      alternatives: [{ action: 'TEXT_EMPHASIS', reason: 'se a identidade pedir algo mais discreto' }, { action: 'NO_ACTION', reason: 'se a legenda já for suficiente para esta peça' }],
      offer_score: 2 + (first(S, 'DEADLINE') ? 1 : 0) + (first(S, 'PAYMENT') ? 1 : 0) + (isFocus(ctx.intent, ['OFFER']) ? 1 : 0) }));
    out[out.length - 1].offer_score = 2 + (first(S, 'DEADLINE') ? 1 : 0) + (first(S, 'PAYMENT') ? 1 : 0);
  }
  const ctas = pick(S, 'CTA').sort((a, b) => b.evidence.length - a.evidence.length); const cta = ctas[0] ?? null;
  let ctaText = cta?.evidence ?? null; // trecho LITERAL do primeiro ao último termo de ação (≤ 7 palavras)
  if (cta) { const pos = ctas.map((c) => { const i = m.text.indexOf(c.evidence); return i < 0 ? null : [i, i + c.evidence.length]; }).filter(Boolean);
    if (pos.length) { const t = m.text.slice(Math.min(...pos.map((x) => x[0])), Math.max(...pos.map((x) => x[1]))); if (normWords(t).length <= 7) ctaText = t; } }
  if (cta) {
    const strong = ratio >= 0.6 || /link|bio|abaixo|below|clique|click/i.test(cta.evidence);
    out.push(cand(m, 'CTA', strong ? 'HIGH' : 'MEDIUM', 'cta:lexicon', `a fala pede uma ação ("${ctaText}")${ratio >= 0.6 ? ' no trecho final do vídeo' : ''}; tornar a ação explícita aumenta a chance de execução`, {
      confidence: 'medium', signals: pick(S, 'CTA', 'OFFER', 'EMPHASIS'), group: 'commercial',
      visual_intent: vi('tornar a ação explícita', ctaText, null, null, ['entra com a fala da ação', 'hold até o fim da frase'], ctx), alternatives: [{ action: 'NO_ACTION', reason: 'se o CTA já estiver em tela por outro meio' }] }));
  }
  const prod = first(S, 'PRODUCT');
  if (prod) {
    const terms = [prod.term ?? prod.evidence];
    const ma = matchAssets(ctx.assets, terms, { action: 'PRODUCT_INSERT', orientation: tl?.orientation ?? null, mediaPool: ctx.mediaPool });
    if (['CANDIDATE', 'ASSET_AMBIGUOUS', 'NAME_ONLY_REQUIRES_REVIEW'].includes(ma.status)) out.push(cand(m, 'PRODUCT_INSERT', 'MEDIUM', 'product:vocabulary+asset', `a fala menciona o produto "${prod.evidence}" e o índice tem asset(s) relacionado(s) por caminho/tags`, {
      confidence: ma.status === 'CANDIDATE' ? 'medium' : 'low', signals: pick(S, 'PRODUCT', 'MODEL'), candidate_assets: ma, group: m.roles.commercial ? 'commercial' : `product:${terms[0]}`,
      visual_intent: vi('mostrar o produto citado', prod.evidence, null, null, ['inserção durante a menção', 'sem cobrir o apresentador (revisão)'], ctx), alternatives: [{ action: 'TEXT_EMPHASIS', reason: 'se nenhum asset for aprovado' }] }));
    else out.push(cand(m, 'TEXT_EMPHASIS', 'MEDIUM', 'product:vocabulary', `a fala menciona o produto "${prod.evidence}", mas o índice não tem asset correspondente (${ma.status})`, {
      confidence: 'low', signals: pick(S, 'PRODUCT', 'MODEL'), candidate_assets: ma, group: m.roles.commercial ? 'commercial' : `product:${terms[0]}`,
      visual_intent: vi('nomear o produto citado', prod.evidence, null, null, ['entra com a menção'], ctx),
      alternatives: [{ action: 'PRODUCT_INSERT', reason: 'se um asset do produto for fornecido' }, { action: 'TRACKED_CALLOUT', reason: 'se o produto estiver em cena', requires: ['visual_analysis', 'tracking'] }] }));
  }
  const person = first(S, 'PERSON');
  if (person) out.push(cand(m, 'LOWER_THIRD', 'MEDIUM', 'person:intro', `a fala apresenta uma pessoa ("${person.evidence}"); identificar quem fala orienta o espectador`, {
    confidence: person.source.includes('person_intro') ? 'medium' : 'low', signals: pick(S, 'PERSON'),
    visual_intent: vi('identificar quem fala', person.evidence, '(cargo/descrição: exige texto aprovado)', null, ['entra após a apresentação', 'hold ≥ tempo de leitura'], ctx, ...(ctx.intent.editable_in_resolve ? [{ needs: { editable_in_resolve: true } }] : [])),
    alternatives: [{ action: 'NO_ACTION', reason: 'se a pessoa já for conhecida do público' }] }));
  const stat = [...pick(S, 'NUMBER').filter((s) => s.role === 'statistic'), ...pick(S, 'PERCENTAGE').filter((s) => s.role === 'statistic')];
  const hookSig = first(S, 'HOOK');
  const hookReasons = hookSig ? [...(first(S, 'QUESTION') ? ['question'] : []), ...(pick(S, 'EMPHASIS').some((e) => e.strength !== 'low') ? ['emphasis'] : []), ...(pick(S, 'NUMBER', 'PERCENTAGE').some((n) => n.role === 'statistic') ? ['statistic'] : []), ...(m.roles.commercial ? ['commercial'] : [])] : [];
  const hook = hookSig && hookReasons.length ? { ...hookSig, strength: 'medium', reasons: hookReasons } : null; // número incidental não sustenta gancho
  if ((stat.length || first(S, 'COMPARISON')) && !quant.length) {
    const values = stat.map((s) => s.evidence); const inHook = !!hook && hook.strength !== 'low';
    out.push(cand(m, 'INFO_CARD', inHook ? 'HIGH' : 'MEDIUM', stat.length ? 'info:statistic' : 'info:comparison', `a fala traz ${stat.length ? `um dado (${values.join(', ')})` : 'uma comparação'}${inHook ? ' no gancho de abertura' : ''}; dado visualizado é mais fácil de reter`, {
      confidence: 'medium', signals: pick(S, 'NUMBER', 'PERCENTAGE', 'COMPARISON', 'HOOK', 'QUESTION'),
      visual_intent: vi(inHook ? 'gancho: tornar o dado memorável' : 'tornar o dado retível', values.join(' / ') || first(S, 'COMPARISON').evidence, null, null, ['valor aparece com a fala', ...(values.length ? ['contador opcional até o valor final'] : [])], ctx, { data: { values } }),
      alternatives: [{ action: 'TEXT_EMPHASIS', reason: 'versão tipográfica simples do dado' }, { action: 'NO_ACTION', reason: 'se o dado for incidental à mensagem' }] }));
  } else if (hook && hook.strength !== 'low' && !quant.length && !cta) {
    const key = first(S, 'QUESTION')?.evidence ?? first(S, 'EMPHASIS')?.evidence ?? m.text;
    out.push(cand(m, 'TYPOGRAPHY_MOTION', isFocus(ctx.intent, ['HOOK']) ? 'HIGH' : 'MEDIUM', 'hook:opening', `abertura do vídeo com ${hook.reasons.join('/') || 'ênfase'}: o gancho decide a retenção dos primeiros segundos`, {
      confidence: 'low', signals: pick(S, 'HOOK', 'QUESTION', 'EMPHASIS'), visual_intent: vi('reforçar o gancho de abertura', key, null, null, ['tipografia entra com a fala', 'sem competir com o rosto'], ctx),
      alternatives: [{ action: 'NO_ACTION', reason: 'se a fala e o enquadramento já sustentam o gancho' }] }));
  }
  if (!out.some((c) => ACTIONS[c.action].visual)) {
    const proof = first(S, 'PROOF'); const offer = offerTerms[0]; const ben = first(S, 'BENEFIT'); const dl = first(S, 'DEADLINE'); const date = first(S, 'DATE');
    const loc = first(S, 'LOCATION'); const brand = first(S, 'BRAND');
    if (proof) out.push(cand(m, 'TEXT_EMPHASIS', 'MEDIUM', 'proof:lexicon', `a fala traz prova/garantia ("${proof.evidence}"), que sustenta a credibilidade da mensagem`, { signals: pick(S, 'PROOF'), visual_intent: vi('reforçar a prova', proof.evidence, null, null, ['ênfase curta'], ctx), alternatives: [{ action: 'NO_ACTION', reason: 'se a prova não for central' }] }));
    else if (offer) out.push(cand(m, 'TEXT_EMPHASIS', 'MEDIUM', 'offer:unquantified', `a fala menciona uma oferta ("${offer.evidence}") sem valor quantificado`, { signals: pick(S, ...COMMERCIAL), group: 'commercial', visual_intent: vi('sinalizar a oferta', offer.evidence, null, null, ['ênfase curta'], ctx) }));
    else if (brand && ctx.identity.logo_paths.length) {
      const ma = matchAssets(ctx.assets, [brand.term ?? brand.evidence], { action: 'LOGO_BRAND', mediaPool: ctx.mediaPool, logoPaths: ctx.identity.logo_paths });
      out.push(cand(m, 'LOGO_BRAND', isFocus(ctx.intent, ['BRAND']) ? 'MEDIUM' : 'LOW', 'brand:identity', `a fala cita a marca "${brand.evidence}" e a identidade fornece logo`, { confidence: 'low', signals: pick(S, 'BRAND'), candidate_assets: ma, visual_intent: vi('assinatura de marca', brand.evidence, null, null, ['entrada discreta'], ctx) }));
    } else if (ben || loc) {
      const term = (ben ?? loc).term ?? (ben ?? loc).evidence; const ma = matchAssets(ctx.assets, [term, ...(loc ? [loc.evidence] : [])], { action: 'BROLL', orientation: tl?.orientation ?? null, mediaPool: ctx.mediaPool });
      if (['CANDIDATE', 'ASSET_AMBIGUOUS'].includes(ma.status)) out.push(cand(m, 'BROLL', 'LOW', ben ? 'broll:benefit+asset' : 'broll:location+asset', `a fala cita ${ben ? 'um benefício' : 'um lugar'} ("${(ben ?? loc).evidence}") e há vídeo relacionado no índice`, { confidence: 'low', signals: pick(S, 'BENEFIT', 'LOCATION'), candidate_assets: ma, visual_intent: vi('ilustrar o que é dito', (ben ?? loc).evidence, null, null, ['B-roll durante a frase', 'voltar ao apresentador na conclusão'], ctx) }));
      else if (ben) out.push(cand(m, 'TEXT_EMPHASIS', 'LOW', 'benefit:lexicon', `a fala cita um benefício ("${ben.evidence}")`, { confidence: 'low', signals: pick(S, 'BENEFIT'), visual_intent: vi('destacar o benefício', ben.evidence, null, null, ['ênfase curta'], ctx) }));
    } else if (dl || (date && !m.roles.commercial)) out.push(cand(m, 'TEXT_EMPHASIS', 'LOW', 'date:lexicon', `a fala traz uma data/prazo ("${(date ?? dl).evidence}")`, { confidence: 'low', signals: pick(S, 'DATE', 'DEADLINE'), visual_intent: vi('fixar a data', (date ?? dl).evidence, null, null, ['ênfase curta'], ctx) }));
    else if (pick(S, 'EMPHASIS').some((e) => e.strength === 'medium') && pick(S, 'EMPHASIS').some((e) => e.strength === 'low')) out.push(cand(m, 'TEXT_EMPHASIS', 'LOW', 'emphasis:combined', 'ênfase marcada (exclamação + intensificador)', { confidence: 'low', signals: pick(S, 'EMPHASIS'), visual_intent: vi('acompanhar a ênfase', pick(S, 'EMPHASIS').find((e) => e.strength === 'low').evidence, null, null, ['ênfase curta'], ctx) }));
  }
  const rep = pick(S, 'REPETITION')[0];
  if (rep && ctx.seenGroups.has(rep.group) && m.start - ctx.seenGroups.get(rep.group) <= 15) out.push(cand(m, 'CUT_CANDIDATE', ctx.intent.pace === 'fast' ? 'MEDIUM' : 'LOW', 'pacing:repetition', `repete "${rep.evidence}" dita há ${roundS(m.start - ctx.seenGroups.get(rep.group))} s: candidato a corte (o editor decide qual tomada fica)`, { confidence: 'medium', signals: [rep] }));
  if (rep && !ctx.seenGroups.has(rep.group)) ctx.seenGroups.set(rep.group, m.start);
  const tr = pick(S, 'TRANSITION').find((t) => t.source.includes('gap>='));
  if (tr && ctx.mode === 'EXPRESSIVE' && !out.some((c) => c.action === 'CUT_CANDIDATE')) out.push(cand(m, 'TRANSITION_SUPPORT', 'LOW', 'structure:topic_boundary', `mudança de bloco (${tr.evidence}): uma transição simples pode marcar o novo assunto`, { confidence: 'low', signals: [tr], start: m.start, end: Math.min(m.end, m.start + 0.5) }));
  if (!out.some((c) => ACTIONS[c.action].visual)) {
    const nums = pick(S, 'NUMBER').filter((s) => s.role === 'incidental'); const model = first(S, 'MODEL');
    const reason = nums.length ? `número incidental ("${nums.map((n) => n.evidence).join('", "')}") sem contexto comercial nem estatístico: destacar seria ruído`
      : model ? `código de modelo ("${model.evidence}") isolado, sem produto/oferta associados` : S.some((s) => ['QUESTION', 'EMPHASIS'].includes(s.type)) ? 'pergunta/ênfase sem informação a reter: a fala basta'
        : S.length ? `sinais fracos (${[...new Set(S.map((s) => s.type))].join(', ')}) sem informação editorial a reforçar` : 'fala comum, sem sinal editorial: a edição não precisa de reforço visual';
    out.push(cand(m, 'NO_ACTION', 'NONE', 'no_action:default', reason, { confidence: nums.length ? 'high' : 'medium', signals: S }));
  }
  return out;
}

export { readability, timeFields };
