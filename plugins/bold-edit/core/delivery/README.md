# core/delivery — STATUS: STABLE (R4)

| Arquivo | Papel |
|---|---|
| `profiles.json` / `profiles.mjs` | perfis versionados `ALPHA_4444_BT709`, `OPAQUE_4444_BT709`, `OPAQUE_HQ_BT709` + filtro de cor e args de codec |
| `validate.mjs` | **validador central** (probe, qc e delivery usam o mesmo) |
| `ffprobe.mjs` | metadados normalizados + contagem REAL de frames |
| `encode.mjs` | sequência → gate → ffmpeg → validação → manifest |
| `blur.mjs` | motion blur por sub-frames (premultiply → tmix → unpremultiply) |
| `fixcolor.mjs` | correção de matriz/tags de legado (arquivo novo; ambíguo → PARE) |
| `manifest.mjs` | delivery manifest (paths relativos ao PROJECT_ROOT) |
| `authorize.mjs` | ponte para o policy gate (toda geração de vídeo passa aqui; sem bypass) |
| `sequence.mjs`, `tools.mjs` | sequências de imagens; resolução de ffmpeg/ffprobe pela config |

Ver `references/color-pipeline.md` §8 e `references/motion-blur.md` §7.
