"""WriteIntent → WriteResult: rastreia o que foi PEDIDO e o que de fato ACONTECEU (status PASS | FAIL | ABORTED)."""
import json
import os
import time
import uuid


def write_intent(project, timeline, operation, target, expected_track=None, expected_time=None, checkpoint=None):
    return {"schema": "bold.davinci.write_intent/1", "id": uuid.uuid4().hex, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "project": project, "timeline": timeline, "operation": operation, "target": target,
            "expected_track": expected_track, "expected_time": expected_time, "checkpoint": checkpoint}


def write_result(intent, status, requested=None, actual=None, verification=None, error=None):
    assert status in ("PASS", "FAIL", "ABORTED")
    return {"schema": "bold.davinci.write_result/1", "intent_id": intent["id"], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "operation": intent["operation"], "requested": requested, "actual": actual, "verification": verification, "status": status, "error": error}


def log_write(log_dir, record):
    """Append-only JSONL (intents e results) no diretório de checkpoints do job."""
    if not log_dir:
        return None
    os.makedirs(log_dir, exist_ok=True)
    path = os.path.join(log_dir, "davinci-writes.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path
