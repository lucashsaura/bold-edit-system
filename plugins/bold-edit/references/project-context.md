# Project Context V1

**Status: V1 implementada (R8).** `bold.project-context/1` junta **transcrição + asset index + DaVinci (somente leitura)** num retrato descritivo.
É **cache derivado**: reconstruível e nunca a fonte única da verdade. A verdade fica no filesystem, nas legendas e transcrições de origem, e no Resolve.

**Fronteira R8 × R9:**
- O contexto responde "o que existe e o que está acontecendo?".
- Não contém nem sugere decisões de edição (R9).

---

## 1. Arquitetura

```
asset-index (bold.asset-index/1) ─┐
transcrições (bold.transcript/1) ─┤                                  ┌─ bold context query … (leitura)
  + anotações (…-annotations/1) ──┼─→ core/context/context.mjs ─→ bold.project-context/1
DaVinci (somente leitura) ────────┘        link.mjs (File Path ↔ Media Pool ↔ uso)
  core/context/davinci-read.mjs: allowlist status · projects · timelines · inspect · media
```
- **Componentes opcionais:** sem índice → `asset_index: null`; Resolve fechado → `davinci: {available:false, reason}`. O resto funciona.
- O contexto **não é um mega-schema**: ele referencia e inclui os documentos dos componentes, cada um com o próprio schema.

## 2. DaVinci: somente leitura (R8)

- A única porta é `davinciRead()`, com uma **allowlist** de operações de leitura da Bridge V1 (R7, usada sem alteração). Qualquer outra operação é `DAVINCI_WRITE_FORBIDDEN` antes de chegar ao Python. Os testes provam isso com uma Bridge falsa que registra cada chamada.
- **Nunca:** importar, inserir, relinkar, mover, renomear, criar bin, alterar timeline, trocar projeto ou página, renderizar ou exportar.
- `inspect --timeline T` lê **sem trocar** a timeline corrente. Fora da corrente, o estado de track é `null` (A2).
- Seleção de timelines no snapshot:

  | Opção | O que é lido |
  |---|---|
  | padrão | só a timeline corrente |
  | `--timeline T` | a timeline T |
  | `--all-timelines` | todas (custa uma leitura por timeline) |

- **Media Pool ↔ arquivo:** a ligação é por File Path normalizado (NFC + normalize + realpath quando existe). **O nome nunca liga nada.**
  - `exists_on_disk: false` registra só que o arquivo não está no disco.
  - **Não** conclui "media offline" (`davinci-safety.md` P3) e não tenta corrigir.

## 3. Schema `bold.project-context/1`

Arquivo: `core/context/bold.project-context.schema.json`.

| Campo | Conteúdo |
|---|---|
| `read_only: true`, `nature` | declaração de natureza descritiva |
| `components.asset_index` | arquivo, raiz, `generated_at`, `stats` |
| `components.transcripts[]` | `id` (`t1`…), arquivo, sha256, timeline (se veio do DaVinci), formato, granularidade, contagem de anotações |
| `components.davinci` | produto, versão, página, projeto, timelines, corrente, **alvo** (`--timeline` ou a corrente), timelines inspecionadas (fps exato, DF, start TC, tracks, itens, markers) |
| `assets[]` | registros do índice (mesmo formato de `bold.asset-index/1`) |
| `transcripts[]` | documentos `bold.transcript/1` + anotações |
| `relations.media_pool[]` | item do pool → `asset_id` / `exists_on_disk` |
| `relations.asset_usage[]` | timeline, track, `tl_in`/`tl_out` + TC, File Path → `asset_id` |
| `relations.transcript_timeline[]` | transcrição ↔ timeline (legendas do DaVinci) |

**Local padrão:** `<PROJECT_ROOT>/.bold/context/project-context.json` ou `<CACHE_DIR>/context/`. Regravar é esperado, porque é cache.

## 4. CLI

```
bold context build [--root <pasta> | --index f] [--transcript a.srt --transcript b.vtt …] [--vocabulary v.json]
                   [--davinci [--timeline T | --all-timelines] [--subtitles]] [--output ctx.json]
bold context query <ctx.json> summary|timelines|speech|mentions|candidates|assets|usage|duplicates [termo] [filtros] [--json]
```
`--subtitles` normaliza a track de legenda de cada timeline inspecionada, quando há exatamente uma. Com mais de uma, use `bold transcript --davinci --track N`.

| Pergunta | Consulta |
|---|---|
| Quais timelines existem? Qual é a alvo? | `query ctx timelines` |
| Qual a transcrição da timeline T? | `query ctx speech --timeline T` |
| Quais falas existem entre X e Y? | `query ctx speech --from X --to Y [--transcript t1]` |
| Quais trechos mencionam o produto P? | `query ctx mentions "P"` |
| Quais candidatos a oferta, CTA ou número aparecem? | `query ctx candidates --type offer,cta,number` |
| Quais assets são verticais? Têm alpha? Estão em 59.94? | `query ctx assets --orientation vertical` · `--alpha true` · `--fps 59.94` |
| Onde o asset X é usado? | `query ctx usage <caminho>`. Por **nome**, devolve **todos** os homônimos com `ambiguous: true` e nunca escolhe um |
| Existem filenames duplicados? | `query ctx duplicates` |

## 5. Limitações (V1)

- O contexto é um retrato: reflete o momento do `build`. Para atualizar, rode de novo (o índice é incremental).
- A relação de uso cobre itens de vídeo e áudio com File Path. Fusion, gerador e título não têm File Path (A15).
- A transcrição de um clip (SRT do arquivo) não é posicionada na timeline: isso exige o offset do clip e A18 (R9).
- Projetos com muitas timelines: `--all-timelines` faz uma leitura por timeline.
