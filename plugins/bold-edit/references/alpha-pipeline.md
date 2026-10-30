# Alpha pipeline

**Status: VIGENTE · MACHINE QC IMPLEMENTADO (R4)** em `bold qc alpha` (`core/qc/`). A composição no Resolve (§4) continua manual e fica para o sandbox (R7).

## 1. Regras

| RULE | RATIONALE |
|---|---|
| Overlay com transparência → **ProRes 4444**, `yuva444p12le`, `-alpha_bits 16`, `-vendor apl0` | É o formato de alpha real mais robusto no Resolve. O perfil 4444 trabalha em 12 bits nativos: pedir 10 bits ainda sai `yuva444p12le`, e isso não é desvio |
| Alpha **straight** (não premultiplicado) | É o que o Resolve assume por padrão para ProRes 4444. Material premultiplicado lido como straight ganha franja escura |
| Fundo **transparente na origem** (`html/body` sem pintura; composição sem background) | Fundo "assado" com matte simulado gera borda e bloqueia a composição |
| Sombra = alpha parcial com RGB escuro | Sombra achatada no RGB vira halo sobre fundo claro |
| Motion blur e média de amostras: **premultiply → média → unpremultiply** | Fazer a média em straight puxa cor de pixels transparentes (RGB "lixo") para a borda e gera halo |
| Cor sempre BT.709 explícito | Ver `color-pipeline.md` |
| No Resolve: **Alpha Mode = Straight** no clip | Confirme no readback |
| Title-safe (padrão 10%) | Sombra incluída no cálculo |

## 2. Procedimento de entrega

1. Componha sobre fundo transparente. Mantenha também uma composição de preview com fundo (vídeo real ou xadrez) só para inspeção visual.
2. Renderize a sequência PNG RGBA. **É render: precisa de autorização** (`render-policy.md`).
3. Se houver blur sub-frame, faça a média premultiplicada (`motion-blur.md`).
4. Faça o encode no perfil `alpha-4444-bt709` (`color-pipeline.md` §3).
5. Rode o QC (§3).
6. Importe pelo File Path, faça o append, defina Alpha Mode Straight e faça o readback.
7. Compare a composição prevista com a composição no Resolve (§4).

## 3. Bateria de QC (arquivo)

| # | Verificação | Critério de PASS |
|---|---|---|
| 1 | `ffprobe` | `prores` · profile 4444 · `pix_fmt yuva444p12le` · 1 stream de vídeo · tags BT.709 |
| 2 | `ffprobe -count_frames` | Contagem **real** = frames esperados. O cabeçalho sozinho não basta |
| 3 | Primeiro e último frames | Inteiramente alpha 0 quando o design prevê entrada e saída a partir do vazio |
| 4 | Cantos `(0,0)`, `(W−1,0)`, `(0,H−1)`, `(W−1,H−1)` | RGBA = 0,0,0,0 (salvo design de tela cheia) |
| 5 | Soma por frame | `α0 + α255 + parcial = W×H` em todos os frames amostrados |
| 6 | Sombras | Existem pixels com `0 < α < 255` e RGB escuro onde há sombra |
| 7 | **Straight × premultiplied** | Na borda com α baixo, o RGB **mantém** a cor do objeto. Se o RGB cair proporcionalmente ao α, o material está premultiplicado → FAIL |
| 8 | Ausência de matte | Nenhum retângulo de α uniforme em volta de assets |
| 9 | Halo | Composto sobre fundo claro **e** escuro, as bordas ficam sem franja |

**HALO = FAIL.** PARE, não improvise correção na timeline e volte à origem (fundo, média, premultiply).

## 4. Composição prevista × composição no Resolve

1. Exporte stills do Resolve em 3 frames ou mais: entrada, hold e saída.
2. Calcule a composição **prevista**: o fundo do mesmo frame (still sem o overlay) combinado com o PNG fonte usando a fórmula straight `out = src·α + bg·(1−α)`.
3. Compare por região:

| Região | PASS |
|---|---|
| Fundo (α = 0) | erro médio **0**: sem matte nem véu |
| Bordas | erro médio baixo (≈ 1–2 níveis) e máximo moderado: sem halo |
| Sólidos | erro ≈ 0 (exceto o artefato de croma de 1 px, `davinci-safety.md` V3) |
| Hipótese premultiplied | o erro deve ser **muito maior** que o da hipótese straight (prova de que o Resolve lê straight) |

**FAIL:** fundo com erro maior que 0, halo nas bordas ou hipótese premultiplied melhor que straight.

## 5. Riscos e fallback

| Risco | Detecção | Fallback |
|---|---|---|
| Ferramenta exporta premultiplicado | Item 7 | Unpremultiply no encode, ou corrija a configuração na origem |
| Sombra recortada fora da área segura | Contagem de pixels α>0 fora da title-safe | Reposicione ou reduza na origem |
| Overlay compete com o assunto do plano | Stills sobre o footage real | Reduza escala, mova, reforce o contraste (sombra) e valide de novo |
| Background de Fusion premultiplicado | Comparação com material straight | Ver `fusion.md` |

## 6. Implementação real (R4): `bold qc alpha <arquivo>`

Os frames amostrados (padrão 5, sempre com o primeiro e o último) são decodificados para RGBA 8 bit (`core/qc/frames.mjs`) e analisados em `core/qc/alpha.mjs`.

| Check | PASS | Falha |
|---|---|---|
| `alpha.present` | `pix_fmt` com canal alpha | FAIL |
| `alpha.transparency` | algum pixel com α < 255 | **FAIL: alpha totalmente opaco** |
| `alpha.pixel_sum` | α0 + α255 + parcial = W×H | FAIL |
| `alpha.partial` | existe alpha parcial | WARNING: alpha binário (bordas duras) |
| `alpha.corners` | α = 0 nos 4 cantos | WARNING (design de tela cheia?) |
| `alpha.first_frame` / `alpha.last_frame` | vazio, ou informativo | FAIL só com `--expect-empty-ends` |
| `alpha.edges` | `CLEAN_STRAIGHT_EDGES` | `PREMULTIPLIED_SUSPECTED` (FAIL) · `GROSS_HALO` (FAIL) · `POSSIBLE_HALO` (WARNING) |

**Heurística de borda**
1. Considera os pixels com α ∈ [160, 254].
2. Para cada um, procura o pixel opaco mais próximo, num raio ≤ 8.
3. Compara:
   - `straight_dev = |RGB_borda − RGB_opaco|`;
   - `premult_dev = |RGB_borda − RGB_opaco·α|`.
4. Classifica:
   - straight ≤ 16 → limpo;
   - premult < straight/2 → material premultiplicado;
   - straight > 48 → halo grosseiro;
   - entre os dois → possível halo.
5. Sombras (α baixo) ficam fora da amostra.

Com menos de 20 pixels de borda, o resultado é `INSUFFICIENT_EDGE_SAMPLE` (PASS, e o VISUAL QC decide).

**MACHINE QC ≠ VISUAL QC.** A saída sempre traz `visual_qc: PENDING`. A heurística não prova que a composição sobre o fundo real está correta.

**Fato observado:** no ffmpeg 8.1.1, o filtro `premultiply` sobre `rgba` 8 bit **não** premultiplicou. Sobre `rgba64le` funciona, e é o que o blur usa. Por isso o fixture premultiplicado de teste é gerado pela fórmula (RGB × α).

## 7. Revisão da heurística de borda (R5)

O primeiro render real de um lower third com **placa semitransparente** gerou falso positivo na regra da R4: a placa (α≈217) era tratada como "borda" e comparada com o texto branco. A regra atual (`core/qc/alpha.mjs`) **segue o gradiente do alpha**:

1. **Candidato:** α ∈ [96, 254], |∇α| (Sobel) ≥ 16. Para **fora**, o α cai ≥ 8 já nos 2 primeiros px e desce sem subir até α = 0 em ≤ 8 px. Isso define a silhueta contra o fundo transparente.
2. **Bordas puladas:** a borda dura de uma região semitransparente (o α em +2 px para dentro não sobe) é **pulada**, porque não é mensurável. O total vai em `skipped_semitransparent_steps`.
3. **Referência:** caminhando para **dentro** pelo gradiente até o α parar de subir, ou até 255.
4. **Desvio premultiplicado:** `premult_dev = |E − R·(α_E/α_R)|`.

Ficam fora da amostra: texto sobre placa, interior de placas e bordas sobre sombra. Continuam detectados (testes R4 e R5): premultiplicado entregue como straight (`PREMULTIPLIED_SUSPECTED`) e média sem premultiply (`GROSS_HALO`).

**Limite conhecido:** em resolução mínima, com o texto encostando na borda da placa, o resultado pode ser `POSSIBLE_HALO` (WARNING). Isso significa "confirme no VISUAL QC", e nunca vira FAIL.
