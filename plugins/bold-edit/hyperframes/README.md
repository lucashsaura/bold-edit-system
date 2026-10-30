# HYPERFRAMES — STATUS: FROZEN_V1 (R6.2) · dependência externa

- `src/`: compilador (`compile.mjs`, motion.spec → bold.hyperframes.spec/0), gramática de refs (`refs.mjs`), leitor sfnt (`sfnt.mjs`), gerador HTML (`html.mjs`) e runtime do browser (`runtime.js`). `schema/`: schema do plano compilado. `examples/`: 3 direções neutras (editorial, bold-geometric, minimal-technical; manifesto de fontes fornecido pelo projeto).
- `adapter/`: `browser.mjs` (detecção/launch), `job.mjs` (job, lint, layout, stills), `render.mjs` (render atrás do policy gate), `run.mjs`, `font-gate.mjs`, `net-guard.mjs`.

HyperFrames (HeyGen, Apache-2.0) é uma ferramenta **externa** (plugin do Claude Code e CLI via npx). Ela **não** faz parte desta Skill e não é empacotada. Versão fixada nos defaults: `0.8.114`.

- `spikes/`: spikes NEUTROS de capacidade tipográfica. São HTML/CSS/SVG com estado como função pura de t, sem GSAP, sem fontes e sem rede. Inclui o kit `kit.js` e o gerador de composição HF sem GSAP (`hf-composition.mjs`).
- Testes: `tests/hyperframes/spikes.test.mjs`. Geram só stills PNG em memória, com o Chrome do próprio HyperFrames.
- Regras, arquitetura proposta e fronteira com o Remotion: `references/hyperframes.md`. Matriz: `references/hyperframes-capabilities.md`. Auditoria: `HYPERFRAMES_R6_0_AUDIT.md`.
- Regra já validada: nunca usar `--format mov` para o Resolve, por causa da matriz BT.601 sem tags na 0.8.114. Use png-sequence + BOLD Delivery (R4).
- Detecção atual: `bold doctor --module motion`.
- Testes: `tests/hyperframes/{compiler,patterns,sequence,spikes}.test.mjs`.
