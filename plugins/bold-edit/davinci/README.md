# DAVINCI BRIDGE — STATUS: V1 (R7)

Camada segura entre o agente e o DaVinci Resolve (Python, Scripting API). Documentação: `references/davinci-bridge.md`.

- `api/connect.py` · `safety/guards.py` · `safety/intents.py` · `media/media.py` · `timeline/{inspect,timecode}.py` · `checkpoint/checkpoint.py` · `bridge/{ops,cli}.py`
- Leitura: status, projects, timelines, inspect, media, verify. Escrita: checkpoint, import, insert (+ sandbox_timeline só no sandbox).
- `delete/replace/ripple/move/render/export` = `NOT_AVAILABLE_V1`. Nunca `OpenPage`, nunca troca de projeto.
- Testes: `python3 -m unittest davinci.tests.test_bridge` (Resolve fake; rodado também por `tests/davinci/bridge.test.mjs`).
- Regras: `references/davinci-safety.md`.
