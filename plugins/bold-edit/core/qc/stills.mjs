// `bold qc stills` — stills para VISUAL QC humano (first, 25%, 50%, 75%, last) + contact sheet opcional.
// Stills são permitidos sem autorização de render (render-policy.md: STILLS_PREVIEW).
// Não há julgamento estético automático: a saída existe para revisão humana.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { probeFile, countFrames } from '../delivery/ffprobe.mjs';

export const DEFAULT_POSITIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
const LABELS = { 0: 'first', 0.25: 'p25', 0.5: 'p50', 0.75: 'p75', 1: 'last' };

function ff(ffmpeg, args) {
  return execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
}

/**
 * @returns {{file: string, frames_total: number, stills: {position: number, frame: number, file: string}[], contact_sheet: string|null, note: string}}
 */
export function extractStills({ tools, file, outDir, positions = DEFAULT_POSITIONS, contactSheet = true, thumbWidth = 384 }) {
  const meta = probeFile(tools.ffprobe, file);
  const total = countFrames(tools.ffprobe, file);
  if (!total) throw new Error('não foi possível contar frames');
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error(`diretório de stills já existe e não está vazio (não sobrescrevo): ${outDir}`);
  fs.mkdirSync(outDir, { recursive: true });
  const alpha = !!meta.video?.alpha_capable;
  const matrix = meta.video?.color_space === 'unknown' ? 'bt709' : meta.video.color_space;
  const range = meta.video?.color_range === 'pc' ? 'pc' : 'tv';
  const stills = [];
  for (const pos of positions) {
    const frame = Math.min(total - 1, Math.max(0, Math.round(pos * (total - 1))));
    const name = `${LABELS[pos] ?? `p${Math.round(pos * 100)}`}_f${String(frame).padStart(5, '0')}.png`;
    const out = path.join(outDir, name);
    ff(tools.ffmpeg, ['-i', file, '-vf', `select='eq(n\\,${frame})',scale=in_color_matrix=${matrix}:in_range=${range}:flags=accurate_rnd+full_chroma_int,format=${alpha ? 'rgba' : 'rgb24'}`,
      '-fps_mode', 'passthrough', '-frames:v', '1', out]);
    stills.push({ position: pos, frame, file: name });
  }
  let sheet = null;
  if (contactSheet) {
    sheet = 'contact_sheet.png';
    const inputs = stills.flatMap((s) => ['-i', path.join(outDir, s.file)]);
    const tw = thumbWidth; const th = Math.round((tw * meta.video.height) / meta.video.width / 2) * 2;
    // alpha → composto sobre xadrez cinza (revela halo/franja); opaco → direto
    const parts = stills.map((_, i) => `[${i}:v]scale=${tw}:${th},format=rgba[s${i}]`);
    const checker = (i) => `color=c=0x9a9a9a:s=${tw}x${th}:d=1,format=rgba,geq=r='if(mod(floor(X/12)+floor(Y/12),2),154,104)':g='if(mod(floor(X/12)+floor(Y/12),2),154,104)':b='if(mod(floor(X/12)+floor(Y/12),2),154,104)':a=255[c${i}]`;
    const comps = stills.map((_, i) => (alpha ? `${checker(i)};[c${i}][s${i}]overlay=format=auto[o${i}]` : `[s${i}]null[o${i}]`));
    const stack = `${stills.map((_, i) => `[o${i}]`).join('')}hstack=inputs=${stills.length}[row];[row]pad=iw+16:ih+16:8:8:color=0x202020[out]`;
    ff(tools.ffmpeg, [...inputs, '-filter_complex', [...parts, ...comps, stack].join(';'), '-map', '[out]', '-frames:v', '1', path.join(outDir, sheet)]);
  }
  const report = {
    schema: 'bold.qc.stills/1', file: path.basename(file), frames_total: total, alpha, stills, contact_sheet: sheet,
    note: 'Stills para VISUAL QC humano. Nenhum julgamento estético automático. Alpha: contact sheet composto sobre xadrez.',
  };
  fs.writeFileSync(path.join(outDir, 'stills.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, dir: outDir };
}
