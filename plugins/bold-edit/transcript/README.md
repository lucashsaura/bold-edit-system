# TRANSCRIPT — STATUS: V1 (R8)

Transcript Engine V1: entrada (SRT · VTT · JSON whisper.cpp/segments[] · legendas do DaVinci em leitura) → normalizador → `bold.transcript/1`.
- `src/`: `time.mjs` (fps racional, drop-frame), `text.mjs`, `parsers.mjs`, `normalize.mjs`, `analyze.mjs` (candidatos descritivos), `search.mjs` (busca + export textual)
- `schema/`: `bold.transcript.schema.json`, `bold.transcript-annotations.schema.json`
- CLI: `bold transcript …` · Doc: `references/transcript-engine.md` · Testes: `tests/transcript/`
- STT não é executado na V1; modelos são USER_PROVIDED (`tools.WHISPER_MODEL`) e nunca empacotados nem baixados.
