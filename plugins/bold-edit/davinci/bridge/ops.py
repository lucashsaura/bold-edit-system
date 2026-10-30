"""OPERAÇÕES da Bridge V1. Leitura: status, projects, timelines, inspect, media_inspect, verify.
Escrita (sempre: project_guard → write_scope → page_guard → mídia por File Path → checkpoint → WriteIntent →
timeline_gate IMEDIATAMENTE antes → write → readback → verificação → WriteResult): import_media, insert,
delete (V1.1: remove itens da TIMELINE — nunca mídia —, SEM ripple, só alvos identificados por UniqueId + track + TL in/out).
NÃO existe: replace, ripple, move, render, export, OpenPage, troca de projeto/página."""
import os

from davinci.api.connect import BridgeError
from davinci.safety import guards
from davinci.safety.intents import write_intent, write_result, log_write
from davinci.timeline.inspect import inspect_timeline, summary, timeline_fps
from davinci.timeline.timecode import tc_to_frames, frames_to_tc
from davinci.media import media
from davinci.checkpoint import checkpoint as ckpt

MOTION_BIN = "BOLD_MOTION"
NOT_AVAILABLE_V1 = ("replace", "ripple", "move", "render", "export")
TRACK_KINDS = ("video", "audio")


def status(resolve):
    out = {"schema": "bold.davinci.status/1", "connected": True, "product": resolve.GetProductName(), "version": resolve.GetVersionString(),
           "studio": "Studio" in (resolve.GetProductName() or ""), "page": resolve.GetCurrentPage(), "project": None, "timeline": None}
    p = resolve.GetProjectManager().GetCurrentProject()
    if p is not None:
        out["project"] = p.GetName(); out["timeline_count"] = p.GetTimelineCount()
        tl = p.GetCurrentTimeline()
        if tl is not None:
            raw, fps, df = timeline_fps(p, tl)
            out["timeline"] = {"name": tl.GetName(), "fps": float(raw), "drop_frame": df, "resolution": [int(tl.GetSetting("timelineResolutionWidth") or 0), int(tl.GetSetting("timelineResolutionHeight") or 0)], "start_tc": tl.GetStartTimecode()}
    sandbox = guards.is_sandbox_project(out["project"])
    out["write_safety"] = {"page_is_edit": out["page"] == "edit", "project_is_sandbox": sandbox,
                           "writes": ("ALLOWED (sandbox; gates técnicos)" if sandbox else "REQUIRE_HUMAN_AUTHORIZATION (davinci-write, escopo projeto+timeline)") if out["page"] == "edit" else "BLOCKED (página != edit)",
                           "not_available_v1": list(NOT_AVAILABLE_V1)}
    return out


def projects(resolve):
    pm = resolve.GetProjectManager()
    cur = pm.GetCurrentProject()
    return {"schema": "bold.davinci.projects/1", "current": cur.GetName() if cur else None, "in_current_folder": list(pm.GetProjectListInCurrentFolder() or [])}


def list_timelines(resolve):
    p = guards.current_project(resolve); cur = p.GetCurrentTimeline(); cn = cur.GetName() if cur else None
    return {"schema": "bold.davinci.timelines/1", "project": p.GetName(), "current": cn,
            "timelines": [{"index": i + 1, "name": t.GetName(), "is_current": t.GetName() == cn} for i, t in enumerate(guards.timelines(p)) if t is not None]}


def inspect(resolve, timeline=None, brief=False):
    """Somente leitura. Sem --timeline: a corrente. Com --timeline: lê SEM trocar a corrente (estado de track = null)."""
    p = guards.current_project(resolve); cur = p.GetCurrentTimeline()
    tl = guards.find_timeline(p, timeline) if timeline else cur
    if tl is None:
        raise BridgeError("NO_TIMELINE", "nenhuma timeline corrente; informe --timeline")
    is_cur = cur is not None and tl.GetName() == cur.GetName()
    data = inspect_timeline(p, tl, is_cur, items=not brief)
    return {"schema": "bold.davinci.inspect/1", "project": p.GetName(), "page": resolve.GetCurrentPage(), "timeline": data, "summary": summary(data) if not brief else None}


def media_inspect(resolve, path=None):
    p = guards.current_project(resolve); mp = p.GetMediaPool()
    items = [media.clip_info(b, c) for b, c in media.walk(mp.GetRootFolder())]
    if path:
        want = media.norm_path(path)
        return {"schema": "bold.davinci.media/1", "project": p.GetName(), "file_path": path,
                "matches": [i for i in items if media.norm_path(i["file_path"] or "") == want], "same_name_other_path": media.same_name_elsewhere(mp, path)}
    return {"schema": "bold.davinci.media/1", "project": p.GetName(), "count": len(items), "items": items}


def checkpoint(resolve, project, timeline, operation, out_dir, drp=False):
    p = guards.project_guard(resolve, project)
    guards.find_timeline(p, timeline)
    return ckpt.create(resolve, p, operation, timeline, out_dir, drp=drp)


def _record_frame(tl, fps, df, at):
    """--at: 'Nf' (frames desde o início da timeline) ou timecode absoluto da timeline. Retorna frame ABSOLUTO."""
    start = tl.GetStartFrame()
    if isinstance(at, str) and at.endswith("f") and at[:-1].isdigit():
        return start + int(at[:-1])
    return tc_to_frames(at, fps, df)


def _items(tl, track):
    return list(tl.GetItemListInTrack("video", track) or [])


def import_media(resolve, project, timeline, file_path, out_dir, authorization=None, drp=False):
    p = guards.project_guard(resolve, project)
    scope = guards.write_scope(p.GetName(), timeline, authorization)
    drp = drp or scope["mode"] != "sandbox"  # H3: fora do sandbox o checkpoint .drp é obrigatório
    guards.page_guard(resolve)
    real = media.check_file(file_path)
    mp = p.GetMediaPool()
    existing = media.find_by_path(mp, real) or media.find_by_path(mp, file_path)
    if existing:
        return {"status": "PASS", "imported": False, "reason": "já está no Media Pool (File Path idêntico)", "item": media.clip_info(*existing), "scope": scope}
    cp = ckpt.create(resolve, p, "import", timeline, out_dir, drp=drp)
    intent = write_intent(p.GetName(), timeline, "import", real, checkpoint=cp["snapshot_file"]); log_write(out_dir, intent)
    try:
        guards.timeline_gate(resolve, p, timeline)  # regra 7: gate também antes do import
        prev = mp.GetCurrentFolder()
        mp.SetCurrentFolder(media.ensure_bin(mp, MOTION_BIN))
        res = mp.ImportMedia([real]) or []
        if prev is not None:
            mp.SetCurrentFolder(prev)
        hit = media.find_by_path(mp, real)
        ok = hit is not None and hit[0].endswith(MOTION_BIN)
        result = write_result(intent, "PASS" if ok else "FAIL", requested={"file_path": real, "bin": MOTION_BIN},
                              actual=media.clip_info(*hit) if hit else None, verification={"api_returned": len(res), "found_by_path": hit is not None, "in_motion_bin": ok})
    except BridgeError as e:
        result = write_result(intent, "ABORTED", error=e.to_json()); log_write(out_dir, result); raise
    log_write(out_dir, result)
    return {"status": result["status"], "imported": True, "item": result["actual"], "checkpoint": cp, "result": result, "scope": scope}


def verify(resolve, project, timeline, file_path, track, at, duration=None):
    """Somente leitura: existe EXATAMENTE um item com esse File Path, track e TL in (e TL out se duration)."""
    p = guards.project_guard(resolve, project)
    tl = guards.find_timeline(p, timeline)
    raw, fps, df = timeline_fps(p, tl)
    rec = _record_frame(tl, fps, df, at)
    want = media.norm_path(os.path.realpath(file_path))
    found = []
    for it in _items(tl, track):
        mpi = it.GetMediaPoolItem()
        fp = mpi.GetClipProperty("File Path") if mpi else None
        if fp and media.norm_path(os.path.realpath(fp)) == want and it.GetStart() == rec:
            found.append(it)
    checks = {"found": len(found) == 1, "unique": len(found) <= 1}
    actual = None
    if len(found) == 1:
        it = found[0]
        actual = {"name": it.GetName(), "file_path": it.GetMediaPoolItem().GetClipProperty("File Path"), "track": track, "tl_in": it.GetStart(), "tl_out": it.GetEnd(),
                  "duration": it.GetDuration(), "left_offset": it.GetLeftOffset(), "tl_in_tc": frames_to_tc(it.GetStart(), fps, df)}
        if duration is not None:
            checks["tl_out"] = it.GetEnd() == rec + duration
            checks["duration"] = it.GetDuration() == duration
        checks["left_offset_ok"] = it.GetLeftOffset() >= 0
    return {"status": "PASS" if all(checks.values()) else "FAIL", "expected": {"file_path": file_path, "track": track, "tl_in": rec, "tl_out": rec + duration if duration is not None else None}, "actual": actual, "checks": checks}


def insert(resolve, project, timeline, file_path, track, at, out_dir, duration=None, src_in=0, authorization=None, drp=False):
    p = guards.project_guard(resolve, project)
    scope = guards.write_scope(p.GetName(), timeline, authorization)
    drp = drp or scope["mode"] != "sandbox"  # H3: fora do sandbox o checkpoint .drp é obrigatório
    guards.page_guard(resolve)
    real = media.check_file(file_path)
    mp = p.GetMediaPool()
    hit = media.find_by_path(mp, real)
    if hit is None:
        raise BridgeError("MEDIA_NOT_IN_POOL", "mídia não está no Media Pool por File Path; rode `bold davinci import` antes", {"file_path": real})
    clip = hit[1]
    tl = guards.find_timeline(p, timeline)
    raw, fps, df = timeline_fps(p, tl)
    if not isinstance(track, int) or track < 1 or track > (tl.GetTrackCount("video") or 0):
        raise BridgeError("TRACK_NOT_FOUND", f"track de vídeo V{track} não existe (a Bridge V1 não cria tracks)", {"track": track, "video_tracks": tl.GetTrackCount("video")})
    rec = _record_frame(tl, fps, df, at)
    clip_frames = int(clip.GetClipProperty("Frames") or 0)
    dur = int(duration) if duration is not None else clip_frames - int(src_in)
    if dur <= 0 or (clip_frames and int(src_in) + dur > clip_frames):
        raise BridgeError("DURATION_INVALID", "duração/src_in fora da mídia", {"clip_frames": clip_frames, "src_in": src_in, "duration": duration})
    busy = [{"name": it.GetName(), "tl_in": it.GetStart(), "tl_out": it.GetEnd()} for it in _items(tl, track) if it.GetStart() < rec + dur and it.GetEnd() > rec]
    if busy:
        raise BridgeError("TARGET_OCCUPIED", f"V{track} já tem item(ns) em [{rec}, {rec + dur}); a V1 não sobrescreve", {"occupied_by": busy})
    pre = inspect_timeline(p, tl, False)
    cp = ckpt.create(resolve, p, "insert", timeline, out_dir, drp=drp)
    intent = write_intent(p.GetName(), timeline, "insert", real, expected_track=track, expected_time={"tl_in": rec, "tl_out": rec + dur, "tc": frames_to_tc(rec, fps, df)}, checkpoint=cp["snapshot_file"])
    log_write(out_dir, intent)
    try:
        cur = guards.timeline_gate(resolve, p, timeline)  # H1: IMEDIATAMENTE antes do write
        res = mp.AppendToTimeline([{"mediaPoolItem": clip, "startFrame": int(src_in), "endFrame": int(src_in) + dur, "trackIndex": track, "recordFrame": rec}])
        api_ok = bool(res)
        cur = p.GetCurrentTimeline()  # releitura (não confiar no objeto anterior)
        post = inspect_timeline(p, cur, True)
        v = verify(resolve, project, timeline, real, track, f"{rec - cur.GetStartFrame()}f", dur)
        d = ckpt.diff_timeline(pre, post)
        only_one = len(d["added"]) == 1 and not d["removed"] and not d["changed"] and not d["markers_changed"]
        status = "PASS" if (api_ok and v["status"] == "PASS" and only_one) else "FAIL"
        result = write_result(intent, status, requested={"file_path": real, "track": track, "tl_in": rec, "tl_out": rec + dur, "src_in": int(src_in)},
                              actual=v["actual"], verification={"api_returned_items": len(res or []), "readback": v["checks"], "diff_added": len(d["added"]), "diff_removed": len(d["removed"]), "diff_changed": len(d["changed"]), "markers_changed": d["markers_changed"]})
    except BridgeError as e:
        result = write_result(intent, "ABORTED", error=e.to_json()); log_write(out_dir, result); raise
    log_write(out_dir, result)
    return {"status": result["status"], "result": result, "checkpoint": cp, "scope": scope}


def _resolve_targets(tl, targets):
    """Cada alvo = {unique_id, kind (video|audio), track, tl_in, tl_out[, file_path]}. Localiza pelo UniqueId NA track
    indicada e confere TL in/out (e File Path, se dado). Qualquer divergência → TARGET_MISMATCH (nada é apagado)."""
    if not isinstance(targets, list) or not targets:
        raise BridgeError("TARGETS_REQUIRED", "delete exige uma lista não vazia de alvos {unique_id, kind, track, tl_in, tl_out}")
    found, seen = [], set()
    for i, t in enumerate(targets):
        if not isinstance(t, dict) or any(k not in t for k in ("unique_id", "kind", "track", "tl_in", "tl_out")):
            raise BridgeError("TARGETS_INVALID", f"alvo {i}: exige unique_id, kind, track, tl_in, tl_out", {"target": t})
        if t["kind"] not in TRACK_KINDS or not isinstance(t["track"], int) or t["track"] < 1 or t["track"] > (tl.GetTrackCount(t["kind"]) or 0):
            raise BridgeError("TRACK_NOT_FOUND", f"alvo {i}: track {t.get('kind')}{t.get('track')} não existe", {"target": t})
        if t["unique_id"] in seen:
            raise BridgeError("TARGETS_INVALID", f"alvo {i}: unique_id repetido", {"target": t})
        seen.add(t["unique_id"])
        hits = [it for it in (tl.GetItemListInTrack(t["kind"], t["track"]) or []) if it.GetUniqueId() == t["unique_id"]]
        if len(hits) != 1:
            raise BridgeError("TARGET_NOT_FOUND", f"alvo {i}: UniqueId não está (exatamente uma vez) em {t['kind']}{t['track']}", {"target": t, "hits": len(hits)})
        it = hits[0]
        mpi = it.GetMediaPoolItem()
        fp = mpi.GetClipProperty("File Path") if mpi else None
        actual = {"name": it.GetName(), "tl_in": it.GetStart(), "tl_out": it.GetEnd(), "file_path": fp or None}
        bad = it.GetStart() != t["tl_in"] or it.GetEnd() != t["tl_out"] or ("file_path" in t and media.norm_path(t["file_path"] or "") != media.norm_path(fp or ""))
        if bad:
            raise BridgeError("TARGET_MISMATCH", f"alvo {i}: posição/arquivo não conferem com a timeline atual (ela mudou?)", {"expected": t, "actual": actual})
        found.append((t, it, actual))
    # partes LIGADAS (vídeo↔áudio) fora da lista: o Resolve pode removê-las junto → exige que estejam nos alvos
    for t, it, _ in found:
        linked = it.GetLinkedItems() if hasattr(it, "GetLinkedItems") else []
        missing = [x.GetUniqueId() for x in (linked or []) if x.GetUniqueId() not in seen]
        if missing:
            raise BridgeError("LINKED_ITEMS_NOT_IN_TARGETS", "o item tem partes ligadas que não estão na lista de alvos; inclua-as ou desligue o link", {"target": t, "linked_unique_ids": missing})
    return found


def delete(resolve, project, timeline, targets, out_dir, authorization=None, drp=False):
    """Remove itens da TIMELINE (não da mídia/Media Pool), SEM ripple. Mesma disciplina dos outros writes:
    project_guard → write_scope (davinci-write com operação 'delete') → page_guard → alvos conferidos → checkpoint (.drp
    obrigatório fora do sandbox) → WriteIntent → timeline_gate IMEDIATAMENTE antes → DeleteClips(…, False) → releitura →
    PASS só se removeu EXATAMENTE os alvos e nada mais mudou (nem posição de outros itens, nem markers)."""
    p = guards.project_guard(resolve, project)
    scope = guards.write_scope(p.GetName(), timeline, authorization, operation="delete")
    drp = drp or scope["mode"] != "sandbox"
    guards.page_guard(resolve)
    tl = guards.find_timeline(p, timeline)
    found = _resolve_targets(tl, targets)
    pre = inspect_timeline(p, tl, False)
    cp = ckpt.create(resolve, p, "delete", timeline, out_dir, drp=drp)
    intent = write_intent(p.GetName(), timeline, "delete", [t["unique_id"] for t, _, _ in found], checkpoint=cp["snapshot_file"])
    log_write(out_dir, intent)
    try:
        cur = guards.timeline_gate(resolve, p, timeline)  # H1 + A1: DeleteClips age na CORRENTE
        found = _resolve_targets(cur, targets)            # re-localiza no objeto da corrente, logo antes do write
        api_ok = bool(cur.DeleteClips([it for _, it, _ in found], False))  # False = SEM ripple
        cur = p.GetCurrentTimeline()
        post = inspect_timeline(p, cur, True)
        d = ckpt.diff_timeline(pre, post)
        removed = {r.get("unique_id") for r in d["removed"]}
        wanted = {t["unique_id"] for t, _, _ in found}
        still = [u for u in wanted if any(it.GetUniqueId() == u for k in TRACK_KINDS for i in range(1, (cur.GetTrackCount(k) or 0) + 1) for it in (cur.GetItemListInTrack(k, i) or []))]
        exact = removed == wanted and not d["added"] and not d["changed"] and not d["markers_changed"] and not still
        status = "PASS" if (api_ok and exact) else "FAIL"
        result = write_result(intent, status, requested=[t for t, _, _ in found], actual={"removed": sorted(removed)},
                              verification={"api_returned": api_ok, "removed_exactly_targets": removed == wanted, "still_present": still,
                                            "diff_added": len(d["added"]), "diff_changed": len(d["changed"]), "markers_changed": d["markers_changed"],
                                            "unexpected_removed": sorted(removed - wanted)})
    except BridgeError as e:
        result = write_result(intent, "ABORTED", error=e.to_json()); log_write(out_dir, result); raise
    log_write(out_dir, result)
    return {"status": result["status"], "result": result, "checkpoint": cp, "scope": scope}


def sandbox_timeline(resolve, project, timeline, out_dir):
    """SOMENTE SANDBOX: cria a timeline de teste (BOLD_BRIDGE_TEST*) no projeto BOLD_BRIDGE_SANDBOX* já aberto.
    Recusa qualquer outro projeto/nome. Não troca de projeto, não cria tracks, não toca no Media Pool."""
    p = guards.project_guard(resolve, project)
    if not guards.is_sandbox_project(p.GetName()) or not guards.is_sandbox_timeline(timeline):
        raise BridgeError("SANDBOX_REQUIRED", "sandbox-timeline só existe em projeto BOLD_BRIDGE_SANDBOX* com timeline BOLD_BRIDGE_TEST*", {"timeline": timeline})
    guards.page_guard(resolve)
    if any(t is not None and guards.nfc(t.GetName()) == guards.nfc(timeline) for t in guards.timelines(p)):
        raise BridgeError("TIMELINE_EXISTS", f"timeline {timeline!r} já existe (nunca reaproveito/sobrescrevo)", {"timeline": timeline})
    intent = write_intent(p.GetName(), timeline, "sandbox_timeline", timeline); log_write(out_dir, intent)
    tl = p.GetMediaPool().CreateEmptyTimeline(timeline) if hasattr(p.GetMediaPool(), "CreateEmptyTimeline") else None
    found = guards.find_timeline(p, timeline) if tl is not None else None
    ok = found is not None and (found.GetItemListInTrack("video", 1) or []) == []
    result = write_result(intent, "PASS" if ok else "FAIL", requested={"timeline": timeline}, actual={"timeline": found.GetName() if found else None, "video_tracks": found.GetTrackCount("video") if found else None},
                          verification={"api_returned": tl is not None, "found_by_name": found is not None, "empty": ok})
    log_write(out_dir, result)
    return {"status": result["status"], "result": result}


def not_available(op):
    raise BridgeError("NOT_AVAILABLE_V1", f"{op}: não disponível na Bridge V1 (replace/ripple/move/render/export)", {"operation": op})
