// NORMALIZER (R8): cues de qualquer parser → bold.transcript/1 canônico. Determinístico (mesma entrada → mesmos
// bytes; sem timestamps de geração). Honesto: granularidade, origem do timing, confidence e fps declarados.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAny, parseDavinciInspect, TranscriptError } from './parsers.mjs';
import { parseFps, framesToTc, secondsToFrames, roundS } from './time.mjs';
import { validate } from '../../core/schema/validate.mjs';

export const SCHEMA = 'bold.transcript/1';
const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'bold.transcript.schema.json');
let schemaDoc = null;
export const transcriptSchema = () => (schemaDoc ??= JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * @param {string} raw  conteúdo do arquivo
 * @param {{name?:string, language?:string|null, fps?:string|number|null, dropFrame?:boolean, davinciInspect?:object, track?:number|null}} o
 */
export function normalize(raw, o = {}) {
  let dv = o.davinciInspect ?? null;
  if (!dv && typeof raw === 'string' && raw.trimStart().startsWith('{')) { try { const j = JSON.parse(raw); if (j?.schema === 'bold.davinci.inspect/1') dv = j; } catch { /* parseAny reporta */ } }
  const parsed = dv ? parseDavinciInspect(dv, { track: o.track ?? null }) : parseAny(raw, o.name ?? '');
  if (parsed.canonical) return revalidate(parsed.canonical);
  const warnings = [...parsed.warnings];
  const cues = parsed.cues.map((c, i) => ({ ...c, _i: i }));
  // fail-closed de tempo
  for (const c of cues) {
    const where = c.line ? `linha ${c.line}` : `cue ${c._i}`;
    if (!(Number.isFinite(c.start) && Number.isFinite(c.end)) || c.start < 0) throw new TranscriptError('TRANSCRIPT_MALFORMED', `${where}: tempo inválido`);
    if (c.end <= c.start) throw new TranscriptError('TRANSCRIPT_MALFORMED', `${where}: fim (${c.end}s) não é posterior ao início (${c.start}s)`);
    for (const w of c.words) if (!(w.end >= w.start) || w.start < 0) throw new TranscriptError('TRANSCRIPT_MALFORMED', `${where}: palavra "${w.text}" com tempo inválido`);
  }
  if (!cues.length) throw new TranscriptError('TRANSCRIPT_EMPTY', 'nenhum segmento com texto');
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end || a._i - b._i);
  if (sorted.some((c, i) => c._i !== i)) warnings.push({ code: 'REORDERED_BY_START' });
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) warnings.push({ code: 'OVERLAP', a: `s${String(i).padStart(4, '0')}`, b: `s${String(i + 1).padStart(4, '0')}` });

  // base de tempo: fps só da origem (DaVinci) ou do usuário (--fps); nunca inventado
  let tb = parsed.time_base ?? null;
  if (!tb && o.fps != null) { const f = parseFps(o.fps); tb = { fps: f.exact, fps_float: f.float, drop_frame: !!o.dropFrame, fps_source: 'user', origin_frame: null, origin_tc: null, frames: 'derived' }; }
  const fpsObj = tb ? parseFps(tb.fps) : null;
  const segments = sorted.map((c, i) => {
    const seg = { id: `s${String(i + 1).padStart(4, '0')}`, start: roundS(c.start), end: roundS(c.end) };
    if (fpsObj) {
      seg.start_frame = c.start_frame ?? secondsToFrames(c.start, fpsObj); seg.end_frame = c.end_frame ?? secondsToFrames(c.end, fpsObj);
      if (tb.origin_frame !== null) seg.tl_in_tc = framesToTc(tb.origin_frame + seg.start_frame, fpsObj, tb.drop_frame);
    }
    seg.text = c.text; seg.speaker = c.speaker ?? null; seg.confidence = c.confidence ?? null;
    seg.granularity = c.words.length ? 'WORD' : 'SEGMENT';
    seg.words = c.words.map((w) => ({ start: roundS(w.start), end: roundS(w.end), text: w.text, confidence: w.confidence ?? null, ...(w.speaker ? { speaker: w.speaker } : {}) }));
    if (seg.words.some((w) => w.start < seg.start - 0.001 || w.end > seg.end + 0.001)) warnings.push({ code: 'WORD_OUTSIDE_SEGMENT', segment: seg.id });
    return seg;
  });
  const withWords = segments.filter((s) => s.words.length).length;
  const confSeg = segments.filter((s) => s.confidence !== null).length;
  const language = o.language ?? parsed.language ?? null;
  const durationTl = parsed.davinci?.duration_frames && fpsObj ? roundS((parsed.davinci.duration_frames * fpsObj.den) / fpsObj.num) : null;
  const doc = {
    schema: SCHEMA,
    source: { format: parsed.format, name: o.name ? path.basename(o.name) : null, sha256: sha(typeof raw === 'string' && raw ? raw : JSON.stringify(dv)), provider: parsed.provider ?? null,
      ...(parsed.davinci ? { davinci: parsed.davinci } : {}) },
    language, language_source: o.language ? 'user' : parsed.language ? 'source' : null,
    duration: durationTl ?? segments[segments.length - 1].end, duration_source: durationTl ? 'timeline' : 'last_segment_end',
    time_base: tb ?? { fps: null, fps_float: null, drop_frame: null, fps_source: null, origin_frame: null, origin_tc: null, frames: null },
    timing: { unit: 'seconds', granularity: withWords === 0 ? 'SEGMENT' : withWords === segments.length ? 'WORD' : 'MIXED', word_timing_origin: withWords ? parsed.word_timing_origin : null,
      confidence: confSeg === 0 ? 'none' : confSeg === segments.length ? 'source' : 'partial', speakers: segments.some((s) => s.speaker) ? 'source' : 'none' },
    speakers: [...new Set(segments.map((s) => s.speaker).filter(Boolean))].sort(),
    segments,
    warnings,
  };
  return revalidate(doc);
}

function revalidate(doc) {
  const errs = validate(transcriptSchema(), doc);
  if (errs.length) throw new TranscriptError('TRANSCRIPT_INVALID', 'documento não conforma bold.transcript/1', errs.slice(0, 20));
  return doc;
}

export const canonicalJson = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
export const transcriptSha = (doc) => sha(JSON.stringify(doc));

export function loadTranscript(file, o = {}) {
  if (!fs.existsSync(file)) throw new TranscriptError('INPUT_MISSING', `arquivo não existe: ${path.basename(file)}`);
  return normalize(fs.readFileSync(file, 'utf8'), { name: file, ...o });
}

export function summarize(doc) {
  const words = doc.segments.reduce((n, s) => n + s.words.length, 0);
  return { format: doc.source.format, segments: doc.segments.length, words, duration: doc.duration, duration_source: doc.duration_source, language: doc.language,
    granularity: doc.timing.granularity, word_timing_origin: doc.timing.word_timing_origin, confidence: doc.timing.confidence, speakers: doc.speakers,
    fps: doc.time_base.fps, fps_source: doc.time_base.fps_source, drop_frame: doc.time_base.drop_frame, warnings: doc.warnings.length };
}
