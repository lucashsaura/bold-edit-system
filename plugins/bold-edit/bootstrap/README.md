# Bootstrap (R12)

**Os bootstraps funcionam sem Node.js.** Eles:
- detectam a plataforma;
- procuram um Node utilizável, nesta ordem: `BOLD_NODE_PATH`, o toolchain gerenciado (`node.path`), o `node` do PATH;
- **se acharem**, passam para `bold setup`, que é um plano somente leitura;
- **se não acharem** e o lock fixar o Node da plataforma, mostram o plano e só baixam e instalam com confirmação (fluxo abaixo);
- **se não houver artefato fixado** para a plataforma, mostram o que seria necessário e saem com o código 5.

| Plataforma | Script | Estado |
|---|---|---|
| macOS arm64 (inclusive sob Rosetta 2) | `sh bootstrap/bootstrap.sh` | SUPPORTED · testado com HOME isolado e PATH sem Node/Homebrew; download real do Node 24.22.0 validado na R12.5A |
| macOS Intel | `sh bootstrap/bootstrap.sh` | EXPERIMENTAL |
| Windows x64 | `powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap\bootstrap.ps1` | EXPERIMENTAL · **não testado em Windows real**. A política de execução vale só para este processo |
| Windows ARM64 | — | UNSUPPORTED |

**Download verificado do Node** (R12.2/R12.3): só acontece se o lock tiver fixado o artefato da plataforma; o bloco `BOLD-LOCK` é gerado do lock. Desde a R12.3 o lock fixa o **Node 24.22.0** (nodejs.org). O download continua exigindo confirmação, e a trava `BOLD_SETUP_OFFLINE=1` o recusa.

Quando houver artefato fixado, o fluxo é:
1. confirmação (terminal ou `--yes`);
2. checagem de espaço;
3. download só por HTTPS do host permitido, sem seguir redirects;
4. conferência de tamanho e sha256;
5. validação da lista do arquivo;
6. staging;
7. `bold setup apply --archive`;
8. limpeza dos temporários.

**Nunca:** `curl | sh`, `--insecure`, `iex`, `sudo`/admin, PATH global, arquivos de shell, registro ou política de execução da máquina.

**Testes:** E2E em ambiente limpo (sem Node e sem Homebrew), baixando um "Node" sintético de um servidor local (`tests/setup/bootstrap-e2e.test.mjs`).

Variáveis só para teste:
- `BOLD_BOOTSTRAP_UNAME_S`, `_UNAME_M`, `_TRANSLATED`, `_NO_TTY` (sh) e `BOLD_BOOTSTRAP_ARCH` (ps1). Elas só escolhem entre as entradas **oficiais** do lock ou desligam a pergunta; nunca trocam URL, sha256, tamanho ou identidade.

Artefato de teste (R12.5 B3):
- **Nunca vem do ambiente.** O script distribuído tem o bloco `BOLD-TEST` **vazio**, e o `bold dist audit` reprova se ele estiver preenchido.
- A suíte grava **cópias** do script com o bloco preenchido (só URL `http://127.0.0.1`) e uma CLI de teste com a confiança injetada (`tests/helpers/test-cli.mjs`).
