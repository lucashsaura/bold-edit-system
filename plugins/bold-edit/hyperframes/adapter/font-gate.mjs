// FONT GATE FAIL-CLOSED (R6.0.1) — camada BOLD na frente do HyperFrames.
// O CLI local do HyperFrames 0.8.114 é fail-OPEN: família sem @font-face → Google Fonts / fonte embutida / captura de
// fonte do sistema / fallback silencioso (failClosedFontFetch só existe no render distribuído). Aqui isso vira FAIL
// ANTES de qualquer render:
//   ESTÁTICO  manifesto do projeto (arquivo local + sha256) · @font-face só para arquivos do manifesto · nenhuma
//             família fora do manifesto · nenhuma família genérica (fallback) · nenhum local() · nenhuma URL externa
//   DINÂMICO  no browser, CSS.getPlatformFontsForNode: TODO glifo renderizado precisa vir de fonte web do manifesto
//             (isCustomFont) — pega fallback por glifo ausente — e nenhuma requisição sai do loopback.
// Nenhuma fonte é baixada, copiada para a Skill ou procurada no sistema.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class FontGateError extends Error {
  constructor(errors) { super(`FONT GATE FAIL: ${errors.join(' · ')}`); this.code = 'FONT_GATE_FAIL'; this.errors = errors; }
}
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Manifesto: {schema:"bold.fonts.manifest/0", fonts:[{family, file (relativo ao projeto), sha256, weight?, style?}]}. */
export function loadFontManifest(projectDir, manifest) {
  const errors = [];
  if (!manifest || manifest.schema !== 'bold.fonts.manifest/0' || !Array.isArray(manifest.fonts) || !manifest.fonts.length) throw new FontGateError(['manifesto de fontes ausente ou inválido (schema bold.fonts.manifest/0, fonts[] ≥ 1)']);
  const root = fs.realpathSync(projectDir);
  const fonts = manifest.fonts.map((f, i) => {
    const p = `fonts[${i}]`;
    if (typeof f.family !== 'string' || !f.family) errors.push(`${p}.family obrigatório`);
    if (typeof f.file !== 'string' || path.isAbsolute(f.file) || f.file.split(/[\\/]/).includes('..')) { errors.push(`${p}.file: caminho relativo ao projeto, sem ".."`); return null; }
    const abs = path.join(root, f.file);
    if (!fs.existsSync(abs)) { errors.push(`${p}.file não existe: ${f.file}`); return null; }
    const got = sha256(abs);
    if (f.sha256 !== got) errors.push(`${p}.sha256 não confere (${f.file})`);
    return { ...f, abs, sha256: got };
  }).filter(Boolean);
  if (errors.length) throw new FontGateError(errors);
  return fonts;
}

const unq = (s) => s.trim().replace(/^["']|["']$/g, '').trim();
function familiesIn(value) { return value.split(',').map(unq).filter(Boolean); }

/** Gate ESTÁTICO sobre o HTML da composição (sem browser, sem rede). */
export function staticFontGate(html, fonts, { projectDir }) {
  const errors = []; const manifestFamilies = new Set(fonts.map((f) => f.family));
  const byFile = new Map(fonts.map((f) => [path.normalize(f.file), f]));
  // URLs externas em qualquer lugar (script/link/img/@import/url()) → FAIL (CDN, Google Fonts, …)
  for (const re of [/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//gi, /url\(\s*["']?\s*(?:https?:)?\/\//gi, /@import\b/gi, /\bfetch\s*\(\s*["'`]https?:/gi])
    for (const m of html.matchAll(re)) errors.push(`referência externa proibida: "${m[0].slice(0, 40)}"`);
  // @font-face: só arquivos do manifesto; sem local()
  const faces = [...html.matchAll(/@font-face\s*{([^}]*)}/gi)].map((m) => m[1]);
  const faced = new Set();
  for (const body of faces) {
    const fam = body.match(/font-family\s*:\s*([^;]+)/i); const src = body.match(/src\s*:\s*([^;]+)/i);
    if (!fam || !src) { errors.push('@font-face sem font-family/src'); continue; }
    const family = unq(fam[1]); faced.add(family);
    if (/local\s*\(/i.test(src[1])) errors.push(`@font-face "${family}": local() proibido (fonte do sistema)`);
    const urls = [...src[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]);
    if (!urls.length) errors.push(`@font-face "${family}": src sem url()`);
    for (const u of urls) {
      const rel = path.normalize(u);
      const f = byFile.get(rel);
      if (!f) errors.push(`@font-face "${family}": "${u}" não está no manifesto`);
      else if (f.family !== family) errors.push(`@font-face "${family}": arquivo declarado no manifesto para "${f.family}"`);
    }
  }
  // famílias usadas: CSS (font-family / font shorthand), atributos style, JS (fontFamily, strings de fonte de canvas)
  const used = new Set();
  // regras CSS só em contexto CSS (blocos <style> e atributos style=""); o JS tem padrões próprios abaixo
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).concat([...html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map((m) => m[2])).join('\n');
  const cssNoFaces = css.replace(/@font-face\s*{[^}]*}/gi, '');
  for (const m of cssNoFaces.matchAll(/font-family\s*:\s*([^;}"'`]*(?:["'][^"']*["'][^;}"'`]*)*)/gi)) for (const f of familiesIn(m[1])) used.add(f);
  for (const m of cssNoFaces.matchAll(/\bfont\s*:\s*[^;}]*?\d(?:px|pt|em|rem|%)(?:\s*\/\s*[\d.]+\w*)?\s+([^;}]+)/gi)) for (const f of familiesIn(m[1])) used.add(f);
  for (const m of html.matchAll(/fontFamily\s*[:=]\s*(["'`])([^"'`]+)\1/g)) for (const f of familiesIn(m[2])) used.add(f);
  for (const m of html.matchAll(/\d(?:px|pt)\s+\\?["']([^"'\\]+)\\?["']/g)) used.add(m[1].trim());
  for (const fam of [...used]) if (/\$\{|\+/.test(fam)) used.delete(fam); // template de código (o valor real é conferido no gate dinâmico)
  for (const fam of used) {
    if (CSS_WIDE.has(fam.toLowerCase())) continue;
    if (GENERIC.has(fam.toLowerCase())) errors.push(`família genérica "${fam}" = fallback proibido`);
    else if (!manifestFamilies.has(fam)) errors.push(`família "${fam}" usada sem estar no manifesto de fontes`);
    else if (!faced.has(fam)) errors.push(`família "${fam}" sem @font-face`);
  }
  for (const f of fonts) if (!faced.has(f.family)) errors.push(`manifesto: "${f.family}" sem @font-face na composição`);
  return { status: errors.length ? 'FAIL' : 'PASS', errors, families_used: [...used].sort(), faces: [...faced].sort() };
}

/**
 * Gate DINÂMICO: com a página já carregada (fontes prontas), lista as fontes REALMENTE usadas por cada elemento com
 * texto (CDP CSS.getPlatformFontsForNode). Qualquer fonte não-web (sistema/fallback) → FAIL.
 */
export async function dynamicFontGate(page, { requests = [] } = {}) {
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const textParents = []; const walk = (n) => { if (n.children?.some((c) => c.nodeType === 3 && c.nodeValue.trim())) textParents.push(n.nodeId); (n.children ?? []).forEach(walk); };
  walk(root);
  const errors = []; const seen = new Map(); let glyphs = 0;
  for (const nodeId of textParents) {
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    for (const f of fonts) {
      glyphs += f.glyphCount; const k = `${f.familyName}|${f.isCustomFont}`; seen.set(k, (seen.get(k) ?? 0) + f.glyphCount);
      if (!f.isCustomFont) errors.push(`fallback para fonte do sistema "${f.familyName}" (${f.glyphCount} glifos)`);
    }
  }
  for (const u of requests) if (!/^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:|about:)/.test(u)) errors.push(`requisição externa do browser: ${u.slice(0, 60)}`);
  await cdp.detach();
  if (!glyphs) errors.push('nenhum glifo renderizado (texto ausente?)');
  return { status: errors.length ? 'FAIL' : 'PASS', errors: [...new Set(errors)], fonts: [...seen].map(([k, n]) => ({ family: k.split('|')[0], custom: k.split('|')[1] === 'true', glyphs: n })), text_nodes: textParents.length, glyphs };
}
