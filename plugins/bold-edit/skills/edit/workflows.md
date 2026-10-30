# Fluxos típicos

`<bold_home>` vem de `bold home --json`. Todo comando aceita `--json`.

## A. Diagnóstico de ambiente
1. `bold doctor`. Para um módulo específico: `--module motion|davinci|transcript|assets|claude|audio`.
2. Reporte PASS/WARNING/FAIL com a instrução que o doctor deu. Não instale nada.

## B. Entender o que existe (somente leitura)
1. **Transcrição:** `bold transcript inspect <arquivo.srt|.vtt|.json>`. Legendas da timeline: `--davinci --timeline T`.
2. **Acervo:** `bold assets scan <pasta>`, depois `bold assets search --orientation vertical | --alpha true | --fps 59.94 …`.
3. **Contexto:** `bold context build --root <pasta> --transcript <arq> [--davinci] --output ctx.json`, depois `bold context query ctx.json <timelines|speech|mentions|candidates|assets|usage|duplicates>`.

## C. Plano editorial (decidir, não executar)
1. `bold editorial plan --context ctx.json [--mode CONSERVATIVE|BALANCED|EXPRESSIVE] [--intent-text "…"] --output plan.json`.
2. `bold editorial inspect plan.json`, depois `bold editorial explain plan.json dNNNN` para cada intervenção relevante.
3. `bold editorial validate plan.json` (FAIL = não aprovável).
4. Apresente o plano ao usuário, com prioridade, motivo, legenda, assets ambíguos e placement em revisão. **Espere aprovação.**

## D. Criar um motion
1. Brief completo (texto aprovado literal, duração em frames, fps, alpha). Ver `<bold_home>/references/motion-system.md`.
2. Ferramenta: `bold motion route plan.json dNNNN` ou `<bold_home>/references/decision-engine.md`.
3. Spec + `bold motion validate|compile|inspect`, sem vídeo.
4. Render/encode **só** com autorização explícita (`render-policy.md`). Depois, `bold qc` e stills para revisão humana.

## E. Integrar no DaVinci
1. Leitura: `bold davinci status`, `timelines`, `inspect`.
2. Write: sandbox, ou projeto real com `davinci-write` autorizado. Sequência `bold davinci integrate --request req.json` (checkpoint → gate → insert → verify).
3. Reporte o readback (`verify`) e o checkpoint. Nunca declare sucesso só pelo retorno da API.

## F. Sound design (parte do fluxo; o usuário não precisa pedir pelas ferramentas)
Sempre que houver motion, cortes ou transições, proponha o som junto. Detalhes: `<bold_home>/references/sound-design.md`.
1. `bold audio status` (somente leitura). Sem SFX Kit: mostre `bold audio setup sfx-kit` e **peça** antes de instalar. Armazenamento externo offline (`STORAGE_OFFLINE`, `DISCONNECTED`, `IMAGE_DETACHED`): diga o que ficou indisponível e o comando de recuperação (`bold audio storage attach --yes` só com pedido); não instale nada no disco interno.
2. Estilo a partir do briefing: `minimal` · `institutional` · `motion` · `cinematic` (na dúvida: `motion` para motion graphics, `institutional` com narração).
3. Eventos: `bold audio events <motion.spec.json | plan.json editorial | cues.json>`.
4. Narração/música: `--transcript f` ou `--voice narracao.wav` (trechos de fala → ducking dos SFX).
5. Plano: `bold audio plan <entrada> --style S [--transcript f|--voice f] --output sons/plano-som.json`. Mostre os cues, os descartados e por quê. **Espere aprovação.**
6. Sem candidato no kit (`fallbacks`): `bold audio openverse search "<termo em inglês>"`, avalie licença/fonte/duração e **pergunte** antes de `openverse fetch <id> --project <dir> --yes`. Alternativa local: `bold audio earshot render <id> --output …` (se instalado).
7. Render do áudio (arquivos novos, nunca sobrescreve): `bold audio render sons/plano-som.json --output sons/render-<data> [--voice f] [--music f]` → WAV conformados, stem, mix, medição (LUFS, true peak) e sincronia medida no sinal.
8. Exports: `bold audio export plano.json --conformed <pasta> --remotion-tsx BoldSfx.tsx --davinci-csv cues.csv [--tc-start 01:00:00:00]`.
9. Prévia com som (PROTEGIDA, `preview-video`): `bold audio mux --video v.mov --audio mix.wav --output preview.mov --authorization-file auth.json`.
10. Reporte: cues, sincronia (erro em ms), LUFS/true peak, origem e licença de cada efeito, créditos pendentes.
