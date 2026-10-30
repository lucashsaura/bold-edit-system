# HyperFrames: backend ESPECIALISTA em tipografia (R6.0 · R6.0.1 · R6.1)

**`HYPERFRAMES_BACKEND_STATUS = FROZEN_V1` · `HYPERFRAMES_CORE_V1_FREEZE = YES`** (R6.2). Não significa RELEASED, PORTABLE nem INSTALLED_GLOBALLY. Evidência: `HYPERFRAMES_R6_2_FREEZE_REPORT.md`.

**Congelado (V1):**
- `bold-hyperframes-backend@0.1.0`, `plan_version 1`, runtime `RUNTIME_SHA256 = 2b36e06f…7014`;
- os 5 TYPE_* (allowlists e defaults);
- a gramática e os tipos das refs;
- o font gate (estático + dinâmico) e a network policy (HF3 + net-guard + cache isolado + `NODE_DISABLE_COMPILE_CACHE`);
- o pipeline `bold render` (orquestrador e trace) e a integração com o BOLD Delivery (`ALPHA_4444_BT709`).

**Depois do freeze, qualquer mudança funcional exige:**
1. motivo registrado;
2. teste de regressão;
3. avaliação de compatibilidade;
4. nova versão quando necessário. Detalhes: `HYPERFRAMES_R6_1_IMPLEMENTATION_REPORT.md` (e R6.0/R6.0.1). Matriz completa: `hyperframes-capabilities.md`.

**Arquitetura APROVADA:**
- `motion.spec` (formato ÚNICO de autoria) → compilador Remotion → Remotion Plan v2;
- `motion.spec` → compilador HyperFrames → `bold.hyperframes.spec/0` (plano compilado);
- sem Intermediate Motion Plan comum.

| Item | Situação |
|---|---|
| Ferramenta | Framework open-source da HeyGen, licença **Apache-2.0** |
| Distribuição | Plugin do Claude Code e CLI npm |
| Na Skill | **Dependência EXTERNA.** A Skill não empacota nem redistribui; ela detecta (`bold doctor --module motion`) e fixa a versão (`tools.HYPERFRAMES_VERSION`) |
| Versão auditada | **0.8.114** (CLI no cache do npx; plugin com o monorepo-fonte) |
| Motor | chrome-headless-shell **152.0.7977.30** (pin interno do CLI, já presente em `~/.cache/hyperframes/chrome`) + puppeteer-core 25.12.0 |
| Node | ≥ 22 |

## Território

| Backend | Para quê |
|---|---|
| HYPERFRAMES | motion tipográfico, HTML/CSS, lettering, layout expressivo dirigido pelo texto |
| REMOTION | motion generalista, programático, orientado a dados (Core V1 congelado) |
| FUSION | motion nativo do Resolve e editabilidade tardia |

**Não é um segundo Remotion:** dados, mapas, câmera de cena e séries ficam no Remotion.

## Como funciona (0.8.114, verificado no código-fonte)

| Aspecto | Comportamento |
|---|---|
| Seek | Cada frame faz `window.__hf.seek(t)` → adaptadores do runtime (GSAP, CSS, WAAPI, …) → `totalTime(t)` na timeline registrada em `window.__timelines[id]` |
| Shim de tempo virtual | Sobrescreve `Date`, `performance.now` e `requestAnimationFrame` |
| Não virtualizado | `setTimeout`/`setInterval`. `Math.random` também não, em render local |
| Captura no macOS | `Page.captureScreenshot`. O `beginFrame` determinístico só existe no Linux headless-shell |
| `--no-browser-gpu` | SwiftShader (`--use-gl=angle --use-angle=swiftshader`) e força o modo screenshot |
| GPU | Caminho `auto`/hardware, com `drawElement` no macOS |
| Alpha | Fundo transparente via `setDefaultBackgroundColorOverride` + CSS `html,body` transparente. Captura em PNG quando o formato tem alpha |
| `png-sequence` | Diretório `frame_000001.png…` (base 1), **sem encode**. O preflight ainda exige ffmpeg |
| Tipografia | O compilador injeta `text-rendering: geometricPrecision` em **todos** os elementos |
| `snapshot` | Stills PNG com `page.screenshot({omitBackground:true})`, o mesmo caminho do harness de spikes |

## Regras

| # | RULE | RATIONALE |
|---|---|---|
| HF1 | **Nunca use `--format mov` (nem `webm`) para material que vai ao Resolve** | **VALIDATED na 0.8.114 + ffmpeg 8.1.1, VERSION-SENSITIVE.** O ramo ProRes retorna antes do bloco de tags de cor e não aplica matriz. A conversão implícita medida num still resulta em BT.601 (Y=578 para verde puro; BT.709 seria 691) e o arquivo sai sem tags. Revalide a cada versão |
| HF2 | Master = `render --format png-sequence --fps <FPS> --strict --no-browser-gpu` → **BOLD Delivery** (`alpha-4444-bt709`, R4) | O Delivery é dono do master, da cor, do alpha, do QC e do manifest. O HyperFrames só gera frames |
| HF3 | Rode sempre com `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 HYPERFRAMES_SKIP_SKILLS=1`, sem `GEMINI_API_KEY` (`snapshot --describe false`) | A telemetria (PostHog) vem **ligada** por padrão. Há checagem de update e auto-install a cada execução. O `snapshot` envia frames ao Gemini se houver chave |
| HF4 | **Sem `publish`, `cloud`, `auth`, `lambda`, `cloudrun`, `capture`, `figma`, `models`, `add`/`catalog` remoto, `upgrade`, `skills update`** | Esses comandos sobem conteúdo ou baixam algo |
| HF5 | **FONT GATE BOLD fail-closed ANTES do HyperFrames** (`hyperframes/adapter/font-gate.mjs`). **Estático:** manifesto `bold.fonts.manifest/0` (arquivo local + sha256) → `@font-face` só para arquivos do manifesto; nenhuma família fora dele; nenhuma família genérica; nenhum `local()`; nenhuma URL externa. **Dinâmico:** `CSS.getPlatformFontsForNode` exige que TODO glifo venha de fonte web do manifesto (pega fallback por glifo ausente) e que nenhuma requisição saia do loopback | O CLI local 0.8.114 é **fail-OPEN**: `failClosedFontFetch` só existe no render distribuído. Sem `@font-face`, ele usa a cópia embutida, baixa do Google ou captura do sistema. **Medido (R6.0.1):** o lint do HF passa "Inter" sem `@font-face` com 0/0, e para famílias desconhecidas sugere `local()`. O lint do HF não basta |
| HF6 | Fontes nunca na Skill. Toda execução usa `HYPERFRAMES_FONT_CACHE_DIR` **temporário e isolado**. O cache histórico `~/.cache/hyperframes/fonts` é **KEEP_EXTERNAL_DEPENDENCY / DO_NOT_TOUCH** | O cache histórico guarda cópias WOFF2 de fontes já usadas em projetos anteriores. A R6.0.1 provou que ele ficou intocado (listagem idêntica antes/depois) e que não satisfaz o fixture |
| HF7 | **Sem scripts remotos (CDN).** GSAP não é necessário: o runtime faz seek de qualquer objeto *timeline-like* (validado: lint 0/0 e snapshot sem GSAP) | O compilador **baixa e inlina** `<script src=http…>` em cada render. GSAP usa a "GSAP Standard License" (não OSI; licença a verificar em fonte oficial) |
| HF8 | Animação = **função pura de t** (frames → segundos), com seed (mulberry32) para qualquer aleatoriedade. Proibido `setTimeout`/`setInterval`, CSS transitions e `Math.random` | O shim não cobre timers nem random em render local. O lint acusa `Math.random`, `Date` e transitions |
| HF9 | Masters **só** com `--no-browser-gpu` | Medido: em GPU (Metal), 2 stills repetidos saem iguais, mas diferem do software em até 129 níveis (1.891 px). O lab já tinha medido 104/160 frames diferentes entre renders com GPU |
| HF10 | Golden tests do backend usam **o caminho de captura do próprio HyperFrames** | O harness de spikes difere do HF só na rasterização das bordas (`geometricPrecision` + pipeline): 824 px de 518 mil, com layout idêntico |
| HF11 | Fundo `html/body` **sem pintura**. Blend modes só entre camadas DA MESMA composição | Medido: `mix-blend-mode` sobre fundo transparente devolve a cor fonte e não mistura com o plano do NLE |
| HF12 | Não acione as skills do plugin para pedidos genéricos (`hyperframes`/`general-video` se declaram ponto de entrada obrigatório). A escolha passa pelo `decision-engine.md` | — |
| HF13 | Diretório do plugin e cache do npx são **somente leitura**. Atualização só por decisão explícita, nunca no meio de um job | — |
| HF14 | **NETWORK GUARD:** todo processo Node do CLI roda com `hyperframes/adapter/net-guard.mjs` pré-carregado (`NODE_OPTIONS=--import`), via `hyperframes/adapter/run.mjs`. Tcp/tls/http(s)/fetch/dns fora do loopback é **bloqueado e registrado**; qualquer tentativa = FAIL | Não depende de "estar offline". Provado no código real do HF: família sem `@font-face` → tentativa ao Google Fonts bloqueada → exit ≠ 0, sem fallback |
| HF15 | Render só via `renderPngSequence`, com **policy gate antes** (sem autorização estruturada, nenhum processo é iniciado). Comandos de rede (HF4) recusados no wrapper | Mesma regra de render/export do resto da Skill |

## Kit tipográfico (spikes R6.0: `hyperframes/spikes/kit.js`, neutro, sem dependências)

- `measure` faz o split **kerned** com `x[i] = largura(text[0..i]) − largura(char i)`.
  - A forma ingênua `largura(text[0..i))`, usada no lab antigo, **erra o par de kerning** (medido: 5,7 px em "WA" e 7,5 px em "AV").
  - Com a forma correta, as posições coincidem com o layout do browser (Δ = 0) e o estado final é idêntico ao texto contínuo (0 px).
- `baselineOf` mede a baseline real com uma sonda inline-block.
- Janela-máscara pela **caixa da fonte** (ascent + descent) posicionada na baseline: não corta acentos nem descendentes, mesmo com line-height apertado.
- `applyTracking` aplica tracking com compensação `margin-right: −ls`: o centro fica fixo (±0,5 px). Sem compensação, desliza 16,5 px.
- `textAnchors` gera âncoras derivadas das métricas (baseline, topo da tinta, avanço) para formas ligadas ao texto, sem coordenadas mágicas.
- `frameUnits` + `fitSize` cobrem a tipografia responsiva: u = 1% do menor lado e tamanho pela largura segura MEDIDA. É uma árvore DOM, com regras por proporção.
- `ready()` carrega `FontFace` + `document.fonts`. Família ausente → erro, sem fallback silencioso.

## Arquitetura de spec (APROVADA e IMPLEMENTADA na R6.1)

```
motion.spec (intenção ÚNICA, neutra; brief, tokens, tempo, regiões, refs, decision.backend)
      ├─→ compilador Remotion    → Remotion Plan v2      (congelado)
      └─→ compilador HyperFrames → HyperFrames Plan       (bold.hyperframes.spec/0 = plano COMPILADO, não formato de autoria)
compartilhado: resolvedores de tokens / tempo / regiões / referências (biblioteca, não um terceiro formato)
```

- **Não** consumir o `motion.spec` cru no HTML.
- **Não** criar um formato de autoria paralelo.
- **Não** criar agora um Intermediate Motion Plan comum: isso obrigaria a mexer no Remotion congelado.
- O `motion.spec` ganha **patterns tipográficos** que só o HyperFrames suporta. Exemplos: `TYPE_CASCADE`, `TYPE_MASK_LINES`, `TYPE_TRACK`, `TYPE_PLANE`, `TYPE_LOCKUP`.
- O `motion.spec` ganha também **referências de texto** (`title.baseline`, `title.line.N`, `title.char.N`, `title.ink.right`), estendendo a gramática da R5.6.
- Racional e entidades: `HYPERFRAMES_R6_0_AUDIT.md` §12.

## Backend V1 (R6.1)

```
motion.spec ── decision.backend = "hyperframes" ──► compileHyperFrames (hyperframes/src/compile.mjs, puro, Node)
   │  tokens/tempo/safe/grid/seed: bibliotecas do Remotion Core V1 (somente leitura)
   │  fontes: bold.fonts.manifest/0 → arquivo local + sha256 + cmap/fvar/GSUB/GPOS (sfnt.mjs)
   ▼
bold.hyperframes.spec/0 (PLANO COMPILADO; schema hyperframes/schema/…; validatePlan)
   ▼ generateHtml (html.mjs) + runtime.js (inline)                      → composição HTML/CSS/JS determinística
   ▼ adapter: writeJob → lint 0/0 → layout + gate dinâmico → stills (snapshot)   [sem autorização]
   ▼ adapter/render.mjs: POLICY GATE → png-sequence → auditoria → BOLD Delivery → QC → manifest   [autorização]
```

| Pattern | content | style (além de font/size/weight/style/color/align/features/variation) | motion (além de enter/delay/ease/exit/exit_ease) | Responsive |
|---|---|---|---|---|
| `TYPE_CASCADE` | `text` (1 linha) | `tracking` | `stagger`, `order` (start\|end\|center), `from` {x,y (em), rotate, scale, opacity}, `variation` {x,y,rotate,scale} via seed | region, anchor, align, size |
| `TYPE_MASK_LINES` | `lines[]` | `tracking`, `line_height` | `stagger`, `direction` (up\|down), `distance` (× janela), `fade` | + `lines` (re-quebra do mesmo texto) |
| `TYPE_TRACK` | `text` | — (tracking vem do motion) | `tracking_from`, `tracking_to` (em), `fade` | region, anchor, align, size |
| `TYPE_PLANE` | `lines[]` | `tracking`, `line_height`, `plate`, `padding` (em), `perspective` (u), `origin` [x,y], `rotate_x/y/z`, `translate_z` (u), `scale` | `from` {rotate_x/y/z, translate_x/y/z (u), scale, opacity} | + `lines`, `perspective` |
| `TYPE_LOCKUP` | `lines[]` + `shapes[]` | `tracking`, `line_height` | `text` (up\|fade\|none), `shape_delay`, `shape_duration`, `shape_stagger` | + `lines` |

**Validação estrita:**
- Qualquer outra chave → `UNSUPPORTED_PROPERTY`, com JSON path e pattern.
- **Defaults explícitos** em `DEFAULTS` (`compile.mjs`). Exemplos: `font.display`, `type.4`, `color.ink` (dos tokens, sem paleta própria), anchor `left`, `ease.out`, `motion.base`.
- Size: `type.N` | número (u) | `{fit: "width", max, min?}`. O fit é resolvido no browser pela largura medida.

**Formas do TYPE_LOCKUP:**
- `line {x1,y1,x2,y2}`, `rect {left,right,top,bottom, fill?}`, `circle {center, r, fill?}`.
- Cada coordenada é `{ref, offset}`: **sem coordenadas mágicas**.
- `thickness` e `r` em u, `stroke.X` ou `"Nem"`.

### Referências de texto (`hyperframes/src/refs.mjs`)

Gramática estrita e tipada (x \| y \| point), extensão compatível da gramática da R5.6:

```
<L>.baseline · <L>.ink.top|bottom|left|right · <L>.center · <L>.advance.left|right
<L>.line.N [.baseline | .ink.* | .center]          <L>.char.N [.baseline | .ink.* | .center]
<L>.shape.S.start|end|center                        <point>.x | .y
offset: número (u) | "Nem" (em da camada DONA) | "Npx"; point → [dx, dy]
```

- **Espaço:** FRAME SPACE (px), no estado de **repouso** do layout (sem as transformações de animação).
- **Quando é resolvida:**
  - **Compile:** existência, índices (contra as linhas do formato), tipo, ciclos e ordem topológica.
  - **Browser:** depois das fontes, valores a partir de medidas do DOM. As posições vêm de Range (kerning, features e eixos exatos); a tinta vem de canvas.
- **FAIL explícito:** `REF_SYNTAX`, `REF_MISSING_LAYER`, `REF_INDEX`, `REF_INCOMPATIBLE`, `REF_CIRCULAR` e `REF_IMPOSSIBLE`. São impossíveis: âncoras de TYPE_PLANE (projetado) e tinta com features de substituição ou eixos variáveis.

### Coordenadas

`motion.spec` (frações e células: `region` full\|safe\|{col,row,span,rows}, `anchor`, u = 1% do menor lado)
→ **plano** (caixa da região em px de frame, tamanhos em px, tempos em frames)
→ **runtime** (bloco posicionado pela âncora com a caixa da fonte; baselines = topo + ascent + k × line_height × size)
→ **CSS/DOM** (`position:absolute` em px dentro do `#root` W×H; `top = baseline − ascent`; `line-height = ascent + descent`).

Os formatos `16:9 | 9:16 | 1:1` vêm do mesmo spec (`--format`): L = lado longo, S = L × 9/16. Os overrides `responsive.{landscape|portrait|square}` são validados em todas as classes.

### Fontes, rede e CLI

- **Fontes:**
  - `composition.font_manifest` é **obrigatório**.
  - A família do token precisa estar no manifesto, com peso/estilo cobertos.
  - Glifo fora da fonte (`GLYPH_MISSING`), feature ou eixo inexistente (`FONT_FEATURE_UNAVAILABLE`), família genérica e URL → FAIL.
  - No HTML: gate estático; no browser: gate dinâmico.
- **Rede:** todo processo do HyperFrames passa por `adapter/run.mjs`, com HF3, network guard e cache de fontes **por job**. O cache histórico fica DO_NOT_TOUCH.
- **`bold render` (HyperFrames):**
  - `--verify-determinism` faz 2 sequências, compara SHA-256 frame a frame e dá FAIL antes do encode se algo divergir; o encode é um só.
  - `--keep-frames` preserva as sequências A/B ao lado do master.
  - `--concurrency` ≠ 1 dá FAIL (não se aplica).
  - O manifest final traz QC, alpha QC, composite QC (critérios da R6.0.1), `visual_qc: HUMAN_REVIEW_REQUIRED`, determinismo e o **trace** ordenado das etapas.
  - Todo processo do HF roda com `NODE_DISABLE_COMPILE_CACHE=1`, para que nada seja escrito fora do job.
- **CLI** (nenhum gera vídeo):
  - `bold render <spec>` roteia por `decision.backend`; para o HyperFrames, o policy gate vem **antes** de qualquer processo.
  - `bold motion validate|compile|inspect <spec> [--format]`.

## Fronteira do decision engine

| Pedido (genérico) | Backend | Por quê |
|---|---|---|
| animar cards com dados | Remotion | dados e padrões programáticos (CARD_BUILD, STAT_COUNTER) |
| mapa com rota e marcadores | Remotion | MAP_PATH e coordenadas compartilhadas (R5.6) |
| dashboard programático | Remotion | dados e séries |
| headline com lettering e perspectiva | HyperFrames | perspectiva CSS real + kerning/baseline medidos |
| palavra com transformação por caractere | HyperFrames | split kerned + estado independente por caractere |
| abertura tipográfica com layout HTML complexo | HyperFrames | layout por regras e medição real de texto |
| lower third simples editável no Resolve | Fusion | o editor ajusta no Resolve |
| **Híbrido:** fundo/câmera Remotion + headline tipográfica | Remotion **+** HyperFrames | **Um master por backend**, cada um com alpha, empilhados no NLE. Mesmos tokens, fps e resolução; o mesmo BOLD Delivery |
| **Híbrido:** lower third de série com lettering | HyperFrames (master) → Fusion (só posição e timing no Resolve) | O lettering fica fiel e a editabilidade é tardia |

## Sequência validada (R6.0.1)

Fixture sintético 960×540, 24 fps, 36 frames.

| Gate | Resultado |
|---|---|
| Contagem real | 36/36 nos 2 runs (`frame_000001…frame_000036`) |
| Determinismo | **SHA-256 idêntico frame a frame** |
| Alpha | RGBA straight; frame 1 totalmente transparente; placa a 50% = (32,72,160,128) |
| Delivery | BOLD Delivery `ALPHA_4444_BT709`: ProRes 4444 `ap4h`, `yuva444p12le`, BT.709 tv |
| QC | MACHINE QC e alpha QC PASS |
| Composite | Sobre 4 fundos: erro máx 2,93 níveis; borda 0,13–0,33 (straight) contra 33–44 (se fosse premultiplicado) |
| Rede | 0 tentativas |

## Fluxo de uma peça

0. `bold motion validate` → `bold motion inspect` (lint, layout, gate dinâmico, stills). Font gate estático + dinâmico (HF5): FAIL antes de qualquer render.
1. `lint`: 0 errors e 0 warnings.
2. `snapshot` ou `check` (stills): permitido.
3. **[autorização]** `png-sequence` (HF2/HF15) sob o guard (HF14) + `auditPngSequence` (contagem real, gaps, duplicados, SHA-256).
4. **[autorização]** BOLD Delivery (R4).
5. QC (`qc-methods.md`).

## Riscos

| Risco | Mitigação |
|---|---|
| Ferramenta 0.x | Pin, smoke test, módulo opcional, fallback Remotion |
| Rede implícita (fontes, CDN, telemetria, update) | HF3, HF5, HF7 |
| Variância de GPU e rasterização entre SOs | HF9; masters sempre na mesma máquina/SO; golden por backend |
| Windows | Nunca validado |
