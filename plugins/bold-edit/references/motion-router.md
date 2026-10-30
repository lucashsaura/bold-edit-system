# Motion Router V1

**Status: V1 implementada (R9)** em `editorial/src/router.mjs`. É a implementação do método de `decision-engine.md` (8 critérios 0–3 + regras), estendido com **DAVINCI_NATIVE** e **NONE**.
Para cada decisão do plano editorial, recomenda **qual ferramenta é mais adequada para a intenção**.

**Não escolhe por "está instalado", "é mais fácil" ou "já usamos antes".** A disponibilidade é opcional (`--availability`) e só:
- gera `PREFERRED_UNAVAILABLE`;
- aponta o `fallback` declarado.

A escolha nunca muda por causa dela (teste: HyperFrames indisponível continua HYPERFRAMES; Remotion indisponível não faz um dado virar HyperFrames).

## 1. Ferramentas e capacidade real

| Ferramenta | Estado nesta Skill | Preferir para | Não serve para |
|---|---|---|---|
| **HYPERFRAMES** | FROZEN_V1 (`hyperframes.md`, `hyperframes-capabilities.md`) | tipografia editorial e expressiva, lockups e hierarquia tipográfica, máscaras, perspectiva, kerning/baseline exatos | interação com footage, tracking, mídia embutida, séries de dados |
| **REMOTION** | FROZEN_V1 (`remotion-backend.md`) | dados, listas, mapas, gráficos, contadores, cards, lower thirds de série, composições programáticas reutilizáveis | interação com footage, tracking |
| **FUSION** | **EXPERIMENTAL** (`fusion.md`: sem módulo; só conhecimento) | interação com a imagem filmada: tracking, máscara sobre footage, pointer ligado a objeto, highlight de objeto; texto editável no Resolve | — (sempre com aviso `CAPABILITY_EXPERIMENTAL`) |
| **DAVINCI_NATIVE** | edição no Resolve (execução só pela Bridge/protocolo, com aprovação) | transform, crop, opacity, fades, transições simples, títulos básicos, inserção de mídia, cortes, posicionamento de áudio | tipografia avançada, séries de dados, tracking |
| **NONE** | — | quando motion não agrega valor (NO_ACTION) | — |

## 2. Critérios (`decision-engine.md` §1)

Os critérios vêm da **intenção** (ação, `visual_intent`, sinais, intenção do usuário):

| Critério | Pontuação |
|---|---|
| COMPLEXITY | níveis da hierarquia (dados = 2; lower third = 1) |
| EDITABILITY | 3 se o usuário pediu editável no Resolve; lower third = 2 |
| ALPHA | 3 para overlay gráfico |
| REUSABILITY | 3 para série; lower third = 2 |
| RENDER_COST | 2 com footage; 1 com dados |
| RESOLVE_DEPENDENCY | 3 com footage; 2 para mídia, corte, áudio, ajuste simples ou edição no Resolve |
| DATA_DRIVEN | 3 com valores, comparação ou INFO_CARD |
| VISUAL_COMPLEXITY | tipografia com ≥ 2 níveis = 3 |

## 3. Regras (em ordem)

| # | Regra | Ferramenta |
|---|---|---|
| R0 | NO_ACTION | NONE |
| R1 | interação espacial com o footage (TRACKED_CALLOUT, POINTER, `needs.footage_interaction`), **ou** EDITABILITY e RESOLVE_DEPENDENCY ≥ 2 com COMPLEXITY ≤ 1 (§3.3) | FUSION |
| R2 | corte/pausa, áudio, inserção de mídia sem animação, ajuste simples (fade, transição, título básico; TEXT_EMPHASIS de 1 nível ou estilo clean) | DAVINCI_NATIVE |
| §3.1 | DATA_DRIVEN ou REUSABILITY ≥ 2, ou lower third de série | REMOTION |
| §3.2 | a tipografia é o elemento (VISUAL_COMPLEXITY ≥ 2) | HYPERFRAMES |
| §3.4 | desempate: menor custo de alteração tardia para um elemento simples | DAVINCI_NATIVE |

- **Fallback declarado:** HYPERFRAMES → REMOTION · REMOTION → HYPERFRAMES · FUSION → DAVINCI_NATIVE · DAVINCI_NATIVE → NONE. Cada um registra o que se perde.
- **Avisos:**
  - `CAPABILITY_EXPERIMENTAL` para Fusion;
  - `CAPABILITY_MISSING` quando a intenção exige análise visual ou tracking (inexistente nesta Skill);
  - `PREFERRED_UNAVAILABLE` quando `--availability` diz que a preferida não está instalada.

## 4. Saída (`bold.motion-route/1`)

`{decision_id, action, tool, rule, capability_status, scores, needs, rationale, fallback, availability, issues, motion_spec_decision, not_based_on}`
- **`motion_spec_decision`** (para HyperFrames, Remotion e Fusion) é um bloco `decision` compatível com `motion.spec.schema.json` (`backend`, `scores`, `rationale` com o fallback). Ele pode ser copiado para o `motion.spec` **depois da aprovação**. Validado por teste contra o schema.
- O router **não cria** spec, composição nem render.

## 5. Exemplos (testados)

| Decisão | Ferramenta | Regra |
|---|---|---|
| `TYPOGRAPHY_MOTION` (gancho com 2 níveis) · `OFFER_CARD` "15% / desconto / PIX" · `CTA` | HYPERFRAMES | §3.2 |
| `INFO_CARD` "7 em cada 10" (valores) | REMOTION | §3.1 |
| `LOWER_THIRD` de série / editável no Resolve | REMOTION / FUSION | §3.1 / §3.3 |
| `TRACKED_CALLOUT` no produto em cena | FUSION (EXPERIMENTAL + CAPABILITY_MISSING) | R1 |
| `TRANSITION_SUPPORT`, `CUT_CANDIDATE`, `SFX_CUE`, `PRODUCT_INSERT` (inserção simples) | DAVINCI_NATIVE | R2 |
| `NO_ACTION` | NONE | R0 |

## 6. CLI

```
bold motion route <plan.json> <dNNNN> [--availability a.json] [--json]     (= bold editorial route)
```
`a.json`: `{"HYPERFRAMES": true, "REMOTION": false, ...}`. Ele só informa e **nunca decide**. Os demais subcomandos de `bold motion` (HyperFrames) não mudaram.
