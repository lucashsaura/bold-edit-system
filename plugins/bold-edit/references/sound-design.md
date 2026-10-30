# Sound design no BOLD (R13)

O som faz parte da Skill `/bold-edit:edit`; não é uma Skill separada. Sempre que houver motion, cortes ou transições, o BOLD
propõe os efeitos junto, pela CLI `bold audio …`. O usuário não precisa citar as ferramentas.

## Componentes

| Componente | Papel | Onde fica | Licença | Obrigatório? |
|---|---|---|---|---|
| **SFX Kit** 1.0.0 (wyzowl/sfx-kit) | biblioteca local: 320 WAV 48 kHz/24 bit, 28 categorias, metadados de sincronia e loudness | `<dados do BOLD>/libraries/sfx-kit-<versão>` | CC0-1.0 (sem crédito público; origem registrada) | não, mas é a fonte principal |
| **Openverse** | fallback online (API pública) quando o kit não tem um bom candidato | download só para `<projeto>/sons/` | por item (verificada antes) | não |
| **Earshot** 0.4.0 (Leonxlnx/earshot) | análise (describe, match, measure, timeline, critique) e geração procedural (252 receitas) | `<dados do BOLD>/tools/earshot` (venv isolado) + `tools/earshot-home` (modelos) | MIT · modelos CLAP Apache-2.0, AST BSD-3-Clause | não |
| ffmpeg | conform, mix, EBU R128, true peak, mux | toolchain do BOLD | conforme o build | sim (para mixar) |

`<dados do BOLD>` = `~/Library/Application Support/bold` (macOS), `%LOCALAPPDATA%\bold` (Windows), `~/.local/share/bold` (Linux).
Outros lugares: `tools.SFX_KIT_DIR` e `tools.EARSHOT_DIR` na config, ou `BOLD_SFX_KIT_DIR` / `BOLD_EARSHOT_DIR`.

## Fluxo

1. **Briefing → estilo**:
   - `minimal`: poucos efeitos, suaves; só momentos de importância alta.
   - `institutional`: a narração clara manda; nada que "cubra a voz".
   - `motion`: UI, movimentos, impactos e transições.
   - `cinematic`: impactos, transições, risers e graves.
2. **Estrutura visual → eventos** (`bold audio events`):
   - fontes: o `motion.spec` (camadas, `in/out`, durações dos tokens, ease, câmera), o plano editorial (`SFX_CUE`, `TRANSITION_SUPPORT`, decisões visuais) ou uma lista de cues;
   - cada evento tem tipo, instante, duração e importância.
3. **Narração e música**:
   - os trechos de fala vêm da transcrição (`--transcript`) ou da própria narração (`--voice`, via silencedetect);
   - eles controlam o ducking dos SFX e a escolha dos sons.
4. **Plano de som** (`bold audio plan`):
   - a densidade por estilo aplica importância mínima, espaçamento e teto por 10 s;
   - os descartados ficam listados com o motivo.
5. **Seleção** no SFX Kit, pelos campos reais do `sounds.json`:
   - categoria, `use_for`/`avoid_for`, `tags`, `description`;
   - `sync.meets`;
   - `fits_seconds`/`span_seconds` dentro de `adapt.rate`;
   - intensidade (`variant`, `level.tier`);
   - `avoid_for` "On top of speech" sob narração, `under_voiceover_db`.

   Cada ponto do score é explicado (`bold audio select`).
6. **Fallback**: o que o kit não cobre vai para `fallbacks`; daí `openverse search` → avaliação → `fetch` (com pedido) ou Earshot `render`.
7. **Sincronia**: a regra do kit é **início = momento − sync.at ÷ rate**:
   - o instante usado depende do tipo do som: o pico do movimento (whoosh), a chegada (riser), o primeiro frame da ação (contagem, digitação) ou o frame do contato (impacto, pop);
   - com mudança de rate, os tempos se dividem pelo rate;
   - se o início cair antes de 0, o som começa em 0 e o trecho é cortado do arquivo.
8. **Frames**: cada cue cai num frame inteiro, com um **pad de silêncio sub-frame** no próprio WAV. Assim a sincronia é por amostra também no Remotion (`<Sequence from>`) e no DaVinci (record TC). O fps vem do spec ou do plano e nunca é assumido; NTSC e drop-frame são suportados.
9. **Volumes**:
   - ganho do estilo (minimal −3 dB, institutional −2 dB);
   - `under_voiceover_db` onde o corpo do som cruza a fala;
   - −2 dB para eventos de importância baixa.
10. **Fades**: 15 ms num início cortado e 40 ms num fim cortado (o kit começa e termina em silêncio).
11. **Mix** (`bold audio render`):
    - narração com ganho linear até −16 LUFS, sem outro processamento;
    - música até −24 LUFS com narração (−18 sem), com fades e ducking por sidechain na narração;
    - SFX com os ganhos do plano;
    - ganho global até −16 LUFS integrado **sem passar de −1 dBTP**: o pico manda, e o limitador fica só como rede de segurança.
12. **Verificação**: LUFS, LRA e true peak medidos (ebur128). A sincronia é medida **no sinal**: a correlação do ataque de cada cue em ±10 ms dá o erro em amostras.
13. **Arquivos + créditos**:
    - `conformados/` (um WAV por cue), `sfx-stem.wav`, `mix.wav`, `render-report.json`;
    - `origens.jsonl` (interno);
    - `sons/creditos.txt` + `creditos.jsonl` para efeitos de terceiros.

## Destinos

- **Remotion**:
  - `bold audio export --remotion-tsx BoldSfx.tsx` gera `<Sequence from={frame}>` + `<Audio src={staticFile(…)}>` com volume 1, porque o ganho e os fades já estão no WAV;
  - copie a pasta `conformados/` para `public/sons/conformados/` do projeto Remotion;
  - o core congelado do BOLD não muda.
- **DaVinci**:
  - `--davinci-csv` gera lanes A1…An sem sobreposição, record TC (com `--tc-start`), duração em frames, ganho embutido, origem e licença;
  - importe os WAV no Media Pool e posicione pelo record TC, ou use o stem inteiro numa track vazia;
  - a Bridge V1 só insere em tracks de vídeo, então o BOLD **não** escreve áudio na timeline.
  - **Limitação atual (R13):** a Bridge prepara arquivos e cues com timecode, mas **não** insere os efeitos na timeline.
  - **Inserção manual** (sempre numa timeline sua; o BOLD não toca em timelines reais):
    1. Confira se o fps e o drop-frame da timeline são os do plano (`fps`/`drop_frame` em `plano-som.json` e no
       `.davinci.json`). Se forem diferentes, gere o plano de novo com `--fps` da timeline; nunca reposicione à mão.
    2. Gere o CSV com o **timecode inicial da timeline** (`--tc-start 01:00:00:00`, ou `01:00:00;00` em 29,97/59,94 DF).
    3. Importe `conformados/` no Media Pool (48 kHz, 24 bit).
    4. **Opção A, mais simples e exata por amostra:** coloque `sfx-stem.wav` numa track de áudio vazia, com início no
       `record_tc` do frame 0 (= `--tc-start`).
    5. **Opção B, editável:** para cada linha do CSV, crie a track `lane` (A1…An) se faltar e coloque `file` com o playhead
       em `record_tc`. Mantenha o volume do clipe em 0 dB, porque o ganho (`gain_baked_db`) e os fades já estão no arquivo.
       O silêncio de `pad` (menos de 1 frame) no início do WAV deixa a sincronia exata por amostra, mesmo com o clipe preso
       ao frame. Não apare o começo.
    6. `duration_frames` cobre o arquivo inteiro mais 1 frame de folga; não estique o clipe.
    7. Para conferir, exporte o áudio da timeline e rode `bold audio verify plano-som.json --audio export.wav --reference
       mix.wav`. O esperado é 0 amostras de diferença; se o export começar em outro ponto, a diferença aparece como lag.
  - **Validado (R13):** WAV PCM 24 bit/48 kHz; `record_tc` ↔ `record_frame` ida e volta; pad < 1 frame em 23,976 / 24 / 25 /
    29,97 DF / 30 / 50 / 59,94 DF.
- **Prévia**: `bold audio mux` junta vídeo e mix num arquivo **novo**:
  - `mov` = vídeo copiado + PCM;
  - `mp4` = H.264 + AAC;
  - é ação protegida (`preview-video`).

## Openverse

- **Busca**:
  - termos em inglês, `license_type=commercial`, paginação;
  - termos alternativos quando o resultado é vazio;
  - limite anônimo de 20/min e 200/dia: 429 vira `RATE_LIMITED` com o tempo de espera.
- **Avaliação antes de baixar**: título, autor, fonte, licença + versão (o `license_url` precisa ser creativecommons.org e conferir), página da obra, duração, formato e tamanho.
- **Uso comercial**:

  | Licença | Uso comercial |
  |---|---|
  | `cc0`, `pdm` | OK |
  | `by` | OK com crédito obrigatório |
  | `by-sa` | **bloqueado** (o ShareAlike alcançaria o vídeo sincronizado) |
  | `nc`, `nd`, desconhecida | bloqueado |
  | sem verificação | `UNVERIFIED`; nunca em entrega comercial (`--allow-unverified` só para prévia) |
- **Download**:
  - só do item aprovado, para `<projeto>/sons/` (exige `bold.project.json`), com `--yes`;
  - HTTPS + allowlist de hosts dos provedores, revalidada em cada redirect;
  - teto de 25 MB, tamanho conferido, ffprobe exige 1 stream de áudio, sha256 registrado;
  - nunca sobrescreve; nada é executado.
- **Freesound**: o anônimo recebe a prévia MP3 HQ (128 kbps). O WAV original exige login no site (OAuth); baixe pela página da obra se precisar.

## Earshot

- O BOLD usa: `describe`, `match`, `measure`, `timeline` (com `--cues`), `critique`, `sfx list/render`.
- **Nunca** usa `llm` / `--yes-upload` / consent (envia áudio ao Google) nem `doctor --fetch` por conta própria.
- **Processo filho**:
  - ambiente mínimo e offline (`EARSHOT_OFFLINE=1`, `HF_HUB_OFFLINE=1`);
  - sem telemetria;
  - sem `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`HF_TOKEN`;
  - caches dentro de `earshot-home`.
- **Modelos** (≈1,1 GB): CLAP `laion/larger_clap_general@16c8cc3` e AST `MIT/ast-finetuned-audioset@f826b80`, só safetensors e fixados por commit.
- **MCP**: só com aprovação do usuário, sem duplicar (`claude mcp get earshot` antes). Mesma política do processo
  filho: offline, sem telemetria, chaves **vazias** (assim o `llm_critique` nunca recebe uma chave herdada do ambiente):
  ```
  claude mcp add-json earshot --scope user '{"type":"stdio","command":"<earshot>/.venv/bin/python","args":["-m","earshot","mcp"],
    "env":{"EARSHOT_HOME":"<models>","HF_HOME":"<models>/hf-home","EARSHOT_OFFLINE":"1","HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1",
           "HF_HUB_DISABLE_TELEMETRY":"1","DO_NOT_TRACK":"1","EARSHOT_THREADS":"3","TMPDIR":"<temp>","PYTHONNOUSERSITE":"1",
           "PATH":"<dir do ffmpeg>:/usr/bin:/bin","GEMINI_API_KEY":"","GOOGLE_API_KEY":"","HF_TOKEN":""}}'
  ```
  `claude mcp get earshot` deve mostrar `Connected`. As ferramentas aparecem como `mcp__earshot__*` numa sessão nova.
  A Skill usa `describe`/`timeline`/`measure`/`sfx_list`/`sfx_render`; **nunca** `llm_critique`.
- **Limites (do próprio Earshot)**: não julga licença, procedência nem gosto. As licenças continuam sendo verificadas pelo BOLD.

## Armazenamento externo (SSD)

SFX Kit, Earshot (repo + venv), modelos, caches e temporários podem morar num SSD. O registro fica em
`<dados do BOLD>/audio-storage.json` (`bold.audio-storage/1`), separado do `bold.config.json` para não quebrar versões
anteriores, e o volume leva uma marca `.bold-storage.json` com o mesmo id.

Estrutura (raiz `…/audio/`): `sfx-kit/sfx-kit-<versão>/` (+ `.provenance.json`) · `earshot/` (repo + `.venv`) ·
`earshot-<versão>.provenance.json` · `.lock/` · `models/` (= `EARSHOT_HOME`: `hf/`, `emb/`, `decoded/`) · `cache/`
(`pip/`, `uv/`, `downloads/`) · `temp/` (`TMPDIR` do Earshot).

- **exFAT / FAT / NTFS direto: recusado.** Não há symlinks nem journaling, e com blocos de 128 KiB a 1 MiB a venv
  (~41 mil arquivos) ocuparia de 5 a 40 GB. Use uma **imagem APFS esparsa** no SSD (`bold audio storage candidates`
  mostra o comando `hdiutil create … -fs APFS`), monte-a e aponte para dentro dela.
- **Escolher:** `bold audio storage set <raiz> [--image <arquivo.sparsebundle>] --yes`. O comando só grava o registro e a marca;
  não move dados. Se o volume já tem marca, adota o mesmo id. O registro anterior vira `.bak`.
- **Migrar uma instalação interna:** copiar kit, repo, `earshot-home` → `models/`, `.lock/` e proveniências; conferir por
  sha256; **recriar a venv no destino** (ela grava caminhos absolutos) com o lock fixado e `PIP_CACHE_DIR=<raiz>/cache/pip`;
  depois rodar `earshot doctor` e `bold doctor --module audio`. Os originais só vão para a Lixeira depois de validar e com aprovação.
- **Estados:** `ONLINE` · `IMAGE_DETACHED` (SSD presente, imagem não montada → `bold audio storage attach --yes`) ·
  `DISCONNECTED` · `WRONG_VOLUME` (marca de outro id: nada é usado) · `INVALID`.
- **SSD fora:** ficam indisponíveis o SFX Kit, o Earshot, os modelos e o MCP. Continuam funcionando o Openverse, o
  render/mix/verify/measure/export/mux de planos prontos e os módulos que não são de áudio. Nada cai para o disco interno nem é
  reinstalado (`library install` e `bold setup plan` respondem `STORAGE_OFFLINE`).
- **Voltar ao interno:** `bold audio storage clear --yes` renomeia o registro para `.bak`; os dados no SSD ficam intactos.
- **MCP:** registre com o Python da venv **no SSD** e `EARSHOT_HOME` em `models/`. Com o SSD fora, o servidor aparece
  como falho no Claude Code até a reconexão; nada mais é afetado.

## Instalação guiada (sempre com pedido do usuário)

- **SFX Kit**:
  - `bold audio setup sfx-kit` → `bold audio library install --yes`;
  - release v1.0.0, sha256 `a6c5c665…`, 55 MB de download (~69 MB em disco);
  - extração segura do Setup Manager e verificação dos 320 sha256.
- **Earshot**:
  - `bold audio setup earshot` mostra os comandos: clone da tag v0.4.0, venv com Python ≥ 3.10 e `pip --require-hashes` com `audio/earshot-0.4.0.lock.txt`;
  - modelos via `earshot doctor --fetch`, só com aprovação.
- **Doctor**: `bold doctor --module audio` detecta tudo, sem rede e sem instalar.
