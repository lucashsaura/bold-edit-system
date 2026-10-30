// Caminhos da INSTALAÇÃO (R10) — puros e parametrizados (platform/env/home), para testar macOS e Windows em qualquer máquina.
// Fontes oficiais (code.claude.com/docs): Skill pessoal = ~/.claude/skills/<nome>/SKILL.md; no Windows "~/.claude"
// significa %USERPROFILE%\.claude; CLAUDE_CONFIG_DIR realoca os arquivos de home do Claude Code.
import path from 'node:path';
import { userConfigPath } from '../core/config/paths.mjs';

export const SKILL_NAME = 'bold-edit';        // nome da Skill pessoal/projeto (= nome do diretório instalado → /bold-edit)
export const SKILL_SOURCE = 'skills/edit';    // dentro do pacote; no plugin "bold-edit" vira /bold-edit:edit
export const MARKER = 'bold-installer-managed v1';
export const RECEIPT = 'install-receipt.json';
export const COPY_MARKER = '.bold-installed.json';

const api = (platform) => (platform === 'win32' ? path.win32 : path.posix);

export function claudeDir({ platform, env = {}, home }) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  return api(platform).join(platform === 'win32' ? (env.USERPROFILE || home) : home, '.claude');
}
export const personalSkillDir = (o) => api(o.platform).join(claudeDir(o), 'skills', SKILL_NAME);
export const projectSkillDir = (projectDir, platform) => api(platform).join(projectDir, '.claude', 'skills', SKILL_NAME);

/** Diretório da CLI sem sudo: ~/.local/bin (POSIX) · %LOCALAPPDATA%\bold\bin (Windows). BOLD_BIN_DIR sobrescreve. */
export function binDir({ platform, env = {}, home }) {
  if (env.BOLD_BIN_DIR) return env.BOLD_BIN_DIR;
  const p = api(platform);
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'bold', 'bin');
  return p.join(home, '.local', 'bin');
}
export const shimName = (platform) => (platform === 'win32' ? 'bold.cmd' : 'bold');

/** Estado do installer = diretório de config do BOLD (o mesmo do bold.config.json do usuário, que o installer nunca toca). */
export function stateDir({ platform, env = {}, home }) {
  const cfgEnv = { ...env }; delete cfgEnv.BOLD_USER_CONFIG;
  return api(platform).dirname(userConfigPath({ platform, env: cfgEnv, home }));
}
export const receiptPath = (o) => api(o.platform).join(stateDir(o), RECEIPT);

/** Conteúdo do shim instalado (BOLD_HOME absoluto da MÁQUINA DO USUÁRIO — gerado na instalação, nunca versionado). */
export function shimContent(platform, boldHome) {
  // R12: mesma ordem dos shims do pacote — BOLD_NODE_PATH > toolchain gerenciado (node.path) > node do PATH.
  if (platform === 'win32') return [
    '@echo off', `rem ${MARKER}`, `rem BOLD_HOME=${boldHome}`, 'setlocal',
    'if defined BOLD_NODE_PATH (set "BOLD_N=%BOLD_NODE_PATH%" & goto run)',
    'if defined BOLD_TOOLCHAIN_DIR (set "BOLD_T=%BOLD_TOOLCHAIN_DIR%") else (set "BOLD_T=%LOCALAPPDATA%\\bold\\toolchain")',
    'set "BOLD_N="', 'if exist "%BOLD_T%\\node.path" set /p BOLD_N=<"%BOLD_T%\\node.path"',
    'if defined BOLD_N if not exist "%BOLD_N%" set "BOLD_N="', 'if not defined BOLD_N set "BOLD_N=node"', ':run',
    `"%BOLD_N%" "${api(platform).join(boldHome, 'bin', 'bold.mjs')}" %*`, 'exit /b %ERRORLEVEL%', ''].join('\r\n');
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\n# ${MARKER}\n# BOLD_HOME=${boldHome}\nn="\${BOLD_NODE_PATH:-}"\nif [ -z "$n" ]; then\n  if [ -n "\${BOLD_TOOLCHAIN_DIR:-}" ]; then t="$BOLD_TOOLCHAIN_DIR"\n  elif [ "$(uname -s)" = "Darwin" ]; then t="$HOME/Library/Application Support/bold/toolchain"\n  else t="\${XDG_DATA_HOME:-$HOME/.local/share}/bold/toolchain"; fi\n  if [ -r "$t/node.path" ]; then IFS= read -r n < "$t/node.path" || true; [ -x "$n" ] || n=""; fi\nfi\n[ -n "$n" ] || n=node\ncommand -v "$n" >/dev/null 2>&1 || { echo "bold: Node.js >= 20 não encontrado (instale o Node ou defina BOLD_NODE_PATH)" >&2; exit 5; }\nexec "$n" ${q(path.posix.join(boldHome, 'bin', 'bold.mjs'))} "$@"\n`;
}

/** Windows: symlink exige Developer Mode/privilégio → padrão = cópia gerenciada. macOS/Linux: symlink (oficialmente suportado). */
export const defaultSkillLink = (platform) => (platform === 'win32' ? 'copy' : 'symlink');
