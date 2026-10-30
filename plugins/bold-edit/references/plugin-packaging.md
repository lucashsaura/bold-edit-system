# Plugin — `bold-edit`

**Status: PLUGIN_PACKAGE_V1 = READY_FOR_PRIVATE_DISTRIBUTION.** Nada foi publicado: sem marketplace, sem remote.

## 1. Estrutura (a raiz do repositório É a raiz do plugin)
```
.claude-plugin/plugin.json   {"name":"bold-edit","displayName":"BOLD Edit System","version":"<= package.json>", ...}
skills/edit/SKILL.md         → /bold-edit:edit
bin/bold, bin/bold.cmd       → `bold` no PATH do Bash enquanto o plugin estiver ativo (doc oficial: bin/ do plugin)
(o resto do pacote)          código e references, todos DENTRO da raiz do plugin
```
**Por que a raiz do repositório:**
- Plugins instalados são **copiados** para `~/.claude/plugins/cache/…` e não podem referenciar nada fora da raiz (doc oficial).
- A Skill precisa da CLI e das references, então o plugin tem de ser o pacote inteiro.
- `${CLAUDE_PLUGIN_ROOT}` aponta para essa cópia.

**V1 mínima (decisão):**
- Só a Skill e o `bin/`.
- **Sem** hooks, agents, MCP, LSP, monitors, `userConfig` ou `dependencies`, porque nada disso é necessário hoje.
- A **versão é fixada** (`version` = `package.json`, verificada por teste e pelo doctor), então cada release exige trocar a versão de propósito.

## 2. Namespace e invocação
| Situação | Comando |
|---|---|
| plugin ativo | **`/bold-edit:edit`** (nome completo, sempre inequívoco) |
| plugin ativo, sem colisão | `/edit` também funciona (nome curto; evite, é genérico) |
| Skill pessoal/projeto (installer) | `/bold-edit` |

**Pessoal e plugin ao mesmo tempo:** os nomes são diferentes (`/bold-edit` × `/bold-edit:edit`), então não há colisão. Mas é a mesma Skill carregada duas vezes: escolha **um** modo por máquina.

## 3. Testar localmente (sem marketplace)
```bash
claude plugin validate <checkout>                 # oficial; --strict para CI
claude --plugin-dir <checkout>                    # carrega só nesta sessão (@inline)
claude --plugin-dir <checkout> plugin details bold-edit
```
Resultado em 2026-10-06 (Claude Code 2.1.288, offline, HOME isolado):
- `Validation passed`, inclusive com `--strict`;
- `Skills (1) edit`, ~190 tokens sempre carregados e ~1,1k por invocação.

## 4. Quando usar cada modo
| Modo | Use para | Prós | Contras |
|---|---|---|---|
| Skill pessoal | desenvolvimento, uso pessoal | edição ao vivo (symlink), instalação simples, `/bold-edit` | `bold` no PATH depende do shim do installer |
| Skill de projeto | um repositório que deve carregar a Skill | acompanha o repo | precisa do `bold` instalado na máquina |
| **Plugin** | **distribuição** | pacote único, versionado, namespace próprio, `bold` no PATH via `bin/`, update pelo Claude Code | cópia em cache (edição exige nova versão); o marketplace é da R11 |

## 5. Recomendação para a R11
- **Formato principal de distribuição = PLUGIN** `bold-edit`, num **marketplace privado** (repositório Git privado com `.claude-plugin/marketplace.json`), construído a partir do `distribution-manifest.json` (só INCLUDE; testes e relatórios ficam no repositório de desenvolvimento).
- **Skill pessoal via installer = modo de desenvolvimento/local** (symlink para a checkout de trabalho).
- Na R11, ainda falta:
  - criar o marketplace privado;
  - definir a política de versão (pinada × por commit);
  - decidir se a distribuição inclui um `bin/` com shims (claude.ai/Cowork não instalam plugins com `bin/`; o Claude Code sim);
  - fazer o teste de instalação a partir do marketplace.
