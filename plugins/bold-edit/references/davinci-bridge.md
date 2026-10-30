# DaVinci Bridge V1

**Status: V1 implementada (R7).** Validada contra o Resolve FAKE (suíte padrão) e contra o DaVinci Resolve Studio 21.1.0.14:
- leitura num projeto real;
- writes **somente** no sandbox `BOLD_BRIDGE_SANDBOX` aberto pelo usuário (§6).

As observações de API da R7 são A22–A24 em `davinci-safety.md`.
As regras estão em `davinci-safety.md` (H*/A*). As receitas de API estão em `davinci-api-recipes.md`. Este arquivo descreve a **ferramenta**.

---

## 1. Arquitetura

```
bold davinci <op>  (Node: bin/commands/davinci.mjs)
  ├─ valida args · motion request · autorização davinci-write (core/davinci/authorize.mjs)   ← ANTES de chamar a Bridge
  └─ python3 -m davinci.bridge.cli <op> '<json>'  (core/davinci/bridge.mjs) → 1 linha JSON
        davinci/api/connect.py        conexão (nunca abre o Resolve, nunca troca projeto/página)
        davinci/safety/guards.py      project_guard · page_guard · timeline_gate (H1) · write_scope (sandbox/autorização)
        davinci/safety/intents.py     WriteIntent / WriteResult (PASS|FAIL|ABORTED) → davinci-writes.jsonl
        davinci/media/media.py        Media Pool por File Path (H5), NFC, duplicatas
        davinci/timeline/inspect.py   JSON estável da timeline · timecode.py (fps fracionário, drop-frame)
        davinci/checkpoint/           snapshot de TODAS as timelines + .drp verificado (H3/H4) + diff
        davinci/bridge/ops.py         operações
```
- O Node **nunca** fala com o Resolve.
- A regra de segurança de escrita mora na Bridge e é **reforçada** no Node: a autorização é checada duas vezes.
- Python ≥ 3.10 vem de `tools.PYTHON_PATH` ou `BOLD_PYTHON_PATH`, senão do primeiro candidato encontrado no PATH.

## 2. Comandos

| Comando | Tipo | O que faz |
|---|---|---|
| `bold davinci status` | leitura | produto/versão, página, projeto, timeline corrente (fps, DF, resolução, start TC), `write_safety` |
| `bold davinci projects` | leitura | projeto corrente + lista da pasta corrente do Project Manager |
| `bold davinci timelines` | leitura | timelines do projeto (índice, nome, corrente) |
| `bold davinci inspect [--timeline T] [--brief]` · `timeline inspect` | leitura | JSON `bold.davinci.timeline/1`; com `--timeline`, lê **sem trocar** a corrente (estado de track = `null`, A2) |
| `bold davinci media inspect [--path F]` | leitura | Media Pool; com `--path`, os matches por File Path + homônimos em outro caminho |
| `bold davinci verify …` | leitura | existe **exatamente um** item com o File Path, a track e o TL in pedidos (e TL out/duração, se `--duration`) |
| `bold davinci checkpoint … [--drp]` | write* | snapshot JSON (+ `.drp` verificado com `--drp`) |
| `bold davinci import …` | write | importa no bin `BOLD_MOTION`. Se o File Path já está no pool: `imported:false`, nada muda |
| `bold davinci insert …` | write | append numa posição livre de uma track existente + readback + diff |
| `bold davinci integrate --request R` | write | motion request → import + insert + verify |
| `bold davinci sandbox-timeline …` | write (só sandbox) | cria `BOLD_BRIDGE_TEST*` vazia no `BOLD_BRIDGE_SANDBOX*` aberto |
| `bold davinci delete --targets alvos.json` | write (V1.1) | remove itens da timeline por alvos exatos, **sem ripple**; autorização listando `delete`; `.drp`; readback "removeu exatamente os alvos" |
| `replace · ripple · move · render · export` | — | **`NOT_AVAILABLE_V1`** (exit 64) |

\* `checkpoint` passa pelo mesmo gate de autorização porque `--drp` chama `SaveProject`.

- Writes exigem `--resolve-project` com o nome **exato** do projeto aberto, e `--timeline`.
- `--project` é a opção global de PROJECT_ROOT, não o projeto do Resolve.
- `--at` aceita `Nf` (N frames desde o início da timeline) ou um timecode **absoluto** da timeline. DF usa `;`.
- Exit codes:

  | Exit | Significado | Códigos |
  |---|---|---|
  | 0 | OK | — |
  | 1 | FAIL | readback divergiu |
  | 3 | STOP | ABORT por guard: `WRONG_PROJECT`, `WRONG_PAGE`, `TIMELINE_GATE_FAILED`, `MEDIA_AMBIGUOUS`, `TARGET_OCCUPIED`… |
  | 4 | DENIED | `REAL_PROJECT_WRITE_DENIED`, `AUTHORIZATION_*`, `SANDBOX_REQUIRED` |
  | 5 | UNAVAILABLE | Resolve fechado, API ausente |
  | 64 | USAGE | uso inválido, `NOT_AVAILABLE_V1` |

## 3. Sequência de um write (insert)

1. `project_guard`: o projeto **corrente** tem o nome esperado. A Bridge nunca troca de projeto.
2. `write_scope`:
   - sandbox → modo `sandbox`;
   - senão, exige `davinci-write` com projeto + timeline no escopo, senão `REAL_PROJECT_WRITE_DENIED` ou `AUTHORIZATION_SCOPE_MISMATCH`.
3. `page_guard`: página == `edit` (H7). Nunca `OpenPage` (H8).
4. Mídia:
   - o arquivo existe e não é vazio (realpath);
   - o item é localizado no pool **por File Path** (H5);
   - mais de um candidato → `MEDIA_AMBIGUOUS`; nenhum → `MEDIA_NOT_IN_POOL`.
5. Pré-condições:
   - a track existe (a V1 não cria tracks: `TRACK_NOT_FOUND`);
   - duração e `src_in` cabem na mídia (`DURATION_INVALID`);
   - o intervalo `[in, in+dur)` está **livre** (`TARGET_OCCUPIED`; a V1 não sobrescreve).
6. Snapshot PRE e checkpoint. Fora do sandbox, o `.drp` é **obrigatório** (H3), mesmo sem `--drp`. No sandbox, o CLI faz `.drp` por padrão e aceita `--no-drp`.
7. `WriteIntent` registrado em `<checkpoint-dir>/davinci-writes.jsonl`.
8. **`timeline_gate` IMEDIATAMENTE antes do write** (H1, A1): `SetCurrentTimeline(alvo)` → `GetCurrentTimeline()` → nome == alvo, senão `TIMELINE_GATE_FAILED` (ABORTED registrado; nada escrito).
9. `AppendToTimeline([{mediaPoolItem, startFrame: src_in, endFrame: src_in+dur, trackIndex, recordFrame: abs}])`. `endFrame` é exclusivo (A11); `recordFrame` é absoluto.
10. Releitura da timeline corrente (sem reutilizar o objeto anterior), depois `verify` (name/File Path/track/TL in/TL out/duração/offset, H6) e diff PRE×POST. O resultado tem de ser **exatamente 1 adicionado** e nada removido, alterado ou com marker mudado (H4).
11. `WriteResult`:
    - `PASS` só se API ok **e** readback ok **e** diff ok. "A API retornou true" não basta;
    - divergência → `FAIL` (exit 1). A Bridge **não** tenta consertar (H2);
    - exceção de guard → `ABORTED`.

`import` segue os passos 1–4, 6–8 e então:
- `SetCurrentFolder(BOLD_MOTION)` → `ImportMedia([realpath])`;
- restaura o bin corrente;
- confere por File Path que o item está em `…/BOLD_MOTION`.

## 3.1 Sequência de um delete (V1.1)

1. `project_guard` e `write_scope(operation="delete")`: fora do sandbox, a autorização `davinci-write` precisa ter `davinci.operations` contendo `delete` (o CLI Node e a Bridge conferem; autorização genérica → `AUTHORIZATION_SCOPE_MISMATCH`).
2. `page_guard` (Edit).
3. Alvos: cada um `{unique_id, kind: video|audio, track, tl_in, tl_out[, file_path]}`. Localizado pelo UniqueId **na track indicada**; TL in/out (e File Path, se dado) precisam bater com o estado atual → senão `TARGET_NOT_FOUND`/`TARGET_MISMATCH`. Partes ligadas fora da lista → `LINKED_ITEMS_NOT_IN_TARGETS`. Nada é apagado nesses casos.
4. Snapshot PRE + checkpoint (`.drp` obrigatório fora do sandbox) + `WriteIntent`.
5. `timeline_gate` IMEDIATAMENTE antes (A1: `DeleteClips` age na corrente); os alvos são re-localizados no objeto da corrente.
6. `DeleteClips(itens, False)` — **sem ripple**.
7. Releitura + diff: PASS só se `removed == alvos`, nada adicionado/alterado, markers iguais e nenhum alvo restante. "Apagou a mais" → `FAIL` com `unexpected_removed` (rollback pelo `.drp`).

## 4. Checkpoint e rollback (sem fingir)

- O snapshot JSON (todas as timelines + contagem do pool + operação + página, com sha256) é **documentação e diff**. Rollback: `NONE`.
- Nome: `checkpoint_<AAAAMMDD_HHMMSS_mmm>_<op>[_n]`. Um checkpoint existente **nunca** é sobrescrito.
- O `.drp` (`SaveProject` → `ExportProject`) é verificado: existe, tamanho > 0, é zip, com sha256. É o **único** rollback real, e é **MANUAL**: reimportar o `.drp` no Project Manager. O Resolve não tem undo por API.
- `ExportProject` ou `SaveProject` falhou, ou o `.drp` veio vazio ou inválido → `CHECKPOINT_*` e o write **não** acontece.

## 5. Autorização para projeto real (`davinci-write`)

- A suíte e os pilotos de desenvolvimento escrevem **só** no sandbox.
- Em projeto real, o agente só grava uma autorização depois de constatar uma mensagem explícita do usuário que cite projeto, timeline e operação. Formato:
```json
{"action": ["davinci-write"], "source": "agent_attested_user_message", "text": "<mensagem literal do usuário>",
 "granted_by": "USER", "granted_at": "<ISO, ≤ 60 min>", "davinci": {"project": "<exato>", "timeline": "<exata>", "operations": ["import", "insert"]}}
```
- O CLI valida estrutura, frescor (≤ 60 min) e escopo, e registra a decisão em `authorizations.jsonl`.
- A Bridge reconfere o escopo.
- "Integrar", "finalizar", "verificar", "testar" e "QC" **não** são autorização.
- Autorização `davinci-write` **não** cobre render/export: estes são `NOT_AVAILABLE_V1` e, fora da Bridge, seguem o `render-policy.md`.

## 6. Sandbox e testes

| Opt-in (técnico — NÃO substitui autorização humana) | O que roda |
|---|---|
| nenhum (suíte padrão) | Bridge contra o Resolve **fake**; CLI com Python **sentinela** (prova que bloqueios acontecem antes da Bridge); `RESOLVE_SCRIPT_API` vazio. Nunca conecta no Resolve |
| `BOLD_TEST_DAVINCI=1` | leitura do Resolve aberto (status/timelines/inspect); confere que a timeline corrente **não** muda |
| `BOLD_TEST_DAVINCI_WRITE=1` + `BOLD_TEST_DAVINCI_MEDIA=<sintética>` [+ `…_MEDIA_DUP`] | só se o projeto **já aberto** for `BOLD_BRIDGE_SANDBOX*` e a página for Edit. Fluxo: `sandbox-timeline` (nome único) → import → insert → verify → bloqueios → `.drp` → homônimos |

- O `bold doctor` geral **não** conecta. `bold doctor --module davinci` faz uma conexão somente leitura.
- Preparar o sandbox é tarefa do **usuário**, porque criar ou carregar projeto por API fecharia o projeto aberto:
  1. Salvar o projeto atual.
  2. No Project Manager, criar `BOLD_BRIDGE_SANDBOX` e abri-lo na página Edit.
- Só mídia sintética/neutra no sandbox.

## 7. Motion Integration Request

```json
{"schema": "bold.davinci.motion_request/1", "project": "BOLD_BRIDGE_SANDBOX", "timeline": "BOLD_BRIDGE_TEST",
 "motion_master": "renders/abertura.mov", "track": 2, "start_frame": 24, "duration": 48}
```
- `motion_master` é relativo ao arquivo do request.
- `start_frame` conta frames desde o início da timeline.
- `duration` é opcional; o padrão é a mídia inteira.
- Chaves desconhecidas → `REQUEST_INVALID`. Não existe `overwrite` nem `replace`.
- Se existir `<master>.delivery.json` (BOLD Delivery), o sha256 do master tem de bater com `output_sha256`, senão `MASTER_HASH_MISMATCH`. O perfil, os frames e o fps do manifest vão para o resultado.

## 8. Limitações da V1

- Não cria tracks, não sobrescreve, não faz replace/ripple/move, render/export, troca de projeto ou de página, nem relink.
- Delete (V1.1) **não** fecha buracos: é sempre sem ripple. Fechar gap/mover continua sendo do usuário.
- A troca de timeline para o gate (H1) **muda a timeline corrente** do usuário. Por isso, fora do sandbox, todo write exige autorização. A leitura nunca troca.
- `inspect` de uma timeline não corrente devolve `enabled = null` para as tracks (A2).
- Fps de mídia ≠ fps da timeline: a Bridge insere a duração em frames **da timeline** e confere por readback. A conversão em tempo real (A18) não é recalculada pela V1.
- Mídia offline: a Bridge só reporta. Não corrige, não relinka, não conclui nada pelo viewer (`davinci-safety.md` P3).
- Itens Fusion/gerador aparecem como `kind: fusion` / `non_media` (sem File Path, A15) e nunca são alvo de write.
