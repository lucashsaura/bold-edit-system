// Resolução de ffmpeg/ffprobe a partir da config (tools.FFMPEG_PATH / FFPROBE_PATH; "auto" = PATH).

import { execFileSync } from 'node:child_process';
import { createProbe } from '../doctor/probe.mjs';

export function resolveTools(config = {}, { env = process.env, platform = process.platform } = {}) {
  const probe = createProbe({ env, platform });
  const pick = (configured, cmd) => {
    if (configured && configured !== 'auto') return probe.which(configured) || (probe.isFile(configured) ? configured : null);
    return probe.which(cmd);
  };
  const ffmpeg = pick(config.tools?.FFMPEG_PATH, 'ffmpeg');
  const ffprobe = pick(config.tools?.FFPROBE_PATH, 'ffprobe');
  if (!ffmpeg) throw new Error('ffmpeg não encontrado (tools.FFMPEG_PATH ou PATH)');
  if (!ffprobe) throw new Error('ffprobe não encontrado (tools.FFPROBE_PATH ou PATH)');
  return { ffmpeg, ffprobe };
}

export function ffmpegVersion(ffmpeg) {
  try {
    const out = execFileSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return (out.split('\n')[0] || '').replace(/\s+Copyright.*$/, '').trim();
  } catch { return null; }
}

/** Executa ffmpeg com -v error; lança com stderr em caso de falha. */
export function runFfmpeg(ffmpeg, args, { maxBuffer = 64 * 1024 * 1024, encoding = 'utf8', input } = {}) {
  try {
    return execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', ...args], {
      encoding, maxBuffer, input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch (e) {
    throw new Error(`ffmpeg falhou: ${String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
}
