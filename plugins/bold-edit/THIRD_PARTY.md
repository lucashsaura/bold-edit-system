# Terceiros

A fundação (v0.1) **não inclui nem redistribui** código, binários, fontes ou modelos de terceiros.
Dependências são detectadas pelo `bold doctor` e fornecidas/instaladas pelo usuário, com autorização.
R12 (Setup Manager): `setup/toolchain.lock.json` só **referencia** fontes oficiais, com sha256 fixado pelo mantenedor (R12.3):
- Node 24.22.0 (MIT, nodejs.org);
- FFmpeg 9.0.2: no macOS arm64, Martin Riedl, **GPL-3.0-or-later**; no Windows x64, BtbN, **LGPL-2.1-or-later**.

Opcionais (R12.4):
- Python 3.12 (python-build-standalone, PSF-2.0; projeto MPL-2.0) + Pillow 12.3.0 (MIT-CMU);
- HyperFrames 0.8.114 (Apache-2.0; dependências com MIT/Apache/ISC/BSD e **LGPL-3.0-or-later** no libvips do `sharp`);
- Remotion 4.0.290 (**Remotion License**; Company License para 4+ pessoas; aceite explícito, e a licença da Bold não cobre terceiros);
- whisper.cpp (MIT) e modelos Whisper (MIT).

Tudo é baixado do upstream (npm, PyPI, GitHub, Hugging Face) na máquina do usuário e **nada é redistribuído**. O download vai do upstream para a máquina do usuário; **nada é espelhado nem redistribuído**. Decisões por componente: `references/setup-manager.md`.

Sound design (R13, opcionais; **nada redistribuído**):
- **SFX Kit 1.0.0** (wyzowl/sfx-kit, **CC0-1.0**): release v1.0.0 com sha256 fixado em `audio/sfx-kit.lock.json`. Fica em `<dados do BOLD>/libraries`; crédito não exigido (origem registrada em `sons/origens.jsonl`);
- **Earshot 0.4.0** (Leonxlnx/earshot, **MIT**): commit `591fa3e`; dependências do PyPI com `--require-hashes` (`audio/earshot-0.4.0.lock.txt`: PyTorch BSD-3-Clause, transformers Apache-2.0, librosa ISC, scikit-learn BSD-3-Clause, mcp MIT…);
  - modelos CLAP `laion/larger_clap_general@16c8cc3` (**Apache-2.0**) e AST `MIT/ast-finetuned-audioset-10-10-0.4593@f826b80` (**BSD-3-Clause**), só safetensors, baixados do Hugging Face na máquina do usuário e com aprovação;
  - o banco procedural tem 15 receitas "fit" derivadas de gravações **CC0** do Freesound (fonte registrada em cada receita);
- **Openverse** (API pública): cada efeito tem a licença do autor, verificada antes do download e registrada em `sons/creditos.txt`.

| Componente | Papel previsto | Licença | Situação nesta Skill |
|---|---|---|---|
| Node.js | runtime do CLI e dos backends de motion | MIT | requisito do usuário |
| Remotion (`remotion`, `@remotion/*`) | backend de motion programático (PLANNED) | Remotion License — uso por empresas pode exigir *Company License* | **PENDENTE**: nada empacotado; nenhuma decisão comercial nesta rodada |
| HyperFrames (HeyGen) 0.8.114 | backend HTML/CSS motion | Apache-2.0 (dependências MIT/Apache/ISC/BSD; **LGPL-3.0-or-later** no libvips do `sharp`) | **não empacotado**. Opcional, instalado só sob pedido no macOS arm64 (`bold setup apply --components hyperframes`): `npm ci` do registro oficial na máquina do usuário, com lockfile, binários nativos e hash da árvore fixados no lock. Um HyperFrames do próprio usuário (npx/caminho) é só detectado |
| GSAP / CustomEase | animação nos projetos HyperFrames | licença GSAP (verificar na rodada de migração) | não empacotado |
| FFmpeg / FFprobe | encode/validação | LGPL/GPL conforme build | requisito do usuário |
| whisper.cpp + modelos | transcrição (PLANNED) | MIT (código); licença do modelo | requisito do usuário; modelos nunca empacotados |
| DaVinci Resolve + Scripting API | edição (PLANNED) | proprietário (Blackmagic Design) | requisito do usuário |
| Chrome headless (Remotion/HyperFrames/Puppeteer) | captura de frames e render | licenças do Chromium | **não é baixado nem gerenciado pelo BOLD**: fornecido pelo usuário (`tools.CHROME_HEADLESS_PATH`); o Setup Manager só detecta e configura, e a instalação gerenciada do HyperFrames bloqueia o download do Chrome (`PUPPETEER_SKIP_DOWNLOAD`) |
| Fontes | tipografia de projeto | variam | **nenhuma fonte é distribuída**; fontes vêm de `FONTS_DIR` / `fonts_required` do projeto |
