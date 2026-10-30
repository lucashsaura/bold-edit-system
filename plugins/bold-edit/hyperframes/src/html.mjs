// HTML GENERATOR (R6.1) — HyperFrames Plan → composição HTML/CSS/JS determinística (contrato HyperFrames 0.8.114).
// Saída depende SOMENTE de: plano (que já carrega tokens resolvidos, fontes do manifesto, seed e versão do backend) e
// do runtime versionado. Sem GSAP, sem scripts/estilos externos, sem paleta/identidade própria, sem paths absolutos:
// fontes por @font-face relativo ao diretório do job (arquivos do manifesto).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REF_RE_SOURCE } from './refs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME = fs.readFileSync(path.join(HERE, 'runtime.js'), 'utf8');
export const RUNTIME_SHA256 = crypto.createHash('sha256').update(RUNTIME).digest('hex');
const esc = (s) => String(s).replace(/["\\]/g, '\\$&');
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function generateHtml(plan) {
  const C = plan.composition;
  const faces = plan.fonts.map((f) => `@font-face { font-family: "${esc(f.family)}"; src: url("${esc(f.file)}"); font-weight: ${f.weight}; font-style: ${f.style}; }`).join('\n');
  const bg = C.background.type === 'solid' ? `background: ${C.background.color};` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8">
<!-- bold.hyperframes.spec/0 · backend ${plan.backend_version} · runtime ${RUNTIME_SHA256.slice(0, 12)} · spec ${plan.source.spec_sha256.slice(0, 12)} -->
<style>
${faces}
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
#root { position: relative; width: ${C.width}px; height: ${C.height}px; overflow: hidden; ${bg} }
</style></head><body>
<div id="root" data-composition-id="${esc(C.id)}" data-width="${C.width}" data-height="${C.height}" data-duration="${C.duration_s}" data-fps="${C.fps}"></div>
<script>
window.__BOLD_PLAN__ = ${safeJson(plan)};
window.__BOLD_REF_RE__ = ${safeJson(REF_RE_SOURCE)};
${RUNTIME}
</script>
</body></html>
`;
}
