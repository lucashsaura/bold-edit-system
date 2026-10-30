"""CHECKPOINT antes de alteração estrutural (H3/H4).
Sempre: snapshot JSON de TODAS as timelines + Media Pool (contagem) + operação planejada, com sha256.
Opcional (--drp): SaveProject + ExportProject(.drp) verificado (existe, tamanho > 0, zip válido) — é o ÚNICO
rollback real (reimportar o .drp). Sem .drp, o checkpoint é DOCUMENTAÇÃO (diff), não rollback — e isso é declarado."""
import hashlib
import json
import os
import time
import zipfile

from davinci.api.connect import BridgeError
from davinci.safety.guards import timelines
from davinci.timeline.inspect import inspect_timeline
from davinci.media.media import walk


def snapshot(project):
    cur = project.GetCurrentTimeline(); cur_name = cur.GetName() if cur is not None else None
    tls = [inspect_timeline(project, t, t.GetName() == cur_name) for t in timelines(project) if t is not None]
    pool = sum(1 for _ in walk(project.GetMediaPool().GetRootFolder()))
    return {"current_timeline": cur_name, "timelines": tls, "media_pool_items": pool}


def create(resolve, project, operation, target_timeline, out_dir, drp=False):
    if not out_dir:
        raise BridgeError("CHECKPOINT_DIR_REQUIRED", "diretório de checkpoint obrigatório")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S") + f"_{int(time.time() * 1000) % 1000:03d}"
    base, n = f"checkpoint_{stamp}_{operation}", 1
    while any(os.path.exists(os.path.join(out_dir, f"{base}{ext}")) for ext in (".json", ".drp")):  # nunca sobrescreve um checkpoint
        n += 1; base = f"checkpoint_{stamp}_{operation}_{n}"
    snap = snapshot(project)
    rec = {"schema": "bold.davinci.checkpoint/1", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "project": project.GetName(), "timeline": target_timeline,
           "operation": operation, "page": resolve.GetCurrentPage(), "snapshot": snap}
    body = json.dumps(rec, ensure_ascii=False, sort_keys=True)
    path = os.path.join(out_dir, f"{base}.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    out = {"snapshot_file": path, "snapshot_sha256": hashlib.sha256(body.encode()).hexdigest(), "timelines": len(snap["timelines"]),
           "drp": None, "rollback": "NONE — snapshot é documentação/diff; não há rollback automático"}
    if drp:
        pm = resolve.GetProjectManager()
        if not pm.SaveProject():
            raise BridgeError("CHECKPOINT_SAVE_FAILED", "SaveProject retornou False; checkpoint .drp impossível (A10)")
        drp_path = os.path.join(out_dir, f"{base}.drp")
        if not pm.ExportProject(project.GetName(), drp_path):
            raise BridgeError("CHECKPOINT_EXPORT_FAILED", "ExportProject retornou False (A10)")
        if not os.path.isfile(drp_path) or os.path.getsize(drp_path) == 0:
            raise BridgeError("CHECKPOINT_EMPTY", ".drp não criado ou vazio")
        if not zipfile.is_zipfile(drp_path):
            raise BridgeError("CHECKPOINT_INVALID", ".drp não é um zip válido")
        with open(drp_path, "rb") as f:
            out["drp"] = {"file": drp_path, "bytes": os.path.getsize(drp_path), "sha256": hashlib.sha256(f.read()).hexdigest()}
        out["rollback"] = "MANUAL — reimportar o .drp no Project Manager (o Resolve não tem undo via API)"
    return out


def diff_timeline(pre, post):
    """Diff de UMA timeline: added/removed por UniqueId (fallback name+path+tl_in)."""
    def keys(t):
        out = {}
        for kind, tracks in t["tracks"].items():
            for tr in tracks:
                for it in tr.get("items", []):
                    k = it.get("unique_id") or f"{it['name']}|{it.get('file_path')}|{it['tl_in']}"
                    out[k] = {**it, "track_type": kind, "track": tr["index"]}
        return out
    a, b = keys(pre), keys(post)
    changed = [k for k in a.keys() & b.keys() if {x: a[k][x] for x in ("tl_in", "tl_out", "file_path", "track")} != {x: b[k][x] for x in ("tl_in", "tl_out", "file_path", "track")}]
    return {"added": [b[k] for k in b.keys() - a.keys()], "removed": [a[k] for k in a.keys() - b.keys()], "changed": [b[k] for k in changed],
            "markers_changed": pre["markers"] != post["markers"]}
