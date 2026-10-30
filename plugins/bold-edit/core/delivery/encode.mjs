// ENCODE CONTROLADO: sequência de imagens RGB(A) → ffmpeg (matriz + tags do perfil) → ffprobe → validação → manifest.
// Passa obrigatoriamente pelo policy gate (ação "encode").

import fs from 'node:fs';
import path from 'node:path';
import { getProfile, colorFilter, codecArgs } from './profiles.mjs';
import { resolveSequence } from './sequence.mjs';
import { probeFile, countFrames, parseRate } from './ffprobe.mjs';
import { validateMedia } from './validate.mjs';
import { runFfmpeg, ffmpegVersion } from './tools.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { authorizeOrThrow } from './authorize.mjs';

export function fpsNumber(fps) {
  const n = typeof fps === 'number' ? fps : parseRate(String(fps));
  if (!Number.isFinite(n) || n <= 0 || n > 240) throw new Error(`fps inválido: ${fps}`);
  return n;
}

export function assertNewOutput(output, inputs = []) {
  if (!output) throw new Error('saída obrigatória');
  const abs = path.resolve(output);
  for (const i of inputs) if (i && path.resolve(i) === abs) throw new Error('saída não pode ser igual à entrada');
  if (fs.existsSync(abs)) throw new Error(`saída já existe (o BOLD nunca sobrescreve): ${output}`);
  if (!fs.existsSync(path.dirname(abs))) throw new Error(`diretório de saída não existe: ${path.dirname(abs)}`);
}

/** Valida a sequência de entrada contra o esperado (somente leitura). */
export function checkInputSequence(input, startNumber, expectedCount) {
  const seq = resolveSequence(input, startNumber);
  if (seq.count !== expectedCount) {
    throw new Error(`sequência de entrada com ${seq.count} frame(s) contíguo(s) a partir de ${seq.start}; esperado ${expectedCount}${seq.missing.length ? ` (faltando: ${seq.missing.join(', ')})` : ''}`);
  }
  return seq;
}

/** Encode sem gate (uso interno, depois de autorizado). */
export function encodeFramesUnchecked({ tools, input, start, fps, frames, profile, output }) {
  runFfmpeg(tools.ffmpeg, [
    '-framerate', String(fps), '-start_number', String(start), '-i', input, '-frames:v', String(frames),
    '-vf', colorFilter(profile), ...codecArgs(profile), '-r', String(fps), output,
  ]);
}

/** Probe + contagem real + validação central. */
export function verifyOutput({ tools, output, profile, fps, expectedFrames }) {
  const meta = probeFile(tools.ffprobe, output);
  meta.nb_frames_counted = countFrames(tools.ffprobe, output);
  const validation = validateMedia(meta, { profile, expectedFrames, fps: fpsNumber(fps) });
  return { meta, validation };
}

/**
 * @param {object} o
 * @param {string} o.input            padrão da sequência (ex.: dir/frame_%06d.png)
 * @param {number} [o.startNumber]
 * @param {number|string} o.fps
 * @param {number} o.expectedFrames
 * @param {string} o.profileId
 * @param {string} o.output           arquivo novo (.mov)
 * @param {object} o.authorization    autorização estruturada (policy gate)
 * @param {object} o.tools            {ffmpeg, ffprobe}
 * @param {object} o.logDirs          {projectRoot|cacheDir}
 */
export function encodeSequence({ input, startNumber = null, fps, expectedFrames, profileId, output, authorization, tools, logDirs, projectRoot = null, project = null, command = null, manifestExtra = null }) {
  const profile = getProfile(profileId);
  fpsNumber(fps);
  if (!Number.isInteger(expectedFrames) || expectedFrames < 1) throw new Error('expectedFrames deve ser inteiro ≥ 1');
  assertNewOutput(output);
  const seq = checkInputSequence(input, startNumber, expectedFrames);
  const auth = authorizeOrThrow({ action: 'encode', authorization, project, command: command || `bold delivery encode ${profile.id}`, logDirs });

  encodeFramesUnchecked({ tools, input, start: seq.start, fps, frames: expectedFrames, profile, output });
  const { meta, validation } = verifyOutput({ tools, output, profile, fps, expectedFrames });
  const manifest = buildManifest({
    kind: 'encode', source: input, output, profile, fps: fpsNumber(fps), expectedFrames, meta, validation,
    ffmpegVersion: ffmpegVersion(tools.ffmpeg), authorization: auth, projectRoot,
    conversion: { input_kind: 'image_sequence', input_frames: seq.count, matrix: `RGB full → ${profile.color.space} ${profile.color.range}` },
  });
  if (manifestExtra) manifest.render = manifestExtra;
  const manifestPath = writeManifest(output, manifest);
  return { output, manifestPath, manifest, meta, validation };
}
