// Catálogo de dependências do BOLD Setup Manager (R12): nível, licença e POLÍTICA por plataforma.
// Política (o que o setup pode fazer):
//   MANAGED        instalação gerenciada a partir do toolchain.lock (download só com confirmação; Fase 2/3)
//   PLANNED        instalação gerenciada prevista para uma fase futura (hoje: detecção + instrução)
//   DETECT_ONLY    só detecção e instrução manual
//   LICENSE_GATED  exige aceite explícito de licença antes de qualquer instalação
//   NEVER          o BOLD nunca instala nem modifica (ex.: DaVinci Resolve)

export const TIERS = Object.freeze(['ESSENTIAL', 'INTEGRATION', 'OPTIONAL']);
export const POLICIES = Object.freeze(['MANAGED', 'PLANNED', 'DETECT_ONLY', 'LICENSE_GATED', 'NEVER']);

const all = (policy, phase = null) => ({ 'darwin-arm64': { policy, phase }, 'darwin-x64': { policy, phase }, 'win32-x64': { policy, phase } });

export const COMPONENTS = Object.freeze([
  {
    id: 'node', name: 'Node.js', tier: 'ESSENTIAL', license: 'MIT',
    purpose: 'runtime da CLI bold; HyperFrames exige ≥ 22',
    requirement: { min: '20.0.0', recommended: '22.0.0', target: '24 LTS' },
    platforms: all('MANAGED', 3),
    notes: ['fonte oficial nodejs.org/dist (SHASUMS256.txt assinado); sem PATH global'],
  },
  {
    id: 'ffmpeg', name: 'FFmpeg + ffprobe', tier: 'ESSENTIAL', license: 'LGPL/GPL conforme o build',
    purpose: 'encode, QC, probe, delivery; ProRes 4444 alpha exige o encoder prores_ks',
    requirement: { encoders: ['prores_ks'], bins: ['ffmpeg', 'ffprobe'] },
    platforms: {
      'darwin-arm64': { policy: 'MANAGED', phase: 3, provider: 'Martin Riedl (zips assinados; ffmpeg + ffprobe = componente composto)' },
      'darwin-x64': { policy: 'DETECT_ONLY', phase: null, provider: 'só detecção nesta versão (decisão R12.3)' },
      'win32-x64': { policy: 'MANAGED', phase: 3, provider: 'BtbN LGPL (build mensal retida, tag datada)' },
    },
    notes: ['o BOLD nunca redistribui: download direto do upstream na máquina do usuário', 'macOS arm64 (Riedl) é GPLv3 (x264/x265): não espelhar/cachear binários', 'componente composto: ffmpeg e ffprobe são verificados individualmente'],
  },
  {
    id: 'python', name: 'Python ≥ 3.10 (DaVinci Bridge)', tier: 'INTEGRATION', license: 'PSF',
    purpose: 'DaVinci Bridge; Pillow (texturas/placeholders)',
    requirement: { min: '3.10.0' },
    platforms: all('DETECT_ONLY'),
    notes: ['ResolvePython 3.14 (Resolve 21.1+) é DETECTADO, mas a Bridge só passa a usá-lo depois de validado (decisão da R12)', 'Python gerenciado (python-build-standalone) previsto como opcional numa fase futura'],
  },
  {
    id: 'davinci-resolve', name: 'DaVinci Resolve + Scripting API', tier: 'INTEGRATION', license: 'proprietária (Blackmagic Design)',
    purpose: 'edição assistida (Bridge); scripting externo exige, na prática, a edição Studio',
    requirement: { files: ['DaVinciResolveScript.py', 'fusionscript'] },
    platforms: all('NEVER'),
    notes: ['o BOLD nunca instala, abre, conecta (no setup) ou altera o Resolve e suas preferências'],
  },
  {
    id: 'pillow', name: 'Python auxiliar gerenciado + Pillow', tier: 'OPTIONAL', license: 'Python: PSF-2.0 (python-build-standalone: MPL-2.0) · Pillow: MIT-CMU',
    purpose: 'texturas e placeholders; Python ISOLADO do BOLD (tools.PYTHON_AUX_PATH) — nunca o Python do sistema, o da Bridge ou o ResolvePython',
    requirement: { python_module: 'PIL' },
    platforms: all('MANAGED', 4),
    notes: ['composto: python-build-standalone (install_only) + wheel do Pillow; pip OFFLINE com --require-hashes no staging', 'a DaVinci Bridge continua no Python do sistema (tools.PYTHON_PATH)'],
  },
  {
    id: 'hyperframes', name: 'HyperFrames CLI', tier: 'OPTIONAL', license: 'Apache-2.0 (dependências: ver lockfile)',
    purpose: 'backend de motion HTML/CSS', requirement: { node: '22.0.0', pin_config: 'tools.HYPERFRAMES_VERSION' },
    platforms: all('MANAGED', 4),
    notes: ['npm ci com lockfile FIXADO (integrity sha512), sem scripts, cache/config isolados', 'integração SEM tocar no HyperFrames Core: BOLD_HYPERFRAMES_NODE_MODULES (o Core apaga HYPERFRAMES_BROWSER_PATH de propósito)'],
  },
  {
    id: 'chrome-headless-shell', name: 'Chrome headless shell', tier: 'OPTIONAL', license: 'termos do Google (Chrome for Testing)',
    purpose: 'captura de frames (HyperFrames/Remotion)', requirement: {},
    platforms: all('DETECT_ONLY'),
    notes: ['download ADIADO (R12.4): o Chrome for Testing não publica sha256', 'configure um existente em tools.CHROME_HEADLESS_PATH → exportado como BOLD_HYPERFRAMES_CHROME'],
  },
  {
    id: 'remotion', name: 'Remotion (projeto gerenciado)', tier: 'OPTIONAL', license: 'Remotion License (Company License para 4+ pessoas)',
    purpose: 'backend de motion programático', requirement: { pin_config: 'tools.REMOTION_VERSION' },
    platforms: all('LICENSE_GATED', 4),
    notes: ['exige `bold setup consent --component remotion --basis …` (a licença da Bold não cobre terceiros)', 'npm ci com lockfile fixado; o chrome-headless-shell do Remotion NÃO é baixado (adiado)'],
  },
  {
    id: 'whisper-cli', name: 'whisper.cpp (whisper-cli)', tier: 'OPTIONAL', license: 'MIT',
    purpose: 'STT opcional (a V1 normaliza a saída -ojf; não executa STT)', requirement: {},
    platforms: {
      'darwin-arm64': { policy: 'DETECT_ONLY', phase: null },
      'darwin-x64': { policy: 'DETECT_ONLY', phase: null },
      'win32-x64': { policy: 'MANAGED', phase: 4, provider: 'binário oficial do GitHub (digest sha256) — EXPERIMENTAL' },
    },
    notes: ['macOS: não há binário oficial de CLI → só detecção'],
  },
  {
    id: 'sfx-kit', name: 'SFX Kit (biblioteca de efeitos)', tier: 'OPTIONAL', license: 'CC0-1.0',
    purpose: 'efeitos sonoros locais do sound design da Skill (320 WAV 48 kHz/24 bit com metadados de sincronia e loudness)',
    requirement: { lock: 'audio/sfx-kit.lock.json' },
    platforms: all('DETECT_ONLY'),
    notes: ['instalação guiada: `bold audio library install --yes` (zip da release v1.0.0, sha256 e tamanho fixados; ~55 MB de download, ~69 MB em disco)', 'fica em <dados do BOLD>/libraries, fora do plugin e do toolchain; não é redistribuído no pacote'],
  },
  {
    id: 'earshot', name: 'Earshot (análise e geração de áudio)', tier: 'OPTIONAL', license: 'MIT · modelos: CLAP (LAION) Apache-2.0, AST (MIT) BSD-3-Clause · PyTorch BSD-3-Clause',
    purpose: 'opcional: descrever/comparar/medir sons e gerar efeitos procedurais; o BOLD funciona sem ele',
    requirement: { python: '3.10.0', lock: 'audio/earshot-0.4.0.lock.txt' },
    platforms: all('DETECT_ONLY'),
    notes: ['instalação guiada: `bold audio setup earshot` (venv isolado, dependências com --require-hashes; ~1,1 GB de venv + ~1,1 GB de modelos, cada etapa com aprovação)', 'uso sempre offline e sem chaves; `earshot llm` (envia áudio ao Google) nunca é usado'],
  },
  ...['base', 'small', 'medium'].map((m) => ({
    id: `whisper-model-${m}`, name: `Modelo Whisper ${m}${m === 'medium' ? ' (avançado)' : ''}`, tier: 'OPTIONAL', license: 'MIT',
    purpose: `modelo ggml-${m}.bin do whisper.cpp${m === 'medium' ? ' — mais lento e bem maior; opção avançada' : ''}`, requirement: { config: 'tools.WHISPER_MODEL' },
    platforms: all('MANAGED', 4), advanced: m === 'medium',
    notes: ['Hugging Face ggerganov/whisper.cpp, fixado por COMMIT; sha256 = lfs.oid', 'o modelo ativado por último vira tools.WHISPER_MODEL (se o usuário não definiu outro)'],
  })),
]);

export const componentById = (id) => COMPONENTS.find((c) => c.id === id) || null;

/** Política do componente na plataforma; plataforma não gerenciada → NOT_MANAGED_PLATFORM. */
export function policyFor(component, platformId) {
  return component.platforms[platformId] || { policy: 'NOT_MANAGED_PLATFORM', phase: null };
}
