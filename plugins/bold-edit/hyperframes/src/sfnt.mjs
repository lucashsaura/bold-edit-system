// SFNT (TrueType/OpenType) — leitor MÍNIMO e somente leitura, para o compilador checar ANTES do browser:
//   cmap  → cobertura de glifos (texto com caractere fora da fonte = fallback do sistema = FAIL)
//   fvar  → eixos variáveis existentes e seus intervalos (variation pedida fora da fonte = FAIL)
//   GSUB/GPOS FeatureList → tags OpenType disponíveis (feature pedida inexistente = FAIL)
//   OS/2  → peso estático (fontes não variáveis)
// Sem dependências; não modifica nem copia a fonte. WOFF/WOFF2/TTC não são lidos aqui (manifesto V1: .ttf/.otf).
import fs from 'node:fs';

export class SfntError extends Error { constructor(msg) { super(msg); this.code = 'FONT_UNREADABLE'; } }

function tables(buf) {
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'wOFF' || tag === 'wOF2' || tag === 'ttcf') throw new SfntError(`formato ${tag} não suportado no V1 (use .ttf/.otf)`);
  const ver = buf.readUInt32BE(0);
  if (ver !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') throw new SfntError('não é uma fonte TrueType/OpenType');
  const n = buf.readUInt16BE(4); const out = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; out[buf.toString('latin1', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) }; }
  return out;
}

function cmapCoverage(buf, t) {
  const base = t.off; const n = buf.readUInt16BE(base + 2); let best = null;
  for (let i = 0; i < n; i++) {
    const p = buf.readUInt16BE(base + 4 + i * 8); const e = buf.readUInt16BE(base + 6 + i * 8); const off = base + buf.readUInt32BE(base + 8 + i * 8);
    const fmt = buf.readUInt16BE(off);
    if (fmt === 12 && (p === 3 || p === 0)) { best = { fmt, off }; break; }
    if (fmt === 4 && ((p === 3 && e === 1) || p === 0) && !best) best = { fmt, off };
  }
  if (!best) throw new SfntError('cmap Unicode (formato 4/12) ausente');
  const ranges = [];
  if (best.fmt === 12) { const g = buf.readUInt32BE(best.off + 12); for (let i = 0; i < g; i++) { const o = best.off + 16 + i * 12; ranges.push([buf.readUInt32BE(o), buf.readUInt32BE(o + 4), buf.readUInt32BE(o + 8)]); } }
  else {
    const seg = buf.readUInt16BE(best.off + 6) / 2; const ends = best.off + 14; const starts = ends + seg * 2 + 2; const deltas = starts + seg * 2; const ros = deltas + seg * 2;
    for (let i = 0; i < seg; i++) {
      const s = buf.readUInt16BE(starts + i * 2); const e = buf.readUInt16BE(ends + i * 2); const d = buf.readInt16BE(deltas + i * 2); const ro = buf.readUInt16BE(ros + i * 2);
      if (s === 0xffff) continue;
      if (ro === 0) { ranges.push([s, e, (s + d) & 0xffff]); continue; }
      for (let c = s; c <= e; c++) { const gi = buf.readUInt16BE(ros + i * 2 + ro + (c - s) * 2); if (gi) ranges.push([c, c, (gi + d) & 0xffff]); }
    }
  }
  return (cp) => ranges.some(([s, e, g]) => cp >= s && cp <= e && (g + (cp - s)) !== 0);
}

function featureTags(buf, t) {
  if (!t) return [];
  const flOff = t.off + buf.readUInt16BE(t.off + 6); const n = buf.readUInt16BE(flOff); const tags = new Set();
  for (let i = 0; i < n; i++) tags.add(buf.toString('latin1', flOff + 2 + i * 6, flOff + 6 + i * 6));
  return [...tags];
}

function fvarAxes(buf, t) {
  if (!t) return {};
  const o = t.off; const axesOff = o + buf.readUInt16BE(o + 4); const count = buf.readUInt16BE(o + 8); const size = buf.readUInt16BE(o + 10); const axes = {};
  const fx = (p) => buf.readInt32BE(p) / 65536;
  for (let i = 0; i < count; i++) { const a = axesOff + i * size; axes[buf.toString('latin1', a, a + 4)] = { min: fx(a + 4), default: fx(a + 8), max: fx(a + 12) }; }
  return axes;
}

/** Inspeciona um arquivo de fonte local: { covers(cp), features[], axes{}, weight, italic }. */
export function inspectFont(file) {
  const buf = fs.readFileSync(file); const t = tables(buf);
  if (!t.cmap) throw new SfntError('tabela cmap ausente');
  const covers = cmapCoverage(buf, t.cmap);
  const os2 = t['OS/2'];
  const weight = os2 ? buf.readUInt16BE(os2.off + 4) : 400;
  const italic = os2 ? (buf.readUInt16BE(os2.off + 62) & 1) === 1 : false;
  return { covers, features: [...new Set([...featureTags(buf, t.GSUB), ...featureTags(buf, t.GPOS)])].sort(), axes: fvarAxes(buf, t.fvar), weight, italic };
}
