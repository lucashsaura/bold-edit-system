// MEDIÇÃO (R13): loudness EBU R128 (integrado, LRA, true peak) via filtro ebur128 do ffmpeg — sem dependências —
// e verificação de SINCRONIA no sinal: o onset de cada cue (kit: timing.onset = primeiro ponto a 20 dB do pico) é
// procurado no áudio decodificado e comparado com o previsto pelo plano.
import { spawnSync } from 'node:child_process';
import { AudioError } from './errors.mjs';

export function loudness(ffmpeg, file) {
  const p = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (p.status !== 0) throw new AudioError('MEASURE_FAILED', String(p.stderr).trim().split('\n').slice(-2).join(' | '));
  const s = String(p.stderr); const sum = s.slice(s.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(sum); return m ? Number(m[1]) : null; };
  return { integrated_lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/), lra_lu: num(/LRA:\s+(-?[\d.]+) LU/), true_peak_dbtp: num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

/** Trechos com fala numa narração (inverso do silencedetect). Usado para o ducking dos SFX (under_voiceover_db). */
export function speechFromVoice(ffmpeg, file, { noiseDb = -35, minSilenceS = 0.3 } = {}) {
  const p = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilenceS}`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (p.status !== 0) throw new AudioError('MEASURE_FAILED', String(p.stderr).trim().split('\n').slice(-2).join(' | '));
  const s = String(p.stderr); const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(s)?.slice(1).reduce((a, x, i) => a + Number(x) * [3600, 60, 1][i], 0) ?? 0);
  const sil = []; let open = null;
  for (const m of s.matchAll(/silence_(start|end): (-?[\d.]+)/g)) { if (m[1] === 'start') open = Math.max(0, Number(m[2])); else { sil.push([open ?? 0, Number(m[2])]); open = null; } }
  if (open !== null) sil.push([open, dur]);
  const speech = []; let t = 0;
  for (const [a, b] of sil) { if (a - t > 0.05) speech.push([round(t), round(a)]); t = b; }
  if (dur - t > 0.05) speech.push([round(t), round(dur)]);
  return speech;
}

/** Decodifica para mono float32 a `sr` Hz (soma dos canais). */
export function decodeMono(ffmpeg, file, sr = 48000) {
  const p = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (p.status !== 0) throw new AudioError('DECODE_FAILED', String(p.stderr).trim().split('\n').slice(-2).join(' | '));
  const b = p.stdout; return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

/** Primeiro instante, em [a,b], em que o sinal chega a `dbBelowPeak` dB do pico da janela. */
export function onsetIn(x, sr, a, b, dbBelowPeak = 20) {
  const i0 = Math.max(0, Math.floor(a * sr)); const i1 = Math.min(x.length, Math.ceil(b * sr));
  let pk = 0; let ip = i0; for (let i = i0; i < i1; i++) { const v = Math.abs(x[i]); if (v > pk) { pk = v; ip = i; } }
  if (pk <= 1e-7) return null;
  const th = pk * 10 ** (-dbBelowPeak / 20);
  for (let i = i0; i < i1; i++) if (Math.abs(x[i]) >= th) return { onset: i / sr, peak: ip / sr, peak_dbfs: 20 * Math.log10(pk) };
  return null;
}

/**
 * Sincronia medida no SINAL: o ataque de cada cue conformado (do onset −5 ms até +60 ms) é procurado no áudio por
 * correlação cruzada normalizada, ±10 ms em torno da posição planejada. Erro = deslocamento em amostras (→ ms).
 * Funciona com caudas sobrepostas e com áudio recodificado (AAC do render do Remotion). `conformed[cueId]` = Float32Array.
 */
export function verifySync({ samples, sr = 48000, plan, conformed, offset = 0, toleranceMs = 1, minCorr = 0.6, searchMs = 10 }) {
  const [num, den] = plan.fps.split('/').map(Number);
  const rows = [];
  for (const c of plan.cues) {
    const x = conformed?.[c.id];
    if (!x) { rows.push({ cue: c.id, sound: c.sound.id, status: 'NOT_FOUND' }); continue; }
    const o = onsetIn(x, sr, 0, x.length / sr);
    if (!o) { rows.push({ cue: c.id, sound: c.sound.id, status: 'NOT_FOUND' }); continue; }
    const t0 = Math.max(0, Math.round((o.onset - 0.005) * sr)); const t1 = Math.min(x.length, t0 + Math.round(0.065 * sr));
    const tpl = x.subarray(t0, t1); let te = 0; for (let i = 0; i < tpl.length; i++) te += tpl[i] * tpl[i];
    const base = Math.round((c.start_frame * den * sr) / num + offset * sr) + t0;   // onde o ataque deveria estar no áudio
    const W = Math.round((searchMs / 1000) * sr);
    let best = -2; let lag = 0;
    for (let L = -W; L <= W; L++) {
      const j0 = base + L; if (j0 < 0 || j0 + tpl.length > samples.length) continue;
      let xy = 0; let yy = 0; for (let i = 0; i < tpl.length; i++) { const y = samples[j0 + i]; xy += tpl[i] * y; yy += y * y; }
      const r = yy > 0 && te > 0 ? xy / Math.sqrt(te * yy) : -1;
      if (r > best) { best = r; lag = L; }
    }
    const err = (lag / sr) * 1000;
    rows.push({ cue: c.id, sound: c.sound.id, expected_s: round(base / sr), measured_s: round((base + lag) / sr), error_ms: Math.round(err * 1000) / 1000, error_samples: lag, correlation: Math.round(best * 1000) / 1000,
      status: best < minCorr ? 'LOW_CORRELATION' : Math.abs(err) <= toleranceMs ? 'PASS' : 'FAIL' });
  }
  const checked = rows.filter((r) => r.status === 'PASS' || r.status === 'FAIL');
  return { status: checked.length && checked.every((r) => r.status === 'PASS') && rows.every((r) => r.status !== 'FAIL') ? 'PASS' : checked.some((r) => r.status === 'FAIL') ? 'FAIL' : 'NOT_VERIFIED',
    method: 'xcorr(ataque do cue conformado, ±10 ms)', tolerance_ms: toleranceMs, checked: checked.length, max_abs_error_ms: checked.length ? Math.max(...checked.map((r) => Math.abs(r.error_ms))) : null, rows };
}
/**
 * Atraso global de `x` em relação a `ref` (amostras), por correlação cruzada em ±maxLag: busca grossa (passo 8) e
 * refinamento (passo 1). Serve para checar mix vs stem e prévia (AAC/mux) vs mix — offsets de codec/filtro.
 */
export function globalLag(ref, x, { sr = 48000, maxLagMs = 100 } = {}) {
  const W = Math.round((maxLagMs / 1000) * sr); const N = Math.min(ref.length, x.length);
  let er = 0; for (let i = W; i < N - W; i++) er += ref[i] * ref[i];
  const corr = (L, step) => { let xy = 0; let yy = 0; for (let i = W; i < N - W; i += step) { const y = x[i + L]; xy += ref[i] * y; yy += y * y; } return yy > 0 && er > 0 ? xy / Math.sqrt((er / step) * yy) : -1; };
  let best = -2; let lag = 0;
  for (let L = -W; L <= W; L += 8) { const r = corr(L, 4); if (r > best) { best = r; lag = L; } }
  let b2 = -2; let l2 = lag;
  for (let L = lag - 12; L <= lag + 12; L++) { const r = corr(L, 1); if (r > b2) { b2 = r; l2 = L; } }
  return { lag_samples: l2, lag_ms: Math.round((l2 / sr) * 1e6) / 1000, correlation: Math.round(b2 * 1000) / 1000 };
}
const round = (x) => Math.round(x * 1e6) / 1e6;
