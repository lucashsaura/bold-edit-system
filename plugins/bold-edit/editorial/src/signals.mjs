// EDITORIAL SIGNALS (R9). Consome a R8 SEM alterá-la: documento bold.transcript/1 + anotações
// bold.transcript-annotations/1 → sinais editoriais por segmento. Sinal ≠ decisão: "15 vezes sem juros" é
// OFFER + NUMBER + EMPHASIS, e ainda não significa MOTION. Léxicos genéricos (pt/en); termos de produto, marca,
// pessoa e lugar vêm SÓ do vocabulário/identidade do projeto.
import { tokenize, fold } from '../../transcript/src/text.mjs';

export const SIGNAL_TYPES = ['HOOK', 'OFFER', 'CTA', 'PRODUCT', 'MODEL', 'NUMBER', 'PRICE', 'PERCENTAGE', 'DATE', 'DEADLINE', 'PAYMENT', 'FEATURE', 'BENEFIT',
  'COMPARISON', 'PROOF', 'LOCATION', 'PERSON', 'BRAND', 'EMPHASIS', 'QUESTION', 'TRANSITION', 'REPETITION'];

const R8_MAP = { percentage: 'PERCENTAGE', currency: 'PRICE', number: 'NUMBER', date: 'DATE', offer_mention: 'OFFER', cta_candidate: 'CTA', question: 'QUESTION',
  emphasis_candidate: 'EMPHASIS', repeated_phrase: 'REPETITION', topic_boundary: 'TRANSITION', hook_candidate: 'HOOK' };

/** Léxicos da R9 (complementam a R8; nunca termos de cliente). */
export const LEX = {
  DEADLINE: ['so ate', 'ate', 'termina', 'ultimo dia', 'ultimos dias', 'so hoje', 'por tempo limitado', 'enquanto durar', 'until', 'ends', 'last day', 'only today', 'limited time'],
  PAYMENT: ['pix', 'cartao', 'boleto', 'a vista', 'debito', 'credito', 'card', 'cash'],
  BENEFIT: ['economize', 'economia', 'ganhe tempo', 'mais rapido', 'mais facil', 'sem complicacao', 'facilita', 'praticidade', 'save', 'faster', 'easier', 'hassle-free'],
  COMPARISON: ['mais que', 'melhor que', 'menos que', 'comparado', 'versus', 'vs', 'do que', 'em relacao', 'than', 'compared', 'better than'],
  PROOF: ['comprovado', 'certificado', 'garantia', 'garantido', 'avaliacao', 'avaliacoes', 'estrelas', 'testado', 'anos de experiencia', 'clientes satisfeitos', 'proven', 'certified', 'guarantee', 'reviews', 'tested'],
  FEATURE: ['recurso', 'recursos', 'funcao', 'tecnologia', 'inclui', 'vem com', 'feature', 'includes', 'comes with'],
  PERSON_INTRO: ['meu nome e', 'eu sou o', 'eu sou a', 'sou o', 'sou a', 'aqui e o', 'aqui e a', 'my name is', "i'm", 'i am'],
  LOCATION_PREP: ['em', 'no', 'na', 'de', 'para', 'in', 'at', 'from'],
  STAT: ['em cada', 'de cada', 'out of', 'in every'],
  CTA: ['clique no link', 'link abaixo', 'link na descricao', 'compre agora', 'chama no whatsapp', 'fale com a gente', 'click the link', 'link below', 'buy now'],
};
const INSTALLMENT = /\b(\d{1,2})\s?(?:x|vezes)\b/giu;
const PERCENT_OFF = /\b\d+(?:[.,]\d+)?\s?%\s?off\b/giu;

const seq = (tokens, phrase) => {
  const p = phrase.split(/\s+/).map(fold); const out = [];
  for (let i = 0; i + p.length <= tokens.length; i++) if (p.every((w, k) => tokens[i + k].norm === w)) out.push([i, i + p.length - 1]);
  return out;
};
const span = (seg, tokens, a, b) => seg.text.slice(tokens[a].start, tokens[b].end);

/**
 * @param {object} doc bold.transcript/1 · @param {object} ann bold.transcript-annotations/1 (R8)
 * @param {{vocabulary?:{people?:string[], locations?:string[], brands?:string[]}, identity?:{brand_names?:string[]}}} o
 * @returns {{schema, transcript_sha256, moments:[{segment_id,start,end,text,speaker,signals:[...] ,roles:{...}}], counts}}
 */
export function extractSignals(doc, ann, o = {}) {
  const vocab = o.vocabulary ?? {}; const brands = [...(o.identity?.brand_names ?? []), ...(vocab.brands ?? [])];
  const bySeg = new Map(doc.segments.map((s) => [s.id, []]));
  for (const a of ann.annotations) {
    const sig = []; const base = { evidence: a.evidence, start: a.start, end: a.end, span_timing: a.span_timing, strength: a.confidence, source: `r8:${a.id}:${a.rule}` };
    if (a.type === 'product_mention') sig.push({ type: a.rule === 'regex:model_code' ? 'MODEL' : 'PRODUCT', ...base, ...(a.term ? { term: a.term } : {}) });
    else if (a.type === 'proper_noun') {
      const ev = fold(a.evidence);
      if (brands.some((b) => fold(b) === ev)) sig.push({ type: 'BRAND', ...base, term: a.evidence });
      else if ((vocab.people ?? []).some((p) => fold(p) === ev)) sig.push({ type: 'PERSON', ...base, term: a.evidence });
      else if ((vocab.locations ?? []).some((p) => fold(p) === ev)) sig.push({ type: 'LOCATION', ...base, term: a.evidence });
      else sig.push({ type: '_PROPER', ...base });
    } else if (a.type === 'hook_candidate') sig.push({ type: 'HOOK', ...base, strength: a.reasons?.length ? 'medium' : 'low', reasons: a.reasons ?? [] });
    else if (R8_MAP[a.type]) sig.push({ type: R8_MAP[a.type], ...base, ...(a.value !== undefined ? { value: a.value } : {}), ...(a.group ? { group: a.group, occurrences: a.occurrences } : {}), ...(a.term ? { term: a.term } : {}), ...(a.position_ratio !== undefined ? { position_ratio: a.position_ratio } : {}) });
    for (const s of sig) bySeg.get(a.segment_id)?.push(s);
  }
  const moments = doc.segments.map((seg, idx) => {
    const tokens = tokenize(seg.text); const sigs = bySeg.get(seg.id) ?? [];
    const add = (type, a, b, rule, strength = 'medium', extra = {}) => sigs.push({ type, evidence: span(seg, tokens, a, b), start: seg.start, end: seg.end, span_timing: 'segment', strength, source: `r9:${rule}`, ...extra });
    for (const k of ['DEADLINE', 'PAYMENT', 'BENEFIT', 'COMPARISON', 'PROOF', 'FEATURE', 'CTA']) for (const p of LEX[k]) for (const [a, b] of seq(tokens, p)) {
      if (k === 'DEADLINE' && p === 'ate' && !sigs.some((s) => s.type === 'DATE')) continue; // "até" só é prazo com data
      add(k, a, b, `lexicon:${k.toLowerCase()}`, k === 'FEATURE' ? 'low' : 'medium', { term: p, char: [tokens[a].start, tokens[b].end] });
    }
    for (const m of seg.text.matchAll(INSTALLMENT)) sigs.push({ type: 'OFFER', evidence: m[0], start: seg.start, end: seg.end, span_timing: 'segment', strength: 'high', source: 'r9:regex:installment', subtype: 'installment', value: Number(m[1]) });
    for (const m of seg.text.matchAll(PERCENT_OFF)) sigs.push({ type: 'OFFER', evidence: m[0], start: seg.start, end: seg.end, span_timing: 'segment', strength: 'high', source: 'r9:regex:percent_off' });
    for (const p of LEX.PERSON_INTRO) for (const [, b] of seq(tokens, p)) {
      const n = tokens[b + 1]; if (n && /^\p{Lu}/u.test(n.text)) { let e = b + 1; while (tokens[e + 1] && /^\p{Lu}/u.test(tokens[e + 1].text)) e++; add('PERSON', b + 1, e, 'lexicon:person_intro', 'medium', { term: span(seg, tokens, b + 1, e) }); }
    }
    for (const s of sigs.filter((x) => x.type === '_PROPER')) {
      const i = tokens.findIndex((t) => seg.text.slice(t.start).startsWith(s.evidence));
      if (s.source.includes('case:acronym') || LEX.PAYMENT.includes(fold(s.evidence))) continue; // sigla/pagamento não é lugar
      if (i > 0 && LEX.LOCATION_PREP.includes(tokens[i - 1].norm)) Object.assign(s, { type: 'LOCATION', strength: 'low', source: `${s.source}+r9:location_prep` });
    }
    const signals = sigs.filter((s) => s.type !== '_PROPER').sort((a, b) => SIGNAL_TYPES.indexOf(a.type) - SIGNAL_TYPES.indexOf(b.type) || (a.evidence < b.evidence ? -1 : 1));
    // papéis dos números: comercial · estatístico · data · incidental (o contexto decide, não o dígito)
    const has = (t) => signals.some((s) => s.type === t);
    const commercial = has('OFFER') || has('PRICE') || signals.some((s) => s.type === 'OFFER' && s.subtype === 'installment');
    const statistic = seq(tokens, 'em cada').length + seq(tokens, 'de cada').length + seq(tokens, 'out of').length > 0 || (has('PERCENTAGE') && !commercial);
    for (const s of signals) if (s.type === 'NUMBER') s.role = commercial ? 'commercial' : statistic ? 'statistic' : has('DATE') && signals.some((d) => d.type === 'DATE' && d.evidence.includes(String(s.value))) ? 'date' : 'incidental';
    for (const s of signals) if (s.type === 'PERCENTAGE') s.role = commercial ? 'commercial' : 'statistic';
    return { segment_id: seg.id, index: idx, start: seg.start, end: seg.end, text: seg.text, speaker: seg.speaker, words: seg.words.length,
      gap_before: idx === 0 ? seg.start : Math.round((seg.start - doc.segments[idx - 1].end) * 1e6) / 1e6, signals,
      roles: { commercial, statistic } };
  });
  const counts = Object.fromEntries(SIGNAL_TYPES.map((t) => [t, moments.reduce((n, m) => n + m.signals.filter((s) => s.type === t).length, 0)]));
  return { schema: 'bold.editorial-signals/1', transcript: { source_name: doc.source.name, format: doc.source.format, sha256: ann.transcript.sha256, timeline: doc.source.davinci?.timeline ?? null },
    nature: 'SINAIS — ainda não são decisões', counts, moments };
}
