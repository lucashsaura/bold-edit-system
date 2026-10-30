# core/qc — STATUS: STABLE (R4, MACHINE QC)

- `qc.mjs`: `qcFile` / `qcAlpha` (MACHINE QC; `visual_qc` sempre PENDING).
- `alpha.mjs`: estatísticas de alpha + heurística de borda/halo/premultiplicado.
- `frames.mjs`: decodificação de frames amostrados para RGBA.

PLANNED: contact sheets e title-safe automáticos (stills). O leak scanner fica em `core/leak/`.
