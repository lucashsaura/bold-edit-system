// Constantes do Node nos bootstraps (R12.2; Team ID de assinatura no macOS desde a R12.5B), GERADAS de setup/toolchain.lock.json — nunca editadas à mão.
// Só artefatos PINNED com HTTPS e host na allowlist viram constantes; o resto fica vazio (= bootstrap só mostra o plano).
// Uso (mantenedor): node setup/bootstrap-lock.mjs --check | --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLock, artifactFor, LOCK_FILE } from './lock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
export const SCRIPTS = { sh: path.join(ROOT, 'bootstrap', 'bootstrap.sh'), ps1: path.join(ROOT, 'bootstrap', 'bootstrap.ps1') };
const BEGIN = { sh: '# >>> BOLD-LOCK (gerado de setup/toolchain.lock.json — node setup/bootstrap-lock.mjs --write)', ps1: '# >>> BOLD-LOCK (gerado de setup/toolchain.lock.json - node setup/bootstrap-lock.mjs --write)' };
const END = '# <<< BOLD-LOCK';
const PLATS = { sh: [['DARWIN_ARM64', 'darwin-arm64'], ['DARWIN_X64', 'darwin-x64']], ps1: [['WIN32_X64', 'win32-x64']] };

function values(lock, plat) {
  const a = artifactFor(lock, 'node', plat);
  if (a.state !== 'PINNED') return { url: '', sha: '', size: '', strip: '', bin: '', team: '', ident: '' };
  // R12.5B: identidade de assinatura esperada (macOS) — o bootstrap verifica ANTES de executar o Node extraído
  return { url: a.entry.url, sha: a.entry.sha256, size: String(a.entry.size), strip: String(a.entry.strip_components ?? 0), bin: a.entry.bins.node,
    team: a.codesign?.team_id ?? '', ident: a.codesign?.bins?.node?.identifier ?? '' };
}

export function renderBlock(kind, lock) {
  const L = [BEGIN[kind]];
  const ver = lock.data.components.node.version;
  if (kind === 'sh') {
    L.push(`NODE_VERSION="${ver}"`);
    for (const [K, p] of PLATS.sh) { const v = values(lock, p); L.push(`NODE_${K}_URL="${v.url}"`, `NODE_${K}_SHA256="${v.sha}"`, `NODE_${K}_SIZE="${v.size}"`, `NODE_${K}_BIN="${v.bin}"`, `NODE_${K}_TEAM="${v.team}"`, `NODE_${K}_IDENT="${v.ident}"`); }
  } else {
    L.push(`$NodeVersion = '${ver}'`);
    for (const [K, p] of PLATS.ps1) { const v = values(lock, p); L.push(`$Node_${K}_Url = '${v.url}'`, `$Node_${K}_Sha256 = '${v.sha}'`, `$Node_${K}_Size = '${v.size}'`, `$Node_${K}_Bin = '${v.bin}'`); }
  }
  L.push(END);
  return L.join('\n');
}

export function currentBlock(kind, text) {
  const a = text.indexOf(BEGIN[kind]); const b = text.indexOf(END, a);
  if (a < 0 || b < 0) return null;
  return text.slice(a, b + END.length).replace(/\r\n/g, '\n');
}

// R12.5 B3 — bloco BOLD-TEST dos bootstraps: VAZIO na distribuição (o `bold dist audit` reprova se preenchido).
// Só a suíte gera CÓPIAS com o bloco preenchido (artefato de teste em loopback) — nunca há leitura do ambiente.
const TEST_BEGIN = '# >>> BOLD-TEST'; const TEST_END = '# <<< BOLD-TEST';
const TEST_KEYS = { sh: ['TEST_URL', 'TEST_SHA256', 'TEST_SIZE', 'TEST_BIN', 'TEST_TEAM'], ps1: ['$Test_Url', '$Test_Sha256', '$Test_Size', '$Test_Bin'] };
function testBlock(text) {
  const t = text.replace(/\r\n/g, '\n'); const a = t.indexOf(TEST_BEGIN); const b = t.indexOf(TEST_END, a);
  return a < 0 || b < 0 ? null : t.slice(a, b + TEST_END.length);
}
/** true se o bloco BOLD-TEST existe e TODOS os valores estão vazios (estado obrigatório na distribuição). */
export function testBlockEmpty(text) {
  const blk = testBlock(text); if (blk === null) return false;
  const vals = blk.split('\n').slice(1, -1).filter((l) => l.trim() && !l.trim().startsWith('#'));
  return vals.length > 0 && vals.every((l) => /=\s*(""|'')\s*$/.test(l));
}
/** SÓ TESTES: texto do script com o bloco BOLD-TEST preenchido (a suíte grava a cópia num diretório temporário). */
export function withTestBlock(kind, text, values) {
  const blk = testBlock(text); if (blk === null) throw new Error(`${kind}: marcadores BOLD-TEST ausentes`);
  const q = kind === 'sh' ? (v) => `"${v}"` : (v) => `'${v}'`;
  const lines = TEST_KEYS[kind].map((k) => `${k}${kind === 'sh' ? '=' : ' = '}${q(values[k.replace(/^\$Test_|^TEST_/, '').toLowerCase()] ?? '')}`);
  return text.replace(/\r\n/g, '\n').replace(blk, [blk.split('\n')[0], ...lines, TEST_END].join('\n'));
}
/** {sh, ps1}: true se o bloco BOLD-TEST de cada bootstrap do repositório está vazio. */
export function checkTestBlocks() {
  const out = {}; for (const k of Object.keys(SCRIPTS)) out[k] = testBlockEmpty(fs.readFileSync(SCRIPTS[k], 'utf8')); return out;
}

export function check(lock = loadLock(LOCK_FILE)) {
  const out = {};
  for (const k of Object.keys(SCRIPTS)) { const t = fs.readFileSync(SCRIPTS[k], 'utf8'); out[k] = currentBlock(k, t) === renderBlock(k, lock); }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lock = loadLock(LOCK_FILE);
  if (process.argv.includes('--write')) {
    for (const k of Object.keys(SCRIPTS)) {
      const t = fs.readFileSync(SCRIPTS[k], 'utf8'); const cur = currentBlock(k, t);
      if (!cur) { console.error(`${k}: marcadores BOLD-LOCK ausentes`); process.exit(1); }
      const eol = k === 'ps1' && t.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(SCRIPTS[k], t.replace(/\r\n/g, '\n').replace(cur, renderBlock(k, lock)).replace(/\n/g, eol));
    }
    console.log('bootstraps atualizados a partir do lock');
  } else { const r = check(lock); console.log(JSON.stringify(r)); process.exit(Object.values(r).every(Boolean) ? 0 : 1); }
}
