// Contexto de render: plano + tempo em frames de SAÍDA (fracionário em sub-frames).
import React from 'react';
import type { Plan } from '../core/spec.ts';

export interface RenderCtx { plan: Plan; t: number }
export const PlanContext = React.createContext<RenderCtx | null>(null);
export function usePlan(): RenderCtx {
  const v = React.useContext(PlanContext);
  if (!v) throw new Error('PlanContext ausente');
  return v;
}
