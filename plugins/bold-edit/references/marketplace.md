# Marketplace público — `bold-edit-system`

Repositório: `lucashsaura/bold-edit-system` (GitHub, público). Página oficial: https://boldcomunica.com/bold-edit/.
Comandos conferidos na documentação oficial do Claude Code (`plugins/marketplace-reference`, `plugins/install`).

## 1. Estrutura (repositório de distribuição)
```json
// .claude-plugin/marketplace.json
{ "name": "bold-edit-system", "owner": { "name": "Bold Comunica" }, "description": "…",
  "plugins": [ { "name": "bold-edit", "source": "./plugins/bold-edit", "description": "…", "category": "video", "tags": ["…"] } ] }
```
- **`name`:** `bold-edit-system`. É o nome depois do `@`: `bold-edit@bold-edit-system`.
- **`source` relativo** (`./plugins/bold-edit`): válido porque o marketplace é hospedado em **git**. O Claude Code clona a
  árvore e copia só `plugins/bold-edit/` para o cache.
- **Sem `version` na entrada:** ela vive no `plugin.json`.

## 2. Instalar
```bash
claude plugin marketplace add lucashsaura/bold-edit-system   # público: sem login no GitHub
claude plugin install bold-edit@bold-edit-system             # escopo user (padrão); --scope project|local
claude plugin list                                           # confere versão/escopo/status
```
- Numa sessão: `/plugin marketplace add lucashsaura/bold-edit-system` e `/plugin install bold-edit@bold-edit-system`.
- Depois, abra uma nova sessão (ou rode `/reload-plugins`). Aparecem `/bold-edit:edit` e o `bold` no PATH do Bash do Claude.
- **Comando principal:** `/bold-edit:edit`. O Claude Code sempre prefixa as Skills de plugin com o nome do plugin. Também basta
  descrever a tarefa (abertura, lower third, legenda, DaVinci, efeito sonoro…) que o Claude aciona a Skill sozinho.
- **Fixar uma versão:** `claude plugin marketplace add lucashsaura/bold-edit-system#v0.8.0-beta.1`.
- **Nada pesado é baixado na instalação.** O plugin tem só código e documentação. FFmpeg, SFX Kit, Earshot e modelos são
  opcionais, e só são instalados quando você pede (`bold setup`, `bold audio setup`).
- **Um modo por máquina:** se existir a Skill pessoal `~/.claude/skills/bold-edit` (installer local), rode `./install.sh uninstall --yes`
  antes, ou mantenha só um dos dois.

## 3. Atualizar, reverter e remover
Ver `update.md`. Em resumo:
- **Atualizar:** `claude plugin marketplace update bold-edit-system` → `claude plugin update bold-edit@bold-edit-system` → `bold doctor`.
- **Reverter:**
  1. `claude plugin marketplace remove bold-edit-system`, que **desinstala os plugins dele**;
  2. `claude plugin marketplace add lucashsaura/bold-edit-system#v<versão anterior>`;
  3. `claude plugin install bold-edit@bold-edit-system`.
- **Remover:** `claude plugin uninstall bold-edit@bold-edit-system` e `claude plugin marketplace remove bold-edit-system`.

## 4. Problemas comuns
| Sintoma | Causa provável |
|---|---|
| `marketplace add` falha | sem acesso a `github.com` (proxy/firewall) ou nome digitado errado. O repositório é público e não pede login |
| `Plugin "bold-edit" not found in marketplace` | marketplace desatualizado → `claude plugin marketplace update bold-edit-system` |
| update não chega | a versão do `plugin.json` não mudou. Toda release troca a versão |
| `/bold-edit:edit` não aparece | nova sessão ou `/reload-plugins`; confira `claude plugin list` (Status) e a aba Errors em `/plugin` |
| `bold: command not found` dentro do Claude | o `bin/` do plugin só entra no PATH do **Bash do Claude** com o plugin ativo. No seu terminal, use `"<cache>/bin/bold"` |
