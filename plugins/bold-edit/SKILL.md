---
name: bold-edit-system
description: BOLD Edit System — motion design for VIDEO (openings, lower thirds, lettering, UI motion, animated maps, explainer animations, transitions, overlays with alpha) and DaVinci Resolve editing assistance, plus transcript and asset-index workflows. Use when the deliverable is a video/motion file or work inside Resolve. Do NOT use for websites or web UI motion (use the web skills). v0.4: knowledge base + CLI foundation + controlled delivery pipeline + motion backends (bold render: motion.spec → Remotion or HyperFrames PNG frames → BOLD delivery → QC → stills; both are external dependencies; HyperFrames = typography specialist; both cores frozen V1) + DaVinci Bridge V1 (read + gated writes) + R8 descriptive layer (transcript engine, read-only asset index, project context). R9: editorial decision engine + motion router produce explainable plans for human review (they never execute).
---

# BOLD Edit System (v0.8.0-beta.1) — roteador do pacote

Este arquivo é o **roteador histórico** do pacote: ele diz o que fazer e qual reference abrir. O conhecimento fica em `references/`.

> **Skill oficial do Claude Code (R10):** `skills/edit/SKILL.md`, instalada pelo `./install.sh` como `/bold-edit` (pessoal/projeto) ou carregada pelo plugin `bold-edit` como `/bold-edit:edit`. Ver `INSTALL.md` e `references/claude-code-skill.md`. Este arquivo da raiz não é carregado pelo plugin (a raiz tem `skills/`).

## Quando usar
- Motion design para **vídeo**: aberturas, lower thirds, lettering, UI motion, mapas animados, animações explicativas, transições, overlays com alpha.
- Assistência de edição no DaVinci Resolve (leitura, planejamento, operações sob checkpoint).
- Transcrição com timecode e Asset Index de acervo.

## Quando NÃO usar
- Sites, landing pages, motion de interface web como produto final → skills web (`bold-motion-web`, `bold-creative-web`, `bold-webgl`).

## Estado real dos módulos

| Módulo | Estado | Existe nesta Skill |
|---|---|---|
| CORE (config, policy, doctor, leak scanner) | **STABLE** | `bin/bold.mjs`, `core/` |
| KNOWLEDGE BASE | **STABLE (R3)** | `references/` |
| DELIVERY (encode BT.709, alpha, opaco, motion blur, fix-color, manifest) | **STABLE (R4)**; gera vídeo só via gate | `bold delivery`, `core/delivery/` |
| PROBE · MACHINE QC | **STABLE (R4)**; VISUAL QC continua humano | `bold probe`, `bold qc file` · `bold qc alpha` |
| MOTION (método, spec, decisão) | método VIGENTE · **Motion Router V1 (R9)** recomenda a ferramenta por intenção (HYPERFRAMES/REMOTION/FUSION/DAVINCI_NATIVE/NONE); o spec continua com `decision.backend` explícito | `references/motion-system.md`, `references/motion-router.md`, `motion/spec/` |
| EDITORIAL DECISION ENGINE | **V1 (R9)**: sinais → `bold.editorial-plan/1` explicável (prioridade, densidade, legenda, assets, placement, intenção do usuário, modos). **DECIDIR ≠ EXECUTAR**: rascunho para revisão humana; nenhum write/render | `bold editorial`, `editorial/`, `references/editorial-engine.md` |
| REMOTION | **IMPLEMENTADO (R5)**: 10 patterns, subset do spec; dependência **externa** (`REMOTION_PROJECT_DIR`), licença PENDENTE; ausente → UNAVAILABLE | `bold render`, `remotion/`, `references/remotion-backend.md` |
| HYPERFRAMES | **FROZEN_V1 (R6.2)**: 5 patterns TYPE_* tipográficos; fontes só por manifesto (fail-closed); rede bloqueada; validado ponta a ponta (sequência PNG → BOLD Delivery 4444 BT.709 → QC); dependência **externa** | `bold render`, `bold motion validate/compile/inspect`, `hyperframes/`, `references/hyperframes.md` |
| FUSION | **EXPERIMENTAL** | `references/fusion.md` |
| SOUND DESIGN | **PREVIEW (R13)**: SFX Kit local (CC0) → Openverse (fallback, licença verificada) → Earshot (opcional, offline); eventos do spec/plano → plano de som por estilo → WAV por amostra → mix EBU R128 → Remotion TSX / cue list DaVinci | `bold audio`, `audio/`, `references/sound-design.md` |
| DAVINCI BRIDGE | **V1 (R7)**: leitura (status/timelines/inspect/media/verify) + import/insert/checkpoint e **delete sem ripple (V1.1)** com gates (projeto, página Edit, timeline gate H1, File Path, `.drp`, readback + diff). Writes de desenvolvimento **só** no sandbox `BOLD_BRIDGE_SANDBOX*`; projeto real exige autorização humana `davinci-write`. delete exige autorização que liste a operação; replace/ripple/move/render/export = `NOT_AVAILABLE_V1` | `bold davinci`, `davinci/`, `references/davinci-bridge.md` |
| TRANSCRIPT ENGINE | **V1 (R8)**: SRT · VTT · JSON (whisper.cpp, segments[]) · legendas do DaVinci (leitura) → `bold.transcript/1`; timing honesto (WORD/SEGMENT), fps nunca assumido; anotações = **candidatos** descritivos; sem STT obrigatório | `bold transcript`, `transcript/`, `references/transcript-engine.md` |
| ASSET INDEX | **V1 técnica (R8)**: scan somente leitura, identidade por caminho NFC (nome ≠ identidade), ffprobe + cabeçalhos + fontes, hash eficiente, incremental, busca, duplicatas; camada editorial = conhecimento | `bold assets`, `asset-index/`, `references/asset-index.md` |
| PROJECT CONTEXT | **V1 (R8)**: transcrição + assets + DaVinci **somente leitura** → `bold.project-context/1` + consultas; nenhuma decisão editorial (R9) | `bold context`, `references/project-context.md` |
| `bold export/new` | PLANNED (respondem "não implementado") | — |

Não prometa render, integração automática, transcrição ou índice como capacidade pronta da Skill.

## Decisão de motion (resumo)
- **Método:** BRIEF → REFERENCE ANALYSIS → RULES → MOTION SPEC → BACKEND → NEW SOLUTION → STILLS QC → RENDER* → VALIDATION → INTEGRATION*. Os itens com * exigem autorização ou protocolo.
- **Sistema ≠ template:** extraia regras da referência; não copie o layout.
- **Remotion:** sistemas programáticos, mapas, UI, dados, cards, câmeras, séries.
- **HyperFrames:** lettering e tipografia em que baseline e kerning importam (patterns `TYPE_*`, só com `decision.backend = "hyperframes"`; TYPE_* no Remotion = FAIL).
- **Fusion:** editável no Resolve, alta dependência do Resolve, baixa complexidade.
- Pontue os 8 critérios (0–3) e registre `backend + scores + rationale + fallback`. Projetos híbridos são permitidos, com **um** pipeline de entrega.

## Segurança crítica (sempre)
1. **Nenhum vídeo sem autorização explícita.** Isso inclui preview em vídeo, render e export. "finalize", "integre", "aplique", "feche", "deixe pronto", "faça QC" e "siga" **não** autorizam. Stills e `.drp`/JSON são permitidos. O agente decide; o CLI exige autorização estruturada.
2. **Resolve:** gate `SetCurrentTimeline` + conferência do nome antes de **cada** write; mismatch → ABORT. Media Pool por **File Path**. Página `edit` obrigatória. **`OpenPage` proibido.** Checkpoint `.drp` + snapshot PRE/POST + diff. Readback por name + TL in/out + File Path.
3. **Cor:** sequência PNG → ffmpeg com BT.709 explícito → tags `bt709/bt709/bt709/tv` validadas. Nunca use o `.mov` da ferramenta direto no Resolve.
4. **Alpha:** ProRes 4444 `yuva444p12le`, alpha straight, média premultiplicada. **Halo = FAIL.**
5. **Mídia do usuário nunca é apagada nem movida** (copiar e verificar o hash). Nenhum dado de cliente entra na Skill (`bold audit-leaks`).
6. **Ambíguo → PARE** e pergunte.

## Qual reference abrir

| Tarefa | Reference |
|---|---|
| Qualquer vídeo, preview ou export | `references/render-policy.md` |
| Escrever no Resolve | `references/davinci-safety.md` → `references/davinci-bridge.md` → `references/davinci-api-recipes.md` |
| Criar motion | `references/motion-system.md` → `references/reference-analysis.md` → `references/decision-engine.md` |
| Renderizar um motion.spec | `references/remotion-backend.md` |
| Cor / alpha de entrega | `references/color-pipeline.md` · `references/alpha-pipeline.md` |
| Verificar | `references/qc-methods.md` |
| Remotion · motion blur | `references/remotion-determinism.md` · `references/motion-blur.md` |
| HyperFrames · Fusion | `references/hyperframes.md` · `references/fusion.md` |
| Decidir o que fazer editorialmente (plano para aprovação) | `references/editorial-engine.md` → `references/motion-router.md` |
| Transcrição · acervo · contexto | `references/transcript-engine.md` · `references/asset-index.md` · `references/project-context.md` (pipeline STT: `references/transcript.md`) |
| Erros conhecidos | `references/lessons-learned.md` |
| Empacotamento e vazamento | `references/packaging-and-leaks.md` |
| Instalar, configurar, Skill, plugin | `INSTALL.md` · `references/portability.md` · `references/claude-code-skill.md` · `references/plugin-packaging.md` |

## Comandos
- `bold home [--json]` · `bold --version [--json]`: BOLD_HOME, versão do produto e manifest de componentes.
- `bold doctor [--module core|motion|davinci|transcript|assets|claude] [--json]`: diagnóstico somente leitura (só `--module davinci` conecta no Resolve, em leitura).
- `bold transcript inspect|normalize|analyze|search|export` · `bold assets scan|inspect|search|duplicates|davinci` · `bold context build|query` (R8, descritivos; DaVinci só leitura).
- `bold editorial analyze|plan|inspect|explain|validate|route` · `bold motion route` (R9: plano editorial para revisão humana; nada é executado).
- `bold davinci status|projects|timelines|inspect|media inspect|verify` (leitura) · `checkpoint|import|insert|integrate` (escrita sob gates; projeto real exige `davinci-write`). Ver `references/davinci-bridge.md`.
- `bold config [--json|--paths]`: config efetiva e origem de cada valor.
- `bold audit-leaks [dir]`: paths pessoais, segredos, binários, termos de cliente.
- `bold probe <arquivo> [--profile ID]` · `bold qc file|alpha <arquivo>`: validação e MACHINE QC (somente leitura).
- `bold render <motion.spec.json>`: spec → Remotion → delivery → QC → stills. **Gera vídeo**, então exige autorização estruturada cobrindo render e encode.
- `bold qc stills <arquivo>`: stills para VISUAL QC humano (sem autorização extra).
- `bold delivery profiles|encode|blur|fix-color`: entrega controlada. **Gera vídeo**, então exige autorização estruturada (`--authorization-file`). Ver `references/color-pipeline.md` §8.
