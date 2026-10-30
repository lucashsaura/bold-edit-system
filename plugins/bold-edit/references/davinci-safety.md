# DaVinci Resolve — safety

**Status: CRITICAL.** Validado em **DaVinci Resolve Studio 21.1** (Scripting API em Python, scripting externo = Local).
Antes de escrever numa versão diferente, revalide as regras de comportamento num projeto **sandbox**.
Os procedimentos estão em `davinci-api-recipes.md`. A ferramenta que aplica estas regras é a **DaVinci Bridge V1** (`davinci-bridge.md`, R7).

Classes de regra:
- **[HARD]** regra de segurança, inegociável;
- **[API]** comportamento conhecido da API;
- **[VER]** sensível à versão;
- **[PRACTICE]** prática recomendada.

---

## 1. Hard safety rules

### H1 — Gate de timeline antes de QUALQUER write [HARD]
- **RULE:** antes de cada escrita, chame `project.SetCurrentTimeline(target)`, depois confira `project.GetCurrentTimeline().GetName() == target_name`.
- **RATIONALE:** os métodos de escrita agem na timeline **corrente**, não no objeto `Timeline` recebido (A1).
- **VALIDATION:** faça um `assert` imediatamente antes de **cada** write. Uma conferência no início do script não basta.
- **FAIL CONDITION:** a timeline corrente é `None` ou tem outro nome → **ABORT** sem escrever nada.

### H2 — Ambíguo → PARE [HARD]
- **RULE:** retorno inesperado (`False`, `None`, contagem divergente), página inesperada ou resultado que não fecha com o snapshot → **PARE**.
- **RULE:** nunca "conserte" destrutivamente, nunca re-tente às cegas.
- **RISK:** um retry pode duplicar inserts na timeline errada.

### H3 — Checkpoint antes de mudança estrutural [HARD]
- **RULE:** antes de insert, delete, replace, ripple, mudança de tracks ou bins: `SaveProject` e depois `ExportProject(nome, caminho.drp)`.
- **VALIDATION:** o arquivo existe, tamanho > 0, hash registrado.
- **FAIL CONDITION:** export retornou `False` ou o arquivo veio vazio → não prossiga (A10).

### H4 — Snapshots PRE/POST + diff [HARD]
- **RULE:** tire um snapshot JSON de **todas** as timelines antes e depois de qualquer batch de write, e compare com o diff esperado.
- **FAIL CONDITION:** existe diferença fora do escopo planejado → PARE e reporte (reverta só com aprovação).

### H5 — Media Pool por FILE PATH [HARD]
- **RULE:** localize o `MediaPoolItem` pelo `File Path` completo, nunca pelo nome do arquivo.
- **RATIONALE:** pastas de câmeras diferentes têm arquivos com o mesmo nome, e a busca por nome devolve o primeiro que entrou no pool (`lessons-learned.md` L-02).

### H6 — Verificar cada insert por name + TL IN + TL OUT + File Path [HARD]
- **RULE:** leia de volta cada item inserido.
- **RATIONALE:** conferir só a duração deixa um item preexistente passar por item novo e esconde a falha.
- **FAIL CONDITION:** algum campo diverge, ou `LeftOffset` passa do fim da mídia, ou `RightOffset` sai negativo → PARE.

### H7 — Página Fusion aberta: não trocar de timeline [HARD]
- **RULE:** exija `resolve.GetCurrentPage() == "edit"` antes de qualquer batch de write.
- **RATIONALE:** na página Fusion, o clip sob o playhead recebe uma comp automaticamente, e trocar de timeline ali cria comps não pedidas.
- **FAIL CONDITION:** a página não é `edit` → PARE e peça ao usuário para voltar à página Edit manualmente.

### H8 — `OpenPage` proibido [HARD]
- **RULE:** não chame `resolve.OpenPage(...)`. Essa é a invariante `allow_open_page=false`.
- **RATIONALE:** já travou a interface e já retornou `None`. A troca de página por API não é confiável.
- **FALLBACK:** peça ao usuário para trocar de página.
- **NOTA:** documentos antigos registram usos pontuais de `OpenPage("edit")` com autorização. Esses casos **não** são precedente: a regra vigente é a proibição.

### H9 — Nunca alterar mídia de origem para contornar a API [HARD]
- **RULE:** não renomeie, mova, apague nem recodifique mídia do usuário para driblar uma limitação.
- Exceção: só com autorização explícita e com verificação de hash antes e depois.

### H10 — Render/export só com autorização explícita [HARD]
Ver `render-policy.md`. Isso inclui Render Queue, Render Settings e Deliver.

### H11 — Sem automação de UI [HARD]
Não use Computer Use nem automação de UI no Resolve sem autorização explícita.

### H12 — Delete só por alvo exato, sem ripple, com autorização explícita [HARD] (V1.1)
- **RULE:** excluir itens da timeline só via Bridge (`bold davinci delete`): alvos por UniqueId + track + TL in/out (+ File Path) lidos na hora; partes ligadas incluídas; `DeleteClips(…, False)`; `.drp` antes; gate imediatamente antes; readback/diff.
- **RULE:** a autorização humana precisa **listar `delete`** em `davinci.operations`. "Pode escrever/editar" genérico não vale.
- **RULE:** nunca apagar mídia (Media Pool/disco) e nunca ripple/mover (fechar gap continua manual).
- **RATIONALE:** sem undo por script (só o `.drp`), A1 (age na timeline corrente) e edição manual do usuário são os riscos; o alvo exato + readback limitam o estrago ao pedido.
- **FAIL CONDITION:** alvo divergente/ausente/ligado fora da lista → ABORT sem apagar; removeu algo além dos alvos → FAIL e rollback manual pelo `.drp`.

---

## 2. Known API behavior [API] (Resolve 21.1)

| # | Comportamento | Consequência |
|---|---|---|
| A1 | `DeleteClips` e `AppendToTimeline` operam em `GetCurrentTimeline()` e **ignoram** o objeto `Timeline` recebido | Com outra timeline corrente, `DeleteClips` retorna `False` sem apagar e `AppendToTimeline` **escreve na timeline errada**. Daí a regra H1 |
| A2 | `GetIsTrackEnabled` só é confiável na timeline **corrente** | Para timelines não correntes, retorna `False` em todas as tracks. Não trate essa diferença como alteração em snapshots |
| A3 | `SetTrackEnable` só tem efeito na **página Edit** | Em outra página retorna `True` e não muda nada. **Leia de volta sempre** |
| A4 | `SetTrackEnable` em áudio **não** afeta o render de áudio | Para separar stems, silencie o `AudioVolume` por clipe e restaure depois |
| A5 | `ApplyGradeFromDRX` muda a página para **Color** | Volte para Edit (pelo usuário) antes de qualquer write estrutural |
| A6 | `StartRendering` muda a página para **Deliver** | Faça todos os writes de timeline antes do render |
| A7 | `ExportCurrentFrameAsStill` logo depois de `SetCurrentTimeline` pode devolver o frame **anterior** | Faça um warm-up e exporte duas vezes, comparando |
| A8 | `InsertGeneratorIntoTimeline` usa as marks **salvas** da timeline quando não há marks explícitas | Um Mark Out salvo gerou um gerador do tamanho da timeline inteira. Sempre `SetMarkInOut` explícito |
| A9 | `SetMarkInOut(-1, x)` falha | A API não recria uma mark "só Out" |
| A10 | `ExportProject` retorna `False` se o projeto nunca foi salvo no Project Manager | Rode `SaveProject` antes. `ExportProject` por nome funciona sem carregar o projeto |
| A11 | `AppendToTimeline` com `endFrame` é efetivamente **exclusivo** | `endFrame = N` gera N frames |
| A12 | `SetStartTimecode` só re-rotula; não move itens | — |
| A13 | Mark In/Out são ignorados com `SelectAllFrames=True` no render | — |
| A14 | `InsertFusionTitleIntoTimeline` força ripple insert; `InsertFusionCompositionIntoTimeline` não controla a track | Prefira append de mídia ou comp exportada |
| A15 | Um item "Fusion Composition" vive na **instância** da timeline, não no item do pool. Re-append volta vazio. Esses itens não têm File Path e devolvem `None` em `GetSourceStart/EndFrame` | Identifique por nome + tipo + bin + UID. Para reutilizar, use `ExportFusionComp` |
| A16 | `ImportMedia` falha (0 clipes) em caminho com **barra invertida literal** no nome do diretório | Não renomeie por conta própria (H9). Reporte e peça autorização |
| A17 | `CreateMulticamClip` com sync por áudio **falha** quando as tomadas repetem o mesmo texto | Confira a duração resultante contra o clipe mais longo e contra a soma |
| A18 | Mídia 23,976/29,97 numa timeline de 24 fps é convertida em **tempo real** | `LeftOffset(TL) = src × 24/fps`. Para sincronizar, alinhe a "origem virtual" `TL_in − src × 24/fps` |
| A19 | API de áudio: existem `SetProperty("AudioVolume", dB)` e `SetFades({"FadeIn":f,"FadeOut":f})` (só na forma dicionário). **Não existem** fader de track, automação, EQ, compressão, normalização | Mixagem fina fica manual (Fairlight) |
| A20 | Render só de áudio com formato MP4 corrente: o preset "Audio Only" não troca o formato e o job fica "Ready" | Use `SetCurrentRenderFormatAndCodec("mov", …)`, `ExportVideo=False`, `AudioCodec="lpcm"`. Aguarde o status do job, não `IsRenderingInProgress()` |
| A21 | Fusion: o alpha do nó Background é **pré-multiplicado** | Considere isso ao comparar com material straight |
| A22 | Timelines aparecem no Media Pool (`GetClipList`) como itens `Type = "Timeline"`, **sem** File Path (R7, sandbox, 21.1.0.14) | Contagem do pool inclui timelines. Busca por File Path ignora esses itens; nunca use o nome |
| A23 | `AppendToTimeline` `recordFrame` é frame **absoluto** da timeline (inclui o start, ex.: 86400 em 01:00:00:00); `GetStart`/`GetEnd` também. `GetEnd = in + dur` (exclusivo, confirma A11) (R7, sandbox) | Converta `Nf` relativo somando `GetStartFrame()` |
| A24 | `ImportMedia` de dois arquivos com o **mesmo nome** em pastas diferentes cria dois itens distintos no mesmo bin (R7, sandbox) | Busca por nome é ambígua (L-02). Use File Path (H5) |

## 3. Version-sensitive behavior [VER]

| # | Observado em 21.1 | Ação em outra versão |
|---|---|---|
| V1 | Render MP4/H.264 de timeline longa saiu **só com áudio** (job "Complete" em segundos) | Use MOV/H.264 e remux para MP4 com `-c copy`. Revalide |
| V2 | `OpenPage` travou a UI / retornou `None` | Continua proibido, em qualquer versão |
| V3 | O caminho de visualização/still faz média de croma entre pares de colunas (1 px) em linhas finas | Não é defeito do arquivo. Confira decodificando o arquivo com ffmpeg |
| V4 | Unidades de Fusion via API (texto, máscaras, borda) dependem da fonte e da versão | Meça de novo por versão e por fonte (`fusion.md`) |

## 4. Recommended practices [PRACTICE]

- **P1 — Ensaio em `DuplicateTimeline`:** operações novas ou de ripple rodam antes numa duplicata descartável. Confira a timeline real idêntica ao PRE antes do write de verdade. Apague a duplicata depois.
- **P2 — Uma escrita por vez:** gate, write, readback, e só então o próximo.
- **P3 — Mídia offline "fantasma":** depois de desconectar e reconectar um disco, o Resolve pode reportar `Online` e mesmo assim mostrar "Media Offline" (handles antigos). Antes de concluir que algo sumiu: `SaveProject` → `CloseProject` → `LoadProject`, depois página Edit e timeline. Nunca valide visualmente antes disso.
- **P4 — Copiar, não mover:** mídia lida pelo Resolve fica no caminho atual. Para arquivar, copie e confira o hash (mover gera offline).
- **P5 — Log de operações:** todo write entra no `OPERATIONS_LOG.md` do projeto (modelo em `templates/docs/`), com checkpoint PRE e POST.
- **P6 — Cor:** classifique os clips por **metadados**, nunca pela aparência. Nunca aplique grade em motion, gráfico ou alpha. Nada de LUT ou CST automático. Ver `davinci-api-recipes.md` §DRX APPLY.
- **P7 — Desligar em vez de apagar:** em revisão, desligar preserva o rollback. Apagar só com pedido explícito.
- **P8 — Nunca relinkar, consolidar ou rodar Media Management** sem pedido explícito.
- **P9 — Edição manual do usuário é autoritativa:** se o snapshot mostra uma mudança que você não fez, ela é do usuário. Não reverta.

## 5. Checklist pré-write

```
[ ] página == "edit"                       (H7)
[ ] checkpoint .drp criado, tamanho > 0    (H3)
[ ] snapshot PRE de todas as timelines     (H4)
[ ] mídia localizada por File Path          (H5)
[ ] ensaio em duplicata, se ripple/novo     (P1)
[ ] gate SetCurrentTimeline + nome          (H1)  ← imediatamente antes de CADA write
[ ] readback name + TL in/out + File Path  (H6)
[ ] snapshot POST + diff == esperado        (H4)
[ ] checkpoint POST + log                   (H3, P5)
```

## 6. Onde cada regra é aplicada (Bridge V1, R7)

| Regra | Implementação | Falha → |
|---|---|---|
| H1 gate de timeline | `guards.timeline_gate`, chamado **imediatamente antes** de `ImportMedia`, de `AppendToTimeline` e de nenhum outro ponto | `TIMELINE_GATE_FAILED` (ABORTED, nada escrito) |
| H2 ambíguo → pare | readback + diff; sem retry, sem "conserto" | `FAIL` / `ABORTED` |
| H3 checkpoint `.drp` | `checkpoint.create(drp=True)`: SaveProject → ExportProject → existe, > 0, zip, sha256. **Obrigatório fora do sandbox** | `CHECKPOINT_*` (write não acontece) |
| H4 snapshots + diff | snapshot de todas as timelines no checkpoint; diff PRE×POST da timeline alvo = exatamente 1 adicionado | `FAIL` |
| H5 File Path | `media.find_by_path` (NFC + normpath + realpath); > 1 → ambíguo | `MEDIA_AMBIGUOUS` / `MEDIA_NOT_IN_POOL` |
| H6 readback | `ops.verify`: File Path + track + TL in + TL out + duração + LeftOffset ≥ 0 | `FAIL` |
| H7 página | `guards.page_guard` (só `edit`) antes de cada batch | `WRONG_PAGE` |
| H8 OpenPage | não existe chamada a `OpenPage` no código | — |
| H9 mídia de origem | a Bridge só lê arquivos (realpath/size); nunca move/renomeia/recodifica | — |
| H10 render/export | `NOT_AVAILABLE_V1`; nenhuma chamada de Render Queue/Settings/Deliver no código | exit 64 |
| H11 UI | nenhuma automação de UI | — |
| projeto real | `write_scope` + `checkDavinciWrite`: só com autorização humana `davinci-write` (projeto + timeline + operação, ≤ 60 min) | `REAL_PROJECT_WRITE_DENIED` / `AUTHORIZATION_*` |
| projeto errado | `project_guard`: nome exato do projeto **aberto**; a Bridge nunca troca de projeto | `WRONG_PROJECT` |
| sobrescrita | intervalo alvo precisa estar livre | `TARGET_OCCUPIED` |

Os comportamentos A1/A2/A11 estão emulados no Resolve fake (`davinci/tests/fakes.py`). Revalidação no Resolve real: §6 de `davinci-bridge.md`.
