// Leitura de metadados (ffprobe) normalizada e contagem REAL de frames.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ALPHA_PIX = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya\d|ya8|ya16|pal8|rgba64|bgra64)/;

export function parseRate(r) {
  if (!r || r === '0/0') return null;
  const [n, d] = String(r).split('/').map(Number);
  if (!d) return Number.isFinite(n) ? n : null;
  return n / d;
}

export function pixFmtHasAlpha(pf) { return !!pf && ALPHA_PIX.test(pf); }

/**
 * @returns {object} metadados normalizados (ou lança se o arquivo não existe / ffprobe falha)
 */
export function probeFile(ffprobe, file) {
  if (!fs.existsSync(file)) { const e = new Error(`arquivo não existe: ${file}`); e.code = 'ENOENT'; throw e; }
  let raw;
  try {
    raw = execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    const err = new Error(`ffprobe falhou: ${String(e.stderr || e.message).trim().split('\n').pop()}`); err.code = 'PROBE_FAILED'; throw err;
  }
  const j = JSON.parse(raw);
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video') || null;
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const other = streams.filter((s) => s !== v && s.codec_type !== 'audio');
  const fps = v ? parseRate(v.r_frame_rate) : null;
  return {
    file,
    container: j.format?.format_name ?? null,
    duration: j.format?.duration != null ? Number(j.format.duration) : (v?.duration != null ? Number(v.duration) : null),
    size_bytes: j.format?.size != null ? Number(j.format.size) : fs.statSync(file).size,
    video: v ? {
      codec: v.codec_name ?? null,
      profile: v.profile ?? null,
      codec_tag: v.codec_tag_string ?? null,
      pix_fmt: v.pix_fmt ?? null,
      width: v.width ?? null,
      height: v.height ?? null,
      fps,
      r_frame_rate: v.r_frame_rate ?? null,
      avg_frame_rate: v.avg_frame_rate ?? null,
      nb_frames_header: v.nb_frames != null ? Number(v.nb_frames) : null,
      color_primaries: v.color_primaries ?? 'unknown',
      color_transfer: v.color_transfer ?? 'unknown',
      color_space: v.color_space ?? 'unknown',
      color_range: v.color_range ?? 'unknown',
      alpha_capable: pixFmtHasAlpha(v.pix_fmt),
    } : null,
    audio_streams: audio.length,
    other_streams: other.map((s) => s.codec_type + (s.codec_tag_string ? `:${s.codec_tag_string}` : '')),
    nb_frames_counted: null,
  };
}

/** Conta frames decodificando (não confia em duration × fps nem no cabeçalho). */
export function countFrames(ffprobe, file) {
  try {
    const out = execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const n = Number(String(out).trim().split(/\s|,/)[0]);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
