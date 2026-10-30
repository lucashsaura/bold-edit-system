// LAYOUT — safe area, grid, âncoras, stack. Tudo relativo a W×H (nada fixo em 1920×1080).

export interface Rect { x: number; y: number; w: number; h: number }

export const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type Anchor = typeof ANCHORS[number];

export function safeRect(width: number, height: number, safe = 0.1): Rect {
  const mx = width * safe; const my = height * safe;
  return { x: mx, y: my, w: width - 2 * mx, h: height - 2 * my };
}

export interface Grid { cols: number; rows: number; colW: number; rowH: number; gx: number; gy: number; area: Rect; cell: (col: number, row: number, span?: number, rowSpan?: number) => Rect }

/** Grid de `cols × rows` dentro de `area`. Índices começam em 0. */
export function grid(area: Rect, cols: number, rows: number, gutterX: number, gutterY = gutterX): Grid {
  const colW = (area.w - gutterX * (cols - 1)) / cols;
  const rowH = (area.h - gutterY * (rows - 1)) / rows;
  const cell = (col: number, row: number, span = 1, rowSpan = 1): Rect => ({
    x: area.x + col * (colW + gutterX),
    y: area.y + row * (rowH + gutterY),
    w: span * colW + (span - 1) * gutterX,
    h: rowSpan * rowH + (rowSpan - 1) * gutterY,
  });
  return { cols, rows, colW, rowH, gx: gutterX, gy: gutterY, area, cell };
}

export interface AnchorInfo { x: number; y: number; alignX: 'start' | 'center' | 'end'; alignY: 'start' | 'center' | 'end' }

export function anchorPoint(r: Rect, a: Anchor): AnchorInfo {
  const ax = a.endsWith('left') ? 'start' : a.endsWith('right') ? 'end' : 'center';
  const ay = a.startsWith('top') ? 'start' : a.startsWith('bottom') ? 'end' : 'center';
  return {
    x: ax === 'start' ? r.x : ax === 'end' ? r.x + r.w : r.x + r.w / 2,
    y: ay === 'start' ? r.y : ay === 'end' ? r.y + r.h : r.y + r.h / 2,
    alignX: ax, alignY: ay,
  };
}

/** Posiciona uma caixa W×H dentro de `region` segundo a âncora. */
export function placeBox(region: Rect, w: number, h: number, a: Anchor): Rect {
  const p = anchorPoint(region, a);
  const x = p.alignX === 'start' ? p.x : p.alignX === 'end' ? p.x - w : p.x - w / 2;
  const y = p.alignY === 'start' ? p.y : p.alignY === 'end' ? p.y - h : p.y - h / 2;
  return { x, y, w, h };
}

/** Offsets acumulados de itens empilhados (vertical ou horizontal) com `gap`. */
export function stack(sizes: number[], gap: number): number[] {
  const out: number[] = []; let acc = 0;
  for (const s of sizes) { out.push(acc); acc += s + gap; }
  return out;
}

/** Unidade base de layout proporcional ao quadro (≈ 1% do menor lado) — tipografia e espaçamento escalam com a resolução. */
export function unit(width: number, height: number): number {
  return Math.min(width, height) / 100;
}
