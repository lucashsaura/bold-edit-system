// Comandos de mídia/entrega: probe, qc, delivery (R4).
// Tudo que GERA vídeo passa pelo policy gate (autorização estruturada). Não há bypass.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { resolveTools } from '../../core/delivery/tools.mjs';
import { probeFile, countFrames } from '../../core/delivery/ffprobe.mjs';
import { validateMedia } from '../../core/delivery/validate.mjs';
import { getProfile, PROFILES, PROFILE_IDS } from '../../core/delivery/profiles.mjs';
import { encodeSequence, fpsNumber } from '../../core/delivery/encode.mjs';
import { blurSubframes } from '../../core/delivery/blur.mjs';
import { fixColor, StopError } from '../../core/delivery/fixcolor.mjs';
import { AuthorizationError } from '../../core/delivery/authorize.mjs';
import { parseAuthorization, interactiveConfirmation } from '../../core/policy/gate.mjs';
import { qcFile, qcAlpha } from '../../core/qc/qc.mjs';

export const EXIT = Object.freeze({ OK: 0, FAIL: 1, USAGE: 64, STOP: 3, DENIED: 4, UNAVAILABLE: 5 });

const num = (v, name) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} inválido: ${v}`);
  return n;
};
const int = (v, name) => { const n = num(v, name); if (n != null && !Number.isInteger(n)) throw new Error(`${name} deve ser inteiro`); return n; };

function fmtCheck(c) {
  const tag = c.status === 'PASS' ? 'PASS   ' : c.status === 'WARNING' ? 'WARNING' : 'FAIL   ';
  const exp = c.expected != null && typeof c.expected !== 'object' ? ` (esperado ${c.expected}` : '';
  const act = c.actual != null && typeof c.actual !== 'object' ? `${exp ? ', ' : ' ('}atual ${c.actual})` : (exp ? ')' : '');
  return `  ${tag}  ${c.id}: ${c.message}${exp}${act}`;
}

function fmtMeta(m) {
  const v = m.video || {};
  const rows = [
    ['arquivo', m.file], ['container', m.container], ['codec', v.codec], ['profile', v.profile], ['codec_tag', v.codec_tag],
    ['pix_fmt', v.pix_fmt], ['resolução', v.width ? `${v.width}×${v.height}` : null], ['fps', v.fps != null ? `${v.fps} (${v.r_frame_rate})` : null],
    ['duração', m.duration != null ? `${m.duration} s` : null], ['nb_frames (header)', v.nb_frames_header], ['nb_frames (contados)', m.nb_frames_counted],
    ['color_primaries', v.color_primaries], ['color_transfer', v.color_transfer], ['color_space', v.color_space], ['color_range', v.color_range],
    ['alpha', v.alpha_capable ? 'sim (pix_fmt com alpha)' : 'não'], ['áudio', `${m.audio_streams} stream(s)`],
    ['outros streams', m.other_streams.length ? m.other_streams.join(', ') : 'nenhum'],
  ];
  return rows.map(([k, val]) => `  ${k.padEnd(22)} ${val ?? '—'}`).join('\n');
}

function profileOpt(o) { return o.profile ? getProfile(o.profile) : null; }

// ───────────────────────────── probe ─────────────────────────────
export function cmdProbe(args, loaded, out = process.stdout) {
  const file = args._[1];
  if (!file) { process.stderr.write('uso: bold probe <arquivo> [--json] [--profile ID] [--expected-frames N] [--fps F] [--count-frames]\n'); return EXIT.USAGE; }
  const tools = resolveTools(loaded.config);
  const o = args.opts;
  let meta;
  try { meta = probeFile(tools.ffprobe, file); } catch (e) {
    const payload = { file, status: 'FAIL', error: e.message };
    out.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `bold probe: FAIL — ${e.message}\n`);
    return EXIT.FAIL;
  }
  const expectedFrames = int(o['expected-frames'], '--expected-frames');
  if (o['count-frames'] || expectedFrames != null) meta.nb_frames_counted = countFrames(tools.ffprobe, file);
  const profile = profileOpt(o);
  const validation = validateMedia(meta, { profile, expectedFrames, fps: o.fps != null ? fpsNumber(o.fps) : null });
  const payload = { file, profile: profile ? { id: profile.id, version: profile.version } : null, meta, validation };
  if (args.json) out.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    out.write(`bold probe${profile ? ` — perfil ${profile.id} v${profile.version}` : ''}\n${fmtMeta(meta)}\n\nValidação${profile ? '' : ' (sem perfil: tags de cor são informativas)'}:\n`);
    out.write(`${validation.checks.map(fmtCheck).join('\n')}\n→ ${validation.status}\n`);
  }
  return validation.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
}

// ───────────────────────────── qc ─────────────────────────────
export async function cmdQc(args, loaded, out = process.stdout) {
  const kind = args._[1];
  const file = args._[2];
  if (kind === 'stills') return cmdQcStills(args, loaded, out);
  if (!['file', 'alpha'].includes(kind) || !file) {
    process.stderr.write('uso: bold qc file|alpha <arquivo> [--profile ID] [--expected-frames N] [--fps F] [--width W --height H] [--expect-empty-ends] [--samples K] [--json]\n');
    return EXIT.USAGE;
  }
  const tools = resolveTools(loaded.config);
  const o = args.opts;
  const params = {
    tools, file, profile: profileOpt(o), expectedFrames: int(o['expected-frames'], '--expected-frames'),
    fps: o.fps != null ? fpsNumber(o.fps) : null, width: int(o.width, '--width'), height: int(o.height, '--height'),
  };
  const res = kind === 'alpha'
    ? qcAlpha({ ...params, expectEmptyEnds: !!o['expect-empty-ends'], samples: int(o.samples, '--samples') ?? 5 })
    : qcFile(params);
  if (args.json) out.write(`${JSON.stringify(res, null, 2)}\n`);
  else {
    out.write(`bold qc ${kind} — ${file}\nMACHINE QC:\n${res.machine_qc.checks.map(fmtCheck).join('\n')}\n→ MACHINE QC: ${res.machine_qc.status}\n`);
    out.write(`VISUAL QC: ${res.visual_qc.status} — ${res.visual_qc.note}\n`);
  }
  return res.machine_qc.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
}

// ───────────────────────────── delivery ─────────────────────────────
async function obtainAuthorization(o, action, command, project) {
  if (o['authorization-file']) return parseAuthorization(fs.readFileSync(o['authorization-file'], 'utf8'));
  if (o.authorization) return parseAuthorization(o.authorization);
  if (process.stdin.isTTY && process.stderr.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await interactiveConfirmation({ action, command, project, io: { isTTY: true, ask: (q) => new Promise((r) => rl.question(q, r)) } });
    } finally { rl.close(); }
  }
  return null; // sem autorização → o gate nega
}

function logDirsFor(loaded) {
  return { projectRoot: loaded.project.valid ? loaded.project.root : null, cacheDir: loaded.config.CACHE_DIR };
}

function report(out, json, payload, lines) {
  if (json) out.write(`${JSON.stringify(payload, null, 2)}\n`);
  else out.write(`${lines.join('\n')}\n`);
}

export async function cmdDelivery(args, loaded, out = process.stdout) {
  const sub = args._[1];
  const o = args.opts;
  if (sub === 'profiles') {
    const payload = PROFILE_IDS.map((id) => ({ id, ...PROFILES[id] }));
    report(out, args.json, payload, payload.map((p) => `  ${p.id} v${p.version}  ${p.label}  [${p.encoder} ${p.encoder_profile} · ${p.pix_fmt} · ${p.color.primaries}/${p.color.transfer}/${p.color.space}/${p.color.range}]`));
    return EXIT.OK;
  }
  if (!['encode', 'blur', 'fix-color'].includes(sub)) {
    process.stderr.write([
      'uso:',
      '  bold delivery profiles',
      '  bold delivery encode --input dir/f_%06d.png --fps F --expected-frames N --profile ID --output out.mov [--start-number S]',
      '  bold delivery blur   --input dir/s_%06d.png --fps F --subframes SUB --shutter 0..1 --expected-frames N --profile ID --output out.mov',
      '  bold delivery fix-color <entrada> <saída> [--profile ID] [--evidence-pixel x,y,#RRGGBB[,frame]] [--source-matrix bt601|bt709 --evidence "..."]',
      'autorização (ação protegida "encode"): --authorization-file auth.json | --authorization \'{json}\' | confirmação interativa (TTY)',
      '',
    ].join('\n'));
    return EXIT.USAGE;
  }
  const tools = resolveTools(loaded.config);
  const project = loaded.project.valid ? loaded.project.data.project_id : null;
  const command = `bold delivery ${sub}`;
  const common = { tools, logDirs: logDirsFor(loaded), projectRoot: loaded.project.valid ? loaded.project.root : null, project, command };
  try {
    const authorization = await obtainAuthorization(o, 'encode', command, project);
    let res;
    if (sub === 'encode') {
      res = encodeSequence({ ...common, authorization, input: o.input, startNumber: int(o['start-number'], '--start-number'), fps: o.fps,
        expectedFrames: int(o['expected-frames'], '--expected-frames'), profileId: o.profile, output: o.output });
    } else if (sub === 'blur') {
      res = blurSubframes({ ...common, authorization, input: o.input, startNumber: int(o['start-number'], '--start-number'), fps: o.fps,
        subframes: int(o.subframes, '--subframes'), shutter: num(o.shutter, '--shutter') ?? 1, expectedFrames: int(o['expected-frames'], '--expected-frames'),
        profileId: o.profile, output: o.output, workRoot: path.join(loaded.config.CACHE_DIR, 'tmp'), keepTemp: !!o['keep-temp'] });
    } else {
      const [input, output] = [args._[2], args._[3]];
      if (!input || !output) throw new Error('fix-color exige <entrada> <saída>');
      let evidencePixel = null;
      if (o['evidence-pixel']) {
        const [x, y, hex, frame] = String(o['evidence-pixel']).split(',');
        evidencePixel = { x: int(x, 'x'), y: int(y, 'y'), hex, frame: int(frame ?? 0, 'frame') };
      }
      res = fixColor({ ...common, authorization, input, output, profileId: o.profile || null, evidencePixel,
        sourceMatrix: o['source-matrix'] || null, evidenceText: o.evidence || null });
      if (res.status === 'NOTHING_TO_DO') {
        report(out, args.json, { status: 'NOTHING_TO_DO', analysis: res.analysis }, ['bold delivery fix-color: entrada já está em BT.709 explícito — nada a fazer (nenhum arquivo gerado).']);
        return EXIT.OK;
      }
    }
    report(out, args.json, { status: res.validation.status, output: res.output, manifest: res.manifestPath, validation: res.validation, conversion: res.manifest.conversion },
      [`bold delivery ${sub}: ${res.output}`, `  manifest: ${res.manifestPath}`, ...res.validation.checks.map(fmtCheck), `→ ${res.validation.status}`]);
    return res.validation.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
  } catch (e) {
    if (e instanceof AuthorizationError) { process.stderr.write(`bold delivery ${sub}: ${e.message}\n  (registrado no log de autorização; nenhum arquivo gerado)\n`); return EXIT.DENIED; }
    if (e instanceof StopError) {
      report(out, args.json, { status: 'STOP', reason: e.message, details: e.details ?? null }, [`bold delivery ${sub}: ${e.message}`]);
      return EXIT.STOP;
    }
    process.stderr.write(`bold delivery ${sub}: erro: ${e.message}\n`);
    return EXIT.FAIL;
  }
}

// ───────────────────────────── render (R5) ─────────────────────────────
export async function cmdRender(args, loaded, out = process.stdout) {
  const specPath = args._[1];
  const o = args.opts;
  if (!specPath) { process.stderr.write('uso: bold render <motion.spec.json> [--output out.mov] [--authorization-file f] [--keep-frames] [--no-stills] [--concurrency N] [--verify-determinism] [--json]\n'); return EXIT.USAGE; }
  const { renderSpec, RenderError } = await import('../../core/render/render.mjs');
  const { disposeBundles } = await import('../../remotion/adapter/render-frames.mjs');
  const cfg = loaded.config;
  const project = loaded.project.valid ? loaded.project.data.project_id : null;
  const projectRoot = loaded.project.valid ? loaded.project.root : null;
  const tools = resolveTools(cfg);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const output = o.output ? path.resolve(o.output) : path.join(cfg.RENDER_DIR, `${spec.id}.mov`);
  if (!o.output) fs.mkdirSync(cfg.RENDER_DIR, { recursive: true });
  const tmpRoot = path.join(cfg.CACHE_DIR, 'tmp'); fs.mkdirSync(tmpRoot, { recursive: true });
  const workRoot = fs.mkdtempSync(path.join(tmpRoot, 'bold-cli-render-'));
  try {
    let authorization = null;
    if (o['authorization-file']) authorization = parseAuthorization(fs.readFileSync(o['authorization-file'], 'utf8'));
    else if (o.authorization) authorization = parseAuthorization(o.authorization);
    else if (process.stdin.isTTY && process.stderr.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const a = await interactiveConfirmation({ action: 'render', command: `bold render ${path.basename(specPath)} → ${output}`, project, io: { isTTY: true, ask: (q) => new Promise((r) => rl.question(q, r)) } });
        authorization = a ? { ...a, action: ['render', 'encode'] } : null;
      } finally { rl.close(); }
    }
    const res = await renderSpec({ specPath, authorization, tools, logDirs: { projectRoot, cacheDir: cfg.CACHE_DIR }, remotionDir: cfg.tools?.REMOTION_PROJECT_DIR ?? null,
      output, assetsRoot: projectRoot ?? path.dirname(path.resolve(specPath)), workRoot, projectRoot, project,
      keepFrames: !!o['keep-frames'], stills: !o['no-stills'], concurrency: o.concurrency ? Number(o.concurrency) : 1, verifyDeterminism: !!o['verify-determinism'] });
    const payload = { status: res.status, output: res.output, profile: res.profile, manifest: res.manifestPath, stills: res.stills?.dir ?? null,
      machine_qc: res.qc.machine_qc.status, visual_qc: res.qc.visual_qc.status, validation: res.validation.summary, render: res.render,
      ...(res.composite_qc ? { composite_qc: res.composite_qc.status, determinism: res.determinism ? res.determinism.status : null, trace: res.trace } : {}) };
    report(out, args.json, payload, [`bold render: ${res.output}`, `  perfil ${res.profile} · delivery ${res.validation.status} · MACHINE QC ${res.qc.machine_qc.status} · VISUAL QC ${res.qc.visual_qc.status}`,
      `  manifest: ${res.manifestPath}`, res.stills ? `  stills: ${res.stills.dir}` : '', ...res.qc.machine_qc.checks.filter((c) => c.status !== 'PASS').map(fmtCheck), `→ ${res.status}`].filter(Boolean));
    return res.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
  } catch (e) {
    if (e instanceof AuthorizationError) { process.stderr.write(`bold render: ${e.message}\n  (registrado; nada foi renderizado)\n`); return EXIT.DENIED; }
    if (e instanceof RenderError) {
      report(out, args.json, { status: e.code, reason: e.message, details: e.details ?? null }, [`bold render: ${e.message}`, ...(Array.isArray(e.details) ? e.details.map((d) => `  - ${d}`) : [])]);
      return e.code === 'BACKEND_DECISION_REQUIRED' ? EXIT.STOP : e.code === 'BACKEND_UNAVAILABLE' ? EXIT.UNAVAILABLE : EXIT.FAIL;
    }
    process.stderr.write(`bold render: erro: ${e.message}\n`);
    return EXIT.FAIL;
  } finally {
    disposeBundles();
    fs.rmSync(workRoot, { recursive: true, force: true }); // diretório temporário criado por este comando
  }
}

// ───────────────────────────── qc stills (R5) ─────────────────────────────
export async function cmdQcStills(args, loaded, out = process.stdout) {
  const file = args._[2];
  if (!file) { process.stderr.write('uso: bold qc stills <arquivo> [--output <dir>] [--no-contact-sheet] [--json]\n'); return EXIT.USAGE; }
  const { extractStills } = await import('../../core/qc/stills.mjs');
  const tools = resolveTools(loaded.config);
  const dir = args.opts.output ? path.resolve(args.opts.output) : path.join(path.dirname(path.resolve(file)), `${path.basename(file, path.extname(file))}_stills`);
  try {
    const r = extractStills({ tools, file, outDir: dir, contactSheet: !args.opts['no-contact-sheet'] });
    report(out, args.json, r, [`bold qc stills: ${r.dir}`, ...r.stills.map((s) => `  ${String(s.position).padEnd(5)} frame ${s.frame} → ${s.file}`), r.contact_sheet ? `  contact sheet → ${r.contact_sheet}` : '', `  ${r.note}`].filter(Boolean));
    return EXIT.OK;
  } catch (e) { process.stderr.write(`bold qc stills: ${e.message}\n`); return EXIT.FAIL; }
}
