---
description: BOLD Edit System — motion design for VIDEO and DaVinci Resolve editing assistance. Use for openings, lower thirds, lettering/typography motion, offer/CTA cards, overlays with alpha, motion delivery to Resolve, sound design (SFX synced to motion, cuts and transitions; levels under voice and music; licenses), transcript (SRT/VTT/JSON) normalization and search, media asset indexing, project context, and editorial plans (what to highlight, where motion helps, NO_ACTION). Drives the `bold` CLI. Do NOT use for websites or web UI animation.
when_to_use: "Triggers: motion para vídeo, abertura, lower third, lettering, legenda/transcrição, SRT, VTT, timecode, DaVinci Resolve, timeline, Media Pool, inserir motion na timeline, plano editorial, destacar oferta/CTA, B-roll, acervo de mídia, render de motion com alpha, ProRes 4444, bold doctor, bold editorial, efeito sonoro, SFX, sound design, whoosh, som da animação, trilha, música, narração, mixagem, volume."
argument-hint: "[tarefa de edição/motion]"
metadata:
  product: BOLD EDIT SYSTEM
  skill-version: "1"
---

# BOLD Edit System — orquestração

Esta Skill orquestra o **BOLD EDIT SYSTEM** pela CLI `bold`. O conhecimento detalhado fica no pacote (`references/`) e é lido **sob demanda**.

## 1. Encontre o sistema (sempre primeiro)

1. Rode `bold home --json`. Ele devolve `bold_home`, a versão e os componentes.
2. Se `bold` não existir:
   - plugin: tente `"${CLAUDE_PLUGIN_ROOT}/bin/bold" home --json`;
   - instalação local: tente `node "<checkout>/bin/bold.mjs" home --json`.
3. Se nada funcionar, **pare** e peça ao usuário para rodar o installer (`INSTALL.md` do pacote). Não procure checkouts pelo disco.
4. Leia referências como `<bold_home>/references/<arquivo>.md`. Nunca suponha um caminho fixo de máquina.
5. `bold doctor` mostra o que está disponível. Ele é somente leitura e nunca instala nada.

## 2. Fluxo principal

```
ENTENDER → DESCREVER (R8) → DECIDIR (R9) → REVISÃO HUMANA → EXECUTAR (com autorização) → VERIFICAR
```

| Etapa | O que fazer | Comandos |
|---|---|---|
| Entender | objetivo, formato, duração em frames, fps, texto aprovado | perguntar o que faltar |
| Descrever | transcrição, acervo e timeline (DaVinci **só leitura**) | `bold transcript …`, `bold assets …`, `bold context build` |
| Decidir | plano editorial explicável; NO_ACTION é decisão válida | `bold editorial plan`, `explain`, `validate`, `bold motion route` |
| Revisão humana | mostrar o plano. **Nada é executado** sem aprovação explícita | — |
| Executar | motion (spec → render), entrega, inserção no Resolve, cada um com o próprio gate | `bold render`, `bold delivery`, `bold davinci …` |
| Som (automático) | todo motion/edição passa pelo sound design: eventos → plano de som → revisão → mix → exports | `bold audio plan`, `render`, `export` |
| Verificar | QC de máquina + stills para revisão visual humana | `bold qc …`, `bold davinci verify` |

Detalhes por tarefa: [workflows.md](workflows.md). Cola da CLI: [cli.md](cli.md).

## 3. Regras inegociáveis (resumo; completas em [safety.md](safety.md))

- **Render/export:** nenhum vídeo, preview em vídeo, encode, Render Queue ou Deliver sem **autorização explícita do usuário**, com escopo.
  - "Testar", "finalizar", "verificar" e "QC" **não** são autorização.
  - O opt-in técnico de testes (`BOLD_TEST_RENDER_AUTH=1`) **não** substitui a autorização humana.
- **DaVinci write:** nenhum write em projeto real sem autorização humana `davinci-write`, com projeto + timeline + operação.
  - Sempre: checkpoint antes, gate de timeline imediatamente antes, mídia por **File Path** (nunca por nome), readback/verificação.
  - Nunca `OpenPage`, nunca trocar de projeto, nunca ripple/move/replace. O sandbox (`BOLD_BRIDGE_SANDBOX*`) é o lugar dos testes.
  - **Delete (V1.1)** só pela Bridge (`bold davinci delete`): remove itens da **timeline** (nunca a mídia), **sem ripple**, por alvos exatos (UniqueId + track + TL in/out), com autorização humana que **liste `delete`** explicitamente, `.drp` antes e readback ("removeu exatamente os alvos e nada mais").
- **Decidir ≠ executar:** planos da R9 (`bold editorial`) são rascunhos. Ocultar legenda, inserir mídia ou criar motion só depois de aprovação humana, e pela camada de execução.
- **SYSTEM ≠ TEMPLATE:** referências viram regras (hierarquia, ritmo, formas, tokens). Nunca copie layout ou coreografia, salvo pedido explícito.
- **Privacidade:** nenhum dado de cliente, mídia, transcrição real ou caminho pessoal entra no pacote ou no repositório. Dados de projeto ficam no `PROJECT_ROOT` (`.bold/`) ou no cache do usuário.
- **Mídia do usuário:** nunca apagar, mover, renomear nem relinkar.
- **Instalação:** nunca instale dependências (Node, ffmpeg, Python, Remotion, HyperFrames, modelos, fontes) nem baixe nada sem pedir.
- **Som:** SFX Kit local primeiro; Openverse só como fallback e só com licença verificada (créditos em `sons/creditos.txt`); Earshot é opcional, sempre offline, e `earshot llm` nunca é usado. Nada de efeito em todo corte: a densidade segue o estilo. Vídeo com áudio = ação protegida (`preview-video`). Com o armazenamento externo (SSD) fora, `bold audio status` diz o que ficou indisponível e como recuperar: informe o usuário e continue com o resto; **nunca reinstale no disco interno**. Se as ferramentas `mcp__earshot__*` estiverem disponíveis, use-as só para análise/geração local (nunca `llm_critique`).

## 4. Mapa de conhecimento (abra só o necessário)

| Tarefa | Leia em `<bold_home>/references/` |
|---|---|
| Qualquer vídeo/preview/export | `render-policy.md` |
| Escrever no Resolve | `davinci-safety.md` → `davinci-bridge.md` |
| Criar motion | `motion-system.md` → `reference-analysis.md` → `decision-engine.md` |
| Remotion / HyperFrames | `remotion-backend.md` · `hyperframes.md` |
| Transcrição · acervo · contexto | `transcript-engine.md` · `asset-index.md` · `project-context.md` |
| Plano editorial · ferramenta | `editorial-engine.md` · `motion-router.md` |
| Cor, alpha e QC | `color-pipeline.md` · `alpha-pipeline.md` · `qc-methods.md` |
| Som: efeitos, sincronia, volumes, licenças | `sound-design.md` |
| Instalação, config, portabilidade | `portability.md` · `claude-code-skill.md` |

## 5. Como responder

- Mostre o que o `bold` disse: status, códigos, caminhos de saída. Não invente PASS.
- Para decisões, cite a evidência e o motivo (`bold editorial explain`).
- Se um gate bloquear (exit 3/4/5), explique o bloqueio e o que o usuário precisa fazer. Nunca contorne.
