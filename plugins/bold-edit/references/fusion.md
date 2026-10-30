# Fusion (DaVinci Resolve)

**STATUS = EXPERIMENTAL.** Esta Skill **não tem** módulo Fusion. Existe só conhecimento de um builder de projeto (SPEC → comp) usado no piloto. Não prometa capacidade madura.

## Casos ideais
- Lower thirds simples que o editor vai ajustar.
- Overlays simples, tags, contadores básicos.
- Máscaras e reveals sobre o footage.
- Texto editável dentro do Resolve.
- Motion que depende do Resolve (tracking, timing ao vivo, grade do plano).

## Quando NÃO usar
- Câmera complexa, muitas camadas, dados, séries grandes → Remotion.
- Tipografia que exige baseline e kerning exatos → HyperFrames.

## Padrão recomendado: SPEC → comp
1. Descreva a peça em uma SPEC (tokens + layout + timing).
2. Um **builder versionado** gera a comp a partir da SPEC. Não edite a comp à mão sem registrar.
3. Instancie em uma timeline **própria** de masters e use `ExportFusionComp` para reutilizar (`davinci-safety.md` A15).

## Riscos de page state e API

| Risco | Regra |
|---|---|
| A página Fusion cria comps não pedidas ao trocar de timeline | `davinci-safety.md` H7: só escreva com `GetCurrentPage() == "edit"` |
| `OpenPage` proibido | Peça ao usuário para trocar de página |
| A comp vive na **instância** da timeline, não no item do pool; itens Fusion não têm File Path | Identifique por nome + tipo + bin + UID |
| `InsertFusionTitleIntoTimeline` faz ripple; `InsertFusionCompositionIntoTimeline` não controla a track | Prefira uma comp exportada + fluxo controlado; ensaie em duplicata |
| Alpha do nó Background é **premultiplicado** | Considere isso ao compor com material straight |

## Unidades medidas via API (Resolve 21.1)

Dependem da fonte e da versão: **re-meça** para cada fonte e cada versão.

| Parâmetro | Relação observada |
|---|---|
| TextPlus `Size` | ≈ px CSS / 1560 (medido para uma família condensada; varia por fonte) |
| Âncora esquerda/baseline | `HorizontalLeftCenterRight = -1` + `CenterOnBaseOfFirstLine = 1` |
| `CharacterSpacing` | ≈ `1 + 0,8125 × letterSpacing(em)` |
| RectangleMask `Height` | relativa à **altura** |
| EllipseMask `Height` | relativa à **largura** |
| `BorderWidth` | ≈ px / largura do quadro (1920) |
| XYPath com componente constante | exige spline (`SetInput` é ignorado) |
| `AddModifier` | cria key em F0: sobrescreva sempre |

Para largura de texto sem renderizar, use métricas da fonte (tabelas `cmap` + `hmtx`) em vez de estimar.

## Validação
QC níveis 1 e 4 (`qc-methods.md`): stills do Resolve, medição de cor e posição, readback de nome, tipo e TL. Sem render.
