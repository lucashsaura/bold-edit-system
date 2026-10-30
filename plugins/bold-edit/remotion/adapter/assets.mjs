// ASSETS de projeto: resolvidos dentro de raízes permitidas e copiados SÓ para o publicDir temporário do bundle.
// Nunca são copiados para dentro da Skill. Bloqueia caminho absoluto, traversal, symlink que escapa da raiz.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class AssetError extends Error {
  constructor(msg, code = 'ASSET_INVALID') { super(msg); this.code = code; this.name = 'AssetError'; }
}

const EXT = { image: ['.png', '.jpg', '.jpeg', '.webp'], font: ['.otf', '.ttf', '.woff', '.woff2'] };

export function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/** Resolve um ref relativo dentro de `root`. Lança AssetError em qualquer violação. */
export function resolveAsset(ref, root, kind) {
  if (typeof ref !== 'string' || !ref.trim()) throw new AssetError('asset vazio');
  if (ref.includes('\0')) throw new AssetError(`asset com byte nulo: ${JSON.stringify(ref)}`);
  if (path.isAbsolute(ref) || /^[A-Za-z]:[\\/]/.test(ref) || ref.startsWith('~')) throw new AssetError(`asset deve ser caminho RELATIVO à raiz do projeto: ${ref}`, 'ASSET_ABSOLUTE');
  const parts = ref.split(/[\\/]+/);
  if (parts.includes('..')) throw new AssetError(`path traversal bloqueado: ${ref}`, 'ASSET_TRAVERSAL');
  const ext = path.extname(ref).toLowerCase();
  if (kind && !EXT[kind].includes(ext)) throw new AssetError(`extensão ${ext || '(nenhuma)'} não permitida para ${kind}: ${ref}`);
  const absRoot = fs.realpathSync(root);
  const abs = path.resolve(absRoot, ref);
  if (!fs.existsSync(abs)) throw new AssetError(`asset não encontrado: ${ref}`, 'ASSET_MISSING');
  const real = fs.realpathSync(abs);
  if (real !== absRoot && !real.startsWith(absRoot + path.sep)) throw new AssetError(`asset fora da raiz permitida (symlink?): ${ref}`, 'ASSET_OUTSIDE_ROOT');
  if (!fs.statSync(real).isFile()) throw new AssetError(`asset não é arquivo: ${ref}`);
  return real;
}

/**
 * Valida todos os assets do plano e os copia para um publicDir TEMPORÁRIO endereçado por conteúdo
 * (`<workRoot>/bold-public-<hash>`), reaproveitável entre renders com os mesmos assets.
 * @returns {{publicDir: string, staged: {kind, ref, sha256}[]}}
 */
export function stageAssets(assets, root, workRoot) {
  const resolved = assets.map((a) => ({ ...a, real: resolveAsset(a.ref, root, a.kind) }))
    .map((a) => ({ kind: a.kind, ref: a.ref.split(/[\\/]+/).join('/'), real: a.real, sha256: sha256(a.real) }));
  const key = crypto.createHash('sha256').update(JSON.stringify(resolved.map((a) => [a.kind, a.ref, a.sha256]))).digest('hex').slice(0, 16);
  const publicDir = path.join(workRoot, `bold-public-${key}`);
  if (!fs.existsSync(publicDir)) {
    const tmp = `${publicDir}.tmp-${process.pid}`;
    fs.mkdirSync(tmp, { recursive: true });
    for (const a of resolved) { const dst = path.join(tmp, ...a.ref.split('/')); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(a.real, dst); }
    fs.renameSync(tmp, publicDir);
  }
  return { publicDir, staged: resolved.map(({ real, ...rest }) => rest) };
}
