# BOLD EDIT SYSTEM — v0.8.0 Beta

Sistema de **motion para vídeo**, **sound design** e **assistência de edição no DaVinci Resolve** da **Bold Filmes**
(grupo Bold Comunica), distribuído como plugin do **Claude Code**.

> **Versão beta (`0.8.0-beta.1`).** Pode apresentar problemas. Use em projetos de teste e relate o que encontrar.

**Página oficial de instalação:** https://boldcomunica.com/bold-edit/

Este repositório é **gerado** pela ferramenta de distribuição (`bold dist build`) e contém só o pacote auditado. O
inventário exato, com sha256 de cada arquivo, está em `distribution-lock.json`.

- **Marketplace do Claude Code:** `bold-edit-system` (`.claude-plugin/marketplace.json`).
- **Plugin:** `bold-edit` (`plugins/bold-edit/`), que expõe a Skill `/bold-edit:edit` e a CLI `bold`.

## Instalar
No terminal (repositório público, sem login):
```bash
claude plugin marketplace add lucashsaura/bold-edit-system
claude plugin install bold-edit@bold-edit-system
```
Ou numa sessão do Claude Code:
```
/plugin marketplace add lucashsaura/bold-edit-system
/plugin install bold-edit@bold-edit-system
```
Depois, abra uma **nova sessão** do Claude Code e rode `bold doctor` (ou peça ao Claude: "rode o bold doctor").
A instalação **não baixa** modelos de IA, bibliotecas de áudio nem ferramentas: tudo que é opcional só é instalado quando você pede.

**Comando principal:** `/bold-edit:edit`. O Claude Code prefixa as Skills de plugin com o nome do plugin. Também basta
descrever a tarefa (abertura, lower third, legenda, efeito sonoro, DaVinci) que o Claude aciona a Skill sozinho.

## Atualizar
```bash
claude plugin marketplace update bold-edit-system
claude plugin update bold-edit@bold-edit-system
```
Fixar esta versão: `claude plugin marketplace add lucashsaura/bold-edit-system#v0.8.0-beta.1`.

## Compatibilidade
| Plataforma | Status |
|---|---|
| macOS Apple Silicon | **suportado** (ferramentas gerenciadas validadas) |
| macOS Intel | parcial: a CLI funciona; ferramentas gerenciadas aguardam validação |
| Windows x64 | experimental |
| Linux | não suportado |

**Requisitos:** Claude Code. Para usar a CLI fora do plugin, Node.js 20 ou superior. FFmpeg é necessário para mix, render
e medição de áudio (`bold setup` instala uma versão fixada, se você pedir).

## Sound design (novo na 0.8.0)
O áudio faz parte da Skill principal: o BOLD identifica os momentos sonoros do motion, propõe um plano de som revisável,
sincroniza por amostra, mixa narração, música e efeitos e exporta para Remotion e DaVinci.
- **SFX Kit** (CC0, opcional): biblioteca local de efeitos; `bold audio setup sfx-kit` mostra a instalação guiada (~55 MB).
- **Openverse**: busca online de efeitos com licença verificada antes do download e créditos em `sons/creditos.txt`.
- **Earshot** (MIT, opcional): análise e geração procedural offline; venv e modelos (~2,2 GB) só com a sua aprovação.
- **SSD externo** (opcional): kit, Earshot, modelos e caches podem ficar num SSD (`bold audio storage`).

## Limitações conhecidas (beta)
- Ainda **não verificado em sessão real**: o acionamento automático do sound design pela Skill quando o pedido não cita as ferramentas de áudio. Os comandos de áudio (`bold audio …`) foram testados de ponta a ponta; esse roteamento automático será validado durante a beta. Se o áudio não entrar sozinho, peça explicitamente ("inclua o sound design").
- Ferramentas gerenciadas validadas só no **macOS Apple Silicon**.
- **Earshot e os modelos são opcionais**; sem eles, o resto funciona.
- **Openverse** depende da disponibilidade da API pública (buscas novas podem falhar por timeout).
- **DaVinci:** os cues de áudio são inseridos **manualmente** (arquivos e timecodes prontos); a Bridge não escreve áudio na timeline.
- **Remotion:** use `bold audio mux` para a entrega final com áudio (o export direto do Remotion 4.0.290 atrasa o áudio ~43 ms).
- **Armazenamento externo** precisa estar conectado e montado; sem ele, kit e Earshot ficam indisponíveis (nada é reinstalado no disco interno).

## Diagnóstico
`bold doctor` é **somente leitura** e mostra o que está disponível e o que falta. Dentro do plugin, a CLI fica em
`${CLAUDE_PLUGIN_ROOT}/bin/bold`. Módulo de áudio: `bold doctor --module audio`.

## Segurança
Render, export e escritas no DaVinci exigem sempre autorização explícita. O pacote não contém dados de cliente nem
credenciais, e telemetria fica desligada.

## Licença
Proprietária, com uso gratuito para teste: ver `LICENSE`. Terceiros: `plugins/bold-edit/THIRD_PARTY.md`.
