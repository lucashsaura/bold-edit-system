// CONFIG ENGINE
// Precedência (maior → menor):
//   ENV BOLD_*  >  PROJECT_ROOT/bold.project.json  >  config do usuário  >  defaults por SO
// Ferramentas (tools.*) que terminam "auto" recebem o TOOLCHAIN GERENCIADO (R12, active.json) antes do PATH.
// Policies: resolvidas à parte por resolvePolicy() — invariantes nunca afrouxam.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schema/validate.mjs';
import { resolvePolicy, policyFromEnv } from '../policy/invariants.mjs';
import { userConfigPath, tokenVars, expandTokens, findProjectRoot, pathApi } from './paths.mjs';
import { readToolchain, applyToolchainLayer } from './toolchain.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BOLD_HOME = path.resolve(HERE, '..', '..');

/** ENV BOLD_* → chave de config. */
export const ENV_MAP = Object.freeze([
  { env: 'BOLD_CACHE_DIR', key: ['CACHE_DIR'] },
  { env: 'BOLD_RENDER_DIR', key: ['RENDER_DIR'] },
  { env: 'BOLD_FONTS_DIR', key: ['FONTS_DIR'], list: true },
  { env: 'BOLD_NODE_PATH', key: ['tools', 'NODE_PATH'] },
  { env: 'BOLD_PYTHON_PATH', key: ['tools', 'PYTHON_PATH'] },
  { env: 'BOLD_FFMPEG_PATH', key: ['tools', 'FFMPEG_PATH'] },
  { env: 'BOLD_FFPROBE_PATH', key: ['tools', 'FFPROBE_PATH'] },
  { env: 'BOLD_HYPERFRAMES_CMD', key: ['tools', 'HYPERFRAMES_CMD'] },
  { env: 'BOLD_HYPERFRAMES_VERSION', key: ['tools', 'HYPERFRAMES_VERSION'] },
  { env: 'BOLD_REMOTION_PROJECT_DIR', key: ['tools', 'REMOTION_PROJECT_DIR'] },
  { env: 'BOLD_WHISPER_CLI', key: ['tools', 'WHISPER_CLI'] },
  { env: 'BOLD_WHISPER_MODEL', key: ['tools', 'WHISPER_MODEL'] },
  { env: 'BOLD_PYTHON_AUX_PATH', key: ['tools', 'PYTHON_AUX_PATH'] },
  { env: 'BOLD_CHROME_HEADLESS_PATH', key: ['tools', 'CHROME_HEADLESS_PATH'] },
  { env: 'BOLD_SFX_KIT_DIR', key: ['tools', 'SFX_KIT_DIR'] },
  { env: 'BOLD_EARSHOT_DIR', key: ['tools', 'EARSHOT_DIR'] },
  { env: 'BOLD_DAVINCI_PATH', key: ['davinci', 'DAVINCI_PATH'] },
  { env: 'BOLD_DAVINCI_SCRIPT_API', key: ['davinci', 'DAVINCI_SCRIPT_API'] },
  { env: 'BOLD_DAVINCI_SCRIPT_LIB', key: ['davinci', 'DAVINCI_SCRIPT_LIB'] },
]);

const PATH_KEYS = [
  ['CACHE_DIR'], ['RENDER_DIR'], ['FONTS_DIR'],
  ['tools', 'REMOTION_PROJECT_DIR'], ['tools', 'WHISPER_MODEL'], ['tools', 'CHROME_HEADLESS_PATH'], ['tools', 'SFX_KIT_DIR'], ['tools', 'EARSHOT_DIR'],
  ['davinci', 'DAVINCI_PATH'], ['davinci', 'DAVINCI_SCRIPT_API'], ['davinci', 'DAVINCI_SCRIPT_LIB'],
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

function mergeInto(target, src, origin, sources, prefix = []) {
  for (const [k, v] of Object.entries(src)) {
    if (k === 'policy' && prefix.length === 0) continue; // policy é resolvida à parte
    const keyPath = [...prefix, k];
    if (isObj(v)) {
      if (!isObj(target[k])) target[k] = {};
      mergeInto(target[k], v, origin, sources, keyPath);
    } else {
      target[k] = clone(v);
      sources[keyPath.join('.')] = origin;
    }
  }
}

function getAt(obj, keyPath) { return keyPath.reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setAt(obj, keyPath, value) {
  let o = obj;
  for (const k of keyPath.slice(0, -1)) { if (!isObj(o[k])) o[k] = {}; o = o[k]; }
  o[keyPath[keyPath.length - 1]] = value;
}

function readJsonFile(file, fsApi) {
  const text = fsApi.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

let schemaCache = null;
export function loadSchemas(boldHome = DEFAULT_BOLD_HOME, fsApi = fs) {
  if (schemaCache && schemaCache.home === boldHome) return schemaCache;
  const config = readJsonFile(path.join(boldHome, 'core', 'config', 'bold.config.schema.json'), fsApi);
  const project = readJsonFile(path.join(boldHome, 'core', 'config', 'bold.project.schema.json'), fsApi);
  const overrides = clone(config);
  delete overrides.required;
  delete overrides.properties.schema;
  schemaCache = { home: boldHome, config, project, overrides };
  return schemaCache;
}

/** Mapeia campos de topo do projeto para a config efetiva. */
function projectToConfig(project) {
  const out = {};
  if (isObj(project.config)) Object.assign(out, clone(project.config));
  const d = {};
  for (const k of ['fps', 'resolution', 'safe_area', 'delivery_profile']) if (k in project) d[k] = clone(project[k]);
  if (Object.keys(d).length) out.defaults = { ...(out.defaults || {}), ...d };
  return out;
}

/**
 * Carrega a configuração efetiva.
 * @returns {{config: object, sources: Record<string,string>, errors: {origin:string, message:string}[],
 *           warnings: string[], user: object, project: object, policy: {effective: object, violations: object[]},
 *           unresolved: string[], platform: string}}
 */
export function loadConfig({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  cwd = process.cwd(),
  projectRoot = null,
  boldHome = null,
  fsApi = fs,
} = {}) {
  const BOLD_HOME = boldHome || env.BOLD_HOME || DEFAULT_BOLD_HOME;
  const errors = [];
  const warnings = [];
  const sources = {};
  const p = pathApi(platform);
  const schemas = loadSchemas(DEFAULT_BOLD_HOME, fs);

  // 1) defaults por SO
  const defaultsDoc = readJsonFile(path.join(DEFAULT_BOLD_HOME, 'config', 'defaults.json'), fs);
  const config = {};
  mergeInto(config, defaultsDoc.common, 'default', sources);
  const osKey = ['darwin', 'win32', 'linux'].includes(platform) ? platform : 'linux';
  if (!['darwin', 'win32', 'linux'].includes(platform)) warnings.push(`SO não suportado: ${platform}; usando defaults linux`);
  mergeInto(config, defaultsDoc.os[osKey] || {}, `default:${osKey}`, sources);
  const policyLayers = [{ origin: 'default', policy: defaultsDoc.common.policy }];

  // 2) usuário
  const userPath = userConfigPath({ platform, env, home });
  const user = { path: userPath, exists: false, valid: null, data: null };
  if (fsApi.existsSync(userPath)) {
    user.exists = true;
    try {
      user.data = readJsonFile(userPath, fsApi);
      const errs = validate(schemas.config, user.data);
      user.valid = errs.length === 0;
      for (const e of errs) errors.push({ origin: 'user', message: e });
      if (user.valid) {
        mergeInto(config, user.data, 'user', sources);
        policyLayers.push({ origin: 'user', policy: user.data.policy });
      }
    } catch (e) {
      user.valid = false;
      errors.push({ origin: 'user', message: `JSON inválido: ${e.message}` });
    }
  }

  // 3) projeto
  const root = projectRoot || env.BOLD_PROJECT_ROOT
    || findProjectRoot(cwd, { exists: (f) => fsApi.existsSync(f), platform });
  const project = { root: root || null, file: null, exists: false, valid: null, data: null };
  if (root) {
    project.file = p.join(root, 'bold.project.json');
    if (fsApi.existsSync(project.file)) {
      project.exists = true;
      try {
        project.data = readJsonFile(project.file, fsApi);
        const errs = validate(schemas.project, project.data);
        if (isObj(project.data?.config)) {
          for (const e of validate(schemas.overrides, project.data.config)) errs.push(e.replace(/^\$/, '$.config'));
        }
        project.valid = errs.length === 0;
        for (const e of errs) errors.push({ origin: 'project', message: e });
        if (project.valid) {
          mergeInto(config, projectToConfig(project.data), 'project', sources);
          policyLayers.push({ origin: 'project', policy: project.data.config?.policy });
        }
      } catch (e) {
        project.valid = false;
        errors.push({ origin: 'project', message: `JSON inválido: ${e.message}` });
      }
    } else {
      errors.push({ origin: 'project', message: `bold.project.json não encontrado em ${root}` });
    }
  }

  // 4) ENV
  for (const { env: name, key, list } of ENV_MAP) {
    if (env[name] === undefined || env[name] === '') continue;
    const value = list ? String(env[name]).split(platform === 'win32' ? ';' : ':').filter(Boolean) : env[name];
    setAt(config, key, value);
    sources[key.join('.')] = `env:${name}`;
  }
  policyLayers.push({ origin: 'env', policy: policyFromEnv(env) });

  // 5) toolchain gerenciado (R12): só preenche tools.* que ficaram "auto" — caminho explícito sempre vence.
  //    Problemas no active.json nunca quebram a config: viram warnings e a camada é ignorada.
  const tc = readToolchain({ platform, env, home, fsApi });
  const toolchainApplied = applyToolchainLayer(config, sources, tc);
  for (const e of tc.errors) warnings.push(`toolchain: active.json ignorado — ${e}`);
  for (const w of tc.warnings) warnings.push(`toolchain: ${w}`);
  const toolchain = { root: tc.root, exists: tc.exists, valid: tc.valid, applied: toolchainApplied };

  // Policy
  const policy = resolvePolicy(policyLayers);
  config.policy = { ...policy.effective };

  // Derivados e expansão de tokens
  config.BOLD_HOME = BOLD_HOME;
  config.PROJECT_ROOT = project.root;
  const vars = tokenVars({ platform, env, home, boldHome: BOLD_HOME, projectRoot: project.root });
  const unresolved = new Set();
  const expandAt = (keyPath) => {
    const v = getAt(config, keyPath);
    if (Array.isArray(v)) {
      setAt(config, keyPath, v.map((x) => { const r = expandTokens(x, vars); r.unresolved.forEach((u) => unresolved.add(`${keyPath.join('.')}:${u}`)); return r.value; }));
    } else if (typeof v === 'string') {
      const r = expandTokens(v, vars);
      r.unresolved.forEach((u) => unresolved.add(`${keyPath.join('.')}:${u}`));
      setAt(config, keyPath, r.value);
    }
  };
  if (typeof config.FONTS_DIR === 'string') config.FONTS_DIR = [config.FONTS_DIR];
  for (const k of PATH_KEYS) expandAt(k);
  if (!config.CACHE_DIR) { config.CACHE_DIR = p.join(home, '.bold-cache'); sources.CACHE_DIR = 'fallback'; }
  if (!config.RENDER_DIR) {
    config.RENDER_DIR = project.root ? p.join(project.root, 'renders') : p.join(config.CACHE_DIR, 'renders');
    sources.RENDER_DIR = project.root ? 'derived:PROJECT_ROOT' : 'derived:CACHE_DIR';
  }

  return {
    config,
    sources,
    errors,
    warnings,
    user,
    project,
    policy,
    unresolved: [...unresolved],
    platform,
    toolchain,
  };
}
