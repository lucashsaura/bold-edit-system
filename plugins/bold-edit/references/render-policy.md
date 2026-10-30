# Render policy

**Status: VIGENTE · CRITICAL.** As invariantes estão em `core/policy/invariants.mjs`, e o gate em `core/policy/gate.mjs`.

## 1. Estados de trabalho

| Estado | Exemplos | Gera vídeo? | Autorização |
|---|---|---|---|
| `EDIT` | ler o projeto, planejar, snapshot JSON, checkpoint `.drp`, escrever na timeline | não | a do pedido (escrita estrutural exige checkpoint, ver `davinci-safety.md`) |
| `MOTION_GENERATION` | escrever código, tokens, `motion.spec.json` | não | a do pedido |
| `STILLS_PREVIEW` | PNG de frames-chave, contact sheet, `ExportCurrentFrameAsStill`, snapshots de lint/check | não | **permitido** |
| `VIDEO_PREVIEW` | MP4/MOV de revisão, animatic, side-by-side, preview com alpha | **sim** | **explícita** |
| `RENDER` | master, sequência PNG de vídeo, encode ffmpeg de vídeo, render Remotion ou HyperFrames | **sim** | **explícita** |
| `FINAL_EXPORT` | Deliver, Render Queue, Render Settings, export de timeline | **sim** | **explícita** |

**RULE**
- Nenhum arquivo de vídeo pode ser gerado sem autorização explícita.
- Isso vale para qualquer formato e qualquer ferramenta (Resolve, Remotion, HyperFrames, ffmpeg) e para qualquer finalidade, inclusive "só para QC".
- Sem autorização, também não pode haver nenhum job adicionado à Render Queue nem nenhuma alteração em Render Settings.

**RATIONALE**
- Render custa disco e tempo e gera arquivos que o usuário não pediu.
- No Resolve, `StartRendering` muda a página para Deliver sozinho (ver `lessons-learned.md` L-07).
- O usuário revisa dentro do Resolve, e um vídeo não pedido é ruído.

**FAIL CONDITION**
- Qualquer `.mp4`, `.mov` ou sequência de vídeo criada sem autorização registrada.
- Job na fila ou Render Settings alterados sem autorização.

## 2. Linguagem: o que autoriza e o que não autoriza (camada agente)

| Mensagem do usuário | Leitura |
|---|---|
| "finalize", "integre", "aplique", "feche", "deixe pronto", "faça QC", "siga", "pode seguir", "ok", "aprovado" | **NÃO** autorizam render nem export |
| "renderize", "pode renderizar" | **candidato** a autorização de RENDER |
| "exporte", "pode exportar" | **candidato** a autorização de EXPORT |
| "não renderize", "sem renderizar", "nunca exportar" | nega |

Um candidato só vira autorização quando o contexto confirma três coisas:
1. **O quê:** qual peça.
2. **Qual saída:** preview, master ou export.
3. **Ausência de negação ou condição pendente:** por exemplo, "renderize *depois* que eu aprovar".

Na dúvida, **pergunte**. Existe material de apoio testado em `core/policy/authorization-language.mjs`, que avalia a frase mas **nunca** concede autorização.

- "Exportar" um `.drp` ou um JSON **não** é export de vídeo. É `EDIT`.
- Uma autorização vale para o pedido em que foi dada. Ela **não** se estende a peças, versões ou rodadas seguintes.

## 3. Separação de responsabilidades

```
AGENT DECIDES AUTHORIZATION   →   CLI ENFORCES STRUCTURED GATE   →   LOG
(lê a conversa, confirma)         (exige objeto estruturado)         (.bold/logs/authorizations.jsonl)
```

- **O agente** decide se houve autorização explícita.
- **O CLI** nunca interpreta linguagem natural. Para ações protegidas (`render`, `preview-video`, `encode`, `export`, `deliver`) ele exige:
  ```json
  { "action": "render", "source": "agent_attested_user_message",
    "text": "<mensagem literal do usuário>", "granted_at": "<ISO-8601>", "project": "<project_id>" }
  ```
  - `source` aceita dois valores:
    - `interactive_confirmation`: o humano responde s/N num terminal;
    - `agent_attested_user_message`: o texto é obrigatório.
  - A autorização vale **60 min**, para **uma ação**, num **projeto**.
- **Sempre negadas, mesmo com autorização:** `open-page`, `delete-user-media`, `enable-telemetry`.
- **O log** registra, para cada decisão: `action`, `timestamp`, `project`, `authorization_source`, `authorization_text`, `command`, `allowed`, `reason`.
- **Na R2** os comandos `bold render` e `bold export` ainda são PLANNED. O gate existe e está testado.

## 3.1 HUMAN AUTHORIZATION ≠ TEST EXECUTION OPT-IN (R6.2)

São **dois gates diferentes**. Nenhum substitui o outro.

| Gate | Quem decide | Onde | Efeito |
|---|---|---|---|
| **Autorização humana** | o **agente**, a partir de uma mensagem explícita do usuário na conversa (o quê, quanto, escopo) | objeto estruturado no policy gate (`core/policy`), exigido pelo CLI antes de qualquer processo | permite UMA ação no escopo autorizado |
| **Opt-in de execução de teste** | o agente, **só depois** de constatar a autorização humana | variável `BOLD_TEST_RENDER_AUTH=1` (`tests/helpers/render-opt-in.mjs`) | permite que **testes automatizados** gerem mídia temporal (sequência, encode, vídeo) |

**Regras:**
- **Sem `BOLD_TEST_RENDER_AUTH=1`, nenhum teste gera mídia**, mesmo com Remotion, HyperFrames ou ffmpeg disponíveis e com `BOLD_REMOTION_PROJECT_DIR` definido. A suíte padrão é segura.
- Os helpers que geram mídia (fixtures sintéticos, render Remotion de teste, pipeline de evidência) **recusam** rodar sem o opt-in. Um teste esquecido sem skip falha alto; ele não renderiza.
- O opt-in **não** concede autorização, não é lido pelo CLI e não afrouxa `core/policy`. O CLI continua exigindo o objeto de autorização estruturado.
- O teste end-to-end do HyperFrames exige, além do opt-in, `BOLD_R62_AUTHORIZATION_FILE`: o objeto de autorização que o agente só grava depois de constatar a autorização humana.
- **Regressão** (`tests/unit/media-opt-in.test.mjs`): com `BOLD_REMOTION_PROJECT_DIR` presente e o opt-in ausente, há ZERO chamadas de ffmpeg que gerem mídia (ffmpeg sentinela no PATH), ZERO arquivos de mídia e ZERO jobs de render.

## 4. Quando a verificação "precisaria" de render

1. Tente verificar sem render:
   - stills (`STILLS_PREVIEW`);
   - ffprobe de arquivo **já existente**;
   - leitura da API;
   - medição de pixels em stills;
   - lint/check da ferramenta.
2. Se ainda assim for necessário, **PARE** e informe:
   - o que precisa ser verificado;
   - por que o Resolve, a API ou os stills não bastam;
   - qual render seria necessário: formato, duração e destino.
3. Aguarde autorização explícita.

## 5. Riscos e fallback

| Risco | Prevenção | Fallback |
|---|---|---|
| Render implícito por palavra de fluxo | §2. O CLI não tem modo silencioso | Se um arquivo não autorizado foi gerado: não apague por conta própria, informe e pergunte |
| Resolve fica na página Deliver depois de um render autorizado | Faça todos os writes de timeline **antes** do render | Peça ao usuário que volte para a página Edit (`OpenPage` é proibido) |
| Render "de teste" vira entregável | Nomeie e guarde previews fora das pastas de entrega | — |
| Disco cheio por sequências PNG | O doctor alerta abaixo de 50 GiB | Renderize em chunks (`motion-blur.md`) e apague temporários pelo caminho literal depois da validação |
