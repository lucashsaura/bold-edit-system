# BOLD Edit System — pacote portátil (v0.8.0-beta.1 — beta pública)

**Instalar:** veja [`INSTALL.md`](INSTALL.md): marketplace público `bold-edit-system` (`lucashsaura/bold-edit-system`) → plugin `bold-edit` (`/bold-edit:edit`), ou `./install.sh` para o modo local (`/bold-edit`). macOS SUPPORTED · Windows EXPERIMENTAL. Distribuição: [`DISTRIBUTION.md`](DISTRIBUTION.md).

Distribuição **paralela** e portátil do BOLD Edit System. O sistema original continua congelado como
referência funcional; esta Skill nasce ao lado, por reescrita seletiva, sem dados de cliente.

## Estado

| Parte | Estado |
|---|---|
| CLI `bold` (`--help`, `--version`, `doctor`, `config`, `audit-leaks`) | implementado |
| Config engine (ENV > projeto > usuário > defaults por SO) + schemas | implementado |
| Policy engine (invariantes + gate de autorização estruturada + log) | implementado (sem comandos protegidos reais ainda) |
| Leak scanner (denylist genérica versionada + denylist local fora do git) | implementado |
| Schemas `bold.config`, `bold.project`, `motion.spec` (V0), `tokens` (V0) | implementado |
| **Knowledge base** (`references/`): render policy, DaVinci safety + recipes, cor, alpha, QC, método de motion, análise de referência, decision engine, determinismo, motion blur, HyperFrames, Fusion, transcript, asset index, lessons learned | **R3 concluída** (documentação; não executa nada) |
| **HyperFrames backend (R6)**: `bold render` (decision.backend = hyperframes), `bold motion validate/compile/inspect`, 5 patterns TYPE_* tipográficos, fontes por manifesto fail-closed, rede bloqueada | **FROZEN_V1 (R6.2)**; HyperFrames é dependência **externa** (nada é instalado) |
| **DaVinci Bridge V1 (R7)**: `bold davinci` (status · projects · timelines · inspect · media inspect · verify · checkpoint · import · insert · integrate), Bridge Python com gates H1–H8, WriteIntent/WriteResult, checkpoint `.drp` | **implementado**; writes de desenvolvimento só no sandbox `BOLD_BRIDGE_SANDBOX*`; projeto real exige autorização humana `davinci-write` |
| **Transcript Engine V1 (R8)**: `bold transcript` (inspect · normalize · analyze · search · export); SRT/VTT/JSON/legendas do DaVinci → `bold.transcript/1`; anotações descritivas | **implementado**; sem STT obrigatório; nada é baixado |
| **Asset Index V1 (R8)**: `bold assets` (scan · inspect · search · duplicates · davinci); `bold.asset-index/1`; identidade por caminho | **implementado**; scan somente leitura; índice = cache derivado |
| **Project Context V1 (R8)**: `bold context` (build · query); `bold.project-context/1` | **implementado**; DaVinci somente leitura |
| **Editorial + Motion Decision Engine V1 (R9)**: `bold editorial` (analyze · plan · inspect · explain · validate · route) e `bold motion route`; `bold.editorial-plan/1` | **implementado**; DECIDE e nunca executa (plano = rascunho para revisão humana) |
| **Portabilidade + installer + Skill/Plugin (R10)**: `install.sh`/`install.cmd` (install · update · uninstall · status), Skill oficial `skills/edit` (`/bold-edit`), plugin `.claude-plugin/` (`/bold-edit:edit`), `bold home`, `bold doctor --module claude`, `distribution-manifest.json` | **implementado**; local, idempotente, sem sudo; nada publicado |
| Distribuição via Git privado / marketplace (R11) · camada de execução de plano aprovado | **PLANNED** |
| **Delivery pipeline (R4)**: `bold probe`, `bold qc file` · `bold qc alpha`, `bold delivery` (profiles · encode · blur · fix-color), 3 perfis versionados, validador central, manifest | **implementado** (gera vídeo só pelo policy gate) |
| **Remotion backend (R5)**: `bold render <motion.spec>` (frames do Remotion **externo** → delivery R4 → QC → stills), `bold qc stills`, 10 patterns, exemplos neutros | **implementado**; requer `BOLD_REMOTION_PROJECT_DIR` (licença Remotion PENDENTE; nada é instalado) |
| `bold new`, `export` | **PLANNED** (o CLI responde "não implementado") |

Plataformas: **macOS = SUPPORTED** · **Windows = EXPERIMENTAL** · Linux = DEVELOPMENT_ONLY (`references/portability.md`).

## Requisitos da fundação
- Node.js ≥ 20 (≥ 22 recomendado; HyperFrames exige 22). **Nenhuma dependência npm** — só módulos nativos do Node.

## Uso
```bash
node bin/bold.mjs --help
node bin/bold.mjs doctor
node bin/bold.mjs doctor --module davinci --json
node bin/bold.mjs config
node bin/bold.mjs audit-leaks
npm test        # node --test (nenhuma dependência é instalada)
npm test        # suíte padrão: NÃO gera mídia (testes de render/encode pulados)
# testes que geram mídia: SOMENTE após autorização humana explícita (references/render-policy.md §3.1)
BOLD_TEST_RENDER_AUTH=1 BOLD_REMOTION_PROJECT_DIR=<instalação Remotion 4.0.x> npm test
```

## Configuração
- Defaults neutros: `config/defaults.json` (tokens `${HOME}`, `${APPDATA}`… resolvidos em runtime).
- Usuário (fora do repositório):
  - macOS: `~/Library/Application Support/bold/bold.config.json`
  - Windows: `%APPDATA%\bold\bold.config.json`
  - Exemplo: `bold.config.example.json`. Override do caminho: `BOLD_USER_CONFIG`.
- Projeto: `PROJECT_ROOT/bold.project.json` (modelo em `templates/project/`).
- ENV: `BOLD_CACHE_DIR`, `BOLD_RENDER_DIR`, `BOLD_FONTS_DIR`, `BOLD_FFMPEG_PATH`, `BOLD_PYTHON_PATH`, `BOLD_WHISPER_MODEL`, `BOLD_DAVINCI_*`… (`core/config/load.mjs` → `ENV_MAP`).
- Policies **não** podem ser afrouxadas por nenhuma camada (`core/policy/invariants.mjs`).

## Anti-leak
- `core/leak/generic.denylist.json` (versionada): paths pessoais, volumes, segredos, binários de mídia/fonte/modelo,
  dados de projeto Resolve, diretórios proibidos.
- `tests/leak-scan.local.denylist` (**ignorada pelo git**): nomes de cliente/máquina. Modelo: `tests/leak-scan.local.denylist.example`.
- Regra estrutural documentada em `references/packaging-and-leaks.md`.

## Estrutura
```
bin/            CLI
core/           config · policy · log · leak · doctor · schema · delivery (R4) · qc (R4)
config/         defaults.json
motion/         spec/ (schemas V0) · patterns/ (PLANNED)
remotion/       backend Remotion (core TS, patterns, adapter, exemplos)
hyperframes/    backend HyperFrames (FROZEN_V1)
davinci/        Bridge Python V1 (R7)
transcript/     Transcript Engine V1 (R8): src/ · schema/
asset-index/    Asset Index V1 (R8): src/ · schema/
core/context/   Project Context V1 (R8) + porta DaVinci somente leitura
editorial/      Editorial Decision Engine + Motion Router V1 (R9): src/ · schema/
templates/      project/ · docs/
references/     knowledge base (R3): ver references/README.md
skills/edit/    Skill oficial do Claude Code (/bold-edit · plugin /bold-edit:edit)
.claude-plugin/ manifest do plugin bold-edit
install/        installer V1 (R10) · install.sh · install.cmd · INSTALL.md
tests/          unit/ · schema/ · integration/ · install/ · fixtures/   (DEVELOPMENT_ONLY)
```

## Requisito de distribuição (permanente)
Repositório Git **privado**, instalação em **um comando**, Skill registrada, `bold doctor` e pronto.
O installer (R10, `INSTALL.md`) é idempotente, atualizável a partir de checkout local, sem paths pessoais nem dados de cliente, sem dependências proprietárias empacotadas, e nunca instala ou baixa nada. A distribuição via Git privado/marketplace é da R11 (`distribution-manifest.json`, `references/plugin-packaging.md`).
