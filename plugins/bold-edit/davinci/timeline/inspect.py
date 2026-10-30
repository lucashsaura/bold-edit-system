"""INSPECT (somente leitura): timeline → JSON estável (schema bold.davinci.timeline/1). Nunca troca a timeline
corrente: estado de track só é marcado como confiável na timeline CORRENTE (A2)."""
from davinci.timeline.timecode import parse_fps, frames_to_tc, TimecodeError

TRACK_TYPES = ("video", "audio", "subtitle")


def _setting(obj, key):
    try:
        v = obj.GetSetting(key)
    except Exception:
        return None
    return v if v not in ("", None) else None


def timeline_fps(project, tl):
    raw = _setting(tl, "timelineFrameRate") or _setting(project, "timelineFrameRate")
    df = (_setting(tl, "timelineDropFrameTimecode") or _setting(project, "timelineDropFrameTimecode")) in ("1", 1, True, "true")
    return raw, parse_fps(raw), df


def item_info(item, fps, df):
    mpi = item.GetMediaPoolItem() if hasattr(item, "GetMediaPoolItem") else None
    fp = mpi.GetClipProperty("File Path") if mpi else None
    comps = item.GetFusionCompCount() if hasattr(item, "GetFusionCompCount") else 0
    kind = "media" if fp else ("fusion" if comps else "non_media")  # título/gerador/Fusion: sem File Path
    start, end = item.GetStart(), item.GetEnd()
    enabled = item.GetClipEnabled() if hasattr(item, "GetClipEnabled") else None
    return {"name": item.GetName(), "kind": kind, "unique_id": item.GetUniqueId() if hasattr(item, "GetUniqueId") else None,
            "file_path": fp or None, "media_pool_item": mpi.GetUniqueId() if mpi else None,
            "tl_in": start, "tl_out": end, "duration": item.GetDuration(), "tl_in_tc": frames_to_tc(start, fps, df), "tl_out_tc": frames_to_tc(end, fps, df),
            "left_offset": item.GetLeftOffset() if hasattr(item, "GetLeftOffset") else None, "right_offset": item.GetRightOffset() if hasattr(item, "GetRightOffset") else None,
            "enabled": enabled, "fusion_comps": comps or 0}


def inspect_timeline(project, tl, is_current, items=True):
    raw, fps, df = timeline_fps(project, tl)
    start, end = tl.GetStartFrame(), tl.GetEndFrame()
    out = {"schema": "bold.davinci.timeline/1", "name": tl.GetName(), "unique_id": tl.GetUniqueId() if hasattr(tl, "GetUniqueId") else None,
           "is_current": bool(is_current), "fps": float(raw) if raw is not None else None, "fps_exact": f"{fps.numerator}/{fps.denominator}", "drop_frame": df,
           "resolution": [int(_setting(tl, "timelineResolutionWidth") or _setting(project, "timelineResolutionWidth") or 0), int(_setting(tl, "timelineResolutionHeight") or _setting(project, "timelineResolutionHeight") or 0)],
           "start_frame": start, "end_frame": end, "duration_frames": end - start, "start_tc": tl.GetStartTimecode(),
           "track_state_reliable": bool(is_current), "tracks": {}, "markers": []}
    for kind in TRACK_TYPES:
        tracks = []
        for i in range(1, (tl.GetTrackCount(kind) or 0) + 1):
            t = {"index": i, "name": tl.GetTrackName(kind, i), "enabled": tl.GetIsTrackEnabled(kind, i) if is_current else None}
            if items:
                t["items"] = [item_info(it, fps, df) for it in (tl.GetItemListInTrack(kind, i) or [])]
            tracks.append(t)
        out["tracks"][kind] = tracks
    for frame, m in sorted((tl.GetMarkers() or {}).items()):
        f = int(frame)
        out["markers"].append({"frame": f, "tl_frame": start + f, "tc": frames_to_tc(start + f, fps, df), "color": m.get("color"), "name": m.get("name"), "note": m.get("note"), "duration": m.get("duration")})
    return out


def summary(tl_json):
    v = tl_json["tracks"]["video"]; a = tl_json["tracks"]["audio"]
    return {"name": tl_json["name"], "fps": tl_json["fps"], "drop_frame": tl_json["drop_frame"], "resolution": tl_json["resolution"], "duration_frames": tl_json["duration_frames"],
            "video_tracks": len(v), "audio_tracks": len(a), "video_items": sum(len(t.get("items", [])) for t in v), "audio_items": sum(len(t.get("items", [])) for t in a), "markers": len(tl_json["markers"])}
