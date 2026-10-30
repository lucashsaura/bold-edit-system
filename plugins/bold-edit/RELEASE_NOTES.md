# Notas de versão — BOLD Edit System

## 0.8.0-beta.1 (beta pública) — 2026-10-28

Primeira versão **pública** (marketplace `bold-edit-system`, repositório `lucashsaura/bold-edit-system`). Código funcional igual
ao da 0.8.0-rc.1 validada na R13; mudam só versão, documentação de instalação pública e a licença (`LICENSE`: proprietária,
uso gratuito para teste, sem revenda nem redistribuição).

**Pendente de verificação:** Ainda **não verificado em sessão real**: o acionamento automático do sound design pela Skill quando o pedido não cita as ferramentas de áudio. Os comandos de áudio (`bold audio …`) foram testados de ponta a ponta; esse roteamento automático será validado durante a beta. Se o áudio não entrar sozinho, peça explicitamente ("inclua o sound design").

**Limitações conhecidas (beta):** ferramentas gerenciadas validadas só no macOS Apple Silicon · Earshot e modelos são
opcionais · Openverse depende da API pública · DaVinci: cues de áudio inseridos manualmente · Remotion: entrega com áudio
via `bold audio mux` · armazenamento externo precisa estar conectado e montado · versão beta, pode apresentar problemas.

### Conteúdo herdado da 0.8.0-rc.1

Sound design integrado à Skill `/bold-edit:edit` (R13). Não é uma Skill separada.
- **`bold audio …`**:
  - eventos do `motion.spec` e do plano editorial → plano de som com densidade por estilo (minimal, institutional, motion, cinematic);
  - seleção explicável no SFX Kit pelos metadados reais;
  - sincronia pela regra do kit (início = momento − `sync.at` ÷ rate), por amostra (pad sub-frame);
  - mix com narração, música (ducking) e SFX: EBU R128, true peak ≤ −1 dBTP;
  - sincronia medida no sinal;
  - exports Remotion (TSX) e DaVinci (cue list com TC e lanes);
  - prévia com áudio, protegida (`preview-video`).
- **SFX Kit 1.0.0** (CC0): biblioteca compartilhada fora do plugin, com instalação guiada (`bold audio library install --yes`, sha256 fixado). Não é redistribuído.
- **Openverse**: fallback online com licença e fonte verificadas antes do download, só para `<projeto>/sons/`, com `creditos.txt`. BY-SA, NC e ND são bloqueados para uso comercial.
- **Earshot 0.4.0** (MIT, opcional):
  - análise e geração procedural, offline e sem chaves;
  - `earshot llm` nunca é usado;
  - instalação guiada, com venv isolado e lock com hashes.
- `bold doctor --module audio`; Setup Manager: `sfx-kit` e `earshot` (detecção + guia); config `tools.SFX_KIT_DIR` / `tools.EARSHOT_DIR`.
- **Achado:** o AAC do render h264 do Remotion 4.0.290 sai ~2048 amostras (~43 ms) atrasado (sem edit list). A prévia final usa o mix do BOLD via `bold audio mux` (0 amostra de erro).
- **Armazenamento externo (SSD)** (`bold audio storage status|candidates|set|attach|clear`):
  - SFX Kit, Earshot (repo + venv), modelos, caches e temporários num volume escolhido;
  - registro próprio `audio-storage.json`, fora do `bold.config.json` (instalações anteriores não quebram), e marca `.bold-storage.json` no volume;
  - exFAT/FAT/NTFS direto é recusado, com a sugestão de uma imagem APFS esparsa no SSD;
  - com o SSD ausente, o BOLD diz o que ficou indisponível e como recuperar, e nunca reinstala no disco interno (`STORAGE_OFFLINE` no `library install` e no `bold setup plan`);
  - recuperação com `attach --yes` (monta a imagem).
- **MCP do Earshot** documentado com a mesma política do processo filho: offline, sem telemetria e com chaves vazias (`llm_critique` nunca recebe chave herdada).
- **DaVinci**: procedimento de inserção manual documentado e validado (WAV 24 bit/48 kHz, TC ida e volta, pad < 1 frame em 23,976 a 59,94 DF). A Bridge continua sem inserir áudio.

## 0.7.0 (estável, distribuição privada) — 2026-10-18

Promoção do `0.7.0-rc.1` sem mudança funcional. O RC foi validado de ponta a ponta num ambiente isolado: bootstrap sem Node e os 4 componentes gerenciados instalados e verificados (Node, FFmpeg, Python/Pillow e HyperFrames, com o hash da árvore igual ao lock), doctor e verify sem FAIL e lint real sem rede.

Primeira versão com o **Setup Manager** completo para **macOS Apple Silicon**: o BOLD instala, verifica e remove as próprias ferramentas, num toolchain isolado e sem tocar no sistema.

### Plataformas
| Plataforma | Status |
|---|---|
| macOS arm64 (Apple Silicon) | **SUPPORTED** (validado em macOS 26.5) |
| macOS x64 (Intel) | CLI funciona com Node próprio. Setup Manager: Node, Pillow e HyperFrames aguardam medição de assinatura (não instaláveis); FFmpeg só detecção; só os modelos Whisper são instaláveis |
| Windows x64 | **EXPERIMENTAL** (Node, FFmpeg BtbN, Pillow, whisper-cli e modelos fixados; Remotion com aceite de licença; HyperFrames gerenciado não é ativado) |
| Linux | não gerenciado (DEVELOPMENT_ONLY) |

### Requisitos
- **Sem Node instalado:** rode `sh bootstrap/bootstrap.sh`. Ele baixa só o Node 24.22.0 fixado no lock, com confirmação.
- **Com Node próprio:** Node ≥ 20 para a CLI. O HyperFrames gerenciado exige o **Node gerenciado** (24.22.0).
- **Espaço livre:** o `doctor` exige **≥ 15 GiB** (FAIL abaixo) e recomenda ≥ 50 GiB para renders longos.
- **Rede:** só na instalação de componentes, e só para os hosts fixados no lock.

### Novo nesta versão
- **Setup Manager** (`bold setup …`): plano somente leitura, `apply` só com `--components` e confirmação, `verify`, `status`, `rollback`, `uninstall` e `doctor --module toolchain`.
- **Componentes gerenciados (macOS arm64)**, todos baixados do upstream oficial na máquina do usuário e nunca redistribuídos:

  | Componente | Origem | Verificação |
  |---|---|---|
  | Node.js 24.22.0 | nodejs.org | sha256 + Developer ID (Team HX7739G8FX), hardened runtime |
  | FFmpeg + ffprobe 9.0.2 | Martin Riedl, GPL-3.0-or-later | sha256 de cada parte + Developer ID (Team KU3N25YGLU) |
  | Python auxiliar 3.12.15 + Pillow 12.3.0 | python-build-standalone + PyPI | sha256; `pip` offline com `--require-hashes`; 37 binários ad-hoc fixados por CDHash |
  | HyperFrames 0.8.114 | registro npm oficial | `npm ci --ignore-scripts` com lockfile fixado; 3 binários nativos fixados (sha256 + CDHash); **hash da árvore instalada inteira fixado no lock**, medido em duas instalações independentes |

- **Integridade:**
  - staging, hash de árvore e assinatura **antes** de qualquer execução ou ativação;
  - teste leve do HyperFrames só com o Node gerenciado verificado, sob `sandbox-exec` deny-default com autoverificação, sem fallback;
  - portão de integridade antes de **cada** lint, snapshot, render ou página do HyperFrames gerenciado;
  - `verify` e `doctor` comparam a árvore com o lock (`LOCK_TREE_MISMATCH`).
- **Confiança:** a CLI de produção usa **sempre** o lock oficial do pacote. Variáveis de ambiente de teste herdadas são ignoradas.
- **Licenças:** Remotion só com aceite explícito (`bold setup consent`); a licença da Bold não cobre terceiros.

### Disponível (inalterado desde a 0.6)
CLI `bold`:
- `doctor`, `config`, `audit-leaks`;
- `probe`, `qc` e `delivery` (encode BT.709 controlado);
- `render` (Remotion ou HyperFrames → frames PNG → delivery), sempre com autorização explícita;
- `motion validate|compile|inspect`;
- DaVinci Bridge V1 (leitura + escritas protegidas);
- `transcript`, `assets`, `context`;
- `editorial` / Motion Router (planos para revisão humana, sem execução).

Skill `/bold-edit` (local) ou plugin `/bold-edit:edit` (marketplace interno, anterior à distribuição pública).

### Limitações conhecidas
- **Chrome headless** não é baixado nem gerenciado. Render e página do HyperFrames usam um Chrome **fornecido pelo usuário** (`tools.CHROME_HEADLESS_PATH`). Lint e validação funcionam sem Chrome.
- O lint e o render reais do HyperFrames rodam com o net-guard do Core e os portões de integridade, mas **sem** o sandbox do SO (que hoje cobre o teste leve).
- **HyperFrames gerenciado:**
  - só no macOS arm64;
  - no Windows, o `npm ci` baixa os pacotes e a instalação é recusada no teste leve (`SANDBOX_UNAVAILABLE`), sem ativar nada;
  - instalar com um npm diferente do Node gerenciado gera `INTEGRITY_FAIL` (o hash da árvore depende do npm).
- **Remotion** (licença) e **whisper.cpp no macOS** (sem binário oficial) não são instalados automaticamente; os modelos Whisper são opcionais.
- `rollback` entre duas versões reais do mesmo componente: coberto por testes sintéticos; o lock atual só tem uma versão por componente.
- **Quem testou o `0.7.0-rc.1`:** o installer local compara só `MAJOR.MINOR.PATCH` e trata `0.7.0-rc.1` e `0.7.0` como a mesma versão no aviso de downgrade. O plugin do marketplace atualiza normalmente, porque a versão no `plugin.json` muda.
- O `sandbox-exec` do macOS é marcado como obsoleto pela Apple, mas continua funcional. Ele é a base do isolamento do teste leve.

### Segurança
Nada é instalado sem pedido explícito. Nenhum download fora dos hosts do lock (o downloader recusa redirect para host desconhecido). Arquivos modificados nunca são apagados automaticamente. O DaVinci Resolve nunca é instalado, aberto nem alterado pelo setup. Telemetria desligada.
