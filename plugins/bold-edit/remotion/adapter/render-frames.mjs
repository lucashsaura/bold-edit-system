// RENDER ADAPTER (Remotion): plano → bundle → PNG SEQUENCE. NÃO gera master: o encode é do BOLD Delivery (R4).
// Determinismo (references/remotion-determinism.md): --gl=swangle, concurrency 1 por padrão, versões fixadas,
// browser explícito (nunca download), webpack cache DESLIGADO (nada escrito na instalação externa).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENTRY = path.resolve(HERE, '..', 'src', 'index.ts');
export const COMPOSITION_ID = 'BoldSpec';

const bundles = new Map(); // cache por processo: chave = instalação + publicDir

function loadRemotion(detected) {
  const req = createRequire(path.join(detected.dir, 'package.json'));
  return { bundler: req('@remotion/bundler'), renderer: req('@remotion/renderer') };
}

export async function getBundle(detected, { publicDir, workRoot }) {
  const key = `${detected.nodeModules}|${publicDir}`;
  if (bundles.has(key)) return bundles.get(key);
  const { bundler } = loadRemotion(detected);
  const nm = detected.nodeModules;
  const outDir = fs.mkdtempSync(path.join(path.resolve(workRoot), 'bold-bundle-'));
  const serveUrl = await bundler.bundle({
    entryPoint: ENTRY, outDir, publicDir, enableCaching: false, rootDir: path.dirname(ENTRY), onProgress: () => {},
    webpackOverride: (c) => ({
      ...c,
      resolve: { ...c.resolve, modules: [nm, 'node_modules'], alias: { ...(c.resolve?.alias || {}), react: path.join(nm, 'react'), 'react-dom': path.join(nm, 'react-dom'), remotion: path.join(nm, 'remotion') } },
      resolveLoader: { ...c.resolveLoader, modules: [nm, 'node_modules'] },
    }),
  });
  const entry = { serveUrl, outDir };
  bundles.set(key, entry);
  return entry;
}

/** Remove os bundles temporários criados por este processo (chamado pelo CLI ao final). */
export function disposeBundles() {
  for (const { outDir } of bundles.values()) fs.rmSync(outDir, { recursive: true, force: true });
  bundles.clear();
}

/** Detecta o padrão printf dos frames gerados (ex.: element-%d.png ou element-%03d.png). */
export function framePattern(dir) {
  const files = fs.readdirSync(dir).filter((f) => /\.png$/.test(f)).sort();
  const m = files.map((f) => f.match(/^(.*?)(\d+)\.png$/)).filter(Boolean);
  if (!m.length) return null;
  const prefix = m[0][1];
  const lens = new Set(m.map((x) => x[2].length));
  const nums = m.map((x) => Number(x[2])).sort((a, b) => a - b);
  const pad = lens.size === 1 && m[0][2].startsWith('0') ? `%0${m[0][2].length}d` : '%d';
  return { pattern: path.join(dir, `${prefix}${pad}.png`), start: nums[0], count: nums.length };
}

/**
 * @returns {Promise<{framesDir: string, pattern: string, start: number, count: number, composition: object}>}
 */
export async function renderPlanFrames(detected, { serveUrl, plan, framesDir, concurrency = 1, gl = 'swangle' }) {
  const { renderer } = loadRemotion(detected);
  const inputProps = { plan };
  const common = { serveUrl, inputProps, browserExecutable: detected.browserExecutable, chromiumOptions: { gl }, logLevel: 'error' };
  const composition = await renderer.selectComposition({ ...common, id: COMPOSITION_ID });
  await renderer.renderFrames({ ...common, composition, outputDir: framesDir, imageFormat: 'png', concurrency, onStart: () => {}, onFrameUpdate: () => {} });
  const seq = framePattern(framesDir);
  if (!seq) throw new Error('nenhum frame gerado');
  return { framesDir, ...seq, composition: { id: composition.id, width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames } };
}
