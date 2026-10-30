// `bold assets …` (R8 — Asset Index V1). O scan é SOMENTE LEITURA na pasta escaneada; o índice é cache derivado
// gravado fora dela. A relação com o DaVinci usa só operações de LEITURA da Bridge (allowlist).
//   scan | inspect | search | duplicates | davinci
import fs from 'node:fs';
import path from 'node:path';
import { scanAssets, inspectFile, AssetError, HASH_POLICIES } from '../../asset-index/src/scan.mjs';
import { searchAssets, findDuplicates, findAsset } from '../../asset-index/src/query.mjs';
import { defaultIndexPath, checkIndexLocation, loadIndex, saveIndex } from '../../asset-index/src/store.mjs';
import { TYPES } from '../../asset-index/src/classify.mjs';
import { davinciSnapshot } from '../../core/context/davinci-read.mjs';
import { linkDavinci } from '../../core/context/link.mjs';
import { resolveTools } from '../../core/delivery/tools.mjs';
import { DavinciError } from '../../core/davinci/bridge.mjs';
import { TimeError } from '../../transcript/src/time.mjs';
import { EXIT } from './media.mjs';

const USAGE = `uso: bold assets <comando> [opções] [--json]
  scan <pasta> [--index f] [--hash ${HASH_POLICIES.join('|')}] [--no-probe] [--include-hidden] [--concurrency N]
        somente leitura · incremental (tamanho + mtime + inode) · índice fora da pasta escaneada
  inspect <arquivo> [--index f]                         metadados de um arquivo (do índice ou lidos agora)
  search [texto] --root <pasta> | --index f [--type ${TYPES.join(',')}] [--orientation horizontal|vertical|square]
         [--alpha true|false] [--fps 59.94] [--ext mov,mp4] [--tag t] [--codec c] [--min-duration s] [--max-duration s] [--limit N]
  duplicates --root <pasta> | --index f [--verify]     conteúdo igual e MESMO NOME em caminhos diferentes (nada é apagado)
  davinci --root <pasta> | --index f [--timeline T | --all-timelines]   Media Pool ↔ arquivo ↔ uso na timeline (LEITURA)`;

function ffprobeOf(loaded) { try { return resolveTools(loaded.config).ffprobe; } catch { return null; } }

function indexFileFor(o, loaded) {
  if (o.index) return path.resolve(o.index);
  const root = o.root ?? null;
  if (!root) throw new AssetError('USAGE', 'informe --index <arquivo> ou --root <pasta escaneada>');
  return defaultIndexPath(fs.realpathSync(root).normalize('NFC'), loaded);
}

const human = (a) => `  ${a.type.padEnd(13)} ${a.rel_path}${a.width ? `  ${a.width}×${a.height} ${a.orientation}` : ''}${a.fps ? `  ${a.fps_float} fps` : ''}${a.duration != null ? `  ${a.duration}s` : ''}${a.alpha ? '  alpha' : ''}${a.font_family ? `  «${a.font_family}»` : ''}${a.sample_rate ? `  ${a.sample_rate} Hz/${a.channels}ch` : ''}`;

function exitFor(code) {
  if (['DISCONNECTED', 'API_NOT_FOUND', 'API_IMPORT_FAILED', 'PYTHON_NOT_FOUND'].includes(code)) return EXIT.UNAVAILABLE;
  if (code === 'DAVINCI_WRITE_FORBIDDEN') return EXIT.DENIED;
  if (['USAGE', 'FPS_INVALID', 'FPS_MISSING'].includes(code)) return EXIT.USAGE;
  if (['INDEX_INSIDE_SCAN_ROOT', 'TIMELINE_NOT_FOUND'].includes(code)) return EXIT.STOP;
  return EXIT.FAIL;
}

export async function cmdAssets(args, loaded, stream = process.stdout) {
  const o = args.opts; const op = args._[1];
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  const fail = (code, message, details = null) => { out({ ok: false, error: { code, message, details } }, [`bold assets ${op}: ${code}: ${message}`]); return exitFor(code); };
  try {
    if (op === 'scan') {
      const root = args._[2]; if (!root) return fail('USAGE', 'scan <pasta>');
      if (!fs.existsSync(root)) return fail('ROOT_INVALID', 'pasta não existe');
      const rootAbs = fs.realpathSync(root).normalize('NFC');
      const file = checkIndexLocation(o.index ? path.resolve(o.index) : defaultIndexPath(rootAbs, loaded), rootAbs);
      let previous = null; try { previous = loadIndex(file, { required: false }); } catch { previous = null; } // cache inválido = descartado
      const ffprobe = o['no-probe'] ? null : ffprobeOf(loaded);
      const idx = await scanAssets({ root: rootAbs, previous, hash: o.hash ?? 'auto', ffprobe, probe: !o['no-probe'], includeHidden: !!o['include-hidden'], concurrency: o.concurrency ? Number(o.concurrency) : 4 });
      saveIndex(file, idx);
      const s = idx.stats;
      out({ ok: true, index: file, stats: s, changes: idx.changes, probe: idx.probe, skipped: idx.skipped.length }, [
        `scan ${idx.root.name}: ${s.files} arquivos · ${(s.bytes / 1048576).toFixed(1)} MiB · lidos ${s.read} · reaproveitados ${s.reused} · erros ${s.errors} · ignorados ${idx.skipped.length}`,
        `  tipos: ${Object.entries(s.by_type).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
        ...(idx.changes ? [`  mudanças: +${idx.changes.added.length} ~${idx.changes.changed.length} -${idx.changes.removed.length}`] : []),
        `  ffprobe: ${idx.probe.available ? 'sim' : idx.probe.enabled ? 'AUSENTE (vídeo/áudio sem metadados técnicos)' : 'desligado (--no-probe)'} · hash: ${idx.hash_policy}`,
        `  índice: ${file}`]);
      return EXIT.OK;
    }
    if (op === 'inspect') {
      const f = args._[2]; if (!f) return fail('USAGE', 'inspect <arquivo>');
      if (!fs.existsSync(f)) return fail('INPUT_MISSING', 'arquivo não existe');
      let a = null;
      if (o.index) a = findAsset(loadIndex(path.resolve(o.index)), f);
      if (!a) a = await inspectFile(f, { hash: o.hash ?? 'auto', ffprobe: o['no-probe'] ? null : ffprobeOf(loaded), probe: !o['no-probe'] }); // avulso: lê só este arquivo, não grava nada
      out(a, [human(a), `  id ${a.id} · ${a.size} B · probe ${a.probe.status}${a.probe.error ? ` (${a.probe.error})` : ''} · tags ${a.tags.join(',') || '—'}`]);
      return EXIT.OK;
    }
    const idxFile = indexFileFor(o, loaded); const idx = loadIndex(idxFile);
    if (op === 'search') {
      const r = searchAssets(idx, { text: args._[2] ?? null, type: o.type, orientation: o.orientation, alpha: o.alpha, fps: o.fps, ext: o.ext, tag: o.tag, codec: o.codec, minDuration: o['min-duration'], maxDuration: o['max-duration'], limit: o.limit });
      out(r, [`${r.count} asset(s)`, ...r.assets.map(human)]); return EXIT.OK;
    }
    if (op === 'duplicates') {
      const r = findDuplicates(idx, { verify: !!o.verify });
      out(r, [`conteúdo: ${r.content.length} grupo(s) · mesmo nome em caminhos diferentes: ${r.same_name.length} grupo(s)${r.verify ? ` · leituras completas: ${r.verified_full_reads}` : ''}`,
        ...r.content.map((g) => `  [${g.status}] ${g.size} B  ${g.paths.join('  ·  ')}`), ...r.same_name.map((g) => `  [MESMO NOME${g.content_equal === true ? ', conteúdo igual' : g.content_equal === false ? ', conteúdo DIFERENTE' : ''}] ${g.paths.join('  ·  ')}`), `  ${r.note}`]);
      return EXIT.OK;
    }
    if (op === 'davinci') {
      const snap = davinciSnapshot({ timelines: o['all-timelines'] ? 'all' : o.timeline ?? 'current', config: loaded.config });
      const r = linkDavinci(idx, snap);
      if (!r.available) { out({ ...r, note: 'Resolve indisponível: o índice de filesystem continua válido' }, [`DaVinci indisponível (${r.reason}); o índice de filesystem continua funcionando.`]); return EXIT.OK; }
      const s = r.summary;
      out({ schema: 'bold.asset-davinci/1', read_only: true, ...r }, [`Media Pool: ${s.pool_items} itens (${s.pool_with_file_path} com File Path; ${s.pool_linked_to_index} ligados ao índice; ${s.pool_file_missing_on_disk} sem arquivo no disco)`,
        `uso em timeline: ${s.timeline_uses} (${s.uses_linked_to_index} ligados ao índice)`, ...r.usage.slice(0, 50).map((u) => `  ${u.timeline} ${u.track_type[0].toUpperCase()}${u.track} ${u.tl_in_tc}–${u.tl_out_tc}  ${u.asset_rel_path ?? `(fora do índice) ${path.basename(u.file_path)}`}`)]);
      return EXIT.OK;
    }
    return fail('USAGE', `comando desconhecido: ${op}`);
  } catch (e) {
    if (e instanceof AssetError || e instanceof DavinciError || e instanceof TimeError) return fail(e.code, e.message.replace(/^[A-Z_0-9]+: /, ''), e.details ?? null);
    throw e;
  }
}
