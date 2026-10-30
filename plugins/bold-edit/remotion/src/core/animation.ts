// ANIMATION — funções puras, baseadas em frame (aceitam frame fracionário para sub-frames).
// Sem Math.random, sem Date, sem DOM: o mesmo input produz o mesmo output.

export type Bezier = [number, number, number, number];
export type EaseFn = (t: number) => number;

export const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** cubic-bezier(x1,y1,x2,y2) como na CSS — Newton-Raphson com fallback de bisseção. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0; let hi = 1; t = x;
    for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

/** Vocabulário mínimo (motion-system.md §4). Projetos podem redefinir via tokens.motion.ease. */
export const EASES: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  io: [0.65, 0, 0.35, 1],
  set: [0.22, 1, 0.36, 1],
};

export function easeFrom(e: Bezier | EaseFn | undefined): EaseFn {
  if (!e) return cubicBezier(...EASES.io);
  if (typeof e === 'function') return e;
  return cubicBezier(e[0], e[1], e[2], e[3]);
}

/** Progresso 0..1 de um intervalo [start, start+duration). */
export function progress(frame: number, start: number, duration: number): number {
  if (duration <= 0) return frame >= start ? 1 : 0;
  return clamp((frame - start) / duration);
}

export interface Key { frame: number; value: number; ease?: Bezier }

/** Keyframes multi-segmento; o easing de cada segmento é o da chave de DESTINO. */
export function keyframes(frame: number, keys: Key[]): number {
  if (!keys.length) return 0;
  if (frame <= keys[0].frame) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]; const b = keys[i];
    if (frame <= b.frame) {
      const t = progress(frame, a.frame, b.frame - a.frame);
      return lerp(a.value, b.value, easeFrom(b.ease)(t));
    }
  }
  return keys[keys.length - 1].value;
}

/** Atraso do item `index` num stagger (frames). `from`: start | end | center. */
export function staggerDelay(index: number, total: number, step: number, from: 'start' | 'end' | 'center' = 'start'): number {
  if (from === 'end') return (total - 1 - index) * step;
  if (from === 'center') return Math.abs(index - (total - 1) / 2) * step;
  return index * step;
}

export interface Envelope { enter: number; exit: number; visible: boolean; phase: 'before' | 'enter' | 'hold' | 'exit' | 'after' }

/**
 * ENTER / HOLD / EXIT. `inF`..`outF` é a vida da camada; `enter` e `exit` são durações em frames.
 * enter: 0→1 durante a entrada; exit: 0→1 durante a saída.
 */
export function envelope(frame: number, inF: number, outF: number, enter: number, exit: number, enterEase?: Bezier, exitEase?: Bezier): Envelope {
  const visible = frame >= inF && frame < outF;
  const e = easeFrom(enterEase)(progress(frame, inF, enter));
  const x = easeFrom(exitEase ?? EASES.in)(progress(frame, outF - exit, exit));
  let phase: Envelope['phase'] = 'hold';
  if (frame < inF) phase = 'before';
  else if (frame >= outF) phase = 'after';
  else if (frame < inF + enter) phase = 'enter';
  else if (frame >= outF - exit) phase = 'exit';
  return { enter: e, exit: x, visible, phase };
}

export interface SpringOpts { stiffness?: number; damping?: number; mass?: number; from?: number; to?: number }

/** Mola amortecida em forma FECHADA (determinística, sensível ao fps: t = frame/fps). */
export function spring(frame: number, fps: number, { stiffness = 170, damping = 26, mass = 1, from = 0, to = 1 }: SpringOpts = {}): number {
  const t = Math.max(0, frame) / fps;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const d = to - from;
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    const c2 = r1 / (r1 - r2); const c1 = 1 - c2;
    x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
  }
  return to - d * x;
}

/** PRNG determinístico (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de strings → seed derivada (ex.: seed global + id da camada). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Tempo de sub-frame (motion-blur.md §1): amostras centradas no frame de saída.
 * n = índice no relógio fps×SUB. k controla a abertura (1,5 ≈ obturador 180–225°).
 */
export function subframeTime(n: number, sub: number, k = 1.5): number {
  if (sub <= 1) return n;
  return Math.floor(n / sub) + ((n % sub) - (sub - 1) / 2) / (sub * k);
}

/** Interpolação monotônica PCHIP (Fritsch–Carlson) — câmeras e curvas sem overshoot. */
export function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n < 2) return () => (n ? ys[0] : 0);
  const h = Array.from({ length: n - 1 }, (_, i) => xs[i + 1] - xs[i]);
  const dlt = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi);
  const m = new Array<number>(n);
  m[0] = dlt[0]; m[n - 1] = dlt[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (dlt[i - 1] * dlt[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1]; const w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / dlt[i - 1] + w2 / dlt[i]); }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t; const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
