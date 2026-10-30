// `bold audio …` (R13 — sound design integrado à Skill /bold-edit:edit). SFX Kit local (CC0) primeiro, Openverse como
// fallback online, Earshot opcional para análise/geração. DECIDIR ≠ EXECUTAR: `plan` só grava um JSON revisável.
// Nada é baixado ou instalado sem pedido explícito (--yes); nada é sobrescrito; vídeo com áudio = ação PROTEGIDA (preview-video).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { locateSfxKit, locateEarshot, audioRoots } from '../../audio/src/locate.mjs';
import { loadKit, verifyKit, searchKit } from '../../audio/src/sfxkit.mjs';
import { loadEvents, KINDS } from '../../audio/src/events.mjs';
import { rankForEvent, STYLES } from '../../audio/src/select.mjs';
import { buildSoundPlan } from '../../audio/src/plan.mjs';
import { conformAll, mixStem, mixFinal, muxPreview, MIX_TARGET } from '../../audio/src/render.mjs';
import { loudness, decodeMono, verifySync, speechFromVoice, globalLag } from '../../audio/src/measure.mjs';
import { remotionTsx, davinciCueList } from '../../audio/src/export.mjs';
import * as ov from '../../audio/src/openverse.mjs';
import { recordOpenverseCredit, recordOrigin } from '../../audio/src/credits.mjs';
import { runEarshot, earshotStatus, renderProcedural } from '../../audio/src/earshot.mjs';
import { readLibraryLock, libraryPlan, installSfxKit } from '../../audio/src/library-install.mjs';
import { currentStorage, storageCandidates, setStorage, attachStorage, clearStorage, volumeInfo } from '../../audio/src/storage.mjs';
import { AudioError } from '../../audio/src/errors.mjs';
import { resolveTools } from '../../core/delivery/tools.mjs';
import { authorizeOrThrow, AuthorizationError } from '../../core/delivery/authorize.mjs';
import { parseAuthorization, interactiveConfirmation } from '../../core/policy/gate.mjs';
import { loadTranscript } from '../../transcript/src/normalize.mjs';
import { TimeError } from '../../transcript/src/time.mjs';
import { EXIT } from './media.mjs';

const USAGE = `uso: bold audio <comando> [opções] [--json]
  status                                   SFX Kit, Earshot, Openverse e ffmpeg (somente leitura)
  library verify [--full] | install [--yes]  SFX Kit: verificação (sha256 com --full) · instalação guiada (pede --yes)
  search <termos…> [--category c] [--limit n]          busca no SFX Kit (campos reais do sounds.json)
  events <motion.spec|plan editorial|cues.json> [--offset s] [--output f]   eventos sonoros candidatos
  select --kind K [--dur s] [--size small|medium|large] [--style S] [--speech a-b,…]   ranking explicável
  plan <entrada> [--style minimal|institutional|motion|cinematic] [--fps F] [--speech a-b,… | --transcript f | --voice f]
       [--duration s] [--output plan.json]                                 plano de som (rascunho; nada é mixado)
  render <sound-plan.json> --output <pasta nova> [--voice f] [--music f]  conform + stem + mix + medição + sincronia
  verify <sound-plan.json> --audio f --conformed pasta [--offset s] | --audio f --reference mix.wav   sincronia no sinal
  measure <arquivo…>                                     LUFS integrado, LRA, true peak (EBU R128)
  export <sound-plan.json> [--remotion-tsx f] [--davinci-csv f] [--tc-start TC] [--public-prefix p] [--conformed pasta]
  mux --video v --audio a --output f [--format mov|mp4] (--authorization-file f)   prévia com áudio (PROTEGIDA)
  openverse search <termos em inglês> [--page n] [--limit n]                      avalia licença/fonte; não baixa
  openverse fetch <id> --project <dir> --yes [--from search.json] [--allow-unverified]   baixa para <projeto>/sons/ + créditos
  earshot status | describe f | measure f | timeline f [--cues c] | critique f | list [--category c] | render ID --output f [--dur s] [--apex s]
  setup [sfx-kit|earshot]                                plano de instalação guiada (nada é executado)
  storage status | candidates | set <pasta> [--image arquivo.sparsebundle] --yes | attach --yes | clear --yes
                                                         armazenamento externo (SSD) para kit, Earshot, modelos, cache e temp
  Estilos: ${Object.keys(STYLES).join(', ')} · tipos de evento: ${KINDS.join(', ')}`;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new AudioError('INPUT_INVALID', `${path.basename(String(f))}: ${e.message}`); } };
const writeNew = (f, text) => { if (fs.existsSync(f)) throw new AudioError('OUTPUT_EXISTS', `já existe (nunca sobrescrevo): ${path.basename(f)}`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, { flag: 'wx' }); return f; };
const tidy = (s) => { const h = process.env.HOME; return typeof s === 'string' && h ? s.split(h).join('~') : s; };
const num = (v, name) => { if (v === undefined) return null; const n = Number(v); if (!Number.isFinite(n)) throw new AudioError('USAGE', `${name} numérico`); return n; };
const parseRanges = (s) => String(s).split(',').filter(Boolean).map((r) => { const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(r.trim()); if (!m) throw new AudioError('USAGE', '--speech a-b,c-d (segundos)'); return [Number(m[1]), Number(m[2])]; });

function kitOrThrow(loaded) {
  const l = locateSfxKit({ config: loaded.config });
  if (!l.found && l.offline) throw new AudioError('STORAGE_OFFLINE', `SFX Kit está no armazenamento externo, indisponível agora (${l.offline.detail}). ${l.offline.recover}`);
  if (!l.found) throw new AudioError('KIT_MISSING', `SFX Kit não encontrado (${tidy(l.roots.libraries)}). Plano: bold audio setup sfx-kit`);
  return loadKit(l.dir);
}
const tools = (loaded) => { try { return resolveTools(loaded.config); } catch (e) { throw new AudioError('FFMPEG_MISSING', e.message); } };

function speechFrom(o, loaded) {
  if (o.speech) return parseRanges(o.speech);
  if (o.transcript) { const doc = loadTranscript(path.resolve([].concat(o.transcript)[0]), { fps: null }); return doc.segments.map((s) => [s.start, s.end]); }
  if (o.voice) return speechFromVoice(tools(loaded).ffmpeg, path.resolve(o.voice));
  return [];
}

async function obtainAuthorization(o, action, command, project) {
  if (o['authorization-file']) return parseAuthorization(fs.readFileSync(o['authorization-file'], 'utf8'));
  if (o.authorization) return parseAuthorization(o.authorization);
  if (process.stdin.isTTY && process.stderr.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try { return await interactiveConfirmation({ action, command, project, io: { isTTY: true, ask: (q) => new Promise((r) => rl.question(q, r)) } }); } finally { rl.close(); }
  }
  return null;
}

function exitFor(code) {
  if (['USAGE', 'STYLE_INVALID', 'FPS_MISSING', 'FPS_INVALID', 'CUES_INVALID', 'CONFIRMATION_REQUIRED'].includes(code)) return EXIT.USAGE;
  if (['OUTPUT_EXISTS', 'KIT_MISSING', 'EARSHOT_MISSING', 'STORAGE_NOT_CONFIGURED', 'STORAGE_FS_UNSUITABLE', 'STORAGE_FS_UNKNOWN', 'STORAGE_INVALID', 'STORAGE_ATTACH_FAILED', 'PROJECT_REQUIRED', 'RATE_LIMITED', 'LICENSE_REFUSED', 'DOWNLOAD_REFUSED', 'EARSHOT_REFUSED'].includes(code)) return EXIT.STOP;
  if (['DENIED'].includes(code)) return EXIT.DENIED;
  if (['FFMPEG_MISSING', 'NETWORK', 'TIMEOUT', 'OFFLINE', 'STORAGE_OFFLINE'].includes(code)) return EXIT.UNAVAILABLE;
  return EXIT.FAIL;
}

export async function cmdAudio(args, loaded, stream = process.stdout) {
  const o = args.opts; const op = args._[1]; const pos = args._.slice(2);
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  const fail = (code, message, details = null) => { out({ ok: false, error: { code, message, details } }, [`bold audio ${op}: ${code}: ${message}`, ...(details ? [`  ${JSON.stringify(details).slice(0, 600)}`] : [])]); return exitFor(code); };
  try {
    if (op === 'status') {
      const k = locateSfxKit({ config: loaded.config }); const e = locateEarshot({ config: loaded.config });
      let kit = null; if (k.found) { const K = loadKit(k.dir); kit = { found: true, name: K.name, version: K.version, license: K.license, dir: tidy(k.dir), source: k.source, provenance: !!k.provenance, ...verifyKit(K) }; }
      const es = earshotStatus(e);
      let ff = null; try { const t = resolveTools(loaded.config); ff = { ffmpeg: tidy(t.ffmpeg), ffprobe: tidy(t.ffprobe) }; } catch { /* ausente */ }
      const st = k.roots.storage;
      const res = { schema: 'bold.audio-status/1', storage: st ?? { state: 'NOT_CONFIGURED', note: 'padrão interno' }, sfx_kit: kit ?? { found: false, searched: tidy(k.roots.libraries), offline: !!k.offline }, earshot: { ...es, dir: tidy(es.dir) }, openverse: { api: ov.API, network: 'só sob demanda (search/fetch)', anonymous_limits: '20/min · 200/dia' }, ffmpeg: ff, roots: { libraries: tidy(k.roots.libraries), tools: tidy(k.roots.tools), models: tidy(e.home), temp: tidy(k.roots.temp) } };
      const off = (x) => `INDISPONÍVEL — armazenamento externo ${x.state} (${x.detail}) → ${x.recover}`;
      out(res, [
        `Storage   ${st ? `${st.state} · ${tidy(st.root)}${st.online ? '' : ` · ${st.detail}`}` : 'interno (padrão)'}`,
        `SFX Kit   ${kit ? `${kit.name} ${kit.version} · ${kit.license} · ${kit.sounds} sons / ${kit.categories} categorias · ${kit.status} (rápida) · ${kit.dir}` : k.offline ? off(k.offline) : `NÃO INSTALADO (bold audio setup sfx-kit)`}`,
        `Earshot   ${es.installed ? `${es.version ?? '?'} @ ${String(es.commit ?? '').slice(0, 7)} · modelos ${es.models_ready ? 'prontos (offline)' : 'ausentes'} · MCP ${es.mcp_registered ? 'registrado' : 'não registrado'}${es.venv_path_ok === false ? ' · VENV CRIADA EM OUTRO CAMINHO (recrie)' : ''}` : es.offline ? off(es.storage) : 'não instalado (opcional)'}`,
        ...(st && !st.online ? [`Sem o SSD: indisponível ${st.unavailable.join('; ')} · continua: ${st.available.join('; ')}`] : []),
        `Openverse ${ov.API} · rede só sob demanda · anônimo 20/min, 200/dia`,
        `ffmpeg    ${ff ? ff.ffmpeg : 'NÃO ENCONTRADO'}`]);
      return kit ? EXIT.OK : EXIT.STOP;
    }
    if (op === 'library') {
      const sub = pos[0]; const roots = audioRoots(); const lock = readLibraryLock();
      if (sub === 'verify') { const kit = kitOrThrow(loaded); const v = verifyKit(kit, { full: !!o.full }); out(v, [`${v.name} ${v.version} · ${v.license} · ${v.mode}: ${v.status} · ${v.sounds} sons${v.mode === 'full' ? ` · sha256 OK ${v.checked_sha256 - v.mismatched.length}/${v.sounds}` : ''} · ausentes ${v.missing.length} · divergentes ${v.mismatched.length}`]); return v.status === 'PASS' ? EXIT.OK : EXIT.FAIL; }
      if (sub === 'install') {
        if (roots.storage && !roots.storage.online) throw new AudioError('STORAGE_OFFLINE', `o SFX Kit é instalado no armazenamento externo (${roots.storage.detail}); não reinstalo no disco interno. ${roots.storage.recover}`);
        const r = await installSfxKit({ lock, librariesDir: roots.libraries, yes: !!o.yes });
        out(r, [`${r.status}: ${lock.name} ${lock.version} → ${tidy(r.target)}`]); return EXIT.OK;
      }
      if (sub === 'plan' || !sub) { const p = libraryPlan(lock, roots.libraries); out(p, [`${p.action}: ${lock.name} ${lock.version} (${lock.license}) → ${tidy(p.target)} · download ${(p.download_bytes / 1e6).toFixed(1)} MB · disco ~${(p.disk_bytes / 1e6).toFixed(0)} MB`]); return EXIT.OK; }
      return fail('USAGE', 'library verify | install | plan');
    }
    if (op === 'search') {
      const kit = kitOrThrow(loaded); const rows = searchKit(kit, pos.join(' '), { category: o.category ?? null, limit: num(o.limit, '--limit') ?? 10 });
      out(rows, rows.length ? rows.map((r) => `  ${r.id.padEnd(30)} ${r.category.padEnd(20)} ${r.duration.toFixed(2)} s  sync ${r.sync.at.toFixed(3)} (${r.sync.meets})  ${r.use_for.join('; ')}`) : ['  nenhum som do kit casa com esses termos (tente em inglês, ou bold audio openverse search)']);
      return EXIT.OK;
    }
    if (op === 'events') {
      const ev = loadEvents(path.resolve(pos[0] ?? ''), { offset: num(o.offset, '--offset') ?? 0 });
      const text = `${JSON.stringify(ev, null, 2)}\n`;
      if (o.output) { writeNew(path.resolve(o.output), text); out({ ok: true, output: o.output, events: ev.events.length }, [`${ev.events.length} eventos → ${o.output}`]); }
      else out(ev, [`${ev.events.length} eventos · fps ${ev.fps ?? 'n/d'} · ${ev.source?.type}`, ...ev.events.map((e) => `  ${e.id} ${e.t.toFixed(3).padStart(8)} s  ${e.kind.padEnd(12)} ${e.importance.padEnd(8)} ${e.dur ? `dur ${e.dur.toFixed(2)} ${e.ease ?? ''}` : ''}  ${e.source?.ref ?? ''}`)]);
      return EXIT.OK;
    }
    if (op === 'select') {
      if (!KINDS.includes(o.kind)) return fail('USAGE', `--kind ${KINDS.join('|')}`);
      const kit = kitOrThrow(loaded); const dur = num(o.dur, '--dur');
      const ev = { kind: o.kind, t: 0, ...(dur ? { start: 0, dur, ease: 'io' } : {}), size: o.size ?? 'medium', importance: 'medium' };
      const rows = rankForEvent(kit, ev, { style: o.style ?? 'motion', speech: o.speech ? parseRanges(o.speech) : [] }).slice(0, num(o.limit, '--limit') ?? 5);
      out(rows, rows.map((r, i) => `${i + 1}. ${r.id} (${r.score}${r.rate !== 1 ? `, rate ${r.rate}` : ''})\n     ${r.reasons.join(' · ')}`));
      return EXIT.OK;
    }
    if (op === 'plan') {
      const kit = kitOrThrow(loaded);
      const ev = loadEvents(path.resolve(pos[0] ?? ''), { offset: num(o.offset, '--offset') ?? 0 });
      const plan = buildSoundPlan({ events: ev, kit, style: o.style ?? 'motion', fps: o.fps ?? null, speech: speechFrom(o, loaded), duration: num(o.duration, '--duration') });
      const text = `${JSON.stringify(plan, null, 2)}\n`;
      if (!o.output) { stream.write(text); return EXIT.OK; }
      writeNew(path.resolve(o.output), text);
      out({ ok: true, output: o.output, summary: plan.summary }, [`plano de som → ${o.output} · ${plan.style} · ${plan.summary.cues} cue(s) de ${plan.summary.events} evento(s) · ${plan.summary.dropped} descartado(s) por densidade · ${plan.summary.fallbacks} sem candidato no kit`,
        ...plan.cues.map((c) => `  ${c.id} ${c.timecode}  ${c.kind.padEnd(11)} ${c.sound.id.padEnd(28)} início ${c.start.toFixed(3)} s (t ${c.t.toFixed(3)} − sync ${c.sync.at}${c.rate !== 1 ? ` ÷ ${c.rate}` : ''})  ${c.gain_db} dB${c.under_voiceover ? ' (sob narração)' : ''}`),
        ...plan.dropped.map((d) => `  − ${d.event_id} ${d.kind} @ ${d.t.toFixed(2)} s: ${d.reason}`), '  Rascunho para revisão: nada foi mixado.']);
      return EXIT.OK;
    }
    if (op === 'render') {
      const plan = readJson(path.resolve(pos[0] ?? '')); if (plan.schema !== 'bold.sound-plan/1') return fail('INPUT_INVALID', 'não é bold.sound-plan/1');
      if (!o.output) return fail('USAGE', '--output <pasta nova>');
      const dir = path.resolve(o.output); if (fs.existsSync(dir) && fs.readdirSync(dir).length) return fail('OUTPUT_EXISTS', `pasta não vazia (nunca sobrescrevo): ${o.output}`);
      const kit = kitOrThrow(loaded); const { ffmpeg } = tools(loaded);
      if (plan.library.version !== kit.version) return fail('KIT_MISMATCH', `plano feito com ${plan.library.name} ${plan.library.version}, instalado ${kit.version}`);
      const conf = conformAll(ffmpeg, kit, plan, path.join(dir, 'conformados'));
      const stem = mixStem(ffmpeg, plan, conf.files, path.join(dir, 'sfx-stem.wav'));
      const sync = verifySync({ samples: decodeMono(ffmpeg, stem), plan, conformed: conf.samples });
      const stemL = loudness(ffmpeg, stem);
      let mix = null;
      if (o.voice || o.music) mix = mixFinal(ffmpeg, { stem, voice: o.voice ? path.resolve(o.voice) : null, music: o.music ? path.resolve(o.music) : null, duration: plan.duration, outFile: path.join(dir, 'mix.wav'), workDir: path.join(dir, 'work') });
      for (const c of plan.cues) recordOrigin(path.join(dir, 'conformados'), { file: path.basename(conf.files[c.id]), origin: c.sound.origin, sound: c.sound.id, license: c.sound.license, credit_required: false, sha256_source: c.sound.sha256 });
      const report = { schema: 'bold.audio-render/1', plan: path.basename(pos[0]), conformed: Object.fromEntries(Object.entries(conf.files).map(([k, v]) => [k, path.relative(dir, v)])), stem: path.relative(dir, stem), stem_loudness: stemL, sync, mix: mix ? { ...mix, output: path.relative(dir, mix.output) } : null };
      writeNew(path.join(dir, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      out(report, [`${plan.cues.length} cue(s) conformados → ${o.output}/conformados · stem ${path.basename(stem)} (TP ${stemL.true_peak_dbtp} dBTP)`,
        `sincronia (sinal): ${sync.status} · ${sync.checked} cue(s) medidos · erro máx ${sync.max_abs_error_ms ?? '—'} ms (tolerância ${sync.tolerance_ms} ms)`,
        ...(mix ? [`mix: ${mix.status} · ${mix.final.integrated_lufs} LUFS · TP ${mix.final.true_peak_dbtp} dBTP · LRA ${mix.final.lra_lu} LU · narração ${mix.gains.voice_db} dB · música ${mix.gains.music_db} dB · global ${mix.gains.global_db} dB (${mix.gains.limited_by})`,
          `alinhamento stem→mix: ${mix.alignment.status} · ${mix.alignment.lag_samples} amostras (r=${mix.alignment.correlation})`] : [])]);
      return sync.status === 'FAIL' || mix?.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
    }
    if (op === 'verify') {
      const plan = readJson(path.resolve(pos[0] ?? '')); const { ffmpeg } = tools(loaded);
      if (!o.audio) return fail('USAGE', '--audio arquivo');
      if (o.reference) {                                                    // prévia (AAC/mux) vs mix de referência
        const g = globalLag(decodeMono(ffmpeg, path.resolve(o.reference)), decodeMono(ffmpeg, path.resolve(o.audio)));
        const tol = num(o.tolerance, '--tolerance') ?? 1; const st = Math.abs(g.lag_ms) <= tol && g.correlation >= 0.9 ? 'PASS' : 'FAIL';
        out({ ...g, status: st, tolerance_ms: tol }, [`alinhamento vs ${path.basename(o.reference)}: ${st} · ${g.lag_samples} amostras (${g.lag_ms} ms) · r=${g.correlation}`]);
        return st === 'PASS' ? EXIT.OK : EXIT.FAIL;
      }
      if (!o.conformed) return fail('USAGE', '--conformed <pasta dos cues conformados>');
      const conformed = Object.fromEntries(plan.cues.map((c) => [c.id, decodeMono(ffmpeg, path.join(path.resolve(o.conformed), `${c.id}-${c.sound.id}.wav`))]));
      const v = verifySync({ samples: decodeMono(ffmpeg, path.resolve(o.audio)), plan, conformed, offset: num(o.offset, '--offset') ?? 0, toleranceMs: num(o.tolerance, '--tolerance') ?? 1 });
      out(v, [`sincronia: ${v.status} · ${v.checked} cue(s) · erro máx ${v.max_abs_error_ms ?? '—'} ms`, ...v.rows.map((r) => `  ${r.cue} ${r.sound.padEnd(28)} ${r.status}${r.error_ms !== undefined ? ` ${r.error_ms} ms (${r.error_samples} amostras, r=${r.correlation})` : ''}`)]);
      return v.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
    }
    if (op === 'measure') {
      const { ffmpeg } = tools(loaded); const rows = pos.map((f) => ({ file: path.basename(f), ...loudness(ffmpeg, path.resolve(f)) }));
      out(rows, rows.map((r) => `  ${r.file}: ${r.integrated_lufs} LUFS · TP ${r.true_peak_dbtp} dBTP · LRA ${r.lra_lu} LU`)); return EXIT.OK;
    }
    if (op === 'export') {
      const plan = readJson(path.resolve(pos[0] ?? '')); if (plan.schema !== 'bold.sound-plan/1') return fail('INPUT_INVALID', 'não é bold.sound-plan/1');
      if (!o['remotion-tsx'] && !o['davinci-csv']) return fail('USAGE', '--remotion-tsx f e/ou --davinci-csv f');
      const files = {}; if (o.conformed) for (const c of plan.cues) files[c.id] = path.join(path.resolve(o.conformed), `${c.id}-${c.sound.id}.wav`);
      const done = [];
      if (o['remotion-tsx']) { writeNew(path.resolve(o['remotion-tsx']), remotionTsx(plan, { files, publicPrefix: o['public-prefix'] ?? 'sons/conformados' })); done.push(o['remotion-tsx']); }
      if (o['davinci-csv']) { const d = davinciCueList(plan, { files, tcStart: o['tc-start'] ?? '00:00:00:00' }); writeNew(path.resolve(o['davinci-csv']), d.csv); writeNew(path.resolve(`${o['davinci-csv'].replace(/\.csv$/i, '')}.davinci.json`), `${JSON.stringify({ ...d, csv: undefined }, null, 2)}\n`); done.push(o['davinci-csv']); }
      out({ ok: true, written: done }, [`exportado: ${done.join(', ')}`, '  DaVinci: o BOLD não escreve na timeline sem autorização davinci-write; importe os WAV conformados e posicione pelo record_tc.']);
      return EXIT.OK;
    }
    if (op === 'mux') {
      if (!o.video || !o.audio || !o.output) return fail('USAGE', '--video v --audio a --output f');
      const project = loaded.project.valid ? loaded.project.data.project_id : null;
      const command = `bold audio mux --video ${path.basename(o.video)} --audio ${path.basename(o.audio)} --output ${path.basename(o.output)}`;
      const authorization = await obtainAuthorization(o, 'preview-video', command, project);
      try { authorizeOrThrow({ action: 'preview-video', authorization, project, command, logDirs: { projectRoot: loaded.project.valid ? loaded.project.root : null, cacheDir: loaded.config.CACHE_DIR } }); }
      catch (e) { if (e instanceof AuthorizationError) return fail('DENIED', e.message); throw e; }
      const { ffmpeg, ffprobe } = tools(loaded);
      let videoCodec = null; try { videoCodec = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', path.resolve(o.video)], { encoding: 'utf8' }).trim(); } catch { /* sem vídeo: o ffmpeg falha adiante */ }
      const f = muxPreview(ffmpeg, { video: path.resolve(o.video), audio: path.resolve(o.audio), outFile: path.resolve(o.output), format: o.format ?? 'mov', videoCodec });
      const L = loudness(ffmpeg, f);
      out({ ok: true, output: f, loudness: L }, [`prévia com áudio → ${o.output} · ${L.integrated_lufs} LUFS · TP ${L.true_peak_dbtp} dBTP`]); return EXIT.OK;
    }
    if (op === 'openverse') {
      const sub = pos[0];
      if (sub === 'search') {
        const q = pos.slice(1).join(' ');
        const r = await ov.search(q, { page: num(o.page, '--page') ?? 1, pageSize: Math.min(20, num(o.limit, '--limit') ?? 10) });
        out(r, [`Openverse "${r.term ?? q}" · ${r.result_count ?? 0} resultado(s) · página ${r.page}/${r.page_count ?? '?'}${r.ratelimit?.burst ? ` · restam ${r.ratelimit.burst}/min, ${r.ratelimit.sustained}/dia` : ''}`,
          ...r.tried.filter((t) => t.term !== r.term).map((t) => `  (tentado "${t.term}": ${t.result_count})`),
          ...r.results.map((x) => `  ${x.id.slice(0, 8)} ${String(x.title).slice(0, 34).padEnd(34)} ${String(x.creator ?? '—').slice(0, 16).padEnd(16)} ${`${x.license}${x.license_version ? ` ${x.license_version}` : ''}`.padEnd(10)} ${x.duration_s !== null ? `${x.duration_s.toFixed(1)} s` : '?'} ${x.filetype}  ${x.commercial}${x.download.ok ? '' : ` · download ✗ ${x.download.why[0]}`}`),
          '  Nada foi baixado. Para baixar: bold audio openverse fetch <id> --project <dir> --yes']);
        return EXIT.OK;
      }
      if (sub === 'fetch') {
        const id = pos[1]; if (!/^[0-9a-f-]{36}$/.test(id ?? '')) return fail('USAGE', 'id do Openverse (uuid)');
        if (!loaded.project.valid) return fail('PROJECT_REQUIRED', 'download só para um projeto autorizado: --project <dir com bold.project.json>');
        if (!o.yes) return fail('CONFIRMATION_REQUIRED', 'baixa 1 arquivo para <projeto>/sons/: repita com --yes');
        let item;
        if (o.from) {                                         // resultado salvo de `openverse search --json` (reavaliado aqui)
          const saved = readJson(path.resolve(o.from)); const e = (saved.results ?? []).find((r) => r.id === id);
          if (!e) return fail('USAGE', `id ${id} não está em ${path.basename(o.from)}`);
          item = ov.reevaluate(e);
        } else { const { json } = await ov.getJson(`${ov.API}${id}/`); item = ov.evaluate(json); }
        const { ffprobe } = tools(loaded);
        const sons = path.join(loaded.project.root, 'sons');
        const dl = await ov.download(item, { sonsDir: sons, ffprobe, allowUnverified: !!o['allow-unverified'] });
        const credit = recordOpenverseCredit(sons, dl);
        out({ ok: true, file: dl.file, sha256: dl.sha256, probe: dl.probe, credit }, [`baixado → sons/${dl.name} (${dl.bytes} B · ${dl.probe.codec} ${dl.probe.sample_rate} Hz · ${dl.probe.duration_s.toFixed(2)} s · sha256 ${dl.sha256.slice(0, 12)}…)`, `  licença ${item.license.toUpperCase()} ${item.license_version ?? ''} · ${item.commercial} · crédito em sons/creditos.txt`]);
        return EXIT.OK;
      }
      return fail('USAGE', 'openverse search <termos> | fetch <id> --project <dir> --yes');
    }
    if (op === 'earshot') {
      const loc = locateEarshot({ config: loaded.config }); const sub = pos[0]; let ffmpeg = null; try { ffmpeg = resolveTools(loaded.config).ffmpeg; } catch { /* opcional */ }
      if (sub === 'status' || !sub) { const s = earshotStatus(loc); out(s, [s.installed ? `Earshot ${s.version} @ ${String(s.commit).slice(0, 7)} · modelos ${s.models_ready ? 'prontos' : 'ausentes'} · MCP ${s.mcp_registered ? 'registrado' : 'não registrado'}` : 'Earshot não instalado (opcional): bold audio setup earshot']); return EXIT.OK; }
      const map = { describe: ['describe'], measure: ['measure'], timeline: ['timeline'], critique: ['critique'], list: ['sfx', 'list'] };
      if (sub === 'render') {
        if (!o.output) return fail('USAGE', '--output arquivo.wav');
        const f = path.resolve(o.output); const r = renderProcedural(loc, pos[1], f, { dur: num(o.dur, '--dur'), apex: num(o.apex, '--apex'), ffmpeg });
        recordOrigin(path.dirname(f), { file: path.basename(f), origin: 'earshot-procedural', recipe: pos[1], license: 'gerado (código MIT; sem gravação de terceiros, exceto receitas "fit" de gravações CC0)', credit_required: false });
        out(r, [`gerado → ${o.output}`]); return EXIT.OK;
      }
      if (!map[sub]) return fail('USAGE', 'earshot status | describe | measure | timeline | critique | list | render');
      const a = [...map[sub], ...(sub === 'list' ? [] : [path.resolve(pos[1] ?? '')])];
      if (sub === 'timeline' && o.cues) a.push('--cues', path.resolve(o.cues));
      if (sub === 'list' && o.category) a.push('--category', o.category);
      const r = runEarshot(loc, a, { ffmpeg }); out(r, [JSON.stringify(r, null, 2).slice(0, 4000)]); return EXIT.OK;
    }
    if (op === 'setup') {
      const which = pos[0] ?? 'all'; const roots = audioRoots(); const lock = readLibraryLock(); const steps = {};
      if (which === 'sfx-kit' || which === 'all') { const p = libraryPlan(lock, roots.libraries); steps['sfx-kit'] = { ...p, command: p.installed ? null : 'bold audio library install --yes' }; }
      if (which === 'earshot' || which === 'all') {
        const s = earshotStatus(locateEarshot({ config: loaded.config }));
        steps.earshot = { installed: s.installed, optional: true, license: 'MIT', requires: ['Python ≥ 3.10', 'FFmpeg + ffprobe', '~1.1 GB venv (PyTorch CPU)', '~1.1 GB modelos CLAP + AST (download separado, com aprovação)'],
          commands: s.installed ? [] : [`git clone --branch v0.4.0 --depth 1 https://github.com/Leonxlnx/earshot.git "${tidy(path.join(roots.tools, 'earshot'))}"`, 'python3.11 -m venv .venv', `.venv/bin/python -m pip install --require-hashes --no-deps -r ${tidy(path.join(loaded.config.BOLD_HOME, 'audio', 'earshot-0.4.0.lock.txt'))}`, '.venv/bin/python -m pip install --no-deps --no-build-isolation -e .', `EARSHOT_HOME="${tidy(roots.models ?? path.join(roots.tools, 'earshot-home'))}" .venv/bin/earshot doctor --fetch   # modelos ~1.1 GB: só com aprovação`],
          ...(roots.cache ? { pip_cache: `PIP_CACHE_DIR="${tidy(path.join(roots.cache, 'pip'))}"` } : {}),
          mcp: 'registro do MCP só depois de aprovado: claude mcp add earshot --scope user … (ver references/sound-design.md)', note: 'O BOLD não executa estes passos: instalação guiada, com sua confirmação a cada etapa.' };
      }
      if (roots.storage) steps.storage = { state: roots.storage.state, root: tidy(roots.storage.root), online: roots.storage.online, ...(roots.storage.online ? {} : { blocked: 'instalação bloqueada até o armazenamento voltar (nada vai para o disco interno)', recover: roots.storage.recover }) };
      out(steps, Object.entries(steps).map(([k, v]) => `${k}: ${v.installed ? 'instalado' : 'não instalado'}${v.command ? ` → ${v.command}` : ''}${v.commands?.length ? `\n  ${v.commands.join('\n  ')}` : ''}`)); return EXIT.OK;
    }
    if (op === 'storage') {
      const sub = pos[0] ?? 'status';
      if (sub === 'status') {
        const st = currentStorage(); const vol = st.online ? volumeInfo(st.root) : null;
        out({ ...st, free_bytes: vol?.free_bytes ?? null }, [st.configured ? `${st.state} · ${tidy(st.root)}${vol?.free_bytes ? ` · livre ${(vol.free_bytes / 2 ** 30).toFixed(1)} GiB` : ''}${st.online ? '' : `\n  ${st.detail}\n  indisponível: ${st.unavailable.join('; ')}\n  continua: ${st.available.join('; ')}\n  recuperar: ${st.recover}`}` : 'NOT_CONFIGURED · padrão interno (bold audio storage candidates lista os volumes externos)']);
        return st.configured && !st.online ? EXIT.UNAVAILABLE : EXIT.OK;
      }
      if (sub === 'candidates') { const c = storageCandidates(); out(c, c.length ? c.map((v) => `  ${v.path.padEnd(32)} ${String(v.fs ?? '?').padEnd(8)} ${v.free_bytes ? `${(v.free_bytes / 2 ** 30).toFixed(0)} GiB livres` : ''} ${v.location ?? ''} → ${v.recommendation.use}: ${v.recommendation.why}${v.recommendation.command ? `\n      ${v.recommendation.command}` : ''}`) : ['  nenhum volume externo montado']); return EXIT.OK; }
      if (sub === 'set') { const r = setStorage({ root: pos[1] ? path.resolve(pos[1]) : null, image: o.image ? path.resolve(o.image) : null, yes: !!o.yes }); out(r, [`${r.status} (${r.action}) · ${r.root}${r.replaces ? ` · substitui ${r.replaces.root} (registro anterior guardado como .bak)` : ''}`, `  registro ${tidy(r.file)} · marca ${r.marker} · nenhum dado é movido`, ...(r.note ? [`  ${r.note}`] : [])]); return EXIT.OK; }
      if (sub === 'attach') { const r = attachStorage({ yes: !!o.yes }); out(r, [`${r.status} · ${tidy(r.root)}${r.command ? ` · ${r.command}` : ''}${r.note ? ` · ${r.note}` : ''}`]); return EXIT.OK; }
      if (sub === 'clear') { const r = clearStorage({ yes: !!o.yes }); out(r, [`${r.status}${r.backup ? ` · registro guardado em ${tidy(r.backup)}` : ''}${r.note ? ` · ${r.note}` : ''}`]); return EXIT.OK; }
      return fail('USAGE', 'storage status | candidates | set <pasta> [--image f] --yes | attach --yes | clear --yes');
    }
    return fail('USAGE', `comando desconhecido: ${op}`);
  } catch (e) {
    if (e instanceof AudioError || e instanceof TimeError) return fail(e.code, e.message.replace(/^[A-Z_0-9]+: /, ''), e.details ?? null);
    throw e;
  }
}
