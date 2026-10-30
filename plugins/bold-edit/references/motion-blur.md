# Motion blur por sub-frames

**Status: IMPLEMENTADO (R4)** em `bold delivery blur` (`core/delivery/blur.mjs`). Genérico, sem dependência do Remotion. Gerar o vídeo exige autorização (gate).

## 1. Conceito

Renderize **SUB amostras por frame de saída**, com a composição registrada a `fps × SUB` e duração `N × SUB`. Depois tire a **média** das SUB amostras de cada frame com alpha **premultiplicado** e codifique em `fps`.

```
t(n) = floor(n / SUB) + ((n mod SUB) − (SUB − 1)/2) / (SUB · k)
```
- As amostras ficam centradas no frame.
- `k` controla a abertura. Com `k = 1,5`, a janela vai de ≈ 0,58 frame (SUB = 8) a ≈ 0,63 frame (SUB = 16), um obturador de ~180–225°.
- Registre o valor escolhido no spec.

## 2. CAMERA SHUTTER × ACTION SHUTTER

| | RULE | RATIONALE |
|---|---|---|
| Action shutter | os elementos usam a janela inteira | dá a sensação de velocidade |
| Camera shutter | a câmera virtual usa uma fração menor (ex.: 40%) | o blur vem da **ação**, não do movimento de câmera; evita o quadro inteiro "lavado" |
| Footage | congelado no frame de saída durante as amostras (`remotion-determinism.md` D9) | o vídeo já tem o blur da câmera real |

## 3. Escolha de SUB

| SUB | Uso | Risco |
|---|---|---|
| 4–8 | movimento moderado, 3D | **strobe** (cópias discretas) em elementos rápidos |
| 16 | elementos rápidos 2D, bordas nítidas | custo e disco altos: use chunks |
| 16 + anti-strobe | elementos muito rápidos | aplique um blur leve **por amostra** e **só quando `SUB > 1`**, com raio ≈ `0,5 × velocidade_da_borda × 2/(3·SUB)`. **Nunca** em elementos 3D (D7) |

## 4. Pipeline (ffmpeg)
```
# 1) média premultiplicada de SUB amostras consecutivas (16 bit)
ffmpeg -framerate <FPS*SUB> -start_number 0 -i sub_%06d.png \
  -vf "format=rgba64le,premultiply=inplace=1,tmix=frames=<SUB>:weights='1 1 … 1',unpremultiply=inplace=1,format=rgba64be" \
  -fps_mode passthrough -start_number 0 avg_%05d.png
# 2) seleção por NOME: frame F = avg[F*SUB + SUB-1]  (média completa das SUB amostras de F)
# 3) encode BT.709 (color-pipeline.md §3) a <FPS>
```

**Validação**
- Amostras renderizadas = `N × SUB`.
- Médias = `N × SUB`.
- Selecionados = `N`.
- Master: `ffprobe -count_frames` = N.
- Tags BT.709.
- Bateria de alpha, quando houver alpha.

**FAIL CONDITION**
- Qualquer contagem divergente.
- Strobe visível em revisão (QC nível 3).
- Halo nas bordas: indica média sem premultiply.
- Seleção feita por decimação do ffmpeg em vez de por nome.

## 5. Chunks (disco)
Para SUB alto, processe em blocos de ~20 frames de saída:
1. Renderize o chunk.
2. Faça a média e a seleção para PNG 16 bits por frame.
3. Apague o chunk pelo caminho literal.

No fim, faça o encode a partir dos PNGs selecionados. Confira o espaço livre antes de começar (`bold doctor`).

## 6. Alternativa analítica (animatics e previews)
Para animatics, um blur direcional proporcional ao deslocamento por frame (`feGaussianBlur stdDeviation="bx by"`) é barato e suficiente. **Não** use em masters 3D (D7).

## 7. Implementação real (R4)

```
bold delivery blur --input dir/s_%06d.png --fps <F> --subframes <SUB> --shutter <0..1> \
                   --expected-frames <N> --profile ALPHA_4444_BT709 --output out.mov [--start-number S] [--keep-temp]
```

1. **Entrada:** confere que existem exatamente `N × SUB` sub-frames contíguos. Senão, recusa antes do gate.
2. **Pesos do obturador:** `shutterWeights(SUB, shutter)` devolve as k amostras **centrais**, com k ≈ shutter × SUB e a mesma paridade de SUB. Como os pesos são simétricos, a ordem dos pesos no `tmix` não importa. O `shutter_effective = k/SUB` vai para o manifest.
3. **Média:** `format=rgba64le,premultiply=inplace=1,tmix=frames=SUB:weights='…',unpremultiply=inplace=1,format=rgba64be` com `-fps_mode passthrough`. A contagem de médias precisa ser `N × SUB`.
4. **Seleção por nome:** o frame F recebe a amostra `F·SUB + SUB − 1`, ligada por hardlink (ou cópia) como `sel_%06d.png`. Nunca por decimação.
5. **Encode** BT.709 no perfil, com validação (N frames, fps, tags) e manifest (`kind: motion_blur`, `subframes`, `shutter_*`, `weights`, `method`).
6. **Limpeza:** o diretório temporário de trabalho (`CACHE_DIR/tmp/bold-blur-*`) é removido no fim, salvo `--keep-temp`.

**Testes (fixtures sintéticos)**
- 24, 25 e 30 fps: N frames corretos, alpha parcial gerado, bordas `CLEAN_STRAIGHT_EDGES`.
- Regressão: a mesma média **sem premultiply** sobre fundo α=0 com RGB "lixo" gera `GROSS_HALO` (FAIL).

O **camera shutter × action shutter** (§2) é decisão da **fonte** (o que cada sub-frame contém). O pipeline só faz a média das amostras recebidas.
