// SPEC → RENDER PLAN. Subconjunto REAL e ESTRITO do motion.spec (bold.motion.spec/0, bloco `composition`).
// Qualquer propriedade não suportada → erro explícito (nunca ignorada em silêncio).
// O plano é JSON puro (px e frames resolvidos) e é o inputProps da composição Remotion.

import { refColor, refEase, refFont, refShadow, refSize, refTime, resolveTokens, TokenError, type ResolvedTokens } from './tokens.ts';
import { grid as makeGrid, safeRect, unit, ANCHORS, type Rect, type Anchor } from './layout.ts';
import { requiredOverscan, renderTimes, type CamKey } from './camera.ts';
import { subframeTime, type Bezier } from './animation.ts';
import { ID_RE, parseRef, regionToFrame, boxPoint, type Pt } from './space.ts';

export const PLAN_VERSION = 2; // R5.6: overscan por camada full-bleed + coordenadas resolvidas em frame space

export const PATTERNS = ['TITLE_REVEAL', 'LOWER_THIRD', 'CARD_BUILD', 'IMAGE_REVEAL', 'STAT_COUNTER', 'MAP_PATH', 'CALLOUT', 'SECTION_TRANSITION', 'SHAPE', 'GRID_LINES'] as const;
export type Pattern = typeof PATTERNS[number];

const REVEALS = ['up', 'down', 'left', 'right', 'fade', 'scale'] as const;
const COMPOSITION_KEYS = ['width', 'height', 'transparent', 'seed', 'background', 'texture', 'safe_area', 'grid', 'camera', 'motion_blur', 'layers'];
const LAYER_KEYS = ['id', 'pattern', 'in', 'out', 'depth', 'z', 'region', 'anchor', 'full_bleed', 'content', 'style', 'motion'];
/** Patterns que podem ser FULL-BLEED (cobrem o viewport inteiro e recebem overscan da câmera). */
const FULL_BLEED_OK = ['IMAGE_REVEAL', 'SHAPE', 'SECTION_TRANSITION'];
const MOTION_COMMON = ['enter', 'exit', 'ease', 'exit_ease', 'delay'];
/** Chaves de motion que CADA pattern realmente usa (R5.5: nada aceito sem efeito). */
const PATTERN_MOTION: Record<string, string[]> = {
  TITLE_REVEAL: ['stagger', 'reveal', 'split'], LOWER_THIRD: ['stagger', 'reveal'], CARD_BUILD: ['stagger', 'reveal'], IMAGE_REVEAL: ['stagger', 'reveal'],
  STAT_COUNTER: ['stagger', 'reveal', 'spring'], MAP_PATH: [], CALLOUT: ['stagger', 'reveal'], SECTION_TRANSITION: ['stagger', 'reveal'], SHAPE: ['reveal'], GRID_LINES: ['stagger'],
};
/** Patterns que usam `anchor` (os demais preenchem a região inteira). */
const ANCHORED = ['TITLE_REVEAL', 'LOWER_THIRD', 'STAT_COUNTER', 'CALLOUT'];
/** Reveal padrão por pattern (contador entra por fade; o resto por máscara para cima). */
const DEFAULT_REVEAL: Record<string, string> = { STAT_COUNTER: 'fade' };

/** Chaves permitidas por pattern: content / style. Tipos de style: c=cor, s=tamanho(u), f=fonte, e=enum/bool/num livre. */
const PATTERN_DEF: Record<Pattern, { content: string[]; style: Record<string, 'c' | 's' | 'f' | 'x' | 'h' | 'n' | 'b' | 'e'> }> = {
  TITLE_REVEAL: { content: ['title', 'kicker', 'subtitle'],
    style: { font_title: 'f', font_body: 'f', size_title: 's', size_body: 's', size_kicker: 's', color: 'c', color_body: 'c', accent: 'c', tracking: 'n', tracking_from: 'n', case: 'e', rule: 'e', line_height: 'n' } },
  LOWER_THIRD: { content: ['name', 'role'],
    style: { font: 'f', font_role: 'f', size_name: 's', size_role: 's', color: 'c', color_role: 'c', plate: 'c', accent: 'c', radius: 's', rule: 'e', tracking: 'n', case: 'e' } },
  CARD_BUILD: { content: ['items'],
    style: { font: 'f', font_body: 'f', size_title: 's', size_body: 's', color: 'c', color_body: 'c', plate: 'c', radius: 's', shadow: 'h', stroke: 'c', stroke_width: 's', gap: 's', direction: 'e', paper: 'b', accent: 'c' } },
  IMAGE_REVEAL: { content: ['src', 'caption'],
    style: { fit: 'e', focus: 'x', radius: 's', shadow: 'h', paper: 'b', from: 'c', to: 'c', zoom_from: 'n', zoom_to: 'n', font: 'f', size_caption: 's', color: 'c' } },
  STAT_COUNTER: { content: ['value', 'from', 'decimals', 'prefix', 'suffix', 'label', 'locale'],
    style: { font: 'f', font_label: 'f', size_value: 's', size_label: 's', color: 'c', color_label: 'c', accent: 'c', tracking: 'n' } },
  MAP_PATH: { content: ['points', 'markers'],
    style: { color: 'c', width: 's', dash: 'b', marker: 'c', font: 'f', size_label: 's', label_color: 'c', grid: 'b', grid_color: 'c' } },
  CALLOUT: { content: ['text', 'target'],
    style: { font: 'f', size: 's', color: 'c', accent: 'c', stroke_width: 's', plate: 'c', radius: 's' } },
  SECTION_TRANSITION: { content: [], style: { color: 'c', color_2: 'c' } },
  SHAPE: { content: ['shape', 'at', 'size'], style: { color: 'c', fill: 'b', stroke_width: 's', radius: 's', shadow: 'h' } },
  GRID_LINES: { content: [], style: { color: 'c', opacity: 'n', width: 's' } },
};

const ENUMS: Record<string, readonly string[]> = {
  case: ['upper', 'none'], rule: ['none', 'top', 'left', 'under'], direction: ['row', 'column'],
  fit: ['cover', 'contain'], split: ['line', 'word', 'char'], shape: ['rect', 'circle', 'line', 'ring'],
};

export class SpecError extends Error {
  errors: string[];
  constructor(errors: string[]) { super(`spec inválido:\n  - ${errors.join('\n  - ')}`); this.errors = errors; this.name = 'SpecError'; }
}

export interface PlanLayer {
  id: string; pattern: Pattern; inF: number; outF: number; enterF: number; exitF: number; delayF: number; staggerF: number;
  ease: Bezier; exitEase: Bezier; reveal: typeof REVEALS[number]; split: 'line' | 'word' | 'char'; spring: boolean;
  depth: number; z: number; box: Rect; anchor: Anchor; content: Record<string, any>; style: Record<string, any>;
  fullBleed: boolean; overscan: number;
}
export interface Plan {
  version: number; id: string; width: number; height: number; fps: number; frames: number; u: number;
  transparent: boolean; seed: number; sub: number; shutter: number;
  background: { type: 'none' | 'solid' | 'gradient'; color?: string; from?: string; to?: string; angle?: number };
  grain: number; safe: Rect; grid: { cols: number; rows: number; gutter: number } | null;
  camera: { keys: CamKey[] };
  layers: PlanLayer[];
  fonts: { family: string; weight: number | string; asset: string }[];
  assets: { kind: 'image' | 'font'; ref: string; layer: string | null }[];
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
function onlyKeys(obj: any, allowed: string[], path: string, errors: string[]) {
  if (!isObj(obj)) return;
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path}.${k}: propriedade não suportada neste subset`);
}

type PointSpec = { kind: 'frame' | 'safe'; x: number; y: number } | { kind: 'ref'; ref: string };

/** Ponto: [x,y] (fração do QUADRO) | {space:"frame"|"safe", x, y} | {ref:"<layer>.…"}. Qualquer outra forma → FAIL. */
function checkPointSpec(v: any, path: string, errors: string[]): PointSpec | null {
  const n01 = (a: any) => typeof a === 'number' && a >= 0 && a <= 1;
  if (Array.isArray(v)) {
    if (v.length === 2 && n01(v[0]) && n01(v[1])) return { kind: 'frame', x: v[0], y: v[1] };
    errors.push(`${path}: [x, y] com valores 0..1 (fração do quadro)`); return null;
  }
  if (isObj(v) && 'ref' in v) {
    onlyKeys(v, ['ref'], path, errors);
    if (typeof v.ref !== 'string' || !parseRef(v.ref)) { errors.push(`${path}.ref: referência inválida "${String(v.ref)}"`); return null; }
    return { kind: 'ref', ref: v.ref };
  }
  if (isObj(v) && 'space' in v) {
    onlyKeys(v, ['space', 'x', 'y'], path, errors);
    if (!['frame', 'safe'].includes(v.space)) { errors.push(`${path}.space: frame | safe`); return null; }
    if (!n01(v.x) || !n01(v.y)) { errors.push(`${path}: x, y em 0..1`); return null; }
    return { kind: v.space, x: v.x, y: v.y };
  }
  errors.push(`${path}: obrigatório — [x, y] | {space, x, y} | {ref}`); return null;
}

export function buildPlan(spec: any, tokensDoc: any): Plan {
  const errors: string[] = [];
  const { tokens, errors: terr } = resolveTokens(tokensDoc);
  if (!tokens) throw new SpecError(terr);
  const t = tokens as ResolvedTokens;
  const guard = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch (e) { errors.push(e instanceof TokenError ? `composition.${e.message}` : String((e as Error).message)); return fallback; } };

  if (spec?.schema !== 'bold.motion.spec/0') errors.push('schema: deve ser "bold.motion.spec/0"');
  const fps = spec?.brief?.fps; const frames = spec?.brief?.duration_frames;
  if (!(typeof fps === 'number' && fps > 0 && fps <= 240)) errors.push('brief.fps: obrigatório (0 < fps ≤ 240)');
  if (!(Number.isInteger(frames) && frames > 0)) errors.push('brief.duration_frames: inteiro > 0');
  const c = spec?.composition;
  if (!isObj(c)) throw new SpecError([...errors, 'composition: obrigatório para render (subset R5)']);
  onlyKeys(c, COMPOSITION_KEYS, 'composition', errors);
  const W = c.width; const H = c.height;
  if (!(Number.isInteger(W) && W >= 16 && W <= 8192 && W % 2 === 0)) errors.push('composition.width: inteiro par entre 16 e 8192');
  if (!(Number.isInteger(H) && H >= 16 && H <= 8192 && H % 2 === 0)) errors.push('composition.height: inteiro par entre 16 e 8192');
  if (errors.some((e) => /^(composition\.(width|height)|brief\.)/.test(e))) throw new SpecError(errors);
  const u = unit(W, H);
  const transparent = c.transparent === true;
  if (c.transparent !== undefined && typeof c.transparent !== 'boolean') errors.push('composition.transparent: boolean');

  // background
  let background: Plan['background'] = { type: transparent ? 'none' : 'solid', color: transparent ? undefined : (t.color.background ?? '#FFFFFF') };
  if (c.background !== undefined) {
    onlyKeys(c.background, ['type', 'color', 'from', 'to', 'angle'], 'composition.background', errors);
    const bt = c.background.type;
    if (!['none', 'solid', 'gradient'].includes(bt)) errors.push('composition.background.type: none | solid | gradient');
    else if (transparent && bt !== 'none') errors.push('composition.background: transparent=true exige background.type="none" (nada de fundo assado)');
    else if (bt === 'solid') background = { type: 'solid', color: guard(() => refColor(t, c.background.color, 'background.color'), '#000000') };
    else if (bt === 'gradient') background = { type: 'gradient', from: guard(() => refColor(t, c.background.from, 'background.from'), '#000000'), to: guard(() => refColor(t, c.background.to, 'background.to'), '#000000'), angle: typeof c.background.angle === 'number' ? c.background.angle : 180 };
    else background = { type: 'none' };
  }
  if (!transparent && background.type === 'none') errors.push('composition.background: opaco exige background solid ou gradient');

  // texture
  let grain = transparent ? 0 : t.texture.grain; // grão dos tokens só vale para quadro opaco
  if (c.texture !== undefined) {
    onlyKeys(c.texture, ['grain'], 'composition.texture', errors);
    if (typeof c.texture.grain !== 'number' || c.texture.grain < 0 || c.texture.grain > 1) errors.push('composition.texture.grain: 0..1');
    else grain = c.texture.grain;
  }
  if (transparent && grain > 0) errors.push('composition.texture.grain: grão de tela cheia não é permitido com transparent=true (seria fundo assado)');

  const safeA = c.safe_area ?? t.safe_area ?? 0.1;
  if (typeof safeA !== 'number' || safeA < 0 || safeA > 0.4) errors.push('composition.safe_area: 0..0.4');
  const safe = safeRect(W, H, safeA);

  let gridPlan: Plan['grid'] = null; let g: ReturnType<typeof makeGrid> | null = null;
  if (c.grid !== undefined) {
    onlyKeys(c.grid, ['columns', 'rows', 'gutter'], 'composition.grid', errors);
    const cols = c.grid.columns; const rows = c.grid.rows;
    if (!(Number.isInteger(cols) && cols >= 1 && cols <= 24) || !(Number.isInteger(rows) && rows >= 1 && rows <= 24)) errors.push('composition.grid: columns/rows inteiros 1..24');
    else {
      const gut = guard(() => refSize(t, c.grid.gutter ?? 'space.1', 'grid.gutter'), 1) * u;
      g = makeGrid(safe, cols, rows, gut); gridPlan = { cols, rows, gutter: gut };
    }
  }

  // camera
  const keys: CamKey[] = [];
  if (c.camera !== undefined) {
    onlyKeys(c.camera, ['keys'], 'composition.camera', errors);
    if (!Array.isArray(c.camera.keys) || c.camera.keys.length < 2) errors.push('composition.camera.keys: ≥ 2 chaves');
    else c.camera.keys.forEach((k: any, i: number) => {
      const p = `composition.camera.keys[${i}]`;
      onlyKeys(k, ['at', 'x', 'y', 'zoom', 'rotate', 'ease'], p, errors);
      const key: CamKey = { frame: guard(() => refTime(t, k.at, fps, `camera.keys[${i}].at`), 0) };
      if (k.x !== undefined) key.x = k.x * W;
      if (k.y !== undefined) key.y = k.y * H;
      if (k.zoom !== undefined) { if (!(k.zoom > 0)) errors.push(`${p}.zoom: > 0`); else key.zoom = k.zoom; }
      if (k.rotate !== undefined) key.rotate = k.rotate;
      if (k.ease !== undefined) key.ease = guard(() => refEase(t, k.ease, `camera.keys[${i}].ease`), t.motion.ease.io);
      else key.ease = t.motion.ease.io;
      keys.push(key);
    });
    for (let i = 1; i < keys.length; i++) if (keys[i].frame <= keys[i - 1].frame) errors.push(`composition.camera.keys[${i}].at: deve ser crescente`);
  }

  // motion blur
  let sub = 1; let shutter = 1;
  if (c.motion_blur !== undefined) {
    onlyKeys(c.motion_blur, ['subframes', 'shutter'], 'composition.motion_blur', errors);
    sub = c.motion_blur.subframes; shutter = c.motion_blur.shutter ?? 1;
    if (!(Number.isInteger(sub) && sub >= 2 && sub <= 16)) errors.push('composition.motion_blur.subframes: inteiro 2..16');
    if (!(shutter > 0 && shutter <= 1)) errors.push('composition.motion_blur.shutter: (0, 1]');
  }

  // layers
  const layers: PlanLayer[] = [];
  const assets: Plan['assets'] = [];
  if (!Array.isArray(c.layers) || !c.layers.length) errors.push('composition.layers: ao menos 1 camada');
  const ids = new Set<string>();
  const pending: { layer: string; field: 'target' | 'at'; spec: PointSpec; path: string }[] = [];
  (c.layers ?? []).forEach((L: any, i: number) => {
    const p = `composition.layers[${i}]`;
    if (!isObj(L)) { errors.push(`${p}: objeto`); return; }
    onlyKeys(L, LAYER_KEYS, p, errors);
    const pattern = L.pattern as Pattern;
    if (!PATTERNS.includes(pattern)) { errors.push(`${p}.pattern: não suportado (${String(L.pattern)}); válidos: ${PATTERNS.join(', ')}`); return; }
    const id = typeof L.id === 'string' && L.id ? L.id : `${pattern.toLowerCase()}_${i}`;
    if (!ID_RE.test(id)) errors.push(`${p}.id: "${id}" inválido (letra inicial; só letras, dígitos, _ e -; usado em referências)`);
    if (ids.has(id)) errors.push(`${p}.id: duplicado (${id})`); ids.add(id);
    // FULL-BLEED: explícito em IMAGE_REVEAL / SHAPE rect; implícito em SECTION_TRANSITION (sempre tela cheia)
    let fullBleed = pattern === 'SECTION_TRANSITION';
    if (L.full_bleed !== undefined) {
      if (typeof L.full_bleed !== 'boolean') errors.push(`${p}.full_bleed: boolean`);
      else if (!FULL_BLEED_OK.includes(pattern)) errors.push(`${p}.full_bleed: não suportado em ${pattern} (só ${FULL_BLEED_OK.join(', ')})`);
      else if (pattern === 'SECTION_TRANSITION' && L.full_bleed === false) errors.push(`${p}.full_bleed: SECTION_TRANSITION é sempre full-bleed`);
      else if (pattern === 'SHAPE' && L.full_bleed && (L.content?.shape ?? 'rect') !== 'rect') errors.push(`${p}.full_bleed: só SHAPE "rect" pode ser full-bleed`);
      else if (L.full_bleed && L.region !== undefined && L.region !== 'full') errors.push(`${p}.full_bleed: exige region "full" (ou omita region)`);
      else fullBleed = L.full_bleed;
    }
    const def = PATTERN_DEF[pattern];
    onlyKeys(L.content ?? {}, def.content, `${p}.content`, errors);
    onlyKeys(L.style ?? {}, Object.keys(def.style), `${p}.style`, errors);
    onlyKeys(L.motion ?? {}, [...MOTION_COMMON, ...PATTERN_MOTION[pattern]], `${p}.motion`, errors);
    if (L.anchor !== undefined && !ANCHORED.includes(pattern)) errors.push(`${p}.anchor: ${pattern} preenche a região inteira; anchor não tem efeito (não suportado)`);
    if (pattern === 'SECTION_TRANSITION' && L.region !== undefined && L.region !== 'full') errors.push(`${p}.region: SECTION_TRANSITION é sempre tela cheia (use "full" ou omita)`);
    if (pattern === 'GRID_LINES' && L.region !== undefined && L.region !== 'safe') errors.push(`${p}.region: GRID_LINES usa o grid/safe area da composição (use "safe" ou omita)`);
    const m = L.motion ?? {};
    if (pattern === 'SHAPE' && m.reveal !== undefined && ['ring', 'line'].includes(L.content?.shape)) errors.push(`${p}.motion.reveal: ${L.content.shape} se desenha; reveal não tem efeito (não suportado)`);
    if (pattern === 'SECTION_TRANSITION' && ['fade', 'scale'].includes(m.reveal)) errors.push(`${p}.motion.reveal: SECTION_TRANSITION aceita só up | down | left | right`);
    if (pattern === 'LOWER_THIRD' && L.style?.rule !== undefined && !['none', 'left'].includes(L.style.rule)) errors.push(`${p}.style.rule: LOWER_THIRD aceita só none | left`);
    if (pattern === 'IMAGE_REVEAL' && typeof L.content?.src === 'string' && L.content.src.startsWith('procedural:') && (L.style?.fit !== undefined || L.style?.focus !== undefined)) errors.push(`${p}.style: fit/focus só se aplicam a src "asset:" (procedural ignora)`);
    const inF = guard(() => refTime(t, L.in ?? 0, fps, `layers[${i}].in`), 0);
    const outF = guard(() => refTime(t, L.out ?? frames / fps, fps, `layers[${i}].out`), frames);
    if (outF <= inF) errors.push(`${p}: out deve ser > in`);
    if (outF > frames + 1e-6) errors.push(`${p}.out: além da duração (${frames} f)`);
    const reveal = m.reveal ?? DEFAULT_REVEAL[pattern] ?? 'up';
    if (!REVEALS.includes(reveal)) errors.push(`${p}.motion.reveal: ${REVEALS.join(' | ')}`);
    const split = m.split ?? 'word';
    if (!ENUMS.split.includes(split)) errors.push(`${p}.motion.split: line | word | char`);
    const anchor = (L.anchor ?? 'center') as Anchor;
    if (!ANCHORS.includes(anchor)) errors.push(`${p}.anchor: ${ANCHORS.join(' | ')}`);
    const depth = L.depth ?? 1;
    if (typeof depth !== 'number' || depth < 0 || depth > 1.5) errors.push(`${p}.depth: 0..1.5`);

    // região
    let box: Rect = safe;
    const R = L.region;
    if (fullBleed || R === 'full') box = { x: 0, y: 0, w: W, h: H };
    else if (R === 'safe' || R === undefined) box = safe;
    else if (isObj(R)) {
      onlyKeys(R, ['col', 'row', 'span', 'rows'], `${p}.region`, errors);
      if (!g) errors.push(`${p}.region: grid de células exige composition.grid`);
      else {
        const col = R.col ?? 0; const row = R.row ?? 0; const span = R.span ?? 1; const rs = R.rows ?? 1;
        if (col < 0 || row < 0 || col + span > g.cols || row + rs > g.rows) errors.push(`${p}.region: fora do grid (${g.cols}×${g.rows})`);
        else box = g.cell(col, row, span, rs);
      }
    } else errors.push(`${p}.region: "full" | "safe" | {col,row,span,rows}`);

    // style resolvido
    const style: Record<string, any> = {};
    for (const [k, v] of Object.entries(L.style ?? {})) {
      const kind = def.style[k];
      if (!kind) continue;
      const sp = `layers[${i}].style.${k}`;
      if (kind === 'c') style[k] = v === 'none' ? 'none' : guard(() => refColor(t, v, sp), '#000000');
      else if (kind === 's') style[k] = guard(() => refSize(t, v, sp), 1) * u;
      else if (kind === 'f') style[k] = guard(() => refFont(t, v, sp), t.font.body);
      else if (kind === 'h') style[k] = guard(() => { const s = refShadow(t, v, sp); return s && { ...s, x: s.x * u, y: s.y * u, blur: s.blur * u }; }, null);
      else if (kind === 'x') { if (!Array.isArray(v) || v.length !== 2) errors.push(`${p}.style.${k}: [x, y] (0..1)`); style[k] = v; }
      else if (kind === 'n') { if (typeof v !== 'number') errors.push(`${p}.style.${k}: número`); style[k] = v; }
      else if (kind === 'b') { if (typeof v !== 'boolean') errors.push(`${p}.style.${k}: boolean`); style[k] = v; }
      else { if (ENUMS[k] && !ENUMS[k].includes(String(v))) errors.push(`${p}.style.${k}: ${ENUMS[k].join(' | ')}`); style[k] = v; }
    }
    style.u = u;
    style.paper_amp = t.texture.paper_amp * u; style.paper_step = t.texture.paper_step * u;
    style.fallback_font = t.font.body;
    style.display_font = t.font.display ?? t.font.body;
    style.ink = t.color.ink ?? t.color.text ?? '#111111';
    style.accent_default = t.color.accent ?? style.ink;
    style.scale = t.scale.map((s) => s * u);
    style.radius_default = (t.radius.card ?? t.radius.base ?? 0) * u;
    style.stroke_default = t.stroke.base * u;

    // content (validação por pattern)
    const content = { ...(L.content ?? {}) };
    if (pattern === 'TITLE_REVEAL' && !(typeof content.title === 'string' || (Array.isArray(content.title) && content.title.every((x: any) => typeof x === 'string')))) errors.push(`${p}.content.title: string ou lista de linhas`);
    if (pattern === 'LOWER_THIRD' && typeof content.name !== 'string') errors.push(`${p}.content.name: string`);
    if (pattern === 'CARD_BUILD' && !(Array.isArray(content.items) && content.items.length >= 1 && content.items.length <= 6 && content.items.every((x: any) => isObj(x) && typeof x.title === 'string'))) errors.push(`${p}.content.items: 1..6 itens {title, body?}`);
    if (pattern === 'STAT_COUNTER' && typeof content.value !== 'number') errors.push(`${p}.content.value: número`);
    if (pattern === 'CALLOUT') {
      if (typeof content.text !== 'string') errors.push(`${p}.content.text: string`);
      const tg = checkPointSpec(content.target, `${p}.content.target`, errors);
      if (tg) pending.push({ layer: id, field: 'target', spec: tg, path: `${p}.content.target` });
    }
    if (pattern === 'SHAPE' && content.at !== undefined) {
      const at = checkPointSpec(content.at, `${p}.content.at`, errors);
      if (L.region !== undefined) errors.push(`${p}.region: SHAPE com content.at é posicionada pelo ponto (omita region)`);
      if (fullBleed) errors.push(`${p}.content.at: incompatível com full_bleed`);
      const sizeOk = Array.isArray(content.size) && content.size.length === 2 && content.size.every((n: any) => typeof n === 'number' && n > 0);
      if (!sizeOk) errors.push(`${p}.content.size: [w, h] em u (> 0) obrigatório com content.at`);
      if (at && sizeOk) pending.push({ layer: id, field: 'at', spec: at, path: `${p}.content.at` });
    } else if (pattern === 'SHAPE' && content.size !== undefined) errors.push(`${p}.content.size: só com content.at`);
    if (pattern === 'MAP_PATH') {
      if (!(Array.isArray(content.points) && content.points.length >= 2 && content.points.every((q: any) => Array.isArray(q) && q.length === 2 && q.every((n: any) => typeof n === 'number')))) errors.push(`${p}.content.points: ≥ 2 pontos [x, y] (0..1 da região)`);
      else content.points_px = content.points.map(([pu, pv]: [number, number]) => { const q = regionToFrame(box, pu, pv); return [q.x, q.y]; });
      for (const [j, mk] of (content.markers ?? []).entries()) {
        if (!isObj(mk) || !Number.isInteger(mk.at) || mk.at < 0 || mk.at >= (content.points?.length ?? 0)) errors.push(`${p}.content.markers[${j}].at: índice inteiro de ponto (0..${(content.points?.length ?? 1) - 1})`);
        else onlyKeys(mk, ['at', 'label'], `${p}.content.markers[${j}]`, errors);
      }
    }
    if (pattern === 'SHAPE' && content.shape !== undefined && !ENUMS.shape.includes(content.shape)) errors.push(`${p}.content.shape: ${ENUMS.shape.join(' | ')}`);
    if (pattern === 'IMAGE_REVEAL') {
      const src = content.src;
      if (typeof src !== 'string' || !(/^asset:.+/.test(src) || /^procedural:(gradient|bands|noise)$/.test(src))) errors.push(`${p}.content.src: "asset:<caminho relativo>" ou "procedural:gradient|bands|noise"`);
      else if (src.startsWith('asset:')) assets.push({ kind: 'image', ref: src.slice(6), layer: id });
    }
    for (const f of Object.values(style)) if (isObj(f) && 'file' in f && (f as any).file) {
      const ff = f as any; if (!assets.some((a) => a.kind === 'font' && a.ref === ff.file)) assets.push({ kind: 'font', ref: ff.file, layer: null });
    }

    layers.push({
      id, pattern, inF, outF,
      enterF: guard(() => refTime(t, m.enter ?? 'motion.base', fps, `layers[${i}].motion.enter`), 12),
      exitF: guard(() => refTime(t, m.exit ?? 'motion.fast', fps, `layers[${i}].motion.exit`), 6),
      delayF: guard(() => refTime(t, m.delay ?? 0, fps, `layers[${i}].motion.delay`), 0),
      staggerF: guard(() => refTime(t, m.stagger ?? t.motion.stagger, fps, `layers[${i}].motion.stagger`), 2),
      ease: guard(() => refEase(t, m.ease, `layers[${i}].motion.ease`), t.motion.ease.out),
      exitEase: guard(() => refEase(t, m.exit_ease ?? 'in', `layers[${i}].motion.exit_ease`), t.motion.ease.in),
      reveal, split, spring: m.spring === true,
      depth, z: Number.isInteger(L.z) ? L.z : i, box, anchor, content, style, fullBleed, overscan: 1,
    });
  });

  // ── COORDENADAS COMPARTILHADAS: resolve refs para FRAME SPACE (independente da ordem; ciclo → FAIL) ──
  const byId = new Map(layers.map((l) => [l.id, l]));
  const pendingBy = new Map(pending.map((q) => [`${q.layer}:${q.field}`, q]));
  const resolved = new Map<string, Pt>();
  const resolving = new Set<string>();
  const camera = keys.length > 0;
  const resolvePending = (key: string): Pt | null => {
    if (resolved.has(key)) return resolved.get(key)!;
    const q = pendingBy.get(key); if (!q) return null;
    if (resolving.has(key)) { errors.push(`${q.path}: referência circular (${[...resolving, key].join(' → ')})`); return null; }
    resolving.add(key);
    let pt: Pt | null = null;
    const sp = q.spec;
    if (sp.kind === 'frame') pt = { x: sp.x * W, y: sp.y * H };
    else if (sp.kind === 'safe') pt = regionToFrame(safe, sp.x, sp.y);
    else pt = resolveRef(sp.ref, q);
    resolving.delete(key);
    if (pt) {
      resolved.set(key, pt);
      const L = byId.get(q.layer)!;
      if (q.field === 'target') L.content.target_px = [pt.x, pt.y];
      if (q.field === 'at') { const [sw, sh] = L.content.size as [number, number]; L.box = { x: pt.x - (sw * u) / 2, y: pt.y - (sh * u) / 2, w: sw * u, h: sh * u }; }
    }
    return pt;
  };
  const boxOf = (L: PlanLayer): Rect | null => (L.pattern === 'SHAPE' && L.content.at !== undefined ? (resolvePending(`${L.id}:at`) ? L.box : null) : L.box);
  function resolveRef(ref: string, q: { layer: string; path: string }): Pt | null {
    const r = parseRef(ref);
    if (!r) { errors.push(`${q.path}: referência inválida "${ref}" (use <layer>.point.N | .marker.N | .start | .end | .center | .target | .anchor.<âncora>)`); return null; }
    const T = byId.get(r.layer);
    if (!T) { errors.push(`${q.path}: camada "${r.layer}" não existe`); return null; }
    if (r.layer === q.layer) { errors.push(`${q.path}: uma camada não pode referenciar a si mesma`); return null; }
    const from = byId.get(q.layer)!;
    if (camera && T.depth !== from.depth) { errors.push(`${q.path}: "${r.layer}" tem depth ${T.depth} e "${q.layer}" tem ${from.depth}; com câmera, coordenadas compartilhadas exigem a mesma profundidade`); return null; }
    if (r.kind === 'point' || r.kind === 'marker' || r.kind === 'start' || r.kind === 'end') {
      if (T.pattern !== 'MAP_PATH' || !T.content.points_px) { errors.push(`${q.path}: "${r.layer}.${r.kind}" exige um MAP_PATH válido`); return null; }
      const pts = T.content.points_px as [number, number][];
      let idx = r.kind === 'start' ? 0 : r.kind === 'end' ? pts.length - 1 : (r as any).index;
      if (r.kind === 'marker') { const mk = (T.content.markers ?? [])[idx]; if (!mk) { errors.push(`${q.path}: marcador ${idx} não existe em "${r.layer}"`); return null; } idx = mk.at; }
      if (idx < 0 || idx >= pts.length) { errors.push(`${q.path}: ponto ${idx} não existe em "${r.layer}" (0..${pts.length - 1})`); return null; }
      return { x: pts[idx][0], y: pts[idx][1] };
    }
    if (r.kind === 'target') {
      if (T.pattern !== 'CALLOUT') { errors.push(`${q.path}: ".target" só existe em CALLOUT`); return null; }
      return resolvePending(`${T.id}:target`);
    }
    const b = boxOf(T); if (!b) return null;
    return boxPoint(b, r.kind === 'center' ? 'center' : (r as any).anchor);
  }
  for (const q of pending) resolvePending(`${q.layer}:${q.field}`);

  // ── OVERSCAN: só camadas FULL-BLEED, sobre os instantes EXATOS renderizados ──
  if (camera) for (const L of layers) if (L.fullBleed) {
    L.overscan = requiredOverscan(keys, W, H, renderTimes(frames, sub, L.inF, L.outF, subframeTime), L.depth);
  }

  // fontes declaradas com arquivo em tokens (carregadas pela composição)
  const fonts = Object.values(t.font).filter((f) => f.file).map((f) => ({ family: f.family, weight: f.weight, asset: f.file as string }));
  for (const f of fonts) if (!assets.some((a) => a.kind === 'font' && a.ref === f.asset)) assets.push({ kind: 'font', ref: f.asset, layer: null });

  if (errors.length) throw new SpecError(errors);
  return {
    version: PLAN_VERSION, id: String(spec.id), width: W, height: H, fps, frames, u, transparent,
    seed: Number.isInteger(c.seed) ? c.seed : 1, sub, shutter, background, grain, safe, grid: gridPlan,
    camera: { keys }, layers: layers.sort((a, b) => a.z - b.z), fonts, assets,
  };
}
