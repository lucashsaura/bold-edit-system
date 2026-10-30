// CLI EXECUTION GATE
//
// Separação de responsabilidades:
//   - USER/AGENT AUTHORIZATION: a Skill/agente decide se o usuário autorizou explicitamente
//     (ver authorization-language.mjs, que é material de apoio do AGENTE).
//   - CLI EXECUTION GATE (este arquivo): exige uma confirmação ESTRUTURADA para ações protegidas
//     e produz um registro auditável. O gate NUNCA interpreta linguagem natural: o campo `text`
//     é só registrado, jamais analisado.

import { INVARIANTS } from './invariants.mjs';

/** Ações protegidas → chave de policy que as protege. */
export const PROTECTED_ACTIONS = Object.freeze({
  render: 'render_requires_explicit_authorization',
  'preview-video': 'render_requires_explicit_authorization',
  encode: 'render_requires_explicit_authorization',
  export: 'export_requires_explicit_authorization',
  deliver: 'export_requires_explicit_authorization',
});

/** Ações proibidas sempre, com ou sem autorização (invariantes). */
export const FORBIDDEN_ACTIONS = Object.freeze({
  'open-page': 'allow_open_page=false (invariante)',
  'delete-user-media': 'delete_user_media=false (invariante)',
  'enable-telemetry': 'telemetry=false (invariante)',
});

/** Origens aceitas para uma autorização estruturada. */
export const AUTHORIZATION_SOURCES = Object.freeze([
  'interactive_confirmation', // humano confirmou num prompt TTY do próprio CLI
  'agent_attested_user_message', // agente atesta mensagem explícita do usuário (texto obrigatório)
]);

export const DEFAULT_MAX_AGE_MINUTES = 60;

/**
 * @typedef {Object} Authorization
 * @property {string|string[]} action           ação(ões) autorizada(s)
 * @property {string} source                    uma de AUTHORIZATION_SOURCES
 * @property {string} granted_at                ISO-8601
 * @property {string} [text]                    citação do usuário (obrigatória para agent_attested_user_message)
 * @property {string} [project]                 project_id ao qual a autorização se aplica
 * @property {string} [target]                  alvo (ex.: id da composição)
 */

/**
 * Avalia o gate. Função pura (sem I/O).
 * @returns {{allowed: boolean, protected: boolean, reason: string, record: object}}
 */
export function checkGate({
  action,
  authorization = null,
  policy = INVARIANTS,
  project = null,
  command = null,
  now = new Date(),
  maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES,
} = {}) {
  const record = {
    action,
    timestamp: now.toISOString(),
    project: project ?? null,
    authorization_source: authorization?.source ?? null,
    authorization_text: typeof authorization?.text === 'string' && authorization.text.length ? authorization.text : null,
    command: command ?? null,
    allowed: false,
    reason: '',
  };
  const done = (allowed, isProtected, reason) => {
    record.allowed = allowed;
    record.reason = reason;
    return { allowed, protected: isProtected, reason, record };
  };

  if (!action || typeof action !== 'string') return done(false, true, 'ação ausente ou inválida');

  if (action in FORBIDDEN_ACTIONS) {
    return done(false, true, `ação proibida: ${FORBIDDEN_ACTIONS[action]}`);
  }

  const policyKey = PROTECTED_ACTIONS[action];
  if (!policyKey) return done(true, false, 'ação não protegida');

  // Invariante: mesmo que alguém passe uma policy "afrouxada", a exigência permanece.
  const requires = INVARIANTS[policyKey] === true || policy?.[policyKey] === true;
  if (!requires) return done(false, true, 'policy inconsistente: invariante ausente — negado por segurança');

  if (!authorization || typeof authorization !== 'object') {
    return done(false, true, 'autorização estruturada ausente');
  }
  const actions = Array.isArray(authorization.action) ? authorization.action : [authorization.action];
  if (!actions.includes(action)) {
    return done(false, true, `autorização não cobre a ação "${action}"`);
  }
  if (!AUTHORIZATION_SOURCES.includes(authorization.source)) {
    return done(false, true, `origem de autorização inválida: ${String(authorization.source)}`);
  }
  if (authorization.source === 'agent_attested_user_message'
      && !(typeof authorization.text === 'string' && authorization.text.trim().length > 0)) {
    return done(false, true, 'agent_attested_user_message exige o texto da mensagem do usuário');
  }
  const granted = Date.parse(authorization.granted_at);
  if (Number.isNaN(granted)) return done(false, true, 'granted_at ausente ou inválido');
  if (granted - now.getTime() > 60_000) return done(false, true, 'granted_at no futuro');
  if (now.getTime() - granted > maxAgeMinutes * 60_000) {
    return done(false, true, `autorização expirada (> ${maxAgeMinutes} min)`);
  }
  if (authorization.project && project && authorization.project !== project) {
    return done(false, true, `autorização é do projeto "${authorization.project}", não de "${project}"`);
  }
  return done(true, true, 'autorização estruturada válida');
}

/** Converte o argumento do CLI (JSON inline ou conteúdo de arquivo) em Authorization. */
export function parseAuthorization(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('autorização deve ser um objeto JSON');
  return obj;
}

/**
 * Confirmação interativa humana (UX sem "frase mágica"): mostra ação + comando e pede s/N.
 * `io.ask(question) → Promise<string>`, `io.isTTY` boolean.
 */
export async function interactiveConfirmation({ action, command, project = null, io, now = () => new Date() }) {
  if (!io?.isTTY) return null; // sem terminal interativo não há confirmação humana
  const answer = await io.ask(`Ação protegida: ${action.toUpperCase()}${project ? ` [${project}]` : ''}\n  ${command}\nConfirmar? [s/N] `);
  if (!/^\s*(s|sim|y|yes)\s*$/i.test(answer || '')) return null;
  return { action, source: 'interactive_confirmation', granted_at: now().toISOString(), project: project ?? undefined };
}
