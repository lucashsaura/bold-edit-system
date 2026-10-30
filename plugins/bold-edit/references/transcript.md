# Transcript

**Status: CONHECIMENTO VALIDADO (pipeline STT).** A ferramenta que normaliza, analisa e busca transcrições é o **Transcript Engine V1** (`transcript-engine.md`, R8), que lê a saída `-ojf` deste pipeline. A V1 **não executa** o STT. O modelo Whisper é USER_PROVIDED (`tools.WHISPER_MODEL`) e nunca é empacotado nem baixado sem autorização.

## Pipeline

```
media → 16 kHz mono WAV → whisper.cpp → JSON (full) → segments → confidence → markdown
```

| Etapa | RULE | Comando / formato |
|---|---|---|
| Áudio | Extraia **16 kHz, mono, PCM** sem alterar a mídia de origem. Grave no `PROJECT_ROOT`, nunca ao lado da fonte | `ffmpeg -i <fonte> -vn -ac 1 -ar 16000 -c:a pcm_s16le <proj>/transcript/audio/<id>.wav` |
| ASR | whisper.cpp (`whisper-cli`) com **beam 5**, best-of 5, idioma explícito, **prompt de domínio** e saída JSON completa | `whisper-cli -m <MODEL> -l <lang> -t <threads> -bs 5 -bo 5 --prompt "<domínio>" -ojf -osrt -otxt -np -of <raw>/<id> <wav>` |
| Idempotência | Pule arquivos cujo JSON já existe e não está vazio | — |
| Segmentos | Um registro por segmento (formato abaixo) | `segments.json` |
| Confiança | Média de `p` dos tokens, ignorando tokens especiais (`[_…`) e vazios | `confidence ∈ [0,1]` |
| Revisão | Markdown por falante com timecode. Marque segmentos com **confiança < 0,6** | `md/transcript_<speaker>.md` |

## Formato de segmento
```json
{ "id": "<arquivo>_<nnn>", "speaker": "<SPEAKER>", "source_file": "<nome do arquivo de mídia>",
  "start": 12.34, "end": 15.80, "tc_in": "00:00:12.340", "tc_out": "00:00:15.800",
  "duration": 3.46, "text": "...", "confidence": 0.87 }
```

## Configuração por projeto (`bold.project.json`)
```json
"transcript": { "language": "pt", "speakers": ["SPEAKER_A", "SPEAKER_B"], "prompt": "<termos do domínio>" }
```
- **Prompt de domínio:** nomes próprios, marcas e jargões do projeto. Ele vive **no projeto**, nunca na Skill.
- **Mapa falante → arquivos:** por pasta ou prefixo, configurado no projeto.

## Regras de uso
- **Timecode da transcrição ≠ timecode da timeline.** Converta pelo offset do clip e respeite a conversão de fps (`davinci-safety.md` A18).
- **Cues de motion** (sincronia com a fala) usam os timestamps da transcrição ou o envelope de áudio, sempre conferidos no áudio real.
- **Texto na tela é o texto aprovado** (roteiro ou lettering), não a transcrição. Divergência entre os dois é decisão humana.
- **Confiança baixa** → revisão humana. Nunca "corrija" o texto por inferência.
- **Multicam:** se o áudio de uma câmera for inutilizável (SNR baixo), use o som da outra câmera com o offset medido por correlação de forma de onda. Tolerância ≤ 1 frame.

## Validação
- Contagem de segmentos e duração total de fala por falante.
- Média, mediana e mínimo da confiança.
- Nº de segmentos abaixo de 0,6.

**FAIL:** modelo ausente, idioma errado, JSON sem tokens (sem confiança calculável).
