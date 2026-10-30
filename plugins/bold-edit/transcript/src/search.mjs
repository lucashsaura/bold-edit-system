// BUSCA + EXPORT TEXTUAL (R8). Busca: frase sem distinção de acento/caixa, janela de tempo e speaker; timing por
// palavra só quando a origem tem palavras alinhadas. Export: SRT/VTT/TXT/MD/JSON (texto; NUNCA vídeo).
import { tokenize, normWords, alignWords } from './text.mjs';
import { formatClock, roundS } from './time.mjs';
import { canonicalJson } from './normalize.mjs';

/** @param {object} doc bold.transcript/1 · query '' = listar segmentos da janela */
export function search(doc, query = '', { from = null, to = null, speaker = null } = {}) {
  const q = normWords(query);
  const hits = [];
  for (const seg of doc.segments) {
    if (from !== null && seg.end <= from) continue;
    if (to !== null && seg.start >= to) continue;
    if (speaker !== null && seg.speaker !== speaker) continue;
    const base = { transcript: doc.source.name, segment_id: seg.id, start: seg.start, end: seg.end, speaker: seg.speaker, text: seg.text };
    if (!q.length) { hits.push({ ...base, match: null }); continue; }
    const toks = tokenize(seg.text); const map = alignWords(toks, seg.words);
    for (let i = 0; i + q.length <= toks.length; i++) {
      if (!q.every((w, k) => toks[i + k].norm === w)) continue;
      const j = i + q.length - 1;
      const timed = map && map[i] !== null && map[j] !== null;
      hits.push({ ...base, match: { evidence: seg.text.slice(toks[i].start, toks[j].end), start: timed ? seg.words[map[i]].start : seg.start, end: timed ? seg.words[map[j]].end : seg.end, span_timing: timed ? 'word' : 'segment' } });
    }
  }
  return { schema: 'bold.transcript-search/1', query, window: { from, to }, speaker, count: hits.length, hits };
}

export const EXPORT_FORMATS = ['srt', 'vtt', 'txt', 'md', 'json'];

export function exportTranscript(doc, format) {
  const segs = doc.segments;
  if (format === 'json') return canonicalJson(doc);
  if (format === 'srt') return `${segs.map((s, i) => `${i + 1}\n${formatClock(s.start)} --> ${formatClock(s.end)}\n${s.text}\n`).join('\n')}`;
  if (format === 'vtt') {
    const cue = (s) => {
      const body = s.words.length && alignWords(tokenize(s.text), s.words) ? s.words.map((w, i) => (i === 0 ? w.text : `<${formatClock(w.start, { vtt: true })}>${w.text}`)).join(' ') : s.text;
      return `${s.id}\n${formatClock(s.start, { vtt: true })} --> ${formatClock(s.end, { vtt: true })}\n${s.speaker ? `<v ${s.speaker}>` : ''}${body}\n`;
    };
    return `WEBVTT${doc.language ? `\nLanguage: ${doc.language}` : ''}\n\n${segs.map(cue).join('\n')}`;
  }
  if (format === 'txt') return `${segs.map((s) => s.text.replace(/\n/g, ' ')).join('\n')}\n`;
  if (format === 'md') {
    const head = [`# Transcript — ${doc.source.name ?? doc.source.format}`, '', `- formato: ${doc.source.format} · idioma: ${doc.language ?? 'n/d'} · duração: ${roundS(doc.duration)} s · granularidade: ${doc.timing.granularity}`, ''];
    return `${[...head, ...segs.map((s) => `- \`${formatClock(s.start, { vtt: true })}\`${s.speaker ? ` **${s.speaker}:**` : ''} ${s.text.replace(/\n/g, ' ')}${s.confidence !== null && s.confidence < 0.6 ? ' _(confiança baixa)_' : ''}`)].join('\n')}\n`;
  }
  throw Object.assign(new Error(`formato de export inválido: ${format} (${EXPORT_FORMATS.join('|')})`), { code: 'USAGE' });
}
