// BOLD RENDER — motion.spec → (Remotion) PNG SEQUENCE → BOLD DELIVERY → probe → MACHINE QC → stills → manifest.
// 1 validar spec · 2 resolver tokens · 3 backend explícito · 4 doctor do backend · 5 autorização ·
// 6 frames · 7 delivery · 8 probe · 9 QC · 10 manifest · 11 resultado.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validate } from '../schema/validate.mjs';
import { checkGate } from '../policy/gate.mjs';
import { authorizeOrThrow } from '../delivery/authorize.mjs';
import { encodeSequence } from '../delivery/encode.mjs';
import { blurSubframes } from '../delivery/blur.mjs';
import { getProfile } from '../delivery/profiles.mjs';
import { qcAlpha, qcFile } from '../qc/qc.mjs';
import { extractStills } from '../qc/stills.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..');
const SPEC_SCHEMA = JSON.parse(fs.readFileSync(path.join(SKILL, 'motion', 'spec', 'motion.spec.schema.json'), 'utf8'));
const TOKENS_SCHEMA = JSON.parse(fs.readFileSync(path.join(SKILL, 'motion', 'spec', 'tokens.schema.json'), 'utf8'));
const BACKEND_PKG = JSON.parse(fs.readFileSync(path.join(SKILL, 'remotion', 'package.json'), 'utf8'));

export class RenderError extends Error {
  constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; this.name = 'RenderError'; }
}

export const canonicalHash = (obj) => crypto.createHash('sha256').update(JSON.stringify(sortKeys(obj))).digest('hex');
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

let specMod = null;
async function loadSpecModule() { specMod ??= await import('../../remotion/src/core/spec.ts'); return specMod; }

/** Etapas 1–3 (somente leitura): valida spec + tokens, monta o plano, exige backend explícito. */
export async function preparePlan({ spec, specDir, tokens = null }) {
  const errs = validate(SPEC_SCHEMA, spec);
  if (errs.length) throw new RenderError('SPEC_INVALID', 'motion.spec não passa no schema', errs);
  const backend = spec.decision?.backend;
  if (!backend || backend === 'undecided') throw new RenderError('BACKEND_DECISION_REQUIRED', 'decision.backend não definido (a decisão automática é da R9); declare "remotion" ou "hyperframes"');
  // R6.1 — contrato de seleção: TYPE_* exige o backend HyperFrames (nunca vai ao Remotion, nem por engano)
  const typeLayers = (Array.isArray(spec.composition?.layers) ? spec.composition.layers : []).map((L, i) => [i, L?.pattern]).filter(([, p]) => typeof p === 'string' && p.startsWith('TYPE_'));
  if (backend === 'hyperframes') {
    const { prepareHyperFrames, HFRenderError } = await import('../../hyperframes/adapter/render.mjs');
    try { const r = prepareHyperFrames(spec, { specDir }); return { plan: r.plan, tokensDoc: null, backend, html: r.html }; } catch (e) { if (e instanceof HFRenderError) throw new RenderError(e.code, e.message.replace(/^[A-Z_]+: /, ''), e.details); throw e; }
  }
  if (backend === 'remotion' && typeLayers.length) throw new RenderError('PATTERN_BACKEND_MISMATCH', `${typeLayers.map(([i, p]) => `composition.layers[${i}] ${p}`).join(', ')}: patterns TYPE_* exigem decision.backend = "hyperframes"`, typeLayers.map(([i, p]) => ({ code: 'PATTERN_BACKEND_MISMATCH', path: `composition.layers[${i}].pattern`, message: `${p} só existe no backend hyperframes`, backend: 'remotion', pattern: p })));
  if (backend !== 'remotion') throw new RenderError('BACKEND_UNAVAILABLE', `backend "${backend}" não disponível nesta versão (remotion | hyperframes)`);
  let tokensDoc = tokens;
  if (!tokensDoc) {
    if (typeof spec.tokens !== 'string') throw new RenderError('TOKENS_MISSING', 'spec.tokens (caminho relativo do tokens.json) é obrigatório');
    if (path.isAbsolute(spec.tokens) || spec.tokens.split(/[\\/]+/).includes('..')) throw new RenderError('TOKENS_PATH', `spec.tokens deve ser relativo e sem "..": ${spec.tokens}`);
    const tp = path.join(specDir, spec.tokens);
    if (!fs.existsSync(tp)) throw new RenderError('TOKENS_MISSING', `tokens não encontrado: ${spec.tokens}`);
    tokensDoc = JSON.parse(fs.readFileSync(tp, 'utf8'));
  }
  const terr = validate(TOKENS_SCHEMA, tokensDoc);
  if (terr.length) throw new RenderError('TOKENS_INVALID', 'tokens não passa no schema', terr);
  const { buildPlan, SpecError } = await loadSpecModule();
  try {
    return { plan: buildPlan(spec, tokensDoc), tokensDoc, backend };
  } catch (e) {
    if (e instanceof SpecError || e?.name === 'SpecError' || e?.name === 'TokenError') throw new RenderError('SPEC_UNSUPPORTED', 'composition fora do subset suportado', e.errors ?? [e.message]);
    throw e;
  }
}

export function deliveryProfileFor(spec, plan) {
  const req = spec.delivery?.profile ? getProfile(spec.delivery.profile) : null;
  if (plan.transparent) {
    if (req && !req.alpha) throw new RenderError('PROFILE_MISMATCH', `transparent=true exige perfil com alpha (pedido: ${req.id})`);
    return getProfile('ALPHA_4444_BT709');
  }
  return req ?? getProfile('OPAQUE_4444_BT709');
}

/**
 * @param {object} o
 * @param {string} o.specPath
 * @param {object} o.authorization   autorização estruturada cobrindo ["render","encode"]
 * @param {object} o.tools           {ffmpeg, ffprobe}
 * @param {object} o.logDirs
 * @param {string|null} o.remotionDir
 * @param {string} o.output          .mov novo
 * @param {string} o.assetsRoot      raiz permitida para assets (PROJECT_ROOT ou diretório do spec)
 * @param {string} o.workRoot        diretório temporário de trabalho (fora da Skill)
 */
export async function renderSpec({ specPath, authorization, tools, logDirs, remotionDir, output, assetsRoot = null, workRoot = os.tmpdir(),
  projectRoot = null, project = null, keepFrames = false, stills = true, concurrency = 1, detect = null, verifyDeterminism = false }) {
  workRoot = path.resolve(workRoot); output = path.resolve(output);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (verifyDeterminism && spec?.decision?.backend !== 'hyperframes') throw new RenderError('OPTION_UNSUPPORTED', '--verify-determinism só existe no backend hyperframes (Remotion V1 congelado)');
  if (spec?.decision?.backend === 'hyperframes') { // R6.1: roteamento por backend (o caminho Remotion abaixo fica intocado)
    const errs = validate(SPEC_SCHEMA, spec);
    if (errs.length) throw new RenderError('SPEC_INVALID', 'motion.spec não passa no schema', errs);
    const { renderHyperFramesSpec, HFRenderError } = await import('../../hyperframes/adapter/render.mjs');
    if (concurrency !== 1) throw new RenderError('OPTION_UNSUPPORTED', '--concurrency não se aplica ao backend hyperframes (render determinístico do próprio HyperFrames)');
    // R12.5C3b-B: det do HyperFrames GERENCIADO com portão a cada operação do Core (lint/página/render), sem alterar o Core
    const { detectHF } = await import('../../hyperframes/adapter/browser.mjs');
    const { guardedDet } = await import('../../setup/hf-guard.mjs');
    // R12.5C3b-C: servidores que o Core deixar abertos numa falha (ex.: launch) são fechados; o erro original é preservado
    const { withServerCleanup } = await import('./server-cleanup.mjs');
    try { return await withServerCleanup(() => renderHyperFramesSpec({ specPath, authorization, tools, logDirs, output, workRoot, projectRoot, project, stills, keepFrames, verifyDeterminism, detect: () => guardedDet(detectHF()) })); } catch (e) {
      if (e instanceof HFRenderError) throw new RenderError(e.code, e.message.replace(/^[A-Z_]+: /, ''), e.details);
      if (e.code === 'HF_MANAGED_INTEGRITY') throw new RenderError(e.code, e.message.replace(/^[A-Z_]+: /, ''), e.details);
      throw e;
    }
  }
  const specDir = path.dirname(path.resolve(specPath));
  const { plan, tokensDoc } = await preparePlan({ spec, specDir });
  const profile = deliveryProfileFor(spec, plan);

  // 4) doctor do backend
  const { detectRemotion } = await import('../../remotion/adapter/detect.mjs');
  const det = (detect ?? detectRemotion)(remotionDir);
  if (det.status !== 'AVAILABLE') throw new RenderError('BACKEND_UNAVAILABLE', `Remotion indisponível: ${det.reason}`, det);

  // assets (antes da autorização: falha barata, somente leitura)
  const { stageAssets, AssetError } = await import('../../remotion/adapter/assets.mjs');
  const root = assetsRoot ?? specDir;
  let publicDir; let staged;
  try { ({ publicDir, staged } = stageAssets(plan.assets, root, workRoot)); } catch (e) {
    if (e instanceof AssetError) throw new RenderError(e.code, e.message);
    throw e;
  }
  if (fs.existsSync(output)) throw new RenderError('OUTPUT_EXISTS', `saída já existe (nunca sobrescrevo): ${output}`);
  if (!fs.existsSync(path.dirname(path.resolve(output)))) throw new RenderError('OUTPUT_DIR', `diretório de saída não existe: ${path.dirname(output)}`);
  const work = fs.mkdtempSync(path.join(workRoot, `bold-render-${plan.id.replace(/[^\w.-]/g, '_')}-`));

  // 5) autorização: render (frames) E encode (delivery) — checadas antes de gerar qualquer coisa
  const cmd = `bold render ${path.basename(specPath)}`;
  try {
    authorizeOrThrow({ action: 'render', authorization, project, command: cmd, logDirs });
    if (!checkGate({ action: 'encode', authorization, project, command: cmd }).allowed) authorizeOrThrow({ action: 'encode', authorization, project, command: cmd, logDirs });
  } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw e; }

  try {
    // 6) frames
    const { getBundle, renderPlanFrames } = await import('../../remotion/adapter/render-frames.mjs');
    const { serveUrl } = await getBundle(det, { publicDir, workRoot });
    const framesDir = path.join(work, 'frames'); fs.mkdirSync(framesDir);
    const t0 = Date.now();
    const fr = await renderPlanFrames(det, { serveUrl, plan, framesDir, concurrency });
    const expected = plan.frames * plan.sub;
    if (fr.count !== expected) throw new RenderError('FRAME_MISMATCH', `Remotion gerou ${fr.count} frames; esperado ${expected}`);
    const renderMs = Date.now() - t0;

    const manifestExtra = {
      backend: 'remotion', backend_version: `${BACKEND_PKG.name}@${BACKEND_PKG.version}`, plan_version: plan.version,
      remotion_version: det.versions.remotion, react_version: det.versions.react, node_version: process.version,
      composition_id: fr.composition.id, spec_id: spec.id, spec_sha256: canonicalHash(spec), tokens_sha256: canonicalHash(tokensDoc),
      plan_sha256: canonicalHash(plan), seed: plan.seed, width: plan.width, height: plan.height, fps: plan.fps, frames: plan.frames,
      subframes: plan.sub, transparent: plan.transparent, gl: 'swangle', concurrency, assets: staged, frames_rendered: fr.count, render_ms: renderMs,
    };
    // 7) delivery (R4)
    const common = { input: fr.pattern, startNumber: fr.start, fps: plan.fps, expectedFrames: plan.frames, profileId: profile.id, output, authorization, tools, logDirs, projectRoot, project, command: cmd, manifestExtra };
    const delivered = plan.sub > 1
      ? blurSubframes({ ...common, subframes: plan.sub, shutter: plan.shutter, workRoot: work })
      : encodeSequence(common);

    // 8–9) probe + MACHINE QC (validador central)
    const qcArgs = { tools, file: output, profile, expectedFrames: plan.frames, fps: plan.fps, width: plan.width, height: plan.height };
    const qc = plan.transparent ? qcAlpha({ ...qcArgs, expectEmptyEnds: false }) : qcFile(qcArgs);
    // stills para VISUAL QC humano
    let stillsRes = null;
    if (stills) stillsRes = extractStills({ tools, file: output, outDir: path.join(path.dirname(output), `${path.basename(output, path.extname(output))}_stills`) });

    // 10) manifest final (delivery manifest + render + qc)
    const man = JSON.parse(fs.readFileSync(delivered.manifestPath, 'utf8'));
    man.qc = { machine_qc: qc.machine_qc.status, visual_qc: qc.visual_qc.status, stills: stillsRes ? path.basename(stillsRes.dir) : null };
    fs.writeFileSync(delivered.manifestPath, `${JSON.stringify(man, null, 2)}\n`);
    return {
      status: delivered.validation.status === 'FAIL' || qc.machine_qc.status === 'FAIL' ? 'FAIL' : delivered.validation.status === 'WARNING' || qc.machine_qc.status === 'WARNING' ? 'WARNING' : 'PASS',
      output, manifestPath: delivered.manifestPath, validation: delivered.validation, qc, stills: stillsRes, plan, profile: profile.id,
      framesDir: keepFrames ? framesDir : null, render: manifestExtra,
    };
  } finally {
    if (!keepFrames) fs.rmSync(work, { recursive: true, force: true });
  }
}
