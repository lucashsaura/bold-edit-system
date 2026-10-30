// Invariantes de segurança do BOLD Edit System.
// Não podem ser afrouxadas por projeto, usuário ou variável de ambiente.
// Qualquer tentativa é ignorada (o valor efetivo permanece o invariante) e registrada como violação.

export const INVARIANTS = Object.freeze({
  render_requires_explicit_authorization: true,
  export_requires_explicit_authorization: true,
  allow_open_page: false,
  delete_user_media: false,
  telemetry: false,
});

/**
 * Resolve a policy efetiva a partir de camadas ordenadas (menor → maior precedência).
 * @param {{origin: string, policy?: Record<string, unknown>}[]} layers
 * @returns {{effective: Readonly<Record<string, boolean>>, violations: {origin: string, key: string, attempted: unknown, enforced: boolean}[]}}
 */
export function resolvePolicy(layers = []) {
  const effective = { ...INVARIANTS };
  const violations = [];
  for (const { origin, policy } of layers) {
    if (!policy || typeof policy !== 'object') continue;
    for (const [key, value] of Object.entries(policy)) {
      if (key in INVARIANTS) {
        if (value !== INVARIANTS[key]) {
          violations.push({ origin, key, attempted: value, enforced: INVARIANTS[key] });
        }
        continue; // invariante: nunca muda
      }
      // Chaves não-invariantes: só endurecimento booleano é aceito (true = mais restritivo).
      if (typeof value !== 'boolean') {
        violations.push({ origin, key, attempted: value, enforced: effective[key] ?? null });
        continue;
      }
      if (effective[key] === true && value === false) {
        violations.push({ origin, key, attempted: value, enforced: true });
        continue;
      }
      effective[key] = value;
    }
  }
  return { effective: Object.freeze(effective), violations };
}

/** Lê tentativas de policy vindas de ENV (BOLD_POLICY_<CHAVE>=true|false). */
export function policyFromEnv(env = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('BOLD_POLICY_')) continue;
    const key = k.slice('BOLD_POLICY_'.length).toLowerCase();
    const s = String(v).trim().toLowerCase();
    out[key] = s === 'true' || s === '1' || s === 'yes' ? true : s === 'false' || s === '0' || s === 'no' ? false : v;
  }
  return out;
}
