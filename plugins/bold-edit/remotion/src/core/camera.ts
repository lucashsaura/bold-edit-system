// CAMERA 2D — pan / push / pull / zoom / parallax / anchor / overscan. Puro e determinístico.
// Zoom interpolado em espaço logarítmico (push e pull soam naturais e simétricos).

import { easeFrom, progress, type Bezier } from './animation.ts';

export interface CamKey { frame: number; x?: number; y?: number; zoom?: number; rotate?: number; ease?: Bezier }
export interface Cam { x: number; y: number; zoom: number; rotate: number }

export const IDENTITY: Cam = { x: 0, y: 0, zoom: 1, rotate: 0 };

function channel(keys: CamKey[], frame: number, get: (k: CamKey) => number | undefined, fallback: number, log = false): number {
  const ks = keys.filter((k) => get(k) !== undefined);
  if (!ks.length) return fallback;
  const val = (k: CamKey) => (log ? Math.log(get(k) as number) : (get(k) as number));
  let out = val(ks[0]);
  if (frame > ks[0].frame) {
    out = val(ks[ks.length - 1]);
    for (let i = 1; i < ks.length; i++) {
      if (frame <= ks[i].frame) {
        const t = easeFrom(ks[i].ease)(progress(frame, ks[i - 1].frame, ks[i].frame - ks[i - 1].frame));
        out = val(ks[i - 1]) + (val(ks[i]) - val(ks[i - 1])) * t;
        break;
      }
    }
  }
  return log ? Math.exp(out) : out;
}

/** Estado da câmera no frame (aceita frame fracionário). x/y em px do quadro; zoom multiplicativo. */
export function camera2d(frame: number, keys: CamKey[]): Cam {
  if (!keys.length) return { ...IDENTITY };
  return {
    x: channel(keys, frame, (k) => k.x, 0),
    y: channel(keys, frame, (k) => k.y, 0),
    zoom: channel(keys, frame, (k) => k.zoom, 1, true),
    rotate: channel(keys, frame, (k) => k.rotate, 0),
  };
}

/** Câmera efetiva para uma camada de profundidade `depth` (0 = fixo/infinito, 1 = acompanha a câmera). */
export function parallax(cam: Cam, depth: number): Cam {
  return { x: cam.x * depth, y: cam.y * depth, zoom: Math.exp(Math.log(cam.zoom) * depth), rotate: cam.rotate * depth };
}

/** Transform CSS da camada (origem no centro do quadro): a câmera anda → o mundo anda ao contrário. */
export function cameraTransform(cam: Cam): string {
  return `scale(${cam.zoom.toFixed(6)}) rotate(${(-cam.rotate).toFixed(4)}deg) translate(${(-cam.x).toFixed(3)}px, ${(-cam.y).toFixed(3)}px)`;
}

// ── OVERSCAN (R5.6) ───────────────────────────────────────────────────────────────────────────────
// O transform CSS `scale(z) rotate(−θ) translate(−t)` (origem no centro C) leva um ponto p da camada para
//   view = C + z·R(−θ)·(p − C − t)          ⇒ inverso:  p = C + t + R(θ)·(view − C)/z
// Uma camada FULL-BLEED (retângulo W×H centrado em C) escalada por S em torno de C cobre o viewport sse,
// para os 4 cantos do viewport, |p − C| ≤ S·(W/2, H/2). Como o conjunto de cantos é simétrico,
//   S(cam) = max( 2|t_x|/W + (|cosθ| + (H/W)|sinθ|)/z ,  2|t_y|/H + ((W/H)|sinθ| + |cosθ|)/z )
// (forma fechada exata; sem margem mágica). A R5 dividia a translação pelo zoom e ignorava θ.

const DEG = Math.PI / 180;

/** Escala mínima exata para cobrir o viewport com a câmera (já com parallax) `cam`. */
export function coverScale(cam: Cam, width: number, height: number): number {
  const th = cam.rotate * DEG; const c = Math.abs(Math.cos(th)); const s = Math.abs(Math.sin(th));
  const sx = (2 * Math.abs(cam.x)) / width + (c + (height / width) * s) / cam.zoom;
  const sy = (2 * Math.abs(cam.y)) / height + ((width / height) * s + c) / cam.zoom;
  return Math.max(sx, sy);
}

/** Verificação independente (não usa a forma fechada): os 4 cantos do viewport caem dentro da camada escalada por S? */
export function coversViewport(cam: Cam, width: number, height: number, S: number, eps = 1e-9): boolean {
  const th = cam.rotate * DEG; const cs = Math.cos(th); const sn = Math.sin(th);
  for (const [vx, vy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const dx = (vx - width / 2) / cam.zoom; const dy = (vy - height / 2) / cam.zoom;
    const px = cam.x + cs * dx - sn * dy; const py = cam.y + sn * dx + cs * dy; // p − C
    if (Math.abs(px) > S * width / 2 + eps || Math.abs(py) > S * height / 2 + eps) return false;
  }
  return true;
}

/** Instantes EXATOS renderizados (em frames de saída), inclusive sub-frames, dentro de [inF, outF). */
export function renderTimes(frames: number, sub: number, inF: number, outF: number, subTime: (n: number, sub: number) => number): number[] {
  const out: number[] = [];
  for (let n = 0; n < frames * sub; n++) { const t = subTime(n, sub); if (t >= inF && t < outF) out.push(t); }
  return out;
}

/**
 * Overscan de uma camada full-bleed: máximo de coverScale sobre TODOS os instantes renderizados da camada,
 * com a câmera vista na profundidade `depth`. Nunca < 1. Exato para os frames que de fato existem.
 */
export function requiredOverscan(keys: CamKey[], width: number, height: number, times: number[], depth = 1): number {
  let S = 1;
  if (!keys.length) return S;
  for (const t of times) S = Math.max(S, coverScale(parallax(camera2d(t, keys), depth), width, height));
  return S;
}
