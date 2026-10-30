# CLI `bold` — cola

`--json` dá saída estável. Exit codes:

| Exit | Significado |
|---|---|
| 0 | OK |
| 1 | FAIL |
| 2 | PLANNED |
| 3 | STOP (gate/guard) |
| 4 | DENIED (autorização) |
| 5 | UNAVAILABLE (dependência) |
| 64 | uso inválido |

## Sistema
```
bold home [--json]                 BOLD_HOME, versão do produto, componentes
bold --version [--json]            versão (com --json: manifest de componentes)
bold doctor [--module core|motion|davinci|transcript|assets|claude|toolchain|audio|all] [--json]
bold setup [plan|inventory|platform|status|verify|licenses] [--include ids] [--json]   # dependências: plano SOMENTE LEITURA
bold setup apply --components ids [--dry-run]   # instalação gerenciada: SÓ com pedido do usuário + confirmação por componente; nunca use --yes sem o usuário pedir
bold setup consent --component remotion --basis <base>   # aceite de licença: SÓ o usuário declara (nunca aceite em nome dele)
bold config [--json|--paths]       config efetiva e a origem de cada valor
bold audit-leaks [dir]             vazamento (paths pessoais, segredos, termos de cliente)
```

## Descrever (R8)
```
bold transcript inspect|normalize|analyze|search|export <arquivo> …   SRT · VTT · JSON · --davinci --timeline T (leitura)
bold assets scan <pasta> · search … · duplicates · inspect <arq> · davinci (leitura)
bold context build [--root P] [--transcript f …] [--davinci] [--output ctx.json] · query <ctx> <pergunta>
```

## Decidir (R9; nunca executa)
```
bold editorial analyze|plan|inspect|explain|validate|route …   plano bold.editorial-plan/1 (rascunho)
bold motion route <plan.json> <dNNNN>                           ferramenta por intenção
```

## Motion e entrega (geram vídeo → autorização estruturada obrigatória)
```
bold motion validate|compile|inspect <spec>    SEM vídeo
bold render <motion.spec.json> --authorization-file A
bold delivery profiles|encode|blur|fix-color --authorization-file A
bold probe <arq> · bold qc file|alpha|stills <arq>     leitura/QC
```

## DaVinci (Bridge V1)
```
bold davinci status|projects|timelines|inspect|media inspect|verify       leitura
bold davinci checkpoint|import|insert|integrate --resolve-project P --timeline T …   escrita sob gates
```
- Projeto real: `--authorization-file` com `davinci-write`.
- `delete --resolve-project P --timeline T --targets alvos.json`: remove itens da timeline, **sem ripple** (V1.1). Alvos = `[{unique_id, kind, track, tl_in, tl_out, file_path?}]` tirados do `inspect --json`. A autorização precisa listar `delete`.
- `replace`, `ripple`, `move`, `render` e `export` = `NOT_AVAILABLE_V1`.

## Som (R13)
```
bold audio status                                   SFX Kit · Earshot · Openverse · ffmpeg (leitura)
bold audio events <motion.spec|plan editorial|cues.json> [--offset s]
bold audio select --kind move --dur 0.5 [--style minimal|institutional|motion|cinematic] [--speech 0.5-5]   ranking explicável
bold audio plan <entrada> --style S [--transcript f | --voice f | --speech a-b,…] [--fps F] --output plano-som.json   # rascunho
bold audio render plano-som.json --output <pasta nova> [--voice f] [--music f]   # conform + stem + mix + LUFS/TP + sincronia
bold audio verify plano-som.json --audio f --conformed <pasta> [--offset s]      # sincronia medida no sinal
bold audio export plano-som.json --conformed <pasta> [--remotion-tsx f.tsx] [--davinci-csv f.csv] [--tc-start TC]
bold audio mux --video v --audio a --output f [--format mov|mp4] --authorization-file auth.json   # PROTEGIDA (preview-video)
bold audio openverse search "<termo em inglês>" [--page n]                        # avalia; não baixa
bold audio openverse fetch <id> --project <dir> --yes [--allow-unverified]        # só com pedido do usuário
bold audio earshot status|describe f|measure f|timeline f|critique f|list|render ID --output f   # opcional, offline
bold audio storage status | candidates                                         # armazenamento externo (SSD): leitura
bold audio storage set <pasta> [--image arquivo.sparsebundle] --yes | attach --yes | clear --yes   # só com pedido do usuário
bold audio library verify [--full] | install --yes · bold audio setup [sfx-kit|earshot]   # instalação só com pedido
```
