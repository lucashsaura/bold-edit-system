// GEOMETRY — paths sem DOM (amostragem determinística), bordas irregulares com seed.

import { prng } from './animation.ts';

export interface Pt { x: number; y: number }

/** Catmull-Rom (uniforme) → polyline densa. */
export function catmullRom(points: Pt[], samplesPerSegment = 24): Pt[] {
  if (points.length < 2) return points.slice();
  const p = [points[0], ...points, points[points.length - 1]];
  const out: Pt[] = [];
  for (let i = 1; i < p.length - 2; i++) {
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment; const t2 = t * t; const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p[i - 1].x, p[i].x, p[i + 1].x, p[i + 2].x), y: f(p[i - 1].y, p[i].y, p[i + 1].y, p[i + 2].y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function polylineLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

/** Ponto e tangente (graus) a uma fração `u` (0..1) do comprimento. */
export function pointAt(pts: Pt[], u: number): { x: number; y: number; angle: number } {
  const L = polylineLength(pts); const target = Math.min(1, Math.max(0, u)) * L;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= target || i === pts.length - 1) {
      const t = seg ? (target - acc) / seg : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
    }
    acc += seg;
  }
  return { x: pts[0].x, y: pts[0].y, angle: 0 };
}

export function toPathD(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}

/**
 * Borda irregular (papel/impressão) para um retângulo: polígono com ruído de 2 escalas, com seed.
 * `amp` em px; `step` = espaçamento dos pontos. Retorna `clip-path: polygon(...)` em px.
 */
export function roughRectPolygon(w: number, h: number, amp: number, seed: number, step = 6): string {
  const r = prng(seed);
  const pts: string[] = [];
  const jitter = () => (r() - 0.5) * 2 * amp * (0.6 + 0.4 * r());
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(2, Math.round(len / step));
    let low = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n; if (i % 4 === 0) low = jitter() * 0.6;
      const j = low + jitter() * 0.4;
      pts.push(`${(x0 + (x1 - x0) * t + nx * j).toFixed(2)}px ${(y0 + (y1 - y0) * t + ny * j).toFixed(2)}px`);
    }
  };
  edge(0, 0, w, 0, 0, 1); edge(w, 0, w, h, -1, 0); edge(w, h, 0, h, 0, -1); edge(0, h, 0, 0, 1, 0);
  return `polygon(${pts.join(', ')})`;
}
