#!/usr/bin/env node
// bold — CLI do BOLD Edit System.
// Implementados: --help, --version, doctor, config, audit-leaks (R2) · probe, qc, delivery (R4) · render, qc stills (R5) ·
// render por backend + motion validate/compile/inspect (R6.1) · davinci (R7: Bridge V1) ·
// transcript · assets · context (R8: Transcript Engine V1, Asset Index V1, Project Context V1 — descritivos) ·
// editorial (R9: Editorial + Motion Decision Engine V1 — DECIDE, nunca executa; `motion route` = alias).
// setup (R12.2: Setup Manager — plano informativo; apply/uninstall com confirmação e só artefatos fixados no lock).
// audio (R13: sound design — SFX Kit local, Openverse como fallback, Earshot opcional; plano → conform → mix → exports).
// PLANNED: new, export.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config/load.mjs';
import { createProbe } from '../core/doctor/probe.mjs';
import { runDoctor, formatDoctor } from '../core/doctor/doctor.mjs';
import { scanLeaks } from '../core/leak/scan.mjs';
import { PROTECTED_ACTIONS } from '../core/policy/gate.mjs';
import { cmdProbe, cmdQc, cmdDelivery, cmdRender } from './commands/media.mjs';
import { cmdMotion } from './commands/motion.mjs';
import { cmdDavinci } from './commands/davinci.mjs';
import { cmdTranscript } from './commands/transcript.mjs';
import { cmdAssets } from './commands/assets.mjs';
import { cmdContext } from './commands/context.mjs';
import { cmdEditorial } from './commands/editorial.mjs';
import { productManifest } from '../core/product.mjs';
import { cmdDist } from './commands/dist.mjs';
import { cmdSetup } from './commands/setup.mjs';
import { cmdAudio } from './commands/audio.mjs';
import { readToolchain, toolchainProcessEnv, unverifiedRunningNode } from '../core/config/toolchain.mjs';
import { sanitizeProcessEnv } from '../core/config/child-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(HERE, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(HOME, 'package.json'), 'utf8')).version;

const PLANNED = {
  new: 'Criar PROJECT_ROOT com bold.project.json a partir de templates/project.',
  export: 'Export final (ação PROTEGIDA: exige autorização estruturada pelo policy gate).',
};

const HELP = `bold ${VERSION} — BOLD Edit System

Uso: bold <comando> [opções]

Comandos:
  home [--json]       BOLD_HOME (raiz do pacote), versão do produto e componentes (R10).
  dist build | audit | compare | plan
                      Distribuição privada (R11): build reprodutível só INCLUDE a partir de um commit + lock + auditoria.
  setup [plan|platform|inventory|status|verify|rollback|simulate|licenses|apply|uninstall|consent] [--json]
                      Setup Manager (R12): plano somente leitura; apply só com --components e confirmação; só artefatos fixados no lock.
  doctor [--json] [--module core|motion|davinci|transcript|assets|claude|toolchain|audio|all]
                      Diagnóstico SOMENTE LEITURA do ambiente (PASS/WARNING/FAIL).
                      Módulos não solicitados ausentes = WARNING; solicitados = FAIL.
  config [--json] [--paths]
                      Mostra a configuração efetiva, a origem de cada valor e a policy.
                      Precedência: ENV BOLD_* > bold.project.json > config do usuário > defaults por SO.
  audit-leaks [dir] [--json]
                      Varre a Skill (ou [dir]) por paths pessoais, segredos, binários proibidos,
                      diretórios proibidos e termos de cliente das denylists locais. FAIL se achar.

  probe <arquivo> [--json] [--profile ID] [--expected-frames N] [--fps F] [--count-frames]
                      Metadados (ffprobe) + validação contra um perfil de entrega (PASS/WARNING/FAIL).
  qc file|alpha <arquivo> [--profile ID] [--expected-frames N] [--fps F] [--width W --height H]
                      [--expect-empty-ends] [--samples K] [--json]
                      MACHINE QC (frames reais, tags, alpha, bordas/halo). VISUAL QC fica PENDING.
  render <motion.spec.json> [--output out.mov] [--authorization-file f] [--keep-frames] [--no-stills] [--concurrency N] [--verify-determinism] [--json]
                      motion.spec → backend (decision.backend: remotion | hyperframes) → frames PNG → BOLD Delivery →
                      probe → MACHINE QC → stills → manifest. Ação PROTEGIDA (render + encode): a autorização é
                      checada ANTES de iniciar qualquer processo. Remotion e HyperFrames são dependências EXTERNAS.
  motion validate|compile|inspect <motion.spec.json> [--format 16:9|9:16|1:1] [--output f] [--html f] [--stills t1,t2] [--json]
                      SEM vídeo. validate: autoria + compilação + plano + gate de fontes. compile: grava o plano
                      (HyperFrames: bold.hyperframes.spec/0 e, com --html, a composição). inspect (HyperFrames): lint,
                      layout resolvido, gate dinâmico de fontes e stills PNG opcionais (snapshot).
  davinci status | projects | timelines | inspect | timeline inspect | media inspect | verify | checkpoint | import | insert | integrate | delete
                      DaVinci Bridge V1 (R7). Leitura nunca troca projeto/timeline/página. Writes: --resolve-project +
                      --timeline exatos, página Edit, checkpoint, gate de timeline imediatamente antes, File Path,
                      readback. Projeto não-sandbox exige autorização humana davinci-write. delete (V1.1): sem ripple, alvos exatos, autorização listando delete. Sem render/export.
  transcript inspect | normalize | analyze | search | export
                      Transcript Engine V1 (R8): SRT · VTT · JSON (whisper.cpp, segments[]) · legendas do DaVinci
                      (somente leitura) → bold.transcript/1. analyze = candidatos DESCRITIVOS (sem decisão editorial).
                      Sem STT obrigatório; nada é baixado.
  assets scan | inspect | search | duplicates | davinci
                      Asset Index V1 (R8): scan SOMENTE LEITURA, identidade por caminho (nome não é identidade),
                      ffprobe + cabeçalhos, hash eficiente, cache incremental. davinci = Media Pool ↔ arquivo ↔ uso (leitura).
  context build | query
                      Project Context V1 (R8): transcrição + assets + DaVinci (leitura) num bold.project-context/1.
  editorial analyze | plan | inspect | explain | validate | route
                      Editorial + Motion Decision Engine V1 (R9): sinais → plano editorial explicável
                      (bold.editorial-plan/1) com prioridade, densidade, legenda, assets e Motion Router.
                      DECIDIR ≠ EXECUTAR: o plano é rascunho para revisão humana; nada é escrito ou renderizado.
  motion route <plan.json> <dNNNN>
                      Motion Router (alias de editorial route): HYPERFRAMES · REMOTION · FUSION · DAVINCI_NATIVE · NONE.
  qc stills <arquivo> [--output dir] [--no-contact-sheet] [--json]
                      Stills first/25/50/75/last + contact sheet para VISUAL QC humano (sem autorização extra).
  audio status | library | search | events | select | plan | render | verify | measure | export | mux | openverse | earshot | setup | storage
                      Sound design (R13): SFX Kit local (CC0) → Openverse (fallback, licença verificada) → Earshot (opcional).
                      Eventos do motion.spec/plano editorial → plano de som (densidade por estilo; início = momento − sync.at)
                      → WAV conformados por amostra → stem/mix (EBU R128, true peak) → Remotion TSX / cue list DaVinci.
                      Nada baixa sem --yes; nada sobrescreve; vídeo com áudio = PROTEGIDA (preview-video).
  delivery profiles | encode | blur | fix-color
                      Entrega controlada: sequência → ffmpeg BT.709 explícito → validação → manifest.
                      Gera vídeo ⇒ ação PROTEGIDA: --authorization-file | --authorization '{json}' | TTY.

Planejados (não implementados nesta rodada):
${Object.entries(PLANNED).map(([k, v]) => `  ${k.padEnd(18)}  ${v}`).join('\n')}

Opções globais:
  --project <dir>     PROJECT_ROOT explícito (senão: BOLD_PROJECT_ROOT ou busca por bold.project.json)
  -h, --help          Esta ajuda
  -v, --version       Versão do produto (--json: manifest de componentes)

Política: render/export SEMPRE exigem autorização explícita; OpenPage proibido;
mídia do usuário nunca é apagada; telemetria desligada. Ver references/render-policy.md.`;

const VALUED = new Set(['profile', 'expected-frames', 'fps', 'width', 'height', 'samples', 'input', 'output', 'start-number',
  'subframes', 'shutter', 'authorization', 'authorization-file', 'evidence-pixel', 'source-matrix', 'evidence', 'concurrency', 'format', 'html', 'stills', 'resolve-project', 'timeline', 'file', 'track', 'at', 'duration', 'src-in', 'operation', 'checkpoint-dir', 'request', 'targets', 'path',
  'language', 'vocabulary', 'from', 'to', 'speaker', 'type', 'orientation', 'alpha', 'index', 'hash', 'transcript', 'ext', 'tag', 'codec', 'min-duration', 'max-duration', 'limit', 'root', 'fps-tc',
  'ref', 'include', 'kind', 'dur', 'size', 'style', 'speech', 'voice', 'music', 'offset', 'page', 'category', 'audio', 'video', 'conformed', 'tc-start', 'public-prefix', 'remotion-tsx', 'davinci-csv', 'apex', 'tolerance', 'cues', 'reference', 'image', 'tool', 'toolchain-dir', 'components', 'archive', 'component', 'basis', 'context', 'transcript-id', 'mode', 'intent', 'intent-text', 'identity', 'subtitle-presence', 'aspect', 'resolution', 'availability', 'platform', 'archive-dir']);
const MULTI = new Set(['transcript']);
const FLAGS = new Set(['count-frames', 'expect-empty-ends', 'keep-temp', 'keep-frames', 'no-stills', 'no-contact-sheet', 'verify-determinism', 'drp', 'no-drp', 'brief',
  'davinci', 'subtitles', 'all-timelines', 'no-probe', 'include-hidden', 'verify', 'yes', 'keep', 'dry-run', 'revoke', 'full', 'allow-unverified']);

function parseArgs(argv) {
  const args = { _: [], json: false, modules: [], project: null, paths: false, opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--paths') args.paths = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a.startsWith('--project=')) args.project = a.slice(10);
    else if (a === '--module') args.modules.push(...String(argv[++i] || '').split(',').filter(Boolean));
    else if (a.startsWith('--module=')) args.modules.push(...a.slice(9).split(',').filter(Boolean));
    else if (a.startsWith('--') && FLAGS.has(a.slice(2))) args.opts[a.slice(2)] = true;
    else if (a.startsWith('--') && VALUED.has(a.slice(2).split('=')[0])) {
      const [k, ...rest] = a.slice(2).split('=');
      const val = rest.length ? rest.join('=') : argv[++i];
      if (MULTI.has(k)) (args.opts[k] ??= []).push(val); else args.opts[k] = val;
    }
    else if (a.startsWith('-')) { args.unknown = a; }
    else args._.push(a);
  }
  return args;
}

function load(args) {
  const loaded = loadConfig({ projectRoot: args.project ? path.resolve(args.project) : null });
  // R12.4: Chrome headless CONFIGURADO pelo usuário → ponto de integração do HyperFrames Core (sem modificá-lo).
  // Só no processo e só se o usuário não definiu BOLD_HYPERFRAMES_CHROME. O BOLD não baixa nem verifica esse binário.
  const chrome = loaded.config.tools?.CHROME_HEADLESS_PATH;
  if (chrome && !process.env.BOLD_HYPERFRAMES_CHROME) process.env.BOLD_HYPERFRAMES_CHROME = chrome;
  return loaded;
}

function cmdDoctor(args) {
  const loaded = load(args);
  const report = runDoctor({ probe: createProbe(), loaded, modules: args.modules, version: VERSION });
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatDoctor(report)}\n`);
  return report.exit_code;
}

function cmdConfig(args) {
  const loaded = load(args);
  const payload = {
    config: loaded.config,
    sources: loaded.sources,
    files: { user: loaded.user.path, user_exists: loaded.user.exists, project: loaded.project.file },
    policy: { effective: loaded.policy.effective, violations: loaded.policy.violations },
    errors: loaded.errors,
    warnings: loaded.warnings,
    unresolved: loaded.unresolved,
  };
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else if (args.paths) {
    process.stdout.write(`user config : ${payload.files.user} (${payload.files.user_exists ? 'existe' : 'não existe'})\nproject     : ${payload.files.project || '(nenhum)'}\nBOLD_HOME   : ${loaded.config.BOLD_HOME}\nCACHE_DIR   : ${loaded.config.CACHE_DIR}\nRENDER_DIR  : ${loaded.config.RENDER_DIR}\n`);
  } else {
    const flat = [];
    const walk = (o, pre = '') => {
      for (const [k, v] of Object.entries(o)) {
        const key = pre ? `${pre}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else flat.push(`${key.padEnd(34)} ${JSON.stringify(v)}  ← ${loaded.sources[key] || (key.startsWith('policy.') ? 'policy (invariante)' : 'derivado')}`);
      }
    };
    walk(loaded.config);
    process.stdout.write(`${flat.join('\n')}\n`);
    if (loaded.policy.violations.length) process.stdout.write(`\nVIOLAÇÕES DE POLICY (ignoradas): ${JSON.stringify(loaded.policy.violations)}\n`);
    if (loaded.errors.length) process.stdout.write(`\nERROS: ${loaded.errors.map((e) => `${e.origin}: ${e.message}`).join('\n       ')}\n`);
  }
  return loaded.errors.length || loaded.policy.violations.length ? 1 : 0;
}

function cmdAuditLeaks(args) {
  const root = path.resolve(args._[1] || HOME);
  const res = scanLeaks(root);
  if (args.json) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  else {
    process.stdout.write(`audit-leaks: ${res.root}\n  método: ${res.method} · arquivos: ${res.files_scanned} · denylists locais: ${res.local_denylists_loaded} (${res.local_terms} termos)\n`);
    for (const f of res.findings) process.stdout.write(`  FAIL  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.kind}/${f.rule}]  ${f.match}\n`);
    process.stdout.write(`${res.status === 'PASS' ? '  PASS  nenhum vazamento encontrado' : `  ${res.findings.length} achado(s)`} → ${res.status}\n`);
  }
  return res.status === 'PASS' ? 0 : 1;
}

function cmdPlanned(name) {
  const protectedNote = name in PROTECTED_ACTIONS ? ' Ação PROTEGIDA pelo policy gate.' : '';
  process.stderr.write(`bold ${name}: PLANNED — não implementado na fundação (R2).${protectedNote}\n  ${PLANNED[name]}\n`);
  return 2;
}

/** R12: PATH SÓ DESTE PROCESSO com o toolchain gerenciado (no-op sem active.json válido; nunca bloqueia a CLI). */
function applyToolchainEnv() {
  try {
    const tc = readToolchain({ platform: process.platform, env: process.env, home: os.homedir() });
    const next = toolchainProcessEnv(process.env, tc, process.platform);
    if (next !== process.env) for (const k of Object.keys(next)) if (process.env[k] !== next[k]) process.env[k] = next[k];
    return tc;
  } catch { return null; /* toolchain ilegível: segue com o PATH atual */ }
}

async function main(argv) {
  // R12.5C3b-A: nenhum processo filho (HyperFrames, npm, ffmpeg, Python…) herda DYLD_*/LD_*/NODE_OPTIONS do chamador
  sanitizeProcessEnv(process.env);
  const tc = applyToolchainEnv();
  const args = parseArgs(argv);
  if (args.version) { process.stdout.write(args.json ? `${JSON.stringify(productManifest(HOME), null, 2)}\n` : `${VERSION}\n`); return 0; }
  const cmd = args._[0];
  if (args.help || !cmd || cmd === 'help') { process.stdout.write(`${HELP}\n`); return 0; }
  if (args.unknown) { process.stderr.write(`opção desconhecida: ${args.unknown}\n`); return 64; }
  // R12.5B: rodando sobre um Node gerenciado NÃO verificado (instalação anterior à política de assinatura) → só `setup`
  const legacyNode = unverifiedRunningNode(tc);
  if (legacyNode && cmd !== 'setup') { process.stderr.write(`bold: o Node em uso (${legacyNode.tool}, toolchain gerenciado) foi instalado antes da verificação de assinatura e não será usado para ${cmd}.\n  Rode: bold setup apply --components ${legacyNode.tool} --yes  (verifica e registra; nada é baixado se a versão for a mesma)\n`); return 3; }
  try {
    if (cmd === 'home') { const m = productManifest(HOME); process.stdout.write(args.json ? `${JSON.stringify(m, null, 2)}\n` : `${m.product} ${m.version}\nBOLD_HOME  ${m.bold_home}\nplataforma ${m.platform.current} (${m.platform.support})\n${m.components.map((c) => `  ${c.name.padEnd(30)} ${c.version}  ${c.status}`).join('\n')}\n`); return 0; }
    if (cmd === 'doctor') return cmdDoctor(args);
    if (cmd === 'config') return cmdConfig(args);
    if (cmd === 'audit-leaks') return cmdAuditLeaks(args);
    if (cmd === 'probe') return cmdProbe(args, load(args));
    if (cmd === 'qc') return await cmdQc(args, load(args));
    if (cmd === 'render') return await cmdRender(args, load(args));
    if (cmd === 'motion' && args._[1] === 'route') return await cmdEditorial(args, load(args), process.stdout, 'route'); // alias R9 (não toca o CLI do HyperFrames)
    if (cmd === 'motion') return await cmdMotion(args, load(args));
    if (cmd === 'davinci') return await cmdDavinci(args, load(args));
    if (cmd === 'delivery') return await cmdDelivery(args, load(args));
    if (cmd === 'transcript') return await cmdTranscript(args, load(args));
    if (cmd === 'assets') return await cmdAssets(args, load(args));
    if (cmd === 'context') return await cmdContext(args, load(args));
    if (cmd === 'editorial') return await cmdEditorial(args, load(args));
    if (cmd === 'dist') return await cmdDist(args, load(args));
    if (cmd === 'setup') return await cmdSetup(args, load(args));
    if (cmd === 'audio') return await cmdAudio(args, load(args));
    if (cmd in PLANNED) return cmdPlanned(cmd);
  } catch (e) {
    process.stderr.write(`bold ${cmd}: erro: ${e.message}\n`);
    return 1;
  }
  process.stderr.write(`comando desconhecido: ${cmd}\n\n${HELP}\n`);
  return 64;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
