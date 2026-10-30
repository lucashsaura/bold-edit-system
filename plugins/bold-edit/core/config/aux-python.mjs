// Ambiente ISOLADO do Python AUXILIAR do BOLD (R12.5C1B) — o Python gerenciado com Pillow (tools.PYTHON_AUX_PATH).
// Os binários do Python auxiliar são ad-hoc (sem hardened runtime), então o processo NUNCA herda variáveis que injetam
// código ou mudam o interpretador: DYLD_* (injeção de dylib), LD_* e PYTHON* (PYTHONPATH/PYTHONHOME/PYTHONSTARTUP…).
// O ambiente é montado por ALLOWLIST (não por remoção). Sempre junto com `-I` (modo isolado) na linha de comando.
// NÃO se aplica ao Python da DaVinci Bridge (tools.PYTHON_PATH), que segue o fluxo próprio, inalterado.

export const AUX_ENV_ALLOW = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME', 'SystemRoot', 'USERPROFILE', 'TEMP', 'TMP']);
export const AUX_ENV_DENY = /^(DYLD_|LD_|PYTHON)/i;
export const AUX_PYTHON_FLAGS = Object.freeze(['-I']);

/** Copia só as variáveis permitidas de `env` e acrescenta `extra`; qualquer DYLD_/LD_/PYTHON* é descartada (inclusive em extra). */
export function auxPythonEnv(env = process.env, extra = {}) {
  const out = {};
  for (const k of AUX_ENV_ALLOW) if (env[k] !== undefined && env[k] !== null) out[k] = String(env[k]);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) out[k] = String(v);
  for (const k of Object.keys(out)) if (AUX_ENV_DENY.test(k)) delete out[k];
  return out;
}
