// COMPOSITE CHECK (R6.0.1) — sem NLE. Compara a fonte RGBA STRAIGHT (frames PNG) com o master entregue decodificado,
// ambos compostos (fórmula straight) sobre fundos sintéticos. Detecta premultiplicação indevida (a hipótese
// "master premultiplicado" é medida e precisa errar MAIS), halo/fringe (erro concentrado em alpha parcial) e fundo
// "baked" (alpha do master ≠ alpha da fonte). Revisão visual humana continua separada.
export const BACKGROUNDS = Object.freeze({ black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], saturated: [0, 200, 80] });

export function compositeCompare(src, master, w, h, bgs = BACKGROUNDS) {
  const out = {}; let alphaMax = 0;
  for (let i = 3; i < w * h * 4; i += 4) alphaMax = Math.max(alphaMax, Math.abs(src[i] - master[i]));
  for (const [name, bg] of Object.entries(bgs)) {
    let sum = 0; let max = 0; let n = 0; let eSum = 0; let eMax = 0; let eN = 0; let pSum = 0;
    for (let i = 0; i < w * h * 4; i += 4) {
      const as = src[i + 3] / 255; const am = master[i + 3] / 255;
      for (let k = 0; k < 3; k++) {
        const cs = src[i + k] * as + bg[k] * (1 - as);
        const cm = master[i + k] * am + bg[k] * (1 - am);
        const cp = Math.min(255, master[i + k] + bg[k] * (1 - am)); // se o master fosse premultiplicado
        const d = Math.abs(cs - cm); sum += d; n++; if (d > max) max = d;
        if (src[i + 3] > 0 && src[i + 3] < 255) { eSum += d; eN++; if (d > eMax) eMax = d; pSum += Math.abs(cs - cp); }
      }
    }
    out[name] = { mean: +(sum / n).toFixed(3), max: +max.toFixed(2), edge_mean: eN ? +(eSum / eN).toFixed(3) : null, edge_max: +eMax.toFixed(2), edge_mean_if_premultiplied: eN ? +(pSum / eN).toFixed(3) : null, edge_samples: eN / 3 };
  }
  return { alpha_max_diff: alphaMax, backgrounds: out };
}

/**
 * Veredito do composite check com os MESMOS critérios aplicados na evidência da R6.0.1 (não é métrica nova):
 * por fundo, erro máx ≤ 4 níveis e médio ≤ 1; na borda (α parcial) erro médio < 1 e a hipótese "premultiplicado"
 * pelo menos 10× pior; alpha do master = alpha da fonte (±1). VISUAL QC humano continua obrigatório.
 */
export function compositeVerdict(results) {
  const errors = [];
  for (const c of results) {
    if (c.alpha_max_diff > 1) errors.push(`frame ${c.frame_index}: alpha do master difere da fonte em ${c.alpha_max_diff}`);
    for (const [bg, s] of Object.entries(c.backgrounds)) {
      if (s.max > 4 || s.mean > 1) errors.push(`frame ${c.frame_index} sobre ${bg}: erro máx ${s.max} / médio ${s.mean}`);
      if (s.edge_samples > 0 && !(s.edge_mean < 1 && s.edge_mean_if_premultiplied > 10 * s.edge_mean)) errors.push(`frame ${c.frame_index} sobre ${bg}: borda ${s.edge_mean} (premultiplicado ${s.edge_mean_if_premultiplied})`);
    }
  }
  return { status: errors.length ? 'FAIL' : 'PASS', errors };
}
