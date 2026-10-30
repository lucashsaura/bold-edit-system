// `bold context …` (R8 — Project Context V1). build: junta índice + transcrições (+ anotações) + DaVinci SOMENTE
// LEITURA num bold.project-context/1 (cache derivado). query: perguntas descritivas — nunca decisões (R9).
import fs from 'node:fs';
import path from 'node:path';
import { buildContext, queryContext, QUERIES } from '../../core/context/context.mjs';
import { davinciSnapshot } from '../../core/context/davinci-read.mjs';
import { loadIndex, defaultIndexPath } from '../../asset-index/src/store.mjs';
import { AssetError } from '../../asset-index/src/scan.mjs';
import { analyze } from '../../transcript/src/analyze.mjs';
import { normalize } from '../../transcript/src/normalize.mjs';
import { parseFps, parseTimeArg, formatClock, TimeError } from '../../transcript/src/time.mjs';
import { TranscriptError } from '../../transcript/src/parsers.mjs';
import { loadInput } from './transcript.mjs';
import { validate } from '../../core/schema/validate.mjs';
import { DavinciError } from '../../core/davinci/bridge.mjs';
import { EXIT } from './media.mjs';

const SCHEMA_FILE = new URL('../../core/context/bold.project-context.schema.json', import.meta.url);
const USAGE = `uso: bold context <comando> [opções] [--json]
  build [--root <pasta> | --index f] [--transcript a.srt --transcript b.vtt …] [--vocabulary v.json]
        [--davinci [--timeline T | --all-timelines] [--subtitles]] [--output ctx.json]
        DaVinci = SOMENTE LEITURA (opcional; Resolve fechado não impede o resto)
  query <ctx.json> ${QUERIES.join('|')} [termo] [--from T --to T] [--speaker S] [--transcript tN|timeline] [--type cta,offer,number…]
        [--orientation …] [--alpha true] [--fps 59.94] [--fps-tc F]`;

const defaultOut = (loaded) => path.join(loaded.project?.valid ? path.join(loaded.project.root, '.bold') : loaded.config.CACHE_DIR, 'context', 'project-context.json');

function exitFor(code) {
  if (['DISCONNECTED', 'API_NOT_FOUND', 'API_IMPORT_FAILED', 'PYTHON_NOT_FOUND'].includes(code)) return EXIT.UNAVAILABLE;
  if (code === 'DAVINCI_WRITE_FORBIDDEN') return EXIT.DENIED;
  if (['USAGE', 'FPS_INVALID', 'FPS_MISSING', 'TIME_INVALID', 'TC_INVALID'].includes(code)) return EXIT.USAGE;
  if (['TIMELINE_NOT_FOUND', 'TRACK_AMBIGUOUS'].includes(code)) return EXIT.STOP;
  return EXIT.FAIL;
}

export async function cmdContext(args, loaded, stream = process.stdout) {
  const o = args.opts; const op = args._[1];
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  const fail = (code, message, details = null) => { out({ ok: false, error: { code, message, details } }, [`bold context ${op}: ${code}: ${message}`]); return exitFor(code); };
  try {
    if (op === 'build') {
      let index = null; let indexFile = null;
      if (o.index || o.root) { indexFile = o.index ? path.resolve(o.index) : defaultIndexPath(fs.realpathSync(o.root).normalize('NFC'), loaded); index = loadIndex(indexFile); }
      const vocab = o.vocabulary ? JSON.parse(fs.readFileSync(o.vocabulary, 'utf8')) : null;
      const files = [].concat(o.transcript ?? []);
      const transcripts = files.map((f) => { const doc = loadInput(f, { language: o.language ?? null }, loaded); return { doc, file: path.basename(f), annotations: analyze(doc, { vocabulary: vocab }) }; });
      let davinci = { available: false, reason: 'NOT_REQUESTED' };
      if (o.davinci) {
        davinci = davinciSnapshot({ timelines: o['all-timelines'] ? 'all' : o.timeline ?? 'current', config: loaded.config });
        if (davinci.available && o.subtitles) for (const tl of davinci.inspected) if ((tl.tracks?.subtitle ?? []).length === 1) {
          const doc = normalize(null, { davinciInspect: { schema: 'bold.davinci.inspect/1', project: davinci.status.project, timeline: tl } });
          transcripts.push({ doc, file: null, annotations: analyze(doc, { vocabulary: vocab }) });
        }
      }
      const ctx = buildContext({ index, indexFile, transcripts, davinci, targetTimeline: o.timeline ?? null });
      const errs = validate(JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')), ctx);
      if (errs.length) return fail('CONTEXT_INVALID', 'contexto gerado não conforma bold.project-context/1', errs.slice(0, 10));
      const file = path.resolve(o.output ?? defaultOut(loaded));
      fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(ctx, null, 2)}\n`); fs.renameSync(tmp, file);
      const c = ctx.components;
      out({ ok: true, output: file, components: c, relations: ctx.relations.summary }, [`contexto → ${file}`,
        `  assets: ${ctx.assets.length}${c.asset_index ? ` (${c.asset_index.root})` : ' (sem índice)'} · transcrições: ${c.transcripts.length}`,
        `  DaVinci: ${c.davinci.available ? `${c.davinci.timelines.length} timelines · alvo ${c.davinci.target_timeline ?? '—'} · inspecionadas ${c.davinci.inspected.length}` : `indisponível (${c.davinci.reason})`}`]);
      return EXIT.OK;
    }
    if (op === 'query') {
      const file = args._[2]; const what = args._[3]; const text = args._[4] ?? null;
      if (!file || !what) return fail('USAGE', `query <ctx.json> ${QUERIES.join('|')}`);
      const ctx = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (ctx.schema !== 'bold.project-context/1') return fail('CONTEXT_INVALID', 'não é bold.project-context/1');
      const fps = o['fps-tc'] ? parseFps(o['fps-tc']) : null;
      const r = queryContext(ctx, what, { text, from: o.from != null ? parseTimeArg(o.from, fps) : null, to: o.to != null ? parseTimeArg(o.to, fps) : null, speaker: o.speaker, transcript: o.transcript ? [].concat(o.transcript)[0] : null, timeline: o.timeline,
        type: o.type, orientation: o.orientation, alpha: o.alpha, fps: o.fps, ext: o.ext, tag: o.tag, codec: o.codec, minDuration: o['min-duration'], maxDuration: o['max-duration'], limit: o.limit });
      const lines = [];
      if (r.hits) for (const h of r.hits) lines.push(`  ${h.transcript}${h.timeline ? `(${h.timeline})` : ''} ${formatClock(h.start, { vtt: true })} ${h.type ? `${h.type} ` : ''}${(h.evidence ?? h.text).replace(/\n/g, ' ').slice(0, 90)}`);
      else if (r.assets && what === 'assets') for (const a of r.assets) lines.push(`  ${a.type.padEnd(13)} ${a.rel_path}`);
      else lines.push(JSON.stringify(r, null, 2));
      out(r, [`${what}: ${r.hits ? r.hits.length : r.count ?? ''}`, ...lines]);
      return EXIT.OK;
    }
    return fail('USAGE', `comando desconhecido: ${op}`);
  } catch (e) {
    if (e instanceof AssetError || e instanceof DavinciError || e instanceof TimeError || e instanceof TranscriptError) return fail(e.code, e.message.replace(/^[A-Z_0-9]+: /, ''), e.details ?? null);
    if (e.code === 'USAGE' || e.code === 'TIMELINE_NOT_FOUND') return fail(e.code, e.message);
    throw e;
  }
}
