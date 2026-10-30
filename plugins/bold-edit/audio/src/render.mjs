// RENDER DE ÁUDIO (R13) via ffmpeg: conform por cue → stem de SFX → mix (narração + música com ducking + SFX) → mux de prévia.
// Nunca sobrescreve (-n + checagem prévia), nunca altera os arquivos de origem (narração, música, kit) e nunca toca no
// Remotion/HyperFrames Core: o vídeo do BOLD continua sem áudio (-an); o áudio entra numa SAÍDA NOVA.
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from '../../core/delivery/tools.mjs';
import { AudioError } from './errors.mjs';
import { loudness, decodeMono, globalLag } from './measure.mjs';
import { SAMPLE_RATE } from './plan.mjs';

export const MIX_TARGET = Object.freeze({ integrated_lufs: -16, true_peak_dbtp: -1, voice_lufs: -16, music_lufs_with_voice: -24, music_lufs_alone: -18, duck_db: 8 });
const f6 = (x) => Number(x).toFixed(6);
const noClobber = (f) => { if (fs.existsSync(f)) throw new AudioError('OUTPUT_EXISTS', `já existe (nunca sobrescrevo): ${path.basename(f)}`); };
const fpsParts = (plan) => plan.fps.split('/').map(Number);
export const frameSamples = (plan, frame) => { const [n, d] = fpsParts(plan); return Math.round((frame * d * SAMPLE_RATE) / n); };

/** Um cue → WAV 48 kHz/24 bit estéreo: trim, rate (pitch acompanha, como o kit prevê), corte, fades, ganho e pad. */
export function conformCue(ffmpeg, kit, cue, outFile) {
  noClobber(outFile);
  const src = kit.file(kit.byId.get(cue.sound.id));
  const af = [];
  if (cue.trim_start > 0) af.push(`atrim=start=${f6(cue.trim_start)}`, 'asetpts=PTS-STARTPTS');
  af.push(cue.sound.channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo');
  if (cue.rate !== 1) af.push(`asetrate=${Math.round(SAMPLE_RATE * cue.rate)}`, `aresample=${SAMPLE_RATE}`);
  if (cue.cut_end !== null) af.push(`atrim=end=${f6(cue.cut_end)}`);
  if (cue.fades.in_ms) af.push(`afade=t=in:d=${f6(cue.fades.in_ms / 1000)}`);
  if (cue.fades.out_ms) af.push(`afade=t=out:st=${f6(Math.max(0, cue.duration_tl - cue.fades.out_ms / 1000))}:d=${f6(cue.fades.out_ms / 1000)}`);
  if (cue.gain_db) af.push(`volume=${cue.gain_db}dB`);
  if (cue.pad_samples) af.push(`adelay=delays=${cue.pad_samples}S:all=1`);
  runFfmpeg(ffmpeg, ['-n', '-i', src, '-af', af.join(','), '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s24le', outFile]);
  return outFile;
}

/** Conforma todos os cues numa pasta NOVA (ou vazia) e devolve as amostras (mono) para a verificação de sincronia. */
export function conformAll(ffmpeg, kit, plan, dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new AudioError('OUTPUT_EXISTS', `pasta não vazia (nunca sobrescrevo): ${path.basename(dir)}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = {}; const samples = {};
  for (const c of plan.cues) {
    const f = path.join(dir, `${c.id}-${c.sound.id}.wav`);
    conformCue(ffmpeg, kit, c, f);
    files[c.id] = f; samples[c.id] = decodeMono(ffmpeg, f);
  }
  return { files, samples };
}

/** Stem de SFX: cada cue conformado no seu frame (amostra exata), soma sem normalização, duração do plano. */
export function mixStem(ffmpeg, plan, files, outFile, { duration = plan.duration } = {}) {
  noClobber(outFile);
  if (!plan.cues.length) { runFfmpeg(ffmpeg, ['-n', '-f', 'lavfi', '-i', `anullsrc=r=${SAMPLE_RATE}:cl=stereo`, '-t', f6(duration), '-c:a', 'pcm_s24le', outFile]); return outFile; }
  const args = ['-n']; const fc = [];
  plan.cues.forEach((c, i) => { args.push('-i', files[c.id]); fc.push(`[${i}:a]adelay=delays=${frameSamples(plan, c.start_frame)}S:all=1[a${i}]`); });
  fc.push(`${plan.cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${plan.cues.length}:normalize=0:dropout_transition=0,apad=whole_dur=${f6(duration)},atrim=end=${f6(duration)}[out]`);
  args.push('-filter_complex', fc.join(';'), '-map', '[out]', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s24le', outFile);
  runFfmpeg(ffmpeg, args);
  return outFile;
}

/**
 * Mix final: narração (ganho linear até voice_lufs; nunca processada além disso), música (ganho até o alvo e ducking
 * por sidechain na narração), stem de SFX (ganhos do plano). Dois passes: mede → ajusta o ganho global para o alvo
 * integrado SEM passar do teto de true peak (o pico manda; o limitador é só rede de segurança) → mede de novo.
 */
export function mixFinal(ffmpeg, { stem, voice = null, music = null, duration, outFile, target = MIX_TARGET, workDir }) {
  noClobber(outFile);
  const inputs = [stem, voice, music].filter(Boolean);
  const gains = { voice_db: 0, music_db: 0 };
  if (voice) { const L = loudness(ffmpeg, voice); gains.voice_db = L.integrated_lufs === null ? 0 : round2(target.voice_lufs - L.integrated_lufs); gains.voice_in = L; }
  if (music) { const L = loudness(ffmpeg, music); const want = voice ? target.music_lufs_with_voice : target.music_lufs_alone; gains.music_db = L.integrated_lufs === null ? 0 : round2(want - L.integrated_lufs); gains.music_in = L; }
  const build = (globalDb, limiter) => {
    const fc = []; const mixIns = ['[s]']; let k = 0;
    fc.push(`[${k++}:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[s]`);
    let vk = null;
    if (voice) { const vi = k++; fc.push(`[${vi}:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,volume=${gains.voice_db}dB,asplit=2[v][vk]`); mixIns.push('[v]'); vk = '[vk]'; }
    if (music) {
      const mi = k++; fc.push(`[${mi}:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,volume=${gains.music_db}dB,afade=t=in:d=0.5,afade=t=out:st=${f6(Math.max(0, duration - 1.5))}:d=1.5[m]`);
      if (vk) { fc.push(`[m]${vk}sidechaincompress=threshold=0.015:ratio=${Math.min(20, 2 ** (target.duck_db / 3))}:attack=20:release=400:makeup=1[md]`); mixIns.push('[md]'); }
      else mixIns.push('[m]');
    } else if (vk) fc.push(`${vk}anullsink`);
    fc.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0:dropout_transition=0,apad=whole_dur=${f6(duration)},atrim=end=${f6(duration)},volume=${globalDb}dB${limiter ? `,alimiter=limit=${(10 ** ((target.true_peak_dbtp - 0.3) / 20)).toFixed(4)}:attack=1:release=60:level=false:latency=1` : ''}[out]`);
    return fc.join(';');
  };
  const run = (globalDb, limiter, file) => { runFfmpeg(ffmpeg, ['-n', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', build(globalDb, limiter), '-map', '[out]', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s24le', file]); return loudness(ffmpeg, file); };
  fs.mkdirSync(workDir, { recursive: true });
  const pre = run(0, false, path.join(workDir, 'mix-pass1.wav'));
  const byLoud = pre.integrated_lufs === null ? 0 : target.integrated_lufs - pre.integrated_lufs;
  const byPeak = pre.true_peak_dbtp === null ? 0 : target.true_peak_dbtp - 0.5 - pre.true_peak_dbtp;
  const g = round2(Math.min(byLoud, byPeak));
  const fin = run(g, true, outFile);
  // alinhamento: o stem de SFX tem de estar no mix sem atraso (filtros com lookahead, como o limitador, compensados)
  const align = globalLag(decodeMono(ffmpeg, stem), decodeMono(ffmpeg, outFile));
  return { alignment: { ...align, status: Math.abs(align.lag_samples) <= 1 ? 'PASS' : 'FAIL' }, output: outFile, gains: { ...gains, global_db: g, limited_by: byPeak < byLoud ? 'true_peak' : 'loudness' }, pass1: pre, final: fin, target,
    status: fin.true_peak_dbtp !== null && fin.true_peak_dbtp <= target.true_peak_dbtp && Math.abs(align.lag_samples) <= 1 ? 'PASS' : 'FAIL' };
}

/**
 * Prévia com áudio: vídeo + mix → arquivo NOVO. mov = vídeo copiado + PCM; mp4 = H.264 (copiado se já for H.264) + AAC.
 * O áudio do vídeo de entrada é IGNORADO (só -map 0:v): o mix do BOLD substitui, com o atraso do encoder AAC compensado
 * pelo ffmpeg (edit list). Ver R13: o AAC do render do Remotion 4.0.290 sai ~2048 amostras atrasado (sem edit list).
 */
export function muxPreview(ffmpeg, { video, audio, outFile, format = 'mov', videoCodec = null }) {
  noClobber(outFile);
  const enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const v = format === 'mp4' ? [...(videoCodec === 'h264' ? ['-c:v', 'copy'] : enc), '-movflags', '+faststart'] : ['-c:v', 'copy'];
  const a = format === 'mp4' ? ['-c:a', 'aac', '-b:a', '320k'] : ['-c:a', 'pcm_s24le'];
  runFfmpeg(ffmpeg, ['-n', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', ...v, ...a, '-shortest', outFile]);
  return outFile;
}
const round2 = (x) => Math.round(x * 100) / 100;
