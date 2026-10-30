"""CLI Python da Bridge (chamado pelo `bold davinci …`): `python3 -m davinci.bridge.cli <op> '<json args>'`.
Saída: UMA linha JSON {ok, result} | {ok:false, error:{code,message,details}}. Exit 0 ok · 2 BridgeError · 1 erro inesperado."""
import json
import sys

from davinci.api.connect import connect, BridgeError
from davinci.bridge import ops

READ = {"status": ops.status, "projects": ops.projects, "timelines": ops.list_timelines, "inspect": ops.inspect, "media": ops.media_inspect, "verify": ops.verify}
WRITE = {"checkpoint": ops.checkpoint, "import": ops.import_media, "insert": ops.insert, "delete": ops.delete, "sandbox_timeline": ops.sandbox_timeline}


def main(argv):
    op = argv[1] if len(argv) > 1 else None
    args = json.loads(argv[2]) if len(argv) > 2 else {}
    try:
        if op in ops.NOT_AVAILABLE_V1:
            ops.not_available(op)
        fn = READ.get(op) or WRITE.get(op)
        if fn is None:
            raise BridgeError("UNKNOWN_OP", f"operação desconhecida: {op!r}")
        resolve = connect()
        out = fn(resolve, **args)
        print(json.dumps({"ok": True, "op": op, "result": out}, ensure_ascii=False))
        return 0
    except BridgeError as e:
        print(json.dumps({"ok": False, "op": op, "error": e.to_json()}, ensure_ascii=False))
        return 2
    except TypeError as e:
        print(json.dumps({"ok": False, "op": op, "error": {"code": "BAD_ARGS", "message": str(e), "details": None}}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
