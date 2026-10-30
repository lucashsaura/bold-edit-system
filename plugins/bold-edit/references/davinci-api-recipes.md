# DaVinci Resolve — API recipes

**Status: RECEITAS DOCUMENTADAS.** CONNECT, TIMELINE GATE, CHECKPOINT, SNAPSHOT, DIFF, FIND MEDIA BY PATH, INSERT e VERIFY INSERT estão **implementados** na DaVinci Bridge V1 (`davinci-bridge.md`, R7).
Validado em Resolve 21.1. As regras estão em `davinci-safety.md` (os códigos H*/A* citados abaixo vêm de lá).
Os trechos são **pseudocódigo Python**. REPLACE, RIPPLE, TRACK STATE, DRX APPLY e STILL EXPORT continuam só como receita (`NOT_AVAILABLE_V1` na Bridge).

---

## CONNECT SAFELY
```python
import os, sys
api = os.environ.get("RESOLVE_SCRIPT_API") or "<DAVINCI_SCRIPT_API da config>"
lib = os.environ.get("RESOLVE_SCRIPT_LIB") or "<DAVINCI_SCRIPT_LIB da config>"
os.environ.setdefault("RESOLVE_SCRIPT_API", api); os.environ.setdefault("RESOLVE_SCRIPT_LIB", lib)
sys.path.append(os.path.join(api, "Modules"))
import DaVinciResolveScript as dvr
resolve = dvr.scriptapp("Resolve")
if resolve is None: abort("Resolve fechado ou External scripting != Local")
project = resolve.GetProjectManager().GetCurrentProject()
if project is None or project.GetName() != EXPECTED_PROJECT: abort("projeto aberto != esperado")
```
- **VALIDATION:** o nome do projeto bate com o esperado.
- **FAIL:** o objeto veio `None` ou o projeto é outro → ABORT.
- Leitura (`GetVersion`, `GetCurrentPage`, listar timelines) não precisa de checkpoint.

## TIMELINE GATE (H1)
```python
def gate(project, name):
    tl = find_timeline_by_name(project, name)          # percorre GetTimelineByIndex(1..N)
    if tl is None: abort(f"timeline {name!r} não existe")
    project.SetCurrentTimeline(tl)
    cur = project.GetCurrentTimeline()
    if cur is None or cur.GetName() != name: abort(f"corrente={cur and cur.GetName()!r}, esperado={name!r}")
    if resolve.GetCurrentPage() != "edit": abort("página != edit")
    return cur
```
Chame `gate()` **imediatamente antes de cada write**, não só uma vez por script.

## CHECKPOINT (H3)
```python
pm = resolve.GetProjectManager()
assert pm.SaveProject()                                  # sem isso, ExportProject pode retornar False (A10)
ok = pm.ExportProject(project.GetName(), "<PROJECT_ROOT>/checkpoints/<PROJ>_<AAAAMMDD_HHMM>_<pre|post>_<OPERACAO>.drp")
```
- **VALIDATION:** `ok` é True, o arquivo existe, tamanho > 0, sha256 registrado e `unzip -t` OK (o `.drp` é um zip).
- **Nomenclatura:** `<PROJ>_<AAAAMMDD_HHMM>_<pre|post>_<OPERACAO>.drp`.
- **Retenção:** guarde os marcos e compacte os intermediários. Nunca apague sem decisão do usuário.

## SNAPSHOT (H4)
Formato (JSON, por timeline):
```json
{"<timeline>": {"start": 0, "end": 1234, "dur": 1234, "startTC": "00:00:00:00",
  "tracks": {"video1": {"name": "V1", "enabled": true, "items": [
      ["<name>", 10, 58, 48, 120, "<File Path>", "<UniqueId>"]]}},
  "markers": {"100": {"color": "Blue", "duration": 1, "note": "", "name": ""}}}}
```
- Cada item é `[name, TL_in, TL_out, dur, src_offset, File Path, UniqueId]`.
- Cubra **todas** as timelines.
- Ao comparar, ignore `enabled` de timelines não correntes (A2).

## DIFF
- Chave do item: `UniqueId`. Fallback: `name + File Path + TL_in`.
- Classifique cada diferença: `added`, `removed`, `moved` (Δ TL), `trimmed` (Δ dur/offset), `media_changed` (Δ File Path), `enabled_changed` (só na timeline corrente), mais os markers.
- **VALIDATION:** o diff real é igual ao diff planejado. Qualquer extra → PARE (H4).

## FIND MEDIA BY PATH (H5)
```python
def find_by_path(folder, path):                          # recursivo a partir de GetRootFolder()
    for clip in folder.GetClipList():
        if clip.GetClipProperty("File Path") == path: return clip
    for sub in folder.GetSubFolderList():
        r = find_by_path(sub, path)
        if r: return r
    return None
```
- Compare os caminhos já **normalizados**: o disco pode guardar NFD e o banco NFC (acentos).
- Para importar: `MediaPool.ImportMedia([path])` no bin certo e depois `find_by_path`. Nunca use o retorno por nome.

## INSERT (append numa posição)
```python
tl = gate(project, TARGET)
item = find_by_path(root, PATH)
res = media_pool.AppendToTimeline([{"mediaPoolItem": item, "startFrame": SRC_IN, "endFrame": SRC_OUT,
                                    "trackIndex": TRACK, "recordFrame": TL_IN}])   # endFrame exclusivo (A11)
```
Depois: VERIFY INSERT.

## VERIFY INSERT (H6)
- Para cada item novo, leia `GetName`, `GetStart`, `GetEnd`, `GetMediaPoolItem().GetClipProperty("File Path")`, `GetLeftOffset` e `GetRightOffset`.
- **PASS:** name, TL in, TL out e File Path batem; `LeftOffset` < duração da mídia; `RightOffset` ≥ 0.
- **FAIL:** qualquer divergência → PARE. Não tente "consertar" com outro insert.

## REPLACE (trocar a mídia sem mexer na edição)
- **Opção A, `MediaPoolItem.ReplaceClip(new_path)`:** troca a mídia de todas as instâncias. Use quando a versão nova tem duração e fps idênticos (por exemplo, um re-encode de cor).
  - **Readback:** track, TL, source, offsets, enable, composite, opacity e alpha mode idênticos.
  - **Rollback:** `ReplaceClip(old_path)`. Registre a tabela "antes" (pool → caminho).
- **Opção B, swap pontual:** gate → `DeleteClips([item], False)` (sem ripple) → append no **mesmo** TL in/track → VERIFY INSERT.

## RIPPLE INSERT (inserir N frames no início, com ripple global)
A API não tem um insert edit com ripple. Receita validada:
1. Checkpoint + snapshot PRE. Ensaie numa `DuplicateTimeline` descartável (P1).
2. gate → `tl.SetMarkInOut(0, N-1)`. **Sempre explícito**, porque marks salvas contaminam o gerador (A8).
3. `tl.SetCurrentTimecode(<start>)` → `tl.InsertGeneratorIntoTimeline("Solid Color")`. Isso faz um insert com ripple em todas as tracks, markers e legendas.
4. `tl.DeleteClips([gerador], False)`, sem ripple.
5. `AppendToTimeline` do master em [0, N) na track desejada, source 0.
6. **VALIDATION:**
   - todo item preexistente ficou em **+N** com a mesma UniqueId, nome, offset e duração;
   - todos os markers ficaram em +N;
   - a duração final é a duração anterior + N.
7. Restaure as marks equivalentes (lembre que "só Out" não é recriável, A9).

## TRACK STATE
- A página precisa ser `edit` (A3) e a timeline corrente (A2).
- `tl.SetTrackEnable("video", i, bool)` → leia de volta com `tl.GetIsTrackEnabled("video", i)`.
- Para áudio no render: o enable não afeta o resultado (A4). Use `SetProperty("AudioVolume", …)` por clipe e restaure.

## STILL EXPORT (QC sem render; permitido)
- gate (só leitura de posição) → `tl.SetCurrentTimecode(tc)` → **warm-up** (um export descartável) → `project.ExportCurrentFrameAsStill(path)` **duas vezes**, comparando as duas (A7).
- Sem grade aplicada aos motions. Compare os pixels medidos com o PNG da fonte.
- Lembre que linhas de 1 px podem mostrar média de croma (V3).

## DRX APPLY (aplicar um look aprovado da Gallery)
1. Classifique os clips por **metadados** (perfil de gamma, modelo da câmera, tags), nunca pela aparência.
2. `album.ExportStills([still], dir, prefix, "drx")` → `item.GetNodeGraph().ApplyGradeFromDRX(drx, 0)`.
3. **Readback:** a estrutura de nós (labels, tools, LUT) igual à do clip de origem.
4. **Atenção:** a página muda para Color (A5). Peça para voltar a Edit antes de writes estruturais.
5. Balance por plano: só via `SetCDL` no nó designado para balance. Nunca nos nós do look.
6. **Nunca** aplique grade em motion, gráfico ou alpha. Não crie looks novos sem pedido.

## MEDIA OFFLINE RECOVERY
1. **Não** relinke, não mova e não renomeie.
2. Confira que o volume está montado e que o arquivo existe no caminho exato (normalizado).
3. Se o arquivo existe e mesmo assim aparece offline: `SaveProject` → `CloseProject` → `LoadProject` → (usuário) página Edit → gate da timeline (P3).
4. Releia `Online Status` e exporte stills de confirmação.
5. Se o arquivo de fato não existe: PARE e reporte a lista por File Path. Relink só com autorização.
