# Regras de segurança do BOLD EDIT SYSTEM (inegociáveis)

Estas regras valem em qualquer instalação (pessoal, projeto ou plugin). Nenhuma conveniência de instalação as enfraquece.
Fonte completa: `<bold_home>/references/render-policy.md` e `<bold_home>/references/davinci-safety.md`.

## Render / export / preview em vídeo
1. Nenhum render, encode, export, preview em vídeo, Render Job, Render Settings, Render Queue ou Deliver sem **autorização explícita do usuário nesta conversa**, com escopo (o quê, quantos, formato).
2. A autorização é registrada como arquivo estruturado (`--authorization-file`) e checada pelo policy gate **antes** de qualquer processo.
3. Ela termina com a tarefa/rodada autorizada. Não reaproveite autorização antiga.
4. "Testar", "integrar", "finalizar", "verificar" e "QC" **não** são autorização.
5. **Opt-in técnico ≠ autorização humana:** `BOLD_TEST_RENDER_AUTH=1` só permite que testes gerem mídia; não autoriza nada.
6. Stills para QC visual são permitidos. Vídeo não.

## DaVinci Resolve
1. **Leitura** (status, timelines, inspect, media) é livre. Ela nunca troca projeto, timeline ou página.
2. **Escrita em projeto real** exige autorização humana `davinci-write` com projeto + timeline + operação, dada há no máximo 60 min.
3. Sandbox `BOLD_BRIDGE_SANDBOX*` é o lugar de testes. Abrir ou criar um projeto pela API fecharia o projeto do usuário: peça para ele abrir.
4. Antes de cada write estrutural, nesta ordem:
   - checkpoint (`.drp` verificado fora do sandbox);
   - gate `SetCurrentTimeline` → `GetCurrentTimeline` → nome == alvo, **imediatamente** antes;
   - mídia por **File Path** (nome de arquivo não é identidade; homônimo → pare);
   - readback + diff ("a API retornou true" não basta).
5. Nunca: `OpenPage`, replace, ripple, move, relink, troca de projeto, escrita na página Fusion.
6. **Delete (V1.1)** só por `bold davinci delete`, e só assim:
   - autorização humana `davinci-write` cuja lista `davinci.operations` **inclui `delete`** (autorização genérica não vale), com projeto + timeline;
   - alvos exatos: `unique_id` + `kind` + `track` + `tl_in` + `tl_out` (+ `file_path`), lidos de `bold davinci inspect --timeline T --json` **na hora**; qualquer divergência → para sem apagar;
   - partes ligadas (vídeo↔áudio) precisam estar na lista, senão para;
   - remove da **timeline**, nunca do Media Pool nem do disco; **sem ripple** (nada anda);
   - `.drp` antes; gate de timeline imediatamente antes; readback: PASS só se saíram exatamente os alvos.
   - Rollback: reimportar o `.drp` (manual). Não existe desfazer por script.
6. Dúvida ou comportamento inesperado → **pare** e reporte. Não "conserte" destrutivamente.

## Decisão editorial
- Os planos de `bold editorial` são **rascunhos para revisão humana** (`execution.allowed = false`).
- Ocultar legenda, inserir mídia, criar track ou motion só com aprovação e pela camada de execução.
- Placement sem análise do frame é sempre `VISUAL_PLACEMENT_REQUIRES_REVIEW`. Nunca afirme espaço livre no quadro sem evidência.

## Sistema e privacidade
- **SYSTEM ≠ TEMPLATE:** referências viram regras; cópia literal só com pedido explícito.
- Nenhum dado de cliente, mídia, transcrição real, log, `.drp` ou caminho pessoal no pacote ou no repositório.
- Nunca apagar, mover ou renomear mídia do usuário.
- Nunca instalar dependências, baixar modelos/fontes/assets ou alterar configuração do sistema sem pedido explícito.

## Som (R13)
1. **Downloads:** o SFX Kit e os modelos do Earshot só são instalados quando o usuário pede (`--yes` / aprovação explícita). Nada é baixado ao iniciar a Skill.
2. **Openverse:** só baixe o item que o usuário aprovou, para `<projeto>/sons/`. Licenças `cc0`/`pdm`/`by` com verificação; `by` exige crédito (gravado em `sons/creditos.txt`). `by-sa`, `nc`, `nd` ou licença não verificável **não** entram em entrega comercial (`--allow-unverified` = só prévia não comercial).
3. **Earshot:** sempre offline e sem chaves. Nunca `earshot llm`, nunca `--yes-upload`: isso envia áudio ao Google.
4. **Nada é sobrescrito:** planos, WAV, stems, mixes e créditos são arquivos novos (créditos só acrescentam). Narração e música de origem nunca são alteradas.
5. **Densidade:** não ponha efeito em todo corte; o estilo decide. Mostre os descartados e o motivo.
6. **Vídeo com áudio** (`bold audio mux`) é `preview-video`: exige autorização explícita, como qualquer prévia em vídeo.
7. **DaVinci:** a Bridge V1 insere só em tracks de vídeo; o áudio vai como WAV conformados + cue list (TC) para o usuário posicionar, ou por write autorizado numa versão futura.
