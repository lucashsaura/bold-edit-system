// PATTERNS — comportamentos combináveis (não templates). Recebem tokens/motion/content/layout já resolvidos no plano
// e só combinam primitives. Nenhum pattern carrega cor, fonte, texto ou layout próprio além de defaults neutros.
import React from 'react';
import { clamp, easeFrom, progress, spring } from '../core/animation.ts';
import { anchorPoint } from '../core/layout.ts';
import { catmullRom, pointAt, polylineLength, toPathD } from '../core/geometry.ts';
import type { PlanLayer } from '../core/spec.ts';
import { usePlan } from './context.ts';
import { AssetImage, DrawLine, dropShadow, paperClip, ProceduralImage, SplitText, unitMotion, unitProgress, wipeClip } from './primitives.tsx';

type P = { L: PlanLayer };

function flexFor(L: PlanLayer): React.CSSProperties {
  const a = anchorPoint(L.box, L.anchor);
  const map = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;
  return { position: 'absolute', left: L.box.x, top: L.box.y, width: L.box.w, height: L.box.h, display: 'flex', flexDirection: 'column',
    justifyContent: map[a.alignY], alignItems: map[a.alignX], textAlign: a.alignX === 'start' ? 'left' : a.alignX === 'end' ? 'right' : 'center' };
}
const font = (f: any, fb: any) => (f ?? fb);
const caseOf = (s: string, c?: string) => (c === 'upper' ? s.toUpperCase() : s);
const seedOf = (plan: { seed: number }, L: PlanLayer, k = 0) => (plan.seed * 7919 + L.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) * 31 + k) >>> 0;

// ── TITLE_REVEAL ─────────────────────────────────────────────
export const TitleReveal: React.FC<P> = ({ L }) => {
  const { t } = usePlan(); const s = L.style; const c = L.content;
  const fT = font(s.font_title, s.display_font); const fB = font(s.font_body, s.fallback_font);
  const sizeT = s.size_title ?? s.scale[Math.max(0, s.scale.length - 2)];
  const sizeB = s.size_body ?? s.scale[1] ?? sizeT * 0.3;
  const sizeK = s.size_kicker ?? s.scale[0] ?? sizeT * 0.2;
  const color = s.color ?? s.ink; const accent = s.accent ?? s.accent_default;
  const lines = (Array.isArray(c.title) ? c.title : [c.title]).map((x: string) => caseOf(x, s.case));
  const titleStyle: React.CSSProperties = { fontFamily: fT.stack, fontWeight: fT.weight as any, fontSize: sizeT, lineHeight: s.line_height ?? 1.0, color };
  const kick = unitProgress(t, L, 0); const rule = unitProgress(t, L, L.staggerF * 1.5);
  const subDelay = L.staggerF * (lines.join(' ').split(/\s+/).length + 2);
  const sub = unitProgress(t, L, subDelay);
  const ruleEl = (vertical: boolean) => <DrawLine w={vertical ? Math.max(1, s.stroke_default) : sizeT * 1.6} h={vertical ? sizeT * lines.length * 1.05 : Math.max(1, s.stroke_default)} color={accent} e={rule.e} x={rule.x} vertical={vertical} />;
  return (
    <div style={flexFor(L)}>
      {c.kicker ? <div style={{ fontFamily: fB.stack, fontWeight: 600, fontSize: sizeK, letterSpacing: '0.18em', color: accent, marginBottom: sizeK * 0.9, ...unitMotion('fade', kick.e, kick.x) }}>{caseOf(c.kicker, 'upper')}</div> : null}
      {s.rule === 'top' ? <div style={{ marginBottom: sizeT * 0.25 }}>{ruleEl(false)}</div> : null}
      <div style={{ display: 'flex', gap: sizeT * 0.35, alignItems: 'stretch' }}>
        {s.rule === 'left' ? ruleEl(true) : null}
        <div><SplitText lines={lines} L={L} t={t} split={L.split} style={titleStyle} trackingFrom={s.tracking_from} tracking={s.tracking ?? (s.tracking_from !== undefined ? 0 : undefined)} /></div>
      </div>
      {s.rule === 'under' ? <div style={{ marginTop: sizeT * 0.22 }}>{ruleEl(false)}</div> : null}
      {c.subtitle ? <div style={{ marginTop: sizeT * 0.32, overflow: 'hidden' }}>
        <div style={{ fontFamily: fB.stack, fontWeight: fB.weight as any, fontSize: sizeB, lineHeight: 1.25, color: s.color_body ?? color, ...unitMotion(L.reveal, sub.e, sub.x, 1.2) }}>{c.subtitle}</div>
      </div> : null}
    </div>
  );
};

// ── LOWER_THIRD ──────────────────────────────────────────────
export const LowerThird: React.FC<P> = ({ L }) => {
  const { t } = usePlan(); const s = L.style; const c = L.content;
  const f = font(s.font, s.display_font); const fr = font(s.font_role, s.fallback_font);
  const sizeN = s.size_name ?? s.scale[2] ?? 4 * s.u; const sizeR = s.size_role ?? s.scale[0] ?? 2 * s.u;
  const plate = s.plate && s.plate !== 'none' ? s.plate : null; const accent = s.accent ?? s.accent_default;
  const pl = unitProgress(t, L, 0); const nm = unitProgress(t, L, L.staggerF * 2); const rl = unitProgress(t, L, L.staggerF * 4);
  return (
    <div style={flexFor(L)}>
      <div style={{ position: 'relative', display: 'flex', gap: sizeN * 0.4, padding: plate ? `${sizeN * 0.35}px ${sizeN * 0.6}px` : 0 }}>
        {plate ? <div style={{ position: 'absolute', inset: 0, background: plate, borderRadius: s.radius ?? s.radius_default, clipPath: wipeClip('left', pl.e, pl.x) }} /> : null}
        {s.rule !== 'none' ? <DrawLine w={Math.max(2, s.stroke_default * 1.6)} h={sizeN * 1.9} color={accent} e={pl.e} x={pl.x} vertical style={{ position: 'relative' }} /> : null}
        <div style={{ position: 'relative' }}>
          <div style={{ overflow: 'hidden' }}><div style={{ fontFamily: f.stack, fontWeight: f.weight as any, fontSize: sizeN, lineHeight: 1.05, color: s.color ?? s.ink, letterSpacing: s.tracking !== undefined ? `${s.tracking}em` : undefined, ...unitMotion(L.reveal, nm.e, nm.x) }}>{caseOf(c.name, s.case)}</div></div>
          {c.role ? <div style={{ overflow: 'hidden', marginTop: sizeR * 0.35 }}><div style={{ fontFamily: fr.stack, fontWeight: fr.weight as any, fontSize: sizeR, lineHeight: 1.2, letterSpacing: '0.04em', color: s.color_role ?? s.color ?? s.ink, ...unitMotion(L.reveal, rl.e, rl.x) }}>{c.role}</div></div> : null}
        </div>
      </div>
    </div>
  );
};

// ── CARD_BUILD ───────────────────────────────────────────────
export const CardBuild: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style; const items = L.content.items as { title: string; body?: string }[];
  const dir = s.direction ?? 'row'; const gap = s.gap ?? 2 * s.u;
  const n = items.length;
  const cw = dir === 'row' ? (L.box.w - gap * (n - 1)) / n : L.box.w;
  const ch = dir === 'row' ? L.box.h : (L.box.h - gap * (n - 1)) / n;
  const f = font(s.font, s.display_font); const fb = font(s.font_body, s.fallback_font);
  const sizeT = s.size_title ?? s.scale[2] ?? 4 * s.u; const sizeB = s.size_body ?? s.scale[0] ?? 2 * s.u;
  const pad = Math.min(cw, ch) * 0.12;
  return (
    <div style={{ position: 'absolute', left: L.box.x, top: L.box.y, width: L.box.w, height: L.box.h, display: 'flex', flexDirection: dir as any, gap }}>
      {items.map((it, i) => {
        const p = unitProgress(t, L, i * L.staggerF * 2);
        const tx = unitProgress(t, L, i * L.staggerF * 2 + L.staggerF * 1.5);
        const lift = (1 - p.e) * ch * 0.08;
        const clip = s.paper ? paperClip(cw, ch, s.paper_amp, s.paper_step, seedOf(plan, L, i)) : undefined;
        return (
          <div key={i} style={{ width: cw, height: ch, opacity: clamp(p.e * 1.6) * (1 - p.x), transform: `translateY(${(lift - p.x * ch * 0.05).toFixed(2)}px) scale(${(0.97 + 0.03 * p.e).toFixed(4)})`, filter: dropShadow(s.shadow) }}>
            <div style={{ width: '100%', height: '100%', background: s.plate && s.plate !== 'none' ? s.plate : 'transparent', borderRadius: s.paper ? 0 : (s.radius ?? s.radius_default),
              border: s.stroke ? `${Math.max(1, s.stroke_width ?? s.stroke_default)}px solid ${s.stroke}` : undefined, clipPath: clip, boxSizing: 'border-box', padding: pad, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              {s.accent ? <DrawLine w={sizeT * 1.2} h={Math.max(1, s.stroke_default)} color={s.accent} e={tx.e} x={tx.x} style={{ marginBottom: sizeT * 0.5 }} /> : null}
              <div style={{ overflow: 'hidden' }}><div style={{ fontFamily: f.stack, fontWeight: f.weight as any, fontSize: sizeT, lineHeight: 1.05, color: s.color ?? s.ink, ...unitMotion(L.reveal, tx.e, tx.x) }}>{it.title}</div></div>
              {it.body ? <div style={{ overflow: 'hidden', marginTop: sizeB * 0.6 }}><div style={{ fontFamily: fb.stack, fontWeight: fb.weight as any, fontSize: sizeB, lineHeight: 1.3, color: s.color_body ?? s.color ?? s.ink, ...unitMotion(L.reveal, tx.e, tx.x) }}>{it.body}</div></div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── IMAGE_REVEAL ─────────────────────────────────────────────
export const ImageReveal: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style; const c = L.content;
  const p = unitProgress(t, L, 0);
  const life = progress(t, L.inF, L.outF - L.inF);
  const z0 = s.zoom_from ?? 1.08; const z1 = s.zoom_to ?? 1.0;
  const zoom = z0 + (z1 - z0) * easeFrom([0.33, 0, 0.2, 1])(life);
  const { w, h } = L.box;
  const src = String(c.src);
  const inner = src.startsWith('asset:')
    ? <AssetImage asset={src.slice(6)} w={w} h={h} fit={s.fit ?? 'cover'} focus={s.focus ?? [0.5, 0.5]} />
    : <ProceduralImage kind={src.split(':')[1]} from={s.from ?? s.ink} to={s.to ?? s.accent_default} seed={seedOf(plan, L)} w={w} h={h} />;
  const clip = s.paper ? paperClip(w, h, s.paper_amp, s.paper_step, seedOf(plan, L, 1)) : undefined;
  const fc = font(s.font, s.fallback_font); const cap = unitProgress(t, L, L.staggerF * 3);
  return (
    <div style={{ position: 'absolute', left: L.box.x, top: L.box.y, width: w, height: h, filter: dropShadow(s.shadow) }}>
      {/* reveal (wipe/fade/scale) e borda de papel são camadas SEPARADAS: o papel nunca anula o reveal */}
      <div style={{ width: w, height: h, clipPath: L.reveal === 'fade' || L.reveal === 'scale' ? undefined : wipeClip(L.reveal, p.e, p.x),
        opacity: L.reveal === 'fade' ? p.e * (1 - p.x) : 1, transform: L.reveal === 'scale' ? `scale(${0.9 + 0.1 * p.e})` : undefined }}>
        <div style={{ width: w, height: h, overflow: 'hidden', borderRadius: s.paper ? 0 : (s.radius ?? 0), clipPath: clip }}>
          <div style={{ width: w, height: h, transform: `scale(${zoom.toFixed(5)})`, transformOrigin: 'center' }}>{inner}</div>
        </div>
      </div>
      {c.caption ? <div style={{ position: 'absolute', left: 0, top: h + (s.size_caption ?? 2 * s.u) * 0.6, overflow: 'hidden' }}>
        <div style={{ fontFamily: fc.stack, fontSize: s.size_caption ?? 2 * s.u, color: s.color ?? s.ink, letterSpacing: '0.06em', ...unitMotion('up', cap.e, cap.x) }}>{c.caption}</div></div> : null}
    </div>
  );
};

// ── STAT_COUNTER ─────────────────────────────────────────────
export const StatCounter: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style; const c = L.content;
  const f = font(s.font, s.display_font); const fl = font(s.font_label, s.fallback_font);
  const sizeV = s.size_value ?? s.scale[s.scale.length - 1]; const sizeL = s.size_label ?? s.scale[0];
  const p = unitProgress(t, L, 0);
  const count = L.spring ? clamp(spring(t - L.inF - L.delayF, plan.fps, { stiffness: 120, damping: 20 }), 0, 1.2) : easeFrom(L.ease)(progress(t, L.inF + L.delayF, L.enterF * 2));
  const from = typeof c.from === 'number' ? c.from : 0;
  const val = from + (c.value - from) * count;
  const dec = Number.isInteger(c.decimals) ? c.decimals : 0;
  const txt = new Intl.NumberFormat(c.locale ?? 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(val);
  const lab = unitProgress(t, L, L.staggerF * 3);
  return (
    <div style={flexFor(L)}>
      <div style={{ overflow: ['fade', 'scale'].includes(L.reveal) ? undefined : 'hidden' }}>
        <div style={{ fontFamily: f.stack, fontWeight: f.weight as any, fontSize: sizeV, lineHeight: 1, color: s.color ?? s.ink, fontVariantNumeric: 'tabular-nums',
          letterSpacing: s.tracking !== undefined ? `${s.tracking}em` : undefined, ...unitMotion(L.reveal, p.e, p.x) }}>
          {c.prefix ?? ''}{txt}{c.suffix ?? ''}
        </div>
      </div>
      {s.accent ? <DrawLine w={sizeV * 1.2} h={Math.max(1, s.stroke_default)} color={s.accent} e={lab.e} x={lab.x} style={{ marginTop: sizeL * 0.6 }} /> : null}
      {c.label ? <div style={{ overflow: 'hidden', marginTop: sizeL * 0.5 }}><div style={{ fontFamily: fl.stack, fontWeight: fl.weight as any, fontSize: sizeL, letterSpacing: '0.08em', color: s.color_label ?? s.color ?? s.ink, ...unitMotion('up', lab.e, lab.x) }}>{c.label}</div></div> : null}
    </div>
  );
};

// ── MAP_PATH ─────────────────────────────────────────────────
export const MapPath: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style; const c = L.content; const { x, y, w, h } = L.box;
  // pontos em FRAME SPACE resolvidos no plano (fonte única, compartilhada com CALLOUT/SHAPE) → locais à caixa
  const pts = (c.points_px as [number, number][]).map(([px, py]) => ({ x: px - x, y: py - y }));
  const curve = catmullRom(pts, 32); const len = polylineLength(curve);
  const draw = easeFrom(L.ease)(progress(t, L.inF + L.delayF, Math.max(1, L.enterF * 2.2)));
  const out = easeFrom(L.exitEase)(progress(t, L.outF - L.exitF, L.exitF));
  const sw = s.width ?? Math.max(1.5, s.stroke_default * 1.5); const color = s.color ?? s.accent_default;
  const head = pointAt(curve, draw);
  const cum: number[] = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + polylineLength(catmullRom(pts.slice(0, i + 1), 32)) - cum[i - 1]);
  const fl = font(s.font, s.fallback_font); const sizeL = s.size_label ?? s.scale[0];
  const id = `mp-${L.id}`;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: 1 - out }}>
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        {s.grid ? Array.from({ length: 9 }, (_, i) => <line key={i} x1={(w * (i + 1)) / 10} y1={0} x2={(w * (i + 1)) / 10} y2={h} stroke={s.grid_color ?? color} strokeOpacity={0.12 * clamp(draw * 3)} strokeWidth={1} />) : null}
        <defs><mask id={id} maskUnits="userSpaceOnUse"><path d={toPathD(curve)} fill="none" stroke="#fff" strokeWidth={sw * 3} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} strokeLinecap="round" /></mask></defs>
        <path d={toPathD(curve)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={s.dash ? `${sw * 2.4} ${sw * 2.2}` : undefined} mask={`url(#${id})`} />
        {draw > 0 && draw < 1 ? <circle cx={head.x} cy={head.y} r={sw * 1.6} fill={color} /> : null}
        {(c.markers ?? []).map((m: { at: number; label?: string }, i: number) => {
          const at = Math.min(pts.length - 1, Math.max(0, m.at | 0)); const frac = len ? Math.min(1, cum[at] / len) : 0;
          const k = clamp((draw - frac) * 12); const pop = k > 0 ? spring((draw - frac) * 40, plan.fps, { stiffness: 220, damping: 18 }) : 0;
          return (
            <g key={i} transform={`translate(${pts[at].x} ${pts[at].y})`}>
              <circle r={sw * 2.6 * clamp(pop, 0, 1.3)} fill={s.marker ?? color} />
              {m.label ? <text x={sw * 5} y={sizeL * 0.35} fontFamily={fl.stack} fontSize={sizeL} fill={s.label_color ?? s.ink} opacity={k}>{m.label}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ── CALLOUT ──────────────────────────────────────────────────
export const Callout: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style; const c = L.content;
  const f = font(s.font, s.fallback_font); const size = s.size ?? s.scale[1];
  const accent = s.accent ?? s.accent_default; const sw = s.stroke_width ?? Math.max(1, s.stroke_default);
  const [tx, ty] = c.target_px as [number, number]; // FRAME SPACE (resolvido no plano: quadro, safe ou referência)
  const a = anchorPoint(L.box, L.anchor);
  const line = unitProgress(t, L, 0); const box = unitProgress(t, L, L.staggerF * 2);
  const dot = clamp(spring(t - L.inF - L.delayF, plan.fps, { stiffness: 260, damping: 16 }), 0, 1.3) * (1 - line.x);
  const lx = tx + (a.x - tx) * clamp(line.e - line.x * 0); const ly = ty + (a.y - ty) * clamp(line.e);
  return (
    <>
      <svg width={plan.width} height={plan.height} style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: 1 - line.x }}>
        <line x1={tx} y1={ty} x2={lx} y2={ly} stroke={accent} strokeWidth={sw} />
        <circle cx={tx} cy={ty} r={sw * 3 * dot} fill="none" stroke={accent} strokeWidth={sw} />
        <circle cx={tx} cy={ty} r={sw * 1.2 * Math.min(1, dot)} fill={accent} />
      </svg>
      <div style={flexFor(L)}>
        <div style={{ overflow: 'hidden', background: s.plate && s.plate !== 'none' ? s.plate : undefined, borderRadius: s.radius ?? 0, padding: s.plate ? `${size * 0.4}px ${size * 0.7}px` : 0 }}>
          <div style={{ fontFamily: f.stack, fontWeight: f.weight as any, fontSize: size, lineHeight: 1.2, color: s.color ?? s.ink, ...unitMotion(L.reveal, box.e, box.x) }}>{c.text}</div>
        </div>
      </div>
    </>
  );
};

// ── SECTION_TRANSITION ───────────────────────────────────────
export const SectionTransition: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style;
  const a = unitProgress(t, L, 0); const b = unitProgress(t, L, L.staggerF * 2);
  const panel = (p: { e: number; x: number }, color: string) => <div style={{ position: 'absolute', inset: 0, background: color, clipPath: wipeClip(L.reveal === 'fade' || L.reveal === 'scale' ? 'left' : L.reveal, p.e, p.x) }} />;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: plan.width, height: plan.height }}>
      {s.color_2 ? panel(a, s.color_2) : null}
      {panel(s.color_2 ? b : a, s.color ?? s.ink)}
    </div>
  );
};

// ── SHAPE ────────────────────────────────────────────────────
export const Shape: React.FC<P> = ({ L }) => {
  const { t } = usePlan(); const s = L.style; const kind = L.content.shape ?? 'rect'; const { x, y, w, h } = L.box;
  const p = unitProgress(t, L, 0); const color = s.color ?? s.accent_default; const sw = s.stroke_width ?? Math.max(1, s.stroke_default);
  const fill = s.fill !== false;
  if (kind === 'line') return <DrawLine w={w} h={Math.max(1, sw)} color={color} e={p.e} x={p.x} style={{ position: 'absolute', left: x, top: y + h / 2 }} />;
  const r = Math.min(w, h) / 2;
  const body = kind === 'circle' || kind === 'ring'
    ? <svg width={w} height={h}><circle cx={w / 2} cy={h / 2} r={Math.max(0, r - sw)} fill={kind === 'ring' || !fill ? 'none' : color} stroke={kind === 'ring' || !fill ? color : 'none'} strokeWidth={sw}
        strokeDasharray={kind === 'ring' ? 2 * Math.PI * r : undefined} strokeDashoffset={kind === 'ring' ? 2 * Math.PI * r * (1 - clamp(p.e - p.x)) : undefined} transform={`rotate(-90 ${w / 2} ${h / 2})`} /></svg>
    : <div style={{ width: w, height: h, background: fill ? color : 'transparent', border: fill ? undefined : `${sw}px solid ${color}`, boxSizing: 'border-box', borderRadius: s.radius ?? 0 }} />;
  const anim: React.CSSProperties = kind === 'ring' ? {} : L.reveal === 'scale' || L.reveal === 'fade' ? unitMotion(L.reveal, p.e, p.x) : { clipPath: wipeClip(L.reveal, p.e, p.x) };
  return <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, filter: dropShadow(s.shadow), ...anim }}>{body}</div>;
};

// ── GRID_LINES ───────────────────────────────────────────────
export const GridLines: React.FC<P> = ({ L }) => {
  const { t, plan } = usePlan(); const s = L.style; const g = plan.grid; const r = plan.safe;
  const cols = g?.cols ?? 12; const gut = g?.gutter ?? 0; const colW = (r.w - gut * (cols - 1)) / cols;
  const xs: number[] = []; for (let i = 0; i <= cols; i++) xs.push(i === cols ? r.x + r.w : r.x + i * (colW + gut));
  const color = s.color ?? s.ink; const op = s.opacity ?? 0.18; const sw = s.width ?? 1;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {xs.map((x, i) => { const p = unitProgress(t, L, i * L.staggerF * 0.6); return <DrawLine key={i} w={Math.max(1, sw)} h={r.h} color={color} e={p.e} x={p.x} vertical style={{ position: 'absolute', left: x, top: r.y, opacity: op }} />; })}
      {[r.y, r.y + r.h].map((y, i) => { const p = unitProgress(t, L, i * L.staggerF * 2); return <DrawLine key={`h${i}`} w={r.w} h={Math.max(1, sw)} color={color} e={p.e} x={p.x} style={{ position: 'absolute', left: r.x, top: y, opacity: op }} />; })}
    </div>
  );
};

export const PATTERN_COMPONENTS: Record<string, React.FC<P>> = {
  TITLE_REVEAL: TitleReveal, LOWER_THIRD: LowerThird, CARD_BUILD: CardBuild, IMAGE_REVEAL: ImageReveal, STAT_COUNTER: StatCounter,
  MAP_PATH: MapPath, CALLOUT: Callout, SECTION_TRANSITION: SectionTransition, SHAPE: Shape, GRID_LINES: GridLines,
};
