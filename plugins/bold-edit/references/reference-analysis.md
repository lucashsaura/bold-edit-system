# Reference analysis — como "ler" uma referência

**Status: VIGENTE (método).** A saída preenche `motion.spec.reference.extracted_rules` (`motion/spec/motion.spec.schema.json`).

## Regras do método

1. **Descreva medindo.** Use proporções, frames, pixels, contagens. Evite adjetivos ("elegante", "dinâmico") sem medida.
2. **Separe o que é marca do que é técnica.** Cores e fontes da referência **não** passam ao projeto. Passam as **relações**: contraste, escala, peso, ritmo.
3. **Extraia regras testáveis.** "Texto principal ocupa ≤ 1/3 da largura", sim. "Texto grande", não.
4. **Não copie literalmente** a referência quando o pedido não exigir. A saída é um sistema de regras, não um layout.
5. **Se a referência for vídeo, analise frame a frame** em stills (é permitido). Não renderize nada para analisar.

## 1. STATIC DESIGN (por frame representativo)

| Item | Pergunta | Registro |
|---|---|---|
| aspect ratio | 16:9, 9:16, 1:1, 4:5? | proporção + resolução de entrega |
| grid | colunas, gutters, linhas de base | nº de colunas, unidade |
| margins / safe area | onde o conteúdo nunca entra | % por lado |
| alignment | esquerda, centro, eixo óptico, baseline compartilhada | regra |
| negative space | quanto do quadro fica vazio no hold | % aproximado |
| hierarchy | ordem de leitura: 1º, 2º, 3º | lista ordenada |
| typography | famílias (classe: grotesca, condensada, serifa), pesos, caixa | relações, não nomes de marca |
| scale | razão entre níveis tipográficos | ex.: 1 : 0,45 : 0,3 |
| tracking | apertado, neutro, aberto, por nível | valores relativos (em) |
| palette | nº de cores, papel de cada uma (fundo, acento, texto) | papéis + contraste |
| texture | grão, papel, ruído, superfície | presença e intensidade |
| depth | plano, camadas, sombra, perspectiva | nº de planos, tipo de sombra |
| image treatment | recorte, máscara, duotone, moldura, borda | regra |

## 2. TEMPORAL DESIGN (em frames)

| Item | Pergunta |
|---|---|
| duration | duração total e do hold útil |
| beats | quantas batidas, onde caem (cue de fala ou música?) |
| entry | como cada elemento entra (máscara, deslocamento, escala, opacidade) e quanto dura |
| settle | existe assentamento (desaceleração longa, overshoot)? |
| hold | quanto tempo fica estático e legível |
| exit | sai pela mesma lógica da entrada? em ordem inversa? |
| acceleration / deceleration | perfil das curvas (ver easing em `motion-system.md` §4) |
| overlap | quanto as entradas se sobrepõem (stagger em frames) |
| anticipation | há contra-movimento antes da ação? |
| follow-through | elementos secundários continuam depois do principal parar? |
| rhythm | regular, acelerando, sincopado; densidade por segundo |

## 3. CAMERA

| Tipo | Registrar |
|---|---|
| static | — |
| pan / truck | direção, distância relativa, perfil |
| push / pull | fator de zoom, perfil (log-zoom soa mais natural) |
| orbit | ângulo, eixo |
| parallax | nº de planos, razão de velocidade entre planos |
| perspective | distância focal aparente, exagero |
| focal behavior | profundidade de campo, rack focus |

## 4. TRANSITIONS

| Tipo | Registrar |
|---|---|
| mask / wipe | forma da máscara, direção, borda (dura ou suave) |
| scale | origem, fator |
| opacity | curva, duração (fade puro é último recurso) |
| positional | deslocamento e direção |
| match movement | qual movimento conecta A e B |
| graphical transition | elemento gráfico que cobre e revela |

## 5. Saída: `motion.spec.json` (trecho)
```json
{
  "schema": "bold.motion.spec/0",
  "id": "<peca>-v1",
  "brief": { "goal": "...", "kind": "lettering", "duration_frames": 144, "fps": 24, "alpha": true },
  "reference": {
    "sources": ["ref-01 (vídeo, 00:12–00:18)"],
    "extracted_rules": {
      "hierarchy": ["1 palavra protagonista; apoio ≤ 45% da altura de caixa"],
      "rhythm": ["3 batidas; entrada 12 f; hold ≥ 36 f; saída espelha a entrada"],
      "easing": ["chegadas com out longo; nada de bounce"],
      "transitions": ["reveal por fenda horizontal; sem fade puro"],
      "composition_rules": ["texto nunca cobre o assunto; safe area 10%"]
    }
  },
  "decision": { "backend": "hyperframes", "scores": { "VISUAL_COMPLEXITY": 3 }, "rationale": "tipografia é o elemento" }
}
```

## 6. Fail conditions
- Uma regra sem medida ou não testável.
- Cor ou fonte de marca da referência copiada para o projeto sem pedido.
- A spec reproduz o layout da referência quando o pedido era "inspirado em".
