# Packaging & leaks (VIGENTE)

## Princípio
Esta Skill é **sistema**, não projeto. Nada de mídia, nomes, logos, textos, roteiros, renders, caches,
dados ou paths de cliente/máquina entra na distribuição.

## Anti-leak por estrutura
No empacotamento (futuro) e na auditoria (`bold audit-leaks`), **nenhum arquivo** pode vir diretamente de,
ou residir em, diretórios chamados:

`projects/` · `data/` · `public/` · `src/assets/` · `out/` · `renders/` · `node_modules/` · `media/` · `footage/` · `checkpoints/`

Arquivos úteis do sistema de referência só entram **reescritos** (ou copiados de forma explícita e revisada),
nunca por cópia de diretório. Exceções exigem entrada revisada em `core/leak/allowlist.json` (caminho + regra).

## Anti-leak por conteúdo
- Denylist genérica versionada: `core/leak/generic.denylist.json` — diretórios pessoais (macOS/Linux/Windows),
  volumes montados, `media_root` absoluto, segredos/tokens, extensões proibidas (vídeo, áudio, imagem de mídia,
  fontes, modelos, dados de projeto Resolve, LUT/grade, comps Fusion).
- Denylist local (**fora do git**): `tests/leak-scan.local.denylist` e `$BOLD_LEAK_LOCAL_DENYLIST` —
  nomes de cliente, pessoas, produtos, discos e usuário da máquina. Não precisa ser distribuída.
- Comparação sem acento/maiúsculas, com fronteira tolerante a camelCase/snake_case.

## Gate
`bold audit-leaks` deve retornar **PASS** antes de qualquer commit. O `bold doctor` também roda o scanner.

## Requisito arquitetural permanente: distribuição

```
GOAL: PRIVATE GITHUB REPOSITORY → ONE-COMMAND INSTALL → BOLD REGISTERED AS SKILL → bold doctor → READY
```

O installer (**implementado na R10**: `INSTALL.md`, `install/`, `references/portability.md`) é:
- **idempotente:** rodar duas vezes não altera nada;
- **atualizável:** um `git pull` com reinstalação segura;
- **sem paths pessoais e sem dados de cliente;**
- **sem dependências proprietárias empacotadas:** Remotion, HyperFrames, fontes, modelos e Resolve são detectados, não incluídos;
- **capaz de detectar dependências** (doctor) e de **pedir autorização antes de qualquer instalação ou download;**
- **compatível com repositório Git privado:** autenticação do próprio git, sem tokens no repositório.

**Decisões já tomadas que preservam esse objetivo**
- O CLI usa só módulos nativos do Node (nenhuma dependência npm).
- A config do usuário fica fora do repositório.
- Os defaults usam tokens `${HOME}`, `${APPDATA}` e afins.
- Os perfis de entrega são versionados em JSON.
- Ferramentas externas (ffmpeg, ffprobe) são resolvidas por config ou PATH.
- Os manifests usam caminhos relativos ao `PROJECT_ROOT` ou só o nome do arquivo.
- Os fixtures de teste são gerados em runtime e nunca versionados.
- O golden contém só hashes.
