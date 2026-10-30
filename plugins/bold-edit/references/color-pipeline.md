# Color pipeline

**Status: VIGENTE · IMPLEMENTADO (R4)** em `core/delivery/` (`bold delivery`, `bold probe`). O §8 descreve o código real.

## 1. Regra-mestra

**RULE:** todo arquivo de motion entregue ao Resolve sai de **RGB (sequência PNG)**, é convertido **explicitamente** para YCbCr BT.709 e leva as tags explícitas abaixo. A validação por ffprobe é obrigatória:

```
color_primaries = bt709
color_transfer  = bt709
color_space     = bt709
color_range     = tv
```

Nunca confie apenas em `.mov`, em "ProRes" ou no profile do codec. O container pode estar perfeito e a matriz errada.

## 2. A regressão BT.601 → Rec.709

| | |
|---|---|
| **Causa** | Algumas ferramentas convertem RGB → YCbCr com a matriz **BT.601** e gravam o arquivo **sem** tag de matriz (`color_space=unknown`), às vezes com `color_transfer=iec61966-2-1` (sRGB). Observado em Remotion 4.0.290 (ProRes nativo e H.264) e em HyperFrames 0.8.114 `--format mov` (o ramo ProRes do encoder não aplica matriz nem tags) |
| **Por que parece correto** | Extensão `.mov`, codec ProRes 4444, `pix_fmt` certo, resolução e fps certos. Nada no container denuncia a matriz |
| **Impacto** | O Resolve lê HD sem tag como Rec.709. Cores saturadas **deslocam**: verdes escurecem e perdem saturação, vermelhos mudam de matiz. Cores de marca saem erradas por 10–20 níveis, um erro visível em logos e tokens. Tons neutros quase não mudam, por isso o problema escapa em revisão casual |
| **Diagnóstico** | 1. `ffprobe`: a matriz está `unknown` ou ausente → **suspeito**. 2. Decodifique um frame com as duas matrizes (601 e 709) e compare com a cor-fonte conhecida (token): a que bater é a matriz real dos pixels. 3. Compare com um still do Resolve no mesmo frame: se o Resolve mostra a cor deslocada, o problema está confirmado |
| **Prevenção** | Nunca usar o encoder de vídeo da ferramenta para material que vai ao Resolve. Use o pipeline do §3 |
| **Correção sem re-render** | Decodifique **explicitamente como BT.601** → RGB 16 bits → codifique **explicitamente como BT.709** com as tags (§4). O alpha é preservado (Δ 0). Frames e fps idênticos. Os originais ficam preservados |
| **Validação** | ffprobe com as tags do §1 + cor medida em still do Resolve igual ao token (§5) |

## 3. Pipeline recomendado

```
RGB / PNG SEQUENCE (straight alpha, 8 ou 16 bit)
  → FFMPEG
  → explicit BT.709 matrix (scale out_color_matrix=bt709, in_range=full → out_range=tv)
  → explicit BT.709 tags (-color_primaries/-color_trc/-colorspace bt709, -color_range tv, +write_colr)
  → ffprobe validation
  → Resolve verification (stills)
```

### Perfil `alpha-4444-bt709` (motion com alpha)
```
ffmpeg -framerate <FPS> -start_number <N0> -i frame_%06d.png -frames:v <N> \
  -vf "scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+bitexact,
       format=yuva444p12le,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709" \
  -c:v prores_ks -profile:v 4444 -vendor apl0 -alpha_bits 16 -pix_fmt yuva444p12le \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -movflags +write_colr -r <FPS> out.mov
```

### Perfil `opaque-4444-bt709` (master opaco de alta qualidade)
É o mesmo comando com `format=yuv444p12le`, `-pix_fmt yuv444p12le` e sem `-alpha_bits`.

### Perfil `opaque-hq-bt709` (opaco, menor)
`-c:v prores_ks -profile:v 3 -vendor apl0 -pix_fmt yuv422p10le`, com o mesmo `scale`/`setparams` (usando `format=yuv422p10le`) e as mesmas tags.

**Notas**
- Use uma **lista explícita** de frames ou `-start_number`, mais `-frames:v`, para não perder nem duplicar frames.
- Confira o número de PNGs **antes** do encode.
- O fps vem do projeto. **Nunca** fixe 24 no script.
- Se a ferramenta anexar uma trilha de áudio silenciosa, remova com `-an` (ou `-c copy -an` sem recodificar).

## 4. Correção de legado (BT.601 sem tag → BT.709)
```
F="accurate_rnd+full_chroma_int+bitexact"
# alpha
-vf "scale=in_color_matrix=bt601:in_range=tv:flags=$F,format=gbrap16le,
     scale=out_color_matrix=bt709:out_range=tv:flags=$F,format=yuva444p12le,
     setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709"
-c:v prores_ks -profile:v 4444 -vendor apl0 -alpha_bits 16 -pix_fmt yuva444p12le
# opaco: gbrp16le → yuv422p10le, -profile:v 3 (ProRes 422 HQ). Não recodifique para H.264
# ambos:
-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +write_colr
```
- **Troca no Resolve:** `MediaPoolItem.ReplaceClip(novo)` com readback completo (`davinci-api-recipes.md` §REPLACE).
- Guarde a tabela de rollback.
- **Nunca** sobrescreva o original.

## 5. Verificação no Resolve

1. Os clips importados devem aparecer com *Input Color Space* lido das tags (Rec.709). Se aparecem como "Project", o arquivo está sem tags.
2. Exporte um still, sem grade no motion (`davinci-api-recipes.md` §STILL EXPORT), num frame onde o token de cor está sólido.
3. Meça o pixel e compare com o token.
   - **PASS:** igual, com Δ ≤ 1–2 níveis por canal.
   - **Atenção:** linhas de 1 px podem mostrar média de croma no caminho de still (`davinci-safety.md` V3). Confirme decodificando o arquivo.
4. **FAIL:** deslocamento coerente com 601↔709 → PARE e corrija o arquivo, não a timeline.

## 6. Cor no Resolve (footage)

- **Classifique** cada clip por **metadados** (curva de gamma da câmera, modelo, tags do arquivo), nunca pela aparência.
- **Aplique** looks aprovados via DRX exportado de um still da Gallery (`davinci-api-recipes.md` §DRX APPLY). Não crie looks novos sem pedido.
- **Balance** por plano só no nó designado para isso (`SetCDL`).
- **Nunca** aplique grade em motion, gráfico ou alpha. Nada de LUT, CST ou grade automática sem pedido.
- **Perfis sem transform compatível** ficam sem grade e são reportados, sem improviso.

## 7. Fail conditions (resumo)

- Uma das tags faltando ou diferente → **FAIL** (o arquivo não vai para a timeline).
- Uma cor medida no Resolve divergente do token, sem explicação de 1 px → **FAIL**.
- Encode direto pela ferramenta (Remotion `--codec prores`/h264, HyperFrames `--format mov`) para material destinado ao Resolve → **FAIL de processo**.

## 8. Implementação real (R4)

| Peça | Arquivo | O que faz |
|---|---|---|
| Perfis versionados | `core/delivery/profiles.json` | `ALPHA_4444_BT709` v1, `OPAQUE_4444_BT709` v1, `OPAQUE_HQ_BT709` v1. Também aceita alias em minúsculas com hífen |
| Filtro de cor | `core/delivery/profiles.mjs` → `colorFilter()` | RGB full → `out_color_matrix=bt709`, `out_range=tv`, `setparams` com as 4 tags. Para legado: decode explícito (`in_color_matrix`/`in_range`) → RGB 16 bit → BT.709 |
| Args de codec | `codecArgs()` | `prores_ks` + perfil + `-vendor apl0` (+ `-alpha_bits 16`) + tags + `+write_colr` + `-fflags/-flags:v +bitexact -map_metadata -1 -an -sn -dn` (saída determinística, sem streams extras) |
| Validador central | `core/delivery/validate.mjs` → `validateMedia()` | Único lugar das regras. Usado por probe, qc e delivery |
| Encode | `bold delivery encode` → `encodeSequence()` | Confere a sequência de entrada (contagem contígua = esperado) → **gate** → ffmpeg → probe + contagem real → validação → manifest |
| Correção de legado | `bold delivery fix-color <entrada> <saída>` → `fixColor()` | Arquivo **novo**. Nunca sobrescreve. Origem ambígua → **PARE** (exit 3) |

**Evidência da matriz de origem no fix-color** (sem evidência não converte):
1. A tag no arquivo: `bt470bg`/`smpte170m` → BT.601. `bt709` → BT.709, faltando só tags.
2. Um **pixel de referência**: `--evidence-pixel x,y,#RRGGBB[,frame]`.
   - O arquivo é decodificado em 601 e em 709.
   - A matriz vencedora precisa ficar a ≤ 6 de distância da cor conhecida **e** ter margem ≥ 6 sobre a outra.
3. Uma declaração explícita: `--source-matrix bt601|bt709 --evidence "<texto>"`. Fica registrada como suposição no manifest.

Evidências conflitantes → PARE. Uma entrada que já está em BT.709 explícito → `NOTHING_TO_DO`, sem gerar arquivo.

**Fatos observados no ffmpeg 8.1.1 (que entraram no código e nos testes)**
- **Tag automática do ffmpeg:** com `out_color_matrix=bt601`, o ffmpeg passa a marcar `color_space=bt470bg`. Isso conta como evidência válida.
- **Reproduzir o legado sem tag:** para gerar o caso "sem tag" é preciso `setparams=...=unknown`.
- **`prores_ks` grava `color_range=tv` sempre:** um ProRes não carrega `pc`. Por isso o teste de range errado usa H.264 full range.
- **Range ausente:** num ProRes YUV com range ausente, o fix-color assume `tv`, porque é o que a especificação do codec define. A suposição fica registrada.

**Exit codes:** `0` PASS/WARNING · `1` FAIL · `3` PARE (ambíguo) · `4` bloqueado pelo gate · `64` uso incorreto.
