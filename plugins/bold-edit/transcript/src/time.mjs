// TEMPO (R8). Racional e explícito: fps é sempre uma fração exata (nunca inventada), drop-frame só existe em
// 29.97/59.94 (e 119.88), relógios SRT/VTT são milissegundos INTEIROS. Nada aqui assume 24 fps.

export class TimeError extends Error { constructor(code, message) { super(`${code}: ${message}`); this.code = code; } }

const NTSC = { '23.976': [24000, 1001], '23.98': [24000, 1001], '29.97': [30000, 1001], '47.952': [48000, 1001], '59.94': [60000, 1001], '119.88': [120000, 1001] };

/** "24" | "23.976" | "24000/1001" | 29.97 → {num, den, exact:"n/d", float}. Inválido → TimeError (nunca default). */
export function parseFps(v) {
  if (v === null || v === undefined || v === '') throw new TimeError('FPS_MISSING', 'fps ausente (nunca é assumido)');
  const s = String(v).trim();
  let num; let den;
  if (/^\d+\/\d+$/.test(s)) [num, den] = s.split('/').map(Number);
  else if (NTSC[s]) [num, den] = NTSC[s];
  else if (/^\d+(\.0+)?$/.test(s)) [num, den] = [Number.parseInt(s, 10), 1];
  else if (/^\d+\.\d+$/.test(s)) { const f = Number(s); const n = Object.entries(NTSC).find(([k]) => Math.abs(Number(k) - f) < 0.006); if (!n) throw new TimeError('FPS_INVALID', `fps não reconhecido: ${s}`); [num, den] = n[1]; }
  else throw new TimeError('FPS_INVALID', `fps inválido: ${s}`);
  if (!(num > 0 && den > 0)) throw new TimeError('FPS_INVALID', `fps inválido: ${s}`);
  const g = gcd(num, den); num /= g; den /= g;
  return { num, den, exact: `${num}/${den}`, float: Math.round((num / den) * 1000) / 1000 };
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Drop-frame só para timebases NTSC de 30/60/120 nominais. */
export function dropFrameInfo(fps) {
  if (fps.den !== 1001) return null;
  const nominal = Math.round(fps.num / fps.den);
  if (nominal === 30) return { nominal, drop: 2 };
  if (nominal === 60) return { nominal, drop: 4 };
  if (nominal === 120) return { nominal, drop: 8 };
  return null;
}

export const roundS = (x) => Math.round(x * 1e6) / 1e6;
export function framesToSeconds(frames, fps) { return roundS((frames * fps.den) / fps.num); }
/** Segundos → frame (floor com tolerância de 1 µs: o frame que CONTÉM o instante). */
export function secondsToFrames(sec, fps) { return Math.floor((sec * fps.num) / fps.den + 1e-6); }

const p2 = (n) => String(n).padStart(2, '0');

/** frames desde 00:00:00:00 → TC. drop_frame exige timebase DF (senão TimeError). Separador DF = ';'. */
export function framesToTc(frame, fps, dropFrame = false) {
  if (!Number.isInteger(frame) || frame < 0) throw new TimeError('FRAME_INVALID', `frame inválido: ${frame}`);
  if (dropFrame) {
    const df = dropFrameInfo(fps); if (!df) throw new TimeError('DF_INVALID', `drop-frame não existe em ${fps.exact}`);
    const { nominal: R, drop: d } = df; const per10 = R * 600 - d * 9; const perMin = R * 60 - d;
    const D = Math.floor(frame / per10); const M = frame % per10;
    const f = frame + 9 * d * D + (M > d ? d * Math.floor((M - d) / perMin) : 0);
    return `${p2(Math.floor(f / (R * 3600)))}:${p2(Math.floor(f / (R * 60)) % 60)}:${p2(Math.floor(f / R) % 60)};${p2(f % R)}`;
  }
  const R = Math.round(fps.num / fps.den); // NDF: rótulo por frames nominais (como o Resolve)
  return `${p2(Math.floor(frame / (R * 3600)))}:${p2(Math.floor(frame / (R * 60)) % 60)}:${p2(Math.floor(frame / R) % 60)}:${p2(frame % R)}`;
}

export function tcToFrames(tc, fps, dropFrame = false) {
  const m = /^(\d{2,}):(\d{2}):(\d{2})([:;.])(\d{2,3})$/.exec(String(tc).trim());
  if (!m) throw new TimeError('TC_INVALID', `timecode inválido: ${tc}`);
  const [hh, mm, ss, , ff] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4], Number(m[5])];
  const df = dropFrame ? dropFrameInfo(fps) : null;
  if (dropFrame && !df) throw new TimeError('DF_INVALID', `drop-frame não existe em ${fps.exact}`);
  const R = df ? df.nominal : Math.round(fps.num / fps.den);
  if (mm > 59 || ss > 59 || ff >= R) throw new TimeError('TC_INVALID', `timecode fora de faixa: ${tc}`);
  if (df) {
    if (ss === 0 && ff < df.drop && mm % 10 !== 0) throw new TimeError('TC_INVALID', `timecode DF inexistente: ${tc}`);
    const tm = 60 * hh + mm;
    return (hh * 3600 + mm * 60 + ss) * R + ff - df.drop * (tm - Math.floor(tm / 10));
  }
  return (hh * 3600 + mm * 60 + ss) * R + ff;
}

/** Relógio SRT/VTT → ms inteiros. SRT: HH:MM:SS,mmm · VTT: [HH:]MM:SS.mmm. */
export function parseClock(s, { vtt = false } = {}) {
  const t = String(s).trim();
  const m = vtt ? /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(t) : /^(\d{1,}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(t);
  if (!m) throw new TimeError('CLOCK_INVALID', `horário inválido: ${s}`);
  const ms = vtt ? Number(m[4]) : Number(m[4].padEnd(3, '0'));
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + ms;
}

export function formatClock(sec, { vtt = false } = {}) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000); const mi = Math.floor(ms / 60000) % 60; const s = Math.floor(ms / 1000) % 60; const r = ms % 1000;
  return `${p2(h)}:${p2(mi)}:${p2(s)}${vtt ? '.' : ','}${String(r).padStart(3, '0')}`;
}

/** Entrada humana de tempo: segundos ("12.5"), relógio ("00:01:02.500") ou TC com fps ("00:00:10:12"). */
export function parseTimeArg(s, fps = null, dropFrame = false) {
  const t = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^\d+:\d{2}:\d{2}[.,]\d{1,3}$/.test(t)) return parseClock(t) / 1000;
  if (/^\d+:\d{2}(\.\d{1,3})?$/.test(t)) { const [m, sec] = t.split(':'); return Number(m) * 60 + Number(sec); }
  if (/^\d{2,}:\d{2}:\d{2}[:;]\d{2,3}$/.test(t)) {
    if (!fps) throw new TimeError('FPS_MISSING', `timecode ${t} exige --fps (nunca é assumido)`);
    return framesToSeconds(tcToFrames(t, fps, dropFrame || t.includes(';')), fps);
  }
  throw new TimeError('TIME_INVALID', `tempo inválido: ${s}`);
}
