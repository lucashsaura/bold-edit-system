// R8 + DaVinci = SOMENTE LEITURA. Única porta da R8 para o Resolve: allowlist de operações de LEITURA da Bridge V1
// (R7, congelada — usada sem alteração). Qualquer outra operação é recusada ANTES de chamar o Python.
// `inspect --timeline T` da Bridge lê sem trocar a timeline corrente; nenhuma operação daqui troca projeto/página.
import { runBridge, resolvePython, DavinciError } from '../davinci/bridge.mjs';

export const READ_ONLY_OPS = Object.freeze(['status', 'projects', 'timelines', 'inspect', 'media']);

export function davinciRead(op, args = {}, { config = {}, run = runBridge, python = null } = {}) {
  if (!READ_ONLY_OPS.includes(op)) throw new DavinciError('DAVINCI_WRITE_FORBIDDEN', `R8 é somente leitura no DaVinci: operação ${op} recusada`);
  const r = run(op, args, { python: python ?? resolvePython(config), davinciConfig: config.davinci || {} });
  if (!r.ok) throw new DavinciError(r.error.code, r.error.message, r.error.details);
  return r.result;
}

/** Contexto DaVinci opcional: Resolve fechado/API ausente → {available:false, reason} (o resto da R8 continua). */
export function davinciSnapshot({ timelines: wanted = 'current', config = {}, run, python } = {}) {
  const read = (op, a) => davinciRead(op, a, { config, run, python });
  let status;
  try { status = read('status'); } catch (e) { if (e instanceof DavinciError) return { available: false, reason: e.code }; throw e; }
  if (!status.project) return { available: true, status: slimStatus(status), timelines: [], inspected: [], media: [] };
  const tls = read('timelines');
  const names = wanted === 'all' ? tls.timelines.map((t) => t.name) : wanted === 'current' ? (tls.current ? [tls.current] : []) : [].concat(wanted);
  for (const n of names) if (!tls.timelines.some((t) => t.name === n)) throw new DavinciError('TIMELINE_NOT_FOUND', `timeline ${n} não existe no projeto aberto`);
  const inspected = names.map((n) => read('inspect', { timeline: n, brief: false }).timeline);
  const media = read('media', {}).items ?? [];
  return { available: true, status: slimStatus(status), current_timeline: tls.current, timelines: tls.timelines.map((t) => t.name), inspected, media };
}

const slimStatus = (s) => ({ product: s.product, version: s.version, page: s.page, project: s.project, timeline_count: s.timeline_count ?? 0, current_timeline: s.timeline?.name ?? null });
