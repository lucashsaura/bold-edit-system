#!/bin/sh
# BOLD EDIT SYSTEM — bootstrap macOS (R12.2). Funciona SEM Node.
# 1) detecta SO/arquitetura (inclusive Rosetta 2); 2) procura um Node utilizável (BOLD_NODE_PATH > toolchain > PATH)
#    e, se houver, entrega para `bold setup` (plano somente leitura);
# 3) sem Node: se o lock fixou o Node desta plataforma (constantes BOLD-LOCK abaixo), mostra o plano e PEDE CONFIRMAÇÃO
#    (terminal ou --yes) → checa espaço → baixa SÓ por HTTPS do host permitido → confere tamanho + sha256 → valida a
#    lista do tar (sem caminhos absolutos/..) → extrai num staging do BOLD → entrega para `bold setup apply --archive`,
#    que re-confere o lock, extrai com o extrator seguro do BOLD e ativa → remove os temporários que ELE criou.
#    R12.5B (macOS): o Node extraído — e o Node do toolchain apontado por node.path — só é EXECUTADO depois de
#    /usr/bin/codesign confirmar assinatura válida, Developer ID e o Team ID fixado no lock (sem opção para pular).
#    Sem constantes fixadas para a plataforma (ex.: Linux) → só mostra o plano e sai com 5.
# Nunca: sudo, PATH global, arquivos de shell, `curl | sh`, download sem confirmação.
# Uso: sh bootstrap/bootstrap.sh [--yes] [argumentos repassados ao `bold setup`]
# BOLD_SETUP_OFFLINE=1 (a suíte liga): recusa qualquer download que não seja o servidor local de teste.
# Variáveis SÓ DE TESTE: BOLD_BOOTSTRAP_UNAME_S, BOLD_BOOTSTRAP_UNAME_M, BOLD_BOOTSTRAP_TRANSLATED, BOLD_BOOTSTRAP_NO_TTY — só
#   escolhem entre as entradas OFICIAIS do lock ou desligam a pergunta; nunca trocam URL, sha256, tamanho ou identidade.
# R12.5 B3: artefato/identidade de teste NUNCA vêm do ambiente — só do bloco BOLD-TEST abaixo, VAZIO na distribuição
#   (o `bold dist audit` reprova se preenchido) e preenchido apenas em CÓPIAS deste script geradas pela suíte.
set -u
NODE_TARGET="24"   # alvo LTS — deve bater com setup/toolchain.lock.json (testado)
NODE_MIN_MAJOR=20
NODE_HOSTS="nodejs.org"
# >>> BOLD-LOCK (gerado de setup/toolchain.lock.json — node setup/bootstrap-lock.mjs --write)
NODE_VERSION="24.22.0"
NODE_DARWIN_ARM64_URL="https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz"
NODE_DARWIN_ARM64_SHA256="6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5"
NODE_DARWIN_ARM64_SIZE="53049576"
NODE_DARWIN_ARM64_BIN="bin/node"
NODE_DARWIN_ARM64_TEAM="HX7739G8FX"
NODE_DARWIN_ARM64_IDENT="node"
NODE_DARWIN_X64_URL=""
NODE_DARWIN_X64_SHA256=""
NODE_DARWIN_X64_SIZE=""
NODE_DARWIN_X64_BIN=""
NODE_DARWIN_X64_TEAM=""
NODE_DARWIN_X64_IDENT=""
# <<< BOLD-LOCK
# >>> BOLD-TEST (VAZIO na distribuição; só cópias geradas pela suíte o preenchem — nunca lido do ambiente)
TEST_URL=""
TEST_SHA256=""
TEST_SIZE=""
TEST_BIN=""
TEST_TEAM=""
# <<< BOLD-TEST

here=$(cd -P "$(dirname "$0")" && pwd)
bold_home=$(cd -P "$here/.." && pwd)

yes=0
for a do shift; if [ "$a" = "--yes" ]; then yes=1; else set -- "$@" "$a"; fi; done

os_name="${BOLD_BOOTSTRAP_UNAME_S:-$(uname -s)}"
arch="${BOLD_BOOTSTRAP_UNAME_M:-$(uname -m)}"
translated="${BOLD_BOOTSTRAP_TRANSLATED:-}"
if [ -z "$translated" ] && [ "$os_name" = "Darwin" ]; then translated=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0); fi

case "$os_name" in
  Darwin)
    case "$arch" in
      arm64) platform="darwin-arm64"; support="SUPPORTED" ;;
      x86_64)
        if [ "$translated" = "1" ]; then platform="darwin-arm64"; support="SUPPORTED"; echo "bootstrap: shell x86_64 sob Rosetta 2 → máquina Apple Silicon (darwin-arm64)"
        else platform="darwin-x64"; support="EXPERIMENTAL"; fi ;;
      *) platform="darwin-$arch"; support="UNSUPPORTED" ;;
    esac
    toolchain="${BOLD_TOOLCHAIN_DIR:-$HOME/Library/Application Support/bold/toolchain}" ;;
  Linux)
    platform="linux-$arch"; support="DEVELOPMENT_ONLY"
    toolchain="${BOLD_TOOLCHAIN_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/bold/toolchain}" ;;
  *)
    echo "bootstrap: SO $os_name sem suporte neste script (Windows: use bootstrap/bootstrap.ps1)" >&2; exit 64 ;;
esac
echo "bootstrap: plataforma $platform ($support) · BOLD_HOME $bold_home"
[ "$support" = "UNSUPPORTED" ] && { echo "bootstrap: arquitetura $arch sem suporte — nada a fazer" >&2; exit 5; }

# Assinatura de código (macOS): válida (--strict) + Team ID + requisito Developer ID ancorado na Apple + identifier +
# hardened runtime. Só /usr/bin/codesign (caminho absoluto). Uso: verify_sig <arquivo> <team> [identifier]; motivo em $sig_why.
verify_sig() {
  sig_why=""; cs=/usr/bin/codesign
  case "$2" in ""|*[!A-Z0-9]*) sig_why="Team ID esperado inválido"; return 1 ;; esac
  [ ${#2} -eq 10 ] || { sig_why="Team ID esperado inválido"; return 1; }
  [ -x "$cs" ] || { sig_why="$cs ausente"; return 1; }
  "$cs" --verify --strict "$1" >/dev/null 2>&1 || { sig_why="assinatura inválida, ausente ou adulterada"; return 1; }
  info=$("$cs" -dv --verbose=4 "$1" 2>&1) || true
  printf '%s\n' "$info" | grep -qx "TeamIdentifier=$2" || { sig_why="Team ID diferente de $2"; return 1; }
  if [ -n "${3:-}" ]; then printf '%s\n' "$info" | grep -qx "Identifier=$3" || { sig_why="identifier diferente de $3"; return 1; }; fi
  printf '%s\n' "$info" | grep -Eq '^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*runtime' || { sig_why="hardened runtime ausente"; return 1; }
  "$cs" --verify --strict --test-requirement="=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$2\"" "$1" >/dev/null 2>&1 || { sig_why="requisito Developer ID/Team ID $2 não satisfeito"; return 1; }
  return 0
}

lock_team=""; lock_ident=""
case "$platform" in
  darwin-arm64) lock_team="$NODE_DARWIN_ARM64_TEAM"; lock_ident="$NODE_DARWIN_ARM64_IDENT" ;;
  darwin-x64) lock_team="$NODE_DARWIN_X64_TEAM"; lock_ident="$NODE_DARWIN_X64_IDENT" ;;
esac
# cópia de TESTE (bloco BOLD-TEST preenchido, só URL loopback): a identidade esperada vem do bloco, nunca do ambiente
if [ -n "$TEST_URL" ]; then case "$TEST_URL" in http://127.0.0.1:*/*) lock_team="$TEST_TEAM"; lock_ident="" ;; esac; fi

find_node() {
  node_bin=""; src=""
  if [ -n "${BOLD_NODE_PATH:-}" ]; then node_bin="$BOLD_NODE_PATH"; src="BOLD_NODE_PATH"
  elif [ -r "$toolchain/node.path" ]; then IFS= read -r node_bin < "$toolchain/node.path" || true; src="toolchain"; [ -x "$node_bin" ] || node_bin=""
    # R12.5B: Node GERENCIADO no macOS só é executado se a assinatura conferir com o lock; senão é ignorado (vale o PATH)
    if [ -n "$node_bin" ] && [ "$os_name" = "Darwin" ] && [ -n "$lock_team" ] && ! verify_sig "$node_bin" "$lock_team" "$lock_ident"; then
      echo "bootstrap: Node do toolchain ignorado — $sig_why" >&2; node_bin=""; src=""
    fi
  fi
  if [ -z "$node_bin" ] && command -v node >/dev/null 2>&1; then node_bin=$(command -v node); src="PATH"; fi
  major=""
  if [ -n "$node_bin" ] && command -v "$node_bin" >/dev/null 2>&1; then major=$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo ""); fi
  case "$major" in ''|*[!0-9]*) major="" ;; esac
}

find_node
if [ -n "$major" ] && [ "$major" -ge "$NODE_MIN_MAJOR" ]; then
  echo "bootstrap: Node $major encontrado ($src: $node_bin) → bold setup"
  exec "$node_bin" "$bold_home/bin/bold.mjs" setup "$@"
fi
[ -n "$major" ] && echo "bootstrap: Node $major em $node_bin é antigo (mínimo $NODE_MIN_MAJOR; recomendado ≥ 22)"

# ── artefato fixado no lock para esta plataforma ──
url=""; sha=""; size=""; bin=""; team="$lock_team"; ident="$lock_ident"; proto="=https"; mode="lock"
case "$platform" in
  darwin-arm64) url="$NODE_DARWIN_ARM64_URL"; sha="$NODE_DARWIN_ARM64_SHA256"; size="$NODE_DARWIN_ARM64_SIZE"; bin="$NODE_DARWIN_ARM64_BIN" ;;
  darwin-x64) url="$NODE_DARWIN_X64_URL"; sha="$NODE_DARWIN_X64_SHA256"; size="$NODE_DARWIN_X64_SIZE"; bin="$NODE_DARWIN_X64_BIN" ;;
esac
if [ -n "$TEST_URL" ]; then
  case "$TEST_URL" in
    http://127.0.0.1:*/*) url="$TEST_URL"; sha="$TEST_SHA256"; size="$TEST_SIZE"; bin="${TEST_BIN:-bin/node}"; team="$TEST_TEAM"; ident=""; proto="=http"; mode="teste-loopback" ;;
    *) echo "bootstrap: URL de teste só é aceita em http://127.0.0.1" >&2; exit 64 ;;
  esac
fi

if [ -z "$url" ]; then
  cat <<PLAN
bootstrap: Node.js utilizável NÃO encontrado. Plano (nada foi baixado nem instalado):
  componente  Node.js $NODE_TARGET LTS (ESSENCIAL) · licença MIT
  fonte       oficial: https://nodejs.org/dist/ (SHASUMS256.txt assinado por GPG)
  destino     $toolchain/node/<versão>-$platform/  (local do BOLD; sem admin; sem PATH global)
  integridade sha256 fixado em setup/toolchain.lock.json — conferido ANTES de extrair
  estado      o lock não fixou um artefato do Node para esta plataforma
Agora: instale o Node.js LTS manualmente (https://nodejs.org) ou defina BOLD_NODE_PATH, e rode este script de novo.
PLAN
  exit 5
fi

fail() { echo "bootstrap: $1" >&2; exit "${2:-1}"; }
case "$sha" in *[!0-9a-f]*|'') fail "sha256 do lock inválido" 64 ;; esac
[ ${#sha} -eq 64 ] || fail "sha256 do lock inválido" 64
case "$size" in ''|*[!0-9]*) fail "tamanho do lock inválido" 64 ;; esac
case "$bin" in ''|/*|*..*) fail "bin do lock inválido" 64 ;; esac
if [ "$mode" = "lock" ]; then
  case "$url" in https://*) ;; *) fail "o lock só pode usar HTTPS" 64 ;; esac
  host=${url#https://}; host=${host%%/*}
  ok_host=0; for h in $NODE_HOSTS; do [ "$host" = "$h" ] && ok_host=1; done
  [ "$ok_host" = 1 ] || fail "host $host fora da allowlist ($NODE_HOSTS)" 64
  # R12.5B: no macOS o lock sempre traz a identidade de assinatura do Node (sem ela, nada é baixado)
  [ "$os_name" != "Darwin" ] || [ -n "$team" ] || fail "o lock não fixou a identidade de assinatura do Node para $platform — nada foi baixado" 64
fi

cat <<PLAN
bootstrap: Node.js utilizável NÃO encontrado. Plano:
  componente  Node.js $NODE_VERSION (ESSENCIAL) · licença MIT · modo $mode
  fonte       $url
  tamanho     $size bytes · sha256 $sha
  destino     $toolchain/node/$NODE_VERSION-$platform/  (local do BOLD; sem admin; sem PATH global)
PLAN
[ -n "$team" ] && echo "  assinatura  Developer ID · Team ID $team — verificada ANTES de executar o Node extraído"
if [ "${BOLD_SETUP_OFFLINE:-}" = "1" ] && [ "$mode" != "teste-loopback" ]; then
  echo "bootstrap: modo offline (BOLD_SETUP_OFFLINE=1) — download externo recusado; nada foi baixado" >&2; exit 3
fi
if [ "$yes" != 1 ]; then
  if [ "${BOLD_BOOTSTRAP_NO_TTY:-}" != "1" ] && (: < /dev/tty) 2>/dev/null; then
    printf 'Confirmar download e instalação do Node? [s/N] ' > /dev/tty
    IFS= read -r ans < /dev/tty || ans=""
    case "$ans" in s|S|sim|Sim|y|Y|yes) ;; *) echo "bootstrap: cancelado — nada foi baixado"; exit 3 ;; esac
  else
    echo "bootstrap: confirmação necessária (rode num terminal ou use --yes) — nada foi baixado" >&2; exit 3
  fi
fi

# espaço: arquivo + conteúdo estimado (5×) + margem de 256 MiB
d="$toolchain"; while [ ! -d "$d" ]; do d=$(dirname "$d"); done
avail_kb=$(df -Pk "$d" | awk 'NR==2 {print $4}')
need_kb=$(( size * 5 / 1024 + 262144 ))
[ "${avail_kb:-0}" -ge "$need_kb" ] || fail "espaço insuficiente: ${avail_kb} KiB livres, ${need_kb} KiB necessários" 3

mkdir -p "$toolchain/.downloads" "$toolchain/.staging" || fail "não foi possível criar $toolchain" 1
file="$toolchain/.downloads/node-$NODE_VERSION-$platform.tar.gz"; part="$file.part"; x="$toolchain/.staging/bootstrap-$$"
cleanup() { rm -rf "$x"; rm -f "$part" "$file"; rmdir "$toolchain/.downloads" "$toolchain/.staging" 2>/dev/null; true; }
trap 'cleanup; exit 130' INT TERM HUP
rm -f "$part"
code=$(curl -q --proto "$proto" --tlsv1.2 -fsS --max-filesize "$size" --max-time 900 --connect-timeout 30 -o "$part" -w '%{http_code}' "$url") || { cleanup; fail "download falhou" 1; }
[ "$code" = "200" ] || { cleanup; fail "HTTP $code (redirects não são seguidos)" 1; }
got_size=$(wc -c < "$part" | tr -d ' ')
[ "$got_size" = "$size" ] || { cleanup; fail "tamanho não confere ($got_size ≠ $size) — arquivo descartado" 1; }
got_sha=$(shasum -a 256 "$part" | cut -d' ' -f1)
[ "$got_sha" = "$sha" ] || { cleanup; fail "sha256 não confere — arquivo descartado" 1; }
mv "$part" "$file"
if tar -tzf "$file" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then cleanup; fail "arquivo com caminhos inseguros — recusado" 1; fi
mkdir "$x" && tar -xzf "$file" -C "$x" || { cleanup; fail "extração falhou" 1; }
tnode=""; for c in "$x"/*/$bin; do [ -x "$c" ] && { tnode="$c"; break; }; done
[ -n "$tnode" ] || { cleanup; fail "Node extraído não encontrado ($bin)" 1; }
if [ -n "$team" ]; then verify_sig "$tnode" "$team" "$ident" || { cleanup; fail "assinatura de código recusada — $sig_why; nada foi executado nem ativado" 1; }; fi
"$tnode" --version >/dev/null 2>&1 || { cleanup; fail "Node extraído não executa" 1; }
echo "bootstrap: artefato verificado → bold setup apply (re-confere o lock e ativa no toolchain)"
BOLD_TOOLCHAIN_DIR="$toolchain" "$tnode" "$bold_home/bin/bold.mjs" setup apply --components node --archive "$file" --yes
rc=$?
cleanup; trap - INT TERM HUP
[ "$rc" -eq 0 ] || fail "instalação gerenciada falhou (exit $rc)" "$rc"
find_node
[ "$src" = "toolchain" ] || [ -n "$major" ] || fail "Node gerenciado não encontrado depois da instalação" 1
echo "bootstrap: Node $major gerenciado ativo → bold setup"
exec "$node_bin" "$bold_home/bin/bold.mjs" setup "$@"
