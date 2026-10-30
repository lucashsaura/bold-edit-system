// TOKENS — resolve o tokens.json do PROJETO (schema bold.tokens/0) para valores de render.
// Unidades de tamanho em tokens: `u` = 1% do MENOR lado do quadro (independente de resolução/orientação).
// Tempos em tokens.motion: SEGUNDOS (independentes de fps); convertidos para frames no plano.

import { EASES, type Bezier } from './animation.ts';

export const FALLBACK_STACK = '"Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

export interface FontToken { family: string; stack: string; weight: number | string; file: string | null }
export interface ShadowToken { x: number; y: number; blur: number; color: string; opacity: number }
export interface ResolvedTokens {
  name: string;
  color: Record<string, string>;
  font: Record<string, FontToken>;
  scale: number[];
  space: number;
  radius: Record<string, number>;
  stroke: Record<string, number>;
  shadow: Record<string, ShadowToken>;
  texture: { grain: number; paper_amp: number; paper_step: number };
  motion: {
    duration: Record<string, number>;
    delay: number; stagger: number;
    ease: Record<string, Bezier>;
    spring: { stiffness: number; damping: number; mass: number };
    overshoot: number; blur: number;
  };
  safe_area: number | null;
}

export class TokenError extends Error {
  path: string;
  constructor(path: string, msg: string) { super(`${path}: ${msg}`); this.path = path; this.name = 'TokenError'; }
}

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function resolveTokens(doc: any): { tokens: ResolvedTokens | null; errors: string[] } {
  const errors: string[] = [];
  const err = (p: string, m: string) => errors.push(`tokens.${p}: ${m}`);
  if (!doc || typeof doc !== 'object') return { tokens: null, errors: ['tokens: documento ausente'] };
  if (doc.schema !== 'bold.tokens/0') err('schema', 'deve ser "bold.tokens/0"');

  const color: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.color ?? {})) { if (typeof v === 'string' && HEX.test(v)) color[k] = v; else err(`color.${k}`, 'cor deve ser #RRGGBB ou #RRGGBBAA'); }

  const font: Record<string, FontToken> = {};
  for (const [k, v] of Object.entries<any>(doc.typography?.families ?? {})) {
    if (!v?.family) { err(`typography.families.${k}`, 'family obrigatório'); continue; }
    font[k] = { family: v.family, stack: `"${v.family}", ${FALLBACK_STACK}`, weight: v.weight ?? 400, file: v.file ?? null };
  }
  if (!font.body) font.body = { family: 'Noto Sans', stack: FALLBACK_STACK, weight: 400, file: null };

  const scale = (doc.typography?.scale ?? [2, 3, 4.5, 7, 11]) as number[];
  if (!Array.isArray(scale) || !scale.every((n) => isNum(n) && n > 0)) err('typography.scale', 'lista de números > 0 (em u)');

  const num = (path: string, v: unknown, d: number) => { if (v === undefined) return d; if (!isNum(v)) { err(path, 'deve ser número'); return d; } return v; };
  const mapNums = (path: string, obj: any) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj ?? {})) { if (isNum(v) && v >= 0) out[k] = v; else err(`${path}.${k}`, 'deve ser número ≥ 0 (u)'); }
    return out;
  };

  const shadow: Record<string, ShadowToken> = {};
  for (const [k, v] of Object.entries<any>(doc.shadow ?? {})) {
    if (!v || typeof v !== 'object') { err(`shadow.${k}`, 'objeto {x,y,blur,color,opacity}'); continue; }
    const c = v.color ?? '#000000';
    if (!HEX.test(c)) err(`shadow.${k}.color`, 'cor #RRGGBB');
    shadow[k] = { x: num(`shadow.${k}.x`, v.x, 0), y: num(`shadow.${k}.y`, v.y, 0.4), blur: num(`shadow.${k}.blur`, v.blur, 1.5), color: c, opacity: num(`shadow.${k}.opacity`, v.opacity, 0.25) };
  }

  const m = doc.motion ?? {};
  const ease: Record<string, Bezier> = { ...EASES };
  for (const [k, v] of Object.entries<any>(doc.easing ?? {})) { if (Array.isArray(v) && v.length === 4 && v.every(isNum)) ease[k] = v as Bezier; else err(`easing.${k}`, 'cubic-bezier [x1,y1,x2,y2]'); }
  for (const [k, v] of Object.entries<any>(m.ease ?? {})) { if (Array.isArray(v) && v.length === 4 && v.every(isNum)) ease[k] = v as Bezier; else err(`motion.ease.${k}`, 'cubic-bezier [x1,y1,x2,y2]'); }
  const duration: Record<string, number> = { fast: 0.25, base: 0.55, slow: 1.1 };
  for (const [k, v] of Object.entries<any>(m.duration ?? {})) { if (isNum(v) && v >= 0) duration[k] = v; else err(`motion.duration.${k}`, 'segundos ≥ 0'); }
  const sp = m.spring ?? {};

  const tokens: ResolvedTokens = {
    name: String(doc.name ?? 'tokens'),
    color, font, scale, space: num('spacing.unit', doc.spacing?.unit, 2),
    radius: mapNums('radius', doc.radius), stroke: { hair: 0.12, base: 0.3, bold: 0.6, ...mapNums('stroke', doc.stroke) }, shadow,
    texture: { grain: num('texture.grain', doc.texture?.grain, 0), paper_amp: num('texture.paper_amp', doc.texture?.paper_amp, 0.35), paper_step: num('texture.paper_step', doc.texture?.paper_step, 0.8) },
    motion: {
      duration, delay: num('motion.delay', m.delay, 0), stagger: num('motion.stagger', m.stagger, 0.06), ease,
      spring: { stiffness: num('motion.spring.stiffness', sp.stiffness, 170), damping: num('motion.spring.damping', sp.damping, 26), mass: num('motion.spring.mass', sp.mass, 1) },
      overshoot: num('motion.overshoot', m.overshoot, 0), blur: num('motion.blur', m.blur, 0),
    },
    safe_area: doc.safe_area && isNum(doc.safe_area.x) ? doc.safe_area.x : null,
  };
  if (tokens.texture.grain < 0 || tokens.texture.grain > 1) err('texture.grain', 'entre 0 e 1');
  return { tokens: errors.length ? null : tokens, errors };
}

/** Referências: "color.ink", "type.3", "space.2", "radius.card", "stroke.base", "shadow.soft", "ease.out", "font.display", "motion.base". */
export function refColor(t: ResolvedTokens, v: unknown, path: string): string {
  if (typeof v === 'string' && v.startsWith('color.')) { const c = t.color[v.slice(6)]; if (!c) throw new TokenError(path, `cor inexistente: ${v}`); return c; }
  if (typeof v === 'string' && HEX.test(v)) return v;
  throw new TokenError(path, `cor inválida (use color.<nome> ou #RRGGBB): ${String(v)}`);
}

export function refSize(t: ResolvedTokens, v: unknown, path: string): number {
  if (isNum(v)) return v;
  if (typeof v === 'string' && v.includes('.')) {
    const kind = v.slice(0, v.indexOf('.')); const key = v.slice(v.indexOf('.') + 1);
    if (kind === 'type') { const i = Number(key); if (Number.isInteger(i) && t.scale[i] !== undefined) return t.scale[i]; }
    else if (kind === 'space') { const n = Number(key); if (Number.isFinite(n)) return n * t.space; }
    else if (kind === 'radius' && t.radius[key] !== undefined) return t.radius[key];
    else if (kind === 'stroke' && t.stroke[key] !== undefined) return t.stroke[key];
  }
  throw new TokenError(path, `tamanho inválido (número em u ou type.N/space.N/radius.X/stroke.X): ${String(v)}`);
}

export function refEase(t: ResolvedTokens, v: unknown, path: string): Bezier {
  if (v === undefined) return t.motion.ease.out;
  if (Array.isArray(v) && v.length === 4 && v.every(isNum)) return v as Bezier;
  if (typeof v === 'string') { const k = v.startsWith('ease.') ? v.slice(5) : v; if (t.motion.ease[k]) return t.motion.ease[k]; }
  throw new TokenError(path, `easing inexistente: ${String(v)}`);
}

export function refFont(t: ResolvedTokens, v: unknown, path: string): FontToken {
  if (v === undefined) return t.font.body;
  if (typeof v === 'string') { const k = v.startsWith('font.') ? v.slice(5) : v; if (t.font[k]) return t.font[k]; }
  throw new TokenError(path, `fonte inexistente: ${String(v)}`);
}

export function refShadow(t: ResolvedTokens, v: unknown, path: string): ShadowToken | null {
  if (v === undefined || v === null || v === 'none') return null;
  if (typeof v === 'string') { const k = v.startsWith('shadow.') ? v.slice(7) : v; if (t.shadow[k]) return t.shadow[k]; }
  throw new TokenError(path, `sombra inexistente: ${String(v)}`);
}

/** Tempo: número = segundos · "12f" = frames · "motion.base" = token de duração. Retorna FRAMES (pode ser fracionário). */
export function refTime(t: ResolvedTokens, v: unknown, fps: number, path: string): number {
  if (isNum(v)) { if (v < 0) throw new TokenError(path, 'tempo negativo'); return v * fps; }
  if (typeof v === 'string') {
    const f = v.match(/^(\d+(?:\.\d+)?)f$/); if (f) return Number(f[1]);
    if (v.startsWith('motion.')) { const k = v.slice(7); if (t.motion.duration[k] !== undefined) return t.motion.duration[k] * fps; }
  }
  throw new TokenError(path, `tempo inválido (segundos, "Nf" ou motion.<duração>): ${String(v)}`);
}
