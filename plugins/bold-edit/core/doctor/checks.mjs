// Checks do `bold doctor`. Cada check devolve {id, module, label, status, detail, hint?}.
// Regra de severidade: item ausente de módulo NÃO solicitado → WARNING; de módulo solicitado → FAIL
// (exceto itens marcados como opcionais ou ainda PLANNED, que ficam em WARNING).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanLeaks } from '../leak/scan.mjs';
import { INVARIANTS } from '../policy/invariants.mjs';
import { detectRemotion } from '../../remotion/adapter/detect.mjs';
import { claudeDir, personalSkillDir, receiptPath, binDir, SKILL_NAME, SKILL_SOURCE, COPY_MARKER, MARKER } from '../../install/paths.mjs';
import { productManifest } from '../product.mjs';

export const MODULES = Object.freeze(['core', 'motion', 'davinci', 'transcript', 'assets', 'claude', 'toolchain', 'audio']);
const FONT_EXT = /\.(otf|ttf|ttc|woff2?|dfont)$/i;

export function parseVersion(s) {
  const m = String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
export function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); }
  return 0;
}

function tidy(probe, s) {
  if (typeof s !== 'string' || !probe.home) return s;
  return s.split(probe.home).join('~');
}

function mk(module, id, label) {
  return (status, detail, hint) => ({ id: `${module}.${id}`, module, label, status, detail, ...(hint ? { hint } : {}) });
}

const GB = 1024 ** 3;

function resolveTool(ctx, configured, candidates) {
  const { probe } = ctx;
  if (configured && configured !== 'auto') return probe.which(configured) || (probe.isFile(configured) ? configured : null);
  for (const c of candidates) { const w = probe.which(c); if (w) return w; }
  return null;
}

// ───────────────────────────── CORE ─────────────────────────────

export function coreChecks(ctx) {
  const { probe, loaded } = ctx;
  const cfg = loaded.config;
  const out = [];

  // SO
  {
    const r = mk('core', 'os', 'Sistema operacional');
    let ver = probe.osRelease;
    if (probe.platform === 'darwin') { const s = probe.run('sw_vers', ['-productVersion']); if (s.ok) ver = s.stdout.trim(); }
    if (probe.platform === 'darwin') out.push(r('PASS', `macOS ${ver} (plataforma principal da V1)`));
    else if (probe.platform === 'win32') out.push(r('WARNING', `Windows ${ver} — EXPERIMENTAL na V1`));
    else if (probe.platform === 'linux') out.push(r('WARNING', `Linux ${ver} — não suportado oficialmente`));
    else out.push(r('FAIL', `SO não suportado: ${probe.platform}`));
  }
  out.push(mk('core', 'arch', 'Arquitetura')('PASS', probe.arch));

  // Node (necessário para o próprio CLI)
  {
    const r = mk('core', 'node', 'Node.js (CLI)');
    const v = parseVersion(probe.nodeVersion);
    if (v && v[0] >= 20) out.push(r('PASS', `${probe.nodeVersion}`));
    else out.push(r('FAIL', `${probe.nodeVersion} — o CLI exige Node ≥ 20`, 'Instale Node LTS (o doctor não instala nada).'));
  }

  // Config
  {
    const r = mk('core', 'config', 'Configuração');
    const fatal = loaded.errors;
    if (fatal.length) {
      out.push(r('FAIL', `config inválida (${fatal.length} erro[s]): ${fatal.slice(0, 3).map((e) => `${e.origin}: ${e.message}`).join(' · ')}`,
        'Corrija o arquivo indicado; veja `bold config`.'));
    } else if (!loaded.user.exists) {
      out.push(r('WARNING', `config do usuário não encontrada (${tidy(probe, loaded.user.path)}); usando defaults`,
        'Opcional: copie bold.config.example.json para esse caminho e ajuste.'));
    } else {
      out.push(r('PASS', `usuário: ${tidy(probe, loaded.user.path)}`));
    }
    const pr = mk('core', 'project', 'Projeto ativo');
    if (loaded.project.root && loaded.project.valid) out.push(pr('PASS', `${loaded.project.data.project_id} — ${tidy(probe, loaded.project.root)}`));
    else if (loaded.project.root) out.push(pr('FAIL', `bold.project.json inválido ou ausente em ${tidy(probe, loaded.project.root)}`));
    else out.push(pr('PASS', 'nenhum projeto ativo (opcional)'));
    if (loaded.unresolved.length) {
      out.push(mk('core', 'config-tokens', 'Variáveis de caminho')('WARNING', `não resolvidas: ${loaded.unresolved.join(', ')}`));
    }
  }

  // Policy
  {
    const r = mk('core', 'policy', 'Policy (invariantes)');
    const eff = loaded.policy.effective;
    const intact = Object.entries(INVARIANTS).every(([k, v]) => eff[k] === v);
    if (!intact) out.push(r('FAIL', 'policy efetiva diverge das invariantes'));
    else if (loaded.policy.violations.length) {
      out.push(r('FAIL', `tentativa de afrouxar policy ignorada: ${loaded.policy.violations.map((v) => `${v.origin}:${v.key}=${JSON.stringify(v.attempted)}`).join(', ')} — policy efetiva permanece estrita`,
        'Remova a chave da config indicada.'));
    } else out.push(r('PASS', Object.entries(eff).map(([k, v]) => `${k}=${v}`).join(' · ')));
  }

  // Disco
  {
    const r = mk('core', 'disk', 'Espaço em disco (CACHE_DIR)');
    const free = probe.freeBytes(cfg.CACHE_DIR);
    const passGb = cfg.doctor?.disk_pass_gb ?? 50;
    const failGb = cfg.doctor?.disk_fail_gb ?? 15;
    if (free == null) out.push(r('WARNING', 'não foi possível medir'));
    else {
      const gb = free / GB;
      const d = `${gb.toFixed(1)} GiB livres (PASS ≥ ${passGb}, FAIL < ${failGb})`;
      out.push(r(gb >= passGb ? 'PASS' : gb >= failGb ? 'WARNING' : 'FAIL', d,
        gb < passGb ? 'Renders em sequência PNG ocupam dezenas de GB; libere espaço antes de renders longos.' : undefined));
    }
  }

  // Permissões
  {
    const r = mk('core', 'permissions', 'Permissão de escrita');
    const c = probe.writable(cfg.CACHE_DIR);
    const rd = probe.writable(cfg.RENDER_DIR);
    if (c.ok && rd.ok) out.push(r('PASS', `CACHE_DIR e RENDER_DIR graváveis (verificado em ${tidy(probe, c.checked)})`));
    else out.push(r('FAIL', `sem escrita: ${!c.ok ? `CACHE_DIR (${tidy(probe, c.checked)})` : ''} ${!rd.ok ? `RENDER_DIR (${tidy(probe, rd.checked)})` : ''}`.trim()));
  }

  // Fontes
  {
    const r = mk('core', 'fonts', 'Diretórios de fontes');
    const dirs = (cfg.FONTS_DIR || []).filter((d) => probe.isDir(d));
    const counts = dirs.map((d) => [d, probe.readdir(d).filter((f) => FONT_EXT.test(f)).length]);
    const total = counts.reduce((a, [, n]) => a + n, 0);
    const required = loaded.project.valid ? (loaded.project.data.fonts_required || []) : [];
    const missing = required.map((f) => (typeof f === 'string' ? f : f.file))
      .filter((file) => !dirs.some((d) => probe.isFile(probe.join(d, file))));
    if (!dirs.length) out.push(r('WARNING', 'nenhum diretório de fontes encontrado', 'Defina FONTS_DIR na config.'));
    else if (missing.length) out.push(r('FAIL', `fontes exigidas pelo projeto ausentes: ${missing.join(', ')}`, 'Fontes são USER_PROVIDED; a Skill nunca distribui fontes.'));
    else out.push(r('PASS', `${dirs.length} diretório(s), ${total} arquivo(s) de fonte${required.length ? `; ${required.length} exigida(s) pelo projeto: OK` : ''}`));
  }

  // Instalação (R10): versão do produto, BOLD_HOME e recibo do installer (somente leitura)
  {
    const r = mk('core', 'install', 'Instalação (produto, BOLD_HOME, installer)');
    const pctx = { platform: probe.platform, env: probe.env ?? {}, home: probe.home };
    let m = null; try { m = productManifest(cfg.BOLD_HOME); } catch { /* checkout incompleto */ }
    let rec = null; try { rec = JSON.parse(fs.readFileSync(receiptPath(pctx), 'utf8')); } catch { /* sem recibo */ }
    if (!m) out.push(r('FAIL', `BOLD_HOME inválido (${tidy(probe, cfg.BOLD_HOME)}): package.json/config/product.json ausentes`));
    else if (!rec) out.push(r('WARNING', `BOLD EDIT SYSTEM ${m.version} em ${tidy(probe, cfg.BOLD_HOME)} · não instalado pelo installer (uso direto do checkout)`, 'Para CLI no PATH e Skill pessoal: ./install.sh (ver INSTALL.md).'));
    else if (rec.bold_home !== cfg.BOLD_HOME) out.push(r('WARNING', `o installer registrou outro BOLD_HOME (${tidy(probe, rec.bold_home)}); este é ${tidy(probe, cfg.BOLD_HOME)}`, 'Rode ./install.sh update --from <checkout> no checkout que deve valer.'));
    else out.push(r('PASS', `BOLD EDIT SYSTEM ${m.version} · ${tidy(probe, cfg.BOLD_HOME)} · instalado (${rec.mode}, ${rec.artifacts.length} artefato(s))`));
    const shim = probe.which('bold');
    const rs = mk('core', 'cli-path', 'CLI `bold` no PATH');
    if (!shim) out.push(rs('WARNING', 'não está no PATH', `Rode ./install.sh e adicione ${tidy(probe, binDir(pctx))} ao PATH.`));
    else { let txt = ''; try { txt = fs.readFileSync(shim, 'utf8'); } catch { /* binário */ } const ok = txt.includes(MARKER) ? txt.includes(cfg.BOLD_HOME) : txt.includes('bold.mjs');
      out.push(ok ? rs('PASS', tidy(probe, shim)) : rs('WARNING', `${tidy(probe, shim)} não aponta para este BOLD_HOME`)); }
  }

  // Leak scanner sobre a própria Skill
  {
    const r = mk('core', 'leak-scan', 'Leak scanner (Skill)');
    try {
      const res = (ctx.scan || scanLeaks)(cfg.BOLD_HOME, { env: probe.env });
      if (res.status === 'PASS') out.push(r('PASS', `${res.files_scanned} arquivos, 0 achados (denylists locais: ${res.local_denylists_loaded})`));
      else out.push(r('FAIL', `${res.findings.length} achado(s) — rode \`bold audit-leaks\``));
    } catch (e) {
      out.push(r('FAIL', `erro no scanner: ${e.message}`));
    }
  }
  return out;
}

// ───────────────────────────── MOTION ─────────────────────────────

export function motionChecks(ctx) {
  const { probe, loaded, requested } = ctx;
  const cfg = loaded.config;
  const req = requested.has('motion');
  const miss = req ? 'FAIL' : 'WARNING';
  const out = [];

  {
    const r = mk('motion', 'node22', 'Node ≥ 22 (HyperFrames)');
    const v = parseVersion(probe.nodeVersion);
    out.push(v && v[0] >= 22 ? r('PASS', probe.nodeVersion) : r('WARNING', `${probe.nodeVersion} — HyperFrames exige Node ≥ 22`));
  }
  for (const tool of ['npm', 'npx']) {
    const r = mk('motion', tool, tool);
    const w = probe.which(tool);
    if (!w) { out.push(r(miss, `${tool} não encontrado`, 'Instale Node LTS (inclui npm/npx).')); continue; }
    const v = tool === 'npm' ? probe.run(w, ['-v']) : { ok: true, stdout: '' };
    out.push(r('PASS', `${tidy(probe, w)}${v.ok && v.stdout.trim() ? ` (${v.stdout.trim()})` : ''}`));
  }

  // FFmpeg / FFprobe / prores_ks
  const ffmpeg = resolveTool(ctx, cfg.tools?.FFMPEG_PATH, ['ffmpeg']);
  {
    const r = mk('motion', 'ffmpeg', 'FFmpeg');
    if (!ffmpeg) out.push(r(miss, 'ffmpeg não encontrado', 'Necessário para o pipeline de entrega BT.709.'));
    else {
      const v = probe.run(ffmpeg, ['-hide_banner', '-version']);
      out.push(r('PASS', `${tidy(probe, ffmpeg)} — ${(v.stdout.split('\n')[0] || '').replace(/ Copyright.*/, '')}`));
      const enc = probe.run(ffmpeg, ['-hide_banner', '-encoders']);
      const pr = mk('motion', 'prores_ks', 'Encoder prores_ks');
      out.push(/\bprores_ks\b/.test(enc.stdout) ? pr('PASS', 'disponível (ProRes 4444 alpha)') : pr('FAIL', 'prores_ks ausente — pipeline ProRes 4444 indisponível'));
    }
  }
  {
    const r = mk('motion', 'ffprobe', 'FFprobe');
    const fp = resolveTool(ctx, cfg.tools?.FFPROBE_PATH, ['ffprobe']);
    out.push(fp ? r('PASS', tidy(probe, fp)) : r(miss, 'ffprobe não encontrado', 'Necessário para validar tags BT.709.'));
  }

  // Python + Pillow (opcional para motion: texturas procedurais)
  out.push(...pythonChecks(ctx, 'motion', { pillowOptional: true }));

  // Remotion (dependência EXTERNA; licença PENDENTE). Mesma detecção usada por `bold render`.
  {
    const r = mk('motion', 'remotion', 'Remotion (externo)');
    const dir = cfg.tools?.REMOTION_PROJECT_DIR;
    const pin = cfg.tools?.REMOTION_VERSION;
    if (!dir) out.push(r('WARNING', 'UNAVAILABLE: tools.REMOTION_PROJECT_DIR / BOLD_REMOTION_PROJECT_DIR não configurado (backend de render indisponível; resto da Skill funciona)', 'Licença Remotion: PENDENTE — a Skill não instala nem redistribui.'));
    else {
      const det = (ctx.detectRemotion ?? detectRemotion)(dir);
      if (det.status === 'AVAILABLE') {
        const v = det.versions;
        out.push(r(v.remotion === pin ? 'PASS' : 'WARNING', `AVAILABLE: remotion ${v.remotion} (pin ${pin}) · react ${v.react} · browser OK · em ${tidy(probe, dir)}`));
      } else out.push(r('WARNING', `UNAVAILABLE: ${det.reason}`, 'Nada é baixado/instalado automaticamente.'));
    }
  }

  // HyperFrames (dependência externa; detectar, nunca executar render)
  {
    const r = mk('motion', 'hyperframes', 'HyperFrames (externo)');
    const pin = cfg.tools?.HYPERFRAMES_VERSION;
    const found = [];
    const configured = cfg.tools?.HYPERFRAMES_CMD;
    if (configured && configured !== 'auto') { if (probe.exists(configured) || probe.which(configured)) found.push({ via: 'config', version: null, where: configured }); }
    const pluginBase = probe.join(probe.home, '.claude', 'plugins', 'cache', 'hyperframes', 'hyperframes');
    for (const v of probe.readdir(pluginBase)) {
      const launcher = probe.join(pluginBase, v, 'skills', 'hyperframes', 'scripts', 'plugin-cli.mjs');
      if (probe.isFile(launcher)) found.push({ via: 'plugin', version: v, where: launcher });
    }
    const npxBase = probe.join(probe.home, '.npm', '_npx');
    for (const d of probe.readdir(npxBase)) {
      const pkg = probe.readJson(probe.join(npxBase, d, 'node_modules', 'hyperframes', 'package.json'));
      if (pkg?.version) found.push({ via: 'npx-cache', version: pkg.version, where: probe.join(npxBase, d) });
    }
    const onPath = probe.which('hyperframes');
    if (onPath) found.push({ via: 'PATH', version: null, where: onPath });
    const note = 'NUNCA usar --format mov para o Resolve (bug BT.601 upstream) — usar png-sequence + encode BT.709.';
    if (!found.length) out.push(r('WARNING', `não encontrado (opcional). ${note}`));
    else {
      const pinned = found.some((f) => f.version === pin);
      const list = found.map((f) => `${f.via}${f.version ? `@${f.version}` : ''}`).join(', ');
      out.push(r(pinned ? 'PASS' : 'WARNING', `${list} (pin ${pin}). ${note}`));
    }
  }

  // Browsers headless em cache (só detecção)
  {
    const r = mk('motion', 'browsers', 'Browser headless (cache)');
    const hits = [];
    for (const base of [probe.join(probe.home, '.cache', 'hyperframes', 'chrome'), probe.join(probe.home, '.cache', 'puppeteer')]) {
      for (const kind of probe.readdir(base)) for (const ver of probe.readdir(probe.join(base, kind))) hits.push(`${kind}/${ver}`);
    }
    out.push(hits.length ? r('PASS', hits.join(', ')) : r('WARNING', 'nenhum em cache — ferramentas baixam no 1º uso (exige autorização)'));
  }
  return out;
}

// ───────────────────────────── PYTHON (compartilhado) ─────────────────────────────

function pythonChecks(ctx, module, { pillowOptional = true } = {}) {
  const { probe, loaded, requested } = ctx;
  const req = requested.has(module);
  const r = mk(module, 'python', 'Python');
  const configured = loaded.config.tools?.PYTHON_PATH;
  const candidates = configured && configured !== 'auto'
    ? [configured]
    : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'];
  let chosen = null;
  let firstFound = null;
  for (const c of candidates) {
    const w = probe.which(c) || (probe.isFile(c) ? c : null);
    if (!w) continue;
    const v = probe.run(w, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])']);
    if (!v.ok) continue;
    const ver = parseVersion(v.stdout);
    const entry = { path: w, version: v.stdout.trim(), ver };
    if (!firstFound) firstFound = entry;
    if (ver && cmpVersion(ver, [3, 10, 0]) >= 0) { chosen = entry; break; }
  }
  const out = [];
  if (!chosen && !firstFound) {
    out.push(r(req && module !== 'motion' ? 'FAIL' : 'WARNING', 'Python não encontrado', 'Defina tools.PYTHON_PATH.'));
    return out;
  }
  const py = chosen || firstFound;
  out.push(chosen ? r('PASS', `${tidy(probe, py.path)} (${py.version})`) : r('WARNING', `${tidy(probe, py.path)} (${py.version}) — recomendado ≥ 3.10`, 'Defina tools.PYTHON_PATH.'));
  const pil = probe.run(py.path, ['-c', 'import PIL;print(PIL.__version__)']);
  const rp = mk(module, 'pillow', 'Pillow');
  if (pil.ok) out.push(rp('PASS', `Pillow ${pil.stdout.trim()} em ${tidy(probe, py.path)}`));
  else out.push(rp(pillowOptional ? 'WARNING' : (req ? 'FAIL' : 'WARNING'), `Pillow ausente no Python selecionado (${tidy(probe, py.path)})`, 'Opcional: necessário só para texturas/placeholders.'));
  return out;
}

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, ''); // R10: fileURLToPath (pathname codifica espaços/Unicode e quebra no Windows)

// ───────────────────────────── DAVINCI ─────────────────────────────

export function davinciChecks(ctx) {
  const { probe, loaded, requested } = ctx;
  const cfg = loaded.config.davinci || {};
  const req = requested.has('davinci');
  const miss = req ? 'FAIL' : 'WARNING';
  const out = [];
  out.push(...pythonChecks(ctx, 'davinci', { pillowOptional: true }).filter((c) => c.id !== 'davinci.pillow'));

  const r = mk('davinci', 'app', 'DaVinci Resolve');
  const app = cfg.DAVINCI_PATH;
  if (!app || app === 'auto' || !probe.exists(app)) {
    out.push(r(miss, `não encontrado${app && app !== 'auto' ? ` em ${tidy(probe, app)}` : ''}`, 'USER_PROVIDED. Instale o Resolve ou ajuste davinci.DAVINCI_PATH.'));
  } else {
    let version = null;
    if (probe.platform === 'darwin') {
      const v = probe.run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', probe.join(app, 'Contents', 'Info.plist')]);
      if (v.ok) version = v.stdout.trim();
    }
    const validated = cfg.validated_version;
    const pv = parseVersion(version);
    const vv = parseVersion(validated);
    const same = pv && vv && pv[0] === vv[0] && pv[1] === vv[1];
    if (!version) out.push(r('PASS', `${tidy(probe, app)} (versão não lida neste SO)`));
    else out.push(r(same ? 'PASS' : 'WARNING', `${version} (regras validadas em ${validated})`, same ? undefined : 'Regras de API foram validadas em outra versão; revalidar no sandbox.'));
  }

  const ra = mk('davinci', 'scripting-api', 'DaVinci Scripting API');
  const envApi = probe.env.RESOLVE_SCRIPT_API;
  const api = loaded.sources['davinci.DAVINCI_SCRIPT_API']?.startsWith('default') && envApi ? envApi : cfg.DAVINCI_SCRIPT_API;
  const lib = loaded.sources['davinci.DAVINCI_SCRIPT_LIB']?.startsWith('default') && probe.env.RESOLVE_SCRIPT_LIB ? probe.env.RESOLVE_SCRIPT_LIB : cfg.DAVINCI_SCRIPT_LIB;
  const modFile = api && api !== 'auto' ? probe.join(api, 'Modules', 'DaVinciResolveScript.py') : null;
  const hasMod = modFile && probe.isFile(modFile);
  const hasLib = lib && lib !== 'auto' && probe.isFile(lib);
  if (hasMod && hasLib) out.push(ra('PASS', 'DaVinciResolveScript.py e fusionscript encontrados.'));
  else out.push(ra(miss, `${hasMod ? '' : 'DaVinciResolveScript.py ausente; '}${hasLib ? '' : 'fusionscript ausente'}`.trim(), 'Preferences → General → External scripting = Local; confira os caminhos davinci.*'));

  // R7: Bridge + conexão SOMENTE LEITURA (status). Nunca abre o Resolve, nunca troca projeto/timeline/página.
  const rb = mk('davinci', 'bridge', 'DaVinci Bridge V1');
  const bridgeFile = probe.join(SKILL_ROOT, 'davinci', 'bridge', 'cli.py');
  if (!probe.isFile(bridgeFile)) { out.push(rb(miss, 'davinci/bridge ausente na Skill')); return out; }
  out.push(rb('PASS', 'presente (status/inspect/checkpoint/import/insert/verify; delete/render/export indisponíveis)'));
  const rc = mk('davinci', 'connection', 'Conexão com o Resolve (somente leitura)');
  if (!req) { out.push(rc('PASS', 'não testada (rode `bold doctor --module davinci`; o doctor geral nunca conecta no Resolve)')); return out; }
  const py = ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'].map((c) => probe.which(c)).find(Boolean);
  if (!py || !(hasMod && hasLib)) { out.push(rc('WARNING', 'não testada (Python ou Scripting API ausente)')); return out; }
  const code = `import sys,json\nsys.path.insert(0, sys.argv[1])\nfrom davinci.api.connect import connect, BridgeError\nfrom davinci.bridge.ops import status\ntry:\n  s=status(connect()); print(json.dumps({"ok":True,"product":s["product"],"version":s["version"],"studio":s["studio"],"page":s["page"],"project_open":s["project"] is not None,"sandbox":s["write_safety"]["project_is_sandbox"]}))\nexcept BridgeError as e: print(json.dumps({"ok":False,"code":e.code}))`;
  const res = probe.run(py, ['-c', code, SKILL_ROOT], { timeout: 30000 });
  let j = null; try { j = JSON.parse((res.stdout || '').trim().split('\n').pop()); } catch { /* sem JSON */ }
  if (j?.ok) out.push(rc('PASS', `connected · ${j.product} ${j.version}${j.studio ? ' (Studio)' : ''} · página ${j.page} · ${j.project_open ? (j.sandbox ? 'projeto sandbox aberto' : 'projeto do usuário aberto (writes exigem autorização humana)') : 'nenhum projeto aberto'}`));
  else out.push(rc('WARNING', `disconnected${j?.code ? ` (${j.code})` : ''}`, 'Abra o Resolve e ative Preferences → System → General → External scripting = Local. O doctor nunca abre o Resolve.'));
  return out;
}

// ───────────────────────────── TRANSCRIPT ─────────────────────────────

export function transcriptChecks(ctx) {
  const { probe, loaded } = ctx;
  const cfg = loaded.config;
  const out = [];
  // R8: o núcleo (normalização SRT/VTT/JSON/DaVinci, análise, busca, export) é embutido e não depende de STT.
  {
    const r = mk('transcript', 'engine', 'Transcript Engine V1 (normalizadores embutidos)');
    const files = ['parsers.mjs', 'normalize.mjs', 'analyze.mjs', 'search.mjs'].map((f) => `${SKILL_ROOT}/transcript/src/${f}`);
    out.push(files.every((f) => fs.existsSync(f)) ? r('PASS', 'SRT · VTT · JSON (whisper.cpp -ojf, segments[]) · legendas do DaVinci (leitura) → bold.transcript/1') : r('FAIL', 'transcript/src incompleto na Skill'));
  }
  // Provider STT (whisper.cpp) é OPCIONAL: ausência nunca bloqueia a normalização (WARNING mesmo com --module transcript).
  {
    const r = mk('transcript', 'whisper-cli', 'Provider STT opcional: whisper.cpp (whisper-cli)');
    const w = resolveTool(ctx, cfg.tools?.WHISPER_CLI, ['whisper-cli', 'whisper-cpp']);
    out.push(w ? r('PASS', `${tidy(probe, w)} (detectado; a V1 normaliza a saída JSON -ojf, não executa o STT)`) : r('WARNING', 'não encontrado (opcional)', 'SRT/VTT/JSON funcionam sem STT. Instalação só com autorização.'));
  }
  {
    const r = mk('transcript', 'whisper-model', 'Modelo Whisper (opcional)');
    const m = cfg.tools?.WHISPER_MODEL;
    if (!m) out.push(r('WARNING', 'tools.WHISPER_MODEL não configurado (opcional)', 'USER_PROVIDED; a Skill nunca distribui nem baixa modelos sem autorização.'));
    else if (!probe.isFile(m)) out.push(r('WARNING', `não encontrado: ${tidy(probe, m)}`));
    else out.push(r('PASS', `${tidy(probe, m)} (${(probe.fileSize(m) / GB).toFixed(2)} GiB)`));
  }
  {
    const r = mk('transcript', 'ffmpeg', 'FFmpeg (só para extrair áudio para STT futuro)');
    const f = resolveTool(ctx, cfg.tools?.FFMPEG_PATH, ['ffmpeg']);
    out.push(f ? r('PASS', tidy(probe, f)) : r('WARNING', 'não encontrado (não afeta SRT/VTT/JSON)'));
  }
  out.push(mk('transcript', 'davinci-subtitles', 'Legendas do DaVinci (somente leitura)')('PASS', 'via operações de LEITURA da Bridge V1 (allowlist); conexão não testada aqui'));
  return out;
}

// ───────────────────────────── ASSETS ─────────────────────────────

export function assetsChecks(ctx) {
  const { probe, loaded } = ctx;
  const cfg = loaded.config;
  const out = [];
  {
    const r = mk('assets', 'engine', 'Asset Index V1 (scan, cabeçalhos, fontes sfnt, busca)');
    const files = ['scan.mjs', 'headers.mjs', 'probe.mjs', 'query.mjs', 'store.mjs'].map((f) => `${SKILL_ROOT}/asset-index/src/${f}`);
    out.push(files.every((f) => fs.existsSync(f)) ? r('PASS', 'scan somente leitura · identidade por caminho NFC · hash auto/none/full · incremental') : r('FAIL', 'asset-index/src incompleto na Skill'));
  }
  {
    const r = mk('assets', 'ffprobe', 'ffprobe (metadados de vídeo/áudio)');
    const f = resolveTool(ctx, cfg.tools?.FFPROBE_PATH, ['ffprobe']);
    out.push(f ? r('PASS', tidy(probe, f)) : r('WARNING', 'não encontrado: vídeo/áudio ficam com probe UNAVAILABLE (tipo, tamanho, datas, imagens PNG/JPEG/GIF/WebP e fontes continuam)', 'Instalação só com autorização.'));
  }
  {
    const r = mk('assets', 'cache', 'Local do índice (cache derivado)');
    const dir = loaded.project?.valid ? `${loaded.project.root}/.bold/index` : `${cfg.CACHE_DIR}/asset-index`;
    out.push(r('PASS', `${tidy(probe, dir)} (descartável; nunca dentro da pasta escaneada)`));
  }
  out.push(mk('assets', 'davinci', 'Relação com o DaVinci (opcional, somente leitura)')('PASS', `${probe.isFile(`${SKILL_ROOT}/davinci/bridge/cli.py`) ? 'Bridge V1 presente' : 'Bridge ausente'} · allowlist status/projects/timelines/inspect/media; conexão não testada aqui`));
  return out;
}

// ───────────────────────────── CLAUDE (R10) ─────────────────────────────

/** Frontmatter simples (chaves de 1 nível) + checagens da documentação oficial (descrição+when_to_use ≤ 1536). */
export function checkSkillDir(dir) {
  const issues = []; const f = `${dir}/SKILL.md`;
  if (!fs.existsSync(f)) return { ok: false, issues: ['SKILL.md ausente'] };
  const txt = fs.readFileSync(f, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(txt);
  if (!m) issues.push('frontmatter ausente (o arquivo deve abrir com ---)');
  const fm = {}; for (const line of (m?.[1] ?? '').split('\n')) { const kv = /^([a-z][a-z0-9_-]*):\s*(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1'); }
  if (!fm.description) issues.push('description ausente');
  const len = (fm.description ?? '').length + (fm.when_to_use ?? '').length;
  if (len > 1536) issues.push(`description + when_to_use = ${len} > 1536 (truncado pelo Claude Code)`);
  const lines = txt.split('\n').length; if (lines > 500) issues.push(`SKILL.md com ${lines} linhas (recomendado < 500)`);
  const links = [...txt.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((x) => x[1]).filter((l) => !/^(https?:|<)/.test(l));
  for (const l of links) if (!fs.existsSync(`${dir}/${l}`)) issues.push(`arquivo de apoio ausente: ${l}`);
  return { ok: !issues.length, issues, frontmatter: fm, links, description_chars: len, lines };
}

export function claudeChecks(ctx) {
  const { probe, loaded } = ctx; const cfg = loaded.config; const out = [];
  const pctx = { platform: probe.platform, env: probe.env ?? {}, home: probe.home };
  const src = `${cfg.BOLD_HOME}/${SKILL_SOURCE}`;
  {
    const r = mk('claude', 'cli', 'Claude Code CLI');
    const c = probe.which('claude');
    out.push(c ? r('PASS', tidy(probe, c)) : r('WARNING', 'não encontrado no PATH', 'Opcional para o BOLD. No app desktop o CLI pode não estar no PATH; a Skill funciona mesmo assim.'));
  }
  {
    const r = mk('claude', 'skill-package', `Skill do pacote (${SKILL_SOURCE})`);
    const k = checkSkillDir(src);
    out.push(k.ok ? r('PASS', `SKILL.md válido · ${k.description_chars}/1536 caracteres de descrição · ${k.lines} linhas · ${k.links.length} arquivo(s) de apoio OK`) : r('FAIL', k.issues.join('; ')));
  }
  {
    const r = mk('claude', 'skill-personal', `Skill pessoal (/${SKILL_NAME})`);
    const dest = personalSkillDir(pctx);
    let st = null; try { st = fs.lstatSync(dest); } catch { /* ausente */ }
    if (!st) out.push(r('WARNING', `não instalada (${tidy(probe, dest)})`, 'Opcional: ./install.sh instala a Skill pessoal; alternativa: plugin (references/plugin-packaging.md).'));
    else if (st.isSymbolicLink()) { let t = ''; try { t = fs.realpathSync(dest); } catch { /* quebrado */ } out.push(t === fs.realpathSync(src) ? r('PASS', `${tidy(probe, dest)} → ${tidy(probe, src)} (symlink)`) : r('WARNING', `symlink aponta para outro lugar (${tidy(probe, t || 'quebrado')})`, 'Rode ./install.sh update --from <checkout>.')); }
    else if (fs.existsSync(`${dest}/${COPY_MARKER}`)) { const same = fs.readFileSync(`${dest}/SKILL.md`, 'utf8') === fs.readFileSync(`${src}/SKILL.md`, 'utf8'); out.push(same ? r('PASS', `${tidy(probe, dest)} (cópia gerenciada, atualizada)`) : r('WARNING', 'cópia gerenciada desatualizada', 'Rode ./install.sh update.')); }
    else out.push(r('WARNING', `${tidy(probe, dest)} existe e NÃO foi criada pelo installer (conflito de nome)`, 'O installer não sobrescreve; use --replace-skill (faz backup) se for intencional.'));
  }
  {
    const r = mk('claude', 'skill-project', 'Skill de projeto (.claude/skills)');
    const dest = `${process.cwd()}/.claude/skills/${SKILL_NAME}`;
    out.push(fs.existsSync(`${dest}/SKILL.md`) ? r('PASS', `presente neste diretório (${tidy(probe, dest)})`) : r('PASS', 'não usada neste diretório (opcional)'));
  }
  {
    const r = mk('claude', 'plugin', 'Pacote de plugin (.claude-plugin/plugin.json)');
    let pj = null; try { pj = JSON.parse(fs.readFileSync(`${cfg.BOLD_HOME}/.claude-plugin/plugin.json`, 'utf8')); } catch { /* ausente */ }
    let ver = null; try { ver = JSON.parse(fs.readFileSync(`${cfg.BOLD_HOME}/package.json`, 'utf8')).version; } catch { /* */ }
    if (!pj) out.push(r('WARNING', 'plugin.json ausente'));
    else if (pj.version !== ver) out.push(r('FAIL', `plugin.json version ${pj.version} ≠ produto ${ver}`));
    else out.push(r('PASS', `plugin "${pj.name}" ${pj.version} · invocação /${pj.name}:edit (validação oficial: claude plugin validate)`));
  }
  {
    const r = mk('claude', 'config-dir', 'Diretório do Claude Code');
    const d = claudeDir(pctx);
    out.push(r('PASS', `${tidy(probe, d)}${probe.env?.CLAUDE_CONFIG_DIR ? ' (CLAUDE_CONFIG_DIR)' : ''}${fs.existsSync(d) ? '' : ' (ainda não existe)'}`));
  }
  return out;
}
