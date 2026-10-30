// Registro auditável das decisões do gate (JSONL, append-only).
// Local: <PROJECT_ROOT>/.bold/logs/authorizations.jsonl, ou <CACHE_DIR>/logs/ sem projeto.
// Ambos ficam fora do repositório (.bold/ e logs/ estão no .gitignore).

import fs from 'node:fs';
import path from 'node:path';

export const LOG_FILE = 'authorizations.jsonl';

export function authorizationLogDir({ projectRoot = null, cacheDir = null } = {}) {
  if (projectRoot) return path.join(projectRoot, '.bold', 'logs');
  if (cacheDir) return path.join(cacheDir, 'logs');
  throw new Error('sem PROJECT_ROOT nem CACHE_DIR para o log de autorização');
}

// `scope` e `granted_by` são opcionais (R4): ex. granted_by=USER, scope=R4_SYNTHETIC_TEST_RENDER.
const FIELDS = ['action', 'timestamp', 'project', 'authorization_source', 'authorization_text', 'granted_by', 'scope', 'command', 'allowed', 'reason'];

export function appendAuthorizationRecord(record, dirs) {
  const dir = authorizationLogDir(dirs);
  fs.mkdirSync(dir, { recursive: true });
  const line = {};
  for (const f of FIELDS) line[f] = record?.[f] ?? null;
  const file = path.join(dir, LOG_FILE);
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8');
  return file;
}

export function readAuthorizationLog(dirs) {
  const file = path.join(authorizationLogDir(dirs), LOG_FILE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
