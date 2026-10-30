# REMOTION — STATUS: IMPLEMENTADO (backend V1, R5) · dependência EXTERNA · licença PENDENTE

Backend genérico: **motion.spec → plano → composição única `BoldSpec` → PNG SEQUENCE**. O master é
sempre do BOLD Delivery (R4). Detalhes: `references/remotion-backend.md`.

```
src/core/        animation · camera · layout · geometry · tokens · spec   (TS puro, testável no Node)
src/components/  primitives · patterns (10) · SpecComposition · context
src/Root.tsx     registro da composição ÚNICA (dimensões/fps/duração vêm do plano)
adapter/         detect (instalação externa) · assets (raízes permitidas) · render-frames (bundle + frames)
examples/        demo neutro · editorial-clean · bold-geometric · minimal-technical · overlay-lower-third
```

- Remotion **não** é instalado nem redistribuído: `tools.REMOTION_PROJECT_DIR` / `BOLD_REMOTION_PROJECT_DIR`
  aponta para uma instalação existente (4.0.x). Sem ela → `UNAVAILABLE` (o resto da Skill funciona).
- Nenhum código, composição, asset, cor, fonte ou texto do sistema de referência foi copiado: as primitives
  foram reescritas a partir das TÉCNICAS (keyframes por segmento, PCHIP, câmera em log-zoom, parallax/overscan,
  papel com seed, geometria sem DOM, sub-frames).
