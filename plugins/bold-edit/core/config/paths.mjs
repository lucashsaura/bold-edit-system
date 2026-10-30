// Resolução de caminhos por SO. Nada de paths pessoais fixos: tudo vem de HOME/APPDATA/etc. em runtime.

import path from 'node:path';

export function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Caminho do bold.config.json do usuário (fora do repositório). */
export function userConfigPath({ platform, env = {}, home }) {
  if (env.BOLD_USER_CONFIG) return env.BOLD_USER_CONFIG;
  const p = pathApi(platform);
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'bold', 'bold.config.json');
  if (platform === 'win32') {
    const appdata = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    return p.join(appdata, 'bold', 'bold.config.json');
  }
  const xdg = env.XDG_CONFIG_HOME || p.join(home, '.config');
  return p.join(xdg, 'bold', 'bold.config.json');
}

/**
 * Raiz do TOOLCHAIN GERENCIADO pelo `bold setup` (R12). Fica fora do repositório e fora do cache do plugin
 * (sobrevive a updates). Binários grandes → LOCALAPPDATA no Windows (não Roaming). BOLD_TOOLCHAIN_DIR sobrescreve.
 */
export function toolchainRoot({ platform, env = {}, home }) {
  if (env.BOLD_TOOLCHAIN_DIR) return env.BOLD_TOOLCHAIN_DIR;
  const p = pathApi(platform);
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'bold', 'toolchain');
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'bold', 'toolchain');
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'bold', 'toolchain');
}

/** Variáveis disponíveis para expansão de ${VAR} nos defaults. */
export function tokenVars({ platform, env = {}, home, boldHome, projectRoot }) {
  const p = pathApi(platform);
  return {
    HOME: home,
    APPDATA: env.APPDATA || (platform === 'win32' ? p.join(home, 'AppData', 'Roaming') : undefined),
    LOCALAPPDATA: env.LOCALAPPDATA || (platform === 'win32' ? p.join(home, 'AppData', 'Local') : undefined),
    PROGRAMDATA: env.PROGRAMDATA || env.ProgramData,
    PROGRAMFILES: env.PROGRAMFILES || env.ProgramFiles,
    WINDIR: env.WINDIR || env.windir || env.SystemRoot,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
    BOLD_HOME: boldHome,
    PROJECT_ROOT: projectRoot || undefined,
  };
}

/** Expande ${VAR}. Variáveis indefinidas permanecem e são reportadas. */
export function expandTokens(value, vars) {
  const unresolved = [];
  if (typeof value !== 'string') return { value, unresolved };
  const out = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (m, name) => {
    const v = vars[name];
    if (v === undefined || v === null || v === '') { unresolved.push(name); return m; }
    return v;
  });
  return { value: out, unresolved };
}

/** Procura bold.project.json subindo a partir de `start`. */
export function findProjectRoot(start, { exists, platform }) {
  const p = pathApi(platform);
  let dir = p.resolve(start);
  for (;;) {
    if (exists(p.join(dir, 'bold.project.json'))) return dir;
    const parent = p.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
