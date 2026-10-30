// Extração SEGURA de TAR.GZ e ZIP (R12.2) — leitores próprios, Node puro, sem dependências.
// Rejeita: caminho absoluto/drive/`..`/barra invertida/NUL · arquivos especiais (fifo, char, block) · hard links ·
// symlinks absolutos ou que saem da raiz · entradas DENTRO de um symlink · duplicatas (inclusive só por caixa/Unicode) ·
// ZIP cifrado/ZIP64/método desconhecido · entradas ZIP sobrepostas · CRC/tamanho divergentes · bombas de descompressão
// (teto por arquivo, teto total, razão total/arquivo e número de entradas). Symlinks seguros são criados só no fim.
// Escreve SOMENTE dentro de `dest`, que precisa não existir (é criado aqui). Em erro, quem chamou remove `dest`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SetupError } from './errors.mjs';

export const EXTRACT_LIMITS = Object.freeze({
  maxEntries: 50_000, maxTotalBytes: 2 * 1024 ** 3, maxFileBytes: 1024 ** 3, maxRatio: 200, maxPathLength: 1024, maxDepth: 48, maxMetaBytes: 1024 * 1024,
});
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// ───────────────────────────── caminhos e regras comuns ─────────────────────────────
export function normalizeEntryPath(raw, { strip = 0, platform = process.platform, limits = EXTRACT_LIMITS } = {}) {
  const s = String(raw);
  if (!s || s.includes('\0')) throw new SetupError('UNSAFE_PATH', 'nome vazio ou com NUL');
  if (s.includes('\\')) throw new SetupError('UNSAFE_PATH', `barra invertida no nome: ${s.slice(0, 80)}`);
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) throw new SetupError('UNSAFE_PATH', `caminho absoluto: ${s.slice(0, 80)}`);
  if (s.length > limits.maxPathLength) throw new SetupError('UNSAFE_PATH', 'caminho longo demais');
  const segs = s.split('/').filter((x) => x !== '' && x !== '.');
  if (segs.some((x) => x === '..')) throw new SetupError('UNSAFE_PATH', `path traversal: ${s.slice(0, 80)}`);
  // eslint-disable-next-line no-control-regex
  if (segs.some((x) => /[\x00-\x1f]/.test(x))) throw new SetupError('UNSAFE_PATH', 'caractere de controle no nome');
  if (platform === 'win32' && segs.some((x) => /[<>:"|?*]/.test(x) || WIN_RESERVED.test(x) || /[ .]$/.test(x))) throw new SetupError('UNSAFE_PATH', `nome inválido no Windows: ${s.slice(0, 80)}`);
  const rest = segs.slice(strip);
  if (!rest.length) return null;                                   // consumido pelo strip (ex.: a pasta raiz do tarball)
  if (rest.length > limits.maxDepth) throw new SetupError('UNSAFE_PATH', 'profundidade excessiva');
  return rest.join('/');
}

function safeLinkTarget(entry, target, platform) {
  if (platform === 'win32') throw new SetupError('UNSUPPORTED_ENTRY', `symlink não suportado no Windows: ${entry}`);
  if (!target || target.includes('\0') || target.includes('\\') || target.startsWith('/') || /^[A-Za-z]:/.test(target)) throw new SetupError('UNSAFE_LINK', `alvo de symlink inseguro: ${entry}`);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry), target));
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) throw new SetupError('UNSAFE_LINK', `symlink sai da raiz: ${entry} → ${target}`);
  return target;
}

/** Estado compartilhado: duplicatas, symlinks, contadores e limites. */
function makeSink(dest, { archiveBytes, limits, platform }) {
  fs.mkdirSync(dest, { recursive: false });
  const seen = new Map();            // chave canônica → tipo
  const links = new Map();           // caminho → alvo (criados no fim)
  const stats = { files: 0, dirs: 0, symlinks: 0, bytes: 0, entries: 0 };
  const key = (p) => p.normalize('NFC').toLowerCase();
  const register = (p, type) => {
    if (++stats.entries > limits.maxEntries) throw new SetupError('TOO_MANY_ENTRIES', `mais de ${limits.maxEntries} entradas`);
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) { const pre = segs.slice(0, i).join('/'); if (links.has(pre)) throw new SetupError('LINK_TRAVERSAL', `entrada dentro de symlink: ${p}`); const t = seen.get(key(pre)); if (t && t !== 'dir') throw new SetupError('DUPLICATE_ENTRY', `${pre} é arquivo e diretório`); }
    const k = key(p); const prev = seen.get(k);
    if (prev && !(prev === 'dir' && type === 'dir')) throw new SetupError('DUPLICATE_ENTRY', `entrada duplicada: ${p}`);
    if (type === 'link') for (const other of seen.keys()) if (other.startsWith(`${k}/`)) throw new SetupError('LINK_TRAVERSAL', `symlink sobre diretório já povoado: ${p}`);
    seen.set(k, type);
  };
  const addBytes = (n) => {
    stats.bytes += n;
    if (stats.bytes > limits.maxTotalBytes) throw new SetupError('DECOMPRESSION_BOMB', `conteúdo total acima de ${limits.maxTotalBytes} B`);
    if (archiveBytes > 0 && stats.bytes > limits.maxRatio * archiveBytes && stats.bytes > 1024 * 1024) throw new SetupError('DECOMPRESSION_BOMB', `razão de descompressão acima de ${limits.maxRatio}×`);
  };
  return {
    stats,
    dir(p) { register(p, 'dir'); fs.mkdirSync(path.join(dest, p), { recursive: true }); stats.dirs++; },
    open(p, exec) { register(p, 'file'); fs.mkdirSync(path.dirname(path.join(dest, p)), { recursive: true }); stats.files++; return fs.openSync(path.join(dest, p), 'wx', exec ? 0o755 : 0o644); },
    write(fd, chunk) { addBytes(chunk.length); fs.writeSync(fd, chunk); },
    link(p, target) { register(p, 'link'); links.set(p, safeLinkTarget(p, target, platform)); },
    finish() {
      for (const [p, t] of links) {
        const abs = path.join(dest, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.symlinkSync(t, abs); stats.symlinks++;
      }
      return stats;
    },
  };
}

// ───────────────────────────── TAR (dentro de GZIP) ─────────────────────────────
const cstr = (b, o, n) => { const s = b.subarray(o, o + n); const z = s.indexOf(0); return (z >= 0 ? s.subarray(0, z) : s).toString('utf8'); };
function octal(b, o, n) {
  if (b[o] & 0x80) throw new SetupError('TOO_LARGE', 'campo numérico base-256 (arquivo gigante) não suportado');
  const s = cstr(b, o, n).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new SetupError('CORRUPT', `campo octal inválido: ${s.slice(0, 20)}`);
  return parseInt(s, 8);
}
function checksumOk(h) {
  let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return sum === octal(h, 148, 8);
}
function parsePax(buf) {
  const out = {}; let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i); if (sp < 0) break;
    const len = parseInt(buf.subarray(i, sp).toString('ascii'), 10);
    if (!Number.isInteger(len) || len <= 0 || i + len > buf.length) throw new SetupError('CORRUPT', 'registro PAX inválido');
    const rec = buf.subarray(sp + 1, i + len - 1).toString('utf8'); const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

export async function extractTarGz(file, dest, { strip = 0, limits = EXTRACT_LIMITS, platform = process.platform } = {}) {
  const archiveBytes = fs.statSync(file).size;
  const sink = makeSink(dest, { archiveBytes, limits, platform });
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  let buf = Buffer.alloc(0); let ended = false; let zeros = 0;
  let cur = null;         // {kind:'file'|'meta'|'skip', fd?, remaining, pad, metaType?, meta?: Buffer[]}
  let pax = null; let longName = null; let longLink = null;
  const startEntry = (h) => {
    const type = String.fromCharCode(h[156] || 48);
    let name = cstr(h, 0, 100);
    const magic = cstr(h, 257, 6);
    if (magic.startsWith('ustar')) { const pre = cstr(h, 345, 155); if (pre) name = `${pre}/${name}`; }
    let link = cstr(h, 157, 100);
    let size = octal(h, 124, 12);
    const mode = octal(h, 100, 8);
    if (['x', 'g', 'L', 'K'].includes(type)) {
      if (size > limits.maxMetaBytes) throw new SetupError('TOO_LARGE', 'cabeçalho estendido grande demais');
      cur = { kind: 'meta', metaType: type, remaining: size, pad: (512 - (size % 512)) % 512, meta: [] }; return;
    }
    if (pax) { if (pax.path) name = pax.path; if (pax.linkpath) link = pax.linkpath; if (pax.size) size = Number(pax.size); }
    if (longName) name = longName; if (longLink) link = longLink;
    pax = null; longName = null; longLink = null;
    if (size > limits.maxFileBytes) throw new SetupError('DECOMPRESSION_BOMB', `arquivo acima de ${limits.maxFileBytes} B: ${name.slice(0, 80)}`);
    const p = normalizeEntryPath(name, { strip, platform, limits });
    const pad = (512 - (size % 512)) % 512;
    if (type === '0' || type === '\0' || type === '7') {
      if (p === null) throw new SetupError('UNSAFE_PATH', 'arquivo consumido pelo strip');
      cur = { kind: 'file', fd: size >= 0 ? sink.open(p, (mode & 0o111) !== 0) : null, remaining: size, pad }; if (size === 0) { fs.closeSync(cur.fd); cur = pad ? { kind: 'skip', remaining: 0, pad } : null; }
      return;
    }
    if (type === '5') { if (size) throw new SetupError('CORRUPT', 'diretório com dados'); if (p !== null) sink.dir(p); cur = null; return; }
    if (type === '2') { if (size) throw new SetupError('CORRUPT', 'symlink com dados'); if (p === null) throw new SetupError('UNSAFE_LINK', 'symlink na raiz'); sink.link(p, link); cur = null; return; }
    if (type === '1') throw new SetupError('UNSUPPORTED_ENTRY', `hard link recusado: ${name.slice(0, 80)}`);
    if (['3', '4', '6'].includes(type)) throw new SetupError('SPECIAL_FILE', `arquivo especial recusado: ${name.slice(0, 80)}`);
    throw new SetupError('UNSUPPORTED_ENTRY', `tipo tar '${type}' não suportado`);
  };
  try {
    for await (const chunk of stream) {
      if (ended) continue;                                        // ignora o preenchimento depois do fim do arquivo
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let off = 0;
      for (;;) {
        if (cur && cur.remaining > 0) {
          const n = Math.min(cur.remaining, buf.length - off); if (n <= 0) break;
          const piece = buf.subarray(off, off + n);
          if (cur.kind === 'file') sink.write(cur.fd, piece); else if (cur.kind === 'meta') cur.meta.push(Buffer.from(piece));
          cur.remaining -= n; off += n;
          if (cur.remaining > 0) break;
          if (cur.kind === 'file') fs.closeSync(cur.fd);
          if (cur.kind === 'meta') {
            const data = Buffer.concat(cur.meta);
            if (cur.metaType === 'x') pax = parsePax(data); else if (cur.metaType === 'L') longName = cstr(data, 0, data.length); else if (cur.metaType === 'K') longLink = cstr(data, 0, data.length);
          }
          cur = cur.pad ? { kind: 'skip', remaining: 0, pad: cur.pad } : null;
        }
        if (cur && cur.kind === 'skip') { const n = Math.min(cur.pad, buf.length - off); off += n; cur.pad -= n; if (cur.pad > 0) break; cur = null; }
        if (buf.length - off < 512) break;
        const h = buf.subarray(off, off + 512); off += 512;
        if (h.every((x) => x === 0)) { if (++zeros >= 2) { ended = true; break; } continue; }
        if (zeros) throw new SetupError('CORRUPT', 'bloco zero isolado no meio do tar');
        if (!checksumOk(h)) throw new SetupError('CORRUPT', 'checksum de cabeçalho tar inválido');
        startEntry(h);
      }
      buf = buf.subarray(off);
    }
  } catch (e) {
    try { if (cur?.fd) fs.closeSync(cur.fd); } catch { /* já fechado */ }
    stream.destroy();
    if (e instanceof SetupError) throw e;
    throw new SetupError('CORRUPT', `gzip/tar inválido: ${e.code || e.message}`);
  }
  if (cur && (cur.remaining > 0 || cur.pad > 0)) throw new SetupError('TRUNCATED', 'arquivo tar truncado');
  if (!ended && buf.length) throw new SetupError('TRUNCATED', 'arquivo tar truncado');
  return sink.finish();
}

// ───────────────────────────── ZIP ─────────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf, prev = 0) { let c = ~prev >>> 0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }

function readAt(fd, pos, len) { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); if (n !== len) throw new SetupError('TRUNCATED', 'zip truncado'); return b; }

export function readZipDirectory(fd, size, { limits = EXTRACT_LIMITS } = {}) {
  if (size < 22) throw new SetupError('CORRUPT', 'zip pequeno demais');
  const tailLen = Math.min(size, 22 + 65535); const tail = readAt(fd, size - tailLen, tailLen);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { e = i; break; }
  if (e < 0) throw new SetupError('CORRUPT', 'fim do diretório central (EOCD) não encontrado');
  const eocdPos = size - tailLen + e;
  if (eocdPos >= 20 && readAt(fd, eocdPos - 20, 4).readUInt32LE(0) === 0x07064b50) throw new SetupError('ZIP64_UNSUPPORTED', 'ZIP64 não suportado');
  const disk = tail.readUInt16LE(e + 4); const cdDisk = tail.readUInt16LE(e + 6); const nDisk = tail.readUInt16LE(e + 8); const n = tail.readUInt16LE(e + 10);
  const cdSize = tail.readUInt32LE(e + 12); const cdOff = tail.readUInt32LE(e + 16);
  if (disk || cdDisk || nDisk !== n) throw new SetupError('CORRUPT', 'zip multivolume não suportado');
  if (n === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw new SetupError('ZIP64_UNSUPPORTED', 'ZIP64 não suportado');
  if (n > limits.maxEntries) throw new SetupError('TOO_MANY_ENTRIES', `mais de ${limits.maxEntries} entradas`);
  if (cdOff + cdSize > eocdPos) throw new SetupError('CORRUPT', 'diretório central fora dos limites');
  const cd = readAt(fd, cdOff, cdSize); const entries = []; let p = 0;
  for (let i = 0; i < n; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new SetupError('CORRUPT', 'entrada do diretório central inválida');
    const madeBy = cd.readUInt16LE(p + 4); const flags = cd.readUInt16LE(p + 8); const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16); const csize = cd.readUInt32LE(p + 20); const usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28); const xl = cd.readUInt16LE(p + 30); const cl = cd.readUInt16LE(p + 32);
    const ext = cd.readUInt32LE(p + 38); const lho = cd.readUInt32LE(p + 42);
    const nameBuf = cd.subarray(p + 46, p + 46 + nl);
    if (p + 46 + nl + xl + cl > cd.length) throw new SetupError('CORRUPT', 'entrada truncada');
    if (flags & 0x41) throw new SetupError('ENCRYPTED', 'zip cifrado recusado');
    if (method !== 0 && method !== 8) throw new SetupError('UNSUPPORTED_METHOD', `método zip ${method} não suportado`);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new SetupError('ZIP64_UNSUPPORTED', 'ZIP64 não suportado');
    const name = flags & 0x800 ? nameBuf.toString('utf8') : nameBuf.toString('latin1');
    const unix = madeBy >> 8 === 3 ? (ext >>> 16) & 0xffff : 0;
    const fmt = unix & 0o170000;
    let type = name.endsWith('/') ? 'dir' : 'file';
    if (fmt === 0o120000) type = 'link'; else if (fmt === 0o040000) type = 'dir'; else if (fmt && fmt !== 0o100000) type = 'special';
    entries.push({ name, nameBuf, method, crc, csize, usize, lho, type, exec: (unix & 0o111) !== 0 });
    p += 46 + nl + xl + cl;
  }
  // tamanhos declarados × limites; sobreposição de entradas (zip bomb não recursiva)
  let declared = 0; for (const x of entries) { if (x.usize > limits.maxFileBytes) throw new SetupError('DECOMPRESSION_BOMB', `arquivo acima de ${limits.maxFileBytes} B`); declared += x.usize; }
  if (declared > limits.maxTotalBytes) throw new SetupError('DECOMPRESSION_BOMB', `conteúdo declarado acima de ${limits.maxTotalBytes} B`);
  if (declared > limits.maxRatio * size && declared > 1024 * 1024) throw new SetupError('DECOMPRESSION_BOMB', `razão declarada acima de ${limits.maxRatio}×`);
  for (const x of entries) {
    const lh = readAt(fd, x.lho, 30);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new SetupError('CORRUPT', 'cabeçalho local inválido');
    const lnl = lh.readUInt16LE(26); const lxl = lh.readUInt16LE(28);
    if (lh.readUInt16LE(8) !== x.method) throw new SetupError('CORRUPT', 'método local ≠ central');
    if (!readAt(fd, x.lho + 30, lnl).equals(x.nameBuf)) throw new SetupError('CORRUPT', 'nome local ≠ central');
    x.dataStart = x.lho + 30 + lnl + lxl; x.dataEnd = x.dataStart + x.csize;
  }
  const sorted = [...entries].sort((a, b) => a.lho - b.lho);
  for (let i = 0; i < sorted.length; i++) {
    const lim = i + 1 < sorted.length ? sorted[i + 1].lho : cdOff;
    if (sorted[i].dataEnd > lim) throw new SetupError('OVERLAPPING_ENTRIES', 'entradas zip sobrepostas (zip bomb)');
  }
  return entries;
}

async function inflateEntry(file, x, sink, outFd, limits) {
  if (x.csize === 0) {                                   // arquivo vazio armazenado: nada a ler
    if (x.usize !== 0 || x.crc !== 0) throw new SetupError('CORRUPT', `entrada vazia inconsistente: ${x.name.slice(0, 80)}`);
    return;
  }
  const src = fs.createReadStream(file, { start: x.dataStart, end: x.dataEnd - 1 });   // fd próprio por entrada
  const stream = x.method === 8 ? src.pipe(zlib.createInflateRaw()) : src;
  let n = 0; let c = 0;
  try {
    for await (const chunk of stream) {
      n += chunk.length;
      if (n > x.usize || n > limits.maxFileBytes) throw new SetupError('DECOMPRESSION_BOMB', `conteúdo maior que o declarado: ${x.name.slice(0, 80)}`);
      c = crc32(chunk, c);
      if (outFd !== null) sink.write(outFd, chunk); else (x.content ??= []).push(chunk);
    }
  } catch (e) { src.destroy(); if (e instanceof SetupError) throw e; throw new SetupError('CORRUPT', `deflate inválido: ${e.code || e.message}`); }
  if (n !== x.usize) throw new SetupError('CORRUPT', `tamanho divergente: ${x.name.slice(0, 80)}`);
  if (c !== x.crc) throw new SetupError('CORRUPT', `CRC divergente: ${x.name.slice(0, 80)}`);
}

export async function extractZip(file, dest, { strip = 0, limits = EXTRACT_LIMITS, platform = process.platform } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const entries = readZipDirectory(fd, size, { limits });
    const sink = makeSink(dest, { archiveBytes: size, limits, platform });
    for (const x of entries) {
      if (x.type === 'special') throw new SetupError('SPECIAL_FILE', `arquivo especial recusado: ${x.name.slice(0, 80)}`);
      const p = normalizeEntryPath(x.name, { strip, platform, limits });
      if (x.type === 'dir') { if (p !== null) sink.dir(p); continue; }
      if (p === null) throw new SetupError('UNSAFE_PATH', 'entrada consumida pelo strip');
      if (x.type === 'link') {
        if (x.usize > 4096) throw new SetupError('UNSAFE_LINK', 'alvo de symlink grande demais');
        await inflateEntry(file, x, sink, null, limits);
        sink.link(p, Buffer.concat(x.content || []).toString('utf8')); continue;
      }
      const out = sink.open(p, x.exec);
      try { await inflateEntry(file, x, sink, out, limits); } finally { fs.closeSync(out); }
    }
    return sink.finish();
  } finally { fs.closeSync(fd); }
}

/** Ponto único: formato do lock → leitor. */
export function extractArchive({ file, format, dest, strip = 0, limits = EXTRACT_LIMITS, platform = process.platform }) {
  if (format === 'tar.gz') return extractTarGz(file, dest, { strip, limits, platform });
  if (format === 'zip') return extractZip(file, dest, { strip, limits, platform });
  return Promise.reject(new SetupError('UNSUPPORTED_FORMAT', `formato ${format} não suportado`));
}
