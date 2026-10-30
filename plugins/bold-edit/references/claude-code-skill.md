# Claude Code Skill — `bold-edit`

**Status: CLAUDE_SKILL_V1.** A Skill oficial do BOLD EDIT SYSTEM é uma camada de **orquestração** sobre a CLI `bold`. O conhecimento fica em `references/` e é lido sob demanda.

## 1. Documentação oficial consultada (2026-10-06)

| Página | Uso |
|---|---|
| `code.claude.com/docs/en/skills` | locais (pessoal `~/.claude/skills/<nome>/SKILL.md`, projeto `.claude/skills/<nome>/SKILL.md`, plugin `<plugin>/skills/<nome>/SKILL.md`); frontmatter (todos opcionais; `description` + `when_to_use` truncados em **1.536** caracteres); invocação automática e `/nome`; precedência (enterprise > pessoal > projeto; plugins namespaced); arquivos de apoio (SKILL.md < 500 linhas); **symlink suportado** em pessoal/projeto; live reload (`/reload-skills` se `.claude/skills` não existia) |
| `code.claude.com/docs/en/plugins-reference` | manifest `.claude-plugin/plugin.json` (`name` kebab-case obrigatório; nomes reservados `claude-*`/`anthropic-*`); layout padrão; `bin/` do plugin vai para o PATH do Bash; `${CLAUDE_PLUGIN_ROOT}`; `claude plugin validate` |
| `code.claude.com/docs/en/plugins/loading` | `--plugin-dir` carrega em lugar (sessão, `@inline`); plugins instalados são **copiados** para `~/.claude/plugins/cache/…` e não podem referenciar fora da raiz; um diretório com `.claude-plugin/plugin.json` dentro de `~/.claude/skills/` carrega como **plugin** (`@skills-dir`), não como Skill |
| `code.claude.com/docs/en/settings` | no Windows, `~/.claude` = `%USERPROFILE%\.claude`; `CLAUDE_CONFIG_DIR` realoca os arquivos de home |
| `code.claude.com/docs/en/env-vars` | `CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_CODE_PLUGIN_CACHE_DIR` |

A página de Skills **não menciona Windows**. O caminho do Windows vem da página de Settings.

## 2. Estrutura
```
skills/edit/
  SKILL.md        frontmatter + quando usar + localizar o sistema + fluxo + regras inegociáveis + mapa de conhecimento (≈ 80 linhas)
  cli.md          cola da CLI e exit codes
  safety.md       regras de segurança completas (render/export, DaVinci, decisão, privacidade)
  workflows.md    fluxos por tarefa
```
**Decisões:**
- **Sem `name` no frontmatter.** O nome vem do diretório instalado:
  - pessoal e projeto: `~/.claude/skills/bold-edit` → **`/bold-edit`**;
  - plugin `bold-edit`, pasta `skills/edit` → **`/bold-edit:edit`**.
  - O mesmo SKILL.md serve aos três modos.
- **Invocação:** automática (descrição com os casos de uso primeiro, `when_to_use` com gatilhos em pt) e manual (`/bold-edit`). `disable-model-invocation` não é usado, porque queremos a invocação automática.
- **`allowed-tools` não é usado:** a Skill não pré-aprova nenhuma ferramenta. As aprovações e os gates de segurança continuam valendo.
- **Localização do sistema sem caminho fixo:** `bold home --json`, com fallback para `${CLAUDE_PLUGIN_ROOT}/bin/bold` no plugin. Se não achar, a Skill pede a instalação e **não varre o disco**.
- **Regras de segurança** no SKILL.md (resumo) e em `safety.md` (completas): render/export com autorização explícita; opt-in técnico ≠ autorização humana; DaVinci write com `davinci-write` + checkpoint + timeline gate + File Path + readback; decidir ≠ executar (aprovação humana); SYSTEM ≠ TEMPLATE; privacidade.
- **A pasta da Skill não contém `.claude-plugin/`**, senão o Claude Code a carregaria como plugin `@skills-dir`. Isso é verificado por teste.
- O `SKILL.md` da **raiz** do repositório é o roteador histórico do pacote (para leitura humana e compatibilidade). Como a raiz tem `skills/`, o loader de plugins **não** o carrega como Skill.

## 3. Modos de instalação

| Modo | Como | Quando |
|---|---|---|
| **Pessoal** (padrão) | `./install.sh` → symlink `~/.claude/skills/bold-edit → <checkout>/skills/edit` (Windows: cópia gerenciada) | uso pessoal; disponível em todos os projetos locais; recomendado para desenvolvimento |
| **Projeto** | `./install.sh --mode project --project-dir <repo>` → `<repo>/.claude/skills/bold-edit` | um repositório específico carrega a Skill sem instalação global |
| **Plugin** | `claude --plugin-dir <checkout>` (sessão) · marketplace privado (R11) | distribuição empacotada, namespace próprio (`/bold-edit:edit`), `bold` no PATH via `bin/` |

**Precedência (oficial):**
- Pessoal > projeto quando o nome coincide.
- Plugin é namespaced (`/bold-edit:edit`). O nome curto `/edit` só funciona sem colisão. Para o BOLD, prefira o nome completo.

## 4. Validação feita
- **Estrutural (teste):** frontmatter válido, descrição + `when_to_use` = 743/1.536 caracteres, < 500 linhas, links de apoio resolvem, regras presentes, sem caminho de máquina (`tests/install/portability.test.mjs`; também `bold doctor --module claude`).
- **Instalação limpa (teste):** em HOME falso, o symlink resolve `SKILL.md`, `cli.md`, `safety.md` e `workflows.md`, e o doctor marca `claude.skill-personal` = PASS.
- **Oficial (manual, offline, Claude Code 2.1.288):**
  - `claude plugin validate .` → `Validation passed` (inclusive `--strict`);
  - `claude plugin validate skills` → `Validation passed`;
  - com HOME/`CLAUDE_CONFIG_DIR` isolados, `claude --plugin-dir <checkout> plugin details bold-edit` → `Source: bold-edit@inline`, `Skills (1) edit`, ~190 tokens sempre carregados e ~1,1k por invocação.
- **Limite:** a descoberta da **Skill pessoal** numa sessão nova com modelo **não** foi executada, porque exigiria instalar no `~/.claude` real ou fazer uma chamada ao modelo/rede. Ela está validada estruturalmente e pela documentação oficial (symlink suportado). Para conferir: depois de `./install.sh`, abra uma sessão nova e digite `/bold-edit`.
