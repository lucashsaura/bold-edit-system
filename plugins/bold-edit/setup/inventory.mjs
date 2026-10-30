// Inventário das ferramentas instaladas (R12) — SOMENTE LEITURA.
// Executa apenas consultas de versão/capacidade (`--version`, `-encoders`, `import PIL`), como o `bold doctor`.
// Nunca instala, baixa, grava config, conecta no DaVinci ou altera PATH.

import { parseVersion, cmpVersion } from '../core/doctor/checks.mjs';
import { COMPONENTS, policyFor } from './components.mjs';
import { auxPythonEnv, AUX_PYTHON_FLAGS } from '../core/config/aux-python.mjs';
import { locateSfxKit, locateEarshot } from '../audio/src/locate.mjs';
import { earshotStatus } from '../audio/src/earshot.mjs';

const SRC = (s) => {
  if (!s) return 'default';
  if (s === 'toolchain') return 'toolchain';
  if (s === 'user') return 'user-config';
  if (s === 'project') return 'project';
  if (s.startsWith('env:')) return 'env';
  return 'default';
};

function tidyFactory(probe) {
  const h = probe.home;
  return (f) => (f && h && (f === h || f.startsWith(`${h}/`) || f.startsWith(`${h}\\`)) ? `~${f.slice(h.length)}` : f);
}

/** Resolve uma ferramenta: valor explícito da config (com origem) ou o primeiro candidato do PATH. */
function resolve(ctx, key, candidates) {
  const { probe, loaded } = ctx;
  const v = loaded.config.tools?.[key];
  if (v && v !== 'auto') {
    const p = probe.which(v) || (probe.isFile(v) ? v : null);
    return { path: p, configured: v, source: SRC(loaded.sources[`tools.${key}`]) };
  }
  for (const c of candidates) { const w = probe.which(c); if (w) return { path: w, configured: null, source: 'system-path' }; }
  return { path: null, configured: null, source: null };
}

const item = (c, platformId, fields) => ({ id: c.id, name: c.name, tier: c.tier, license: c.license, ...policyFor(c, platformId), ...fields });

function inventoryNode(ctx, c) {
  const { probe, loaded, execPath, platform } = ctx;
  const tidy = tidyFactory(probe);
  const cfg = loaded.config.tools?.NODE_PATH;
  const managedRoot = loaded.toolchain?.root;
  const source = loaded.sources['tools.NODE_PATH'] === 'toolchain' || (managedRoot && execPath?.startsWith(managedRoot)) ? 'toolchain'
    : probe.env.BOLD_NODE_PATH ? 'env' : 'system-path';
  const v = parseVersion(probe.nodeVersion);
  const min = parseVersion(c.requirement.min); const rec = parseVersion(c.requirement.recommended);
  const status = !v ? 'MISSING' : cmpVersion(v, min) < 0 ? 'OUTDATED' : cmpVersion(v, rec) < 0 ? 'OUTDATED_RECOMMENDED' : 'OK';
  const details = [`em uso pela CLI: ${tidy(execPath)}`];
  if (cfg && cfg !== 'auto') details.push(`tools.NODE_PATH = ${tidy(cfg)}`);
  if (status === 'OUTDATED_RECOMMENDED') details.push('funciona para a CLI, mas o HyperFrames exige Node ≥ 22');
  return item(c, platform.id, { status, version: probe.nodeVersion?.replace(/^v/, '') ?? null, path: tidy(execPath), source, details });
}

function inventoryFfmpeg(ctx, c) {
  const { probe, platform } = ctx;
  const tidy = tidyFactory(probe);
  const ff = resolve(ctx, 'FFMPEG_PATH', ['ffmpeg']);
  const fp = resolve(ctx, 'FFPROBE_PATH', ['ffprobe']);
  const details = [];
  let version = null; let prores = null;
  if (ff.path) {
    const v = probe.run(ff.path, ['-hide_banner', '-version']);
    if (v.ok) version = (v.stdout.split('\n')[0] || '').replace(/^ffmpeg version\s+/, '').replace(/\s+Copyright.*/, '').trim() || null;
    const enc = probe.run(ff.path, ['-hide_banner', '-encoders']);
    prores = enc.ok ? /\bprores_ks\b/.test(enc.stdout) : null;
    details.push(`ffmpeg: ${tidy(ff.path)} (${ff.source})`);
    details.push(prores === true ? 'prores_ks: disponível (ProRes 4444 alpha)' : prores === false ? 'prores_ks: AUSENTE' : 'prores_ks: não verificado');
  } else details.push(ff.configured ? `ffmpeg configurado não encontrado: ${tidy(ff.configured)}` : 'ffmpeg: não encontrado');
  details.push(fp.path ? `ffprobe: ${tidy(fp.path)} (${fp.source})` : 'ffprobe: não encontrado');
  const status = !ff.path || !fp.path ? 'MISSING' : prores === false ? 'INCOMPATIBLE' : 'OK';
  return item(c, platform.id, { status, version, path: ff.path ? tidy(ff.path) : null, source: ff.source, bins: { ffmpeg: ff.path ? tidy(ff.path) : null, ffprobe: fp.path ? tidy(fp.path) : null }, details });
}

/** Caminho do ResolvePython (Resolve 21.1+) a partir de davinci.DAVINCI_PATH. */
export function resolvePythonPath(probe, davinciPath) {
  if (!davinciPath || davinciPath === 'auto') return null;
  if (probe.platform === 'darwin') return probe.join(davinciPath, 'Contents', 'Applications', 'ResolvePython');
  if (probe.platform === 'win32') return probe.join(davinciPath, 'ResolvePython', 'ResolvePython.exe');
  return null;
}

function pyVersion(ctx, file) {
  const { probe } = ctx;
  // macOS: /usr/bin/python3 é um stub que ABRE o instalador das Command Line Tools se elas faltarem → não executar.
  if (probe.platform === 'darwin' && file === '/usr/bin/python3' && !probe.run('xcode-select', ['-p']).ok) return { skipped: 'stub do macOS (Command Line Tools ausentes) — não executado' };
  // -B: não grava bytecode (o Python da Apple escreveria em ~/Library/Caches/com.apple.python) — inventário sem efeitos.
  const r = probe.run(file, ['-B', '-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])']);
  return r.ok ? { version: r.stdout.trim() } : { error: (r.stderr || '').split('\n')[0] || 'falhou' };
}

/** Mesma ordem de seleção da DaVinci Bridge (core/davinci/bridge.mjs) — o setup só relata, não muda a Bridge. */
function bridgePythonCandidates(ctx) {
  const { probe, loaded } = ctx;
  const configured = probe.env.BOLD_PYTHON_PATH || loaded.config.tools?.PYTHON_PATH;
  return configured && configured !== 'auto' ? [configured] : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'];
}

function inventoryPython(ctx, c) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const min = parseVersion(c.requirement.min);
  const details = [];
  let chosen = null;
  for (const cand of bridgePythonCandidates(ctx)) {
    const w = probe.which(cand) || (probe.isFile(cand) ? cand : null);
    if (!w) continue;
    const r = pyVersion(ctx, w);
    if (r.skipped) { details.push(`${tidy(w)}: ${r.skipped}`); continue; }
    if (!r.version) continue;
    const ok = cmpVersion(parseVersion(r.version), min) >= 0;
    details.push(`${tidy(w)} = ${r.version}${ok ? '' : ' (< 3.10)'}`);
    if (ok && !chosen) chosen = { path: w, version: r.version };
  }
  const rp = resolvePythonPath(probe, loaded.config.davinci?.DAVINCI_PATH);
  let resolvePython = null;
  if (rp && probe.isFile(rp)) {
    const r = pyVersion(ctx, rp);
    resolvePython = { path: tidy(rp), version: r.version ?? null, validated_with_bridge: false };
    details.push(`ResolvePython detectado: ${tidy(rp)}${r.version ? ` = ${r.version}` : ''} — NÃO usado pela Bridge até ser validado`);
  }
  const src = loaded.sources['tools.PYTHON_PATH'];
  const status = chosen ? 'OK' : resolvePython ? 'DETECTED_UNVALIDATED' : 'MISSING';
  const out = item(c, platform.id, { status, version: chosen?.version ?? null, path: chosen ? tidy(chosen.path) : null, source: chosen ? (src && !String(src).startsWith('default') ? SRC(src) : 'system-path') : null, resolve_python: resolvePython, details });
  return { out, abs: chosen?.path ?? null };
}

function inventoryDavinci(ctx, c) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const cfg = loaded.config.davinci || {};
  const details = [];
  const app = cfg.DAVINCI_PATH && cfg.DAVINCI_PATH !== 'auto' && probe.exists(cfg.DAVINCI_PATH) ? cfg.DAVINCI_PATH : null;
  let version = null; let bundleId = null;
  if (app && probe.platform === 'darwin') {
    const plist = probe.join(app, 'Contents', 'Info.plist');
    const v = probe.run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]); if (v.ok) version = v.stdout.trim();
    const b = probe.run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist]); if (b.ok) bundleId = b.stdout.trim();
  }
  const api = probe.env.RESOLVE_SCRIPT_API && String(loaded.sources['davinci.DAVINCI_SCRIPT_API'] || '').startsWith('default') ? probe.env.RESOLVE_SCRIPT_API : cfg.DAVINCI_SCRIPT_API;
  const lib = probe.env.RESOLVE_SCRIPT_LIB && String(loaded.sources['davinci.DAVINCI_SCRIPT_LIB'] || '').startsWith('default') ? probe.env.RESOLVE_SCRIPT_LIB : cfg.DAVINCI_SCRIPT_LIB;
  const mod = api && api !== 'auto' ? probe.join(api, 'Modules', 'DaVinciResolveScript.py') : null;
  const hasMod = !!(mod && probe.isFile(mod)); const hasLib = !!(lib && lib !== 'auto' && probe.isFile(lib));
  details.push(app ? `app: ${tidy(app)}${version ? ` (${version})` : ''}` : 'app: não encontrado (davinci.DAVINCI_PATH)');
  if (bundleId) details.push(`bundle: ${bundleId} — edição (Studio/gratuita) não é determinável pelo bundle; scripting externo exige, na prática, o Studio`);
  details.push(`DaVinciResolveScript.py: ${hasMod ? 'presente' : 'ausente'} · fusionscript: ${hasLib ? 'presente' : 'ausente'}`);
  details.push('conexão: não testada pelo setup (use `bold doctor --module davinci`)');
  const status = !app ? 'MISSING' : hasMod && hasLib ? 'OK' : 'INCOMPLETE';
  return item(c, platform.id, { status, version, path: app ? tidy(app) : null, source: app ? 'app-bundle' : null, scripting_api: { module: hasMod, library: hasLib }, details });
}

function inventoryPillow(ctx, c, py) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const details = []; let status = 'MISSING'; let version = null; let where = null; let source = null;
  const aux = loaded.config.tools?.PYTHON_AUX_PATH;
  const auxAbs = aux && aux !== 'auto' ? (probe.which(aux) || (probe.isFile(aux) ? aux : null)) : null;
  if (auxAbs) {
    const r = probe.run(auxAbs, [...AUX_PYTHON_FLAGS, '-B', '-c', 'import PIL;print(PIL.__version__)'], { env: auxPythonEnv(probe.env || {}) });
    details.push(r.ok ? `Python auxiliar ${tidy(auxAbs)}: Pillow ${r.stdout.trim()} (${SRC(loaded.sources['tools.PYTHON_AUX_PATH'])})` : `Python auxiliar ${tidy(auxAbs)}: Pillow ausente`);
    if (r.ok) { status = 'OK'; version = r.stdout.trim(); where = tidy(auxAbs); source = SRC(loaded.sources['tools.PYTHON_AUX_PATH']); }
  } else details.push('Python auxiliar gerenciado: não instalado (tools.PYTHON_AUX_PATH)');
  if (py.abs) {
    const r = probe.run(py.abs, ['-B', '-c', 'import PIL;print(PIL.__version__)']);
    details.push(r.ok ? `Python do sistema ${py.out.path}: Pillow ${r.stdout.trim()}` : `Python do sistema ${py.out.path}: Pillow ausente`);
    if (r.ok && status !== 'OK') { status = 'OK'; version = r.stdout.trim(); where = py.out.path; source = py.out.source; }
  }
  return item(c, platform.id, { status, version, path: where, source, details });
}

function inventoryHyperframes(ctx, c) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const pin = loaded.config.tools?.HYPERFRAMES_VERSION;
  const nm = probe.env.BOLD_HYPERFRAMES_NODE_MODULES || null;
  const details = [`pin: ${pin}`];
  if (nm) {
    const v = probe.readJson(probe.join(nm, 'hyperframes', 'package.json'))?.version ?? null;
    const pp = !!probe.readJson(probe.join(nm, 'puppeteer-core', 'package.json'));
    details.unshift(`BOLD_HYPERFRAMES_NODE_MODULES → ${tidy(nm)} · hyperframes ${v ?? 'ausente'} · puppeteer-core ${pp ? 'ok' : 'ausente'}`);
    const src = probe.env.BOLD_TOOLCHAIN_ACTIVE === '1' && loaded.toolchain?.root && nm.startsWith(loaded.toolchain.root) ? 'toolchain' : 'env';
    return item(c, platform.id, { status: v === pin && pp ? 'OK' : v ? 'OUTDATED' : 'MISSING', version: v, path: tidy(nm), source: src, details });
  }
  const r = resolve(ctx, 'HYPERFRAMES_CMD', ['hyperframes']);
  details.unshift(r.path ? `${tidy(r.path)} (${r.source})` : 'não encontrado (BOLD_HYPERFRAMES_NODE_MODULES/PATH/config)');
  details.push('detecção completa (plugin/npx): `bold doctor --module motion`');
  return item(c, platform.id, { status: r.path ? 'OK' : 'MISSING', version: null, path: r.path ? tidy(r.path) : null, source: r.source, details });
}

function inventoryChrome(ctx, c) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const cands = [
    ['config', loaded.config.tools?.CHROME_HEADLESS_PATH], ['env:BOLD_HYPERFRAMES_CHROME', probe.env.BOLD_HYPERFRAMES_CHROME],
    ['env:HYPERFRAMES_BROWSER_PATH', probe.env.HYPERFRAMES_BROWSER_PATH], ['env:PRODUCER_HEADLESS_SHELL_PATH', probe.env.PRODUCER_HEADLESS_SHELL_PATH],
  ];
  const details = [];
  for (const [src, p] of cands) if (p) {
    const ok = probe.isFile(p); details.push(`${src}: ${tidy(p)} ${ok ? '(existe)' : '(AUSENTE)'}`);
    if (ok) return item(c, platform.id, { status: 'OK', version: null, path: tidy(p), source: src.startsWith('env') ? 'env' : 'user-config', details: [...details, 'fornecido pelo usuário: o BOLD não verificou a origem nem o hash'] });
  }
  const cacheDir = probe.join(probe.home, '.cache', 'hyperframes', 'chrome');
  if (probe.isDir(cacheDir)) return item(c, platform.id, { status: 'UNVERIFIED', version: null, path: tidy(cacheDir), source: 'tool-cache', details: [...details, `cache do HyperFrames presente (${tidy(cacheDir)}); baixado pela ferramenta SEM verificação de hash`, 'para usar com o BOLD: configure tools.CHROME_HEADLESS_PATH'] });
  return item(c, platform.id, { status: 'MISSING', version: null, path: null, source: null, details: [...details, 'não encontrado (opcional) — download gerenciado ADIADO; configure um existente em tools.CHROME_HEADLESS_PATH'] });
}

function inventoryRemotion(ctx, c) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const dir = loaded.config.tools?.REMOTION_PROJECT_DIR;
  const pin = loaded.config.tools?.REMOTION_VERSION;
  const details = [`pin: ${pin}`, 'licença: aceite explícito necessário antes de qualquer instalação gerenciada'];
  if (!dir || !probe.isDir(dir)) { details.unshift(dir ? `REMOTION_PROJECT_DIR inexistente: ${tidy(dir)}` : 'REMOTION_PROJECT_DIR não configurado'); return item(c, platform.id, { status: 'NOT_CONFIGURED', version: null, path: null, source: null, details }); }
  const pkg = probe.readJson(probe.join(dir, 'node_modules', 'remotion', 'package.json'));
  const lock = probe.isFile(probe.join(dir, 'package-lock.json'));
  details.unshift(`projeto: ${tidy(dir)} · remotion ${pkg?.version ?? '(node_modules ausente)'} · lockfile ${lock ? 'presente' : 'AUSENTE'}`);
  return item(c, platform.id, { status: pkg?.version ? 'OK' : 'INCOMPLETE', version: pkg?.version ?? null, path: tidy(dir), source: SRC(loaded.sources['tools.REMOTION_PROJECT_DIR']), details });
}

function inventoryWhisperCli(ctx, c) {
  const { probe, platform } = ctx;
  const tidy = tidyFactory(probe);
  const r = resolve(ctx, 'WHISPER_CLI', ['whisper-cli', 'whisper-cpp']);
  return item(c, platform.id, { status: r.path ? 'OK' : 'MISSING', version: null, path: r.path ? tidy(r.path) : null, source: r.source, details: [r.path ? `${tidy(r.path)} (${r.source})` : 'não encontrado (opcional)'] });
}

function inventoryWhisperModel(ctx, c, variant) {
  const { probe, loaded, platform } = ctx;
  const tidy = tidyFactory(probe);
  const m = loaded.config.tools?.WHISPER_MODEL;
  const name = `ggml-${variant}.bin`;
  const active = m && probe.isFile(m) && probe.join(m).endsWith(name);
  const details = [m ? `tools.WHISPER_MODEL = ${tidy(m)} (${SRC(loaded.sources['tools.WHISPER_MODEL'])})` : 'tools.WHISPER_MODEL não configurado'];
  if (c.advanced) details.push('opção AVANÇADA: maior e mais lenta que base/small');
  return item(c, platform.id, { status: active ? 'OK' : 'NOT_CONFIGURED', version: null, path: active ? tidy(m) : null, source: active ? SRC(loaded.sources['tools.WHISPER_MODEL']) : null, details });
}

function inventorySfxKit(ctx, c) {
  const { probe, loaded, platform } = ctx; const tidy = tidyFactory(probe);
  const l = locateSfxKit({ config: loaded.config, env: probe.env ?? {}, platform: probe.platform, home: probe.home });
  const v = l.found ? probe.readJson(probe.join(l.dir, 'sounds.json'))?.version ?? null : null;
  return item(c, platform.id, { status: l.found ? 'OK' : l.offline ? 'STORAGE_OFFLINE' : 'MISSING', version: v, path: l.found ? tidy(l.dir) : null, source: l.found ? l.source : null, details: [l.found ? `${tidy(l.dir)}${l.provenance ? ' (proveniência registrada)' : ''}` : l.offline ? `no armazenamento externo, indisponível (${l.offline.state}): ${l.offline.recover}` : `não encontrado em ${tidy(l.roots.libraries)} (opcional)`] });
}

function inventoryEarshot(ctx, c) {
  const { probe, loaded, platform } = ctx; const tidy = tidyFactory(probe);
  const s = earshotStatus(locateEarshot({ config: loaded.config, env: probe.env ?? {}, platform: probe.platform, home: probe.home }));
  return item(c, platform.id, { status: s.installed ? 'OK' : s.offline ? 'STORAGE_OFFLINE' : 'MISSING', version: s.version ?? null, path: s.installed ? tidy(s.dir) : null, source: s.installed ? (s.source === 'storage' ? 'audio-storage' : 'audio-tools') : null,
    details: [s.installed ? `${tidy(s.dir)} · modelos ${s.models_ready ? 'presentes' : 'ausentes'}` : s.offline ? `no armazenamento externo, indisponível (${s.storage.state}): ${s.storage.recover}` : 'não instalado (opcional)'] });
}

/**
 * @param {{probe:object, loaded:object, platform:object, execPath?:string}} ctx
 * @returns {{schema:string, read_only:true, platform:object, toolchain:object, components:object[]}}
 */
export function inventory(ctx) {
  const full = { execPath: process.execPath, ...ctx };
  const by = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));
  const py = inventoryPython(full, by.python);
  const components = [
    inventoryNode(full, by.node),
    inventoryFfmpeg(full, by.ffmpeg),
    py.out,
    inventoryDavinci(full, by['davinci-resolve']),
    inventoryPillow(full, by.pillow, py),
    inventoryHyperframes(full, by.hyperframes),
    inventoryChrome(full, by['chrome-headless-shell']),
    inventoryRemotion(full, by.remotion),
    inventoryWhisperCli(full, by['whisper-cli']),
    ...['base', 'small', 'medium'].map((v) => inventoryWhisperModel(full, by[`whisper-model-${v}`], v)),
    inventorySfxKit(full, by['sfx-kit']),
    inventoryEarshot(full, by.earshot),
  ];
  return { schema: 'bold.setup-inventory/1', read_only: true, platform: full.platform, toolchain: full.loaded.toolchain ?? null, components };
}
