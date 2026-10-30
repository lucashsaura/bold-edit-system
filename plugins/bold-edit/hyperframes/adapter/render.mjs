// HYPERFRAMES RENDER (R6.1) — `bold render` com decision.backend = "hyperframes".
// Ordem (nada de processo antes da autorização):
//   1 compilar (puro) · 2 gate ESTÁTICO de fontes no HTML gerado (puro) · 3 detecção do HyperFrames (leitura)
//   4 POLICY GATE: autorização estruturada cobrindo ["render","encode"] — sem ela, nenhum browser/HyperFrames inicia
//   5 job temporário · 6 gate DINÂMICO de fontes + layout · 7 lint 0/0 · 8 png-sequence (HF2, sob o network guard)
//   9 auditoria estrita da sequência [+ 2ª sequência e comparação SHA-256 frame a frame com --verify-determinism, ANTES do encode]
//   10 BOLD Delivery (ALPHA_4444_BT709, 1 encode) · 11 probe + MACHINE QC + alpha QC · 12 composite QC (critérios R6.0.1) · 13 stills
//   14 manifest final (delivery + render + qc + trace) · 15 cleanup do job
// O caminho 5–13 reutiliza as peças validadas na R6.0.1; o fim a fim por este orquestrador exige autorização de render.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileFromFiles, HyperFramesSpecError } from '../src/compile.mjs';
import { generateHtml, RUNTIME_SHA256 } from '../src/html.mjs';
import { staticFontGate, FontGateError } from './font-gate.mjs';
import { detectHF } from './browser.mjs';
import { writeJob, withJobPage, lintJob, JobError } from './job.mjs';
import { renderPngSequence, netAttempts } from './run.mjs';
import { authorizeOrThrow } from '../../core/delivery/authorize.mjs';
import { checkGate } from '../../core/policy/gate.mjs';
import { encodeSequence } from '../../core/delivery/encode.mjs';
import { getProfile } from '../../core/delivery/profiles.mjs';
import { auditPngSequence, compareSequences } from '../../core/qc/sequence.mjs';
import { compositeCompare, compositeVerdict } from '../../core/qc/composite.mjs';
import { decodeFramesRGBA } from '../../core/qc/frames.mjs';
import { decodePNG } from '../../core/qc/png.mjs';
import { qcAlpha, qcFile } from '../../core/qc/qc.mjs';
import { extractStills } from '../../core/qc/stills.mjs';

export class HFRenderError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; this.name = 'RenderError'; } }

/** Etapas 1–2 (puras): compila e aplica o gate estático. Usado também por `bold motion validate/compile`. */
export function prepareHyperFrames(spec, { specDir, format = null }) {
  let plan;
  try { plan = compileFromFiles(spec, { specDir, format }); } catch (e) { if (e instanceof HyperFramesSpecError) throw new HFRenderError('SPEC_UNSUPPORTED', 'motion.spec fora do subset HyperFrames V1', e.errors); throw e; }
  const html = generateHtml(plan);
  const fonts = plan.fonts.map((f) => ({ ...f, abs: path.join(fs.realpathSync(specDir), f.file) }));
  const gate = staticFontGate(html, fonts, { projectDir: specDir });
  if (gate.status !== 'PASS') throw new HFRenderError('FONT_GATE_FAIL', 'gate estático de fontes', gate.errors);
  return { plan, html, static_font_gate: gate };
}

export async function renderHyperFramesSpec({ specPath, authorization, tools, logDirs, output, workRoot = os.tmpdir(), projectRoot = null, project = null, stills = true, format = null, detect = null,
  keepFrames = false, verifyDeterminism = false }) {
  const trace = []; const step = (s) => trace.push(s);
  step('load'); const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const specDir = path.dirname(path.resolve(specPath));
  step('authoring+select+compile+plan+static_font_gate'); const { plan, static_font_gate } = prepareHyperFrames(spec, { specDir, format });
  step('detect'); const det = (detect ?? detectHF)();
  if (det.status !== 'AVAILABLE') throw new HFRenderError('BACKEND_UNAVAILABLE', `HyperFrames indisponível: ${det.reason}`);
  output = path.resolve(output);
  if (fs.existsSync(output)) throw new HFRenderError('OUTPUT_EXISTS', `saída já existe (nunca sobrescrevo): ${path.basename(output)}`);
  if (!fs.existsSync(path.dirname(output))) throw new HFRenderError('OUTPUT_DIR', 'diretório de saída não existe');
  // 4) POLICY GATE — antes de QUALQUER processo (browser, HyperFrames, ffmpeg) e de qualquer diretório de job
  step('policy_gate'); const cmd = `bold render ${path.basename(specPath)} (hyperframes)`;
  authorizeOrThrow({ action: 'render', authorization, project, command: cmd, logDirs });
  if (!checkGate({ action: 'encode', authorization, project, command: cmd }).allowed) authorizeOrThrow({ action: 'encode', authorization, project, command: cmd, logDirs });

  step('job (network guard + cache de fontes isolado)'); const job = writeJob(plan, { projectDir: specDir, jobRoot: workRoot });
  const C = plan.composition; const seqOpts = { expected: C.frames, width: C.width, height: C.height, colorType: 'rgba' };
  try {
    step('dynamic_font_gate'); const page = await withJobPage(det, job, plan);
    if (page.dynamic_font_gate.status !== 'PASS') throw new HFRenderError('FONT_GATE_FAIL', 'gate dinâmico de fontes', page.dynamic_font_gate.errors);
    step('lint'); const lint = lintJob(det, job);
    if (lint.status !== 'PASS') throw new HFRenderError('LINT_FAIL', `hyperframes lint: ${lint.errors} errors, ${lint.warnings} warnings`, lint.output);
    const runSeq = (tag) => {
      step(`render_${tag}`); const dir = path.join(job.dir, `frames_${tag}`);
      const r = renderPngSequence(det, { projectDir: job.dir, outDir: dir, fps: C.fps, authorization, logDirs, ...job.policy });
      if (r.status !== 'PASS') throw new HFRenderError(r.net.length ? 'NETWORK_ATTEMPT' : 'RENDER_FAILED', r.reason, (r.stdout + r.stderr).slice(-800));
      step(`audit_${tag}`); const a = auditPngSequence(dir, seqOpts);
      if (a.status !== 'PASS') throw new HFRenderError('FRAME_MISMATCH', `sequência ${tag} inválida`, a.errors);
      return { dir, audit: a };
    };
    const A = runSeq('A');
    let determinism = null;
    if (verifyDeterminism) { // exatamente 2 sequências; nenhuma 3ª. Divergência → FAIL antes do encode
      const B = runSeq('B'); step('determinism'); determinism = compareSequences(A.audit, B.audit);
      if (determinism.status !== 'PASS') throw new HFRenderError('NON_DETERMINISTIC', `${determinism.differing.length} frame(s) divergentes entre A e B`, determinism.errors);
      if (keepFrames) fs.cpSync(B.dir, `${output.replace(/\.[^.]+$/, '')}_frames_B`, { recursive: true, dereference: true });
    }
    const netAttemptsTotal = netAttempts(job.policy.netLog).length + page.requests.filter((u) => !/^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:|about:)/.test(u)).length;
    if (netAttemptsTotal) throw new HFRenderError('NETWORK_ATTEMPT', `${netAttemptsTotal} tentativa(s) de rede externa`);
    const profile = getProfile(C.transparent ? 'ALPHA_4444_BT709' : 'OPAQUE_4444_BT709');
    const manifestExtra = { backend: 'hyperframes', backend_version: `bold-hyperframes-backend@${plan.backend_version}`, plan_version: plan.plan_version, hyperframes_version: det.hfVersion,
      chrome_headless_shell: det.chromeVersion, puppeteer_core: det.ppVersion, node_version: process.version, os: `${os.platform()} ${os.release()} ${os.arch()}`, software_rendering: true, browser_gpu: '--no-browser-gpu (SwiftShader)',
      runtime_sha256: RUNTIME_SHA256, spec_sha256: plan.source.spec_sha256, tokens_sha256: plan.source.tokens_sha256, html_sha256: job.html_sha256, seed: plan.seed, fps: C.fps,
      frames_expected: C.frames, frames_actual: A.audit.count, resolution: `${C.width}x${C.height}`, format: C.format, transparent: C.transparent, fonts: plan.fonts,
      png_sha256: A.audit.frames.map((f) => f.sha256), determinism: determinism ? { runs: 2, identical: determinism.identical, frames_compared: A.audit.count } : { runs: 1, identical: null },
      network_policy: { guard: true, telemetry: 'off', update_check: 'off', auto_install: 'off', skills: 'off', gemini: 'removed', external_attempts: netAttemptsTotal },
      font_policy: { manifest: plan.source.font_manifest, static: static_font_gate.status, dynamic: page.dynamic_font_gate.status, cache: 'isolado por job (temporário)', historical_cache: 'DO_NOT_TOUCH' } };
    step('delivery'); const delivered = encodeSequence({ input: path.join(A.dir, 'frame_%06d.png'), startNumber: 1, fps: C.fps, expectedFrames: C.frames, profileId: profile.id, output, authorization, tools, logDirs, projectRoot, project, command: cmd, manifestExtra });
    step('probe+machine_qc+alpha_qc'); const qc = C.transparent ? qcAlpha({ tools, file: output, profile, expectedFrames: C.frames, fps: C.fps, width: C.width, height: C.height }) : qcFile({ tools, file: output, profile, expectedFrames: C.frames, fps: C.fps, width: C.width, height: C.height });
    step('composite_qc'); const idx = [...new Set([0, Math.round((C.frames - 1) / 4), Math.round((C.frames - 1) / 2), Math.round((3 * (C.frames - 1)) / 4), C.frames - 1])];
    const mf = decodeFramesRGBA({ ffmpeg: tools.ffmpeg, file: output, indices: idx, width: C.width, height: C.height, matrix: 'bt709', range: 'tv' });
    const composite = idx.map((i, k) => ({ frame_index: i, ...compositeCompare(decodePNG(fs.readFileSync(path.join(A.dir, A.audit.frames[i].name))).data, mf[k], C.width, C.height) }));
    const compositeQc = compositeVerdict(composite);
    step('stills'); const st = stills ? extractStills({ tools, file: output, outDir: path.join(path.dirname(output), `${path.basename(output, path.extname(output))}_stills`) }) : null;
    if (keepFrames) fs.cpSync(A.dir, `${output.replace(/\.[^.]+$/, '')}_frames_A`, { recursive: true, dereference: true });
    step('manifest'); const man = JSON.parse(fs.readFileSync(delivered.manifestPath, 'utf8'));
    man.qc = { machine_qc: qc.machine_qc.status, alpha_qc: C.transparent ? qc.machine_qc.checks.filter((c) => c.id.startsWith('alpha.')).every((c) => c.status !== 'FAIL') ? 'PASS' : 'FAIL' : null,
      composite_qc: compositeQc.status, composite_frames: idx, visual_qc: 'HUMAN_REVIEW_REQUIRED', stills: st ? path.basename(st.dir) : null };
    man.render.trace = [...trace, 'cleanup'];
    fs.writeFileSync(delivered.manifestPath, `${JSON.stringify(man, null, 2)}\n`);
    const status = delivered.validation.status === 'FAIL' || qc.machine_qc.status === 'FAIL' || compositeQc.status === 'FAIL' ? 'FAIL' : 'PASS';
    return { status, output, profile: profile.id, manifestPath: delivered.manifestPath, validation: delivered.validation, qc, composite, composite_qc: compositeQc, determinism, stills: st, render: manifestExtra, trace: man.render.trace, page, lint };
  } catch (e) {
    if (e instanceof FontGateError) throw new HFRenderError('FONT_GATE_FAIL', 'gate de fontes', e.errors);
    if (e instanceof JobError) throw new HFRenderError(e.code, e.message, e.details);
    throw e;
  } finally { job.dispose(); }
}
