// Ponte entre o delivery e o policy gate (R2). TODO comando que gera vídeo/sequência passa aqui.
// Não existe bypass: sem autorização estruturada válida → AuthorizationError, nada é gerado.

import { checkGate } from '../policy/gate.mjs';
import { appendAuthorizationRecord } from '../log/authorization-log.mjs';

export class AuthorizationError extends Error {
  constructor(reason, record) { super(`bloqueado pelo policy gate: ${reason}`); this.code = 'AUTH_DENIED'; this.record = record; }
}

/**
 * @param {{action: string, authorization: object|null, project?: string|null, command?: string,
 *          logDirs: {projectRoot?: string|null, cacheDir?: string|null}, now?: Date}} opts
 * @returns {object} registro gravado no log de autorização
 */
export function authorizeOrThrow({ action, authorization, project = null, command = null, logDirs, now = new Date() }) {
  if (!logDirs || (!logDirs.projectRoot && !logDirs.cacheDir)) throw new Error('logDirs obrigatório: o gate sempre registra a decisão');
  const r = checkGate({ action, authorization, project, command, now });
  const record = {
    ...r.record,
    granted_by: authorization?.granted_by ?? null,
    scope: authorization?.scope ?? null,
  };
  appendAuthorizationRecord(record, logDirs);
  if (!r.allowed) throw new AuthorizationError(r.reason, record);
  return record;
}
