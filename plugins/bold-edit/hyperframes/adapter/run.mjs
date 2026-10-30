// Execução CONTROLADA do CLI HyperFrames externo (R6.0.1 — camada de validação, NÃO é o backend).
// Toda execução: env de opt-out (HF3), cache de fontes ISOLADO (HYPERFRAMES_FONT_CACHE_DIR temporário; o cache
// histórico do usuário nunca é lido nem escrito), NETWORK GUARD pré-carregado em todo processo Node (NODE_OPTIONS),
// e — para render — policy gate (autorização estruturada) ANTES de iniciar qualquer processo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authorizeOrThrow } from '../../core/delivery/authorize.mjs';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'net-guard.mjs');

export function policyEnv(base, { fontCacheDir, netLog, procLog = null }) {
  if (!fontCacheDir) throw new Error('fontCacheDir obrigatório (cache isolado por execução)');
  const env = { ...base,
    HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', HYPERFRAMES_SKIP_SKILLS: '1', CI: 'true',
    HYPERFRAMES_FONT_CACHE_DIR: fontCacheDir, BOLD_NET_GUARD_LOG: netLog, ...(procLog ? { BOLD_NET_GUARD_PROC_LOG: procLog } : {}),
    // R6.2: o prettier (dependência do CLI) ligaria o compile cache do Node em os.tmpdir() — nada fora do job
    NODE_DISABLE_COMPILE_CACHE: '1',
    NODE_OPTIONS: `${base.NODE_OPTIONS ? `${base.NODE_OPTIONS} ` : ''}--import ${pathToFileURL(GUARD).href}` };
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'HEYGEN_API_KEY', 'PRODUCER_BROWSER_GPU_MODE', 'HYPERFRAMES_BROWSER_PATH', 'PRODUCER_HEADLESS_SHELL_PATH']) delete env[k];
  return env;
}

export function netAttempts(netLog) {
  if (!netLog || !fs.existsSync(netLog)) return [];
  return fs.readFileSync(netLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Roda um subcomando do CLI fixado. Comandos de rede (HF4) são recusados aqui. */
export function runHF(det, args, { cwd, fontCacheDir, netLog, procLog = null, env = process.env, timeout = 300000 }) {
  const FORBIDDEN = new Set(['publish', 'cloud', 'auth', 'lambda', 'cloudrun', 'capture', 'figma', 'models', 'add', 'catalog', 'upgrade', 'skills', 'feedback', 'telemetry', 'events', 'tts', 'transcribe', 'remove-background', 'browser']);
  if (FORBIDDEN.has(args[0])) throw new Error(`comando HyperFrames proibido (HF4): ${args[0]}`);
  const bin = path.join(det.nm, 'hyperframes', 'bin', 'hyperframes.mjs');
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env: policyEnv(env, { fontCacheDir, netLog, procLog }), encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ?? null, net: netAttempts(netLog) };
}

/**
 * Render PNG SEQUENCE (HF2) — `--format png-sequence --strict --no-browser-gpu`. A autorização estruturada é checada
 * ANTES (sem ela, nenhum processo é iniciado e nada é criado). Qualquer tentativa de rede registrada → FAIL.
 */
export function renderPngSequence(det, { projectDir, outDir, fps, authorization, logDirs, fontCacheDir, netLog, procLog = null }) {
  authorizeOrThrow({ action: 'render', authorization, command: 'hyperframes render --format png-sequence', logDirs });
  if (fs.existsSync(outDir)) throw new Error(`saída já existe (nunca sobrescrevo): ${path.basename(outDir)}`);
  const r = runHF(det, ['render', '.', '--format', 'png-sequence', '--strict', '--no-browser-gpu', '--fps', String(fps), '-o', outDir], { cwd: projectDir, fontCacheDir, netLog, procLog });
  const failed = r.status !== 0 || r.net.length > 0;
  return { ...r, status_code: r.status, status: failed ? 'FAIL' : 'PASS', reason: r.net.length ? `tentativa de rede: ${r.net.map((n) => `${n.kind}→${n.target}`).join(', ')}` : r.status !== 0 ? `exit ${r.status}` : null };
}
