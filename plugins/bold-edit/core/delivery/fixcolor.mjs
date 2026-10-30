// FIX-COLOR: corrige matriz/tags de um arquivo YUV legado SEM re-render, gerando um ARQUIVO NOVO.
// Nunca sobrescreve a entrada. Nunca assume BT.601 sem evidência: origem ambígua → STOP.
//
// Evidência aceita (uma basta):
//   1. tag de matriz no próprio arquivo (bt470bg/smpte170m → bt601; bt709 → bt709, só faltam tags);
//   2. pixel de referência: cor conhecida (#RRGGBB) num ponto/frame; o arquivo é decodificado com 601 e 709
//      e a matriz que reproduz a cor (com margem clara sobre a outra) é a matriz real;
//   3. declaração explícita do usuário (--source-matrix + --evidence "<texto>"), registrada como suposição.

import { probeFile, countFrames } from './ffprobe.mjs';
import { getProfile, colorFilter, codecArgs } from './profiles.mjs';
import { runFfmpeg, ffmpegVersion } from './tools.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { authorizeOrThrow } from './authorize.mjs';
import { assertNewOutput, verifyOutput } from './encode.mjs';
import { validateMedia } from './validate.mjs';
import { execFileSync } from 'node:child_process';

export class StopError extends Error {
  constructor(reason, details) { super(`PARE: ${reason}`); this.code = 'STOP'; this.details = details; }
}

const TAG_TO_MATRIX = { bt470bg: 'bt601', smpte170m: 'bt601', bt709: 'bt709' };
export const PIXEL_TOLERANCE = 6;
export const PIXEL_MARGIN = 6;

export function parseHex(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) throw new Error(`cor inválida: ${hex} (use #RRGGBB)`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Decodifica 1 pixel com a matriz/range informados → [r,g,b] 8 bit. */
export function decodePixel(ffmpeg, file, { x, y, frame = 0, matrix, range }) {
  const buf = execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file,
    '-vf', `select='eq(n\\,${frame})',scale=in_color_matrix=${matrix}:in_range=${range}:flags=accurate_rnd+full_chroma_int,format=rgb24,crop=1:1:${x}:${y}`,
    '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  if (buf.length < 3) throw new Error('não foi possível decodificar o pixel de referência');
  return [buf[0], buf[1], buf[2]];
}

/**
 * Decide a matriz de origem. Lança StopError quando ambíguo.
 * @returns {{action: 'convert'|'nothing_to_do', source_matrix: string, source_range: string, evidence: object, assumptions: string[]}}
 */
export function analyzeSourceColor({ tools, meta, input, evidencePixel = null, sourceMatrix = null, evidenceText = null }) {
  const v = meta.video;
  if (!v) throw new StopError('arquivo sem vídeo');
  if (/^(rgb|bgr|gbr|argb|abgr)/.test(v.pix_fmt || '')) {
    throw new StopError(`origem RGB (${v.pix_fmt}): não há matriz YUV a corrigir — use bold delivery encode`);
  }
  const assumptions = [];
  let range = v.color_range;
  if (range !== 'tv' && range !== 'pc') {
    if (v.codec === 'prores') { range = 'tv'; assumptions.push('range ausente: ProRes YUV é limited (tv) por especificação do codec'); }
    else throw new StopError(`color_range ausente (${v.color_range}) e codec ${v.codec} não define o range`);
  }
  const allTagged = v.color_primaries === 'bt709' && v.color_transfer === 'bt709' && v.color_space === 'bt709' && v.color_range === 'tv';
  if (allTagged) return { action: 'nothing_to_do', source_matrix: 'bt709', source_range: 'tv', evidence: { type: 'tags', note: 'já BT.709 explícito' }, assumptions };

  // 1) tag de matriz presente
  const fromTag = TAG_TO_MATRIX[v.color_space];
  let tagEvidence = fromTag ? { type: 'matrix_tag', color_space: v.color_space, matrix: fromTag } : null;

  // 2) pixel de referência
  let pixelEvidence = null;
  if (evidencePixel) {
    const expected = parseHex(evidencePixel.hex);
    const d601 = decodePixel(tools.ffmpeg, input, { ...evidencePixel, matrix: 'bt601', range });
    const d709 = decodePixel(tools.ffmpeg, input, { ...evidencePixel, matrix: 'bt709', range });
    const e601 = dist(d601, expected); const e709 = dist(d709, expected);
    let matrix = null;
    if (e601 <= PIXEL_TOLERANCE && e709 - e601 >= PIXEL_MARGIN) matrix = 'bt601';
    else if (e709 <= PIXEL_TOLERANCE && e601 - e709 >= PIXEL_MARGIN) matrix = 'bt709';
    pixelEvidence = { type: 'reference_pixel', ...evidencePixel, expected, decoded_bt601: d601, decoded_bt709: d709,
      error_bt601: Number(e601.toFixed(2)), error_bt709: Number(e709.toFixed(2)), tolerance: PIXEL_TOLERANCE, margin: PIXEL_MARGIN, matrix };
    if (!matrix) throw new StopError('pixel de referência não distingue 601 de 709 (erro fora da tolerância ou margem insuficiente)', pixelEvidence);
  }

  // 3) declaração explícita
  let declared = null;
  if (sourceMatrix) {
    if (!['bt601', 'bt709'].includes(sourceMatrix)) throw new Error('--source-matrix deve ser bt601 ou bt709');
    if (!evidenceText || !String(evidenceText).trim()) throw new StopError('--source-matrix exige --evidence "<descrição da evidência>"');
    declared = { type: 'declared', matrix: sourceMatrix, evidence: String(evidenceText).trim() };
    assumptions.push(`matriz de origem declarada pelo usuário: ${sourceMatrix} — ${declared.evidence}`);
  }

  const votes = [tagEvidence, pixelEvidence, declared].filter(Boolean);
  if (!votes.length) throw new StopError(`matriz de origem ambígua (color_space=${v.color_space}); forneça --evidence-pixel x,y,#RRGGBB[,frame] ou --source-matrix + --evidence`);
  const matrices = new Set(votes.map((e) => e.matrix));
  if (matrices.size > 1) throw new StopError('evidências conflitantes sobre a matriz de origem', votes);
  return { action: 'convert', source_matrix: [...matrices][0], source_range: range, evidence: votes.length === 1 ? votes[0] : { type: 'multiple', items: votes }, assumptions };
}

function autoProfile(v) {
  if (v.alpha_capable) return getProfile('ALPHA_4444_BT709');
  if (/^yuv444/.test(v.pix_fmt || '')) return getProfile('OPAQUE_4444_BT709');
  return getProfile('OPAQUE_HQ_BT709');
}

function alphaDigest(ffmpeg, file) {
  return execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vf', 'alphaextract', '-f', 'framemd5', '-'],
    { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
}

/**
 * @returns {{status: 'CONVERTED'|'NOTHING_TO_DO', output?: string, manifestPath?: string, analysis: object, validation?: object}}
 */
export function fixColor({ input, output, profileId = null, evidencePixel = null, sourceMatrix = null, evidenceText = null, authorization, tools, logDirs,
  projectRoot = null, project = null, command = null }) {
  const meta = probeFile(tools.ffprobe, input);
  meta.nb_frames_counted = countFrames(tools.ffprobe, input);
  const analysis = analyzeSourceColor({ tools, meta, input, evidencePixel, sourceMatrix, evidenceText });
  if (analysis.action === 'nothing_to_do') return { status: 'NOTHING_TO_DO', analysis, detected: meta };

  assertNewOutput(output, [input]);
  const profile = profileId ? getProfile(profileId) : autoProfile(meta.video);
  if (profile.alpha && !meta.video.alpha_capable) throw new StopError(`perfil ${profile.id} exige alpha e a entrada não tem`);
  const auth = authorizeOrThrow({ action: 'encode', authorization, project, command: command || `bold delivery fix-color → ${profile.id}`, logDirs });

  const fps = meta.video.r_frame_rate;
  runFfmpeg(tools.ffmpeg, ['-i', input, '-map', '0:v:0',
    '-vf', colorFilter(profile, { source: 'yuv', inMatrix: analysis.source_matrix, inRange: analysis.source_range }),
    ...codecArgs(profile), '-fps_mode', 'passthrough', output]);

  const { meta: outMeta, validation } = verifyOutput({ tools, output, profile, fps, expectedFrames: meta.nb_frames_counted });
  if (profile.alpha && meta.video.alpha_capable) {
    const same = JSON.stringify(alphaDigest(tools.ffmpeg, input)) === JSON.stringify(alphaDigest(tools.ffmpeg, output));
    validation.checks.push({ id: 'alpha.preserved', status: same ? 'PASS' : 'FAIL', expected: 'idêntico', actual: same ? 'idêntico' : 'divergente', message: 'canal alpha (framemd5) entrada × saída' });
    const s = { PASS: 0, WARNING: 0, FAIL: 0 }; validation.checks.forEach((c) => { s[c.status] += 1; });
    validation.summary = s; validation.status = s.FAIL ? 'FAIL' : s.WARNING ? 'WARNING' : 'PASS';
  }
  const before = validateMedia(meta, { profile });
  const manifest = buildManifest({
    kind: 'fix_color', source: input, output, profile, fps: outMeta.video.fps, expectedFrames: meta.nb_frames_counted, meta: outMeta, validation,
    ffmpegVersion: ffmpegVersion(tools.ffmpeg), authorization: auth, projectRoot,
    conversion: {
      detected_input: { codec: meta.video.codec, profile: meta.video.profile, pix_fmt: meta.video.pix_fmt, color_primaries: meta.video.color_primaries,
        color_transfer: meta.video.color_transfer, color_space: meta.video.color_space, color_range: meta.video.color_range, frames: meta.nb_frames_counted },
      input_validation_status: before.status,
      source_matrix: analysis.source_matrix, source_range: analysis.source_range, evidence: analysis.evidence, assumptions: analysis.assumptions,
      method: `decode ${analysis.source_matrix}/${analysis.source_range} → RGB 16 bit → encode ${profile.color.space}/${profile.color.range} + tags`,
    },
  });
  const manifestPath = writeManifest(output, manifest);
  return { status: 'CONVERTED', output, manifestPath, manifest, analysis, validation };
}
