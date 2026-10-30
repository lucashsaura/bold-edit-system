// Planejamento de instalação (R12) — PURO: inventário + plataforma + lock → ações propostas. Nunca executa nada.
import { componentById } from './components.mjs';
import { artifactFor } from './lock.mjs';

// Ações possíveis no plano.
//   USE_EXISTING          a ferramenta encontrada atende
//   INSTALL               instalação gerenciada possível (artefato PINNED) — executada só por `setup apply`, com confirmação
//   INSTALL_PENDING_LOCK  gerenciada, mas o lock não fixou o artefato desta plataforma → instrução manual
//   PLANNED               instalação gerenciada prevista para uma fase futura
//   MANUAL                só o usuário instala (DETECT_ONLY / NEVER / artefato NOT_PROVIDED)
//   LICENSE_REQUIRED      exige aceite explícito de licença antes de qualquer instalação
//   SKIPPED_OPTIONAL      opcional não solicitado (use --include)
//   UNSUPPORTED_PLATFORM  plataforma fora dos alvos gerenciados
const OK_STATUSES = new Set(['OK']);
/** Componente que o BOLD nunca instala em plataforma nenhuma (NEVER/DETECT_ONLY): continua MANUAL mesmo fora dos alvos. */
const manualEverywhere = (c) => Object.values(c.platforms).every((p) => p.policy === 'NEVER' || p.policy === 'DETECT_ONLY');

const HINTS = {
  node: 'Instale o Node.js LTS (nodejs.org) ou defina BOLD_NODE_PATH.',
  ffmpeg: 'Instale um FFmpeg com prores_ks (ex.: build oficial da sua plataforma) e configure tools.FFMPEG_PATH/FFPROBE_PATH.',
  python: 'Instale Python ≥ 3.10 de python.org. O ResolvePython só será usado pela Bridge depois de validado.',
  'davinci-resolve': 'Instale o DaVinci Resolve (Studio para scripting externo) e ative Preferences → General → External scripting = Local. O BOLD nunca instala o Resolve.',
  pillow: 'Opcional: Python auxiliar gerenciado + Pillow (nunca o Python da Bridge).',
  hyperframes: 'Opcional: HyperFrames via plugin/npx, ou instalação gerenciada por lockfile npm.',
  'chrome-headless-shell': 'Opcional: download gerenciado adiado (sem sha256 publicado); configure tools.CHROME_HEADLESS_PATH com um existente.',
  remotion: 'Opcional: confirme a licença Remotion (4+ pessoas = Company License) antes de instalar; configure tools.REMOTION_PROJECT_DIR.',
  'whisper-cli': 'Opcional: macOS = instale por conta própria (ex.: gerenciador de pacotes); Windows = instalação gerenciada (EXPERIMENTAL).',
  'whisper-model': 'Opcional: configure tools.WHISPER_MODEL com um modelo que você já tenha.',
  'sfx-kit': 'Opcional (sound design): bold audio library install --yes — baixa a release fixada do SFX Kit (CC0) e verifica os 320 sha256.',
  earshot: 'Opcional (análise/geração de áudio): bold audio setup earshot mostra o plano guiado (venv isolado; modelos só com aprovação).',
  'audio-storage': 'bold audio storage status — reconecte o SSD ou monte a imagem (bold audio storage attach --yes)',
};

/**
 * @param {{inventory:object, platform:object, lock:object, include?:string[]}} o  include: ids opcionais a planejar ("all" = todos)
 */
export function buildPlan({ inventory, platform, lock, include = [], allowLoopback = false, consents = {} }) {
  const inc = new Set(include);
  const actions = [];
  for (const it of inventory.components) {
    const c = componentById(it.id);
    const base = { id: it.id, name: it.name, tier: it.tier, status: it.status, version: it.version ?? null, source: it.source ?? null, policy: it.policy, phase: it.phase ?? null, license: it.license };
    let action; let reason; let artifact = null;
    if (OK_STATUSES.has(it.status)) { action = 'USE_EXISTING'; reason = 'atende ao requisito'; }
    else if (it.status === 'STORAGE_OFFLINE') { action = 'STORAGE_OFFLINE'; reason = 'instalado no armazenamento externo, que não está disponível — não reinstalo no disco interno'; }
    else if (it.tier === 'OPTIONAL' && !inc.has(it.id) && !inc.has('all')) { action = 'SKIPPED_OPTIONAL'; reason = `opcional não solicitado (--include ${it.id})`; }
    else if (!platform.managed && !manualEverywhere(c)) { action = 'UNSUPPORTED_PLATFORM'; reason = `plataforma ${platform.id} = ${platform.support}`; }
    else if (!platform.managed) { action = 'MANUAL'; reason = 'só detecção/instrução (o BOLD não instala este componente)'; }
    else if (it.policy === 'MANAGED' || (it.policy === 'LICENSE_GATED' && consents[it.id])) {
      const a = artifactFor(lock, it.id, platform.id, { allowLoopback });
      if (a.state === 'PINNED' && a.kind === 'npm') { action = 'INSTALL'; reason = `lockfile npm fixado (${a.version}; ${a.npm.packages ?? '?'} pacotes)${consents[it.id] ? ` · licença aceita (${consents[it.id].basis})` : ''}`; artifact = { version: a.version, kind: 'npm', size: a.npm.tarball_bytes_estimate ?? 0, license: a.license, provider: a.entry.provider ?? null, support: a.entry.support ?? null, npm: { packages: a.npm.packages, lockfile_sha256: a.npm.lockfile_sha256, registry: a.npm.registry } }; }
      else if (a.state === 'PINNED') { action = 'INSTALL'; reason = `artefato fixado no lock (${a.version})${a.parts.length > 1 ? ` · ${a.parts.length} artefatos` : ''}`; artifact = { version: a.version, size: a.parts.reduce((n, p) => n + p.size, 0), license: a.license, provider: a.entry.provider ?? null, support: a.entry.support ?? null, composite: a.composite, parts: a.parts.map((p) => ({ id: p.id, url: p.url, sha256: p.sha256, size: p.size })) }; }
      else if (a.state === 'NOT_PROVIDED') { action = 'MANUAL'; reason = a.entry?.notes || 'sem artefato gerenciado nesta plataforma'; }
      else { action = 'INSTALL_PENDING_LOCK'; reason = `${a.reason ?? 'lock sem artefato fixado'} (${lock?.data?.lock_status ?? 'lock ausente'})`; artifact = a.entry ? { version: a.version, provider: a.entry.provider ?? null, support: a.entry.support ?? null } : null; }
    } else if (it.policy === 'LICENSE_GATED') { action = 'LICENSE_REQUIRED'; reason = c.notes[0]; }
    else if (it.policy === 'PLANNED') { action = 'PLANNED'; reason = `instalação gerenciada prevista para a Fase ${it.phase}`; }
    else { action = 'MANUAL'; reason = it.policy === 'NEVER' ? 'o BOLD nunca instala este componente' : 'só detecção nesta plataforma'; }
    actions.push({ ...base, action, reason, ...(artifact ? { artifact } : {}), ...(action === 'USE_EXISTING' || action === 'SKIPPED_OPTIONAL' ? {} : { hint: action === 'INSTALL' ? `bold setup apply --components ${it.id} (com confirmação) — ou: ${HINTS[it.id]}` : action === 'STORAGE_OFFLINE' ? HINTS['audio-storage'] : HINTS[it.id] }) });
  }
  const essentialsMissing = actions.filter((a) => a.tier === 'ESSENTIAL' && a.action !== 'USE_EXISTING');
  const integrationGaps = actions.filter((a) => a.tier === 'INTEGRATION' && a.action !== 'USE_EXISTING');
  const readiness = !platform.managed && platform.support !== 'DEVELOPMENT_ONLY' ? 'UNSUPPORTED' : essentialsMissing.length ? 'NEEDS_SETUP' : 'READY';
  const count = (k) => actions.filter((a) => a.action === k).length;
  const downloads = actions.filter((a) => a.action === 'INSTALL');
  return {
    schema: 'bold.setup-plan/1',
    read_only: true,
    network: false,
    executed: [],
    platform,
    lock_status: lock?.data?.lock_status ?? null,
    readiness,
    essentials_missing: essentialsMissing.map((a) => a.id),
    integration_gaps: integrationGaps.map((a) => a.id),
    summary: Object.fromEntries(['USE_EXISTING', 'INSTALL', 'INSTALL_PENDING_LOCK', 'PLANNED', 'MANUAL', 'LICENSE_REQUIRED', 'SKIPPED_OPTIONAL', 'UNSUPPORTED_PLATFORM'].map((k) => [k, count(k)])),
    download_bytes: downloads.reduce((s, a) => s + (a.artifact?.size || 0), 0),
    actions,
    notes: ['Plano somente leitura: nada foi instalado, baixado ou alterado.', 'Para instalar: `bold setup apply --components <ids>` — só o que você listar, só artefatos fixados no lock, sempre com confirmação.'],
  };
}
