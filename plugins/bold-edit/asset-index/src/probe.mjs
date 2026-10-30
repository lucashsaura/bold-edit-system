// ffprobe (R8) — UMA chamada por arquivo, somente leitura. Normaliza vídeo/áudio/imagem: fps EXATO (fração),
// rotação (orientação de exibição), alpha pelo pix_fmt, áudio (sample rate/canais), datas e timecode da origem.
import { execFileSync, execFile } from 'node:child_process';
import { parseRate, pixFmtHasAlpha } from '../../core/delivery/ffprobe.mjs';
import { orientation } from './classify.mjs';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function exactRate(r) {
  if (!r || r === '0/0') return null;
  const [n, d] = String(r).split('/').map(Number); if (!(n > 0 && d > 0)) return null;
  const g = gcd(n, d); return `${n / g}/${d / g}`;
}
const num = (v) => (v == null || v === 'N/A' || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function rotationOf(v) {
  const sd = (v.side_data_list || []).find((s) => s.rotation !== undefined);
  const r = sd ? Number(sd.rotation) : v.tags?.rotate !== undefined ? Number(v.tags.rotate) : 0;
  return ((Math.round(r) % 360) + 360) % 360;
}

export function ffprobeJson(ffprobe, file) {
  const raw = execFileSync(ffprobe, [...ARGS, file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60000 });
  return JSON.parse(raw);
}

const ARGS = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json'];
const failed = (e) => ({ status: 'FAILED', error: String(e?.stderr || e?.message || e).trim().split('\n').pop().slice(0, 200) });

/** → {status:'OK', media:{...}} | {status:'FAILED', error} */
export function probeMedia(ffprobe, file) {
  try { return parseProbe(ffprobeJson(ffprobe, file)); } catch (e) { return failed(e); }
}

/** Mesma coisa, assíncrona (o scan roda N probes em paralelo). */
export function probeMediaAsync(ffprobe, file) {
  return new Promise((resolve) => {
    execFile(ffprobe, [...ARGS, file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) return resolve(failed({ stderr, message: err.message }));
      try { resolve(parseProbe(JSON.parse(stdout))); } catch (e) { resolve(failed(e)); }
    });
  });
}

export function parseProbe(j) {
  const streams = j.streams || [];
  const isStill = (s) => ['png', 'mjpeg', 'tiff', 'bmp', 'webp', 'exr', 'gif', 'psd', 'dpx', 'targa', 'jpeg2000', 'hevc_image', 'av1_image'].includes(s.codec_name) && (Number(s.nb_frames) <= 1 || !s.nb_frames);
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1) || null;
  const aud = streams.filter((s) => s.codec_type === 'audio');
  const tags = { ...(j.format?.tags || {}) };
  const video = v ? (() => {
    const rot = rotationOf(v); const swap = rot === 90 || rot === 270;
    const dw = swap ? v.height : v.width; const dh = swap ? v.width : v.height;
    const fps = exactRate(v.r_frame_rate); const avg = exactRate(v.avg_frame_rate);
    const pf = parseRate(v.r_frame_rate); const pa = parseRate(v.avg_frame_rate);
    return { codec: v.codec_name ?? null, profile: v.profile ?? null, pix_fmt: v.pix_fmt ?? null, width: v.width ?? null, height: v.height ?? null, rotation: rot,
      display_width: dw ?? null, display_height: dh ?? null, orientation: orientation(dw, dh),
      fps: isStill(v) ? null : fps, fps_float: isStill(v) || pf == null ? null : Math.round(pf * 1000) / 1000, avg_fps: isStill(v) ? null : avg,
      vfr_suspected: !isStill(v) && pf != null && pa != null && Math.abs(pf - pa) > 0.01, field_order: v.field_order ?? null,
      alpha: v.pix_fmt ? pixFmtHasAlpha(v.pix_fmt) : null, alpha_source: v.pix_fmt ? 'pix_fmt' : null,
      bit_depth: num(v.bits_per_raw_sample), frames_header: num(v.nb_frames), still: isStill(v),
      color: { primaries: v.color_primaries ?? null, transfer: v.color_transfer ?? null, space: v.color_space ?? null, range: v.color_range ?? null },
      timecode: v.tags?.timecode ?? null };
  })() : null;
  for (const s of streams) if (s.codec_type === 'data' && s.tags?.timecode && video && !video.timecode) video.timecode = s.tags.timecode;
  return { status: 'OK', media: {
    container: j.format?.format_name ?? null, duration: num(j.format?.duration) ?? num(v?.duration), bit_rate: num(j.format?.bit_rate),
    video, audio: aud.map((a) => ({ codec: a.codec_name ?? null, sample_rate: num(a.sample_rate), channels: num(a.channels), channel_layout: a.channel_layout ?? null, sample_fmt: a.sample_fmt ?? null, bit_depth: num(a.bits_per_raw_sample) || num(a.bits_per_sample) || null })),
    creation_time: tags.creation_time ?? tags['com.apple.quicktime.creationdate'] ?? null, timecode: tags.timecode ?? video?.timecode ?? null } };
}
