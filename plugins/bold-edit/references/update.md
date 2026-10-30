# Atualização, rollback e remoção

## Plugin `bold-edit` (marketplace público `bold-edit-system`)

| Ação | Comando (oficial) | Notas |
|---|---|---|
| ver versão | `claude plugin list` | `Version`, `Scope`, `Status` |
| atualizar o catálogo | `claude plugin marketplace update bold-edit-system` | atualiza a listagem, **não** os plugins |
| atualizar o plugin | `claude plugin update bold-edit@bold-edit-system` | só troca a cópia se a **versão do `plugin.json` mudou** |
| aplicar na sessão aberta | `/reload-plugins` | ou abra uma nova sessão |
| conferir | `bold doctor` e `bold --version` | dentro do Claude: pelo Bash; o `bin/` do plugin está no PATH |
| auto-update | `/plugin` → Marketplaces → **Enable auto-update** | desligado por padrão para marketplaces de terceiros |

**Rollback para uma versão anterior.** Cada release tem a tag `v<versão>` na distribuição.
```bash
claude plugin marketplace remove bold-edit-system                 # desinstala os plugins deste marketplace
claude plugin marketplace add lucashsaura/bold-edit-system#v0.8.0-beta.1     # catálogo fixado na tag
claude plugin install bold-edit@bold-edit-system
bold doctor
```
Para voltar a acompanhar a branch principal: remova e adicione de novo **sem** `#ref`.

- **A cópia antiga** fica em `~/.claude/plugins/cache/…` até a limpeza automática (14 dias, doc oficial). Uma sessão já aberta continua na versão que carregou.
- **Dados:** o `bold.config.json` do usuário, os projetos e os caches do BOLD (`CACHE_DIR`) não são tocados por update, rollback ou uninstall do plugin.
- **Remover tudo:** `claude plugin uninstall bold-edit@bold-edit-system` e depois `claude plugin marketplace remove bold-edit-system`.

## Installer local (modo de desenvolvimento)

| Ação | Comando |
|---|---|
| atualizar a partir de outra checkout local | `./install.sh update --from <checkout>` (downgrade só com `--allow-downgrade`) |
| reverificar/relinkar | `./install.sh update` |
| remover | `./install.sh uninstall` (dry-run), depois `./install.sh uninstall --yes` |

## Publicar uma nova versão (mantenedor; exige aprovação humana)
1. Trocar a versão (`package.json` e `.claude-plugin/plugin.json`) segundo a política semver (`DISTRIBUTION.md`).
2. `bold dist build`, `audit`, `compare`, `claude plugin validate`.
3. Aprovação. Depois: commit `release: BOLD EDIT SYSTEM <v>`, tag `v<v>`, push e verificação do remoto.
4. Usuários: `marketplace update` + `plugin update` (ou auto-update) + `bold doctor`.

**Não** publique uma versão só para testar o update. A lógica de update é testada em ambiente isolado (`references/marketplace.md`).
