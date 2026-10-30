// Decodifica frames amostrados para RGBA 8 bit (para análise de máquina). Somente leitura do arquivo.

import { execFileSync } from 'node:child_process';

export function sampleIndices(total, samples = 5) {
  if (!total || total < 1) return [];
  if (total <= samples) return Array.from({ length: total }, (_, i) => i);
  const set = new Set();
  for (let i = 0; i < samples; i++) set.add(Math.round((i * (total - 1)) / (samples - 1)));
  return [...set].sort((a, b) => a - b);
}

/**
 * @returns {Buffer[]} um buffer RGBA (w·h·4) por índice, na ordem dos índices
 */
export function decodeFramesRGBA({ ffmpeg, file, indices, width, height, matrix = 'bt709', range = 'tv' }) {
  if (!indices.length) return [];
  const expr = indices.map((i) => `eq(n\\,${i})`).join('+');
  const m = ['bt709', 'bt601', 'bt470bg', 'smpte170m'].includes(matrix) ? (matrix === 'bt470bg' || matrix === 'smpte170m' ? 'bt601' : matrix) : 'bt709';
  const r = range === 'pc' ? 'pc' : 'tv';
  const out = execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file,
    '-vf', `select='${expr}',scale=in_color_matrix=${m}:in_range=${r}:flags=accurate_rnd+full_chroma_int,format=rgba`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const size = width * height * 4;
  const frames = [];
  for (let off = 0; off + size <= out.length; off += size) frames.push(out.subarray(off, off + size));
  return frames;
}
