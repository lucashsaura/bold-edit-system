# Asset Index

**Status: V1 TÉCNICA implementada (R8)** (`bold assets`, `bold.asset-index/1`). A camada **editorial** (conteúdo, pessoas, cobertura) continua documentada como conhecimento (§B).
O índice responde à pergunta "o que **realmente** existe no acervo?" sem depender da memória de quem filmou.

# A. Asset Index V1 (implementado, R8)

## A1. Arquitetura
```
bold assets scan <pasta>
  walk (ordem determinística; sem seguir symlink de diretório; ignora .git/.bold/.DS_Store/._*/ocultos)
   → classify (extensão → tipo + tags)          asset-index/src/classify.mjs
   → describe: cabeçalhos PNG/JPEG/GIF/WebP · fontes sfnt (TTF/OTF/TTC/WOFF) · ffprobe (vídeo/áudio/outras imagens)
   → fingerprint (meta · quick · sha256)        asset-index/src/scan.mjs
   → bold.asset-index/1 (cache derivado)       asset-index/src/store.mjs
consultas: search · duplicates · inspect          asset-index/src/query.mjs
DaVinci (opcional, LEITURA): Media Pool ↔ arquivo ↔ uso   core/context/link.mjs
```
**Somente leitura:**
- os arquivos são abertos só para leitura;
- nada é criado, movido, renomeado ou relinkado na pasta escaneada, e o mtime não é tocado;
- o índice **nunca** é gravado dentro da pasta escaneada (`INDEX_INSIDE_SCAN_ROOT`), exceto no `.bold/` do próprio projeto;
- o teste compara tamanho, mtime e sha256 de toda a árvore antes e depois do scan.

## A2. Tipos e metadados

| Tipo | Extensões (exemplos) | Metadados |
|---|---|---|
| `VIDEO` | mov mp4 mxf mkv webm mts braw r3d… | ffprobe: codec, profile, pix_fmt, largura/altura, **rotação → orientação de exibição**, fps **exato** (`60000/1001`) + `fps_float` + `avg_fps` + `vfr_suspected`, alpha (pix_fmt), bit depth, cor, timecode, duração, áudio |
| `AUDIO` | wav aif mp3 m4a flac… (e `.mp4` sem vídeo → tag `audio_only_container`) | sample rate, canais, layout, codec, duração |
| `IMAGE` | png jpg gif webp (cabeçalho) · tif heic psd exr… (ffprobe) | largura/altura, alpha (`png_color_type`, `png_trns`, `webp_vp8x`…, ou pix_fmt) |
| `VECTOR` | svg ai eps | **não interpretado na V1** (só arquivo) |
| `DOCUMENT` | pdf txt md docx srt vtt json drp aep fcpxml… (tags `subtitle`, `project_file`, `edit_list`, `data`) | só arquivo |
| `FONT` | ttf otf ttc woff (woff2: `UNSUPPORTED_WOFF2`) | family, style, full/postscript name, weight (OS/2), itálico; todas as faces de TTC |
| `MOTION_MASTER` | vídeo **com** `<nome>.delivery.json` do BOLD Delivery ao lado | perfil, frames, fps, alpha mode; `verified` = sha256 do arquivo == `output_sha256` (null se o hash não foi calculado) |
| `UNKNOWN` | demais | só arquivo |

Comuns a todos:
- `path` (NFC), `rel_path`, `name`, `ext`, `size`, `mtime`;
- datas: mtime e birthtime do FS, `creation_time` do container, com a origem;
- `tags`, `probe.status` (`OK`/`PARTIAL`/`FAILED`/`UNAVAILABLE`/`SKIPPED`/`NOT_APPLICABLE`);
- `sources` (de onde veio cada dado).

Metadado ausente = `null`, **nunca inventado**. Sem ffprobe, vídeo e áudio ficam com `probe UNAVAILABLE`; tipo, tamanho, datas, imagens raster comuns e fontes continuam.

## A3. Identidade por caminho
**Nome de arquivo não é identidade** (R7, L-02).
- A identidade operacional é o **caminho canônico NFC relativo à raiz**: `id = sha256(rel_path NFC)[:16]`.
- `clip.mov` em `cam_a/` e em `cam_b/` são dois assets.
- `duplicates` reporta esses casos em `same_name`, com `content_equal`.
- Busca e `context query usage` **por nome** devolvem **todos** os homônimos, com `ambiguous: true`, e nunca escolhem um.
- Nome em NFD é indexado em NFC e encontrado pela forma NFC.
- Em FS sensível à forma, onde NFC e NFD podem coexistir, os dois ficam e recebem `identity_collision: true`. Nunca são fundidos.

## A4. Hashing
| Nível | Como | Quando |
|---|---|---|
| `meta` | sha1(tamanho:mtime_ms:inode) | sempre (sem ler conteúdo) |
| `quick` | sha256(tamanho ‖ 64 KiB iniciais ‖ 64 KiB finais) | `--hash auto` (padrão) e `full` |
| `sha256` | completo | `auto`: só arquivos ≤ 1 MiB · `full`: todos · `duplicates --verify`: só os **candidatos** |

- `--hash none` não lê conteúdo nenhum.
- Igualdade de `quick` é **CANDIDATE**, não prova. **CONFIRMED** exige sha256.
- Um scan em `auto` lê no máximo 128 KiB por arquivo grande. Centenas de GB não são lidos por inteiro.

## A5. Cache e incremental
- O índice é **cache derivado**, descartável e reconstruível. Nunca é fonte única da verdade.
- Local: `<PROJECT_ROOT>/.bold/index/assets.<chave>.json` (se a raiz está no projeto) ou `<CACHE_DIR>/asset-index/<chave>.json`. Gravação atômica.
- **Rescan:** reaproveita o registro se `rel_path` + tamanho + `mtime_ms` + inode são iguais. Senão, relê. O relatório traz `changes: {added, changed, removed}`.
- O cache é descartado (reconstrução completa) se:
  - o schema, a versão do classificador ou a política de hash forem diferentes;
  - a raiz for outra;
  - o arquivo estiver inválido.
- Um registro com `probe UNAVAILABLE` é re-sondado quando o ffprobe passa a existir.

## A6. CLI
```
bold assets scan <pasta> [--index f] [--hash auto|none|full] [--no-probe] [--include-hidden] [--concurrency N]
bold assets inspect <arquivo> [--index f]
bold assets search [texto] --root <pasta> | --index f [--type video,image…] [--orientation vertical] [--alpha true]
                   [--fps 59.94] [--ext mov,mp4] [--tag t] [--codec c] [--min-duration s] [--max-duration s] [--limit N]
bold assets duplicates --root <pasta> | --index f [--verify]
bold assets davinci --root <pasta> | --index f [--timeline T | --all-timelines]
```
- `--json` dá saída estável.
- `--fps 59.94` casa com `60000/1001` (tolerância 0,01).
- `davinci` é **somente leitura**. Com o Resolve fechado, responde `available:false`, e o índice de filesystem continua valendo.

## A7. Limitações (V1)
- Sem leitura de conteúdo de vetor ou documento.
- WOFF2 não é lido.
- Sem thumbnails.
- Sem conteúdo visual: descrição, pessoas e plano são a camada editorial (§B).
- Probe sequencial por arquivo, com N em paralelo (`--concurrency`, padrão 4).
- Arquivos camera-raw (`braw`, `r3d`) dependem do suporte do ffprobe instalado.

# B. Camada editorial (conhecimento validado; não implementada na V1)

## Regra permanente
**RULE:** um plano não pode ser afirmado como existente enquanto não estiver `CONFIRMED`.
**RATIONALE:** descrições inferidas por bloco ou pasta já se mostraram erradas (rótulo de seção trocado, banner em outro clip).
**PROCEDURE:** confirme por frame verificado antes de usar. Nunca substitua um clip por nome de arquivo ou pasta.

## Estrutura (por projeto, nunca na Skill)
```
<PROJECT_ROOT>/index/
  clips.jsonl          um registro por clipe canônico (JSONL: streaming, append, diffs legíveis)
  segments.jsonl       trechos IN/OUT dentro dos clipes
  vocabulary.json      vocabulário controlado + sinônimos DO PROJETO
  coverage.json        matriz (unidade/assunto × tipo de material)
  missing_assets.json  o que falta, classificado
  index_stats.json
```

## Clip schema (campos)
| Grupo | Campos |
|---|---|
| Identidade | `project_id`, `clip_id`, `filename`, `source_path`, `canonical_source`, `media_pool_bin` |
| Técnico | `duration`, `resolution`, `fps`, `camera`, `codec`, `pix_fmt`, `bytes`, `recorded_at` |
| Lugar | `location`, `unit`, `environment` |
| Pessoas | `people_present`, `people_count_estimate`, `people_roles` |
| Câmera | `shot_size`, `shot_type`, `camera_movement`, `camera_angle` |
| Conteúdo | `visual_description`, `primary_action`, `secondary_actions`, `objects`, `signage`, `products`, `services`, `topics` |
| Fala | `speech_present`, `speech_subject`, `transcript_available` |
| Editorial | `editorial_usability`, `editorial_roles`, `visual_quality`, `stability`, `focus`, `exposure_notes`, `start_useful`, `end_useful` |
| Rastreabilidade | `tags`, `evidence[]`, `confidence`, `review_status`, `same_subject_group`, `multicam`, `notes` |

**Duplicatas:** quando um arquivo existe em duas pastas, guarde um **canônico** (`canonical_source`) e verifique por hash. Nunca apague a duplicata.

## Segment schema
`segment_id`, `clip_id`, `in`, `out`, `granularity` (`speech` · `sampled` · `whole_clip`), `description`, `text` (se houver fala), `asr_confidence`, `confidence`, `evidence[]`.

## Confidence
| Valor | Significado |
|---|---|
| `CONFIRMED` | Observação atribuída a **este** clipe, com frame verificado |
| `INFERRED` | Observação do **bloco** ou pasta. Plausível, não verificada individualmente |
| `MISSING` | A auditoria indica ausência |
| `NEEDS_REVIEW` | Cobertura insuficiente para afirmar presença ou ausência |

- `review_status` vale `auto_reused`, `auto_inferred`, `human_verified` ou `needs_review`.
- `evidence[].type` vale `frame`, `contact_sheet`, `transcript`, `technical_metadata`, `audio_analysis`, `folder_structure` ou `human_verification`.

## Vocabulary e synonyms
- **SEMPRE por projeto** (`vocabulary.json`). **Nunca embutido no engine.**
- Novos termos entram no vocabulário **antes** de aparecer nos registros.
- Sinônimos: mapa `termo → [variantes]`, inclusive a forma sem acento.

## Coverage
- `coverage.json` cruza assunto/unidade × tipo de material com **quatro estados** (`confirmed`, `partial`, `missing`, `needs_review`) e lista os clipes que sustentam cada célula. Nunca booleano.
- `missing_assets.json` usa as classes `CONFIRMED_MISSING`, `NOT_FOUND_YET`, `NEEDS_CLIENT_ASSET`, `CREATABLE`, `POTENTIAL_RECAPTURE`. `POTENTIAL_RECAPTURE` **não** vira pedido ao cliente automaticamente.

## Search
- **Somente leitura.** A busca editorial não conversa com o Resolve. A relação técnica com o Resolve, em leitura, é a do §A6 (`bold assets davinci`).
- Scoring lexical por campo, com pesos e sinônimos do projeto.
- `CONFIRMED` recebe bônus, `INFERRED` recebe desconto, e a usabilidade editorial modula o score.
- Filtro `--min-confidence`. Saída `--json`.
- Há um gancho para embeddings no futuro, sem reescrever a ferramenta.

## Fail conditions
- Vocabulário de projeto dentro do código.
- Clip usado como "existente" sem `CONFIRMED`.
- Substituição feita por nome ou pasta.
- Dados do índice versionados dentro da Skill.
