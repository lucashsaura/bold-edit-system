# Decision engine — Remotion × HyperFrames × Fusion

**Status: VIGENTE (método).** O score gera uma **recomendação**, não uma decisão cega. A decisão final é do agente, explicada e registrada.

**Implementação (R9):** `motion-router.md` (`editorial/src/router.mjs`, `bold motion route`) aplica estes critérios e regras e acrescenta **DAVINCI_NATIVE** (ajustes simples, inserção, corte, áudio) e **NONE** (sem valor). A regra 6 (estado real) vira só **fallback declarado**: a disponibilidade nunca muda a escolha.

## 1. Critérios (0–3)

| Critério | 0 | 3 |
|---|---|---|
| COMPLEXITY | 1 camada, movimento simples | muitas camadas, câmera, sistemas simultâneos |
| EDITABILITY | ninguém vai mexer depois | o editor vai ajustar texto/tempo **dentro do Resolve** |
| ALPHA | opaco | overlay com alpha real sobre footage |
| REUSABILITY | peça única | série, N variações, parametrização |
| RENDER_COST | barato | sub-frames, 3D, longa duração |
| RESOLVE_DEPENDENCY | independente | depende de algo do Resolve (grade, tracking, timing vivo) |
| DATA_DRIVEN | conteúdo fixo | listas, números, mapas, JSON |
| VISUAL_COMPLEXITY | básico | tipografia avançada, perspectiva, profundidade, textura |

## 2. Perfis de aptidão (estado validado no piloto)

| Critério alto → | Remotion | HyperFrames | Fusion |
|---|---|---|---|
| COMPLEXITY | ●●● câmeras 2D/3D, mapas, aberturas | ●● | ● |
| EDITABILITY no Resolve | ● re-render | ● re-render (texto = 1 linha) | ●●● nativo |
| ALPHA | ●●● pipeline validado | ●●● pipeline validado | ●●● nativo (Background premultiplicado) |
| REUSABILITY | ●●● props e composições | ●● kit + corpo da peça | ●● comps/macros por builder |
| RENDER_COST baixo | ● | ●● | ●●● sem render externo |
| RESOLVE_DEPENDENCY | ● | ● | ●●● |
| DATA_DRIVEN | ●●● | ●● | ● |
| VISUAL_COMPLEXITY tipográfica | ●● | ●●● baseline e kerning exatos | ● |

## 3. Regras iniciais

1. **REMOTION:** preferido para sistemas programáticos, mapas, UI, dados, cards, câmeras, séries e composições reutilizáveis (DATA_DRIVEN, REUSABILITY ou COMPLEXITY ≥ 2).
2. **HYPERFRAMES:** preferido para tipografia avançada, lettering, motion HTML/CSS, máscaras tipográficas e layouts em que o controle de baseline e kerning é central (VISUAL_COMPLEXITY tipográfica = 3 e COMPLEXITY ≤ 2).
3. **FUSION:** preferido quando EDITABILITY e RESOLVE_DEPENDENCY são altos (≥ 2) **e** COMPLEXITY ≤ 1.
4. **Desempate:** fica o backend com o **menor custo de alteração tardia** para a mudança mais provável:
   - texto → Fusion ou HyperFrames;
   - dados → Remotion;
   - timing vivo → Fusion.
5. **Projetos híbridos são permitidos** (por exemplo, câmera e fundo no Remotion e título no HyperFrames), desde que haja **um único pipeline de entrega** (BT.709, `color-pipeline.md`) e tokens compartilhados.
6. **Estado real pesa:**
   - Fusion é EXPERIMENTAL nesta Skill (`fusion.md`).
   - HyperFrames é dependência externa opcional (`hyperframes.md`).
   - Se o backend preferido não está disponível (`bold doctor`), use o **fallback** declarado.
7. **Linguagem visual por entrega:** dentro de uma mesma peça ou série, misturar sistemas só com intenção. Um elemento compartilhado (assinatura, abertura) pode amarrar entregas feitas em sistemas diferentes.

## 4. Procedimento

1. Pontue os 8 critérios (0–3) a partir do brief e da spec.
2. Aplique as regras do §3 e anote qual regra decidiu.
3. Confira a disponibilidade (`bold doctor --module motion` ou `--module davinci`).
4. Registre no `motion.spec.json`:
   ```json
   "decision": { "backend": "remotion", "scores": { "COMPLEXITY": 3, "DATA_DRIVEN": 2, "EDITABILITY": 1 },
                 "rationale": "mapa com rota e câmera; dados de cidades; editor não muda texto no Resolve" }
   ```
   Escreva o fallback no `rationale` (por exemplo: "fallback: HyperFrames se Remotion indisponível; perde câmera 3D").
5. Em peças grandes ou novas, **mostre a decisão** ao usuário antes de implementar.

## 5. Exemplos

| Pedido | Recomendação | Por quê | Fallback |
|---|---|---|---|
| abertura institucional de 6 s | Remotion (+ título HyperFrames opcional) | COMPLEXITY 3, câmera, camadas | HyperFrames 2D, sem câmera 3D |
| lower third que o editor vai trocar | Fusion | EDITABILITY 3, RESOLVE_DEP 2, COMPLEXITY 1 | Remotion com props + re-render |
| lower third de série, design rico | Remotion ou HyperFrames | REUSABILITY 3, alpha | Fusion simplificado |
| animação de lettering | HyperFrames | tipografia é o elemento | Remotion com medição de texto |
| animação de interface | Remotion (`ui-surface-3d`) | dados + superfícies | HyperFrames 2D |
| transição sobre footage | Fusion (simples) ou Remotion (gráfica) | RESOLVE_DEPENDENCY | — |
| mapa animado | Remotion | DATA_DRIVEN, rota, câmera | — |
| explicar um benefício | Remotion (cards, ícones, contador) | DATA_DRIVEN, REUSABILITY | HyperFrames |

## 6. Fail conditions
- Decisão sem `rationale`, ou um score aplicado como algoritmo sem leitura do contexto.
- Backend escolhido indisponível e sem fallback declarado.
- Pipeline de entrega diferente por backend no mesmo projeto, o que gera cor divergente.
