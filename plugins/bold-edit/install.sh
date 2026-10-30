#!/bin/sh
# BOLD EDIT SYSTEM — installer (macOS = SUPPORTED · Linux = DEVELOPMENT_ONLY). Ver INSTALL.md.
# Não instala Node/ffmpeg/Homebrew, não usa sudo, não altera arquivos de shell. Uso: ./install.sh [install|uninstall|update|status] [opções]
# Node: a MESMA resolução do bin/bold — BOLD_NODE_PATH > toolchain gerenciado (<toolchain>/node.path, instalado pelo
# bootstrap/bootstrap.sh) > `node` do PATH. Assim o fluxo "sem Node → bootstrap → ./install.sh" funciona sem editar o PATH.
d=$(cd -P "$(dirname "$0")" && pwd)
n="${BOLD_NODE_PATH:-}"
if [ -z "$n" ]; then
  if [ -n "${BOLD_TOOLCHAIN_DIR:-}" ]; then t="$BOLD_TOOLCHAIN_DIR"
  elif [ "$(uname -s)" = "Darwin" ]; then t="$HOME/Library/Application Support/bold/toolchain"
  else t="${XDG_DATA_HOME:-$HOME/.local/share}/bold/toolchain"; fi
  if [ -r "$t/node.path" ]; then IFS= read -r n < "$t/node.path" || true; [ -x "$n" ] || n=""; fi
fi
[ -n "$n" ] || n=node
command -v "$n" >/dev/null 2>&1 || { echo "install: Node.js >= 20 é pré-requisito (o installer não instala o Node; sem Node, rode bootstrap/bootstrap.sh)" >&2; exit 5; }
exec "$n" "$d/install/installer.mjs" "$@"
