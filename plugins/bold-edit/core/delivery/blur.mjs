// MOTION BLUR por sub-frames (genérico; não depende do Remotion).
// Entrada: N × SUB sub-frames RGBA (straight). Média temporal em espaço PREMULTIPLICADO:
//   STRAIGHT → premultiply → tmix(SUB, pesos do obturador) → unpremultiply → STRAIGHT
// Seleção do frame F por NOME (amostra F·SUB + SUB−1 = janela completa do frame F), nunca por decimação.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProfile } from './profiles.mjs';
import { runFfmpeg, ffmpegVersion } from './tools.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { authorizeOrThrow } from './authorize.mjs';
import { fpsNumber, assertNewOutput, checkInputSequence, encodeFramesUnchecked, verifyOutput } from './encode.mjs';
import { resolveSequence } from './sequence.mjs';

/**
 * Pesos simétricos do obturador: as k amostras centrais do frame (k ≈ shutter × SUB, mesma paridade de SUB).
 * Simetria garante que a ordem dos pesos no tmix é irrelevante.
 */
export function shutterWeights(sub, shutter = 1) {
  if (!Number.isInteger(sub) || sub < 1) throw new Error('subframes deve ser inteiro ≥ 1');
  if (!(shutter > 0 && shutter <= 1)) throw new Error('shutter deve estar em (0, 1]');
  let k = Math.max(1, Math.round(shutter * sub));
  if ((sub - k) % 2 !== 0) k = Math.min(sub, k + 1);
  const off = (sub - k) / 2;
  const weights = Array.from({ length: sub }, (_, i) => (i >= off && i < off + k ? 1 : 0));
  return { weights, samples: k, effective_shutter: k / sub };
}

export function blurFilter(sub, weights, { premultiplied = true } = {}) {
  const w = weights.join(' ');
  return premultiplied
    ? `format=rgba64le,premultiply=inplace=1,tmix=frames=${sub}:weights='${w}',unpremultiply=inplace=1,format=rgba64be`
    : `format=rgba64le,tmix=frames=${sub}:weights='${w}',format=rgba64be`; // SÓ para fixture de regressão (gera halo)
}

/**
 * @param {object} o  ver encodeSequence; + subframes, shutter, workRoot, keepTemp
 */
export function blurSubframes({ input, startNumber = null, fps, subframes, shutter = 1, expectedFrames, profileId, output, authorization, tools, logDirs,
  projectRoot = null, project = null, workRoot = null, keepTemp = false, command = null, manifestExtra = null }) {
  const profile = getProfile(profileId);
  const outFps = fpsNumber(fps);
  if (!Number.isInteger(expectedFrames) || expectedFrames < 1) throw new Error('expectedFrames deve ser inteiro ≥ 1');
  const { weights, samples, effective_shutter } = shutterWeights(subframes, shutter);
  assertNewOutput(output);
  const seq = checkInputSequence(input, startNumber, expectedFrames * subframes);
  const auth = authorizeOrThrow({ action: 'encode', authorization, project, command: command || `bold delivery blur ${profile.id} x${subframes}`, logDirs });

  const work = fs.mkdtempSync(path.join(workRoot || os.tmpdir(), 'bold-blur-'));
  try {
    const avgPattern = path.join(work, 'avg_%06d.png');
    runFfmpeg(tools.ffmpeg, ['-framerate', String(outFps * subframes), '-start_number', String(seq.start), '-i', input,
      '-frames:v', String(expectedFrames * subframes), '-vf', blurFilter(subframes, weights), '-fps_mode', 'passthrough', '-start_number', '0', avgPattern]);
    const avg = resolveSequence(avgPattern, 0);
    if (avg.count !== expectedFrames * subframes) throw new Error(`média gerou ${avg.count} frames; esperado ${expectedFrames * subframes}`);

    const sel = path.join(work, 'sel');
    fs.mkdirSync(sel);
    for (let f = 0; f < expectedFrames; f++) {
      const src = path.join(work, `avg_${String(f * subframes + subframes - 1).padStart(6, '0')}.png`);
      const dst = path.join(sel, `sel_${String(f).padStart(6, '0')}.png`);
      try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
    }
    const selPattern = path.join(sel, 'sel_%06d.png');
    checkInputSequence(selPattern, 0, expectedFrames);
    encodeFramesUnchecked({ tools, input: selPattern, start: 0, fps, frames: expectedFrames, profile, output });

    const { meta, validation } = verifyOutput({ tools, output, profile, fps, expectedFrames });
    const manifest = buildManifest({
      kind: 'motion_blur', source: input, output, profile, fps: outFps, expectedFrames, meta, validation,
      ffmpegVersion: ffmpegVersion(tools.ffmpeg), authorization: auth, projectRoot,
      conversion: {
        input_kind: 'subframe_sequence', input_subframes: seq.count, subframes, shutter_requested: shutter,
        shutter_effective: effective_shutter, samples_averaged: samples, weights,
        method: 'premultiply → tmix → unpremultiply (rgba64) → select F·SUB+SUB−1 by filename → BT.709 encode',
      },
    });
    if (manifestExtra) manifest.render = manifestExtra;
    const manifestPath = writeManifest(output, manifest);
    return { output, manifestPath, manifest, meta, validation, workDir: keepTemp ? work : null };
  } finally {
    if (!keepTemp) fs.rmSync(work, { recursive: true, force: true }); // diretório temporário criado por esta função
  }
}
