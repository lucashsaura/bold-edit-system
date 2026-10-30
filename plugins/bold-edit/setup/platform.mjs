// Detecção de SO/arquitetura do BOLD Setup Manager (R12). Pura: recebe fatos, devolve a plataforma-alvo.
// Alvos: darwin-arm64 (SUPPORTED) · darwin-x64 (EXPERIMENTAL) · win32-x64 (EXPERIMENTAL).
// win32-arm64 = UNSUPPORTED (sem instalar x64 emulado automaticamente) · linux = DEVELOPMENT_ONLY (só detecção).

export const TARGETS = Object.freeze({
  'darwin-arm64': 'SUPPORTED',
  'darwin-x64': 'EXPERIMENTAL',
  'win32-x64': 'EXPERIMENTAL',
});

/**
 * @param {{platform:string, arch:string, translated?:boolean, hostArch?:string|null}} f
 *   translated: processo x64 sob Rosetta 2 (macOS) · hostArch: arquitetura real da máquina, se conhecida (Windows ARM64 emulando x64).
 * @returns {{id:string, os:string, arch:string, process_arch:string, support:string, managed:boolean, notes:string[]}}
 */
export function detectPlatform({ platform, arch, translated = false, hostArch = null }) {
  const notes = [];
  let a = arch;
  if (platform === 'darwin' && arch === 'x64' && translated) {
    a = 'arm64';
    notes.push('processo x64 sob Rosetta 2: a máquina é Apple Silicon → alvo darwin-arm64');
  }
  if (platform === 'win32' && hostArch === 'arm64') {
    a = 'arm64';
    if (arch !== 'arm64') notes.push(`processo ${arch} emulado em Windows ARM64`);
  }
  const id = `${platform}-${a}`;
  let support = TARGETS[id];
  if (!support) {
    if (platform === 'linux') { support = 'DEVELOPMENT_ONLY'; notes.push('Linux: só detecção; o setup não gerencia ferramentas'); }
    else { support = 'UNSUPPORTED'; notes.push(id === 'win32-arm64' ? 'Windows ARM64 não é alvo do setup (sem binários x64 emulados automáticos)' : `plataforma ${id} sem suporte`); }
  }
  return { id, os: platform, arch: a, process_arch: arch, support, managed: support === 'SUPPORTED' || support === 'EXPERIMENTAL', notes };
}

/** Coleta os fatos com um probe (somente leitura): sysctl no macOS x64; variáveis de ambiente no Windows. */
export function probePlatform(probe) {
  let translated = false;
  let hostArch = null;
  if (probe.platform === 'darwin' && probe.arch === 'x64') {
    const r = probe.run('sysctl', ['-n', 'sysctl.proc_translated']);
    translated = r.ok && r.stdout.trim() === '1';
  }
  if (probe.platform === 'win32') {
    const e = probe.env || {};
    const id = String(e.PROCESSOR_IDENTIFIER || '');
    if (String(e.PROCESSOR_ARCHITEW6432 || '').toUpperCase() === 'ARM64' || String(e.PROCESSOR_ARCHITECTURE || '').toUpperCase() === 'ARM64' || /\bARMv?8|ARM64\b/i.test(id)) hostArch = 'arm64';
  }
  return detectPlatform({ platform: probe.platform, arch: probe.arch, translated, hostArch });
}
