# Motion system

**Status: VIGENTE (método).** O primeiro backend real existe (R5, Remotion: `references/remotion-backend.md`), com 10 patterns implementados. A recomendação de backend por intenção é o **Motion Router V1** (R9, `motion-router.md`), a partir dos planos do `editorial-engine.md`; o `motion.spec` continua com `decision.backend` explícito.

## 1. Princípio: SYSTEM ≠ TEMPLATE

- **RULE:** uma referência é fonte de **regras**, não de layout para copiar. O caminho preferido é REFERENCE → RULES → NEW SOLUTION. REFERENCE → COPY TEMPLATE só vale quando o pedido exige literalmente uma cópia ou uma adaptação.
- **RATIONALE:** template copiado repete a coreografia e ignora o footage, a fala e o enquadramento do plano. Um sistema dá unidade (mesma família) sem repetição.
- **VALIDATION:** peças da mesma série compartilham tokens e comportamento, mas variam layout e coreografia conforme o conteúdo.
- **FAIL CONDITION:** duas peças da série com o mesmo layout e a mesma coreografia, só com o texto trocado (salvo pedido explícito).

## 2. Pipeline

```
BRIEF → REFERENCE ANALYSIS → RULE EXTRACTION → MOTION SPEC → BACKEND DECISION
      → NEW SOLUTION → STILLS QC → RENDER* → VALIDATION → INTEGRATION*
                                     (* exigem autorização / protocolo próprio)
```

| Etapa | Saída | Gate |
|---|---|---|
| **BRIEF** | objetivo, tipo, duração **em frames**, fps, alpha/opaco, onde entra, texto **aprovado e literal** | texto ou duração ausente → perguntar |
| **REFERENCE ANALYSIS** | leitura estática e temporal (`reference-analysis.md`) | sem referência → o sistema do projeto (tokens) é a referência |
| **RULE EXTRACTION** | regras curtas e testáveis em `motion.spec.reference.extracted_rules` | regra vaga ("ficar bonito") → reescreva como regra testável |
| **MOTION SPEC** | `motion.spec.json` (schema `bold.motion.spec/0`) + `tokens.json` do projeto | schema válido (QC nível 0) |
| **BACKEND DECISION** | `decision.backend/scores/rationale` + fallback (`decision-engine.md`) | mostrar ao usuário antes de implementar algo grande |
| **NEW SOLUTION** | código no backend escolhido, com primitivas e tokens | — |
| **STILLS QC** | QC níveis 0–1 (`qc-methods.md`) | sem PASS → não peça render |
| **RENDER** | sequência PNG → encode BT.709 (`color-pipeline.md`, `alpha-pipeline.md`) | **autorização explícita** (`render-policy.md`) |
| **VALIDATION** | QC nível 2 (+3 se houver vídeo autorizado) | FAIL → volte para a solução |
| **INTEGRATION** | Resolve com o protocolo de `davinci-safety.md`, QC nível 4 | checkpoint + gate + readback |

## 3. Regras de design (genéricas, já validadas)

1. **Tokens antes de animar:** cor, tipografia, espaçamento (unidade 8), raios, easing, durações. Nada de cor fora dos tokens.
2. **Hierarquia inequívoca:** um protagonista por quadro. Apoios em níveis 2 e 3, com hierarquia por peso, tamanho e opacidade.
3. **Movimento com intenção:** antecipação → ação → assentamento → hold limpo → saída pela **mesma lógica** da entrada.
4. **Sincronia com a fala:** cues medidos no áudio real (transcrição com timecode ou envelope de áudio), nunca estimados.
5. **Footage-aware:** o motion não compete com o assunto do plano. Valide sobre o frame real; quando cobrir o assunto, reduza a escala ou reposicione.
6. **Title-safe** (padrão 10%), com sombra incluída.
7. **Evitar comportamento de template:** glitch, RGB split, partículas, 3D gratuito, bounce/elastic, zoom agressivo, motion blur pesado, "efeito reel". Use só com intenção explícita do brief.
8. **Um elemento estrutural pode ter vários papéis:** por exemplo, uma linha que funciona como eixo, máscara, reveal ou divisor. Isso amarra a série sem repetir o layout. Nunca use como decoração pura.
9. **Texto literal:** use exatamente o texto aprovado. Divergência entre roteiro e fala é decisão humana.
10. **Duração = intervalo editorial exato** em frames. Primeiro e último frames vazios quando o motion entra e sai do nada.

## 4. Vocabulário mínimo de timing (padrão; o projeto pode redefinir nos tokens)

| Token | Uso | Ordem de grandeza @24 fps |
|---|---|---|
| `fast` | estado, micro-ajuste | 5–7 f |
| `base` | entrada ou revelação de elemento | 12–14 f |
| `slow` | cena, transição de bloco | 24–28 f |

| Easing | Curva típica | Uso |
|---|---|---|
| `out` | `cubic-bezier(.16,1,.3,1)` | chegadas: rápido no início, assentamento longo |
| `in` | `cubic-bezier(.7,0,.84,0)` | saídas |
| `io` | `cubic-bezier(.65,0,.35,1)` | deslocamentos e câmera |
| `set` | `cubic-bezier(.22,1,.36,1)` | assentamento suave de tipografia |

Prefira **um par** de easings por peça. Movimentos longos de câmera usam perfis contínuos (PCHIP, perfil trapezoidal) em vez de encadear easings (`remotion-determinism.md`).

## 5. Padrões de motion (biblioteca conceitual)

| Padrão | Descrição | Backend natural |
|---|---|---|
| arrival-settle | o objeto chega com desaceleração e assenta (às vezes com overshoot mínimo) | todos |
| mask-reveal | o conteúdo surge de dentro de uma janela ou máscara (fenda, wipe) | HyperFrames, Remotion, Fusion |
| line-draw | a linha se desenha (dashoffset, `pathLength = 1`) | Remotion, HyperFrames |
| counter | número que conta até o valor final, com formato local | Remotion |
| camera-travel | câmera contínua (2D log-zoom ou 3D) por um espaço composto | Remotion |
| parallax-plate | fundo distante com parallax amortecido e overscan calculado | Remotion |
| paper-texture | papel procedural (bordas rasgadas com seed, keyline, grão) | Remotion |
| route-on-map | rota revelada + objeto seguindo a tangente | Remotion |
| ui-surface-3d | interface real como superfície fina no espaço 3D | Remotion |
| lettering | tipografia como elemento gráfico (split com kerning, baseline exata) | HyperFrames |
| lower-third | nome e cargo com régua ou divisor | Fusion (editável) ou Remotion/HyperFrames (rico) |

## 6. Fontes

- Fontes são **USER_PROVIDED** (`FONTS_DIR` + `fonts_required` do projeto). A Skill **nunca** distribui arquivos de fonte.
- Para exemplos neutros, o fallback conceitual recomendado é **Noto Sans**, quando estiver disponível na máquina. Não baixe nem instale.
- **Sem fallback silencioso:** se a fonte exigida não carregou, o build falha (`document.fonts.load` no HTML; checagem no doctor).
- Ao fazer split por letra, preserve o kerning medindo os avanços reais no setup.
