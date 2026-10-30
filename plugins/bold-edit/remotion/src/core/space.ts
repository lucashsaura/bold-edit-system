// SHARED COORDINATE SPACE (R5.6) — o mínimo genérico para relações entre camadas.
//
//   REGION / LOCAL (u, v ∈ 0..1 da caixa da camada)  ─┐
//   SAFE (0..1 da safe area)                          ├─→ FRAME SPACE (px do quadro, pré-câmera)
//   FRAME (0..1 do quadro)                           ─┘
//
// Todo ponto compartilhável é resolvido UMA vez para FRAME SPACE no plano; os componentes só consomem px.
// Referências semânticas (strings validadas):
//   <layer>.point.<i>     ponto i de um MAP_PATH            <layer>.marker.<j>  marcador j de um MAP_PATH
//   <layer>.start | .end  extremos de um MAP_PATH           <layer>.target      alvo resolvido de um CALLOUT
//   <layer>.center        centro da caixa de qualquer camada
//   <layer>.anchor.<A>    uma das 9 âncoras da caixa (top-left … bottom-right)

import { ANCHORS, anchorPoint, type Anchor, type Rect } from './layout.ts';

export interface Pt { x: number; y: number }
export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const REF_RE = /^([A-Za-z][A-Za-z0-9_-]{0,63})\.(?:(point|marker)\.(\d{1,4})|(start|end|center|target)|anchor\.([a-z-]+))$/;

export type Ref =
  | { layer: string; kind: 'point' | 'marker'; index: number }
  | { layer: string; kind: 'start' | 'end' | 'center' | 'target' }
  | { layer: string; kind: 'anchor'; anchor: Anchor };

/** Analisa uma referência; `null` se a sintaxe for inválida (o chamador transforma em FAIL). */
export function parseRef(s: unknown): Ref | null {
  if (typeof s !== 'string') return null;
  const m = s.match(REF_RE);
  if (!m) return null;
  const layer = m[1];
  if (m[2]) return { layer, kind: m[2] as 'point' | 'marker', index: Number(m[3]) };
  if (m[4]) return { layer, kind: m[4] as 'start' | 'end' | 'center' | 'target' };
  if (m[5] && (ANCHORS as readonly string[]).includes(m[5])) return { layer, kind: 'anchor', anchor: m[5] as Anchor };
  return null;
}

export function regionToFrame(box: Rect, u: number, v: number): Pt {
  return { x: box.x + u * box.w, y: box.y + v * box.h };
}

export function boxPoint(box: Rect, a: Anchor): Pt {
  const p = anchorPoint(box, a);
  return { x: p.x, y: p.y };
}
