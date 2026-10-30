// Armazenamento do índice (R8). O índice é CACHE DERIVADO: descartável, reconstruível, nunca fonte única da verdade.
// Local padrão: <PROJECT_ROOT>/.bold/index/ (se a raiz está no projeto) ou <CACHE_DIR>/asset-index/. Nunca DENTRO da
// pasta escaneada (exceto o .bold/ do próprio projeto, que o scan ignora).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../core/schema/validate.mjs';
import { AssetError, nfcPath } from './scan.mjs';

const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'bold.asset-index.schema.json');
let schemaDoc = null;
export const assetIndexSchema = () => (schemaDoc ??= JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')));
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

export function defaultIndexPath(rootAbs, loaded) {
  const key = crypto.createHash('sha256').update(nfcPath(rootAbs)).digest('hex').slice(0, 16);
  const proj = loaded?.project?.valid ? loaded.project.root : null;
  if (proj && inside(rootAbs, proj)) return path.join(proj, '.bold', 'index', `assets.${key}.json`);
  return path.join(loaded.config.CACHE_DIR, 'asset-index', `${key}.json`);
}

/** Caminho canônico mesmo que o arquivo ainda não exista (realpath do ancestral existente + resto). */
function canonical(p) {
  let cur = path.resolve(p); const rest = [];
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
  return nfcPath(path.join(fs.realpathSync(cur), ...rest));
}

export function checkIndexLocation(indexFile, rootAbs) {
  const f = path.resolve(indexFile); rootAbs = canonical(rootAbs);
  const c = canonical(f);
  if (inside(c, rootAbs) && !inside(c, path.join(rootAbs, '.bold'))) throw new AssetError('INDEX_INSIDE_SCAN_ROOT', 'o índice não pode ser gravado dentro da pasta escaneada (o scan é somente leitura); use <raiz>/.bold/ ou outro local');
  return f;
}

export function loadIndex(file, { required = true } = {}) {
  if (!fs.existsSync(file)) { if (required) throw new AssetError('INDEX_MISSING', `índice não existe: ${path.basename(file)} (rode bold assets scan)`); return null; }
  let doc; try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new AssetError('INDEX_INVALID', `índice ilegível: ${e.message}`); }
  const errs = validate(assetIndexSchema(), doc);
  if (errs.length) throw new AssetError('INDEX_INVALID', 'índice não conforma bold.asset-index/1 (descartável: rode o scan de novo)', errs.slice(0, 10));
  return doc;
}

/** Escrita atômica (tmp + rename) — o índice é cache; regravar é esperado. */
export function saveIndex(file, doc) {
  const errs = validate(assetIndexSchema(), doc);
  if (errs.length) throw new AssetError('INDEX_INVALID', 'documento gerado não conforma o schema', errs.slice(0, 10));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`); fs.renameSync(tmp, file);
  return file;
}
