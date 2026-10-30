# Remotion backend (R5 · hardening R5.6)

**Status: IMPLEMENTADO (subset V1).** O Remotion é **dependência EXTERNA**, e a licença continua **PENDENTE**. A Skill não instala, não baixa e não redistribui Remotion.
Backend interno: `bold-remotion-backend@0.2.0` (plano v2). Validado com remotion / @remotion/bundler / @remotion/renderer **4.0.290**, React 19.0.0 e Node 22.22.3.

## 1. Pipeline real

```
motion.spec.json (+ tokens.json do projeto, + assets do projeto)
  → preparePlan        schema + tokens + subset ESTRITO → PLANO (px/frames resolvidos)    [core/render/render.mjs]
  → backend explícito  decision.backend = "remotion" (ausente → BACKEND_DECISION_REQUIRED)
  → detectRemotion     instalação externa compatível + browser já baixado (senão → UNAVAILABLE)
  → stageAssets        assets validados → publicDir TEMPORÁRIO (nunca dentro da Skill)
  → policy gate        autorização estruturada cobrindo ["render", "encode"]
  → bundle + renderFrames   composição ÚNICA "BoldSpec" → PNG SEQUENCE (swangle, concurrency 1)
  → BOLD Delivery (R4) encodeSequence | blurSubframes → ProRes BT.709 → validação → manifest
  → MACHINE QC         qcFile | qcAlpha
  → qc stills          first / 25% / 50% / 75% / last + contact sheet (VISUAL QC humano)
```

**O Remotion só gera frames.** Encode, BT.709, alpha, contagem de frames, metadados, QC e manifest são do BOLD Delivery.

## 2. Configuração e dependência externa

- **Onde está a instalação:** `tools.REMOTION_PROJECT_DIR` (config) ou `BOLD_REMOTION_PROJECT_DIR` (ENV), apontando para um diretório com `node_modules` contendo `remotion`, `@remotion/bundler`, `@remotion/renderer`, `react` e `react-dom`.
- **Detecção** (`remotion/adapter/detect.mjs`, a mesma usada por `bold doctor --module motion`):
  - versão 4.0.x, com bundler e renderer na mesma versão;
  - react e react-dom iguais (18 ou 19);
  - `chrome-headless-shell` já presente em `node_modules/.remotion`.
  - Qualquer falha resulta em **UNAVAILABLE com motivo**. O resto da Skill continua funcionando.
- **Nada é escrito na instalação externa:**
  - `browserExecutable` é sempre explícito, então o renderer nunca baixa um browser;
  - o webpack roda com `enableCaching: false`;
  - o `outDir` do bundle fica em diretório temporário.
  - Verificado na rodada: zero escritas na instalação de referência.
- **Resolução de módulos:** o bundle resolve `remotion`, `react` e `react-dom` a partir da instalação externa (`webpackOverride` → `resolve.modules` + `alias`), o que garante uma única cópia do React.

## 3. Subset suportado do `composition` (V1)

Qualquer chave fora do subset → **SPEC_UNSUPPORTED**, com a lista de caminhos. Nada é ignorado em silêncio.

| Chave | Tipo | Notas |
|---|---|---|
| `width`, `height` | inteiro par, 16–8192 | nada é fixo; `u` = 1% do menor lado |
| `transparent` | bool | `true` ⇒ `background.type="none"`, sem grão; delivery `ALPHA_4444_BT709` |
| `seed` | inteiro | PRNG e ruídos determinísticos |
| `background` | `{type: none\|solid\|gradient, color, from, to, angle}` | opaco exige solid ou gradient |
| `texture` | `{grain: 0..1}` | grão de tela cheia (só opaco) |
| `safe_area` | 0..0.4 | padrão: tokens ou 0,1 |
| `grid` | `{columns, rows, gutter}` | regiões por célula |
| `camera` | `{keys: [{at, x, y, zoom, rotate, ease}]}` | x e y em fração do quadro; zoom em log; parallax por `depth` da camada; overscan só em camadas full-bleed (§3.1) |
| `motion_blur` | `{subframes: 2..16, shutter: (0,1]}` | render a fps×SUB → `bold delivery blur` |
| `layers[]` | ver abaixo | ao menos 1 |

**Camada:** `id` (`[A-Za-z][A-Za-z0-9_-]{0,63}`, único), `pattern`, `full_bleed` (bool, §3.1), `in`, `out`, `depth` (0..1,5), `z`, `region` (`"full"` \| `"safe"` \| `{col,row,span,rows}`), `anchor` (9 âncoras), `content`, `style`, `motion`.
`motion` comum a todos: `enter`, `exit`, `ease`, `exit_ease`, `delay`. Chaves específicas por pattern (R5.5: o que o pattern não usa → FAIL):

| Pattern | + motion | `anchor` | Restrições |
|---|---|---|---|
| TITLE_REVEAL | stagger, reveal, split | sim | — |
| LOWER_THIRD | stagger, reveal | sim | `style.rule`: none \| left |
| CARD_BUILD | stagger, reveal | não | — |
| IMAGE_REVEAL | stagger, reveal | não | `fit`/`focus` só com `asset:`; reveal combina com `paper` |
| STAT_COUNTER | stagger, reveal, spring | sim | reveal padrão = fade |
| MAP_PATH | — | não | `markers[].at`: índice inteiro de `points`; chaves `at`, `label` |
| CALLOUT | stagger, reveal | sim | `target`: ponto (§3.2) |
| SECTION_TRANSITION | stagger, reveal | não | reveal: up \| down \| left \| right; region só "full"; sempre full-bleed (`full_bleed:false` → FAIL) |
| SHAPE | reveal | não | ring/line se desenham (sem reveal); `at` + `size` posicionam no ponto (sem `region`); `full_bleed` só `rect` |
| GRID_LINES | stagger | não | region só "safe" |

`reveal`: up, down, left, right, fade, scale · `split`: line, word, char. `drift` e `style.align` **não existem** (removidos na R5.5: eram aceitos sem efeito).

**Tempo:** número = segundos · `"Nf"` = frames · `"motion.<nome>"` = token. Tudo é convertido pelo fps do `brief`.
**Refs de token:** `color.X`, `type.N`, `space.N` (aceita decimais, ex. `space.0.5`), `radius.X`, `stroke.X`, `shadow.X`, `ease.X`, `font.X`.

### 3.1 FULL-BLEED / OVERSCAN (R5.6)

**Problema da R5:** `requiredOverscan()` era calculado e nunca aplicado (V-13). Além disso, a fórmula dividia o pan pelo zoom e ignorava a rotação: subestimava pan+push e qualquer rotação.

**Quem é full-bleed.** Só camadas que DEVEM cobrir o quadro inteiro:

| Pattern | `full_bleed` |
|---|---|
| `IMAGE_REVEAL` | opcional (`true` ⇒ caixa = quadro; `region` só `"full"` ou omitida) |
| `SHAPE` | opcional, só `shape: "rect"` (placa de cor) |
| `SECTION_TRANSITION` | **implícito** (`false` → FAIL) |
| demais (tipografia, cards, callouts, contador, mapa, grid, elementos posicionados) | **não suportado → FAIL** |

`region: "full"` **não** torna a camada full-bleed: é só uma caixa do tamanho do quadro e não recebe overscan.

**Matemática.** A câmera CSS é `scale(z) rotate(−θ) translate(−t)` em torno do centro C, ou seja `view = C + z·R(−θ)·(p − C − t)`. Uma camada full-bleed escalada por S em torno de C cobre o viewport sse os 4 cantos do viewport, mapeados de volta (`p = C + t + R(θ)(v − C)/z`), caem dentro de `C ± S·(W/2, H/2)`. Isso dá a forma fechada **exata**:

```
S(t) = max( 2|tx|/W + (|cosθ| + (H/W)|sinθ|)/z ,  2|ty|/H + ((W/H)|sinθ| + |cosθ|)/z )
overscan(camada) = max(1, max S(t))  sobre os instantes EXATOS renderizados da camada
```

- Câmera vista pela camada = `parallax(câmera, depth)`: x·d, y·d, zoom^d, rotate·d (depth 0 ⇒ S = 1).
- Instantes = `subframeTime(n)` para todo n < frames·SUB com `in ≤ t < out` (inclui os sub-frames do motion blur). Sem amostragem e sem margem mágica: S é o mínimo que cobre.
- Aplicação: um `scale(S)` em torno do centro, **dentro** do wrapper da câmera, só nessas camadas.
- Testes (`tests/remotion/hardening.test.mjs`): a forma fechada contra a verificação independente por cantos (cobre com S, falha com S·(1−10⁻⁴)), mais pan L/R, pan U/D, push, pull, rotação, parallax e combinações em 16:9, 9:16 e 1:1, frame a frame.
- Confirmação em PIXELS (R5.6.1, `tests/remotion/overscan-pixels.test.mjs`): fixture sintético full-bleed com rampa de coordenadas sobre composição transparente, em 16:9, 9:16 e 1:1.
  - Com o S do Core: alpha mínimo 255 em todos os frames, e o S medido nos pixels bate com o calculado.
  - O controle negativo (overscan forçado a 1, só no harness) revela a área descoberta prevista pela geometria.
  - Não existe opção pública para desligar o overscan.

### 3.2 COORDINATE SPACE / REFERENCES (R5.6)

Existe um espaço comum: **FRAME SPACE** (px do quadro, antes da câmera). Todo ponto compartilhável é resolvido **uma vez** no plano. Os componentes só consomem px.

```
REGION/LOCAL (u,v ∈ 0..1 da caixa)  ─┐
SAFE  {space:"safe",  x, y} (0..1)   ├─→ FRAME SPACE (px)  → câmera/parallax (igual para camadas de mesma depth)
FRAME [x, y] | {space:"frame", x, y} ─┘
```

- `MAP_PATH.points` é REGION/LOCAL e vira `content.points_px` (frame).
- Um **ponto** (`CALLOUT.target`, `SHAPE.at`) aceita `[x, y]` (fração do quadro), `{space: "frame"|"safe", x, y}` ou `{ref: "<referência>"}`. Qualquer outra forma → FAIL.

**Referências semânticas** (gramática estrita, `remotion/src/core/space.ts`):

| Referência | Resolve para |
|---|---|
| `<layer>.point.<i>` | ponto i de um MAP_PATH |
| `<layer>.marker.<j>` | centro do marcador j (= `points[markers[j].at]`) |
| `<layer>.start` / `.end` | primeiro e último ponto de um MAP_PATH |
| `<layer>.target` | alvo resolvido de um CALLOUT |
| `<layer>.center` | centro da caixa de qualquer camada |
| `<layer>.anchor.<A>` | uma das 9 âncoras da caixa |

- **FAIL explícito:** sintaxe inválida; camada inexistente; tipo errado (`.point` fora de MAP_PATH); índice fora do intervalo; auto-referência; ciclo (`a → b → a`); camadas de `depth` diferente sob câmera (o parallax as separaria).
- **Determinístico e independente da ordem das camadas:** a resolução é feita depois da validação, por id, com memo e detecção de ciclo.
- Garantia testada: MAP POINT = MARKER CENTER = CALLOUT TARGET = centro de SHAPE.at, com tolerância **1e−9 px**, em 16:9, 9:16 e 1:1, nas regiões grid, safe, full e customizada.
- Não é um scene graph: não há hierarquia, transformações herdadas nem restrições de layout. O Core também não evita sobreposição.

## 4. Patterns (comportamentos, não templates)

| Pattern | content | Comportamento |
|---|---|---|
| `TITLE_REVEAL` | `title` (string ou linhas), `kicker`, `subtitle` | split linha/palavra/caractere com máscara por unidade, stagger, tracking animado, régua (top, left, under) |
| `LOWER_THIRD` | `name`, `role` | placa com wipe, régua vertical, nome e cargo mascarados |
| `CARD_BUILD` | `items[1..6]` (`{title, body}`) | cards em linha ou coluna, entrada escalonada, papel irregular opcional, sombra, traço |
| `IMAGE_REVEAL` | `src` (`asset:` ou `procedural:gradient\|bands\|noise`), `caption` | wipe, fade ou scale, drift/zoom, papel, fit/focus |
| `STAT_COUNTER` | `value`, `from`, `decimals`, `prefix`, `suffix`, `label`, `locale` | contagem com easing ou spring, `tabular-nums` |
| `MAP_PATH` | `points[[x,y]]`, `markers[{at,label}]` | Catmull-Rom sem DOM, desenho por máscara (tracejado ou contínuo), marcadores com spring |
| `CALLOUT` | `text`, `target` (ponto, §3.2) | linha-guia que se desenha, alvo com spring, texto mascarado |
| `SECTION_TRANSITION` | — | wipe em 1–2 painéis cobrindo o quadro |
| `SHAPE` | `shape` (rect, circle, line, ring), `at` (ponto, §3.2) + `size` `[w,h]` em u | wipe, scale ou fade; ring se desenha |
| `GRID_LINES` | — | linhas do grid se desenhando em stagger |

Nenhum pattern tem cor, fonte, texto ou layout próprio. Tudo vem dos tokens ou do spec; os defaults são neutros e derivados dos tokens.

## 5. Determinismo

- `--gl=swangle` e `concurrency: 1`.
- PRNG e `feTurbulence` com seed.
- Geometria sem DOM.
- Tempo de sub-frame centrado (`subframeTime`).
- Tokens de motion em **segundos** (o mesmo resultado em qualquer fps).

O manifest registra: `remotion_version`, `react_version`, `node_version`, `spec_sha256`, `tokens_sha256`, `plan_sha256`, `seed`, `backend_version`, `composition_id`, `gl`, `concurrency` e os assets com sha256. Teste: dois renders da mesma spec dão framemd5 idêntico.

## 6. Assets e fontes

- **Assets:** `asset:<caminho relativo>` dentro da raiz permitida (`PROJECT_ROOT`, ou o diretório do spec). São bloqueados com erro explícito:
  - caminho absoluto, `~` e `..`;
  - symlink que escapa da raiz;
  - extensão não permitida;
  - arquivo ausente.
  - Códigos: `ASSET_ABSOLUTE`, `ASSET_TRAVERSAL`, `ASSET_OUTSIDE_ROOT`, `ASSET_INVALID`, `ASSET_MISSING`.
- **Fontes:** tokens `typography.families.X.file` são carregados via `FontFace` com `delayRender`. Sem arquivo, usa a pilha `"<family>", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`. Noto Sans é só fallback conceitual, e **nenhuma fonte é empacotada**.

## 7. Erros (códigos de `bold render`)

| Código | Exit |
|---|---|
| `SPEC_INVALID`, `SPEC_UNSUPPORTED`, `TOKENS_*`, `ASSET_*`, `PROFILE_MISMATCH`, `OUTPUT_EXISTS`, `FRAME_MISMATCH` | 1 |
| `BACKEND_DECISION_REQUIRED` | 3 |
| autorização negada | 4 |
| `BACKEND_UNAVAILABLE` (Remotion ausente/incompatível, ou backend hyperframes/fusion) | 5 |

## 8. Exemplos versionados (`remotion/examples/`)

- `demo`: peça neutra de 5 s (fundo, grid, imagem procedural com papel, ring, título com stagger e máscara, contador, câmera leve, saída por wipe).
- **SYSTEM ≠ TEMPLATE:** as **mesmas** primitives e a **mesma** composição, com tokens, layout, timing e patterns diferentes:
  - `editorial-clean` (serif, cards);
  - `bold-geometric` (formas, caractere a caractere, contador com spring);
  - `minimal-technical` (grid, rota, callout, lower third).
- `overlay-lower-third`: transparente (alpha).
