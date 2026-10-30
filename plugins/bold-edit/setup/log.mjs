// Log do setup (R12): JSONL append-only em <toolchain>/logs/, SEM SEGREDOS.
// Nunca registra o ambiente inteiro; redige chaves sensíveis, tokens conhecidos, credenciais e query strings de URL; HOME → "~".
import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /(token|secret|passw(or)?d|passwd|api[_-]?key|authorization|auth|cookie|credential|session|private[_-]?key)/i;
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function redactString(s, { home } = {}) {
  let out = String(s);
  out = out.replace(/\b(https?:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi, '$1[REDACTED]@');           // credenciais na URL
  out = out.replace(/\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]');                 // query string
  for (const rx of TOKEN_PATTERNS) out = out.replace(rx, '[REDACTED]');
  if (home) out = out.split(home).join('~');
  return out;
}

export function redact(value, opts = {}, depth = 0) {
  if (depth > 8) return '[…]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value, opts);
  if (Array.isArray(value)) return value.map((v) => redact(v, opts, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, opts, depth + 1);
    return out;
  }
  return '[unsupported]';
}

export const logsDir = (root) => path.join(root, 'logs');

/** Acrescenta um evento ao log do dia. `env` nunca é aceito como campo. */
export function appendSetupLog(root, event, { home, now = new Date() } = {}) {
  const { env: _drop, ...rest } = event || {};
  const line = redact({ ts: now.toISOString(), ...rest }, { home });
  const dir = logsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `setup-${now.toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8');
  return file;
}
