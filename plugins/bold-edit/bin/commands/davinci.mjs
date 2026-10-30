// `bold davinci …` (R7 — DaVinci Bridge V1). NADA de render/export/Deliver/Render Queue, OpenPage, troca de projeto
// ou de página, replace/ripple/move (NOT_AVAILABLE_V1). delete (V1.1): remove itens da timeline, sem ripple, por alvos exatos.
//   leitura:  status · projects · timelines · inspect [--timeline T] [--brief] · timeline inspect · media inspect [--path F] · verify
//   escrita:  checkpoint · import · insert · integrate (import + insert + verify de um motion request) · delete
// Writes exigem --resolve-project (nome EXATO do projeto aberto) e --timeline; projeto não-sandbox exige autorização
// humana davinci-write (--authorization-file). A Bridge reconfere tudo (guards) imediatamente antes de escrever.
import fs from 'node:fs';
import path from 'node:path';
import { runBridge, resolvePython, validateMotionRequest, DavinciError } from '../../core/davinci/bridge.mjs';
import { checkDavinciWrite, SANDBOX_PROJECT_RE } from '../../core/davinci/authorize.mjs';
import { parseAuthorization } from '../../core/policy/gate.mjs';
import { EXIT } from './media.mjs';

const USAGE = `uso: bold davinci <comando> [opções] [--json]
  status | projects | timelines                     somente leitura
  inspect [--timeline T] [--brief]                  timeline (corrente ou T, sem trocar a corrente) → JSON estável
  timeline inspect [--timeline T]                   idem
  media inspect [--path F]                          Media Pool (File Path)
  verify --resolve-project P --timeline T --file F --track N --at <Nf|TC> [--duration N]
  checkpoint --resolve-project P --timeline T --operation OP [--drp] [--checkpoint-dir D]
  import --resolve-project P --timeline T --file F [--no-drp] [--authorization-file A]
  insert --resolve-project P --timeline T --file F --track N --at <Nf|TC> [--duration N] [--src-in N] [--no-drp] [--authorization-file A]
  integrate --request motion_request.json [--no-drp] [--authorization-file A]      import + insert + verify
  (import/insert: checkpoint .drp por padrão — H3; --no-drp só é aceito no sandbox)
  delete --resolve-project P --timeline T --targets alvos.json [--authorization-file A]
        alvos.json = [{unique_id, kind: video|audio, track, tl_in, tl_out[, file_path]}] (pegue de \`inspect --timeline T --json\`)
        remove SÓ da timeline (nunca a mídia), SEM ripple; .drp obrigatório; a autorização precisa listar "delete"
  sandbox-timeline --resolve-project BOLD_BRIDGE_SANDBOX[_x] --timeline BOLD_BRIDGE_TEST[_x]   SÓ sandbox: cria a timeline de teste
  (replace | ripple | move | render | export → NOT_AVAILABLE_V1)`;
const WRITES = new Set(['checkpoint', 'import', 'insert', 'integrate', 'delete', 'sandbox-timeline']);
const ABORT_CODES = new Set(['WRONG_PROJECT', 'WRONG_PAGE', 'TIMELINE_GATE_FAILED', 'TIMELINE_NOT_FOUND', 'TIMELINE_AMBIGUOUS', 'MEDIA_AMBIGUOUS', 'MEDIA_MISSING', 'MEDIA_NOT_IN_POOL',
  'TARGET_OCCUPIED', 'TARGET_NOT_FOUND', 'TARGET_MISMATCH', 'TARGETS_REQUIRED', 'TARGETS_INVALID', 'LINKED_ITEMS_NOT_IN_TARGETS', 'TRACK_NOT_FOUND', 'DURATION_INVALID', 'NO_PROJECT', 'NO_TIMELINE', 'CHECKPOINT_SAVE_FAILED', 'CHECKPOINT_EXPORT_FAILED', 'CHECKPOINT_EMPTY', 'CHECKPOINT_INVALID', 'MASTER_HASH_MISMATCH', 'PROJECT_REQUIRED', 'TIMELINE_EXISTS']);

function exitFor(code) {
  if (['DISCONNECTED', 'API_NOT_FOUND', 'API_IMPORT_FAILED', 'PYTHON_NOT_FOUND'].includes(code)) return EXIT.UNAVAILABLE;
  if (['SANDBOX_REQUIRED', 'REAL_PROJECT_WRITE_DENIED', 'AUTHORIZATION_INVALID', 'AUTHORIZATION_EXPIRED', 'AUTHORIZATION_SCOPE_MISMATCH'].includes(code)) return EXIT.DENIED;
  if (ABORT_CODES.has(code)) return EXIT.STOP;
  if (['UNKNOWN_OP', 'BAD_ARGS', 'REQUEST_INVALID', 'NOT_AVAILABLE_V1', 'USAGE'].includes(code)) return EXIT.USAGE;
  return EXIT.FAIL;
}

function human(op, r) {
  if (op === 'status') {
    const t = r.timeline;
    return [`Resolve: ${r.connected ? 'connected' : 'disconnected'} · ${r.product} ${r.version}`, `Project: ${r.project ?? '—'}  (${r.timeline_count ?? 0} timelines)`,
      `Timeline: ${t ? `${t.name} · ${t.fps} fps${t.drop_frame ? ' DF' : ''} · ${t.resolution.join('×')} · start ${t.start_tc}` : '—'}`, `Page: ${r.page}`,
      `Write safety: ${r.write_safety.writes}`];
  }
  if (op === 'inspect') {
    const s = r.summary ?? {}; const t = r.timeline;
    const lines = [`${r.project} › ${t.name}  ${t.fps} fps${t.drop_frame ? ' DF' : ''} · ${t.resolution.join('×')} · ${t.duration_frames} frames · start ${t.start_tc}${t.is_current ? ' (corrente)' : ' (não corrente: estado de track = n/d)'}`];
    for (const kind of ['video', 'audio']) for (const tr of t.tracks[kind]) {
      lines.push(`  ${tr.name} ${tr.enabled === null ? '' : tr.enabled ? '[on]' : '[off]'} ${tr.items ? `${tr.items.length} item(ns)` : ''}`);
      for (const it of (tr.items ?? []).slice(0, 50)) lines.push(`    ${it.tl_in_tc}–${it.tl_out_tc}  ${it.kind.padEnd(9)} ${it.name}${it.file_path ? `  ← ${it.file_path}` : ''}`);
    }
    if (t.markers.length) lines.push(`  markers: ${t.markers.length}`);
    if (s.video_items !== undefined) lines.push(`  resumo: ${s.video_tracks}V/${s.audio_tracks}A · ${s.video_items} itens de vídeo · ${s.audio_items} de áudio`);
    return lines;
  }
  if (op === 'timelines') return [`${r.project} (${r.timelines.length} timelines; corrente: ${r.current ?? '—'})`, ...r.timelines.map((t) => `  ${t.is_current ? '*' : ' '} ${t.name}`)];
  return [JSON.stringify(r, null, 2)];
}

export async function cmdDavinci(args, loaded, stream = process.stdout) {
  const o = args.opts; let op = args._[1]; const sub = args._[2];
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  if (op === 'timeline' && sub === 'inspect') op = 'inspect';
  else if (op === 'media' && sub === 'inspect') op = 'media';
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  const fail = (code, message, details = null) => { out({ ok: false, error: { code, message, details } }, [`bold davinci ${op}: ${code}: ${message}`, ...(details ? [`  ${JSON.stringify(details)}`] : [])]); return exitFor(code); };
  try {
    const python = resolvePython(loaded.config);
    const cfg = loaded.config.davinci || {};
    const ckDir = path.resolve(o['checkpoint-dir'] ?? path.join(loaded.project?.valid ? loaded.project.root : loaded.config.CACHE_DIR, '.bold', 'davinci', 'checkpoints'));
    const logDirs = { projectRoot: loaded.project?.valid ? loaded.project.root : null, cacheDir: loaded.config.CACHE_DIR };
    const call = (bop, a) => { const r = runBridge(bop, a, { python, davinciConfig: cfg }); if (!r.ok) throw new DavinciError(r.error.code, r.error.message, r.error.details); return r.result; };
    let auth = null;
    if (o['authorization-file']) auth = parseAuthorization(fs.readFileSync(o['authorization-file'], 'utf8'));

    if (['replace', 'ripple', 'move', 'render', 'export'].includes(op)) return fail('NOT_AVAILABLE_V1', `${op} não existe na Bridge V1`);
    if (op === 'status' || op === 'projects' || op === 'timelines') { const r = call(op, {}); out(r, human(op, r)); return EXIT.OK; }
    if (op === 'inspect') { const r = call('inspect', { timeline: o.timeline ?? null, brief: !!o.brief }); out(r, human('inspect', r)); return EXIT.OK; }
    if (op === 'media') { const r = call('media', { path: o.path ?? null }); out(r, human('media', r)); return EXIT.OK; }
    if (op === 'verify') {
      const r = call('verify', { project: o['resolve-project'], timeline: o.timeline, file_path: o.file && path.resolve(o.file), track: Number(o.track), at: o.at, duration: o.duration ? Number(o.duration) : null });
      out(r, [`verify: ${r.status}`, JSON.stringify(r.checks)]); return r.status === 'PASS' ? EXIT.OK : EXIT.FAIL;
    }
    if (!WRITES.has(op)) return fail('UNKNOWN_OP', `comando desconhecido: ${op}`);

    // ── writes ──
    let req = null; let project = o['resolve-project']; let timeline = o.timeline;
    if (op === 'integrate') {
      if (!o.request) return fail('USAGE', '--request <motion_request.json> obrigatório');
      const reqDoc = JSON.parse(fs.readFileSync(o.request, 'utf8')); req = { ...reqDoc, ...validateMotionRequest(reqDoc, path.dirname(path.resolve(o.request))) };
      project = req.project; timeline = req.timeline;
    }
    if (!project || !timeline) return fail('USAGE', '--resolve-project e --timeline obrigatórios para escrita');
    if (op === 'sandbox-timeline') { // nunca aceita autorização: só existe no sandbox
      if (!SANDBOX_PROJECT_RE.test(project) || !/^BOLD_BRIDGE_TEST(?:_[A-Za-z0-9-]{1,32})?$/.test(timeline)) return fail('SANDBOX_REQUIRED', 'sandbox-timeline só em projeto BOLD_BRIDGE_SANDBOX* com timeline BOLD_BRIDGE_TEST*');
      checkDavinciWrite({ authorization: null, project, timeline, operation: op, logDirs });
      const r = call('sandbox_timeline', { project, timeline, out_dir: ckDir }); out(r, [`sandbox-timeline: ${r.status} · ${timeline}`]); return r.status === 'PASS' ? EXIT.OK : EXIT.FAIL;
    }
    const scope = checkDavinciWrite({ authorization: auth, project, timeline, operation: op, logDirs });
    if (o['no-drp'] && scope.mode !== 'sandbox') return fail('USAGE', '--no-drp só no sandbox: fora dele o checkpoint .drp é obrigatório (H3)');
    const drp = !o['no-drp'];
    const base = { project, timeline, out_dir: ckDir, ...(scope.authorization ? { authorization: scope.authorization } : {}) };
    if (op === 'delete') {
      if (!o.targets) return fail('USAGE', '--targets <alvos.json> obrigatório');
      const targets = JSON.parse(fs.readFileSync(o.targets, 'utf8'));
      const r = call('delete', { ...base, targets, drp: true });
      const v = r.result.verification ?? {};
      out(r, [`delete: ${r.status} · ${r.result.actual?.removed?.length ?? 0} item(ns) removido(s) da timeline (sem ripple)`, `  conferência: ${JSON.stringify(v)}`, `  checkpoint: ${r.checkpoint.snapshot_file} (rollback: ${r.checkpoint.rollback})`]);
      return r.status === 'PASS' ? EXIT.OK : EXIT.FAIL;
    }
    if (op === 'checkpoint') { const r = call('checkpoint', { project, timeline, operation: o.operation ?? 'manual', out_dir: ckDir, drp: !!o.drp }); out(r, [`checkpoint → ${r.snapshot_file}`, `rollback: ${r.rollback}`]); return EXIT.OK; }
    const file = req ? req.master : o.file && path.resolve(o.file);
    if (!file) return fail('USAGE', '--file obrigatório');
    const imp = call('import', { ...base, file_path: file, drp });
    if (op === 'import') { out(imp, [`import: ${imp.status}${imp.imported ? '' : ' (já estava no Media Pool)'} · ${imp.item?.bin} › ${imp.item?.name}`]); return imp.status === 'PASS' ? EXIT.OK : EXIT.FAIL; }
    const at = req ? `${req.start_frame}f` : o.at; const track = req ? req.track : Number(o.track);
    if (!at || !Number.isInteger(track)) return fail('USAGE', '--track e --at obrigatórios');
    const ins = call('insert', { ...base, file_path: file, track, at, duration: req?.duration ?? (o.duration ? Number(o.duration) : null), src_in: o['src-in'] ? Number(o['src-in']) : 0, drp });
    const payload = { ...ins, import: imp, delivery: req?.delivery ?? null };
    out(payload, [`${op}: ${ins.status}`, `  pedido: V${ins.result.requested.track} ${ins.result.requested.tl_in}–${ins.result.requested.tl_out}`, `  real:   ${ins.result.actual ? `V${ins.result.actual.track} ${ins.result.actual.tl_in}–${ins.result.actual.tl_out} ${ins.result.actual.file_path}` : '—'}`, `  checkpoint: ${ins.checkpoint.snapshot_file} (rollback: ${ins.checkpoint.rollback})`]);
    return ins.status === 'PASS' ? EXIT.OK : EXIT.FAIL;
  } catch (e) {
    if (e instanceof DavinciError) return fail(e.code, e.message.replace(/^[A-Z_0-9]+: /, ''), e.details);
    throw e;
  }
}
