# references — índice (knowledge base R3)

Documentação **operacional**, generalizada e anonimizada a partir do projeto piloto. Leia sob demanda.

| Tarefa | Abra |
|---|---|
| Vou gerar qualquer vídeo / preview / export? | `render-policy.md` (**CRITICAL**) |
| Vou escrever no DaVinci Resolve | `davinci-safety.md` (**CRITICAL**) → `davinci-bridge.md` (ferramenta, R7) → `davinci-api-recipes.md` |
| Entrega de motion para o Resolve (cor) | `color-pipeline.md` |
| Overlay com transparência | `alpha-pipeline.md` |
| Como verificar (sem e com render) | `qc-methods.md` |
| Criar um motion do zero | `motion-system.md` → `reference-analysis.md` → `decision-engine.md` (implementado pelo `motion-router.md`) |
| Decidir o que fazer editorialmente com transcrição + assets + timeline (plano para aprovação) | `editorial-engine.md` → `motion-router.md` |
| Recebi uma referência visual | `reference-analysis.md` |
| Renderizar um motion.spec (Remotion) | `remotion-backend.md` |
| Remotion / determinismo / câmera 3D | `remotion-determinism.md` |
| Motion blur | `motion-blur.md` |
| Lettering / HTML-CSS motion | `hyperframes.md` |
| Motion editável dentro do Resolve | `fusion.md` (EXPERIMENTAL) |
| Transcrição: normalizar, analisar, buscar (ferramenta, R8) | `transcript-engine.md` · pipeline STT: `transcript.md` |
| Catálogo / busca de acervo (ferramenta técnica R8 + camada editorial) | `asset-index.md` |
| Juntar transcrição + assets + DaVinci (leitura) | `project-context.md` |
| Erros já cometidos e como evitar | `lessons-learned.md` |
| Empacotamento e vazamento de dados | `packaging-and-leaks.md` |
| Instalar, configurar, portabilidade | `../INSTALL.md` · `portability.md` |
| Dependências (Node, FFmpeg, Python…): plano, toolchain gerenciado, integridade | `setup-manager.md` (R12) |
| Som: efeitos (SFX Kit/Openverse/Earshot), sincronia, volumes, licenças, Remotion/DaVinci | `sound-design.md` (R13) |
| Skill do Claude Code e plugin | `claude-code-skill.md` · `plugin-packaging.md` |
| Marketplace, atualização, rollback | `marketplace.md` · `update.md` · `../DISTRIBUTION.md` |

Convenções:
- **[HARD]**, **[API]**, **[VER]**, **[PRACTICE]** classificam as regras do DaVinci.
- O formato **RULE · RATIONALE · PROCEDURE · VALIDATION · FAIL CONDITION** se repete nos documentos.
- Versões validadas: DaVinci Resolve 21.1 · Remotion 4.0.290 · HyperFrames 0.8.114.
