# Transcript Engine V1

**Status: V1 implementada (R8).** Formato canônico próprio (`bold.transcript/1`), independente de fornecedor.
O pipeline de STT com whisper.cpp (conhecimento validado) está em `transcript.md`. Este arquivo descreve a **ferramenta**.

**Fronteira R8 × R9:**
- R8 responde "o que está sendo falado, quando, e quais trechos são *candidatos* a algo".
- R8 **não** decide edição: nada de motion, corte, B-roll, backend ou remoção de frase. Isso é R9.

---

## 1. Arquitetura

```
INPUT / PROVIDER                         NORMALIZER                    CAMADAS DE LEITURA
SRT ───────────────┐
VTT ───────────────┤   transcript/src/parsers.mjs  ─→  normalize.mjs  ─→  bold.transcript/1
whisper.cpp -ojf ──┤   (cues intermediários,           (determinístico,     │
segments[] JSON ───┤    fail-closed)                    schema validado)    ├─ analyze.mjs → bold.transcript-annotations/1
DaVinci legendas ──┘                                                        ├─ search.mjs  → bold.transcript-search/1
 (bold davinci inspect, leitura)                                            └─ export      → SRT · VTT · TXT · MD · JSON (texto)
```
- `transcript/src/time.mjs`: fps racional, drop-frame SMPTE, relógios SRT/VTT em ms inteiros.
- `transcript/src/text.mjs`: normalização para busca (NFC → minúsculas → sem diacríticos) e tokenização com offsets.
- O texto original nunca é alterado.
- **Provider novo** = novo parser que devolve cues `{start, end, text, words[], speaker, confidence}`. O normalizador, o schema e as camadas de leitura não mudam.
- O whisper.cpp é detectado pelo doctor como provider **opcional**: a V1 normaliza a saída `-ojf` dele, mas não executa STT.
- Nada é instalado ou baixado. Nenhum modelo nem credencial é exigido.

## 2. Schema `bold.transcript/1`

Arquivo: `transcript/schema/bold.transcript.schema.json`. Campos principais:

| Campo | Significado |
|---|---|
| `source` | `format`, `name` (basename, nunca o caminho), `sha256` da entrada, `provider`, `davinci` (projeto, timeline, track) |
| `language` · `language_source` | da origem (`source`), do usuário (`user`) ou `null` |
| `duration` · `duration_source` | `last_segment_end` ou `timeline` (DaVinci) |
| `time_base` | `fps` (fração exata), `drop_frame`, `fps_source` (`source`/`user`/`null`), `origin_frame`/`origin_tc` (DaVinci), `frames` (`source`/`derived`/`null`) |
| `timing` | `unit: seconds`, `granularity` `WORD`/`SEGMENT`/`MIXED`, `word_timing_origin`, `confidence` `source`/`partial`/`none`, `speakers` `source`/`none` |
| `segments[]` | `id` (`s0001`…), `start`/`end` (s), `start_frame`/`end_frame` (se há fps), `tl_in_tc` (DaVinci), `text`, `speaker`, `confidence`, `granularity`, `words[]` |
| `words[]` | `start`, `end`, `text`, `confidence` (só da origem), `speaker?` |
| `warnings[]` | `REORDERED_BY_START`, `OVERLAP`, `EMPTY_CUE`, `INLINE_TIMESTAMPS_NOT_PER_WORD`, `WORD_OUTSIDE_SEGMENT`… |

**Determinístico:** a mesma entrada gera os mesmos bytes. Não há timestamp de geração no documento.

## 3. Entradas suportadas

| Formato | Detecção | O que vem da origem |
|---|---|---|
| SRT | linha de tempo `HH:MM:SS,mmm --> …` ou extensão `.srt` | tempos (ms) e texto. BOM, CRLF, `<i>`/`<b>`/`{\an8}` removidos; quebras de linha preservadas |
| VTT | `WEBVTT` na 1ª linha | tempos, `Language:`, voice tags `<v Nome>` → `speaker`, timestamps inline → palavras |
| whisper.cpp `-ojf` | `transcription[]` | segmentos (`offsets` ms), tokens → palavras (o espaço inicial abre palavra; a pontuação se junta à palavra anterior), `p` → confidence |
| segments[] JSON | `segments[]` (openai-whisper, faster-whisper, WhisperX) | `start`/`end`, `words[]` com `probability`/`score`/`confidence` ∈ [0,1], `speaker` |
| `bold.transcript/1` | `schema` | revalidado contra o schema |
| DaVinci (legendas) | JSON de `bold davinci inspect --timeline T --json`, ou `--davinci --timeline T` | track de legenda: texto do item, `tl_in`/`tl_out` em **frames da timeline**, `fps_exact`, drop-frame, start da timeline |

**Fail-closed (`TRANSCRIPT_MALFORMED`, com linha):**
- linha de tempo ausente ou inválida;
- fim ≤ início;
- VTT sem `WEBVTT`;
- JSON quebrado ou sem `start`/`end`.

**Formato desconhecido** → `TRANSCRIPT_FORMAT_UNSUPPORTED`. Texto puro sem timing **não** é aceito: não existe tempo honesto para ele.

## 4. Tempo

- **Internamente**, tudo é **segundos** (6 casas). As strings de timecode são só apresentação.
- **fps nunca é assumido.** Fontes possíveis:
  - **a origem:** o DaVinci informa o fps da timeline;
  - **o usuário:** `--fps`, marcado como `fps_source: user` e `frames: derived`.
  - SRT/VTT não têm fps, então o valor fica `null`.
- **fps racional:**

  | fps | Fração |
  |---|---|
  | 23.976 | `24000/1001` |
  | 29.97 | `30000/1001` |
  | 59.94 | `60000/1001` |
  | 24, 25, 30, 50 | `n/1` |

  `frames → s = frames × den / num`.
- **Drop-frame:** só existe em 29.97, 59.94 e 119.88, com separador `;`.
  - Exemplos: frame 1800 @ 29.97 DF = `00:01:00;02`; frame 3600 @ 59.94 DF = `00:01:00;04`.
  - TC DF inexistente → `TC_INVALID`. DF em 23.976 → `DF_INVALID`.
- **DaVinci:** `start_frame`/`end_frame` são frames **desde o início da timeline**. `tl_in_tc` é o TC real da timeline.
- **Transcrição ≠ timeline:** um SRT de um clip não está no tempo da timeline. A conversão por offset de clip fica para a R9, com A18 (`davinci-safety.md`).
- **Argumentos de tempo** (`--from`/`--to`) aceitam:
  - segundos (`12.5`);
  - relógio (`00:01:02.500`);
  - TC (`00:00:10:12`), este **só com `--fps`**.

## 5. Precisão honesta (granularidade, confidence, speakers)

| Situação | Resultado |
|---|---|
| Origem com tempo por palavra | `words[]` preenchido, `granularity: WORD`, `word_timing_origin` declarado (o whisper.cpp é marcado "aproximado; sem DTW") |
| VTT com timestamps por **trecho** (não por palavra) | `SEGMENT` + aviso `INLINE_TIMESTAMPS_NOT_PER_WORD` (não finge precisão) |
| Sem tempo por palavra | `words: []`, `granularity: SEGMENT` |
| Confidence | só se a origem fornece uma probabilidade em [0,1]. `avg_logprob` **não** vira confidence. Sem dado = `null` |
| Speaker | só de voice tags VTT ou de campos `speaker` do JSON. **Sem diarização falsa**: ausente = `null` |

## 6. Análise descritiva — `bold.transcript-annotations/1`

- Arquivos: `transcript/src/analyze.mjs` e `transcript/schema/bold.transcript-annotations.schema.json`.
- Cada anotação é um **candidato**: `type`, `segment_id`, `start`/`end`, `span_timing` (`word` quando o texto se alinha às palavras com tempo, senão `segment`), `evidence` (o trecho literal), `rule`, `confidence` (`high`/`medium`/`low`, que é da **regra**, não um número inventado).

| Tipo | Regra (V1, `rules_version: r8.1`) |
|---|---|
| `number` | dígitos (`value` numérico) · número por extenso (média) |
| `percentage` · `currency` · `date` | regex (`30%`, `por cento` · `R$ 249,90`, `reais`, `US$` · `15 de março`, `dd/mm`, `março de 2026`) |
| `product_mention` | vocabulário do projeto (alta) · código de modelo `X200` (baixa) |
| `offer_mention` · `cta_candidate` | léxicos genéricos pt/en (média). O CTA traz `position_ratio` |
| `proper_noun` | vocabulário (alta) · sigla 2–4 letras (baixa) · Capitalizada fora de início de frase (baixa) |
| `question` | `?` (alta) · interrogativo no início sem `?` (baixa) |
| `emphasis_candidate` | `!` (média) · intensificador ou CAIXA ALTA (baixa) |
| `repeated_phrase` | n-grama de 3–6 palavras em ≥ 2 segmentos (maximal; `group`, `occurrences`) |
| `topic_boundary` | pausa ≥ 2 s (média) · marcador discursivo no início (baixa) |
| `hook_candidate` | segmento que começa nos primeiros 5 s. Os `reasons` são as outras anotações do segmento |

**Vocabulário do projeto** (`--vocabulary`): `{"schema":"bold.vocabulary/1","products":[…],"proper_nouns":[…]}`.
- Ele vive **no projeto**, nunca na Skill.
- Nenhum termo de cliente está embutido no engine.

## 7. CLI

| Comando | Faz |
|---|---|
| `bold transcript inspect <arq> \| --davinci --timeline T [--track N]` | resumo: formato, segmentos, palavras, granularidade, fps, speakers, avisos |
| `bold transcript normalize <arq> [--output f] [--language xx] [--fps F]` | `bold.transcript/1` (stdout ou arquivo **novo**) |
| `bold transcript analyze <arq> [--vocabulary v] [--output f]` | anotações descritivas |
| `bold transcript search "<frase>" <arq…> [--from T --to T] [--speaker S] [--fps F]` | frase sem acento e sem caixa. `""` lista os segmentos da janela |
| `bold transcript export <arq> --format srt\|vtt\|txt\|md\|json [--output f]` | texto. **Nunca vídeo**. O MD marca confiança < 0,6 |

- `--json` dá saída estável.
- Saídas em arquivo **nunca sobrescrevem** (`OUTPUT_EXISTS`, exit 3).
- Exit codes:

  | Exit | Situação |
  |---|---|
  | 0 | OK |
  | 1 | entrada inválida |
  | 3 | saída existente |
  | 4 | write no DaVinci recusado |
  | 5 | Resolve indisponível |
  | 64 | uso inválido |

- **Nenhum comando modifica o DaVinci.** O `--davinci` usa só a leitura `inspect`, pela allowlist em `core/context/davinci-read.mjs`, e não troca a timeline corrente.

## 8. Limitações (V1)

- Não executa STT. whisper.cpp e outros providers podem ser plugados como novo parser sem mudar o schema.
- Não converte o tempo de clip para o da timeline (offset de clip, A18).
- O texto da legenda do DaVinci é o nome do item da track de legenda, pelo `inspect` da Bridge. A leitura ao vivo de uma track de legenda real não foi validada na R8 (não havia track de legenda num sandbox).
- As regras de anotação são lexicais (pt/en), sem NLP nem embeddings.
- Não há diarização.
- Não há alinhamento forçado de palavras.
