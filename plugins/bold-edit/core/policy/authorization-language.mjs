// MATERIAL DE APOIO DA CAMADA SKILL/AGENTE — NÃO é usado pelo CLI.
//
// O CLI nunca infere intenção de linguagem natural (ver gate.mjs). Este módulo codifica,
// de forma testável, as regras que o agente segue ao ler a mensagem do usuário:
//   - palavras de fluxo ("finalize", "integre", "aplique", "feche", "deixe pronto", "faça QC", "siga")
//     NUNCA autorizam render/export;
//   - verbos explícitos ("renderize", "pode renderizar", "exporte", "pode exportar") são
//     CANDIDATOS: o agente ainda precisa confirmar pelo contexto (o quê, qual alvo, sem negação).
// O resultado nunca é uma autorização; é uma avaliação para o agente decidir.

const strip = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const NON_AUTHORIZING_PHRASES = Object.freeze([
  'finalize', 'finalizar', 'finaliza',
  'integre', 'integrar', 'integra',
  'aplique', 'aplicar', 'aplica',
  'feche', 'fechar', 'fecha',
  'deixe pronto', 'deixar pronto', 'deixa pronto',
  'faca qc', 'fazer qc', 'faz qc', 'qc',
  'siga', 'seguir', 'pode seguir', 'continue', 'continuar',
  'ok', 'aprovado', 'aprovada',
  'finish', 'integrate', 'apply', 'wrap up', 'make it ready', 'do qc', 'go ahead', 'proceed',
]);

export const EXPLICIT_PHRASES = Object.freeze({
  render: Object.freeze(['renderize', 'renderizar', 'renderiza', 'renderizem', 'pode renderizar', 'render', 'please render']),
  export: Object.freeze(['exporte', 'exportar', 'exporta', 'exportem', 'pode exportar', 'export', 'please export']),
});

const NEGATIONS = ['nao', 'nunca', 'sem', 'jamais', 'nem', "don't", 'dont', 'do not', 'never', 'not', 'no'];

function findPhrase(text, phrase) {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'gu');
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push(m.index + m[1].length);
  return hits;
}

function negatedAt(text, index) {
  const before = text.slice(Math.max(0, index - 24), index);
  return NEGATIONS.some((n) => new RegExp(`(^|[^\\p{L}])${n}(\\s+\\p{L}+){0,2}\\s*$`, 'u').test(before));
}

/**
 * @param {string} message mensagem do usuário
 * @returns {{render: 'explicit_candidate'|'none', export: 'explicit_candidate'|'none',
 *            matched: string[], negated: string[], non_authorizing: string[], note: string}}
 */
export function assessAuthorizationLanguage(message) {
  const text = strip(String(message || ''));
  const result = { render: 'none', export: 'none', matched: [], negated: [], non_authorizing: [], note: '' };
  for (const phrase of NON_AUTHORIZING_PHRASES) {
    if (findPhrase(text, phrase).length) result.non_authorizing.push(phrase);
  }
  for (const [kind, phrases] of Object.entries(EXPLICIT_PHRASES)) {
    for (const phrase of phrases) {
      for (const idx of findPhrase(text, phrase)) {
        if (negatedAt(text, idx)) { result.negated.push(phrase); continue; }
        result[kind] = 'explicit_candidate';
        result.matched.push(phrase);
      }
    }
  }
  result.note = 'Avaliação para o agente. Não é autorização. O CLI exige confirmação estruturada e não usa esta função.';
  return result;
}
