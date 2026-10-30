// EARSHOT (Leonxlnx/earshot, MIT) — adaptador OPCIONAL: análise (describe, match, measure, timeline, critique) e geração
// procedural (sfx render/list). Roda o binário da venv isolada com um ambiente MÍNIMO: offline (nunca baixa modelos ao
// iniciar), sem telemetria, sem chaves (GEMINI_API_KEY/GOOGLE_API_KEY/HF_TOKEN nunca chegam ao processo).
// `earshot llm` (envia áudio ao Google) e consent/--yes-upload são PROIBIDOS aqui. Sem Earshot, o BOLD funciona igual.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AudioError } from './errors.mjs';

export const ALLOWED = Object.freeze(['doctor', 'describe', 'match', 'measure', 'timeline', 'critique', 'compare', 'ab', 'realness', 'find', 'sfx']);
export const SFX_SUB = Object.freeze(['list', 'render', 'check']);

/** Ambiente do processo filho: só o necessário (PATH com o ffmpeg do BOLD), modelos na casa da instalação. */
export function earshotEnv(loc, { ffmpeg = null, threads = 3, env = process.env } = {}) {
  const dirs = [ffmpeg ? path.dirname(ffmpeg) : null, '/usr/bin', '/bin'].filter(Boolean);
  const e = { PATH: dirs.join(path.delimiter), HOME: env.HOME ?? '', LANG: 'en_US.UTF-8', TMPDIR: loc.temp ?? env.TMPDIR ?? '/tmp',
    EARSHOT_HOME: loc.home, HF_HOME: path.join(loc.home, 'hf-home'), EARSHOT_OFFLINE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
    EARSHOT_THREADS: String(threads), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    MPLCONFIGDIR: path.join(loc.home, 'mpl'), XDG_CACHE_HOME: path.join(loc.home, 'xdg-cache'), TORCH_HOME: path.join(loc.home, 'torch') };   // nenhum cache fora da casa do Earshot
  if (process.platform === 'win32') { e.SystemRoot = env.SystemRoot ?? ''; e.USERPROFILE = env.USERPROFILE ?? ''; }
  return e;
}

/** Executa `earshot <args> --json`. Recusa comandos fora da lista (llm, mcp, gallery, forge…). */
export function runEarshot(loc, args, { ffmpeg = null, timeoutMs = 10 * 60_000, cwd = null } = {}) {
  if (!loc?.found && loc?.offline) throw new AudioError('STORAGE_OFFLINE', `Earshot está no armazenamento externo, indisponível agora (${loc.offline.detail}): ${loc.offline.recover}`);
  if (!loc?.found) throw new AudioError('EARSHOT_MISSING', 'Earshot não instalado (opcional): bold audio setup earshot mostra o plano');
  const [cmd, sub] = args;
  if (!ALLOWED.includes(cmd)) throw new AudioError('EARSHOT_REFUSED', `comando earshot "${cmd}" não é usado pelo BOLD (permitidos: ${ALLOWED.join(', ')})`);
  if (cmd === 'sfx' && !SFX_SUB.includes(sub)) throw new AudioError('EARSHOT_REFUSED', `earshot sfx ${sub}: só ${SFX_SUB.join('/')}`);
  if (args.some((a) => /^--?(yes-upload|fetch)$/.test(a) || /consent/i.test(a))) throw new AudioError('EARSHOT_REFUSED', 'upload/consent/--fetch nunca são passados pelo BOLD');
  const full = cmd === 'doctor' ? args : [...args, '--json'];
  const p = spawnSync(loc.bin, full, { encoding: 'utf8', env: earshotEnv(loc, { ffmpeg }), timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, cwd: cwd ?? loc.home });
  if (p.error) throw new AudioError('EARSHOT_FAILED', p.error.message);
  const out = String(p.stdout);
  if (p.status !== 0) throw new AudioError('EARSHOT_FAILED', `earshot ${cmd} saiu com ${p.status}: ${String(p.stderr).split('\n').filter((l) => l && !/^W\d{4}/.test(l)).slice(-2).join(' | ')}`);
  if (cmd === 'doctor') return { text: out };
  const i = out.indexOf('{'); const j = out.indexOf('[');
  const start = i < 0 ? j : j < 0 ? i : Math.min(i, j);
  try { return JSON.parse(out.slice(start)); } catch (e) { throw new AudioError('EARSHOT_FAILED', `saída JSON inválida: ${e.message}`); }
}

/** Estado sem executar o Python: venv, proveniência, modelos fixados presentes na casa da instalação. */
export function earshotStatus(loc) {
  if (!loc.found) return { installed: false, dir: loc.dir, ...(loc.offline ? { offline: true, storage: loc.offline } : {}) };
  let prov = null; try { prov = loc.provenance ? JSON.parse(fs.readFileSync(loc.provenance, 'utf8')) : null; } catch { /* ilegível */ }
  const models = {};
  for (const [id, m] of Object.entries(prov?.models ?? {})) {
    const w = path.join(loc.home, 'hf', `models--${id.replace('/', '--')}`, 'snapshots', m.revision, m.weights);
    models[id] = { revision: m.revision.slice(0, 7), present: fs.existsSync(w) };
  }
  // a venv grava caminhos absolutos: criada em outro lugar (cópia/migração sem recriar) → não confiável
  let venvOk = null; try { venvOk = fs.readFileSync(loc.bin, 'utf8').slice(0, 600).includes(path.join(loc.dir, '.venv', 'bin', 'python')); } catch { /* ilegível */ }
  return { installed: true, dir: loc.dir, home: loc.home, source: loc.source, venv_path_ok: venvOk, version: prov?.version ?? null, commit: prov?.source?.commit ?? null, models, models_ready: Object.values(models).length > 0 && Object.values(models).every((m) => m.present), mcp_registered: prov?.mcp?.registered ?? false };
}

/** Geração procedural: earshot sfx render ID -o arquivo (nunca sobrescreve). */
export function renderProcedural(loc, id, outFile, { dur = null, apex = null, pitch = null, seed = null, ffmpeg = null } = {}) {
  if (!/^[a-z0-9_.]+(\/[a-z0-9_.]+)+$/i.test(id)) throw new AudioError('USAGE', `id procedural inválido: ${id}`);
  if (fs.existsSync(outFile)) throw new AudioError('OUTPUT_EXISTS', `já existe (nunca sobrescrevo): ${path.basename(outFile)}`);
  const a = ['sfx', 'render', id, '-o', outFile, '--sr', '48000'];
  if (dur) a.push('--dur', String(dur)); if (apex) a.push('--apex', String(apex)); if (pitch) a.push('--pitch', String(pitch)); if (seed !== null) a.push('--seed', String(seed));
  return runEarshot(loc, a, { ffmpeg });
}
