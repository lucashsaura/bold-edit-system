// ASSET MATCHING (R9) sobre o Asset Index V1 (R8, somente leitura). NUNCA escolhe por filename apenas: a
// evidência tem de vir de PASTA do caminho, TAGS ou METADADOS (tipo, orientação, alpha) e, quando houver, da
// relação com o Media Pool. Empate ou homônimo entre os melhores → ASSET_AMBIGUOUS (nada é escolhido).
import { fold, normWords } from '../../transcript/src/text.mjs';

const WANT = {
  PRODUCT_INSERT: ['IMAGE', 'VIDEO', 'MOTION_MASTER'], IMAGE_INSERT: ['IMAGE'], BROLL: ['VIDEO'], LOGO_BRAND: ['VECTOR', 'IMAGE', 'MOTION_MASTER'],
};

/**
 * @param {object[]} assets registros bold.asset-index/1 · @param {string[]} terms termos (produto/marca/lugar)
 * @param {{action:string, orientation?:string|null, mediaPool?:object[], logoPaths?:string[]}} o
 * @returns {{status, terms, recommended, candidates:[{asset_id, rel_path, type, score, basis[]}], note}}
 */
export function matchAssets(assets, terms, o) {
  const want = WANT[o.action] ?? []; const pool = new Set((o.mediaPool ?? []).map((p) => p.asset_id).filter(Boolean));
  const logo = new Set((o.logoPaths ?? []).map((p) => p.normalize('NFC')));
  const tset = [...new Set(terms.flatMap((t) => normWords(t)))].filter((w) => w.length >= 3);
  if (!tset.length && !logo.size) return { status: 'NO_TERMS', terms, recommended: null, candidates: [], note: 'sem termo para buscar' };
  const cands = [];
  for (const a of assets) {
    if (!want.includes(a.type)) continue;
    const basis = []; let score = 0;
    const dirs = a.rel_path.split('/').slice(0, -1).flatMap((d) => normWords(d));
    const nameWords = normWords(a.name.replace(/\.[^.]+$/, ''));
    const tagWords = a.tags.flatMap((t) => normWords(t));
    const inDir = tset.filter((w) => dirs.includes(w)); const inName = tset.filter((w) => nameWords.includes(w)); const inTag = tset.filter((w) => tagWords.includes(w));
    if (inDir.length) { score += 3 * inDir.length; basis.push(`path:${inDir.join('+')}`); }
    if (inTag.length) { score += 2 * inTag.length; basis.push(`tag:${inTag.join('+')}`); }
    if (inName.length) { score += inName.length; basis.push(`filename:${inName.join('+')}`); }
    if (logo.has(a.path) || logo.has(a.rel_path)) { score += 5; basis.push('identity:logo_path'); }
    if (!score) continue;
    if (o.orientation && a.orientation === o.orientation) { score += 1; basis.push(`metadata:orientation=${a.orientation}`); }
    if (o.action === 'LOGO_BRAND' && a.alpha) { score += 1; basis.push('metadata:alpha'); }
    if (pool.has(a.id)) { score += 1; basis.push('davinci:in_media_pool'); }
    cands.push({ asset_id: a.id, rel_path: a.rel_path, name: a.name, type: a.type, orientation: a.orientation, alpha: a.alpha, score, basis, name_only: basis.every((b) => b.startsWith('filename:') || b.startsWith('metadata:') || b.startsWith('davinci:')) });
  }
  cands.sort((x, y) => y.score - x.score || (x.rel_path < y.rel_path ? -1 : 1));
  if (!cands.length) return { status: 'NO_ASSET_FOUND', terms, recommended: null, candidates: [], note: 'nenhum asset do índice casa com os termos (por caminho/tags/metadados)' };
  const top = cands[0]; const tied = cands.filter((c) => c.score === top.score);
  const homonym = cands.some((c) => c !== top && fold(c.name) === fold(top.name));
  if (top.name_only) return { status: 'NAME_ONLY_REQUIRES_REVIEW', terms, recommended: null, candidates: cands, note: 'a única evidência é o nome do arquivo: nome não é identidade; revisão humana' };
  if (tied.length > 1 || homonym) return { status: 'ASSET_AMBIGUOUS', terms, recommended: null, candidates: cands, note: tied.length > 1 ? `${tied.length} candidatos empatados` : 'homônimo em outro caminho entre os candidatos; nada é escolhido silenciosamente' };
  return { status: 'CANDIDATE', terms, recommended: { asset_id: top.asset_id, rel_path: top.rel_path, basis: top.basis }, candidates: cands, note: 'sugestão (não selecionada): exige aprovação humana' };
}
