# Distribuição — BOLD EDIT SYSTEM

Como o pacote distribuído é produzido e verificado. Para instalar, veja `INSTALL.md`.

## Arquitetura (dois repositórios)

```
REPOSITÓRIO DE DESENVOLVIMENTO (privado/local; histórico completo, testes, relatórios)
   │  distribution-manifest.json  (INCLUDE / DEVELOPMENT_ONLY / EXCLUDE)
   ▼
bold dist build --ref <commit>     → dist/bold-edit/   (só INCLUDE, lido do COMMIT, sem timestamps)
bold dist audit dist/bold-edit     → lock ↔ disco, classes, caminhos proibidos, leak scan
   ▼
REPOSITÓRIO DE DISTRIBUIÇÃO (Git público, lucashsaura/bold-edit-system; histórico próprio, sem o histórico de desenvolvimento)
   .claude-plugin/marketplace.json   marketplace "bold-edit-system"
   plugins/bold-edit/                plugin "bold-edit" (= conteúdo INCLUDE)
   distribution-lock.json            inventário exato (caminho, tamanho, sha256, modo, origem)
   README.md
```
**Por que separar:**
- A distribuição não carrega testes, spikes, relatórios históricos nem fixtures.
- O Claude Code clona o marketplace inteiro e copia só `plugins/bold-edit/` para o cache. Ele não segue nada fora do plugin.

## Construir e verificar (no repositório de desenvolvimento)
```bash
bold dist plan                                   # contagem por classe do commit (fail-closed se algo estiver sem classe/EXCLUDE)
bold dist build --output dist/bold-edit          # saída nunca sobrescreve
bold dist audit dist/bold-edit                   # PASS obrigatório
bold dist build --output dist/check && bold dist compare dist/bold-edit dist/check   # BYTE-IDENTICAL
claude plugin validate dist/bold-edit            # marketplace (oficial)
claude plugin validate dist/bold-edit/plugins/bold-edit   # plugin (oficial)
```
- `distribution-lock.json` prova exatamente o que foi distribuído: `content_sha256` cobre todos os arquivos.
- `source.commit` diz de qual commit de desenvolvimento a distribuição saiu.

## Versão
- **Fonte única:** `package.json`. O `plugin.json` deve ser igual (teste + doctor). O `marketplace.json` **não** tem versão (doc oficial: o `plugin.json` vence).
- **Política (semver):**

  | Mudança | Exemplo |
  |---|---|
  | **PATCH** | correção compatível (0.5.0 → 0.5.1) |
  | **MINOR** | nova capacidade compatível (0.5.0 → 0.6.0) |
  | **MAJOR** | mudança incompatível (CLI, schemas, comportamento de segurança) |

- Com a versão pinada no `plugin.json`, o usuário **só recebe uma atualização quando a versão muda** (doc oficial). Toda release troca a versão de propósito.
- **Tag** na distribuição: `v<versão>` (ex.: `v0.5.0`), apontando para o commit da release. É ela que permite fixar e reverter (`<owner>/<repo>#v0.5.0`).

## Publicar uma release (exige aprovação humana)
1. Atualize a versão (`package.json` + `.claude-plugin/plugin.json`) no desenvolvimento e faça o commit.
2. `bold dist build` + `bold dist audit` + `bold dist compare` + `claude plugin validate`.
3. **Mostre o plano e espere aprovação.**
4. No clone da distribuição:
   - substitua o conteúdo pelo build;
   - commit `release: BOLD EDIT SYSTEM <versão>`;
   - tag `v<versão>`;
   - push (credencial git do próprio usuário, nunca token em arquivo ou URL).
5. Verifique o remoto: visibilidade, branch, commit, tag e hashes iguais ao lock (`bold dist audit <clone>`).
