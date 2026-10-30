// Análise de alpha por frame (MACHINE QC). Não declara a composição visual correta — isso é VISUAL QC.
//
// Heurística de borda/halo (R5: segue o GRADIENTE do alpha):
//   Candidato: pixel com α ∈ [EDGE_MIN_ALPHA, 254], |∇α| (Sobel) ≥ EDGE_MIN_GRAD, cuja rampa PARA FORA desce
//   (α não cresce) até α=0 em ≤ EDGE_RADIUS px, caindo ≥ 8 já nos 2 primeiros px → silhueta contra o fundo transparente. Isso exclui texto sobre
//   placa semitransparente e bordas sobre sombra (a rampa para fora não chega a α=0).
//   Borda dura de região semitransparente (placa/véu: α em +2 px para dentro não sobe) é PULADA — não mensurável.
//   Referência: caminhando para DENTRO pelo gradiente até o α parar de subir (2 passos) ou chegar a 255.
//     straight_dev = |RGB_borda − RGB_ref|                    (≈ 0 em alpha straight correto)
//     premult_dev  = |RGB_borda − RGB_ref · (α_borda/α_ref)|  (≈ 0 se o arquivo estiver premultiplicado)

export const EDGE_MIN_ALPHA = 96;
export const EDGE_MIN_GRAD = 16;
export const EDGE_BG_RADIUS = 2;
export const EDGE_RADIUS = 8;
export const HALO_WARN = 16;
export const HALO_FAIL = 48;
export const MIN_EDGE_SAMPLES = 20;

export function alphaStats(buf, w, h) {
  let a0 = 0; let a255 = 0; let partial = 0;
  for (let i = 3; i < buf.length; i += 4) { const a = buf[i]; if (a === 0) a0++; else if (a === 255) a255++; else partial++; }
  const px = (x, y) => { const o = (y * w + x) * 4; return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]; };
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => ({ x, y, rgba: px(x, y) }));
  return {
    total: w * h, alpha0: a0, alpha255: a255, partial, sum_ok: a0 + a255 + partial === w * h,
    empty: a255 === 0 && partial === 0, fully_opaque: a0 === 0 && partial === 0, corners,
  };
}

export function edgeAnalysis(buf, w, h, { minAlpha = EDGE_MIN_ALPHA, radius = EDGE_RADIUS, maxSamples = 20000, collect = null } = {}) {
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : buf[(y * w + x) * 4 + 3]);
  const cand = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const a = A(x, y); if (a < minAlpha || a === 255) continue;
    const gx = (A(x + 1, y - 1) + 2 * A(x + 1, y) + A(x + 1, y + 1)) - (A(x - 1, y - 1) + 2 * A(x - 1, y) + A(x - 1, y + 1));
    const gy = (A(x - 1, y + 1) + 2 * A(x, y + 1) + A(x + 1, y + 1)) - (A(x - 1, y - 1) + 2 * A(x, y - 1) + A(x + 1, y - 1));
    const g = Math.hypot(gx, gy) / 4; if (g < EDGE_MIN_GRAD) continue;
    cand.push([x, y, gx / (4 * g), gy / (4 * g)]);
  }
  const stride = Math.max(1, Math.ceil(cand.length / maxSamples));
  let n = 0; let sd = 0; let pd = 0; let over = 0; let skippedStep = 0;
  for (let k = 0; k < cand.length; k += stride) {
    const [x0, y0, dx, dy] = cand[k]; const ae = A(x0, y0);
    // para fora: α não cresce e chega a 0
    let prev = ae; let reached = false; let drops = false;
    for (let s = 1; s <= radius; s++) {
      const a = A(Math.round(x0 - dx * s), Math.round(y0 - dy * s));
      if (s <= 2 && a < ae - 8) drops = true;
      if (a > prev + 4) break; if (a === 0) { reached = true; break; } prev = a;
    }
    if (!reached || !drops) continue; // pixel de platô (ex.: placa ao lado do texto) não é silhueta
    // borda dura de região semitransparente
    if (A(Math.round(x0 + dx * 2), Math.round(y0 + dy * 2)) <= ae + 8) { skippedStep++; continue; }
    // para dentro: até o α parar de subir
    let bx = x0; let by = y0; let ba = ae; let flat = 0;
    for (let s = 1; s <= radius; s++) {
      const x = Math.round(x0 + dx * s); const y = Math.round(y0 + dy * s); const a = A(x, y);
      if (a > ba + 3) { bx = x; by = y; ba = a; flat = 0; } else if (++flat >= 2) break;
      if (ba === 255) break;
    }
    if (ba <= ae) continue;
    const o = (y0 * w + x0) * 4; const q = (by * w + bx) * 4; const k2 = ae / ba;
    const s1 = Math.hypot(buf[o] - buf[q], buf[o + 1] - buf[q + 1], buf[o + 2] - buf[q + 2]);
    const m1 = Math.hypot(buf[o] - buf[q] * k2, buf[o + 1] - buf[q + 1] * k2, buf[o + 2] - buf[q + 2] * k2);
    sd += s1; pd += m1; n++; if (s1 > HALO_FAIL) over++;
    if (collect && s1 > HALO_FAIL && collect.length < 40) collect.push({ x: x0, y: y0, edge: [buf[o], buf[o + 1], buf[o + 2], ae], ref: [buf[q], buf[q + 1], buf[q + 2], ba], ref_xy: [bx, by] });
  }
  return {
    edge_pixels: cand.length, sampled: n, skipped_semitransparent_steps: skippedStep,
    straight_dev_mean: n ? Number((sd / n).toFixed(2)) : null,
    premult_dev_mean: n ? Number((pd / n).toFixed(2)) : null,
    frac_over_fail: n ? Number((over / n).toFixed(4)) : null,
  };
}

/** Classifica o resultado agregado da heurística de borda. */
export function edgeVerdict(agg) {
  if (!agg.sampled || agg.sampled < MIN_EDGE_SAMPLES) return { status: 'PASS', code: 'INSUFFICIENT_EDGE_SAMPLE', message: 'amostra de borda insuficiente para a heurística (requer VISUAL QC)' };
  if (agg.straight_dev_mean <= HALO_WARN) return { status: 'PASS', code: 'CLEAN_STRAIGHT_EDGES', message: 'bordas coerentes com alpha straight' };
  if (agg.premult_dev_mean < agg.straight_dev_mean / 2) return { status: 'FAIL', code: 'PREMULTIPLIED_SUSPECTED', message: 'RGB de borda cai com o alpha: material premultiplicado lido como straight (franja escura)' };
  if (agg.straight_dev_mean > HALO_FAIL) return { status: 'FAIL', code: 'GROSS_HALO', message: 'contaminação de cor nas bordas (halo grosseiro) — típico de média sem premultiply' };
  return { status: 'WARNING', code: 'POSSIBLE_HALO', message: 'desvio de cor nas bordas: possível halo — confirmar em VISUAL QC' };
}
