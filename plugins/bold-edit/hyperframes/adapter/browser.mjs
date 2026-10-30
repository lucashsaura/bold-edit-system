// BROWSER do HyperFrames (dependência EXTERNA, somente leitura): detecção do CLI fixado (cache do npx) e do
// chrome-headless-shell (cache do HyperFrames) + launch controlado com as flags do modo determinístico
// `--no-browser-gpu`. Nada é instalado/baixado. Usado pelo adapter (layout/font gate dinâmico) e pelos testes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'defaults.json'), 'utf8')).common.tools.HYPERFRAMES_VERSION;

/** Localiza node_modules do CLI fixado (npx cache) e o chrome-headless-shell do cache do HyperFrames. */
export function detectHF(env = process.env) {
  const home = os.homedir();
  let nm = env.BOLD_HYPERFRAMES_NODE_MODULES || null;
  if (!nm) {
    const npx = path.join(home, '.npm', '_npx');
    for (const d of fs.existsSync(npx) ? fs.readdirSync(npx) : []) {
      const p = path.join(npx, d, 'node_modules', 'hyperframes', 'package.json');
      try { if (JSON.parse(fs.readFileSync(p, 'utf8')).version === PIN) { nm = path.join(npx, d, 'node_modules'); break; } } catch { /* sem pacote */ }
    }
  }
  let chrome = env.BOLD_HYPERFRAMES_CHROME || null;
  if (!chrome) {
    const base = path.join(home, '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell');
    for (const v of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      for (const sub of fs.readdirSync(path.join(base, v))) { const exe = path.join(base, v, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'); if (fs.existsSync(exe)) { chrome = exe; break; } }
      if (chrome) break;
    }
  }
  if (!nm || !fs.existsSync(path.join(nm, 'puppeteer-core'))) return { status: 'UNAVAILABLE', reason: `HyperFrames ${PIN} (puppeteer-core) não encontrado — defina BOLD_HYPERFRAMES_NODE_MODULES` };
  if (!chrome) return { status: 'UNAVAILABLE', reason: 'chrome-headless-shell do HyperFrames não encontrado — defina BOLD_HYPERFRAMES_CHROME' };
  const hfVersion = JSON.parse(fs.readFileSync(path.join(nm, 'hyperframes', 'package.json'), 'utf8')).version;
  const ppVersion = JSON.parse(fs.readFileSync(path.join(nm, 'puppeteer-core', 'package.json'), 'utf8')).version;
  return { status: 'AVAILABLE', nm, chrome, hfVersion, ppVersion, chromeVersion: path.basename(path.dirname(path.dirname(chrome))) };
}

/** Flags equivalentes ao modo determinístico `--no-browser-gpu` do HyperFrames (SwiftShader, sem GPU). */
// (espelha engine/browserManager.ts do HyperFrames 0.8.114: ramo "software" + flags sempre adicionadas)
export const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing',
  '--force-color-profile=srgb', '--font-render-hinting=none', '--force-device-scale-factor=1', '--hide-scrollbars'];
// ramo "hardware" do macOS (só para medir a variância de GPU; não é o caminho de produção)
export const HARDWARE_GL_ARGS_MAC = ['--use-gl=angle', '--use-angle=metal', '--enable-gpu-rasterization', '--force-color-profile=srgb', '--font-render-hinting=none', '--force-device-scale-factor=1', '--hide-scrollbars'];

export async function launch(det, { args = SOFTWARE_GL_ARGS } = {}) {
  const req = createRequire(path.join(det.nm, 'noop.js'));
  const puppeteer = req('puppeteer-core');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bold-hf-spike-'));
  const browser = await puppeteer.launch({ executablePath: det.chrome, headless: 'shell', args, userDataDir });
  const close = browser.close.bind(browser); // o perfil temporário é removido junto com o browser
  browser.close = async () => { try { await close(); } finally { fs.rmSync(userDataDir, { recursive: true, force: true }); } };
  return browser;
}

