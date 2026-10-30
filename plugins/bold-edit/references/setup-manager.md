# BOLD Setup Manager (R12)

**Estado: R12.3, `PREVIEW_LOCAL`.** O `setup/toolchain.lock.json` fixa Node 24 LTS e FFmpeg 9.0.2 a partir de metadados oficiais (ver *Lock real*). O `apply` baixa só esses artefatos, **sempre** com pedido explícito e confirmação. Os artefatos reais ainda não foram exercitados ponta a ponta: isso é a Fase 5.

O objetivo é deixar outros editores instalarem o BOLD sem configurar Node, FFmpeg e Python à mão, com download sempre verificado e confirmado, sem admin e sem PATH global.

## Comandos
| Comando | Efeito na Fase 1 |
|---|---|
| `bold setup` / `bold setup plan [--include id,…\|all]` | **somente leitura**: plataforma, inventário e ações propostas |
| `bold setup platform` | SO, arquitetura (inclusive Rosetta 2) e nível de suporte |
| `bold setup inventory` | ferramentas encontradas, versão e **origem** (`env`, `project`, `user-config`, `toolchain`, `system-path`, `app-bundle`) |
| `bold setup status` / `verify` | estado e integridade do toolchain gerenciado (somente leitura) |
| `bold setup rollback --tool T [--yes]` | volta para a versão anterior, depois de conferir o hash dela. Sem `--yes` é só simulação |
| `bold setup simulate [--keep]` | ciclo completo num diretório **temporário** com artefatos **sintéticos** |
| `bold setup licenses` | licença e política de cada componente |
| `bold setup apply --components a,b [--dry-run] [--yes] [--archive F]` | instala **só** os componentes listados, com **confirmação por componente** (fonte, tamanho, sha256, licença e destino). Sem terminal, exige `--yes`. Sem artefato PINNED → `NOTHING_INSTALLABLE` (exit 5) |
| `bold setup consent [--component C --basis B [--yes] \| --revoke]` | aceite **explícito** de licença (Remotion); sem argumentos, lista os aceites |
| `bold setup uninstall [--tool T] [--yes]` | **dry-run por padrão**; remove só diretórios do recibo **com hash íntegro**. Modificados, não rastreados e logs ficam |

Os bootstraps funcionam **sem Node**: `bootstrap/bootstrap.sh` no macOS e `bootstrap/bootstrap.ps1` no Windows (EXPERIMENTAL). Ver `bootstrap/README.md`.

## Plataformas
| Alvo | Suporte |
|---|---|
| `darwin-arm64` (inclusive processo x64 sob Rosetta 2) | SUPPORTED |
| `darwin-x64` | EXPERIMENTAL (FFmpeg: **só detecção**) |
| `win32-x64` | EXPERIMENTAL |
| `win32-arm64` | UNSUPPORTED (sem x64 emulado automático) |
| Linux | DEVELOPMENT_ONLY (só detecção) |

## Dependências e políticas
| Nível | Componente | Política |
|---|---|---|
| ESSENCIAL | Node.js (alvo 24 LTS; mínimo 20; HyperFrames exige ≥ 22) | MANAGED (lock na Fase 3) |
| ESSENCIAL | FFmpeg + ffprobe com `prores_ks` (componente composto) | MANAGED: Martin Riedl (macOS arm64), BtbN LGPL (Windows x64) · macOS Intel: DETECT_ONLY |
| INTEGRAÇÃO | Python ≥ 3.10 (Bridge) | DETECT_ONLY. O **ResolvePython 3.14** é detectado, mas **não é usado pela Bridge até ser validado** |
| INTEGRAÇÃO | DaVinci Resolve + API | NEVER: o BOLD nunca instala, abre ou altera o Resolve. O setup não conecta |
| OPCIONAL | Pillow · HyperFrames · modelos Whisper | MANAGED **só sob pedido** (`--components`). Instalável apenas o que o lock fixou e aprovou: Pillow macOS Intel aguarda medição; HyperFrames só no macOS arm64 (ver "HyperFrames gerenciado") |
| OPCIONAL | Chrome headless | DETECT_ONLY: fornecido pelo usuário (`tools.CHROME_HEADLESS_PATH`); download adiado |
| OPCIONAL | Remotion | LICENSE_GATED: 4 ou mais pessoas exigem Company License |
| OPCIONAL | whisper.cpp | macOS: DETECT_ONLY (não há binário oficial) · Windows: PLANNED |

**Regras:**
- O BOLD **não redistribui** binários de terceiros: o download vai do upstream direto para a máquina do usuário.
- O Chrome headless **nunca** é baixado sem sha256 fixado pelo mantenedor.

## Onde fica
| SO | Raiz do toolchain gerenciado (`BOLD_TOOLCHAIN_DIR` sobrescreve) |
|---|---|
| macOS | `~/Library/Application Support/bold/toolchain/` |
| Windows | `%LOCALAPPDATA%\bold\toolchain\` |
| Linux | `$XDG_DATA_HOME/bold/toolchain/` |

Conteúdo da raiz:
- `<ferramenta>/<versão>-<plataforma>/`: as versões, lado a lado;
- `active.json`: os ponteiros, sem symlinks;
- `node.path`: lido pelos shims;
- `receipt.json`: tudo o que o setup criou;
- `.lock`: mutex;
- `logs/setup-AAAAMMDD.jsonl`: o dia vem em UTC.

## Prioridade de configuração das ferramentas
`ENV BOLD_*` > `bold.project.json` > `bold.config.json` do usuário (caminho explícito) > **toolchain gerenciado** > `"auto"` (PATH).

- O setup **nunca escreve** no `bold.config.json` do usuário.
- Um `active.json` inválido ou inseguro é ignorado e vira apenas aviso.
- Sem toolchain, a config é idêntica à de antes da R12.

**Shims** (`bin/bold`, `bin/bold.cmd` e o shim do installer): `BOLD_NODE_PATH` > `node.path` do toolchain > `node` do PATH.

**PATH só do processo:** o `bold` acrescenta os binários gerenciados ao PATH **do próprio processo** e dos processos filhos (HyperFrames, Remotion). O PATH global, os arquivos do shell e o registro não são tocados.

## Download e extração (R12.2)
- **Downloader** (Node puro, sem dependências):
  - HTTPS **obrigatório** e host na allowlist do lock, **revalidada em cada redirect**;
  - URL com credenciais é proibida;
  - `Accept-Encoding: identity` (gzip de transporte é recusado);
  - `Content-Length` e bytes recebidos têm de ser **iguais ao tamanho do lock**;
  - sha256 calculado **durante** o stream;
  - teto absoluto, timeout de inatividade e prazo total;
  - grava em `.part` com `O_EXCL` e só renomeia depois de tudo conferido. Em qualquer falha, o `.part` é apagado.
- **Extração** (leitores próprios de TAR.GZ e ZIP). Recusa:
  - caminho absoluto, drive, `..`, barra invertida, NUL, caracteres de controle e nomes reservados do Windows;
  - fifo, char e block; hard links;
  - symlinks absolutos ou que saem da raiz, e entradas dentro de um symlink;
  - duplicatas, inclusive só por caixa ou forma Unicode (NFC);
  - ZIP cifrado, ZIP64 e métodos que não sejam store/deflate;
  - CRC ou tamanho divergentes e entradas ZIP sobrepostas;
  - bombas de descompressão (teto por arquivo, teto total, razão 200× e número de entradas).

  Symlinks relativos seguros (ex.: `bin/npx`) são criados **por último**.
- **Espaço:** checado **antes** do download (arquivo + 4× estimado + margem de 256 MiB).
- **Fonte de confiança única** (R12.5 B3): o lock **oficial** distribuído (`setup/trust.mjs`).
  - Nenhuma variável de ambiente troca o lock, o npm ou libera URLs de loopback; as do antigo modo de teste são **ignoradas**.
  - A suíte usa **injeção explícita em processo** (`injectTestTrust`) ou o ponto de entrada de teste (`tests/`, fora da distribuição).
  - O `bold dist audit` reprova código distribuído que chame a injeção ou leia as variáveis aposentadas.
  - Sem a flag, o lock trocado é ignorado.

## Bootstrap (R12.2)
`bootstrap/bootstrap.sh` (macOS) e `bootstrap.ps1` (Windows, EXPERIMENTAL, não testado em Windows real).

**Sem Node e com o Node da plataforma fixado no lock** (bloco `BOLD-LOCK`, gerado por `node setup/bootstrap-lock.mjs --write`):
1. mostra o plano;
2. **pede confirmação** (terminal ou `--yes`);
3. checa espaço;
4. baixa só por HTTPS do host permitido, **sem seguir redirects**;
5. confere tamanho e sha256;
6. valida a lista do arquivo;
7. extrai num staging;
8. entrega para `bold setup apply --archive`, que re-confere o lock e ativa;
9. remove só os temporários que ele mesmo criou.

**Sem constantes fixadas** (estado atual), o bootstrap só mostra o plano e sai com 5.

## Lock real e modelo de confiança (R12.3)
O lock é gerado por `setup/lock-gen.mjs`, uma ferramenta de **desenvolvimento** que não vai para o pacote.

**O que o gerador faz:**
- lê **só metadados** públicos oficiais: JSON, listas de checksum, páginas e cabeçalhos `HEAD`;
- **nunca baixa binários** (há teste provando que só faz `HEAD` neles);
- falha fechado em qualquer divergência;
- registra a proveniência em `generated.sources`.

| Componente | Plataforma | Fonte | sha256 vem de | Licença |
|---|---|---|---|---|
| Node.js 24 LTS | macOS arm64/x64, Windows x64 | `nodejs.org/dist` (`index.json`) | `SHASUMS256.txt` oficial | MIT |
| FFmpeg 9.0.2 (**composto**: ffmpeg + ffprobe, 2 zips) | macOS arm64 | Martin Riedl (release estável) | `<arquivo>.zip.sha256` de cada parte | GPL-3.0-or-later (`--enable-gpl --enable-version3`, x264/x265) |
| FFmpeg 9.0.2 (composto: 1 zip, 2 binários) | Windows x64 | BtbN, **último build do último mês completo** (retido por 2 anos) | `digest` da API do GitHub **=** `checksums.sha256` da release | LGPL-2.1-or-later (variante lgpl) |
| FFmpeg | macOS Intel | — | — | **só detecção** (R12.3) |

**Limites de confiança (TOFU do mantenedor):**
- o sha256 é lido por HTTPS das listas oficiais e **revisado pelo mantenedor** no GATE;
- a assinatura GPG do `SHASUMS256.txt` do Node é registrada como **disponível, mas não verificada** (sem `gpg`; decisão R12.3);
- não há verificador OpenPGP próprio;
- um comprometimento do servidor de origem **antes** da geração do lock não seria detectado; depois de fixado, qualquer troca do artefato é detectada pelo sha256.

**Layout e assinaturas:**
- o layout interno dos arquivos (`layout_verified: false`) e as assinaturas de código dos binários só são confirmados na **Fase 5**;
- se o layout divergir, a instalação falha fechada (`BIN_MISSING`) e nada é ativado.

**Componente composto:** `parts[]` no lock.
- Cada parte é baixada, verificada (tamanho e sha256) e extraída **individualmente** na sua subpasta (`ffmpeg/`, `ffprobe/`).
- Há uma única ativação atômica, e cada binário passa pelo teste leve.

**Trava offline:** `BOLD_SETUP_OFFLINE=1` (ligada pela suíte de testes) faz o downloader e os bootstraps recusarem qualquer URL que não seja loopback.

## Componentes opcionais (R12.4)
**Nenhum opcional é instalado automaticamente:** nem pelo bootstrap (que só instala o Node), nem pelo `apply` sem `--components`.

| Funcionalidade | Precisa de | Como o BOLD instala | Integração |
|---|---|---|---|
| Texturas/placeholders (Pillow) | `pillow` = **Python auxiliar ISOLADO** (python-build-standalone 3.12) + wheel do Pillow | composto: tar.gz do Python + wheel; `pip` **offline** (`-I --isolated --no-index --require-hashes --no-deps --only-binary :all:`) no staging | `tools.PYTHON_AUX_PATH`. **Nunca** o Python do sistema, o da Bridge (`tools.PYTHON_PATH`) ou o ResolvePython |
| Motion HTML/CSS (HyperFrames 0.8.114) | Node ≥ 22 + `hyperframes` | `npm ci` com `setup/npm/hyperframes/package-lock.json` (sha256 no lock; `integrity` sha512 por pacote), `--ignore-scripts`, cache/config isolados, registro oficial | `BOLD_HYPERFRAMES_NODE_MODULES` (lido pelo HyperFrames Core **sem modificação**; o Core apaga `HYPERFRAMES_BROWSER_PATH` de propósito) |
| Captura de frames (Chrome headless) | um `chrome-headless-shell` existente | **adiado**: sem download (o Chrome for Testing não publica sha256) | `tools.CHROME_HEADLESS_PATH` → `BOLD_HYPERFRAMES_CHROME` (só no processo; o BOLD não verifica esse binário) |
| Motion programático (Remotion 4.0.290) | aceite de licença + Node | `bold setup consent --component remotion --basis <base>`, depois `npm ci` com lockfile fixado | `tools.REMOTION_PROJECT_DIR`. O Chrome do Remotion segue adiado, então o detect relata "chrome-headless-shell não encontrado" |
| STT (whisper.cpp) | `whisper-cli` | macOS: **só detecção** · Windows x64: zip oficial (EXPERIMENTAL, layout a confirmar) | `tools.WHISPER_CLI` |
| Modelos Whisper | `whisper-model-base` · `-small` · `-medium` (**avançado**) | arquivo `.bin` fixado por **commit** do Hugging Face (sha256 = `lfs.oid`) | `tools.WHISPER_MODEL` (o ativado por último; a escolha do usuário vence) |

**Licença do Remotion:**
- o BOLD **não concede** licença;
- o aceite registra a base declarada (`individual`, `small-company`, `nonprofit`, `evaluation`, `company-license`), a data e o hash do texto mostrado;
- **a licença da Bold não cobre terceiros**;
- se o texto mudar, o aceite antigo deixa de valer;
- sem aceite: `LICENSE_REQUIRED`, e nada é baixado nem criado.

**Trava offline:** com `BOLD_SETUP_OFFLINE=1`, o `npm ci` real também é recusado.

**Redirects para CDN regional desconhecido (política R12.4):**
- só os hosts **verificados e listados no lock** são aceitos, por exemplo `huggingface.co` → `us.aws.cdn.hf.co`;
- **não há** allowlist por curinga (`*.hf.co` foi recusado).

Se o servidor redirecionar para outro host:
- o download falha com `UNKNOWN_REDIRECT_HOST`, **antes** de qualquer conexão ao host novo;
- o erro informa origem, destino e hosts permitidos;
- nada é gravado nem ativado.

O que fazer:
1. o mantenedor verifica o host e regenera o lock (`setup/lock-gen-optional.mjs`);
2. o novo host entra em `hosts` só depois do GATE.

Em todos os casos continuam valendo: HTTPS, tamanho exato e SHA-256 fixado.

## HyperFrames gerenciado: integridade reproduzível (R12.5C3)
O HyperFrames 0.8.114 gerenciado só é **instalável no macOS arm64**. A aprovação fica no lock, em `components.hyperframes.platforms.darwin-arm64`, e tem duas partes.

### 1. `codesign.policy: NPM_NATIVE_PINNED`
É o conjunto **exato** de binários nativos (Mach-O) que o `npm ci` produz. Cada um tem caminho, pacote, versão, sha256 e CDHash, medidos em GATE:

| Binário | Pacote |
|---|---|
| `esbuild` | `@esbuild/darwin-arm64` |
| `sharp-darwin-arm64-0.35.5.node` | `@img/sharp-darwin-arm64` |
| `libvips-cpp.8.18.7.dylib` | `@img/sharp-libvips-darwin-arm64` |

- A aprovação é vinculada ao `package-lock.json` aprovado (`lockfile_sha256`).
- Só vale para `hyperframes/darwin-arm64` (allowlist no código).
- **Não** existe aceitação automática de binário ad-hoc.

### 2. `npm.installed_tree_sha256`
É o hash da **árvore instalada inteira**: `package.json` + `package-lock.json` + `node_modules/`.
- O valor fixado (`18d60a7e…`) foi medido em **duas instalações independentes** e idênticas.
- O hash cobre caminho, sha256 e bit de execução de cada arquivo, e o alvo de cada symlink, em ordem determinística. Não há exclusões.
- mtime, dono e os demais bits de permissão não entram.
- O campo só é aceito junto com `NPM_NATIVE_PINNED`.
- **Sem ele, o HyperFrames não é instalável** (`INSTALLED_TREE_UNMEASURED`).

### Instalação (`bold setup apply --components hyperframes`)
A ordem é fixa, e nada é executado nem ativado antes do fim:
1. `npm ci --ignore-scripts --omit=dev`, com cache e configuração isolados, só do registro oficial;
2. cada pacote na versão exata do lockfile, sem pacotes extras;
3. inventário dos nativos contra o lock. Qualquer nativo ausente, extra, trocado, com outra versão, sha256 ou CDHash, ou sem assinatura válida → recusa (`CODESIGN_*`);
4. **hash da árvore contra o lock**. Divergência → `INTEGRITY_FAIL`: nada é ativado e o staging é removido;
5. teste leve:
   - só com o **Node gerenciado verificado** (Developer ID, Team ID do lock);
   - sob `sandbox-exec` deny-default, com autoverificação;
   - sem fallback para execução sem isolamento;
6. ativação.

A árvore é gravada pelo npm do Node gerenciado. Com outro npm (por exemplo, sem o Node gerenciado, caindo no npm do PATH), a árvore pode diferir, e então a instalação falha com `INTEGRITY_FAIL`. Por isso, instale antes o Node gerenciado (`--components node`).

Versão já instalada com árvore diferente da aprovada → `INTEGRITY_FAIL`. Não há reinstalação silenciosa: desinstale e reinstale.

### Antes de cada operação gerenciada (lint, snapshot, render, página)
O portão do BOLD refaz tudo **imediatamente antes** da operação. O HyperFrames Core não é modificado: ele recebe o `det` verificado.
- **Ativo × recibo:** a versão ativa precisa estar no recibo, e o hash da árvore recalculado precisa bater com o recibo.
- **Nativos:** os registros de assinatura batem com o lock, e os nativos são reconferidos.
- **Versão:** a versão ativa precisa ser a do lock.
- **Árvore:** a árvore precisa bater com o `installed_tree_sha256` **do lock**. Recibo e `active.json` forjados junto com a árvore **não** bastam.

Qualquer divergência → `HF_MANAGED_INTEGRITY`, e nada é executado. Um HyperFrames **não gerenciado** (cache do npx, caminho do usuário) não é tocado por esse portão.

### `bold setup verify` e `doctor --module toolchain`
Os dois comparam a árvore também com o lock oficial. Divergência → `LOCK_TREE_MISMATCH` (verify FAIL; doctor: integridade FAIL). Nada é apagado.

### Invalidação (nunca há fallback para política mais branda)
- **Na leitura do lock:**
  - `package-lock.json` diferente do aprovado, ou versão de um pacote nativo fora do lockfile → `CODESIGN_INVALIDATED`, não instalável;
  - sem o hash da árvore → `INSTALLED_TREE_UNMEASURED`.
- **No gerador do lock** (`lock-gen`, `lock-gen-optional`):
  - a política dos nativos só é herdada com `package-lock.json` e `package.json` idênticos;
  - o hash da árvore só é herdado se, **além disso**, a política dos nativos foi preservada e o artefato do Node do lock nessa plataforma não mudou (é o npm desse Node que grava a árvore);
  - senão, o hash é descartado e marcado `RESET`. Gravar o lock exige reconhecimento explícito (`--reset-verification`), ou seja, nova medição (duas instalações) e novo GATE.

### Limitações atuais
- **macOS Intel:** nativos não medidos (`PENDING`, não instalável).
- **Windows x64:** o HyperFrames gerenciado **não é ativado**. O lockfile está fixado, mas o teste leve exige o isolamento do SO, e não há equivalente ao `sandbox-exec`. Hoje a recusa (`SANDBOX_UNAVAILABLE`) acontece **depois** do `npm ci`: os pacotes são baixados e o staging é removido. Linux não é plataforma gerenciada.
- **Chrome** (`chrome-headless-shell`): não é gerenciado. O render e a página usam um Chrome **fornecido pelo usuário** (`tools.CHROME_HEADLESS_PATH`). Lint e validação não precisam dele.
- **Isolamento:** o lint e o render reais rodam com o net-guard do Core e os portões acima, mas **sem** o sandbox do SO (que hoje cobre só o teste leve).

## Validação do ResolvePython (R12.2)
A suíte da Bridge passou **27/27 no ResolvePython 3.14.4** (Resolve 21.1), só contra o **Resolve simulado**. `RESOLVE_SCRIPT_API` apontava para um diretório vazio e nenhum módulo do Resolve foi carregado. O teste é opt-in: `BOLD_TEST_RESOLVEPYTHON=1`, em `tests/davinci/resolvepython.test.mjs`.

**A Bridge ainda não usa o ResolvePython.** Isso só muda com sua decisão.

## Integridade, falhas e rollback
- **Instalação:**
  1. a cópia vai para `.staging/`;
  2. o **hash da árvore** é conferido antes de ativar;
  3. conferem-se os binários e um teste leve;
  4. rename atômico;
  5. `active.json` é gravado **por último**.
- **Falhas:**
  - qualquer falha remove **só** o que a própria execução criou;
  - destino existente com outro conteúdo → `CONFLICT` (nunca sobrescreve);
  - artefato com symlink ou arquivo especial → `UNSAFE_ARTIFACT`;
  - processo interrompido (ex.: fechado no meio do download): fica um lock órfão. A próxima execução recusa com `STALE_LOCK` e informa o caminho; confira que nenhum `bold setup` está rodando e remova o `.lock` manualmente. Depois disso, o `.part` incompleto é descartado e o download recomeça do zero, com sha256 e tamanho conferidos de novo.
- **Rollback:** troca o ponteiro para a versão anterior depois de recalcular o hash dela; anterior adulterada → `PREVIOUS_MODIFIED`.
- **Verify:** relata `MODIFIED`, `MISSING`, `SIGNATURE_FAIL`, `LOCK_TREE_MISMATCH` (árvore ≠ hash aprovado no lock) e diretórios não rastreados, **sem apagar nada**.
- **Logs:** JSONL sem segredos.
  - Chaves sensíveis, tokens conhecidos, credenciais e query string de URL são redigidos.
  - HOME aparece como `~`.
  - O ambiente nunca é gravado.

## Fases
| Fase | Escopo |
|---|---|
| R12.1 | núcleo local ✔ |
| R12.2 | downloader seguro (servidor local), extração TAR.GZ/ZIP, `apply` com confirmação, uninstall, bootstrap com download verificado, doctor `toolchain` ✔ |
| R12.3 | lock real (Node 24.22.0, FFmpeg 9.0.2 composto), gerador de lock, trava offline, sem criar a pasta do toolchain antes de confirmar ✔ |
| R12.4 | opcionais: Python auxiliar + Pillow, HyperFrames e Remotion (npm com lockfile), whisper.cpp Windows, modelos base/small/medium, aceite de licença, Chrome só configurável ✔ (lock aguardando GATE) |
| R12.3 | lock real a partir das fontes oficiais (com autorização) |
| R12.4 | opcionais |
| R12.5 | E2E real num HOME isolado e GATE de publicação. Feito: assinaturas de código (Developer ID / ad-hoc fixado), HyperFrames macOS arm64 com nativos e árvore fixados no lock (C3b/C3c), teste leve sob `sandbox-exec`. Pendente: GATE de publicação da v0.7.0 |
