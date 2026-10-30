// `bold transcript …` (R8 — Transcript Engine V1). Nenhum comando escreve no DaVinci (leitura via allowlist) nem
// gera mídia. Saídas em arquivo NUNCA sobrescrevem.
//   inspect | normalize | analyze | search | export
import fs from 'node:fs';
import path from 'node:path';
import { loadTranscript, normalize, canonicalJson, summarize } from '../../transcript/src/normalize.mjs';
import { analyze } from '../../transcript/src/analyze.mjs';
import { search, exportTranscript, EXPORT_FORMATS } from '../../transcript/src/search.mjs';
import { parseFps, parseTimeArg, formatClock, TimeError } from '../../transcript/src/time.mjs';
import { TranscriptError } from '../../transcript/src/parsers.mjs';
import { davinciRead } from '../../core/context/davinci-read.mjs';
import { DavinciError } from '../../core/davinci/bridge.mjs';
import { EXIT } from './media.mjs';

const USAGE = `uso: bold transcript <comando> [opções] [--json]
  inspect <arquivo> | --davinci --timeline T [--track N]       resumo (formato, segmentos, granularidade, fps, speakers)
  normalize <arquivo> [--output f.json] [--language xx] [--fps F]  → bold.transcript/1 (stdout ou arquivo novo)
  analyze <arquivo> [--vocabulary vocab.json] [--output f.json]  → bold.transcript-annotations/1 (candidatos descritivos)
  search "<frase>" <arquivo...> [--from T] [--to T] [--speaker S] [--fps F]   frase sem acento/caixa; "" = listar a janela
  export <arquivo> --format ${EXPORT_FORMATS.join('|')} [--output f]   texto (nunca vídeo)
  Entradas: SRT · VTT · JSON (bold.transcript/1, whisper.cpp -ojf, segments[], bold davinci inspect) · --davinci (legendas, somente leitura)`;

const writeNew = (file, data) => {
  const f = path.resolve(file);
  if (fs.existsSync(f)) throw new TranscriptError('OUTPUT_EXISTS', `saída já existe (nunca sobrescrevo): ${path.basename(f)}`);
  if (!fs.existsSync(path.dirname(f))) throw new TranscriptError('OUTPUT_DIR', 'diretório de saída não existe');
  fs.writeFileSync(f, data, { flag: 'wx' }); return f;
};

function readVocabulary(file) {
  if (!file) return null;
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  const okList = (x) => x === undefined || (Array.isArray(x) && x.every((s) => typeof s === 'string' && s.trim()));
  if (v?.schema !== 'bold.vocabulary/1' || !okList(v.products) || !okList(v.proper_nouns)) throw new TranscriptError('VOCABULARY_INVALID', 'vocabulário: {"schema":"bold.vocabulary/1","products":[...],"proper_nouns":[...]}');
  return v;
}

export function loadInput(file, o, loaded) {
  if (o.davinci) {
    if (!o.timeline) throw new TranscriptError('USAGE', '--davinci exige --timeline T');
    const ins = davinciRead('inspect', { timeline: o.timeline, brief: false }, { config: loaded.config });
    return normalize(null, { davinciInspect: ins, track: o.track ? Number(o.track) : null, language: o.language ?? null });
  }
  if (!file) throw new TranscriptError('USAGE', 'arquivo de entrada obrigatório');
  return loadTranscript(path.resolve(file), { language: o.language ?? null, fps: o.fps ?? null });
}

function exitFor(code) {
  if (['DISCONNECTED', 'API_NOT_FOUND', 'API_IMPORT_FAILED', 'PYTHON_NOT_FOUND'].includes(code)) return EXIT.UNAVAILABLE;
  if (code === 'DAVINCI_WRITE_FORBIDDEN') return EXIT.DENIED;
  if (['USAGE', 'TRACK_AMBIGUOUS', 'VOCABULARY_INVALID', 'TIME_INVALID', 'FPS_MISSING', 'FPS_INVALID', 'TC_INVALID', 'CLOCK_INVALID', 'DF_INVALID'].includes(code)) return EXIT.USAGE;
  if (['OUTPUT_EXISTS', 'OUTPUT_DIR'].includes(code)) return EXIT.STOP;
  return EXIT.FAIL;
}

export async function cmdTranscript(args, loaded, stream = process.stdout) {
  const o = args.opts; const op = args._[1];
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  const fail = (code, message, details = null) => { out({ ok: false, error: { code, message, details } }, [`bold transcript ${op}: ${code}: ${message}`, ...(details ? [`  ${JSON.stringify(details).slice(0, 600)}`] : [])]); return exitFor(code); };
  try {
    if (op === 'inspect') {
      const doc = loadInput(args._[2], o, loaded); const s = summarize(doc);
      out({ schema: 'bold.transcript-summary/1', ...s, warnings_list: doc.warnings }, [
        `${doc.source.name ?? doc.source.davinci?.timeline ?? '—'} · ${s.format} · ${s.segments} segmentos · ${s.words} palavras · ${s.duration} s (${s.duration_source})`,
        `timing: ${s.granularity}${s.word_timing_origin ? ` (${s.word_timing_origin})` : ''} · confidence: ${s.confidence} · speakers: ${s.speakers.length ? s.speakers.join(', ') : 'nenhum (sem diarização)'}`,
        `idioma: ${s.language ?? 'n/d'} · fps: ${s.fps ? `${s.fps} (${s.fps_source})${s.drop_frame ? ' DF' : ''}` : 'n/d (nunca assumido)'} · avisos: ${s.warnings}`]);
      return EXIT.OK;
    }
    if (op === 'normalize') {
      const doc = loadInput(args._[2], o, loaded);
      if (o.output) { const f = writeNew(o.output, canonicalJson(doc)); out({ ok: true, output: f, summary: summarize(doc) }, [`normalize → ${path.basename(f)} (${doc.segments.length} segmentos, ${doc.timing.granularity})`]); }
      else stream.write(canonicalJson(doc));
      return EXIT.OK;
    }
    if (op === 'analyze') {
      const doc = loadInput(args._[2], o, loaded); const ann = analyze(doc, { vocabulary: readVocabulary(o.vocabulary) });
      if (o.output) { const f = writeNew(o.output, `${JSON.stringify(ann, null, 2)}\n`); out({ ok: true, output: f, counts: ann.counts }, [`analyze → ${path.basename(f)}`, JSON.stringify(ann.counts)]); return EXIT.OK; }
      out(ann, [`${ann.annotations.length} candidatos (${ann.nature})`, ...ann.annotations.map((a) => `  ${formatClock(a.start, { vtt: true })} ${a.type.padEnd(18)} ${a.confidence.padEnd(6)} "${a.evidence.replace(/\n/g, ' ').slice(0, 70)}"  [${a.rule}]`)]);
      return EXIT.OK;
    }
    if (op === 'search') {
      const query = args._[2] ?? ''; const files = args._.slice(3);
      if (!files.length && !o.davinci) return fail('USAGE', 'search "<frase>" <arquivo...>');
      const fps = o.fps ? parseFps(o.fps) : null;
      const win = { from: o.from != null ? parseTimeArg(o.from, fps) : null, to: o.to != null ? parseTimeArg(o.to, fps) : null, speaker: o.speaker ?? null };
      const docs = o.davinci ? [loadInput(null, o, loaded)] : files.map((f) => loadInput(f, { ...o, fps: null }, loaded));
      const results = docs.map((d) => search(d, query, win));
      const hits = results.flatMap((r) => r.hits);
      out({ schema: 'bold.transcript-search/1', query, window: { from: win.from, to: win.to }, speaker: win.speaker, count: hits.length, hits },
        [`${hits.length} resultado(s) para "${query}"`, ...hits.map((h) => `  ${h.transcript ?? ''} ${h.segment_id} ${formatClock(h.match?.start ?? h.start, { vtt: true })}–${formatClock(h.match?.end ?? h.end, { vtt: true })}${h.speaker ? ` [${h.speaker}]` : ''} ${h.text.replace(/\n/g, ' ').slice(0, 90)}${h.match ? ` (${h.match.span_timing})` : ''}`)]);
      return EXIT.OK;
    }
    if (op === 'export') {
      if (!EXPORT_FORMATS.includes(o.format)) return fail('USAGE', `--format ${EXPORT_FORMATS.join('|')}`);
      const doc = loadInput(args._[2], o, loaded); const text = exportTranscript(doc, o.format);
      if (o.output) { const f = writeNew(o.output, text); out({ ok: true, output: f, format: o.format }, [`export ${o.format} → ${path.basename(f)}`]); } else stream.write(text);
      return EXIT.OK;
    }
    return fail('USAGE', `comando desconhecido: ${op}`);
  } catch (e) {
    if (e instanceof TranscriptError || e instanceof DavinciError || e instanceof TimeError) return fail(e.code, e.message.replace(/^[A-Z_0-9]+: /, ''), e.details ?? null);
    if (e instanceof SyntaxError) return fail('VOCABULARY_INVALID', e.message);
    throw e;
  }
}
