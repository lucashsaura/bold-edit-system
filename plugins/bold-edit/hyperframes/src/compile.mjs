// HYPERFRAMES COMPILER (R6.1) — motion.spec (formato ÚNICO de autoria) → bold.hyperframes.spec/0 (PLANO COMPILADO).
// Estrito: cada pattern TYPE_* tem allowlist de content/style/motion/responsive; qualquer propriedade fora dela →
// FAIL explícito (ACCEPTED_BUT_IGNORED = BUG). Fontes só pelo manifesto (bold.fonts.manifest/0), conferidas no arquivo
// (sha256, cobertura de glifos, eixos, features) ANTES de qualquer browser. Referências de texto validadas e ordenadas
// aqui; métricas resolvidas no browser (runtime) a partir do plano. Saída 100% serializável e determinística.
// Bibliotecas compartilhadas (somente leitura, comportamento intocado): tokens / tempo / safe area / grid / seed do
// Remotion Core V1 congelado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveTokens, refColor, refSize, refEase, refFont, refTime, TokenError } from '../../remotion/src/core/tokens.ts';
import { safeRect, grid as makeGrid, unit, ANCHORS } from '../../remotion/src/core/layout.ts';
import { hashSeed } from '../../remotion/src/core/animation.ts';
import { validate as validateSchema } from '../../core/schema/validate.mjs';
import { loadFontManifest, FontGateError } from '../adapter/font-gate.mjs';
import { inspectFont, SfntError } from './sfnt.mjs';
import { parseTextRef, parseOffset } from './refs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version;
export const PLAN_SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'schema', 'bold.hyperframes.spec.schema.json'), 'utf8'));
export const PLAN_VERSION = 1;
export const TYPE_PATTERNS = Object.freeze(['TYPE_CASCADE', 'TYPE_MASK_LINES', 'TYPE_TRACK', 'TYPE_PLANE', 'TYPE_LOCKUP']);
export const FORMATS = Object.freeze({ '16:9': 'landscape', '9:16': 'portrait', '1:1': 'square' });

export class HyperFramesSpecError extends Error {
  constructor(errors) { super(`HYPERFRAMES_SPEC_INVALID: ${errors.length} erro(s) — ${errors.slice(0, 3).map((e) => `${e.code} ${e.path}: ${e.message}`).join(' · ')}`); this.name = 'HyperFramesSpecError'; this.code = 'HYPERFRAMES_SPEC_INVALID'; this.errors = errors; }
}

const COMPOSITION_KEYS = ['width', 'height', 'transparent', 'background', 'seed', 'safe_area', 'grid', 'font_manifest', 'layers'];
const LAYER_KEYS = ['id', 'pattern', 'in', 'out', 'z', 'region', 'anchor', 'content', 'style', 'motion', 'responsive'];
const MOTION_COMMON = ['enter', 'delay', 'ease', 'exit', 'exit_ease'];
const TEXT_STYLE = ['font', 'size', 'weight', 'style', 'tracking', 'line_height', 'color', 'align', 'features', 'variation'];
const without = (a, ...x) => a.filter((k) => !x.includes(k));
const PLANE_STYLE = ['plate', 'padding', 'perspective', 'origin', 'rotate_x', 'rotate_y', 'rotate_z', 'translate_z', 'scale'];
const PLANE_FROM = ['rotate_x', 'rotate_y', 'rotate_z', 'translate_x', 'translate_y', 'translate_z', 'scale', 'opacity'];

/** Allowlist por pattern (o que não está aqui → UNSUPPORTED_PROPERTY). */
export const PATTERNS = Object.freeze({
  TYPE_CASCADE: { content: ['text'], style: without(TEXT_STYLE, 'line_height'), motion: [...MOTION_COMMON, 'stagger', 'order', 'from', 'variation'], responsive: ['region', 'anchor', 'align', 'size'] },
  TYPE_MASK_LINES: { content: ['lines'], style: TEXT_STYLE, motion: [...MOTION_COMMON, 'stagger', 'direction', 'distance', 'fade'], responsive: ['region', 'anchor', 'align', 'size', 'lines'] },
  TYPE_TRACK: { content: ['text'], style: without(TEXT_STYLE, 'tracking', 'line_height'), motion: [...MOTION_COMMON, 'tracking_from', 'tracking_to', 'fade'], responsive: ['region', 'anchor', 'align', 'size'] },
  TYPE_PLANE: { content: ['lines'], style: [...TEXT_STYLE, ...PLANE_STYLE], motion: [...MOTION_COMMON, 'from'], responsive: ['region', 'anchor', 'align', 'size', 'lines', 'perspective'] },
  TYPE_LOCKUP: { content: ['lines'], style: TEXT_STYLE, motion: [...MOTION_COMMON, 'text', 'shape_delay', 'shape_duration', 'shape_stagger'], responsive: ['region', 'anchor', 'align', 'size', 'lines'], shapes: true },
});

/** Defaults EXPLÍCITOS (documentados em references/hyperframes.md). Cores/fonte sempre de tokens — sem paleta própria. */
export const DEFAULTS = Object.freeze({
  layer: { region: 'safe', anchor: 'left', z: 0 },
  style: { font: 'font.display', size: 'type.4', style: 'normal', tracking: 0, line_height: 1.0, color: 'color.ink' },
  motion: { enter: 'motion.base', delay: 0, ease: 'ease.out', exit_ease: 'ease.in' },
  TYPE_CASCADE: { order: 'start', from: { x: 0, y: 0.6, rotate: 0, scale: 1, opacity: 0 }, variation: { x: 0, y: 0, rotate: 0, scale: 0 } },
  TYPE_MASK_LINES: { direction: 'up', distance: 1, fade: false },
  TYPE_TRACK: { tracking_from: 0.4, tracking_to: 0, fade: true },
  TYPE_PLANE: { perspective: 120, origin: [0.5, 0.5], rotate_x: 0, rotate_y: 0, rotate_z: 0, translate_z: 0, scale: 1, padding: 0, from: { rotate_x: 0, rotate_y: 0, rotate_z: 0, translate_x: 0, translate_y: 0, translate_z: 0, scale: 1, opacity: 0 } },
  TYPE_LOCKUP: { text: 'up', shape_delay: 0.15, shape_duration: 'motion.base', shape_stagger: 0.08, shape_color: 'color.accent', thickness: 'stroke.base' },
});
const SHAPE_KEYS = { line: ['id', 'kind', 'x1', 'y1', 'x2', 'y2', 'thickness', 'color'], rect: ['id', 'kind', 'left', 'right', 'top', 'bottom', 'fill', 'thickness', 'color'], circle: ['id', 'kind', 'center', 'r', 'fill', 'thickness', 'color'] };
const SHAPE_FIELDS = { line: { x1: 'x', y1: 'y', x2: 'x', y2: 'y' }, rect: { left: 'x', right: 'x', top: 'y', bottom: 'y' }, circle: { center: 'point' } };
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TAG_RE = /^[a-zA-Z0-9]{4}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r6 = (n) => Math.round(n * 1e6) / 1e6;
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
export const canonicalHash = (o) => sha256(JSON.stringify(canonical(o)));

/** Classe de aspecto e tamanho de um formato pedido, a partir do tamanho do spec (lado longo L). */
export function frameFor(spec, format = null) {
  const W = spec?.composition?.width; const H = spec?.composition?.height;
  if (!format) return { width: W, height: H };
  if (!FORMATS[format]) throw new HyperFramesSpecError([{ code: 'FORMAT_INVALID', path: 'format', message: `formato "${format}" inválido (16:9 | 9:16 | 1:1)`, backend: 'hyperframes' }]);
  const L = Math.max(W, H); const S = Math.round((L * 9) / 16 / 2) * 2;
  return format === '16:9' ? { width: L, height: S } : format === '9:16' ? { width: S, height: L } : { width: S, height: S };
}
export const aspectClass = (w, h) => (w / h > 1.2 ? 'landscape' : w / h < 0.83 ? 'portrait' : 'square');

/**
 * @param {object} spec        motion.spec (já validado no schema de autoria)
 * @param {object} ctx         { tokens (doc), fontManifest (doc), projectDir, format? ('16:9'|'9:16'|'1:1') }
 * @returns {object} plano bold.hyperframes.spec/0
 */
export function compileHyperFrames(spec, ctx) {
  const errors = [];
  const E = (code, p, message, pattern = null) => errors.push({ code, path: p, message, backend: 'hyperframes', ...(pattern ? { pattern } : {}) });
  const only = (obj, allowed, p, pattern) => { if (!isObj(obj)) return; for (const k of Object.keys(obj)) if (!allowed.includes(k)) E('UNSUPPORTED_PROPERTY', `${p}.${k}`, `propriedade não suportada${pattern ? ` por ${pattern}` : ''} (permitido: ${allowed.join(', ')})`, pattern); };

  // ── autoria / roteamento ──
  if (spec?.schema !== 'bold.motion.spec/0') E('SPEC_INVALID', 'schema', 'deve ser "bold.motion.spec/0"');
  if (spec?.decision?.backend !== 'hyperframes') E('BACKEND_MISMATCH', 'decision.backend', `o compilador HyperFrames exige decision.backend = "hyperframes" (recebido: ${JSON.stringify(spec?.decision?.backend)})`);
  const fps = spec?.brief?.fps; const frames = spec?.brief?.duration_frames;
  if (!(isNum(fps) && fps > 0 && fps <= 240)) E('SPEC_INVALID', 'brief.fps', '0 < fps ≤ 240');
  if (!(Number.isInteger(frames) && frames > 0)) E('SPEC_INVALID', 'brief.duration_frames', 'inteiro > 0');
  const c = spec?.composition;
  if (!isObj(c)) { E('SPEC_INVALID', 'composition', 'obrigatório'); throw new HyperFramesSpecError(errors); }
  only(c, COMPOSITION_KEYS, 'composition');
  let fatal = false;
  for (const k of ['width', 'height']) if (!(Number.isInteger(c[k]) && c[k] >= 16 && c[k] <= 8192 && c[k] % 2 === 0)) { E('SPEC_INVALID', `composition.${k}`, 'inteiro par entre 16 e 8192'); fatal = true; }
  if (fatal || !(isNum(fps) && Number.isInteger(frames))) throw new HyperFramesSpecError(errors);

  // ── tokens (biblioteca compartilhada) ──
  const { tokens: t, errors: terr } = resolveTokens(ctx?.tokens);
  if (!t) { for (const m of terr) E('TOKEN_ERROR', m.split(':')[0], m); throw new HyperFramesSpecError(errors); }
  const guard = (fn, p, fallback = null) => { try { return fn(); } catch (e) { E('TOKEN_ERROR', p, e instanceof TokenError ? e.message : String(e.message)); return fallback; } };

  // ── frame / formato ──
  const { width: W, height: H } = frameFor(spec, ctx?.format ?? null);
  const u = unit(W, H); const aspect = aspectClass(W, H);
  const transparent = c.transparent === undefined ? true : c.transparent;
  if (typeof transparent !== 'boolean') E('INVALID_VALUE', 'composition.transparent', 'boolean');
  let background = { type: 'none' };
  if (c.background !== undefined) {
    only(c.background, ['type', 'color'], 'composition.background');
    if (transparent) E('INVALID_VALUE', 'composition.background', 'transparent=true não aceita background (seria fundo assado)');
    else if (c.background.type !== 'solid') E('INVALID_VALUE', 'composition.background.type', '"solid"');
    else background = { type: 'solid', color: guard(() => refColor(t, c.background.color, 'background.color'), 'composition.background.color', '#000000') };
  } else if (!transparent) E('INVALID_VALUE', 'composition.background', 'opaco exige background {type:"solid", color}');
  const seed = c.seed === undefined ? 1 : c.seed;
  if (!Number.isInteger(seed)) E('INVALID_VALUE', 'composition.seed', 'inteiro');
  const safeA = c.safe_area ?? t.safe_area ?? 0.1;
  if (!isNum(safeA) || safeA < 0 || safeA > 0.4) E('INVALID_VALUE', 'composition.safe_area', '0..0.4');
  const safe = safeRect(W, H, isNum(safeA) ? safeA : 0.1);
  let g = null; let gridPlan = null;
  if (c.grid !== undefined) {
    only(c.grid, ['columns', 'rows', 'gutter'], 'composition.grid');
    const { columns: gc, rows: gr } = c.grid;
    if (!(Number.isInteger(gc) && gc >= 1 && gc <= 24 && Number.isInteger(gr) && gr >= 1 && gr <= 24)) E('INVALID_VALUE', 'composition.grid', 'columns/rows inteiros 1..24');
    else { const gut = guard(() => refSize(t, c.grid.gutter ?? 'space.1', 'grid.gutter'), 'composition.grid.gutter', 1) * u; g = makeGrid(safe, gc, gr, gut); gridPlan = { columns: gc, rows: gr, gutter_px: r6(gut) }; }
  }

  // ── fontes: manifesto obrigatório ──
  let fonts = [];
  if (typeof c.font_manifest !== 'string') E('FONT_MANIFEST_REQUIRED', 'composition.font_manifest', 'obrigatório para o HyperFrames: caminho relativo do bold.fonts.manifest/0 (fontes só por manifesto)');
  else if (/^[a-z]+:\/\//i.test(c.font_manifest)) E('EXTERNAL_URL', 'composition.font_manifest', 'URL externa proibida: manifesto local, relativo ao projeto');
  else if (path.isAbsolute(c.font_manifest) || c.font_manifest.split(/[\\/]/).includes('..')) E('FONT_MANIFEST_INVALID', 'composition.font_manifest', 'caminho relativo ao projeto, sem ".."');
  else {
    const doc = ctx?.fontManifest;
    if (!doc) E('FONT_MANIFEST_REQUIRED', 'composition.font_manifest', `manifesto não carregado: ${c.font_manifest}`);
    else {
      for (const [i, f] of (Array.isArray(doc.fonts) ? doc.fonts : []).entries()) if (typeof f?.file === 'string' && /^[a-z]+:\/\//i.test(f.file)) E('EXTERNAL_URL', `font_manifest.fonts[${i}].file`, 'URL externa proibida');
      try { fonts = loadFontManifest(ctx.projectDir, doc); } catch (e) { if (e instanceof FontGateError) for (const m of e.errors) E('FONT_MANIFEST_INVALID', 'font_manifest', m); else throw e; }
    }
  }
  const families = new Map();
  for (const f of fonts) {
    if (GENERIC.has(f.family.toLowerCase())) { E('GENERIC_FONT', 'font_manifest', `família genérica "${f.family}" proibida`); continue; }
    let info = null; try { info = inspectFont(f.abs); } catch (e) { E('FONT_UNREADABLE', `font_manifest:${f.family}`, e instanceof SfntError ? e.message : String(e.message)); }
    const wr = String(f.weight ?? '400').split(/\s+/).map(Number);
    (families.get(f.family) ?? families.set(f.family, []).get(f.family)).push({ ...f, info, wmin: wr[0], wmax: wr[1] ?? wr[0], fstyle: f.style ?? 'normal' });
  }

  // ── camadas ──
  if (!Array.isArray(c.layers) || !c.layers.length) E('SPEC_INVALID', 'composition.layers', 'lista com ≥ 1 camada');
  const layersIn = Array.isArray(c.layers) ? c.layers : [];
  const ids = new Set(); const usedFonts = new Map(); const layers = [];
  const timeF = (v, p, dflt) => guard(() => refTime(t, v ?? dflt, fps, p), p, 0);
  const em = (v, p, dflt) => { const x = v ?? dflt; if (!isNum(x)) { E('INVALID_VALUE', p, 'número (em)'); return 0; } return x; };
  const sizeU = (v, p) => guard(() => refSize(t, v, p), p, 1);

  layersIn.forEach((L, li) => {
    const p = `composition.layers[${li}]`;
    if (!isObj(L)) { E('SPEC_INVALID', p, 'objeto'); return; }
    const pattern = L.pattern;
    if (!TYPE_PATTERNS.includes(pattern)) { E('UNSUPPORTED_PATTERN', `${p}.pattern`, `o backend HyperFrames V1 aceita só ${TYPE_PATTERNS.join(', ')} (recebido: ${JSON.stringify(pattern)}); patterns comuns ficam no Remotion`); return; }
    const P = PATTERNS[pattern];
    only(L, P.shapes ? [...LAYER_KEYS, 'shapes'] : LAYER_KEYS, p, pattern);
    const id = L.id ?? `${pattern.toLowerCase()}_${li}`;
    if (!ID_RE.test(id)) E('INVALID_VALUE', `${p}.id`, `"${id}" inválido ([A-Za-z][A-Za-z0-9_-]{0,63})`, pattern);
    else if (ids.has(id)) E('INVALID_VALUE', `${p}.id`, `"${id}" duplicado`, pattern);
    ids.add(id);
    const content = isObj(L.content) ? L.content : {}; const style = isObj(L.style) ? L.style : {}; const motion = isObj(L.motion) ? L.motion : {};
    if (L.content !== undefined && !isObj(L.content)) E('INVALID_VALUE', `${p}.content`, 'objeto', pattern);
    only(content, P.content, `${p}.content`, pattern); only(style, P.style, `${p}.style`, pattern); only(motion, P.motion, `${p}.motion`, pattern);

    // responsive: só a classe do formato atual se aplica, mas TODAS são validadas
    const resp = L.responsive;
    let ov = {};
    if (resp !== undefined) {
      if (!isObj(resp)) E('INVALID_VALUE', `${p}.responsive`, 'objeto {landscape|portrait|square: {…}}', pattern);
      else { only(resp, ['landscape', 'portrait', 'square'], `${p}.responsive`, pattern); for (const [k, v] of Object.entries(resp)) { if (!isObj(v)) E('INVALID_VALUE', `${p}.responsive.${k}`, 'objeto', pattern); else only(v, P.responsive, `${p}.responsive.${k}`, pattern); } ov = isObj(resp[aspect]) ? resp[aspect] : {}; }
    }

    // texto
    const baseLines = P.content.includes('text') ? (typeof content.text === 'string' ? [content.text] : null) : (Array.isArray(content.lines) && content.lines.length && content.lines.every((s) => typeof s === 'string') ? content.lines : null);
    if (!baseLines || baseLines.some((s) => !s.length)) { E('INVALID_VALUE', `${p}.content.${P.content[0]}`, P.content[0] === 'text' ? 'string não vazia' : 'lista de strings não vazias', pattern); return; }
    let lines = baseLines;
    if (ov.lines !== undefined) {
      const norm = (a) => a.join(' ').replace(/\s+/g, ' ').trim();
      if (!Array.isArray(ov.lines) || !ov.lines.every((s) => typeof s === 'string' && s.length)) E('RESPONSIVE_INVALID', `${p}.responsive.${aspect}.lines`, 'lista de strings', pattern);
      else if (norm(ov.lines) !== norm(baseLines)) E('RESPONSIVE_INVALID', `${p}.responsive.${aspect}.lines`, 'só pode re-quebrar o MESMO texto (a intenção não muda por formato)', pattern);
      else lines = ov.lines;
    }
    if (lines.some((s) => /[\n\r\t]/.test(s))) E('INVALID_VALUE', `${p}.content`, 'quebras de linha só via lines[] (sem \\n/\\t)', pattern);

    // região / âncora / alinhamento
    const region = ov.region ?? L.region ?? DEFAULTS.layer.region;
    let box = safe;
    if (region === 'full') box = { x: 0, y: 0, w: W, h: H };
    else if (region === 'safe') box = safe;
    else if (isObj(region)) {
      only(region, ['col', 'row', 'span', 'rows'], `${p}.region`, pattern);
      if (!g) E('INVALID_VALUE', `${p}.region`, 'região de células exige composition.grid', pattern);
      else { const { col, row, span = 1, rows = 1 } = region; if (![col, row, span, rows].every(Number.isInteger) || col < 0 || row < 0 || span < 1 || rows < 1 || col + span > g.cols || row + rows > g.rows) E('INVALID_VALUE', `${p}.region`, `fora do grid (${g.cols}×${g.rows})`, pattern); else box = g.cell(col, row, span, rows); }
    } else E('INVALID_VALUE', `${p}.region`, '"full" | "safe" | {col,row,span,rows}', pattern);
    const anchor = ov.anchor ?? L.anchor ?? DEFAULTS.layer.anchor;
    if (!ANCHORS.includes(anchor)) E('INVALID_VALUE', `${p}.anchor`, ANCHORS.join(' | '), pattern);
    const align = ov.align ?? style.align ?? (String(anchor).endsWith('left') ? 'left' : String(anchor).endsWith('right') ? 'right' : 'center');
    if (!['left', 'center', 'right'].includes(align)) E('INVALID_VALUE', `${p}.style.align`, 'left | center | right', pattern);

    // estilo tipográfico
    const ftok = guard(() => refFont(t, style.font ?? DEFAULTS.style.font, `${p}.style.font`), `${p}.style.font`);
    const fam = ftok?.family;
    const fstyle = style.style ?? DEFAULTS.style.style;
    if (!['normal', 'italic'].includes(fstyle)) E('INVALID_VALUE', `${p}.style.style`, 'normal | italic', pattern);
    const weight = style.weight ?? (isNum(Number(ftok?.weight)) ? Number(ftok.weight) : 400);
    if (!(Number.isInteger(weight) && weight >= 1 && weight <= 1000)) E('INVALID_VALUE', `${p}.style.weight`, 'inteiro 1..1000', pattern);
    let face = null;
    if (fam && GENERIC.has(fam.toLowerCase())) E('GENERIC_FONT', `${p}.style.font`, `família genérica "${fam}" = fallback proibido`, pattern);
    else if (fam) {
      const cands = families.get(fam);
      if (!cands) { if (fonts.length || ctx?.fontManifest) E('FONT_NOT_IN_MANIFEST', `${p}.style.font`, `família "${fam}" (token ${style.font ?? DEFAULTS.style.font}) não está no manifesto de fontes`, pattern); }
      else {
        face = cands.find((f) => f.fstyle === fstyle && weight >= f.wmin && weight <= f.wmax) ?? null;
        if (!face) E('FONT_NOT_IN_MANIFEST', `${p}.style.weight`, `nenhuma face de "${fam}" no manifesto cobre ${fstyle} ${weight}`, pattern);
        else if (face.info) {
          const wa = face.info.axes.wght;
          if (face.wmin !== face.wmax && !wa) E('FONT_FEATURE_UNAVAILABLE', `${p}.style.weight`, `manifesto declara faixa de peso ${face.wmin}–${face.wmax}, mas a fonte não tem eixo wght`, pattern);
          if (wa && (weight < wa.min || weight > wa.max)) E('FONT_FEATURE_UNAVAILABLE', `${p}.style.weight`, `peso ${weight} fora do eixo wght da fonte (${wa.min}–${wa.max})`, pattern);
          const missing = [...new Set(lines.join(''))].filter((ch) => ch !== ' ' && !face.info.covers(ch.codePointAt(0)));
          if (missing.length) E('GLYPH_MISSING', `${p}.content`, `caracteres fora da fonte "${fam}" (seria fallback do sistema): ${missing.join(' ')}`, pattern);
        }
      }
    }
    let features = {};
    if (style.features !== undefined) {
      if (!isObj(style.features)) E('INVALID_VALUE', `${p}.style.features`, 'objeto {tag: 0|1}', pattern);
      else for (const [k, v] of Object.entries(style.features)) {
        if (!TAG_RE.test(k) || (v !== 0 && v !== 1)) E('INVALID_VALUE', `${p}.style.features.${k}`, 'tag OpenType de 4 caracteres → 0 | 1', pattern);
        else if (face?.info && !face.info.features.includes(k)) E('FONT_FEATURE_UNAVAILABLE', `${p}.style.features.${k}`, `feature "${k}" inexistente na fonte "${fam}" (seria ignorada)`, pattern);
        else features[k] = v;
      }
    }
    let variation = {};
    if (style.variation !== undefined) {
      if (!isObj(style.variation)) E('INVALID_VALUE', `${p}.style.variation`, 'objeto {eixo: número}', pattern);
      else for (const [k, v] of Object.entries(style.variation)) {
        const ax = face?.info?.axes?.[k];
        if (!TAG_RE.test(k) || !isNum(v)) E('INVALID_VALUE', `${p}.style.variation.${k}`, 'eixo de 4 caracteres → número', pattern);
        else if (k === 'wght') E('INVALID_VALUE', `${p}.style.variation.wght`, 'use style.weight (o eixo wght é controlado pelo peso)', pattern);
        else if (face?.info && !ax) E('FONT_FEATURE_UNAVAILABLE', `${p}.style.variation.${k}`, `eixo "${k}" inexistente na fonte "${fam}" (seria ignorado)`, pattern);
        else if (ax && (v < ax.min || v > ax.max)) E('FONT_FEATURE_UNAVAILABLE', `${p}.style.variation.${k}`, `fora do eixo (${ax.min}–${ax.max})`, pattern);
        else variation[k] = v;
      }
    }
    const sizeSpec = ov.size ?? style.size ?? DEFAULTS.style.size;
    let size = null;
    if (isObj(sizeSpec)) {
      only(sizeSpec, ['fit', 'max', 'min'], `${p}.style.size`, pattern);
      if (sizeSpec.fit !== 'width') E('INVALID_VALUE', `${p}.style.size.fit`, '"width" (maior tamanho que cabe na largura da região)', pattern);
      size = { fit: { max_px: r6(sizeU(sizeSpec.max ?? 'type.4', `${p}.style.size.max`) * u), min_px: r6(sizeU(sizeSpec.min ?? 1, `${p}.style.size.min`) * u), width_px: r6(box.w) } };
      if (sizeSpec.max === undefined) E('INVALID_VALUE', `${p}.style.size.max`, 'obrigatório com fit (teto explícito)', pattern);
    } else size = { px: r6(sizeU(sizeSpec, `${p}.style.size`) * u) };
    const tracking = P.style.includes('tracking') ? em(style.tracking, `${p}.style.tracking`, DEFAULTS.style.tracking) : 0;
    const lineHeight = P.style.includes('line_height') ? (style.line_height ?? DEFAULTS.style.line_height) : 1;
    if (!(isNum(lineHeight) && lineHeight > 0.5 && lineHeight <= 3)) E('INVALID_VALUE', `${p}.style.line_height`, 'número 0.5..3 (× tamanho)', pattern);
    const color = guard(() => refColor(t, style.color ?? DEFAULTS.style.color, `${p}.style.color`), `${p}.style.color`, '#000000');
    if (face) usedFonts.set(`${face.family}|${face.file}`, face);

    // tempo
    const inF = timeF(L.in, `${p}.in`, 0); const outF = L.out === undefined ? frames : timeF(L.out, `${p}.out`, 0);
    if (!(inF >= 0 && outF > inF && outF <= frames + 1e-9)) E('INVALID_VALUE', `${p}.out`, `intervalo [in,out) deve caber em 0..${frames} frames`, pattern);
    const enterF = timeF(motion.enter, `${p}.motion.enter`, DEFAULTS.motion.enter);
    const delayF = timeF(motion.delay, `${p}.motion.delay`, DEFAULTS.motion.delay);
    const ease = guard(() => refEase(t, motion.ease ?? DEFAULTS.motion.ease, `${p}.motion.ease`), `${p}.motion.ease`, [0, 0, 1, 1]);
    if (motion.exit_ease !== undefined && motion.exit === undefined) E('UNSUPPORTED_PROPERTY', `${p}.motion.exit_ease`, 'só com motion.exit (seria ignorado)', pattern);
    const exitF = motion.exit === undefined ? 0 : timeF(motion.exit, `${p}.motion.exit`, 0);
    const exitEase = guard(() => refEase(t, motion.exit_ease ?? (t.motion.ease.in ? 'ease.in' : DEFAULTS.motion.ease), `${p}.motion.exit_ease`), `${p}.motion.exit_ease`, [0, 0, 1, 1]);
    if (inF + delayF + enterF + exitF > outF + 1e-9) E('INVALID_VALUE', `${p}.motion`, 'delay + enter + exit não cabem em [in,out)', pattern);
    const m = { enter_f: r6(enterF), delay_f: r6(delayF), ease, exit_f: r6(exitF), exit_ease: exitEase };

    const out = { id, pattern, z: Number.isInteger(L.z) ? L.z : DEFAULTS.layer.z, index: li, in_f: r6(inF), out_f: r6(outF), box: { x: r6(box.x), y: r6(box.y), w: r6(box.w), h: r6(box.h) },
      anchor, align, lines, chars_total: lines.reduce((s, x) => s + [...x].length, 0), seed: hashSeed(seed, id),
      style: { family: fam ?? null, weight, style: fstyle, size, tracking_em: tracking, line_height: lineHeight, color, features, variation }, motion: m };
    if (L.z !== undefined && !Number.isInteger(L.z)) E('INVALID_VALUE', `${p}.z`, 'inteiro', pattern);
    const D = DEFAULTS[pattern];
    const pick = (obj, keys, dflt, pp) => { if (obj !== undefined && !isObj(obj)) { E('INVALID_VALUE', pp, 'objeto', pattern); return { ...dflt }; } only(obj ?? {}, keys, pp, pattern); const r = { ...dflt }; for (const k of keys) if (obj?.[k] !== undefined) { if (!isNum(obj[k])) E('INVALID_VALUE', `${pp}.${k}`, 'número', pattern); else r[k] = obj[k]; } return r; };
    const stag = () => timeF(motion.stagger, `${p}.motion.stagger`, t.motion.stagger);

    if (pattern === 'TYPE_CASCADE') {
      for (const k of ['liga', 'clig', 'dlig', 'calt', 'rlig']) if (features[k] === 1) E('UNSUPPORTED_PROPERTY', `${p}.style.features.${k}`, 'ligaduras/alternativas contextuais quebram o split por caractere (seriam perdidas)', pattern);
      const order = motion.order ?? D.order;
      if (!['start', 'end', 'center'].includes(order)) E('INVALID_VALUE', `${p}.motion.order`, 'start | end | center', pattern);
      const from = pick(motion.from, ['x', 'y', 'rotate', 'scale', 'opacity'], D.from, `${p}.motion.from`);
      if (from.opacity < 0 || from.opacity > 1) E('INVALID_VALUE', `${p}.motion.from.opacity`, '0..1', pattern);
      Object.assign(m, { stagger_f: r6(stag()), order, from, variation: pick(motion.variation, ['x', 'y', 'rotate', 'scale'], D.variation, `${p}.motion.variation`) });
    } else if (pattern === 'TYPE_MASK_LINES') {
      const direction = motion.direction ?? D.direction; const distance = motion.distance ?? D.distance; const fade = motion.fade ?? D.fade;
      if (!['up', 'down'].includes(direction)) E('INVALID_VALUE', `${p}.motion.direction`, 'up | down', pattern);
      if (!(isNum(distance) && distance > 0 && distance <= 1.5)) E('INVALID_VALUE', `${p}.motion.distance`, '0 < d ≤ 1.5 (× altura da janela)', pattern);
      if (typeof fade !== 'boolean') E('INVALID_VALUE', `${p}.motion.fade`, 'boolean', pattern);
      Object.assign(m, { stagger_f: r6(stag()), direction, distance, fade });
    } else if (pattern === 'TYPE_TRACK') {
      const from = em(motion.tracking_from, `${p}.motion.tracking_from`, D.tracking_from); const to = em(motion.tracking_to, `${p}.motion.tracking_to`, D.tracking_to); const fade = motion.fade ?? D.fade;
      if (typeof fade !== 'boolean') E('INVALID_VALUE', `${p}.motion.fade`, 'boolean', pattern);
      if (from === to) E('INVALID_VALUE', `${p}.motion`, 'tracking_from = tracking_to: nada a animar', pattern);
      Object.assign(m, { tracking_from_em: from, tracking_to_em: to, fade });
      out.style.tracking_em = to; // repouso (âncoras)
    } else if (pattern === 'TYPE_PLANE') {
      const S = pick(Object.fromEntries(Object.entries(style).filter(([k]) => PLANE_STYLE.includes(k) && !['plate', 'origin'].includes(k))), ['padding', 'perspective', 'rotate_x', 'rotate_y', 'rotate_z', 'translate_z', 'scale'], { padding: D.padding, perspective: D.perspective, rotate_x: D.rotate_x, rotate_y: D.rotate_y, rotate_z: D.rotate_z, translate_z: D.translate_z, scale: D.scale }, `${p}.style`);
      const persp = ov.perspective ?? S.perspective;
      if (!(isNum(persp) && persp > 0)) E('INVALID_VALUE', `${p}.style.perspective`, 'número > 0 (u)', pattern);
      const origin = style.origin ?? D.origin;
      if (!(Array.isArray(origin) && origin.length === 2 && origin.every((v) => isNum(v) && v >= 0 && v <= 1))) E('INVALID_VALUE', `${p}.style.origin`, '[x, y] frações 0..1 do plano', pattern);
      const plate = style.plate === undefined ? null : guard(() => refColor(t, style.plate, `${p}.style.plate`), `${p}.style.plate`, null);
      out.plane = { perspective_px: r6(persp * u), origin, rotate_x: S.rotate_x, rotate_y: S.rotate_y, rotate_z: S.rotate_z, translate_z_px: r6(S.translate_z * u), scale: S.scale, padding_em: S.padding, plate };
      const from = pick(motion.from, PLANE_FROM, D.from, `${p}.motion.from`);
      Object.assign(m, { from: { ...from, translate_x_px: r6(from.translate_x * u), translate_y_px: r6(from.translate_y * u), translate_z_px: r6(from.translate_z * u) } });
      for (const k of ['translate_x', 'translate_y', 'translate_z']) delete m.from[k];
    } else if (pattern === 'TYPE_LOCKUP') {
      const textMode = motion.text ?? D.text;
      if (!['up', 'fade', 'none'].includes(textMode)) E('INVALID_VALUE', `${p}.motion.text`, 'up | fade | none', pattern);
      Object.assign(m, { text: textMode, shape_delay_f: r6(timeF(motion.shape_delay, `${p}.motion.shape_delay`, D.shape_delay)), shape_duration_f: r6(timeF(motion.shape_duration, `${p}.motion.shape_duration`, D.shape_duration)), shape_stagger_f: r6(timeF(motion.shape_stagger, `${p}.motion.shape_stagger`, D.shape_stagger)) });
      out.shapes = [];
      if (L.shapes !== undefined && !(Array.isArray(L.shapes) && L.shapes.length)) E('INVALID_VALUE', `${p}.shapes`, 'lista com ≥ 1 forma', pattern);
      const sids = new Set();
      (Array.isArray(L.shapes) ? L.shapes : []).forEach((s, si) => {
        const sp = `${p}.shapes[${si}]`;
        if (!isObj(s) || !SHAPE_KEYS[s.kind]) { E('INVALID_VALUE', `${sp}.kind`, 'line | rect | circle', pattern); return; }
        only(s, SHAPE_KEYS[s.kind], sp, pattern);
        if (!ID_RE.test(s.id ?? '')) { E('INVALID_VALUE', `${sp}.id`, 'id obrigatório ([A-Za-z][A-Za-z0-9_-]{0,63})', pattern); return; }
        if (sids.has(s.id)) E('INVALID_VALUE', `${sp}.id`, `"${s.id}" duplicado`, pattern); sids.add(s.id);
        const geom = {};
        for (const [field, type] of Object.entries(SHAPE_FIELDS[s.kind])) {
          const ex = s[field];
          if (!isObj(ex) || typeof ex.ref !== 'string') { E('INVALID_VALUE', `${sp}.${field}`, `expressão {ref, offset?} obrigatória (sem coordenadas mágicas)`, pattern); continue; }
          only(ex, ['ref', 'offset'], `${sp}.${field}`, pattern);
          const offs = type === 'point' ? (ex.offset === undefined ? [{ px: 0 }, { px: 0 }] : Array.isArray(ex.offset) && ex.offset.length === 2 ? ex.offset.map(parseOffset) : [null]) : [parseOffset(ex.offset)];
          if (offs.some((o) => o === null)) { E('INVALID_VALUE', `${sp}.${field}.offset`, type === 'point' ? '[dx, dy] com número (u) | "Nem" | "Npx"' : 'número (u) | "Nem" | "Npx"', pattern); continue; }
          geom[field] = { ref: ex.ref, type, offset: offs.map((o) => ({ px: r6((o.px ?? 0) + (o.u ?? 0) * u), em: o.em ?? 0 })) };
        }
        const thick = s.thickness ?? DEFAULTS.TYPE_LOCKUP.thickness;
        const thickness = typeof thick === 'string' && /em$/.test(thick) ? { px: 0, em: Number(thick.slice(0, -2)) } : { px: r6(sizeU(thick, `${sp}.thickness`) * u), em: 0 };
        if (Number.isNaN(thickness.em)) E('INVALID_VALUE', `${sp}.thickness`, 'número (u) | stroke.X | "Nem"', pattern);
        let r = null;
        if (s.kind === 'circle') { const rr = typeof s.r === 'string' && /em$/.test(s.r) ? { px: 0, em: Number(s.r.slice(0, -2)) } : s.r === undefined ? null : { px: r6(sizeU(s.r, `${sp}.r`) * u), em: 0 }; if (!rr) E('INVALID_VALUE', `${sp}.r`, 'raio obrigatório (u | "Nem")', pattern); r = rr; }
        if (s.fill !== undefined && typeof s.fill !== 'boolean') E('INVALID_VALUE', `${sp}.fill`, 'boolean', pattern);
        if (s.kind === 'line' && s.fill !== undefined) E('UNSUPPORTED_PROPERTY', `${sp}.fill`, 'linha não tem preenchimento', pattern);
        out.shapes.push({ id: s.id, kind: s.kind, geom, thickness, ...(r ? { r } : {}), fill: s.kind === 'line' ? false : (s.fill ?? s.kind !== 'rect'), color: guard(() => refColor(t, s.color ?? D.shape_color, `${sp}.color`), `${sp}.color`, '#000000') });
      });
      if (!out.shapes.length && L.shapes === undefined) E('INVALID_VALUE', `${p}.shapes`, 'TYPE_LOCKUP exige ≥ 1 forma (sem formas use TYPE_MASK_LINES)', pattern);
    }
    layers.push(out);
  });

  // ── referências: validação estática + ordem topológica (ciclos → FAIL) ──
  const byId = new Map(layers.map((L) => [L.id, L]));
  const edges = []; const deps = new Map();
  for (const L of layers) for (const s of L.shapes ?? []) {
    const node = `${L.id}.shape.${s.id}`; deps.set(node, new Set());
    for (const [field, ex] of Object.entries(s.geom)) {
      const pp = `composition.layers[${L.index}].shapes[${L.shapes.indexOf(s)}].${field}`;
      const R = parseTextRef(ex.ref);
      if (!R) { E('REF_SYNTAX', pp, `referência inválida "${ex.ref}"`, L.pattern); continue; }
      const T = byId.get(R.layer);
      if (!T) { E('REF_MISSING_LAYER', pp, `camada "${R.layer}" não existe`, L.pattern); continue; }
      if (T.pattern === 'TYPE_PLANE') { E('REF_IMPOSSIBLE', pp, `"${ex.ref}": TYPE_PLANE é projetado em perspectiva e não expõe âncoras em frame space`, L.pattern); continue; }
      if (R.scope === 'line' && R.index >= T.lines.length) { E('REF_INDEX', pp, `linha ${R.index} não existe em "${T.id}" (${T.lines.length} linha(s) neste formato)`, L.pattern); continue; }
      if (R.scope === 'char' && R.index >= T.chars_total) { E('REF_INDEX', pp, `caractere ${R.index} não existe em "${T.id}" (${T.chars_total} caracteres, sem quebras)`, L.pattern); continue; }
      if (R.scope === 'shape') {
        const S = (T.shapes ?? []).find((x) => x.id === R.shape);
        if (!S) { E('REF_MISSING_LAYER', pp, `forma "${R.shape}" não existe em "${T.id}"`, L.pattern); continue; }
        deps.get(node).add(`${T.id}.shape.${S.id}`);
      }
      if ((/^ink\.|^center$/.test(R.metric)) && R.scope !== 'shape' && (Object.keys(T.style.features).some((k) => !['kern', 'tnum', 'pnum', 'lnum', 'onum', 'case', 'zero'].includes(k)) || Object.keys(T.style.variation).length)) { E('REF_IMPOSSIBLE', pp, `"${ex.ref}": tinta não é mensurável com features de substituição/eixos variáveis em "${T.id}" (use baseline/advance/origin)`, L.pattern); continue; }
      if (ex.type !== R.type) { E('REF_INCOMPATIBLE', pp, `"${ex.ref}" é do tipo ${R.type}; o campo ${field} exige ${ex.type}${R.type === 'point' ? ' (use .x ou .y)' : ''}`, L.pattern); continue; }
      edges.push({ from: `${node}.${field}`, to: ex.ref });
    }
  }
  const order = []; const state = new Map();
  const visit = (n, stack) => {
    if (state.get(n) === 2) return; if (state.get(n) === 1) { E('REF_CIRCULAR', n, `referência circular: ${[...stack, n].join(' → ')}`); return; }
    state.set(n, 1); for (const d of deps.get(n) ?? []) visit(d, [...stack, n]); state.set(n, 2); order.push(n);
  };
  for (const n of deps.keys()) visit(n, []);

  if (errors.length) throw new HyperFramesSpecError(errors);
  layers.sort((a, b) => a.z - b.z || a.index - b.index);
  const plan = {
    schema: 'bold.hyperframes.spec/0', plan_version: PLAN_VERSION, backend: 'hyperframes', backend_version: BACKEND_VERSION,
    source: { spec_id: spec.id, spec_sha256: canonicalHash(spec), tokens_sha256: canonicalHash(ctx.tokens), font_manifest: c.font_manifest },
    composition: { id: spec.id, width: W, height: H, fps, frames, duration_s: r6(frames / fps), transparent, background, seed, u: r6(u), aspect_class: aspect, format: ctx?.format ?? null,
      safe: { x: r6(safe.x), y: r6(safe.y), w: r6(safe.w), h: r6(safe.h) }, grid: gridPlan },
    fonts: [...usedFonts.values()].sort((a, b) => (a.family + a.file).localeCompare(b.family + b.file)).map((f) => ({ family: f.family, file: f.file, sha256: f.sha256, weight: f.wmin === f.wmax ? String(f.wmin) : `${f.wmin} ${f.wmax}`, style: f.fstyle })),
    layers: layers.map(({ index, ...L }) => L),
    references: { order, edges },
    assets: [],
    seed,
  };
  const perr = validatePlan(plan);
  if (perr.length) throw new HyperFramesSpecError(perr);
  return plan;
}

/** Validação do PLANO COMPILADO (separada da validação de autoria). */
export function validatePlan(plan) {
  return validateSchema(PLAN_SCHEMA, plan).map((e) => { const i = e.indexOf(': '); return { code: 'PLAN_INVALID', path: i > 0 ? e.slice(0, i) : '$', message: i > 0 ? e.slice(i + 2) : e, backend: 'hyperframes' }; });
}

/** Carrega tokens + manifesto (relativos ao diretório do spec) e compila. Erros de I/O viram erros tipados. */
export function compileFromFiles(spec, { specDir, format = null }) {
  const errs = [];
  const E = (code, p, message) => errs.push({ code, path: p, message, backend: 'hyperframes' });
  const rel = (v, p) => { if (typeof v !== 'string') { E(p === 'tokens' ? 'TOKENS_MISSING' : 'FONT_MANIFEST_REQUIRED', p, 'caminho relativo obrigatório'); return null; } if (/^[a-z]+:\/\//i.test(v)) { E('EXTERNAL_URL', p, 'URL externa proibida'); return null; } if (path.isAbsolute(v) || v.split(/[\\/]/).includes('..')) { E('PATH_INVALID', p, 'relativo e sem ".."'); return null; } const f = path.join(specDir, v); if (!fs.existsSync(f)) { E(p === 'tokens' ? 'TOKENS_MISSING' : 'FONT_MANIFEST_REQUIRED', p, `não encontrado: ${v}`); return null; } return f; };
  const tf = rel(spec?.tokens, 'tokens'); const mf = spec?.composition?.font_manifest === undefined ? null : rel(spec.composition.font_manifest, 'composition.font_manifest');
  const read = (f, p) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { E('JSON_INVALID', p, e.message); return null; } };
  const tokens = tf ? read(tf, 'tokens') : null; const fontManifest = mf ? read(mf, 'composition.font_manifest') : null;
  if (errs.length) throw new HyperFramesSpecError(errs);
  return compileHyperFrames(spec, { tokens, fontManifest, projectDir: specDir, format });
}
