// Registro da ÚNICA composição genérica. Dimensões, fps e duração vêm do plano (inputProps).
import React from 'react';
import { Composition } from 'remotion';
import { SpecComposition } from './components/SpecComposition.tsx';
import type { Plan } from './core/spec.ts';

export const COMPOSITION_ID = 'BoldSpec';

export const Root: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={SpecComposition as unknown as React.FC<Record<string, unknown>>}
    durationInFrames={1}
    fps={24}
    width={16}
    height={16}
    defaultProps={{ plan: null as unknown as Plan }}
    calculateMetadata={({ props }) => {
      const plan = (props as unknown as { plan: Plan }).plan;
      if (!plan) throw new Error('inputProps.plan ausente');
      return { durationInFrames: plan.frames * plan.sub, fps: plan.fps * plan.sub, width: plan.width, height: plan.height };
    }}
  />
);
