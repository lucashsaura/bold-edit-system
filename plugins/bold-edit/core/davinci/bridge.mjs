// Ponte Node → Bridge Python (davinci/). `python3 -m davinci.bridge.cli <op> '<json>'` → 1 linha JSON.
// O Node NUNCA fala com o Resolve diretamente; toda regra de segurança de escrita mora na Bridge (guards) E é
// reforçada aqui (escopo/autorização) antes de chamar.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export class DavinciError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }

/** Python ≥ 3.10: tools.PYTHON_PATH (config/ENV) ou o primeiro candidato do PATH (mesma ordem do doctor). */
export function resolvePython(config = {}, env = process.env) {
  const configured = env.BOLD_PYTHON_PATH || config.tools?.PYTHON_PATH;
  const cands = configured && configured !== 'auto' ? [configured] : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'];
  for (const c of cands) {
    try {
      const v = execFileSync(c, ['-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env }).trim().split('.').map(Number);
      if (v[0] === 3 && v[1] >= 10) return c;
    } catch { /* próximo */ }
  }
  throw new DavinciError('PYTHON_NOT_FOUND', 'Python ≥ 3.10 não encontrado (defina tools.PYTHON_PATH)');
}

export function runBridge(op, args = {}, { python, env = process.env, timeout = 120000, davinciConfig = {} } = {}) {
  const e = { ...env, PYTHONPATH: ROOT, PYTHONDONTWRITEBYTECODE: '1' };
  if (davinciConfig.DAVINCI_SCRIPT_API && davinciConfig.DAVINCI_SCRIPT_API !== 'auto' && !e.RESOLVE_SCRIPT_API) e.RESOLVE_SCRIPT_API = davinciConfig.DAVINCI_SCRIPT_API;
  if (davinciConfig.DAVINCI_SCRIPT_LIB && davinciConfig.DAVINCI_SCRIPT_LIB !== 'auto' && !e.RESOLVE_SCRIPT_LIB) e.RESOLVE_SCRIPT_LIB = davinciConfig.DAVINCI_SCRIPT_LIB;
  const r = spawnSync(python, ['-m', 'davinci.bridge.cli', op, JSON.stringify(args)], { cwd: ROOT, env: e, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new DavinciError('BRIDGE_SPAWN_FAILED', r.error.message);
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  let out; try { out = JSON.parse(line); } catch { throw new DavinciError('BRIDGE_BAD_OUTPUT', `saída inválida da Bridge (exit ${r.status})`, (r.stderr || r.stdout || '').slice(-1500)); }
  return out;
}

/** Pedido de integração de motion (R7 → futuro): {schema:"bold.davinci.motion_request/1", project, timeline, motion_master, track, start_frame, duration?}. */
export function validateMotionRequest(req, baseDir = process.cwd()) {
  const errs = [];
  if (!req || req.schema !== 'bold.davinci.motion_request/1') errs.push('schema: "bold.davinci.motion_request/1"');
  for (const k of ['project', 'timeline', 'motion_master']) if (typeof req?.[k] !== 'string' || !req[k]) errs.push(`${k}: string obrigatória`);
  if (!Number.isInteger(req?.track) || req.track < 1) errs.push('track: inteiro ≥ 1');
  if (!Number.isInteger(req?.start_frame) || req.start_frame < 0) errs.push('start_frame: inteiro ≥ 0 (frames desde o início da timeline)');
  if (req?.duration !== undefined && !(Number.isInteger(req.duration) && req.duration > 0)) errs.push('duration: inteiro > 0');
  for (const k of Object.keys(req ?? {})) if (!['schema', 'project', 'timeline', 'motion_master', 'track', 'start_frame', 'duration'].includes(k)) errs.push(`${k}: propriedade não suportada`);
  if (errs.length) throw new DavinciError('REQUEST_INVALID', 'motion request inválido', errs);
  const master = path.resolve(baseDir, req.motion_master);
  if (!fs.existsSync(master)) throw new DavinciError('MEDIA_MISSING', 'motion_master não existe', { motion_master: req.motion_master });
  // manifest do BOLD Delivery ao lado do master: confere integridade (o master é o que o Delivery entregou)
  const man = master.replace(/\.[^.]+$/, '.delivery.json');
  let delivery = null;
  if (fs.existsSync(man)) {
    const m = JSON.parse(fs.readFileSync(man, 'utf8'));
    const got = crypto.createHash('sha256').update(fs.readFileSync(master)).digest('hex');
    if (m.output_sha256 && m.output_sha256 !== got) throw new DavinciError('MASTER_HASH_MISMATCH', 'o master não confere com o manifest do BOLD Delivery', { manifest: path.basename(man) });
    delivery = { manifest: path.basename(man), profile: m.profile?.id ?? null, frames: m.actual_frames ?? null, fps: m.fps ?? null, sha256: got, alpha: m.alpha?.mode ?? null };
  }
  return { master, delivery };
}
