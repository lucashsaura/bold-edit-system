// Limpeza de variáveis de INJEÇÃO no ambiente de processos filhos (R12.5C3b-A).
// O Node 24 oficial tem `com.apple.security.cs.allow-dyld-environment-variables`: mesmo com hardened runtime, DYLD_*
// injeta bibliotecas. NODE_OPTIONS alheio (--require/--import) injeta código em todo processo Node filho (o HyperFrames
// roda no Node do BOLD). LD_* não tem efeito no macOS, mas é removido por coerência entre plataformas.
// A CLI limpa o próprio process.env na entrada → TODO filho herda o ambiente limpo, inclusive o HyperFrames Core
// (congelado), cujo runHF usa process.env por padrão. O net-guard do Core é acrescentado DEPOIS, pelo próprio policyEnv.

export const INJECTION_VAR = /^(DYLD_|LD_)/;
export const INJECTION_EXACT = Object.freeze(['NODE_OPTIONS']);
export const isInjectionVar = (k) => INJECTION_VAR.test(k) || INJECTION_EXACT.includes(k);

/** Cópia de `env` sem variáveis de injeção. */
export function stripInjection(env = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!isInjectionVar(k)) out[k] = v;
  return out;
}

/** Remove, NO PRÓPRIO objeto (ex.: process.env), as variáveis de injeção. Retorna os nomes removidos (para log). */
export function sanitizeProcessEnv(env = process.env) {
  const removed = [];
  for (const k of Object.keys(env)) if (isInjectionVar(k)) { removed.push(k); delete env[k]; }
  return removed;
}
