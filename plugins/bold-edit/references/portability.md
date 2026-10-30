# Portabilidade (R10)

**Status: PORTABILITY_V1.** O sistema não depende do caminho onde foi desenvolvido, de symlinks manuais, de configuração escondida nem de arquivos fora do pacote. Isso é provado pelo teste de instalação limpa (`tests/install/clean-install.test.mjs`).

## 1. Raiz única: `BOLD_HOME`
- `BOLD_HOME` = raiz do pacote, resolvida pelo **próprio arquivo** (`import.meta.url` em `core/config/load.mjs` e `core/product.mjs`), nunca pelo cwd. `bold home` mostra o valor.
- Pode ser sobrescrito por `BOLD_HOME` (ENV), para ferramentas que precisam apontar outra checkout.
- Todo caminho interno é relativo ao pacote ou resolvido pela config.

## 2. Layout (sem reorganização destrutiva)
```
bold-edit-system/
  .claude-plugin/plugin.json   manifest do plugin "bold-edit"
  skills/edit/                 Skill oficial (SKILL.md + cli.md, safety.md, workflows.md)
  bin/                         bold.mjs (CLI) + bold (shim POSIX) + bold.cmd (shim Windows)
  core/ config/                núcleo, defaults por SO, product.json (manifest de componentes)
  transcript/ asset-index/ editorial/ davinci/ remotion/ hyperframes/ motion/ templates/
  references/                  knowledge base
  install/ install.sh install.cmd   installer
  distribution-manifest.json   allowlist da distribuição (R11)
  tests/  *_REPORT.md          DEVELOPMENT_ONLY
```

## 3. Configuração em camadas

`DEFAULTS (config/defaults.json, por SO) < USER CONFIG < PROJECT CONFIG < ENV < CLI FLAGS`

| Camada | Onde |
|---|---|
| Defaults | `config/defaults.json`, com tokens `${HOME}`, `${LOCALAPPDATA}`, `${PROGRAMDATA}`… resolvidos em runtime |
| Usuário | macOS `~/Library/Application Support/bold/bold.config.json` · Windows `%APPDATA%\bold\bold.config.json` · Linux `$XDG_CONFIG_HOME/bold/`. **O installer nunca cria nem altera este arquivo** |
| Projeto | `bold.project.json` (procurado subindo do cwd; ou `--project`/`BOLD_PROJECT_ROOT`); overrides em `config` |
| ENV | `BOLD_CACHE_DIR`, `BOLD_RENDER_DIR`, `BOLD_FONTS_DIR`, `BOLD_FFMPEG_PATH`, `BOLD_FFPROBE_PATH`, `BOLD_PYTHON_PATH`, `BOLD_NODE_PATH`, `BOLD_DAVINCI_SCRIPT_API`/`_LIB`, `BOLD_REMOTION_PROJECT_DIR`, `BOLD_HYPERFRAMES_CMD`, `BOLD_WHISPER_*` (`core/config/load.mjs` → `ENV_MAP`) |
| Flags | `--project`, mais os flags de cada comando (`--index`, `--fps`…) |

- `bold config` mostra o valor efetivo e **a origem** de cada chave.
- As policies de segurança (render/export exigem autorização etc.) são **invariantes**: nenhuma camada as afrouxa.
- **Instalação:** `BOLD_BIN_DIR` (diretório do shim) e `CLAUDE_CONFIG_DIR` (oficial do Claude Code). Nada mais foi exposto: preferimos poucos pontos de configuração.
- **Nunca no código versionado:** token, senha, credencial, cliente, caminho pessoal. O leak scanner garante isso (`bold audit-leaks`, PASS obrigatório).

## 4. Mapa de dependências (auditoria R10, Fase 0)

| Dependência | Classe | Observação |
|---|---|---|
| Node ≥ 20 | **PORTABLE** (pré-requisito) | o installer verifica e não instala |
| CLI/core/R8/R9 | PORTABLE | caminhos relativos ao pacote; sem dependências npm |
| Config em camadas | CONFIGURABLE | tokens por SO, ENV, projeto |
| ffmpeg/ffprobe | OPTIONAL · CONFIGURABLE | `auto` = PATH; ausência = WARNING claro |
| Python ≥ 3.10 | OPTIONAL · CONFIGURABLE | só para a DaVinci Bridge |
| Caminhos da Scripting API do Resolve | PLATFORM_SPECIFIC · CONFIGURABLE | defaults macOS/Windows em `defaults.json` e `davinci/api/connect.py`; ENV `RESOLVE_SCRIPT_API/LIB` ou `BOLD_DAVINCI_SCRIPT_*` |
| Projeto Remotion | OPTIONAL (externo) | `BOLD_REMOTION_PROJECT_DIR`; não empacotado |
| CLI HyperFrames | OPTIONAL (externo) | `BOLD_HYPERFRAMES_CMD`; cache histórico de fontes do HyperFrames = DO_NOT_TOUCH |
| whisper.cpp + modelo | OPTIONAL (USER_PROVIDED) | não é executado na V1 |
| Fontes | USER_PROVIDED | `FONTS_DIR`; nunca distribuídas |
| loopback `127.0.0.1` (job do HyperFrames) | PORTABLE | intencional (servidor local da composição) |
| `sw_vers` no doctor | PLATFORM_SPECIFIC | só em macOS |
| ferramentas falsas `#!/bin/sh` nos testes | DEVELOPMENT_ONLY | testes de mídia/Bridge são POSIX |
| fallback `~/bold-edit-system/remotion-factory` em `tests/unit/media-opt-in.test.mjs` | DEVELOPMENT_ONLY | só um valor de env em teste que **prova zero renders**; ausente em outra máquina, o teste continua válido |
| `*_REPORT.md` históricos | DEVELOPMENT_ONLY | sem caminhos pessoais (varrido) |
| `davinci/media/` | **era BLOCKING** | estava fora do git (regra `media/` do `.gitignore`). Corrigido na R10, sem mudar código (commit `15ede58`) |
| Configuração existente do Claude Code | — | nenhuma Skill `bold-edit` prévia. As Skills pessoais do usuário não são tocadas |
| Symlinks no repositório | — | nenhum |

## 5. Bugs de portabilidade encontrados pelo clean-install (corrigidos)
1. **`davinci/media/` não versionado** (ver acima): um clone limpo teria a Bridge quebrada.
2. **`new URL(...).pathname` no doctor** codificava espaços/Unicode (`%20`) e quebrava em caminhos como "dist com espaço/bold-edição" e no Windows. Trocado por `fileURLToPath`.
3. **Leak scanner auditando outra cópia do pacote:** o scanner pulava os próprios arquivos de regras só pelo caminho absoluto. Agora também pelo caminho relativo.

## 6. Plataformas
| SO | Status | Notas |
|---|---|---|
| macOS | SUPPORTED | instalação, CLI, Skill (symlink), plugin e DaVinci validados |
| Windows | EXPERIMENTAL | caminhos simulados em teste (`%USERPROFILE%\.claude`, `%LOCALAPPDATA%\bold\bin`, `%APPDATA%\bold`); Skill **copiada**; shim `.cmd`; DaVinci, Remotion e HyperFrames não validados. Sem paridade fingida |
| Linux | DEVELOPMENT_ONLY | XDG para config. Não é plataforma de produção |
