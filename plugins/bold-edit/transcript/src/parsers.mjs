// PARSERS (R8): entrada → cues intermediários { start, end (s), text, words[], speaker, confidence, start_frame?, end_frame? }.
// Fail-closed: estrutura malformada → TranscriptError com localização. Nada é inventado: sem timing por palavra na
// origem → words = []; sem speaker → null; sem confidence → null; sem fps → null.
import { parseClock, parseFps, framesToSeconds, framesToTc, TimeError } from './time.mjs';
import { nfc } from './text.mjs';

export class TranscriptError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '', '&quot;': '"', '&apos;': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (m) => ENT[m]);
const clean = (s) => nfc(decode(s.replace(/\{\\[^}]*\}/g, '').replace(/<\/?(?:i|b|u|s|font|c|ruby|rt|lang)(?:[.\s][^>]*)?>/gi, ''))).replace(/[ \t]+/g, ' ').trim();
const lines = (raw) => raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
const clock = (s, o, where) => { try { return parseClock(s, o) / 1000; } catch (e) { throw new TranscriptError('TRANSCRIPT_MALFORMED', `${where}: ${e.message}`); } };

function blocks(ls) {
  const out = []; let cur = null;
  ls.forEach((l, i) => { if (l.trim() === '') { if (cur) out.push(cur); cur = null; } else (cur ??= { line: i + 1, lines: [] }).lines.push(l); });
  if (cur) out.push(cur);
  return out;
}

export function parseSRT(raw) {
  const cues = []; const warnings = [];
  for (const b of blocks(lines(raw))) {
    let k = 0;
    if (/^\d+\s*$/.test(b.lines[0]) && b.lines.length > 1) k = 1;
    const m = /^\s*(\S+)\s*-->\s*(\S+)/.exec(b.lines[k] ?? '');
    if (!m) throw new TranscriptError('TRANSCRIPT_MALFORMED', `SRT linha ${b.line + k}: linha de tempo ausente ("HH:MM:SS,mmm --> HH:MM:SS,mmm")`);
    const where = `SRT linha ${b.line + k}`;
    const start = clock(m[1], {}, where); const end = clock(m[2], {}, where);
    const text = b.lines.slice(k + 1).map(clean).filter(Boolean).join('\n');
    if (!text) { warnings.push({ code: 'EMPTY_CUE', line: b.line }); continue; }
    cues.push({ start, end, text, words: [], speaker: null, confidence: null, line: b.line });
  }
  return { format: 'srt', language: null, cues, warnings, word_timing_origin: null };
}

const VTT_TS = /<(\d{2,}:)?(\d{2}):(\d{2})\.(\d{3})>/g;

function vttCueText(rawLines, cueStart, cueEnd, where, warnings) {
  const joined = rawLines.join('\n');
  const voices = [...joined.matchAll(/<v(?:\.[^\s>]+)?\s+([^>]+)>/g)].map((m) => clean(m[1]));
  const distinct = [...new Set(voices)];
  if (distinct.length > 1) warnings.push({ code: 'MULTIPLE_VOICES_IN_CUE', where });
  const noVoice = joined.replace(/<\/?v(?:[.\s][^>]*)?>/g, '');
  // timestamps inline (karaoke): só viram timing por palavra se CADA trecho entre timestamps tiver exatamente 1 palavra
  let words = [];
  if (VTT_TS.test(noVoice)) {
    VTT_TS.lastIndex = 0;
    const chunks = []; let last = 0; let t = cueStart;
    for (const m of noVoice.matchAll(VTT_TS)) {
      chunks.push({ t, text: clean(noVoice.slice(last, m.index)) });
      t = clock(m[0].slice(1, -1), { vtt: true }, where); last = m.index + m[0].length;
    }
    chunks.push({ t, text: clean(noVoice.slice(last)) });
    const real = chunks.filter((c) => c.text);
    if (real.length && real.every((c) => c.text.split(/\s+/).length === 1) && real.every((c, i) => i === 0 || c.t > real[i - 1].t)) {
      words = real.map((c, i) => ({ start: c.t, end: i + 1 < real.length ? real[i + 1].t : cueEnd, text: c.text, confidence: null }));
    } else warnings.push({ code: 'INLINE_TIMESTAMPS_NOT_PER_WORD', where });
  }
  const text = noVoice.replace(VTT_TS, '').split('\n').map(clean).filter(Boolean).join('\n');
  return { text, speaker: distinct.length === 1 ? distinct[0] : null, words };
}

export function parseVTT(raw) {
  const ls = lines(raw);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(ls[0] ?? '')) throw new TranscriptError('TRANSCRIPT_MALFORMED', 'VTT: a primeira linha precisa ser "WEBVTT"');
  const bs = blocks(ls); const cues = []; const warnings = [];
  let language = null;
  for (const l of bs[0].lines.slice(1)) { const m = /^Language:\s*(\S+)/i.exec(l); if (m) language = m[1]; }
  for (const b of bs.slice(1)) {
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(b.lines[0])) continue;
    const k = b.lines[0].includes('-->') ? 0 : 1;
    const m = /^\s*(\S+)\s+-->\s+(\S+)/.exec(b.lines[k] ?? '');
    if (!m) throw new TranscriptError('TRANSCRIPT_MALFORMED', `VTT linha ${b.line + k}: linha de tempo ausente ("MM:SS.mmm --> MM:SS.mmm")`);
    const where = `VTT linha ${b.line + k}`;
    const start = clock(m[1], { vtt: true }, where); const end = clock(m[2], { vtt: true }, where);
    const c = vttCueText(b.lines.slice(k + 1), start, end, where, warnings);
    if (!c.text) { warnings.push({ code: 'EMPTY_CUE', line: b.line }); continue; }
    cues.push({ start, end, text: c.text, words: c.words, speaker: c.speaker, confidence: null, line: b.line });
  }
  return { format: 'vtt', language, cues, warnings, word_timing_origin: cues.some((c) => c.words.length) ? 'vtt inline timestamps' : null };
}

const prob = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 1e4) / 1e4 : null);
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e4) / 1e4 : null);

/** whisper.cpp `-ojf`: transcription[].offsets (ms) + tokens[].{text, offsets, p}. Tokens → palavras (espaço inicial abre palavra). */
function parseWhisperCpp(j) {
  const cues = []; const warnings = [];
  j.transcription.forEach((s, i) => {
    const where = `transcription[${i}]`;
    if (!s?.offsets || typeof s.offsets.from !== 'number' || typeof s.offsets.to !== 'number') throw new TranscriptError('TRANSCRIPT_MALFORMED', `${where}: offsets ausentes`);
    const text = clean(String(s.text ?? '')); if (!text) return;
    const toks = (s.tokens ?? []).filter((t) => typeof t?.text === 'string' && !/^\s*(\[_|<\|)/.test(t.text) && t.text.trim() !== '');
    const words = []; const ps = [];
    for (const t of toks) {
      if (typeof t.p === 'number') ps.push(t.p);
      const off = t.offsets && typeof t.offsets.from === 'number' && typeof t.offsets.to === 'number' ? t.offsets : null;
      const startsWord = /^\s/.test(t.text) || !words.length;
      const piece = t.text.trim();
      if (startsWord && /[\p{L}\p{N}]/u.test(piece)) words.push({ start: off ? off.from / 1000 : null, end: off ? off.to / 1000 : null, text: piece, ps: typeof t.p === 'number' ? [t.p] : [] });
      else if (words.length) { const w = words[words.length - 1]; w.text += piece; if (off) w.end = off.to / 1000; if (typeof t.p === 'number') w.ps.push(t.p); }
    }
    const timed = words.length && words.every((w) => w.start !== null && w.end !== null);
    cues.push({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text, speaker: null, confidence: mean(ps), line: null,
      words: timed ? words.map((w) => ({ start: w.start, end: w.end, text: w.text, confidence: mean(w.ps) })) : [] });
  });
  return { format: 'whisper-cpp-json', language: j.result?.language ?? j.params?.language ?? null, cues, warnings, provider: 'whisper.cpp', word_timing_origin: cues.some((c) => c.words.length) ? 'whisper.cpp token offsets (aproximado; sem DTW)' : null };
}

/** segments-JSON (openai-whisper / faster-whisper / WhisperX): segments[].{start,end,text,words?[],speaker?} em segundos. */
function parseSegmentsJson(j) {
  const cues = []; const warnings = [];
  j.segments.forEach((s, i) => {
    const where = `segments[${i}]`;
    if (typeof s?.start !== 'number' || typeof s?.end !== 'number') throw new TranscriptError('TRANSCRIPT_MALFORMED', `${where}: start/end (segundos) obrigatórios`);
    const text = clean(String(s.text ?? '')); if (!text) return;
    const ws = Array.isArray(s.words) ? s.words : [];
    const timed = ws.length && ws.every((w) => typeof w?.start === 'number' && typeof w?.end === 'number' && typeof (w.word ?? w.text) === 'string');
    if (ws.length && !timed) warnings.push({ code: 'WORDS_WITHOUT_TIMING_DROPPED', where });
    cues.push({ start: s.start, end: s.end, text, speaker: typeof s.speaker === 'string' && s.speaker ? s.speaker : null, line: null,
      confidence: prob(s.confidence ?? s.probability ?? null),
      words: timed ? ws.map((w) => ({ start: w.start, end: w.end, text: clean(String(w.word ?? w.text)), confidence: prob(w.confidence ?? w.probability ?? w.score ?? null), ...(typeof w.speaker === 'string' ? { speaker: w.speaker } : {}) })).filter((w) => w.text) : [] });
  });
  return { format: 'segments-json', language: typeof j.language === 'string' ? j.language : null, cues, warnings, provider: typeof j.provider === 'string' ? j.provider : null, word_timing_origin: cues.some((c) => c.words.length) ? 'source word timestamps' : null };
}

/** Legendas do DaVinci: JSON de `bold davinci inspect --timeline T --json` (Bridge R7, somente leitura). */
export function parseDavinciInspect(j, { track = null } = {}) {
  const tl = j?.timeline;
  if (j?.schema !== 'bold.davinci.inspect/1' || !tl?.tracks) throw new TranscriptError('TRANSCRIPT_FORMAT_UNSUPPORTED', 'esperado o JSON de `bold davinci inspect --timeline T --json`');
  const subs = tl.tracks.subtitle ?? [];
  if (!subs.length) throw new TranscriptError('NO_SUBTITLE_TRACK', `a timeline ${tl.name} não tem track de legenda`);
  let t;
  if (track !== null) { t = subs.find((s) => s.index === Number(track)); if (!t) throw new TranscriptError('TRACK_NOT_FOUND', `track de legenda ${track} não existe`); } else if (subs.length > 1) throw new TranscriptError('TRACK_AMBIGUOUS', `${subs.length} tracks de legenda; informe --track N`, { tracks: subs.map((s) => s.index) });
  else t = subs[0];
  if (!Array.isArray(t.items)) throw new TranscriptError('TRANSCRIPT_MALFORMED', 'inspect sem itens (use sem --brief)');
  let fps;
  try { fps = parseFps(tl.fps_exact ?? tl.fps); } catch (e) { if (e instanceof TimeError) throw new TranscriptError('FPS_MISSING', 'fps da timeline ausente no inspect'); throw e; }
  const df = !!tl.drop_frame; const origin = tl.start_frame;
  const cues = t.items.map((it, i) => {
    const text = clean(String(it.name ?? ''));
    if (!Number.isInteger(it.tl_in) || !Number.isInteger(it.tl_out)) throw new TranscriptError('TRANSCRIPT_MALFORMED', `item ${i}: tl_in/tl_out inteiros obrigatórios`);
    return { start: framesToSeconds(it.tl_in - origin, fps), end: framesToSeconds(it.tl_out - origin, fps), start_frame: it.tl_in - origin, end_frame: it.tl_out - origin,
      tl_in: it.tl_in, tl_out: it.tl_out, tl_in_tc: it.tl_in_tc ?? framesToTc(it.tl_in, fps, df), text, words: [], speaker: null, confidence: null, line: null };
  }).filter((c) => c.text);
  return { format: 'davinci-subtitles', language: null, cues, warnings: [], word_timing_origin: null,
    time_base: { fps: fps.exact, fps_float: fps.float, drop_frame: df, fps_source: 'source', origin_frame: origin, origin_tc: tl.start_tc ?? null, frames: 'source' },
    davinci: { project: j.project ?? null, timeline: tl.name, timeline_unique_id: tl.unique_id ?? null, track: t.index, duration_frames: tl.duration_frames ?? null } };
}

export function parseJSON(raw) {
  let j; try { j = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new TranscriptError('TRANSCRIPT_MALFORMED', `JSON inválido: ${e.message}`); }
  if (j?.schema === 'bold.transcript/1') return { canonical: j };
  if (j?.schema === 'bold.davinci.inspect/1') return parseDavinciInspect(j);
  if (Array.isArray(j?.transcription)) return parseWhisperCpp(j);
  if (Array.isArray(j?.segments)) return parseSegmentsJson(j);
  throw new TranscriptError('TRANSCRIPT_FORMAT_UNSUPPORTED', 'JSON não reconhecido (bold.transcript/1, whisper.cpp -ojf, segments[] ou bold davinci inspect)');
}

/** Detecta pelo conteúdo (a extensão só desempata). Texto puro sem timing NÃO é aceito (não há tempo honesto). */
export function parseAny(raw, name = '') {
  const head = raw.replace(/^﻿/, '').trimStart();
  if (head.startsWith('WEBVTT')) return parseVTT(raw);
  if (head.startsWith('{')) return parseJSON(raw);
  if (/^(\d+\s*\n)?\s*\d+:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(head.replace(/\r/g, '')) || /\.srt$/i.test(name)) return parseSRT(raw);
  throw new TranscriptError('TRANSCRIPT_FORMAT_UNSUPPORTED', 'formato não reconhecido (SRT, VTT, JSON). Texto puro sem timing não é aceito na V1');
}
