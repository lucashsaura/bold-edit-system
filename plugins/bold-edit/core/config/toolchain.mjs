// TOOLCHAIN GERENCIADO (R12): leitura dos ponteiros active.json → camada de config e PATH de processo.
// SOMENTE LEITURA. Quem grava active.json é o engine do `bold setup` (setup/engine.mjs).
// Precedência efetiva das ferramentas: ENV BOLD_* > projeto > usuário (caminho explícito) > toolchain gerenciado > "auto" (PATH).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schema/validate.mjs';
import { toolchainRoot, pathApi } from './paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ACTIVE_FILE = 'active.json';
export const NODE_POINTER = 'node.path';
const RECEIPT_FILE = 'receipt.json';

/**
 * Binário gerenciado → chave de config (tools.*).
 * R12.4: NENHUM binário gerenciado alimenta tools.PYTHON_PATH (Python da DaVinci Bridge) — o Python gerenciado
 * (com Pillow) é AUXILIAR e vai para tools.PYTHON_AUX_PATH. A Bridge continua no Python do sistema/configurado.
 */
export const BIN_TO_CONFIG = Object.freeze({
  node: 'NODE_PATH',
  ffmpeg: 'FFMPEG_PATH',
  ffprobe: 'FFPROBE_PATH',
  'python-aux': 'PYTHON_AUX_PATH',
  'whisper-cli': 'WHISPER_CLI',
  hyperframes: 'HYPERFRAMES_CMD',
});
/**
 * R12.5C2: binários gerenciados que NUNCA entram no PATH do processo — só por caminho absoluto via config.
 * O Python auxiliar no PATH faria a DaVinci Bridge (tools.PYTHON_PATH = "auto" → primeiro python3 do PATH) usá-lo,
 * e o seu bin/ traz também pip/python3/pydoc. A Bridge continua no Python do sistema/configurado.
 * HyperFrames (R12.5C3a): só por caminho absoluto (tools.HYPERFRAMES_CMD) e BOLD_HYPERFRAMES_NODE_MODULES — o
 * node_modules/.bin sombrearia ferramentas do usuário. O HyperFrames Core (congelado) não depende do PATH.
 */
export const NOT_ON_PATH = Object.freeze(['python-aux', 'hyperframes']);   // R12.5C3a: node_modules/.bin traria esbuild, prettier, semver… para o PATH

/** Caminho gerenciado NÃO executável (diretório/arquivo) → chave de config (R12.4). */
export const PATH_TO_CONFIG = Object.freeze({ 'remotion-project': 'REMOTION_PROJECT_DIR', 'whisper-model': 'WHISPER_MODEL' });
/** Caminho gerenciado → variável de ambiente lida pelo HyperFrames Core (sem modificá-lo; só se o usuário não definiu). */
export const PATH_TO_ENV = Object.freeze({ 'hyperframes-node-modules': 'BOLD_HYPERFRAMES_NODE_MODULES' });

let activeSchema = null;
function schema() {
  if (!activeSchema) activeSchema = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'setup', 'schema', 'toolchain-active.schema.json'), 'utf8'));
  return activeSchema;
}

/** Caminho relativo seguro dentro da raiz (sem absoluto, sem "..", sem barra invertida inicial). */
export function safeRelative(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return false;
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) return false;
  return !rel.split(/[\\/]+/).some((seg) => seg === '..');
}

/**
 * Lê active.json. Nunca lança: problemas viram `errors` (o arquivo é ignorado) ou `warnings` (a entrada é ignorada).
 * R12.5B: no macOS, ferramenta instalada da internet ANTES da verificação de assinatura (recibo sem registro `codesign`)
 * NÃO é usada (vai para `unverified`; vale o PATH) até `bold setup apply --components <id>` verificar e registrar.
 * Recibo ilegível no macOS → toda ferramenta sem registro é tratada como não verificada (falha fechada).
 * @returns {{root:string, file:string, exists:boolean, valid:boolean|null, data:object|null, bins:Record<string,string>, binDirs:string[], unverified:{tool:string, dir:string}[], errors:string[], warnings:string[]}}
 */
export function readToolchain({ platform, env = {}, home, fsApi = fs }) {
  const root = toolchainRoot({ platform, env, home });
  const p = pathApi(platform);
  const file = p.join(root, ACTIVE_FILE);
  const out = { root, file, exists: false, valid: null, data: null, bins: {}, paths: {}, binDirs: [], unverified: [], errors: [], warnings: [] };
  if (!fsApi.existsSync(file)) return out;
  out.exists = true;
  let data;
  try { data = JSON.parse(fsApi.readFileSync(file, 'utf8')); } catch (e) { out.valid = false; out.errors.push(`JSON inválido: ${e.message}`); return out; }
  const errs = validate(schema(), data);
  if (errs.length) { out.valid = false; out.errors.push(...errs); return out; }
  out.valid = true; out.data = data;
  // ordem por ativação: em conflito (ex.: dois modelos Whisper), o ativado por ÚLTIMO vence
  const ordered = Object.entries(data.tools).sort((a, b) => String(a[1].activated_at || '').localeCompare(String(b[1].activated_at || '')));
  const legacy = legacyDirs(fsApi, p, root, data);
  for (const [tool, t] of ordered) {
    if (!safeRelative(t.dir)) { out.warnings.push(`${tool}: dir inseguro ignorado`); continue; }
    if (!t.codesign && (legacy.unreadable || legacy.dirs.has(t.dir))) {
      out.unverified.push({ tool, dir: p.join(root, t.dir) });
      out.warnings.push(`${tool}: instalado antes da verificação de assinatura — ignorado (vale o PATH); rode bold setup apply --components ${tool}`);
      continue;
    }
    for (const [bin, rel] of Object.entries(t.bins)) {
      if (!safeRelative(rel)) { out.warnings.push(`${tool}.${bin}: caminho inseguro ignorado`); continue; }
      const abs = p.join(root, t.dir, rel);
      if (!fsApi.existsSync(abs)) { out.warnings.push(`${tool}.${bin}: ${abs} ausente (ignorado; vale o PATH)`); continue; }
      out.bins[bin] = abs;
      const d = p.dirname(abs);
      if (!NOT_ON_PATH.includes(bin) && !out.binDirs.includes(d)) out.binDirs.push(d);
    }
    for (const [name, rel] of Object.entries(t.paths || {})) {
      if (!safeRelative(rel) && rel !== '.') { out.warnings.push(`${tool}.${name}: caminho inseguro ignorado`); continue; }
      const abs = rel === '.' ? p.join(root, t.dir) : p.join(root, t.dir, rel);
      if (!fsApi.existsSync(abs)) { out.warnings.push(`${tool}.${name}: ${abs} ausente (ignorado)`); continue; }
      out.paths[name] = abs;
    }
  }
  return out;
}

/** Diretórios do recibo instalados da internet sem registro de assinatura (só macOS). */
function legacyDirs(fsApi, p, root, data) {
  if (!String(data.platform || '').startsWith('darwin-')) return { dirs: new Set(), unreadable: false };
  const f = p.join(root, RECEIPT_FILE);
  if (!fsApi.existsSync(f)) return { dirs: new Set(), unreadable: false };
  try {
    const r = JSON.parse(fsApi.readFileSync(f, 'utf8'));
    return { dirs: new Set((r.entries || []).filter((e) => !e.codesign && /^https:\/\//.test(String(e.artifact?.source || ''))).map((e) => e.dir)), unreadable: false };
  } catch { return { dirs: new Set(), unreadable: true }; }
}

/**
 * R12.5B: o Node que executa ESTE processo é uma ferramenta gerenciada não verificada (instalação anterior à política)?
 * → {tool, dir} ou null. A CLI só permite `bold setup` nesse caso (para migrar), nunca os demais comandos.
 */
export function unverifiedRunningNode(tc, execPath = process.execPath, fsApi = fs) {
  if (!tc?.unverified?.length) return null;
  let exe; try { exe = fsApi.realpathSync(execPath); } catch { exe = execPath; }
  for (const u of tc.unverified) { let d; try { d = fsApi.realpathSync(u.dir); } catch { d = u.dir; } if (exe.startsWith(d + path.sep)) return u; }
  return null;
}

/**
 * Camada de config: só preenche tools.* que ficaram "auto"/vazios depois de todas as camadas
 * (caminho explícito do usuário/projeto/ENV sempre vence). Muta `config` e `sources`.
 */
export function applyToolchainLayer(config, sources, tc) {
  const applied = [];
  if (!tc?.valid) return applied;
  config.tools ??= {};
  const apply = (abs, key) => {
    if (!abs) return;
    const cur = config.tools[key];
    if (cur && cur !== 'auto') return;
    config.tools[key] = abs;
    sources[`tools.${key}`] = 'toolchain';
    applied.push(key);
  };
  for (const [bin, key] of Object.entries(BIN_TO_CONFIG)) apply(tc.bins[bin], key);
  for (const [name, key] of Object.entries(PATH_TO_CONFIG)) apply(tc.paths?.[name], key);
  return applied;
}

/**
 * PATH SÓ DO PROCESSO: prefixa os diretórios dos binários gerenciados (filhos como HyperFrames/Remotion herdam).
 * Nunca toca PATH global, shell rc ou registro. Retorna o novo env (não muta o recebido).
 */
export function toolchainProcessEnv(env, tc, platform) {
  if (!tc?.valid) return env;
  const exports = {};
  for (const [name, key] of Object.entries(PATH_TO_ENV)) if (tc.paths?.[name] && !env[key]) exports[key] = tc.paths[name];
  if (!tc.binDirs.length && !Object.keys(exports).length) return env;
  const sep = platform === 'win32' ? ';' : ':';
  const key = platform === 'win32' ? (Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'Path') : 'PATH';
  const cur = String(env[key] || '').split(sep).filter(Boolean);
  const next = [...tc.binDirs.filter((d) => !cur.includes(d)), ...cur];
  return { ...env, [key]: next.join(sep), ...exports, BOLD_TOOLCHAIN_ACTIVE: '1' };
}
