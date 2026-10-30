// Autorização HUMANA para escrever em projeto REAL do Resolve (ação `davinci-write`). O agente só a grava depois de
// constatar uma mensagem explícita do usuário com projeto + timeline + operação. O CLI valida a estrutura e o escopo,
// registra no log de autorização e NUNCA interpreta linguagem natural. Sandbox (BOLD_BRIDGE_SANDBOX*) não precisa.
import { AUTHORIZATION_SOURCES, DEFAULT_MAX_AGE_MINUTES } from '../policy/gate.mjs';
import { appendAuthorizationRecord } from '../log/authorization-log.mjs';
import { DavinciError } from './bridge.mjs';

export const SANDBOX_PROJECT_RE = /^BOLD_BRIDGE_SANDBOX(?:_[A-Za-z0-9-]{1,32})?$/;
/** Operações destrutivas: exigem autorização com `davinci.operations` citando-as explicitamente. */
export const EXPLICIT_OPERATIONS = Object.freeze(['delete']);

export function checkDavinciWrite({ authorization, project, timeline, operation, logDirs, now = new Date() }) {
  const sandbox = SANDBOX_PROJECT_RE.test(project ?? '');
  const record = { action: 'davinci-write', timestamp: now.toISOString(), project, timeline, operation, sandbox, authorization_source: authorization?.source ?? null,
    authorization_text: authorization?.text ?? null, granted_by: authorization?.granted_by ?? null, allowed: false, reason: null, scope: `davinci:${operation}`, command: `bold davinci ${operation} --timeline ${JSON.stringify(timeline ?? null)}` };
  const deny = (code, reason) => { record.reason = reason; if (logDirs) appendAuthorizationRecord(record, logDirs); throw new DavinciError(code, reason); };
  if (sandbox) { record.allowed = true; record.reason = 'sandbox da Bridge (gates técnicos)'; if (logDirs) appendAuthorizationRecord(record, logDirs); return { mode: 'sandbox', authorization: null }; }
  const a = authorization;
  if (!a || typeof a !== 'object') deny('REAL_PROJECT_WRITE_DENIED', 'projeto não-sandbox: write exige autorização humana estruturada davinci-write');
  const actions = Array.isArray(a.action) ? a.action : [a.action];
  if (!actions.includes('davinci-write')) deny('REAL_PROJECT_WRITE_DENIED', 'autorização não inclui davinci-write');
  if (!AUTHORIZATION_SOURCES.includes(a.source)) deny('AUTHORIZATION_INVALID', 'source inválida');
  if (a.source === 'agent_attested_user_message' && !(typeof a.text === 'string' && a.text.trim())) deny('AUTHORIZATION_INVALID', 'texto literal do usuário obrigatório');
  const t = Date.parse(a.granted_at ?? '');
  if (!Number.isFinite(t) || now - t > DEFAULT_MAX_AGE_MINUTES * 60000 || t - now > 60000) deny('AUTHORIZATION_EXPIRED', `autorização ausente/expirada (máx. ${DEFAULT_MAX_AGE_MINUTES} min)`);
  const s = a.davinci ?? {};
  if (s.project !== project || s.timeline !== timeline) deny('AUTHORIZATION_SCOPE_MISMATCH', 'a autorização não cobre este projeto/timeline');
  if (Array.isArray(s.operations) && !s.operations.includes(operation)) deny('AUTHORIZATION_SCOPE_MISMATCH', `operação ${operation} fora do escopo autorizado`);
  // destrutivas: a lista de operações é OBRIGATÓRIA e precisa citar a operação (autorização genérica não vale)
  if (EXPLICIT_OPERATIONS.includes(operation) && !(Array.isArray(s.operations) && s.operations.includes(operation))) deny('AUTHORIZATION_SCOPE_MISMATCH', `${operation} exige autorização que liste a operação explicitamente`);
  record.allowed = true; record.reason = 'autorização humana davinci-write válida'; if (logDirs) appendAuthorizationRecord(record, logDirs);
  return { mode: 'authorized_real_project', authorization: { action: ['davinci-write'], davinci: { project, timeline, operations: [operation] } } };
}
