// LOCALIZAÇÃO das bibliotecas e ferramentas de áudio (R13) — SOMENTE LEITURA.
// Ficam FORA do plugin (sobrevivem a updates) e fora do toolchain gerenciado, ao lado da config do usuário:
//   macOS   ~/Library/Application Support/bold/{libraries,tools}
//   Windows %LOCALAPPDATA%\bold\{libraries,tools}
//   Linux   ${XDG_DATA_HOME:-~/.local/share}/bold/{libraries,tools}
// Precedência: tools.SFX_KIT_DIR / tools.EARSHOT_DIR (env BOLD_SFX_KIT_DIR / BOLD_EARSHOT_DIR, config) >
//              BOLD_AUDIO_LIBRARIES_DIR / BOLD_AUDIO_TOOLS_DIR > armazenamento externo (audio-storage.json) > padrão por SO.
// Armazenamento externo configurado e OFFLINE → found:false com o estado; NUNCA cai para o disco interno.
// Nada aqui baixa, instala ou monta.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataBase, currentStorage } from './storage.mjs';

export function audioRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const base = dataBase({ platform, env, home });
  const st = env.BOLD_AUDIO_LIBRARIES_DIR && env.BOLD_AUDIO_TOOLS_DIR ? { configured: false } : currentStorage({ platform, env, home });
  const ext = st.configured && st.paths ? st : null;
  return { libraries: env.BOLD_AUDIO_LIBRARIES_DIR || (ext ? ext.paths.sfx_kit : p.join(base, 'libraries')), tools: env.BOLD_AUDIO_TOOLS_DIR || (ext ? ext.root : p.join(base, 'tools')),
    models: ext && !env.BOLD_AUDIO_TOOLS_DIR ? ext.paths.models : null, cache: ext ? ext.paths.cache : null, temp: ext ? ext.paths.temp : null,
    storage: st.configured ? { state: st.state, online: !!st.online, root: st.root ?? null, detail: st.detail ?? null, recover: st.recover ?? null, unavailable: st.unavailable ?? [], available: st.available ?? [] } : null,
    external: !!ext && !(env.BOLD_AUDIO_LIBRARIES_DIR && env.BOLD_AUDIO_TOOLS_DIR) };
}

/** Raiz no armazenamento externo e ele está offline? (explícito em config/env não depende dele) */
const offlineFor = (roots, dir) => roots.storage && !roots.storage.online && roots.storage.root && dir && (dir === roots.storage.root || dir.startsWith(roots.storage.root + path.sep));

const semverKey = (v) => String(v).split('.').map((n) => String(Number.parseInt(n, 10) || 0).padStart(6, '0')).join('.');

/** O SFX Kit instalado: o configurado, senão o sfx-kit-<versão> mais novo em libraries/. */
export function locateSfxKit({ config = {}, env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const roots = audioRoots({ platform, env, home });
  const explicit = config.tools?.SFX_KIT_DIR || env.BOLD_SFX_KIT_DIR || null;
  const candidates = [];
  if (explicit) candidates.push({ dir: explicit, source: config.tools?.SFX_KIT_DIR ? 'config' : 'env' });
  else {
    let names = []; try { names = fs.readdirSync(roots.libraries); } catch { /* ausente */ }
    for (const n of names.filter((x) => /^sfx-kit-\d+\.\d+\.\d+$/.test(x)).sort((a, b) => semverKey(b.slice(8)).localeCompare(semverKey(a.slice(8)))))
      candidates.push({ dir: path.join(roots.libraries, n), source: 'default' });
  }
  for (const c of candidates) {
    const sj = path.join(c.dir, 'sounds.json');
    if (fs.existsSync(sj)) {
      const prov = path.join(path.dirname(c.dir), `${path.basename(c.dir)}.provenance.json`);
      return { found: true, dir: c.dir, source: c.source === 'default' && roots.external ? 'storage' : c.source, sounds_json: sj, provenance: fs.existsSync(prov) ? prov : null, roots };
    }
  }
  const offline = offlineFor(roots, explicit ?? roots.libraries) ? roots.storage : null;
  return { found: false, dir: explicit, source: explicit ? 'config' : null, roots, searched: explicit ? [explicit] : [roots.libraries], offline };
}

/** Earshot instalado (venv isolado): o binário da venv e a casa dos modelos. */
export function locateEarshot({ config = {}, env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const roots = audioRoots({ platform, env, home });
  const dir = config.tools?.EARSHOT_DIR || env.BOLD_EARSHOT_DIR || path.join(roots.tools, 'earshot');
  const bin = platform === 'win32' ? path.join(dir, '.venv', 'Scripts', 'earshot.exe') : path.join(dir, '.venv', 'bin', 'earshot');
  const python = platform === 'win32' ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python');
  const fromStorage = !(config.tools?.EARSHOT_DIR || env.BOLD_EARSHOT_DIR) && roots.external;
  const earshotHome = fromStorage && roots.models ? roots.models : path.join(path.dirname(dir), 'earshot-home');
  let provs = []; try { provs = fs.readdirSync(path.dirname(dir)).filter((n) => /^earshot-\d+\.\d+\.\d+\.provenance\.json$/.test(n)).sort((a, b) => semverKey(b.slice(8, -16)).localeCompare(semverKey(a.slice(8, -16)))); } catch { /* ausente */ }
  const ok = fs.existsSync(bin) && fs.existsSync(path.join(dir, 'pyproject.toml'));
  return { found: ok, dir, bin, python, home: earshotHome, temp: fromStorage ? roots.temp : null, provenance: provs.length ? path.join(path.dirname(dir), provs[0]) : null,
    source: config.tools?.EARSHOT_DIR ? 'config' : env.BOLD_EARSHOT_DIR ? 'env' : fromStorage ? 'storage' : 'default', roots, offline: !ok && offlineFor(roots, dir) ? roots.storage : null };
}
