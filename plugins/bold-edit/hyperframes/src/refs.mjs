// TEXT REFERENCES (HyperFrames V1) — gramática estrita, tipada. Extensão compatível da gramática da R5.6
// (`<layer>.<…>`): os mesmos ids de camada, novos sufixos tipográficos. Toda ref é resolvida em FRAME SPACE (px do
// quadro), no estado de REPOUSO do layout (fim da entrada, sem transformações de animação), no browser, depois do
// carregamento das fontes, na ordem topológica calculada pelo compilador.
//
//   <L>.baseline                        y      baseline da 1ª linha
//   <L>.ink.top|bottom|left|right       y|y|x|x  caixa de tinta do bloco
//   <L>.center                          point  centro da caixa de tinta do bloco
//   <L>.advance.left|right              x      início/fim do avanço tipográfico (linha mais larga)
//   <L>.line.N                          point  início da linha N na sua baseline
//   <L>.line.N.baseline                 y
//   <L>.line.N.ink.top|bottom|left|right
//   <L>.line.N.center                   point
//   <L>.char.N                          point  origem do caractere N na baseline (N conta todas as linhas, sem quebras)
//   <L>.char.N.center                   point  centro da tinta do caractere
//   <L>.char.N.baseline                 y
//   <L>.char.N.ink.top|bottom|left|right
//   <L>.shape.S.start|end|center        point  formas de um TYPE_LOCKUP
//   <qualquer point>.x | .y             x | y
// Uso em expressões: {ref, offset} com offset = número (u) | "Nem" (em da camada DONA da expressão) | "Npx".

const ID = '[A-Za-z][A-Za-z0-9_-]{0,63}';
const INK = '(?:ink\\.(top|bottom|left|right))';
const RE = new RegExp(`^(${ID})\\.(?:(baseline)|${INK}|(center)|advance\\.(left|right)|line\\.(\\d{1,3})(?:\\.(?:(baseline)|${INK}|(center)))?|char\\.(\\d{1,4})(?:\\.(?:(baseline)|${INK}|(center)))?|shape\\.(${ID})\\.(start|end|center))(?:\\.(x|y))?$`);
/** Fonte da regex (compartilhada com o runtime do browser: mesma gramática, sem duplicar). */
export const REF_RE_SOURCE = RE.source;
const INK_TYPE = { top: 'y', bottom: 'y', left: 'x', right: 'x' };

/** Analisa uma referência. Retorna { layer, scope: block|line|char|shape, index?, shape?, metric, type: x|y|point } ou null. */
export function parseTextRef(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(RE); if (!m) return null;
  const [, layer, bBase, bInk, bCenter, adv, lIdx, lBase, lInk, lCenter, cIdx, cBase, cInk, cCenter, shape, sPart, axis] = m;
  let r;
  if (bBase) r = { scope: 'block', metric: 'baseline', type: 'y' };
  else if (bInk) r = { scope: 'block', metric: `ink.${bInk}`, type: INK_TYPE[bInk] };
  else if (bCenter) r = { scope: 'block', metric: 'center', type: 'point' };
  else if (adv) r = { scope: 'block', metric: `advance.${adv}`, type: 'x' };
  else if (lIdx !== undefined) r = { scope: 'line', index: Number(lIdx), metric: lBase ? 'baseline' : lInk ? `ink.${lInk}` : lCenter ? 'center' : 'origin', type: lBase ? 'y' : lInk ? INK_TYPE[lInk] : 'point' };
  else if (cIdx !== undefined) r = { scope: 'char', index: Number(cIdx), metric: cBase ? 'baseline' : cInk ? `ink.${cInk}` : cCenter ? 'center' : 'origin', type: cBase ? 'y' : cInk ? INK_TYPE[cInk] : 'point' };
  else r = { scope: 'shape', shape, metric: sPart, type: 'point' };
  if (axis) { if (r.type !== 'point') return null; r.axis = axis; r.type = axis; }
  return { layer, ...r, text: s };
}

/** Offset de expressão → { u } | { em } | { px }. */
export function parseOffset(v) {
  if (v === undefined) return { px: 0 };
  if (typeof v === 'number' && Number.isFinite(v)) return { u: v };
  if (typeof v === 'string') { const m = v.match(/^(-?\d+(?:\.\d+)?)(em|px)$/); if (m) return { [m[2]]: Number(m[1]) }; }
  return null;
}
