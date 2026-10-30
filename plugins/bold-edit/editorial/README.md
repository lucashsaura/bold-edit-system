# EDITORIAL — STATUS: V1 (R9)

Editorial Decision Engine + Motion Router V1: R8 (somente leitura) → sinais → `bold.editorial-plan/1` explicável.
**DECIDIR ≠ EXECUTAR**: o plano é rascunho para revisão humana; nada é escrito no DaVinci, renderizado ou exportado.
- `src/`: `signals.mjs`, `intent.mjs` (intenção do usuário + identidade), `match.mjs` (assets por caminho), `decide.mjs` (regras, legenda, placement), `density.mjs`, `router.mjs`, `plan.mjs`, `validate.mjs`
- `schema/bold.editorial-plan.schema.json`
- CLI: `bold editorial …`, `bold motion route` · Docs: `references/editorial-engine.md`, `references/motion-router.md` · Testes: `tests/editorial/`
