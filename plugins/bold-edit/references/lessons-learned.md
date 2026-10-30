# Lessons learned

Incidentes do projeto piloto com valor **genérico**, anonimizados. Cada um segue o formato:
INCIDENT → ROOT CAUSE → GENERAL RULE → PREVENTION → DETECTION → RECOVERY.
Os ambientes registrados são DaVinci Resolve 21.1, Remotion 4.0.290 e HyperFrames 0.8.114.

---

## Timeline e Media Pool

### L-01 · Insert na timeline errada
- **INCIDENT:** um script escreveu usando o objeto de uma timeline enquanto **outra** era a corrente. `DeleteClips` retornou `False` sem apagar, e vários `AppendToTimeline` inseriram mídia na timeline errada.
- **ROOT CAUSE:** os métodos de escrita agem na timeline corrente e ignoram o objeto recebido.
- **GENERAL RULE:** gate `SetCurrentTimeline` + conferência do nome antes de **cada** write (`davinci-safety.md` H1).
- **PREVENTION:** função `gate()` obrigatória e sem bypass.
- **DETECTION:** readback por name + TL in/out + File Path, mais o diff PRE/POST de **todas** as timelines.
- **RECOVERY:** reverta item a item a partir do snapshot PRE, com checkpoint, e confira o diff de novo.

### L-02 · Nome de arquivo duplicado entre câmeras
- **INCIDENT:** a busca no Media Pool por nome devolveu o clip de outra câmera. O insert saiu com `LeftOffset` além do fim da mídia e `RightOffset` negativo.
- **ROOT CAUSE:** pastas de câmeras diferentes usam a mesma numeração de arquivos, e a busca por nome devolve o primeiro item que entrou no pool.
- **GENERAL RULE:** Media Pool sempre pelo **File Path** (H5).
- **PREVENTION:** `find_by_path` com caminhos normalizados (NFC).
- **DETECTION:** readback do File Path; offsets fora do intervalo da mídia.
- **RECOVERY:** reinsira pelo objeto correto, no mesmo TL, e faça o readback.

### L-03 · Página Fusion criou comps não pedidas
- **INCIDENT:** com a página Fusion aberta, o clip sob o playhead ganhou uma comp automaticamente.
- **ROOT CAUSE:** a página Fusion carrega o clip sob o playhead, e trocar de timeline ali repete o efeito.
- **GENERAL RULE:** writes só com `GetCurrentPage() == "edit"` (H7).
- **PREVENTION:** checagem de página no gate.
- **DETECTION:** itens Fusion inesperados no snapshot.
- **RECOVERY:** PARE e peça ao usuário para voltar à Edit. Remova as comps só com autorização.

### L-04 · `OpenPage` travou a interface
- **INCIDENT:** a troca de página por API congelou a UI e, em outra ocasião, retornou `None`.
- **GENERAL RULE:** `OpenPage` proibido (invariante `allow_open_page=false`, H8).
- **RECOVERY:** o usuário troca de página manualmente.

### L-05 · Mark Out salvo contaminou o ripple insert
- **INCIDENT:** o gerador usado no ripple insert entrou com a duração da timeline inteira.
- **ROOT CAUSE:** sem marks explícitas, `InsertGeneratorIntoTimeline` usa as marks salvas da timeline (havia um Mark Out de render range).
- **GENERAL RULE:** sempre `SetMarkInOut` explícito. Ensaie numa duplicata (P1).
- **DETECTION:** a duração do gerador ≠ N; o script parou na própria checagem.
- **RECOVERY:** ripple delete do gerador, conferência contra o PRE e reaplicação com marks explícitas.

### L-06 · Still atrasado depois de trocar de timeline
- **INCIDENT:** `ExportCurrentFrameAsStill` devolveu o frame da timeline anterior.
- **GENERAL RULE:** warm-up + dupla exportação comparada (A7).

### L-07 · Render implícito e página Deliver
- **INCIDENT:** vídeos de revisão foram gerados sem pedido explícito de render, e `StartRendering` deixou o Resolve na página Deliver.
- **ROOT CAUSE:** pedido de "finalizar/fazer QC" interpretado como autorização. Efeito colateral de página da API.
- **GENERAL RULE:** render, preview em vídeo e export só com autorização explícita (`render-policy.md`). Faça os writes antes de qualquer render.
- **PREVENTION:** invariantes + gate estruturado no CLI. Palavras de fluxo não autorizam.
- **DETECTION:** arquivos de vídeo novos ou jobs na fila sem registro no log de autorização.
- **RECOVERY:** informe. Não apague por conta própria. O usuário volta à página Edit.

### L-08 · MP4 renderizado só com áudio
- **INCIDENT:** o render MP4/H.264 de uma timeline longa terminou em segundos, só com áudio, e o job ficou "Complete".
- **GENERAL RULE:** valide **todo** arquivo renderizado com ffprobe (streams, duração, frames). O status do job não é QC.
- **RECOVERY:** render em MOV/H.264 + remux para MP4 com `-c copy` (`davinci-safety.md` V1).

### L-09 · Mídia "offline" fantasma
- **INCIDENT:** depois de desconectar e reconectar o disco, os clips apareciam "Media Offline" no playback e nos stills, mas reportavam `Online`.
- **ROOT CAUSE:** handles antigos do Resolve.
- **GENERAL RULE:** antes de concluir que algo sumiu, `SaveProject` → `CloseProject` → `LoadProject` (P3). Nunca relinke por reflexo.

### L-10 · Mídia de fps diferente convertida em tempo real
- **INCIDENT:** um alinhamento de duas peças da mesma fonte (23,976/29,97 numa timeline de 24 fps) ficou deslocado.
- **ROOT CAUSE:** o Resolve converte em tempo real: `LeftOffset(TL) = src × 24/fps`.
- **GENERAL RULE:** alinhe pela origem virtual `TL_in − src × 24/fps` (A18).

### L-11 · Checkpoint falhou no projeto nunca salvo
- **INCIDENT:** o primeiro `ExportProject` retornou `False` e não criou arquivo.
- **ROOT CAUSE:** o projeto não constava no banco do Project Manager.
- **GENERAL RULE:** `SaveProject` antes de `ExportProject`. Confirme o arquivo com tamanho > 0 (H3, A10).

### L-12 · Import bloqueado por barra invertida no nome da pasta
- **INCIDENT:** `ImportMedia` retornou 0 clipes em todas as formas de chamada.
- **ROOT CAUSE:** o nome do diretório continha uma barra invertida literal.
- **GENERAL RULE:** reporte e peça autorização. Renomear mídia do usuário só com aprovação explícita e hash antes e depois (H9).

### L-13 · Multicam por áudio empilhou as tomadas
- **INCIDENT:** um multicam sincronizado por áudio saiu com a duração do clipe mais longo, com todas as tomadas empilhadas.
- **ROOT CAUSE:** as tomadas repetiam o mesmo texto, então a forma de onda casou entre tomadas diferentes.
- **GENERAL RULE:** confira a duração resultante. Sincronize por correlação **por par** de câmeras, com tolerância ≤ 1 frame.

### L-14 · Enable de track sem efeito
- **INCIDENT:** `SetTrackEnable` retornou `True` e nada mudou. Em outro teste, o enable de áudio não afetou o render.
- **GENERAL RULE:** só na página Edit e na timeline corrente, com readback obrigatório. Para stems, use `AudioVolume` por clipe (A3, A4).

## Cor e alpha

### L-15 · Regressão BT.601 → Rec.709
- **INCIDENT:** cores de marca apareceram deslocadas no Resolve (verdes mais escuros, vermelho com outro matiz) em overlays de duas ferramentas diferentes.
- **ROOT CAUSE:** o encoder da ferramenta converteu com a matriz BT.601 e gravou sem tag. O Resolve lê o material como Rec.709.
- **GENERAL RULE:** sequência PNG → ffmpeg com matriz e tags BT.709 explícitas + validação (`color-pipeline.md`).
- **DETECTION:** ffprobe com `color_space unknown`; pixel medido no still ≠ token.
- **RECOVERY:** re-encode 601 → 709 sem re-render, `ReplaceClip`, readback e originais preservados.

### L-16 · "Sem alpha" que era fundo branco
- **INCIDENT:** um preview MP4 de uma composição com fundo transparente saiu sobre branco e foi lido como falha de alpha.
- **GENERAL RULE:** MP4/H.264 não tem alpha. Valide alpha só em ProRes 4444 ou PNG, com a bateria de QC (`alpha-pipeline.md`).

### L-17 · Risco de halo na média de sub-frames
- **INCIDENT (prevenido):** uma média de amostras em alpha straight puxaria a cor de pixels transparentes para a borda.
- **GENERAL RULE:** premultiply → média → unpremultiply. **HALO = FAIL** (`motion-blur.md`).

### L-18 · Falso alarme de croma em still do Resolve
- **INCIDENT:** uma linha fina de 1 px mostrou cor errada no still do Resolve.
- **ROOT CAUSE:** o caminho de still faz média de croma entre pares de colunas. O arquivo estava correto.
- **GENERAL RULE:** confirme decodificando o arquivo com ffmpeg antes de alterar qualquer coisa. Alinhe linhas finas em coluna par.

## Render determinístico

### L-19 · Raster 3D variando entre renders
- **INCIDENT:** dois renders do mesmo código CSS-3D divergiram.
- **ROOT CAUSE:** GPU e workers paralelos, CSS blur em elementos 3D, elemento cruzando o plano da câmera.
- **GENERAL RULE:** swangle + concurrency 1, sem CSS blur em 3D, nada cruzando o plano, framemd5 2× (`remotion-determinism.md`).

### L-20 · Strobe com poucos sub-frames
- **INCIDENT:** elementos rápidos apareceram como cópias discretas com 4–8 sub-frames.
- **GENERAL RULE:** 16 sub-frames + anti-strobe por amostra (só em 2D), com o obturador da câmera menor que o da ação (`motion-blur.md`).

### L-21 · "Fantasma" em gravação de tela durante sub-frames
- **INCIDENT:** o texto de uma interface rolando apareceu duplicado.
- **ROOT CAUSE:** o índice do frame da gravação foi calculado pelo tempo fracionário do sub-frame.
- **GENERAL RULE:** índices discretos sempre do frame **inteiro** (D3). Congele o footage nos sub-frames (D9).

### L-22 · Disco cheio por PNG temporário
- **INCIDENT:** renders em sequência PNG 16 bits com muitos sub-frames esgotaram o disco do sistema.
- **GENERAL RULE:** renderize em chunks, apague temporários pelo caminho literal depois de validar e confira o espaço antes (`bold doctor`).

## Portabilidade e processo

### L-23 · Dependência externa com versão no caminho
- **INCIDENT:** scripts apontavam para o caminho de cache de um plugin, com a versão no path. A documentação citava uma versão de browser que já não era a usada.
- **GENERAL RULE:** detecte as dependências (doctor), fixe a versão em config e nunca use o caminho de cache em código (`hyperframes.md`).

### L-24 · Paths fixos e scripts não reproduzíveis
- **INCIDENT:** scripts dependiam de diretórios temporários de sessão já apagados e de paths pessoais. Comandos únicos (extração de áudio, encode de master opaco) nunca foram salvos.
- **GENERAL RULE:** toda operação reutilizável vira script versionado e parametrizado por config. Nada de path pessoal (`packaging-and-leaks.md`).

### L-25 · Fontes por symlink absoluto
- **INCIDENT:** projetos referenciavam fontes comerciais por links absolutos para a pasta de fontes do usuário.
- **GENERAL RULE:** fontes vêm de `FONTS_DIR` + manifesto `fonts_required`, nunca são empacotadas, e o build falha sem a fonte.

### L-26 · Descrição inferida errada no índice
- **INCIDENT:** clips descritos por inferência de bloco/pasta mostravam outro conteúdo na verificação visual.
- **GENERAL RULE:** só `CONFIRMED` é afirmado. Nunca substitua por nome ou pasta (`asset-index.md`).

### L-27 · Limpeza propôs apagar material bruto
- **INCIDENT:** um plano de limpeza classificou material bruto não usado como candidato a exclusão.
- **GENERAL RULE:** material do usuário é **preservado**, usado ou não (invariante `delete_user_media=false`). Limpeza só de arquivos **gerados pelo processo**, com cópia verificada por hash antes. Mídia lida pelo Resolve é **copiada, nunca movida**.

### L-28 · Lógica crítica não persistida
- **INCIDENT:** a lógica de snapshot, checkpoint, gate e diff rodou inline em sessões e só sobraram as saídas.
- **GENERAL RULE:** procedimentos de segurança viram código versionado e testado: DaVinci Bridge V1 (R7, `davinci-bridge.md`). As receitas estão em `davinci-api-recipes.md`.
