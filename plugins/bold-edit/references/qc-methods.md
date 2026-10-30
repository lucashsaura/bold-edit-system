# QC methods

**Status: VIGENTE (método) · Nível 2 IMPLEMENTADO (R4):** `bold probe`, `bold qc file`, `bold qc alpha` · **Nível 1 (stills) IMPLEMENTADO (R5):** `bold qc stills`. Os níveis 3 e 4 continuam humanos ou sandbox.

## Hierarquia

| Nível | O que verifica | Exige render? | Autorização |
|---|---|---|---|
| **0 — STATIC** | schemas (`motion.spec`, `tokens`, `bold.project`), paths, fontes exigidas, metadados de origem (ffprobe da **fonte**), leak scan | não | — |
| **1 — STILLS** | frames-chave, primeiro e último frame, contact sheet, title-safe, texto (grafia literal), composição sobre o footage real | não (stills) | permitido |
| **2 — FILE** | ffprobe do **arquivo renderizado**: frame count real, fps, `pix_fmt`, tags de cor, alpha (bateria `alpha-pipeline.md` §3), determinismo (framemd5) | só lê um arquivo **já** autorizado e renderizado | — |
| **3 — VISUAL** | composição, bordas, continuidade de movimento, tipografia, cortes e croppings, flicker, strobe | revisão de vídeo exige render | **explícita** para gerar o vídeo |
| **4 — INTEGRATION** | posição na timeline (name + TL in/out + File Path), timing com a fala, Alpha Mode, cor medida no Resolve, diff PRE/POST | não (stills e API) | write exige o protocolo de `davinci-safety.md` |

**RULE:** suba de nível em ordem. Não renderize (nível 2/3) antes de passar nos níveis 0 e 1. Não integre (nível 4) antes de passar no nível 2.

## Nível 0 — STATIC
- Valide os schemas.
- Confira se as fontes de `fonts_required` existem em `FONTS_DIR`. **Sem fallback silencioso**: o build deve esperar o carregamento da fonte.
- Duração em frames = intervalo editorial exato.
- O fps vem do projeto.
- **FAIL:** schema inválido, fonte ausente, duração divergente.

## Nível 1 — STILLS
- **Frames-chave:** primeiro, entrada concluída, hold, saída iniciada, último.
- **Contact sheet:** grade de N frames igualmente espaçados para ler o ritmo.
- **Title-safe:** conte os pixels visíveis (α > 0, sombra incluída) fora da área segura. **PASS = 0**.
- **Texto:** grafia **literal** do texto aprovado. Não corrija gramática por conta própria; aponte e pergunte.
- **Sobre o footage real:** stills do Resolve no intervalo exato. Meça a cobertura do assunto e o contraste do texto sobre o fundo (pior caso).
- **FAIL:** texto divergente, pixel fora da safe area, assunto principal coberto sem intenção, contraste insuficiente.

## Nível 2 — FILE
- `ffprobe -count_frames`: real = esperado.
- fps exato.
- `pix_fmt` do perfil.
- Tags `bt709/bt709/bt709/tv`.
- Bateria de alpha (`alpha-pipeline.md` §3).
- **Determinismo:** dois renders completos → `framemd5` idêntico (ver `remotion-determinism.md`).
- Sem frame preto ou vazio inesperado. Meça o YAVG mínimo nos opacos.
- **FAIL:** qualquer divergência de contagem, tag, `pix_fmt` ou alpha.

## Nível 3 — VISUAL
- Bordas limpas sobre fundo claro e escuro.
- Movimento contínuo, sem saltos, strobe ou flicker.
- Kerning preservado em splits por letra.
- Nenhum corte acidental de glifo ou sombra.
- Comparação A/B com o preview aprovado. PSNR por trecho é útil para provar "igual exceto o blur".
- **FAIL:** halo, strobe, flicker, glifo cortado, divergência não explicada do aprovado.

## Nível 4 — INTEGRATION
- **Readback por item:** name, TL in, TL out, File Path, offsets, enable e Alpha Mode.
- **Cor:** still do Resolve com token medido (`color-pipeline.md` §5).
- **Alpha:** composição prevista × Resolve (`alpha-pipeline.md` §4).
- **Timeline:** snapshot PRE/POST e diff exatamente igual ao planejado.
- **FAIL:** qualquer item fora, diff extra, cor ou alpha divergente.

## Armadilhas de QC conhecidas
- **Still do Resolve atrasado** depois de trocar de timeline: faça warm-up e dupla exportação (`davinci-safety.md` A7).
- **Média de croma de 1 px** em linhas finas no caminho de still: confirme com decodificação via ffmpeg antes de culpar o arquivo.
- **Cabeçalho mente:** o `nb_frames` do header pode divergir da contagem real. Use `-count_frames`.
- **"Parece igual" não é QC:** meça (pixels, contagens, hashes).

## Implementação real (R4)

| Comando | Nível | Conteúdo |
|---|---|---|
| `bold probe <arquivo> [--profile ID] [--expected-frames N] [--fps F] [--count-frames] [--json]` | 2 | container, codec, profile, codec tag, pix_fmt, W×H, fps (`r_frame_rate`), duração, nb_frames (header e contados), 4 tags de cor, alpha, streams de áudio e outros. Com `--profile`, valida (PASS/WARNING/FAIL) |
| `bold qc file <arquivo> …` | 2 | Tudo do probe + **contagem real sempre** (`ffprobe -count_frames`) + streams inesperados |
| `bold qc alpha <arquivo> …` | 2 | `qc file` + análise de alpha e bordas (`alpha-pipeline.md` §6) |

**Regras que estão no código (`core/delivery/validate.mjs`)**
- O número de frames vem **sempre da contagem real**. `duration × fps` nunca é usado. Se EXPECTED_FRAMES ≠ ACTUAL_FRAMES → FAIL. Um cabeçalho diferente da contagem real gera WARNING.
- O fps é comparado exatamente (tolerância 1e-6) contra `r_frame_rate`.
- Com perfil, tags de cor ausentes ou divergentes → **FAIL**. Sem perfil → WARNING (informativo).
- Áudio ou streams extras num perfil de entrega → WARNING.
- A saída do QC separa `machine_qc` (status + checks) de `visual_qc` (sempre `PENDING`).

## Stills para VISUAL QC (R5): `bold qc stills <arquivo> [--output dir] [--no-contact-sheet] [--json]`

- **Saída:** os frames **first, 25%, 50%, 75% e last** (índices pela contagem real), em PNG RGBA quando há alpha.
- **Contact sheet:** `contact_sheet.png`. Overlays com alpha são compostos sobre xadrez, para revelar halo e franja.
- **Registro:** `stills.json` com os índices.
- **Regras de uso:**
  - Não exige autorização de render (`STILLS_PREVIEW`).
  - Nunca sobrescreve um diretório existente não vazio.
  - **Não faz julgamento estético automático:** a saída existe para revisão humana.
- **No `bold render`:** os stills são gerados automaticamente ao lado do master (`--no-stills` desliga).
