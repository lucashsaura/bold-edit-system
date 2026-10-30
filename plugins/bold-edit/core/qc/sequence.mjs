// AUDITORIA ESTRITA DE SEQUÊNCIA PNG (R6.0.1) — prova pela contagem REAL de arquivos, nunca por duration × fps.
// Detecta: arquivo faltando (gap), índice duplicado (ex.: frame_000003.png e frame_3.png), arquivo inesperado,
// início errado, contagem errada, PNG inválido, dimensões/formato divergentes. Hash SHA-256 de cada frame.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const COLOR = { 0: 'gray', 2: 'rgb', 3: 'palette', 4: 'gray+alpha', 6: 'rgba' };

export function pngHeader(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: COLOR[buf[25]] ?? String(buf[25]), interlace: buf[28] };
}

/**
 * @param {string} dir
 * @param {{expected: number, prefix?: string, digits?: number, start?: number, width?: number, height?: number, colorType?: string}} o
 */
export function auditPngSequence(dir, { expected, prefix = 'frame_', digits = 6, start = 1, width = null, height = null, colorType = 'rgba' }) {
  const errors = []; const exact = new RegExp(`^${prefix}(\\d{${digits}})\\.png$`); const loose = new RegExp(`^${prefix}0*(\\d+)\\.png$`, 'i');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort() : null;
  if (!names) return { status: 'FAIL', errors: ['diretório da sequência não existe'], count: 0, frames: [] };
  const byIndex = new Map(); const unexpected = [];
  for (const n of names) {
    const m = n.match(exact) ?? n.match(loose);
    if (!m) { unexpected.push(n); continue; }
    const i = Number(m[1]); (byIndex.get(i) ?? byIndex.set(i, []).get(i)).push(n);
    if (!exact.test(n)) errors.push(`nome fora do padrão ${prefix}${'0'.repeat(digits)}N.png: ${n}`);
  }
  const duplicates = [...byIndex].filter(([, v]) => v.length > 1).map(([i, v]) => ({ index: i, files: v }));
  const idx = [...byIndex.keys()].sort((a, b) => a - b);
  const gaps = []; for (let i = start; i < start + expected; i++) if (!byIndex.has(i)) gaps.push(i);
  const extra = idx.filter((i) => i < start || i >= start + expected);
  if (unexpected.length) errors.push(`arquivos inesperados: ${unexpected.slice(0, 5).join(', ')}`);
  if (duplicates.length) errors.push(`índices duplicados: ${duplicates.map((d) => d.index).join(', ')}`);
  if (gaps.length) errors.push(`frames faltando: ${gaps.slice(0, 10).join(', ')}`);
  if (extra.length) errors.push(`frames fora do intervalo ${start}..${start + expected - 1}: ${extra.slice(0, 10).join(', ')}`);
  const files = names.filter((n) => exact.test(n));
  if (files.length !== expected) errors.push(`contagem real ${files.length} ≠ esperada ${expected}`);
  const frames = files.map((n) => {
    const buf = fs.readFileSync(path.join(dir, n)); const h = pngHeader(buf);
    if (!h) { errors.push(`${n}: não é PNG válido`); return { name: n, sha256: null }; }
    if (width !== null && (h.width !== width || h.height !== height)) errors.push(`${n}: ${h.width}×${h.height} ≠ ${width}×${height}`);
    if (colorType && h.colorType !== colorType) errors.push(`${n}: formato ${h.colorType}/${h.bitDepth} ≠ ${colorType}`);
    return { name: n, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...h };
  });
  return { status: errors.length ? 'FAIL' : 'PASS', errors, count: files.length, expected, gaps, duplicates, unexpected, frames };
}

/** Compara duas sequências BYTE A BYTE (SHA-256 por frame). Sem tolerância visual. */
export function compareSequences(a, b) {
  const errors = [];
  if (a.count !== b.count) errors.push(`contagem ${a.count} ≠ ${b.count}`);
  const diff = [];
  for (let i = 0; i < Math.min(a.frames.length, b.frames.length); i++) {
    if (a.frames[i].name !== b.frames[i].name) errors.push(`nome ${a.frames[i].name} ≠ ${b.frames[i].name}`);
    if (a.frames[i].sha256 !== b.frames[i].sha256) diff.push(a.frames[i].name);
  }
  if (diff.length) errors.push(`${diff.length} frame(s) diferem byte a byte: ${diff.slice(0, 5).join(', ')}`);
  return { status: errors.length ? 'FAIL' : 'PASS', errors, identical: diff.length === 0 && a.count === b.count, differing: diff };
}
