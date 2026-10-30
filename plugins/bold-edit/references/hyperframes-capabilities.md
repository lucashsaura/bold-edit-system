# Matriz de capacidades tipográficas: REMOTION V1 × HYPERFRAMES × FUSION (R6.0 · atualizada na R6.0.1)

**Valores:** STRONG · SUPPORTED · LIMITED · UNSUPPORTED · UNKNOWN.

**De onde vem a evidência de cada coluna:**
- **REMOTION V1** = o subset **congelado** (`remotion-backend.md` §3), ou seja, o que o spec aceita hoje. Não é o que o React/Chrome poderia fazer.
- **HYPERFRAMES** = medido nos spikes R6.0, com o Chrome 152 do HyperFrames 0.8.114 em modo `--no-browser-gpu` (`tests/hyperframes/spikes.test.mjs`), mais a leitura do código.
- **FUSION** = só conhecimento de produto, **não validado nesta Skill** (`fusion.md`: STATUS EXPERIMENTAL). Por isso nunca recebe STRONG.

| Capacidade | REMOTION V1 | HYPERFRAMES | FUSION |
|---|---|---|---|
| TEXT REVEAL | **STRONG**: TITLE_REVEAL/LOWER_THIRD com reveal up/down/left/right/fade/scale | **STRONG**: qualquer CSS/SVG em função de t (spikes A/B) | SUPPORTED: Text+ com máscaras (produto) |
| LINE REVEAL | **STRONG**: `split: line` com máscara por linha | **STRONG**: spike B; baseline final = bloco CSS e 0 px de diferença | SUPPORTED: produto |
| WORD REVEAL | **STRONG**: `split: word` | **STRONG**: mesmo mecanismo do spike A/B (por palavra) | LIMITED: Follower por caractere; por palavra exige ranges (produto) |
| CHAR REVEAL | SUPPORTED: `split: char` com spans inline. **O kerning se perde no split** (o mesmo padrão do controle negativo do spike A) | **STRONG**: spike A; split kerned com Δx = 0 em relação ao layout do browser e estado final = texto contínuo | SUPPORTED: Follower (produto) |
| MASKED TEXT | **STRONG**: máscaras por unidade e região | **STRONG**: spike B; janela pela caixa da fonte, sem cortar acento/descendente. O controle negativo prova que o corte é detectável | SUPPORTED: máscaras de nó (produto) |
| TRACKING ANIMATION | LIMITED: `tracking_from → tracking` em em, **sem compensação**; o bloco centrado desliza | **STRONG**: spike C; centro fixo ±0,5 px com compensação (sem ela, desliza 16,5 px) | SUPPORTED: `CharacterSpacing` (fator medido em `fusion.md`) |
| KERNING CONTROL | UNSUPPORTED: não exposto no subset | **STRONG**: probe; `font-kerning` normal/none muda "AVAVAV" de 146,9 para 164,5 px; split preserva os pares | LIMITED: kerning manual por caractere (produto) |
| BASELINE CONTROL | LIMITED: posição por região/âncora de caixa, não por baseline | **STRONG**: `baselineOf` + posicionamento pela baseline; spikes B e E (régua a baseline + 0,12em, ±1 px nos pixels) | SUPPORTED: `CenterOnBaseOfFirstLine` (`fusion.md`) |
| VARIABLE FONT | UNSUPPORTED: o spec só tem pesos de token | **STRONG**: probe; peso 100 → 900 e eixo `wght` 300 → 800 contínuos (fonte variável local) | UNKNOWN |
| TEXT ON PATH | UNSUPPORTED | **SUPPORTED**: probe; SVG `textPath` renderiza (comprimento 177 px, tinta presente). A animação do offset não foi testada | SUPPORTED: Text+ Layout Path (produto) |
| TEXT DISTORTION | UNSUPPORTED | **SUPPORTED**: probe; `feDisplacementMap` + `feTurbulence` com seed renderiza. Determinismo: still byte-idêntico | SUPPORTED: nós de distorção (produto) |
| PERSPECTIVE | UNSUPPORTED: câmera 2D só (pan/zoom/rotate) | **STRONG**: spike D; alturas das bordas = projeção CSS (160/248 px medidos contra 158,9/249,0 previstos) | SUPPORTED: Text3D/3D (produto) |
| 3D-LIKE TRANSFORM | UNSUPPORTED | SUPPORTED: `rotateX/Y`, `preserve-3d` (spike D; o snapshot do HF tem orbit). 3D com oclusão não foi testado | SUPPORTED: 3D nativo (produto) |
| PER-CHAR TRANSFORM | LIMITED: reveal + stagger iguais para todos | **STRONG**: spike A; posição, rotação, escala, opacidade e delay independentes (7 caracteres em voo, todos distintos) | SUPPORTED: Follower (produto) |
| BLEND MODES | UNSUPPORTED no spec (só interno: grão `overlay`) | **LIMITED**: dentro da composição funciona (multiply = 128,0,0); **sobre transparente não mistura com o NLE** (devolve a cor fonte) | **STRONG** sobre o footage (produto; blend no próprio Resolve) |
| CLIPPING | SUPPORTED: `clip-path` interno dos reveals | **STRONG**: probe; `clip-path` polygon com alpha 0/255 exato | SUPPORTED |
| CSS FILTERS | UNSUPPORTED no spec | **SUPPORTED**: probe; `blur` gera alpha parcial straight. Custo e determinismo por still OK; sequência não testada | n/a (nós próprios) |
| SVG TEXT | UNSUPPORTED | **SUPPORTED**: probes textPath e distortion | n/a |
| SVG MASK | UNSUPPORTED no spec | **STRONG**: probe; `<mask>` com alpha 0/255 exato. `mask-image` em gradiente dá alpha monotônico | n/a |
| HTML LAYOUT | LIMITED: grid/regiões do spec, sem fluxo de texto | **STRONG**: layout do browser (flex, quebra, line-height) usado como referência nos spikes B/F | UNSUPPORTED |
| RESPONSIVE TYPOGRAPHY | SUPPORTED: `u` = 1% do menor lado; regiões por aspecto | **STRONG**: spike F; uma árvore DOM e regras por proporção (1/2/3 linhas em 16:9/1:1/9:16), tinta dentro da safe area | LIMITED: comps por formato (produto) |
| AUTO TEXT MEASUREMENT | UNSUPPORTED: sem medição | **STRONG**: probe; canvas `measureText` = layout do DOM (182,03 = 182,03 px); `fitSize` por busca binária. O runtime HF também expõe `pretext`/`fitTextFontSize` | LIMITED: métricas via tabelas da fonte, fora do Resolve (`fusion.md`) |
| MULTI-LINE LAYOUT | SUPPORTED: linhas explícitas no spec | **STRONG**: spike B (baselines = bloco CSS) e spike F (quebra por regra) | SUPPORTED |
| TEXT + SHAPE RELATIONSHIP | SUPPORTED: R5.6 com refs `.anchor`/`.center` de **caixa** | **STRONG**: spike E; régua, caixa e marcador derivados das **métricas do texto** (baseline, tinta, altura-x), conferidos nos pixels em 3 escalas × 3 aspectos | LIMITED: expressões/links manuais |
| LETTERING / DISPLAY TYPE | LIMITED: título com split/tracking simples | **STRONG**: combinação de A, B, C, D e E | SUPPORTED: produto |
| ALPHA OUTPUT | **STRONG**: R5 (ALPHA_4444_BT709 via Delivery, QC de bordas) | **STRONG** (R6.0.1): **sequência real** RGBA straight (placa 50% = 32,72,160,128; frame 1 vazio) → Delivery 4444 → alpha QC PASS; composite em 4 fundos com máx 2,93 níveis e borda straight 0,13–0,33 contra 33–44 se premultiplicado | LIMITED: o Background é **premultiplicado** (`fusion.md`) |
| DETERMINISM | **STRONG**: R5 (frames idênticos, manifest) | **STRONG** (R6.0.1): 2 renders reais `png-sequence --strict --no-browser-gpu` no Chrome 152, **36/36 frames com SHA-256 idêntico**; versões, seed e hashes no manifest. Exige software GL (GPU difere até 129 níveis) | UNKNOWN |
| RESOLVE DELIVERY | **STRONG**: BOLD Delivery (R4/R5) | **STRONG** (R6.0.1, sem abrir o Resolve): `png-sequence` → BOLD Delivery EXISTENTE → ProRes 4444 `ap4h` `yuva444p12le` BT.709 tv, validator e QC PASS. `--format mov`/`webm` do HF: **UNSUPPORTED** (BT.601 sem tags, HF1) | **STRONG**: nativo |

## Leitura

1. **Onde o HyperFrames supera o Remotion V1:**
   - kerning e baseline;
   - split por caractere fiel e transform independente por caractere;
   - tracking sem deslizar;
   - perspectiva e 3D-like;
   - variable fonts e OpenType;
   - SVG text, máscaras e filtros;
   - medição automática de texto;
   - layout HTML e responsivo dirigido pelo texto.
2. **Onde o Remotion continua melhor:**
   - dados e padrões programáticos;
   - mapas e coordenadas compartilhadas;
   - câmera 2D com overscan provado;
   - pipeline de alpha/QC/determinismo já provado em sequência;
   - spec estrito congelado.
3. **Onde a Fusion vence:** blend com o footage e editabilidade no Resolve. Nenhuma linha da Fusion foi validada aqui.
4. **Duplicação a evitar:** TEXT/LINE/WORD REVEAL simples já são STRONG nos dois. A regra é Remotion quando a peça é programática e HyperFrames quando a tipografia é o elemento.

## Exposição no backend V1 (R6.1)

A coluna HYPERFRAMES mede o **motor**. Esta tabela diz o que o **backend V1** realmente expõe via `motion.spec`. Fora daqui = não suportado no V1 (FAIL explícito, nunca ignorado).

| Capacidade | Pattern / propriedade V1 | Evidência R6.1 |
|---|---|---|
| CHAR REVEAL · PER-CHAR TRANSFORM | `TYPE_CASCADE` (`from`, `variation` com seed, `order`, `stagger`) | posições = layout contínuo (Δ = 0), estado final = texto contínuo (0 px); estado independente por caractere |
| LINE REVEAL · MASKED TEXT | `TYPE_MASK_LINES` (janela pela caixa da fonte) | baselines = line_height × size; final idêntico ao texto sem máscara com line-height 0,9 |
| TRACKING ANIMATION | `TYPE_TRACK` (compensação margin-right) | centro ±0,5 px; borda direita fixa |
| PERSPECTIVE · 3D-LIKE | `TYPE_PLANE` (perspective, rotate_x/y/z, translate_z, origin) | bordas 78/96 px contra 77,4/97,1 previstos |
| TEXT + SHAPE · BASELINE CONTROL | `TYPE_LOCKUP` + refs de texto | régua/moldura/marcador nos pixels (±1–1,5 px); ref forma→forma |
| KERNING · OPENTYPE · VARIABLE | `style.features` / `style.variation` / `style.weight`, conferidos na fonte (GSUB/GPOS/fvar) | feature/eixo inexistente → FAIL; peso fora do eixo → FAIL |
| RESPONSIVE · AUTO MEASUREMENT | `--format`, `responsive.{classe}`, `size: {fit}` | 3 formatos na safe area, hierarquia preservada |
| ALPHA · DETERMINISM · DELIVERY | plano + runtime puros; `bold render --verify-determinism` | **R6.2 ponta a ponta pelo orquestrador:** 2 sequências 48/48 SHA-256 idênticas, ProRes 4444 `ap4h` `yuva444p12le` BT.709 tv, machine/alpha/composite QC PASS, 0 tentativas de rede |
| WORD REVEAL | **não exposto** (use MASK_LINES por linha ou CASCADE por caractere) | — |
| TEXT ON PATH · DISTORTION · SVG TEXT/MASK · CSS FILTERS · BLEND | **não expostos no V1** (motor capaz; sem pattern) | — |
| Imagens/vídeo/áudio/URLs dentro da composição | **não suportados no V1** (`assets: []`) | `composition.assets` → FAIL |
