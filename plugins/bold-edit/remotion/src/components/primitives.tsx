// PRIMITIVES — blocos de construção sem identidade visual própria. Toda aparência vem de tokens/plano.
import React from 'react';
import { Img, staticFile } from 'remotion';
import { clamp, easeFrom, progress, type Bezier } from '../core/animation.ts';
import { roughRectPolygon } from '../core/geometry.ts';
import type { PlanLayer } from '../core/spec.ts';

export type Reveal = 'up' | 'down' | 'left' | 'right' | 'fade' | 'scale';

/** Progresso de entrada (0→1) e de saída (0→1) de uma unidade com atraso `delay` (frames). */
export function unitProgress(t: number, L: PlanLayer, delay = 0): { e: number; x: number } {
  const e = easeFrom(L.ease)(progress(t, L.inF + L.delayF + delay, L.enterF));
  const x = easeFrom(L.exitEase)(progress(t, L.outF - L.exitF + delay * 0.35, L.exitF));
  return { e, x };
}

/** Wipe direcional por clip-path (máscara retangular). Saída continua na mesma direção. */
export function wipeClip(reveal: Reveal, e: number, x: number): string | undefined {
  const a = ((1 - e) * 100).toFixed(3); const b = (x * 100).toFixed(3);
  switch (reveal) {
    case 'up': return `inset(${a}% 0% ${b}% 0%)`;
    case 'down': return `inset(${b}% 0% ${a}% 0%)`;
    case 'left': return `inset(0% ${a}% 0% ${b}%)`;
    case 'right': return `inset(0% ${b}% 0% ${a}%)`;
    default: return undefined;
  }
}

/** Estilo de movimento de uma unidade (texto/forma) mascarada. */
export function unitMotion(reveal: Reveal, e: number, x: number, dist = 1.1): React.CSSProperties {
  const out = 1 - x;
  switch (reveal) {
    case 'up': return { transform: `translateY(${((1 - e) * dist * 100 - x * dist * 100).toFixed(3)}%)` };
    case 'down': return { transform: `translateY(${(-(1 - e) * dist * 100 + x * dist * 100).toFixed(3)}%)` };
    case 'left': return { transform: `translateX(${((1 - e) * dist * 100 - x * dist * 100).toFixed(3)}%)` };
    case 'right': return { transform: `translateX(${(-(1 - e) * dist * 100 + x * dist * 100).toFixed(3)}%)` };
    case 'scale': return { transform: `scale(${(0.86 + 0.14 * e).toFixed(4)})`, opacity: clamp(e * out) };
    default: return { opacity: clamp(e * out) };
  }
}

/** Texto dividido (linha/palavra/caractere) com máscara por unidade e stagger. */
export const SplitText: React.FC<{
  lines: string[]; L: PlanLayer; t: number; split: 'line' | 'word' | 'char'; style: React.CSSProperties; baseDelay?: number;
  trackingFrom?: number; tracking?: number;
}> = ({ lines, L, t, split, style, baseDelay = 0, trackingFrom, tracking }) => {
  let idx = 0;
  const mask: React.CSSProperties = { display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', paddingBottom: '0.12em', marginBottom: '-0.12em' };
  return (
    <>
      {lines.map((line, li) => {
        const units = split === 'line' ? [line] : split === 'word' ? line.split(/(\s+)/) : Array.from(line);
        const { e: le } = unitProgress(t, L, baseDelay + li * L.staggerF);
        const ls = trackingFrom !== undefined && tracking !== undefined ? trackingFrom + (tracking - trackingFrom) * le : tracking;
        return (
          <div key={li} style={{ ...style, letterSpacing: ls !== undefined ? `${ls}em` : style.letterSpacing, whiteSpace: 'pre' }}>
            {units.map((w, wi) => {
              if (/^\s+$/.test(w)) return <span key={wi}>{w}</span>;
              const { e, x } = unitProgress(t, L, baseDelay + (split === 'line' ? li : idx++) * L.staggerF);
              return (
                <span key={wi} style={mask}>
                  <span style={{ display: 'inline-block', ...unitMotion(L.reveal, e, x) }}>{w}</span>
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
};

/** Linha que se desenha (escala a partir de uma origem). */
export const DrawLine: React.FC<{ w: number; h: number; color: string; e: number; x: number; vertical?: boolean; origin?: string; style?: React.CSSProperties }> = ({ w, h, color, e, x, vertical, origin, style }) => (
  <div style={{
    width: w, height: h, background: color, transformOrigin: origin ?? (vertical ? 'center top' : 'left center'),
    transform: vertical ? `scaleY(${clamp(e - x)})` : `scaleX(${clamp(e - x)})`, ...style,
  }} />
);

/** Sombra como filtro (sobrevive a clip-path no filho). */
export function dropShadow(s: { x: number; y: number; blur: number; color: string; opacity: number } | null | undefined): string | undefined {
  if (!s) return undefined;
  const n = parseInt(s.color.slice(1, 7), 16);
  return `drop-shadow(${s.x.toFixed(2)}px ${s.y.toFixed(2)}px ${s.blur.toFixed(2)}px rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${s.opacity}))`;
}

/** Borda irregular de papel (seed estável por camada). */
export function paperClip(w: number, h: number, amp: number, step: number, seed: number): string {
  return roughRectPolygon(w, h, amp, seed, Math.max(2, step));
}

/** Grão de tela cheia, determinístico (seed muda a cada 2 frames). */
export const Grain: React.FC<{ w: number; h: number; amount: number; seed: number; t: number }> = ({ w, h, amount, seed, t }) => {
  if (amount <= 0) return null;
  const s = seed + Math.floor(t / 2);
  const id = `grain-${s}`;
  return (
    <svg width={w} height={h} style={{ position: 'absolute', inset: 0, opacity: amount * 0.55, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={s % 1000} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
};

/** Imagem procedural (sem arquivo): gradient | bands | noise, nas cores dadas. */
export const ProceduralImage: React.FC<{ kind: string; from: string; to: string; seed: number; w: number; h: number }> = ({ kind, from, to, seed, w, h }) => {
  if (kind === 'bands') {
    return <div style={{ width: w, height: h, background: `repeating-linear-gradient(115deg, ${from} 0px, ${from} ${w / 14}px, ${to} ${w / 14}px, ${to} ${w / 7}px)` }} />;
  }
  if (kind === 'noise') {
    const id = `pnoise-${seed}`;
    return (
      <svg width={w} height={h}>
        <defs><linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient>
          <filter id={id}><feTurbulence type="fractalNoise" baseFrequency={0.012} numOctaves={4} seed={seed % 1000} /><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncA type="table" tableValues="0 0.55" /></feComponentTransfer></filter></defs>
        <rect width="100%" height="100%" fill={`url(#${id}-g)`} />
        <rect width="100%" height="100%" filter={`url(#${id})`} style={{ mixBlendMode: 'multiply' }} />
      </svg>
    );
  }
  return <div style={{ width: w, height: h, background: `radial-gradient(120% 90% at 30% 25%, ${to} 0%, ${from} 70%)` }} />;
};

/** Imagem de projeto (asset) com fit/focus. O asset é servido pelo publicDir do bundle (staged pelo adapter). */
export const AssetImage: React.FC<{ asset: string; w: number; h: number; fit: 'cover' | 'contain'; focus: [number, number] }> = ({ asset, w, h, fit, focus }) => (
  <Img src={staticFile(asset)} style={{ width: w, height: h, objectFit: fit, objectPosition: `${focus[0] * 100}% ${focus[1] * 100}%`, display: 'block' }} />
);

export const easeIn = (b: Bezier) => easeFrom(b);
