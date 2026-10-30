// Leitura de CABEÇALHOS (R8), somente leitura e limitada (≤ 256 KiB por arquivo): dimensões/alpha de imagens raster
// comuns e nomes de fontes sfnt. Sem decodificar pixels, sem dependências. Formato não suportado → null (honesto).
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readHead(file, bytes = 262144) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); return b.subarray(0, n); } finally { fs.closeSync(fd); }
}

/** {width, height, alpha:true|false|null, alpha_source, bit_depth?, color_type?, format} ou null. */
export function imageHeader(b) {
  if (b.length >= 33 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
    const colorType = b[25]; let alpha = colorType === 4 || colorType === 6; let src = 'png_color_type';
    if (!alpha) { // tRNS antes do IDAT = transparência por chave/paleta
      for (let o = 8; o + 8 <= b.length;) { const len = b.readUInt32BE(o); const type = b.toString('ascii', o + 4, o + 8); if (type === 'tRNS') { alpha = true; src = 'png_trns'; break; } if (type === 'IDAT' || type === 'IEND') break; o += 12 + len; }
    }
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), bit_depth: b[24], color_type: colorType, alpha, alpha_source: src };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 9 < b.length;) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
      const len = b.readUInt16BE(o + 2);
      if ((m >= 0xc0 && m <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(m)) return { format: 'jpeg', width: b.readUInt16BE(o + 7), height: b.readUInt16BE(o + 5), bit_depth: b[o + 4], components: b[o + 9], alpha: false, alpha_source: 'jpeg_no_alpha' };
      o += 2 + len;
    }
    return null;
  }
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) {
    const gce = b.indexOf(Buffer.from([0x21, 0xf9, 0x04]));
    return { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8), alpha: gce >= 0 ? !!(b[gce + 3] & 1) : false, alpha_source: 'gif_gce' };
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const c = b.toString('ascii', 12, 16);
    if (c === 'VP8X') return { format: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), alpha: !!(b[20] & 0x10), alpha_source: 'webp_vp8x' };
    if (c === 'VP8L') { const v = b.readUInt32LE(21); return { format: 'webp', width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff), alpha: !!((v >> 28) & 1), alpha_source: 'webp_vp8l' }; }
    if (c === 'VP8 ') return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, alpha: false, alpha_source: 'webp_vp8_lossy' };
  }
  return null;
}

// ── fontes (sfnt) ──
const WEIGHTS = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

function sfntTables(b, base = 0) {
  const n = b.readUInt16BE(base + 4); const t = {};
  for (let i = 0; i < n; i++) { const r = base + 12 + i * 16; t[b.toString('latin1', r, r + 4)] = { offset: b.readUInt32BE(r + 8), length: b.readUInt32BE(r + 12) }; }
  return t;
}

function nameTable(b) {
  const count = b.readUInt16BE(2); const strOff = b.readUInt16BE(4); const best = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12; if (r + 12 > b.length) break;
    const [pid, eid, lid, nid, len, off] = [0, 2, 4, 6, 8, 10].map((k) => b.readUInt16BE(r + k));
    const raw = b.subarray(strOff + off, strOff + off + len);
    let s = null; let score = 0;
    if (pid === 3 || pid === 0) { s = ''; for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode(raw.readUInt16BE(k)); score = pid === 3 && lid === 0x409 ? 3 : 2; } else if (pid === 1 && eid === 0) { s = raw.toString('latin1'); score = 1; }
    if (s && (!best[nid] || score > best[nid].score)) best[nid] = { s: s.normalize('NFC'), score };
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.s]));
}

function faceInfo(get) {
  const nt = get('name'); const os2 = get('OS/2');
  const names = nt ? nameTable(nt) : {};
  const weight = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : null;
  const italic = os2 && os2.length >= 64 ? !!(os2.readUInt16BE(62) & 1) : null;
  return { family: names[16] ?? names[1] ?? null, style: names[17] ?? names[2] ?? null, full_name: names[4] ?? null, postscript_name: names[6] ?? null,
    weight, weight_name: weight ? (WEIGHTS[Math.round(weight / 100) * 100] ?? null) : null, italic };
}

/** {format, faces:[{family, style, weight, ...}], parse} — WOFF2 (brotli + transformações) fica para depois: faces = []. */
export function fontInfo(file) {
  const b = fs.readFileSync(file);
  const sig = b.toString('latin1', 0, 4);
  const slice = (t, base = 0) => (tag) => (t[tag] ? b.subarray(t[tag].offset, t[tag].offset + t[tag].length) : null);
  try {
    if (sig === 'ttcf') {
      const n = b.readUInt32BE(8); const faces = [];
      for (let i = 0; i < Math.min(n, 64); i++) { const base = b.readUInt32BE(12 + i * 4); faces.push(faceInfo(slice(sfntTables(b, base)))); }
      return { format: 'ttc', faces, parse: 'OK' };
    }
    if (sig === '\x00\x01\x00\x00' || sig === 'OTTO' || sig === 'true') return { format: sig === 'OTTO' ? 'otf' : 'ttf', faces: [faceInfo(slice(sfntTables(b)))], parse: 'OK' };
    if (sig === 'wOFF') {
      const n = b.readUInt16BE(12); const t = {};
      for (let i = 0; i < n; i++) { const r = 44 + i * 20; t[b.toString('latin1', r, r + 4)] = { offset: b.readUInt32BE(r + 4), comp: b.readUInt32BE(r + 8), orig: b.readUInt32BE(r + 12) }; }
      const get = (tag) => { const e = t[tag]; if (!e) return null; const raw = b.subarray(e.offset, e.offset + e.comp); return e.comp < e.orig ? zlib.inflateSync(raw) : raw; };
      return { format: 'woff', faces: [faceInfo(get)], parse: 'OK' };
    }
    if (sig === 'wOF2') return { format: 'woff2', faces: [], parse: 'UNSUPPORTED_WOFF2' };
  } catch (e) { return { format: null, faces: [], parse: `FAILED: ${e.message}` }; }
  return { format: null, faces: [], parse: 'NOT_SFNT' };
}
