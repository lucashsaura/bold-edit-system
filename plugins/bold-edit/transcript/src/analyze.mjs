// ANÁLISE DESCRITIVA (R8) → bold.transcript-annotations/1. Só CANDIDATOS com evidência (trecho, start/end, regra,
// confidence categórica da REGRA). Nenhuma decisão editorial ("crie motion aqui", "corte", "use B-roll"): isso é R9.
// Léxicos genéricos (pt/en). Termos de produto/marca/nomes do projeto vêm SÓ do vocabulário do projeto (--vocabulary).
import { tokenize, fold, alignWords, nfc } from './text.mjs';
import { transcriptSha } from './normalize.mjs';
import { roundS } from './time.mjs';

export const RULES_VERSION = 'r8.1';
export const TYPES = ['hook_candidate', 'cta_candidate', 'number', 'percentage', 'currency', 'date', 'product_mention', 'offer_mention', 'proper_noun',
  'repeated_phrase', 'question', 'emphasis_candidate', 'topic_boundary'];

const LEX = {
  cta: ['clique', 'clica', 'acesse', 'acessa', 'compre', 'compra ja', 'garanta', 'garante', 'aproveite', 'aproveita', 'inscreva-se', 'se inscreva', 'inscreva', 'siga', 'segue a gente',
    'link na bio', 'chama no', 'chame no', 'fale com', 'fala com a gente', 'entre em contato', 'ligue', 'liga', 'peca ja', 'agende', 'agenda', 'baixe', 'baixa o app', 'venha', 'vem pra',
    'visite', 'confira', 'nao perca', 'corre', 'comente', 'compartilhe', 'salve esse', 'saiba mais', 'faca seu pedido',
    'click', 'subscribe', 'follow', 'buy now', 'order now', 'call us', 'visit', 'sign up', 'download', 'book now', "don't miss", 'link in bio', 'shop now', 'learn more'],
  offer: ['promocao', 'promo', 'oferta', 'desconto', 'gratis', 'gratuito', 'frete gratis', 'cupom', 'black friday', 'liquidacao', 'por apenas', 'a partir de', 'sem juros', 'parcelas',
    'parcelado', 'brinde', 'condicao especial', 'so hoje', 'ultimas unidades', 'leve', 'pague', 'off',
    'sale', 'discount', 'free', 'deal', 'offer', 'coupon', 'limited time', 'only today', 'free shipping'],
  interrogative: ['como', 'por que', 'o que', 'qual', 'quais', 'quando', 'onde', 'quem', 'quanto', 'quantos', 'sera que', 'voce sabia', 'ja pensou', 'what', 'why', 'how', 'when', 'where', 'who', 'which', 'do you', 'did you', 'have you', 'are you', 'is it'],
  intensifier: ['muito', 'demais', 'nunca', 'sempre', 'realmente', 'incrivel', 'absurdo', 'impressionante', 'super', 'extremamente', 'never', 'always', 'really', 'amazing', 'incredible', 'huge'],
  marker: ['agora', 'entao', 'outra coisa', 'por fim', 'primeiro', 'segundo', 'terceiro', 'alem disso', 'vamos falar', 'mas antes', 'next', 'now', 'first', 'second', 'finally', 'another thing'],
  stop: new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'que', 'em', 'um', 'uma', 'para', 'pra', 'com', 'no', 'na', 'nos', 'nas', 'se', 'por', 'mais', 'as', 'os', 'eu', 'voce', 'ele', 'ela', 'isso',
    'esse', 'essa', 'the', 'and', 'of', 'to', 'in', 'is', 'it', 'you', 'that', 'for', 'on', 'with', 'this', 'é', 'ou', 'mas', 'nao', 'sim', 'ja', 'tem', 'ter', 'ta', 'tá']),
  numberWords: ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'cem', 'cento', 'mil', 'milhao', 'milhoes',
    'one', 'two', 'three', 'four', 'five', 'ten', 'hundred', 'thousand', 'million'],
};
const MONTHS = 'janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|january|february|march|april|may|june|july|august|september|october|november|december';
const WEEKDAYS = ['segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado', 'domingo', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const RX = {
  currency: /(?:R\$|US\$|\$|€|£)\s?\d[\d.,]*(?:\s?(?:mil|milh(?:ão|ões)|k))?|\b\d[\d.,]*\s?(?:reais|real|d[óo]lares|euros|dollars|bucks)\b/giu,
  percentage: /\b\d+(?:[.,]\d+)?\s?(?:%|por\s?cento|percent)/giu,
  date: new RegExp(`\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b|\\b\\d{1,2}\\s+de\\s+(?:${MONTHS})(?:\\s+de\\s+\\d{4})?\\b|\\b(?:${MONTHS})\\s+(?:de\\s+)?\\d{4}\\b|\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'giu'),
  number: /(?<![\p{L}\d$€£])\d+(?:[.,]\d+)*(?![\p{L}\d])/gu,
  model: /\b(?=[\p{Lu}\d-]*\d)(?=[\p{Lu}\d-]*\p{Lu})[\p{Lu}\d]{1,6}(?:-[\p{Lu}\d]{1,6})?\b/gu,
};

const seqFind = (tokens, phrase) => {
  const p = phrase.split(/\s+/).map(fold); const hits = [];
  for (let i = 0; i + p.length <= tokens.length; i++) if (p.every((w, k) => tokens[i + k].norm === w || tokens[i + k].norm === w.replace(/-/g, ''))) hits.push([i, i + p.length - 1]);
  return hits;
};

/** Constrói a anotação com timing por palavra quando o alinhamento texto↔words é exato; senão, do segmento. */
function mk(seg, ctx, type, charStart, charEnd, rule, confidence, extra = {}) {
  let start = seg.start; let end = seg.end; let span = 'segment';
  if (ctx.map) {
    const idx = ctx.tokens.map((t, i) => (t.end > charStart && t.start < charEnd ? i : -1)).filter((i) => i >= 0);
    if (idx.length && idx.every((i) => ctx.map[i] !== null)) { start = seg.words[ctx.map[idx[0]]].start; end = seg.words[ctx.map[idx[idx.length - 1]]].end; span = 'word'; }
  }
  return { type, segment_id: seg.id, start: roundS(start), end: roundS(end), span_timing: span, evidence: nfc(seg.text.slice(charStart, charEnd)), rule, confidence, ...extra, _c: charStart };
}
const tokSpan = (ctx, a, b) => [ctx.tokens[a].start, ctx.tokens[b].end];

/** @param {object} doc bold.transcript/1 · @param {{vocabulary?:{products?:string[], proper_nouns?:string[]}, hookWindow?:number, gap?:number}} o */
export function analyze(doc, o = {}) {
  const vocab = o.vocabulary ?? {}; const hookWindow = o.hookWindow ?? 5; const gapS = o.gap ?? 2;
  const out = [];
  const segs = doc.segments.map((seg) => { const tokens = tokenize(seg.text); return { seg, ctx: { tokens, map: alignWords(tokens, seg.words) } }; });
  for (const { seg, ctx } of segs) {
    const T = seg.text; const taken = new Set();
    for (const [type, rx, conf] of [['currency', RX.currency, 'high'], ['percentage', RX.percentage, 'high'], ['date', RX.date, 'high']]) {
      for (const m of T.matchAll(rx)) { out.push(mk(seg, ctx, type, m.index, m.index + m[0].length, `regex:${type}`, conf)); for (let i = m.index; i < m.index + m[0].length; i++) taken.add(i); }
    }
    for (const m of T.matchAll(RX.number)) if (!taken.has(m.index)) out.push(mk(seg, ctx, 'number', m.index, m.index + m[0].length, 'regex:digits', 'high', { value: Number(m[0].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) }));
    ctx.tokens.forEach((t, i) => { if (LEX.numberWords.includes(t.norm) && !(t.norm === 'um' || t.norm === 'one')) out.push(mk(seg, ctx, 'number', ...tokSpan(ctx, i, i), 'lexicon:number_word', 'medium')); });
    for (const p of vocab.products ?? []) for (const [a, b] of seqFind(ctx.tokens, p)) out.push(mk(seg, ctx, 'product_mention', ...tokSpan(ctx, a, b), 'vocabulary:products', 'high', { term: p }));
    for (const m of T.matchAll(RX.model)) if (!/^\d+$/.test(m[0]) && m[0].length >= 2) out.push(mk(seg, ctx, 'product_mention', m.index, m.index + m[0].length, 'regex:model_code', 'low'));
    for (const p of LEX.offer) for (const [a, b] of seqFind(ctx.tokens, p)) out.push(mk(seg, ctx, 'offer_mention', ...tokSpan(ctx, a, b), 'lexicon:offer', 'medium', { term: p }));
    for (const p of LEX.cta) for (const [a, b] of seqFind(ctx.tokens, p)) out.push(mk(seg, ctx, 'cta_candidate', ...tokSpan(ctx, a, b), 'lexicon:cta', 'medium', { term: p, position_ratio: roundS(seg.start / Math.max(doc.duration, 1e-9)) }));
    // perguntas: "?" (alta) ou interrogativo no início da frase sem "?" (baixa)
    const qs = [...T.matchAll(/(?:[^.!?\n]|\.(?=\d))*\?/g)];
    for (const m of qs) { const lead = m[0].length - m[0].trimStart().length; out.push(mk(seg, ctx, 'question', m.index + lead, m.index + m[0].length, 'punctuation:?', 'high')); }
    if (!qs.length) for (const p of LEX.interrogative) { const h = seqFind(ctx.tokens, p).find(([a]) => a === 0); if (h) { out.push(mk(seg, ctx, 'question', ctx.tokens[0].start, T.length, 'lexicon:interrogative_start', 'low', { term: p })); break; } }
    // ênfase: "!" · intensificadores · palavra em CAIXA ALTA (≥ 5 letras)
    for (const m of T.matchAll(/(?:[^.!?\n]|\.(?=\d))*!+/g)) { const lead = m[0].length - m[0].trimStart().length; out.push(mk(seg, ctx, 'emphasis_candidate', m.index + lead, m.index + m[0].length, 'punctuation:!', 'medium')); }
    ctx.tokens.forEach((t, i) => {
      if (LEX.intensifier.includes(t.norm)) out.push(mk(seg, ctx, 'emphasis_candidate', ...tokSpan(ctx, i, i), 'lexicon:intensifier', 'low', { term: t.norm }));
      if (/^\p{Lu}{5,}$/u.test(t.text)) out.push(mk(seg, ctx, 'emphasis_candidate', ...tokSpan(ctx, i, i), 'case:all_caps', 'low'));
    });
    // nomes próprios: vocabulário (alta) · sigla 2–4 letras (baixa) · Capitalizada fora de início de frase (baixa, sequências unidas)
    for (const p of vocab.proper_nouns ?? []) for (const [a, b] of seqFind(ctx.tokens, p)) out.push(mk(seg, ctx, 'proper_noun', ...tokSpan(ctx, a, b), 'vocabulary:proper_nouns', 'high', { term: p }));
    for (let i = 0; i < ctx.tokens.length; i++) {
      const t = ctx.tokens[i];
      if (/^\p{Lu}{2,4}$/u.test(t.text)) { out.push(mk(seg, ctx, 'proper_noun', ...tokSpan(ctx, i, i), 'case:acronym', 'low', { subtype: 'acronym' })); continue; }
      const sentenceStart = i === 0 || /[.!?:\n"“]\s*$/.test(T.slice(0, t.start));
      if (/^\p{Lu}\p{Ll}+/u.test(t.text) && !sentenceStart && !LEX.stop.has(t.norm)) {
        let j = i; while (j + 1 < ctx.tokens.length && /^\p{Lu}\p{Ll}*/u.test(ctx.tokens[j + 1].text) && /^\s+$/.test(T.slice(ctx.tokens[j].end, ctx.tokens[j + 1].start) || ' ')) j++;
        out.push(mk(seg, ctx, 'proper_noun', ...tokSpan(ctx, i, j), 'case:capitalized_mid_sentence', 'low')); i = j;
      }
    }
  }
  // frases repetidas: n-gramas (3..6 palavras, não só stopwords) em ≥ 2 segmentos; mantém os maximais
  const grams = new Map();
  for (const { seg, ctx } of segs) for (let n = 6; n >= 3; n--) for (let i = 0; i + n <= ctx.tokens.length; i++) {
    const ws = ctx.tokens.slice(i, i + n).map((t) => t.norm); if (ws.every((w) => LEX.stop.has(w))) continue;
    const k = ws.join(' '); if (!grams.has(k)) grams.set(k, []); grams.get(k).push({ seg, ctx, a: i, b: i + n - 1 });
  }
  const rep = [...grams.entries()].filter(([, occ]) => new Set(occ.map((x) => x.seg.id)).size >= 2).sort((x, y) => y[0].split(' ').length - x[0].split(' ').length || (x[0] < y[0] ? -1 : 1));
  const chosen = [];
  for (const [k, occ] of rep) if (!chosen.some(([c, cocc]) => c.includes(k) && cocc.length >= occ.length)) chosen.push([k, occ]);
  chosen.forEach(([k, occ], g) => { for (const x of occ) out.push(mk(x.seg, x.ctx, 'repeated_phrase', ...tokSpan(x.ctx, x.a, x.b), 'ngram:repeated', 'high', { group: `r${g + 1}`, phrase: k, occurrences: occ.length })); });
  // fronteiras de tópico: pausa ≥ gap entre segmentos (média) · marcador discursivo no início (baixa)
  doc.segments.forEach((seg, i) => {
    const ctx = segs[i].ctx;
    if (i > 0 && seg.start - doc.segments[i - 1].end >= gapS) out.push({ type: 'topic_boundary', segment_id: seg.id, start: seg.start, end: seg.start, span_timing: 'segment', evidence: `pausa de ${roundS(seg.start - doc.segments[i - 1].end)} s antes de "${nfc(seg.text).slice(0, 40)}"`, rule: `gap>=${gapS}s`, confidence: 'medium' });
    for (const p of LEX.marker) { const h = seqFind(ctx.tokens, p).find(([a]) => a === 0); if (h) { out.push(mk(seg, ctx, 'topic_boundary', ...tokSpan(ctx, h[0], h[1]), 'lexicon:discourse_marker', 'low', { term: p })); break; } }
  });
  // hook: segmentos que começam na janela inicial; motivos = outras anotações do mesmo segmento (descritivo)
  for (const { seg } of segs.filter(({ seg: s }) => s.start < hookWindow)) {
    const reasons = [...new Set(out.filter((a) => a.segment_id === seg.id && ['question', 'number', 'percentage', 'currency', 'emphasis_candidate', 'offer_mention', 'product_mention'].includes(a.type)).map((a) => a.type))].sort();
    out.push({ type: 'hook_candidate', segment_id: seg.id, start: seg.start, end: seg.end, span_timing: 'segment', evidence: seg.text, rule: `starts<${hookWindow}s`, confidence: reasons.length ? 'medium' : 'low', reasons });
  }
  const ord = (a, b) => a.start - b.start || (a.segment_id < b.segment_id ? -1 : a.segment_id > b.segment_id ? 1 : 0) || (a._c ?? -1) - (b._c ?? -1) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);
  const uniq = []; const seen = new Set();
  for (const a of out.sort(ord)) { const k = `${a.type}|${a.segment_id}|${a.start}|${a.end}|${a.evidence}|${a.rule}`; if (!seen.has(k)) { seen.add(k); uniq.push(a); } }
  const annotations = uniq.map(({ _c, ...a }, i) => ({ id: `a${String(i + 1).padStart(4, '0')}`, ...a }));
  const counts = Object.fromEntries(TYPES.map((t) => [t, annotations.filter((a) => a.type === t).length]));
  return { schema: 'bold.transcript-annotations/1', rules_version: RULES_VERSION, transcript: { sha256: transcriptSha(doc), source_name: doc.source.name, language: doc.language },
    nature: 'DESCRIPTIVE_CANDIDATES — nenhuma decisão editorial (R9)', vocabulary: { products: (vocab.products ?? []).length, proper_nouns: (vocab.proper_nouns ?? []).length },
    counts, annotations };
}
