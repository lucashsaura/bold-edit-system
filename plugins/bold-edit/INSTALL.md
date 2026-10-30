# Instalação — BOLD EDIT SYSTEM

| Plataforma | Status |
|---|---|
| macOS | **SUPPORTED** |
| Windows | **EXPERIMENTAL** |
| Linux | DEVELOPMENT_ONLY |

O installer é **local**, **idempotente** e **sem sudo**. Ele **não**:
- baixa nem instala nada (Node, Homebrew, ffmpeg, Python, Remotion, HyperFrames, modelos, fontes);
- altera arquivos de shell (`.zshrc`, PATH do sistema) nem configurações do sistema;
- toca no DaVinci Resolve;
- apaga arquivos ou sobrescreve uma Skill que não seja dele.

## 1. Requisitos

| Item | Obrigatório? | Para quê |
|---|---|---|
| **Node.js ≥ 20** | **sim** | CLI `bold` e installer |
| ffmpeg + ffprobe | opcional | probe, QC, delivery, metadados de vídeo/áudio (`bold assets`) |
| Python ≥ 3.10 | opcional | DaVinci Bridge |
| DaVinci Resolve Studio (scripting externo = Local) | opcional | `bold davinci` |
| Projeto Remotion / CLI HyperFrames | opcional (externos) | `bold render` |
| Claude Code | opcional | Skill `/bold-edit` ou plugin `/bold-edit:edit` |

Depois de instalar, confira tudo com `bold doctor` (somente leitura).

**Setup Manager (R12).** `bold setup` mostra, sem alterar nada:
- a plataforma;
- as ferramentas encontradas e de onde vêm;
- o que falta.

Sem Node, rode `sh bootstrap/bootstrap.sh` (macOS) ou `bootstrap\bootstrap.ps1` (Windows, EXPERIMENTAL). O bootstrap baixa só o Node 24.22.0 fixado no lock (sha256 e Developer ID verificados) e pede confirmação.

O `bold setup apply --components …` só instala os componentes pedidos, com confirmação, e só artefatos fixados e aprovados no lock. No macOS arm64:
- Node 24.22.0;
- FFmpeg 9.0.2;
- Python auxiliar 3.12.15 + Pillow 12.3.0;
- HyperFrames 0.8.114, que exige o Node gerenciado.

Ver `references/setup-manager.md`.

## 2. Instalar

### macOS (principal)
```bash
cd <onde-você-guardou>/bold-edit-system
./install.sh --dry-run
./install.sh
```
- `--dry-run` mostra o plano sem alterar nada.
- O install cria:
  - `~/.local/bin/bold`, um shim que chama `<checkout>/bin/bold.mjs`;
  - `~/.claude/skills/bold-edit`, um symlink para `<checkout>/skills/edit` (Skill pessoal `/bold-edit`, disponível em todos os projetos);
  - o cache (`~/Library/Caches/bold`);
  - o recibo em `~/Library/Application Support/bold/install-receipt.json`.
- Se `~/.local/bin` não estiver no PATH, o installer **avisa** e não edita seu shell. Adicione você mesmo, por exemplo `export PATH="$HOME/.local/bin:$PATH"` no `~/.zshrc`.
- Ao final, o installer roda `bold doctor`. Para pular: `--no-doctor`.

### Windows (EXPERIMENTAL)
```bat
install.cmd --dry-run
install.cmd
```
- A Skill é **copiada** (cópia gerenciada, com o marcador `.bold-installed.json`), porque symlink no Windows exige Developer Mode.
- Destinos:
  - Skill: `%USERPROFILE%\.claude\skills\bold-edit`;
  - CLI: `%LOCALAPPDATA%\bold\bin\bold.cmd` (adicione ao PATH);
  - estado: `%APPDATA%\bold`.
- Limitações: os testes de instalação ponta a ponta rodam em macOS/POSIX (os de caminho simulam o Windows). Os caminhos do DaVinci podem diferir: configure `BOLD_DAVINCI_SCRIPT_API` e `BOLD_DAVINCI_SCRIPT_LIB`. Remotion e HyperFrames não foram validados no Windows.

### Opções
| Opção | Efeito |
|---|---|
| `--mode personal` (padrão) | Skill pessoal em `~/.claude/skills/bold-edit` (ou `$CLAUDE_CONFIG_DIR/skills/…`) |
| `--mode project --project-dir D` | Skill de projeto em `D/.claude/skills/bold-edit` (acompanha aquele repositório) |
| `--mode none` | só a CLI |
| `--no-cli` | não cria o shim |
| `--bin-dir D` | outro diretório para o shim (ou `BOLD_BIN_DIR`) |
| `--copy` | cópia em vez de symlink (padrão no Windows) |
| `--replace-skill` | se já existe uma `bold-edit` que **não** é do installer, move-a para `bold-edit.backup-<data>` (nunca apaga) |
| `--home D` | HOME isolado (testes; ignora `CLAUDE_CONFIG_DIR`/`BOLD_*` do ambiente) |
| `--json` | relatório em JSON |

**Conflito:** sem `--replace-skill`, uma Skill `bold-edit` alheia interrompe a instalação (exit 3) **sem alterar nada**.

## 3. Atualizar (local; a atualização remota é da R11)
```bash
./install.sh update                         # reverifica e relinka a partir do checkout registrado
./install.sh update --from /caminho/nova-checkout   # passa a usar outra checkout local
```
- O update valida a checkout e compara a versão: downgrade exige `--allow-downgrade`.
- Ele refaz o shim e o link/cópia da Skill. **A config do usuário (`bold.config.json`) nunca é tocada.**

## 4. Desinstalar
```bash
./install.sh uninstall          # DRY-RUN (padrão): lista o que seria removido
./install.sh uninstall --yes    # remove só o que o recibo diz que o installer criou
```
- Só o que ainda é do installer é removido: o symlink precisa apontar para o pacote, o shim tem que ter o marcador e a cópia, o `.bold-installed.json`. Diretórios só saem se estiverem **vazios**.
- **Nunca** são removidos: projetos, mídia, `bold.config.json`, caches de outras ferramentas, outras Skills e o Claude Code.

## 5. Status e diagnóstico
```bash
./install.sh status
bold doctor                 # core · motion · davinci · transcript · assets · claude
bold doctor --module claude
bold home                   # BOLD_HOME, versão, componentes
```

## 6. Claude Code

### 6.1 Distribuição recomendada: marketplace público (plugin `bold-edit`)
```bash
claude plugin marketplace add lucashsaura/bold-edit-system      # repositório público: não precisa de login no GitHub
claude plugin install bold-edit@bold-edit-system
```
- Abra uma nova sessão. A Skill é `/bold-edit:edit`, e a CLI `bold` entra no PATH do Bash do Claude.
- Fixar versão: `lucashsaura/bold-edit-system#v0.8.0-beta.1`.
- Atualizar, reverter e remover: `references/update.md`.
- Marketplace e problemas: `references/marketplace.md`.
- **Use um modo por máquina:** se tiver instalado a Skill pessoal pelo installer local, remova-a (`./install.sh uninstall --yes`) antes de instalar o plugin.

### 6.2 Modo local / desenvolvimento (installer deste checkout)
- **Skill pessoal** (padrão do installer): `/bold-edit`. O Claude também a invoca sozinho em tarefas de vídeo, motion ou DaVinci.
- **Skill de projeto:** `--mode project`.
- **Plugin** (sessão de teste, sem marketplace): `claude --plugin-dir <checkout>` → `/bold-edit:edit`; o `bin/` do plugin põe `bold` no PATH do Bash.
- Detalhes: `references/claude-code-skill.md` e `references/plugin-packaging.md`.

## 7. Problemas comuns
| Sintoma | Causa / solução |
|---|---|
| `bold: command not found` | `~/.local/bin` (ou `%LOCALAPPDATA%\bold\bin`) fora do PATH. Adicione-o, ou use `<checkout>/bin/bold` |
| install exit 3 "não foi criado pelo installer" | já existe outra Skill `bold-edit`. Renomeie-a, ou use `--replace-skill` (faz backup) |
| `/bold-edit` não aparece | o diretório `~/.claude/skills` não existia quando a sessão começou → `/reload-skills` ou nova sessão (doc oficial) |
| doctor WARNING `core.install` | uso direto do checkout, sem installer (válido para desenvolvimento) |
| doctor `claude.skill-personal` "aponta para outro lugar" | rode `./install.sh update --from <checkout certa>` |
| Windows: cópia desatualizada | `install.cmd update` |
