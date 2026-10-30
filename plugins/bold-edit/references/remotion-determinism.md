# Remotion — determinismo de render

**Status: APLICADO no backend R5** (`references/remotion-backend.md`), validado com Remotion 4.0.290. A licença continua **PENDENTE**, e o Remotion é dependência externa.
Objetivo: dois renders completos do mesmo código devem produzir frames **bit-idênticos**.

## Regras

| # | RULE | RATIONALE | VALIDATION |
|---|---|---|---|
| D1 | **Versões fixadas** (`remotion`, `@remotion/*` na mesma versão exata; Node fixado) | Mudanças de versão alteram raster, encoder e cor | `package.json` sem `^`/`~`; doctor confere o pin |
| D2 | **Seeds determinísticos** para todo aleatório (PRNG com seed, `feTurbulence seed`) | `Math.random()` muda a cada render | Duas execuções → mesmo resultado |
| D3 | **Índice de frame inteiro** para lógica discreta: troca de imagem, frame de gravação de tela, texto | Em renders por sub-frame, o tempo é fracionário; usar o tempo fracionário para indexar imagens gera "fantasma" | Inspecione os frames de troca |
| D4 | **Tabelas de sub-frame pré-computadas** para câmeras e curvas (ex.: 1/8 de frame) | Frame e sub-frame precisam ver a mesma câmera; sem isso, o blur e o frame "nítido" divergem | Compare o frame nítido com a média |
| D5 | **Amostragem de curva sem DOM** (arc-length analítico de bezier) quando o resultado alimenta posição | `getPointAtLength` depende do engine de layout e pode variar | Pontos idênticos entre execuções |
| D6 | **Nenhum elemento cruzando o plano da câmera** (`z + câmeraZ` bem abaixo da `perspective`) | Cruzar o plano gera saída indefinida e não determinística | Assert no código da câmera |
| D7 | **Sem CSS `filter: blur()` em elementos 3D em movimento** | Variou entre renders. O blur deve vir da média de sub-frames | Grep no código; framemd5 |
| D8 | **`--gl=swangle` + `--concurrency=1`** para composições com CSS-3D (perspective / preserve-3d) | GPU e workers paralelos alteraram o raster de camadas 3D entre renders | framemd5 de dois renders |
| D9 | **Footage congelado durante sub-frames** (`<Freeze frame={frameDeSaída} active={sub>1}>`) | Sem isso, a média mistura frames vizinhos do vídeo | O frame do footage é o mesmo em todas as amostras |
| D10 | **Render quente para o master** | O primeiro render depois de mudar o código pode diferir (cache frio) | Re-renderize quente e confira contra um segundo render completo |
| D11 | **Render em chunks** quando houver muitos sub-frames | 16 sub-frames × N frames em PNG 16 bits enchem o disco | Por chunk: renderizar, fazer a média, selecionar, apagar o chunk (caminho literal) |
| D12 | **Seleção de frames por nome de arquivo**, não por decimação do ffmpeg (`select`/`setpts`) | A decimação perdeu frames | Contagem = esperado |
| D13 | **Nunca usar o encoder de vídeo do Remotion para o Resolve** (`--codec prores`/h264 4.0.290 gravam BT.601 sem tag) | Regressão de cor (`color-pipeline.md`) | Sequência PNG → encode BT.709 |
| D14 | **Sem trilha de áudio fantasma** | Alguns renders anexam PCM silencioso | Remova com `-an` |

## Procedimento de verificação de determinismo
1. **[render autorizado]** Render A completo, como sequência PNG ou master.
2. **[render autorizado]** Render B completo, em processo novo.
3. Calcule `ffmpeg -i A -f framemd5 -` e `… B …` e compare. **PASS = idênticos.**
4. **FAIL:** encontre o primeiro frame divergente e verifique D2–D8 nessa região.

## Riscos e fallback
- **swangle é lento.** Use só onde há 3D. Composições 2D podem usar o GL padrão, desde que o framemd5 confirme.
- **Disco:** cada execução deixa GBs de PNG no diretório temporário. Apague pelo caminho literal depois de validar, nunca com glob amplo.
- **Licença Remotion PENDENTE:** não empacote nem redistribua. Cada projeto instala no próprio diretório com aprovação.

## Aplicação no backend R5

| Regra | Onde |
|---|---|
| D1 versões | `remotion/package.json` (peerDependencies fixadas); `detectRemotion` exige 4.0.x com bundler e renderer iguais |
| D2 seeds | `prng`, `hashSeed`, `roughRectPolygon(seed)`, `feTurbulence seed` derivado de `composition.seed` |
| D3 frame inteiro | os patterns usam o tempo em frames de saída; o sub-frame é calculado só em `SpecComposition` (`subframeTime`) |
| D5 sem DOM | `catmullRom`, `polylineLength`, `pointAt` (`core/geometry.ts`) |
| D7 sem CSS blur 3D | nenhum `filter: blur()` nos patterns; o blur vem dos sub-frames |
| D8 swangle + concurrency 1 | `renderPlanFrames` (padrão) |
| D12 seleção por nome | `bold delivery blur` (R4) |
| D13 encode do Remotion proibido | o adapter só gera PNG; o master sai do BOLD Delivery |

**Verificação automatizada:** `tests/remotion/render.test.mjs` exige framemd5 idêntico em dois renders da mesma spec.
