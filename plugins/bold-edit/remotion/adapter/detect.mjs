// Detecção da instalação EXTERNA do Remotion (EXTERNAL_DEPENDENCY; licença PENDENTE).
// Nunca instala, nunca baixa. Se algo faltar → UNAVAILABLE (o resto da Skill continua funcionando).

import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED = Object.freeze(['remotion', '@remotion/bundler', '@remotion/renderer', 'react', 'react-dom']);
export const SUPPORTED_REMOTION = /^4\.0\.\d+$/;

function readVersion(nm, pkg) {
  try { return JSON.parse(fs.readFileSync(path.join(nm, pkg, 'package.json'), 'utf8')).version ?? null; } catch { return null; }
}

/** Caminho do chrome-headless-shell já baixado pela instalação externa (nunca baixamos). */
export function findBrowser(nm, platform = process.platform, arch = process.arch) {
  const base = path.join(nm, '.remotion', 'chrome-headless-shell');
  const plat = platform === 'darwin' ? (arch === 'arm64' ? 'mac-arm64' : 'mac-x64') : platform === 'win32' ? 'win64' : 'linux64';
  const exe = platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  const p = path.join(base, plat, `chrome-headless-shell-${plat}`, exe);
  return fs.existsSync(p) ? p : null;
}

/**
 * @param {string|null} remotionDir  tools.REMOTION_PROJECT_DIR (diretório com node_modules do Remotion)
 * @returns {{status: 'AVAILABLE'|'UNAVAILABLE', reason: string|null, dir: string|null, nodeModules: string|null, versions: object, browserExecutable: string|null}}
 */
export function detectRemotion(remotionDir) {
  const out = { status: 'UNAVAILABLE', reason: null, dir: remotionDir ?? null, nodeModules: null, versions: {}, browserExecutable: null };
  if (!remotionDir) { out.reason = 'tools.REMOTION_PROJECT_DIR / BOLD_REMOTION_PROJECT_DIR não configurado'; return out; }
  const nm = path.join(remotionDir, 'node_modules');
  if (!fs.existsSync(nm)) { out.reason = `node_modules ausente em ${remotionDir}`; return out; }
  out.nodeModules = nm;
  for (const p of REQUIRED) out.versions[p] = readVersion(nm, p);
  const missing = REQUIRED.filter((p) => !out.versions[p]);
  if (missing.length) { out.reason = `pacotes ausentes: ${missing.join(', ')}`; return out; }
  const rv = out.versions.remotion;
  if (!SUPPORTED_REMOTION.test(rv)) { out.reason = `remotion ${rv} não suportado (validado: 4.0.x)`; return out; }
  const mismatch = ['@remotion/bundler', '@remotion/renderer'].filter((p) => out.versions[p] !== rv);
  if (mismatch.length) { out.reason = `versões divergentes de remotion ${rv}: ${mismatch.map((p) => `${p}@${out.versions[p]}`).join(', ')}`; return out; }
  if (!/^(18|19)\./.test(out.versions.react) || out.versions.react !== out.versions['react-dom']) { out.reason = `react/react-dom incompatíveis (${out.versions.react}/${out.versions['react-dom']})`; return out; }
  out.browserExecutable = findBrowser(nm);
  if (!out.browserExecutable) { out.reason = 'chrome-headless-shell não encontrado na instalação externa (download NÃO é feito automaticamente)'; return out; }
  out.status = 'AVAILABLE';
  return out;
}
