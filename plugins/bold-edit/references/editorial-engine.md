# Editorial Decision Engine V1

**Status: V1 implementada (R9).** Transforma o que a R8 descreve em um **plano editorial explicável** (`bold.editorial-plan/1`).

| Camada | Pergunta |
|---|---|
| R8 | "o que existe e o que está acontecendo?" |
| **R9** | **"o que vale a pena fazer editorialmente com isso?"** |
| Execução | "fazer" (outra camada, só com plano **aprovado por humano**) |

**DECIDIR ≠ EXECUTAR.** A R9 nunca:
- altera timeline, cria track ou oculta legenda;
- importa ou insere mídia;
- renderiza, exporta ou cria motion final.

**Princípio:** a edição serve à mensagem. **NO_ACTION é uma boa decisão**.
- Nada de motion em tudo, número virando gráfico, B-roll sem necessidade ou efeito só porque está disponível.
- Regras de design herdadas: `motion-system.md` §3 (um protagonista por quadro, footage-aware, sem comportamento de template).

---

## 1. Fluxo e fronteiras

```
R8 (somente leitura)                      R9 (editorial/src)                                    FORA da R9
bold.project-context/1 ──┐   signals → candidatos → oferta principal → USER INTENT → limiar do modo
bold.transcript/1 ───────┼─→ → DENSITY (MERGE/REDUCE/KEEP/DROP) → legenda · placement · leitura · ROUTER ─→ PLANO
+ annotations, índice ───┘   → VALIDATOR (fail-closed)                                          (DRAFT_REQUIRES_HUMAN_REVIEW)
                                                                                                      ↓ revisão humana
                                                                                                APPROVED PLAN → execução
                                                                                                (motion/Bridge/render: protocolos próprios)
```

- O plano sai sempre com `execution: {allowed:false, writes:[]}` e cada intervenção em `approval: PENDING_HUMAN_REVIEW`.
- O validator recusa `execution.allowed = true`.
- `editorial/src` **não importa** Bridge, DaVinci, processos, delivery nem render (teste estático). A única gravação é o arquivo do plano, pelo CLI e sem sobrescrever.
- **R8 intocada:** o contexto e a transcrição são lidos. O teste confere o sha256 do contexto antes e depois.

## 2. Sinais editoriais (`editorial/src/signals.mjs`)

Os candidatos da R8 viram sinais. Alguns sinais saem de léxicos genéricos da própria R9. Termos de produto, marca, pessoa e lugar vêm **só** do vocabulário ou da identidade do projeto.

| Sinal | Origem |
|---|---|
| HOOK | R8 `hook_candidate`. **Forte** só com pergunta, ênfase, dado estatístico ou condição comercial (número incidental não sustenta gancho) |
| OFFER | R8 `offer_mention` · R9 parcelamento (`10 vezes`, `12x`) · `% off` |
| CTA | R8 `cta_candidate` · R9 (`clique no link`, `link abaixo`…) |
| PRODUCT · MODEL | R8 produto do vocabulário · código de modelo (regex) |
| NUMBER · PRICE · PERCENTAGE · DATE | R8 |
| DEADLINE · PAYMENT · FEATURE · BENEFIT · COMPARISON · PROOF | léxicos R9 (`até` só vira prazo com data) |
| PERSON · LOCATION · BRAND | vocabulário/identidade · apresentação ("meu nome é…") · preposição + nome próprio (siglas e meios de pagamento não viram lugar) |
| EMPHASIS · QUESTION · TRANSITION · REPETITION | R8 |

**Papel dos números (o contexto decide, não o dígito):**

| Papel | Exemplo |
|---|---|
| `commercial` | segmento com oferta ou preço: "15% de desconto", "10 vezes sem juros" |
| `statistic` | "7 em cada 10", % sem oferta |
| `date` | "15 de março" |
| `incidental` | "trabalhamos com 15 pessoas" → **NO_ACTION** |

Sinais combinam ("15 vezes sem juros" = OFFER + NUMBER + EMPHASIS) e **ainda não são decisões** (`bold editorial analyze`).

## 3. Ações (vocabulário controlado)

| Família | Ações | Visual? |
|---|---|---|
| none | `NO_ACTION` | — |
| text | `TEXT_EMPHASIS`, `TYPOGRAPHY_MOTION` | sim |
| graphic | `INFO_CARD`, `OFFER_CARD`, `CTA`, `LOWER_THIRD` | sim |
| asset | `BROLL`, `IMAGE_INSERT`, `PRODUCT_INSERT`, `LOGO_BRAND` | sim |
| spatial | `CALLOUT`, `POINTER`, `TRACKED_CALLOUT` | sim. Exigem análise visual/tracking, **inexistente**: só aparecem como alternativa; em plano → `CAPABILITY_MISSING` |
| structure | `TRANSITION_SUPPORT` | não |
| audio | `SFX_CUE`, `MUSIC_CUE` | não |
| pacing | `CUT_CANDIDATE` (pausa longa, repetição próxima) | não |

**Regras principais**, avaliadas por segmento:

| Regra | Condição | Ação · prioridade base |
|---|---|---|
| `offer:quantified` | % comercial, preço ou parcelamento | `OFFER_CARD` · HIGH (a **principal** do vídeo → CRITICAL) |
| `cta:lexicon` | CTA | `CTA` · HIGH no trecho final ou com link/clique, senão MEDIUM |
| `product:vocabulary+asset` | produto + asset por caminho/tags | `PRODUCT_INSERT` · MEDIUM (sem asset → `TEXT_EMPHASIS` + alternativas) |
| `person:intro` | apresentação de pessoa | `LOWER_THIRD` · MEDIUM |
| `info:statistic` / `info:comparison` | dado ou comparação sem oferta | `INFO_CARD` · MEDIUM (no gancho: HIGH) |
| `hook:opening` | gancho forte sem dado/oferta | `TYPOGRAPHY_MOTION` · MEDIUM |
| `proof`, `offer:unquantified`, `benefit`, `date`, `emphasis:combined` | — | `TEXT_EMPHASIS` · MEDIUM/LOW |
| `brand:identity` · `broll:*` | marca com logo da identidade · benefício/lugar com vídeo no índice | `LOGO_BRAND` · `BROLL` · LOW |
| `pacing:pause` · `pacing:repetition` | pausa ≥ 2 s (≥ 1 s com edição rápida) · repetição em ≤ 15 s | `CUT_CANDIDATE` · LOW (MEDIUM com edição rápida) |
| `no_action:default` | nada acima | `NO_ACTION` com o **motivo** (número incidental, código isolado, fala comum…) |

**Cada decisão tem:**
- `decision.{action, priority, rule, reason}`;
- `evidence` (trecho, anotações R8, origens dos sinais, assets, contexto de timeline);
- `signals`, `visual_intent`, `candidate_assets`, `subtitle_interaction`, `placement`;
- `constraints` (ex.: tempo mínimo de leitura);
- `confidence`, `alternatives`, `density`, `route` e `approval`.

`bold editorial explain <plan> <id>` imprime a trilha completa.

## 4. Prioridade

`CRITICAL` > `HIGH` > `MEDIUM` > `LOW` > `NONE` (só NO_ACTION).

**Contexto:**
- só a **principal condição comercial** vira CRITICAL: maior pontuação (valor + prazo + meio de pagamento), com desempate pela mais cedo;
- "15%" numa promoção → HIGH/CRITICAL; "15 pessoas" → NO_ACTION.

**Intenção do usuário:**
- foco +1 (máximo CRITICAL);
- fora do foco −1 (mínimo LOW);
- ações em `avoid` são suprimidas.

## 5. Densidade editorial (`editorial/src/density.mjs`)

| Modo | Limiar | Respiro mínimo | Teto |
|---|---|---|---|
| CONSERVATIVE | ≥ HIGH | 6 s | 1 por 10 s |
| BALANCED (padrão) | ≥ MEDIUM | 3 s | 2 por 10 s |
| EXPRESSIVE | ≥ LOW | 1,5 s | 3 por 10 s |
| `motion_budget: low` (usuário) | ≥ HIGH | ≥ 8 s | 1 por 10 s |

- Sobreposição visual é **sempre** conflito.
- `TEXT_EMPHASIS` (leve) precisa só de metade do respiro.

Entre candidatos próximos, a ordem de resolução é:

| Resultado | Quando |
|---|---|
| **MERGE** | informação relacionada (mesmo grupo: comercial ou produto) num span ≤ 10 s. Vira uma intervenção que guarda `merged_from` e `merged_content` (ex.: 15% no PIX + 10x sem juros) |
| **KEEP** (sequência) | enumeração explícita na fala ("primeiro… segundo…"), fora do CONSERVATIVE, sem sobreposição |
| **REDUCE** | o de menor prioridade (MEDIUM+, redutível) com respiro ≥ metade do mínimo vira `TEXT_EMPHASIS` (`reduced_from`) |
| **DROP** | sem respiro e sem relação: o de menor prioridade sai, com motivo em `suppressed[]` |

O teto por janela derruba o de menor prioridade. Nada some sem registro: `suppressed[]` guarda ação, trecho, resultado (`DROP`/`MERGE`/`USER_INTENT`/`MODE_THRESHOLD`) e motivo. O segmento que perde a intervenção recebe NO_ACTION explicando por quê.

## 6. Legendas (`subtitle_interaction`)

Aprendizado do piloto: um motion que mostra exatamente a informação da legenda gera duplicação visual.
- A presença de legenda vem da timeline (a transcrição é a própria track de legenda do DaVinci, ou o contexto tem track de legenda) ou de `--subtitle-presence`. Senão, `unknown`.
- **Métricas** (normalizadas, com sinônimos `off`→`desconto`, `x`→`vezes`, sem palavras vazias):
  - `duplicate_ratio` = fração do texto do motion presente na legenda;
  - `subtitle_coverage` = fração da legenda coberta pelo motion.

| Status | Regra |
|---|---|
| `CONSIDER_HIDE_DUPLICATE` | `duplicate_ratio` ≥ 0,6 **e** `subtitle_coverage` ≥ 0,5 ("15% de desconto no PIX" × "15% OFF · PIX") |
| `KEEP_FOR_CONTEXT` | o motion repete parte, mas a legenda traz contexto adicional |
| `KEEP` | informação diferente · legenda ausente · presença desconhecida · o usuário disse "não mexa nas legendas" |

- Sempre `write:false` e `requires_approval:true`. **Nunca desliga a legenda.**
- Decisão consolidada (MERGE): a comparação é feita **por segmento** (`per_segment`).

## 7. Enquadramento e safe areas (`placement`)

- **Conhecido**, só da timeline e do contexto:
  - aspecto, orientação, resolução e duração do intervalo;
  - zona provável da legenda (rotulada **convenção, não medida**);
  - overlays existentes em tracks superiores no intervalo (relações de uso da R8).
- **Desconhecido:** rosto/assunto, produto em cena e regiões livres. Não existe análise visual nesta Skill.
- Toda intervenção visual sai com `VISUAL_PLACEMENT_REQUIRES_REVIEW` e `claims: []`.
- Afirmar "há espaço à esquerda" sem análise → `PLACEMENT_WITHOUT_VISUAL_EVIDENCE` (FAIL).

## 8. Asset matching (`editorial/src/match.mjs`)

Usa o Asset Index V1 (R8). **Nunca escolhe por filename apenas.**

| Evidência | Peso |
|---|---|
| pasta do caminho | 3 por termo |
| tags | 2 |
| `identity:logo_path` | 5 |
| nome do arquivo | 1 |
| orientação igual à da timeline, alpha (logo), presença no Media Pool | +1 cada |

Tipos compatíveis por ação: PRODUCT_INSERT = imagem/vídeo/motion master; BROLL = vídeo; LOGO = vetor/imagem/master. Documentos nunca entram.

| Status | Significado |
|---|---|
| `CANDIDATE` | um melhor, com evidência além do nome → `recommended` é **sugestão**, nunca seleção |
| `ASSET_AMBIGUOUS` | empate, ou **homônimo** em outro caminho entre os candidatos → `recommended: null` |
| `NAME_ONLY_REQUIRES_REVIEW` | só o nome casou → `recommended: null` |
| `NO_ASSET_FOUND` | sem candidato → a ação degrada (ex.: TEXT_EMPHASIS) |

`ASSET_AMBIGUOUS` com algo escolhido → FAIL.

## 9. Intenção visual (`visual_intent`)

A R9 não desenha o motion. Ela descreve:
- `purpose`;
- `hierarchy` primary/secondary/tertiary, com o texto **literal da fala** (exige texto aprovado antes da execução);
- `behavior` (ordem e sincronia com a fala);
- `style_constraints` (identidade, um protagonista, não cobrir rosto/produto, sem movimento decorativo persistente);
- `data` (valores, para INFO_CARD);
- `merged_content`.

É consumida depois pelo sistema de motion, depois da aprovação.

## 10. Identidade visual (opcional, `bold.identity/1`)

`{brand_names, colors (papéis), fonts, logos (caminhos), references[{kind, description, extracted_rules}], shapes, composition_rules, motion_rules}`
- Vira **restrições**: cores por papel, tipografia USER_PROVIDED, regras de composição e de motion, regras extraídas das referências.
- **SYSTEM ≠ TEMPLATE:** referência = `EXTRACT_RULES_ONLY` (linguagem, hierarquia, ritmo, formas, tokens). Nunca "existe um motion antigo, copie".
- Cópia só com `allow_template_copy: true` explícito do usuário (`COPY_ALLOWED_BY_USER`).

## 11. Intenção do usuário (`bold.editorial-intent/1`)

`{mode, focus[], motion_budget low|normal|high, style, pace fast|normal|slow, subtitles do_not_touch|allow_suggestions, avoid[], music, editable_in_resolve, allow_template_copy, notes}`
- A estruturada (`--intent`) **vence** o texto livre.
- Texto livre (`--intent-text`) passa por um mapeador transparente: cada frase reconhecida fica em `matched[]`; o que não for reconhecido não tem efeito.
- Chaves ou valores desconhecidos → `INTENT_INVALID`.

| Frase (exemplos) | Efeito |
|---|---|
| "quero destacar principalmente promoção" | `focus: [OFFER]` |
| "quero algo mais clean" | `style: clean` (TYPOGRAPHY_MOTION → TEXT_EMPHASIS; sem SFX) |
| "não quero muito motion" | `motion_budget: low` (limiar HIGH, respiro ≥ 8 s) |
| "quero edição rápida" | `pace: fast` (pausas ≥ 1 s viram corte candidato MEDIUM) |
| "não mexa nas legendas" | `subtitles: do_not_touch` (nunca CONSIDER_HIDE; validator bloqueia) |
| "sem B-roll" · "com música" · "editável no Resolve" | `avoid: [BROLL]` · `music` · `editable_in_resolve` |

## 12. Modos

- `CONSERVATIVE`, `BALANCED` (padrão) e `EXPRESSIVE`, com limiar e densidade do §5.
- O EXPRESSIVE também propõe `SFX_CUE` (opcional, sem estilo clean) para HIGH/CRITICAL e `TRANSITION_SUPPORT` em mudanças de bloco sem corte de pausa.
- **O modo não muda a factualidade:** os sinais são idênticos nos três (teste).

## 13. Validator (`bold editorial validate`, fail-closed)

**ERROR → FAIL**, o plano não é aprovável:

| Erro | Situação |
|---|---|
| `SCHEMA` | plano não conforma o schema |
| `EXECUTION_FORBIDDEN` | execução permitida ou writes não vazio |
| `MISSING_REASON` | decisão sem regra/motivo |
| `NO_EVIDENCE` | intervenção sem trecho + sinais |
| `OUT_OF_TIMELINE` | intervalo fora de [0, duração] |
| `OVERLAP_VISUAL` | intervenções visuais sobrepostas |
| `DENSITY_EXCESSIVE` | respiro mínimo ou teto por janela violados |
| `PLACEMENT_WITHOUT_VISUAL_EVIDENCE` | afirmação de enquadramento sem análise visual |
| `CAPABILITY_MISSING` | ação espacial sem análise visual |
| `ROUTER_INCOMPATIBLE` | ferramenta incompatível com a ação |
| `ASSET_AMBIGUOUS` | ambíguo com escolha |
| `ASSET_MISSING` | ação de asset sem candidato |
| `SUBTITLE_WRITE_FORBIDDEN` | interação com legenda como write |
| `USER_INTENT_CONFLICT` | conflito com a intenção do usuário |
| `MODE_THRESHOLD_VIOLATION` | prioridade abaixo do limiar do modo |
| `UNKNOWN_ACTION` | ação fora do vocabulário |
| `MISSING_ROUTE` | intervenção visual sem rota |

**WARNING:** ambiguidade de asset a revisar, ferramenta EXPERIMENTAL, ferramenta preferida indisponível, duplicação não sinalizada.

## 14. CLI

```
bold editorial analyze  --context ctx.json [--transcript-id tN] | --transcript f [--vocabulary v]
bold editorial plan     --context ctx.json [--transcript-id tN] | --transcript f [--index f | --root pasta]
                        [--mode …] [--intent i.json] [--intent-text "…"] [--identity id.json] [--vocabulary v]
                        [--subtitle-presence present|absent|unknown] [--fps F] [--aspect 9:16] [--resolution WxH] [--availability a.json] [--output plan.json]
bold editorial inspect  <plan.json>
bold editorial explain  <plan.json> <dNNNN>
bold editorial validate <plan.json>
bold editorial route    <plan.json> <dNNNN> [--availability a.json]      (alias: bold motion route)
```
- `--json` dá saída estável. O plano é determinístico: sem timestamp, com hashes das entradas.
- O plano nunca sobrescreve. Um plano gerado que falha na validação não é gravado.
- Mais de uma transcrição no contexto sem `--transcript-id` → `TRANSCRIPT_AMBIGUOUS`.

## 15. Tempo

- Segundos sempre.
- Com fps da timeline (contexto ou legendas do DaVinci): `start_frame`/`end_frame`, `tl_in`/`tl_out` absolutos e TC real, com DF em 29.97/59.94 (`tc_origin: timeline`).
- Só com `--fps`: TC relativo desde 0 (`tc_origin: relative`). fps nunca é assumido.

## 16. Limitações (V1)

- Regras lexicais (pt/en), sem NLP nem análise de imagem ou áudio. Enquadramento é sempre revisão humana.
- B-roll e logo dependem do índice e da identidade fornecidos; não há busca semântica de imagem.
- SFX e música só são propostos (cue e momento); a escolha da faixa e do som é humana; nada é baixado.
- A transcrição de clip (SRT do arquivo) não é reposicionada na timeline (offset de clip, A18).
- O plano não tem estado de aprovação persistente por decisão além de `approval.status`. A camada de execução, R10+, define o fluxo de aprovação.
