// Composição única guiada por PLANO (não há uma composição por peça). Fundo, câmera, camadas e grão.
import React from 'react';
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import { subframeTime } from '../core/animation.ts';
import { camera2d, cameraTransform, parallax } from '../core/camera.ts';
import type { Plan } from '../core/spec.ts';
import { PlanContext } from './context.ts';
import { PATTERN_COMPONENTS } from './patterns.tsx';
import { Grain } from './primitives.tsx';

function useFonts(fonts: Plan['fonts']) {
  const [handle] = React.useState(() => (fonts.length ? delayRender('bold:fonts') : null));
  React.useEffect(() => {
    if (handle === null) return;
    Promise.all(fonts.map(async (f) => { const ff = new FontFace(f.family, `url(${staticFile(f.asset)})`, { weight: String(f.weight) }); await ff.load(); (document.fonts as any).add(ff); }))
      .then(() => continueRender(handle)).catch((e) => { throw new Error(`fonte não carregou: ${e?.message ?? e}`); });
  }, [handle]);
}

export const SpecComposition: React.FC<{ plan: Plan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  useFonts(plan.fonts);
  const t = plan.sub > 1 ? subframeTime(frame, plan.sub) : frame;
  const cam = camera2d(t, plan.camera.keys);
  const bg = plan.background;
  const bgStyle: React.CSSProperties = bg.type === 'solid' ? { background: bg.color } : bg.type === 'gradient' ? { background: `linear-gradient(${bg.angle ?? 180}deg, ${bg.from}, ${bg.to})` } : {};
  return (
    <PlanContext.Provider value={{ plan, t }}>
      <AbsoluteFill style={{ ...bgStyle, overflow: 'hidden', fontKerning: 'normal', WebkitFontSmoothing: 'antialiased' } as React.CSSProperties}>
        {plan.layers.map((L) => {
          if (t < L.inF || t >= L.outF) return null;
          const C = PATTERN_COMPONENTS[L.pattern];
          const c = parallax(cam, L.depth);
          return (
            <AbsoluteFill key={L.id} style={{ transform: plan.camera.keys.length ? cameraTransform(c) : undefined, transformOrigin: '50% 50%' }}>
              {L.fullBleed && L.overscan > 1
                // FULL-BLEED: escala derivada da câmera (exata para os frames renderizados) — nunca aplicada a outros patterns
                ? <AbsoluteFill style={{ transform: `scale(${L.overscan})`, transformOrigin: '50% 50%' }}><C L={L} /></AbsoluteFill>
                : <C L={L} />}
            </AbsoluteFill>
          );
        })}
        {!plan.transparent && plan.grain > 0 ? <Grain w={plan.width} h={plan.height} amount={plan.grain} seed={plan.seed} t={t} /> : null}
      </AbsoluteFill>
    </PlanContext.Provider>
  );
};
