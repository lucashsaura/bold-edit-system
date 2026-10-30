// `bold editorial …` (R9 — Editorial + Motion Decision Engine V1). DECIDIR ≠ EXECUTAR: nenhum comando escreve no
// DaVinci, cria track, oculta legenda, importa/insere mídia, renderiza, exporta ou cria motion final.
// Consome a saída da R8 em modo SOMENTE LEITURA. Fluxo: ANALYZE → PLAN → HUMAN REVIEW → APPROVED PLAN → execução (outra camada).
//   analyze | plan | inspect | explain | validate | route   (+ alias `bold motion route`)
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan, selectTranscript } from '../../editorial/src/plan.mjs';
import { extractSignals } from '../../editorial/src/signals.mjs';
import { validatePlan } from '../../editorial/src/validate.mjs';
import { route } from '../../editorial/src/router.mjs';
import { EditorialError, normalizeIntent } from '../../editorial/src/intent.mjs';
import { loadTranscript } from '../../transcript/src/normalize.mjs';
import { analyze } from '../../transcript/src/analyze.mjs';
import { TranscriptError } from '../../transcript/src/parsers.mjs';
import { TimeError } from '../../transcript/src/time.mjs';
import { loadIndex, defaultIndexPath } from '../../asset-index/src/store.mjs';
import { AssetError } from '../../asset-index/src/scan.mjs';
import { EXIT } from './media.mjs';

const USAGE = `uso: bold editorial <comando> [opções] [--json]
  analyze --context ctx.json [--transcript-id tN] | --transcript f [--vocabulary v]     sinais editoriais (ainda não decisões)
  plan    --context ctx.json [--transcript-id tN] | --transcript f [--index f | --root pasta]
          [--mode CONSERVATIVE|BALANCED|EXPRESSIVE] [--intent intent.json] [--intent-text "…"] [--identity id.json] [--vocabulary v]
          [--subtitle-presence present|absent|unknown] [--fps F] [--aspect 9:16] [--resolution 1080x1920] [--availability a.json] [--output plan.json]
  inspect <plan.json>                 resumo das decisões
  explain <plan.json> <dNNNN>         trilha de motivos de uma decisão
  validate <plan.json>                validator fail-closed (FAIL → exit 1)
  route   <plan.json> <dNNNN> [--availability a.json]     Motion Router (alias: bold motion route)
  O plano é RASCUNHO para revisão humana. Nada é executado.`;

const readJson = (f, code) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new EditorialError(code, `${path.basename(f)}: ${e.message}`); } };
const loadPlan = (f) => { if (!f || !fs.existsSync(f)) throw new EditorialError('USAGE', 'plano não encontrado'); const p = readJson(f, 'PLAN_INVALID'); if (p.schema !== 'bold.editorial-plan/1') throw new EditorialError('PLAN_INVALID', 'não é bold.editorial-plan/1'); return p; };

function inputs(o, loaded) {
  const vocabulary = o.vocabulary ? readJson(o.vocabulary, 'VOCABULARY_INVALID') : null;
  if (o.context) {
    const ctx = readJson(o.context, 'CONTEXT_INVALID'); // somente leitura: o arquivo da R8 nunca é regravado
    if (ctx.schema !== 'bold.project-context/1') throw new EditorialError('CONTEXT_INVALID', 'não é bold.project-context/1');
    return { ctx, vocabulary };
  }
  const tf = o.transcript ? [].concat(o.transcript)[0] : null;
  if (!tf) throw new EditorialError('USAGE', 'informe --context ctx.json ou --transcript arquivo');
  const doc = loadTranscript(path.resolve(tf), { fps: null });
  let assets = [];
  if (o.index || o.root) assets = loadIndex(o.index ? path.resolve(o.index) : defaultIndexPath(fs.realpathSync(o.root).normalize('NFC'), loaded)).assets;
  return { doc, annotations: analyze(doc, { vocabulary }), assets, vocabulary };
}

function exitFor(code) {
  if (['USAGE', 'INTENT_INVALID', 'IDENTITY_INVALID', 'VOCABULARY_INVALID', 'FPS_INVALID', 'FPS_MISSING'].includes(code)) return EXIT.USAGE;
  if (['OUTPUT_EXISTS', 'TRANSCRIPT_AMBIGUOUS', 'TRANSCRIPT_NOT_FOUND', 'DECISION_NOT_FOUND'].includes(code)) return EXIT.STOP;
  return EXIT.FAIL;
}

export async function cmdEditorial(args, loaded, stream = process.stdout, opName = null) {
  const o = args.opts; const op = opName ?? args._[1]; const pos = opName ? args._.slice(2) : args._.slice(2);
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  const fail = (code, message, details = null) => { out({ ok: false, error: { code, message, details } }, [`bold editorial ${op}: ${code}: ${message}`, ...(details ? [`  ${JSON.stringify(details).slice(0, 800)}`] : [])]); return exitFor(code); };
  try {
    if (op === 'analyze') {
      const i = inputs(o, loaded);
      const t = i.ctx ? selectTranscript(i.ctx, o['transcript-id'] ?? null) : { doc: i.doc, annotations: i.annotations };
      const s = extractSignals(t.doc, t.annotations, { vocabulary: i.vocabulary ?? {} });
      out(s, [`${s.moments.length} segmentos · ${s.nature}`, `  ${Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`,
        ...s.moments.filter((m) => m.signals.length).map((m) => `  ${m.segment_id} ${m.start}s  ${[...new Set(m.signals.map((x) => x.type + (x.role ? `(${x.role})` : '')))].join(' + ')}  "${m.text.replace(/\n/g, ' ').slice(0, 60)}"`)]);
      return EXIT.OK;
    }
    if (op === 'plan') {
      const i = inputs(o, loaded);
      const res = o.resolution ? (/^(\d+)x(\d+)$/.exec(o.resolution) ?? (() => { throw new EditorialError('USAGE', '--resolution WxH'); })()).slice(1).map(Number) : null;
      if (o.aspect && !/^\d+:\d+$/.test(o.aspect)) throw new EditorialError('USAGE', '--aspect W:H');
      if (o['subtitle-presence'] && !['present', 'absent', 'unknown'].includes(o['subtitle-presence'])) throw new EditorialError('USAGE', '--subtitle-presence present|absent|unknown');
      const plan = buildPlan({ ...i, transcriptId: o['transcript-id'] ?? null, mode: o.mode ? String(o.mode).toUpperCase() : undefined,
        intent: o.intent ? readJson(o.intent, 'INTENT_INVALID') : null, intentText: o['intent-text'] ?? null, identity: o.identity ? readJson(o.identity, 'IDENTITY_INVALID') : null,
        user: { fps: o.fps ?? null, aspect: o.aspect ?? null, resolution: res, subtitles: o['subtitle-presence'] ?? null }, availability: o.availability ? readJson(o.availability, 'USAGE') : null });
      if (plan.validation.status === 'FAIL') return fail('PLAN_INVALID', 'o plano gerado não passou no validator (fail-closed; nada gravado)', plan.validation.errors);
      const text = `${JSON.stringify(plan, null, 2)}\n`;
      if (o.output) {
        const f = path.resolve(o.output);
        if (fs.existsSync(f)) return fail('OUTPUT_EXISTS', `saída já existe (nunca sobrescrevo): ${path.basename(f)}`);
        fs.writeFileSync(f, text, { flag: 'wx' });
        out({ ok: true, output: f, summary: plan.summary, validation: plan.validation.status }, [`plano → ${path.basename(f)} · ${plan.mode} · ${plan.summary.decisions} decisões · validação ${plan.validation.status} · STATUS ${plan.status}`]);
      } else stream.write(text);
      return EXIT.OK;
    }
    if (op === 'inspect') {
      const p = loadPlan(pos[0]);
      out({ schema: p.schema, status: p.status, mode: p.mode, timeline: p.timeline, summary: p.summary, density: p.density, validation: p.validation.status, decisions: p.decisions.map((d) => ({ id: d.id, start: d.start, end: d.end, action: d.decision.action, priority: d.decision.priority, tool: d.route.tool, subtitle: d.subtitle_interaction?.status ?? null })) },
        [`${p.status} · ${p.mode} · ${p.summary.decisions} decisões · ${p.density.visual_interventions} intervenções visuais · validação ${p.validation.status}`,
          `  timeline: ${p.timeline.name ?? '—'} · fps ${p.timeline.fps ?? 'n/d'}${p.timeline.drop_frame ? ' DF' : ''} · ${p.timeline.aspect ?? 'aspecto n/d'} · legendas ${p.timeline.subtitles}`,
          ...p.decisions.map((d) => `  ${d.id} ${String(d.start).padStart(7)}s ${(d.tl_in_tc ?? '').padEnd(11)} ${d.decision.action.padEnd(18)} ${d.decision.priority.padEnd(8)} ${d.route.tool.padEnd(14)} ${d.subtitle_interaction?.status ?? ''}`),
          `  suprimidos: ${p.suppressed.length} (${[...new Set(p.suppressed.map((s) => s.outcome))].join(', ') || '—'})`, '  Nada foi executado. Próximo passo: revisão humana.']);
      return EXIT.OK;
    }
    if (op === 'explain' || op === 'route') {
      const p = loadPlan(pos[0]); const d = p.decisions.find((x) => x.id === pos[1]);
      if (!d) return fail('DECISION_NOT_FOUND', `decisão ${pos[1] ?? '(faltando)'} não existe no plano`);
      if (op === 'route') {
        const r = route(d, { intent: normalizeIntent(p.intent?.source === 'none' ? null : stripIntent(p.intent)), availability: o.availability ? readJson(o.availability, 'USAGE') : null });
        out(r, [`${d.id} ${d.decision.action} → ${r.tool} (${r.capability_status})`, `  regra: ${r.rule}`, `  scores: ${Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
          `  fallback: ${r.fallback ? `${r.fallback.tool} (${r.fallback.loss})` : '—'}`, ...r.issues.map((i) => `  ! ${i.code}: ${i.detail}`), '  Escolha por intenção/resultado — não por disponibilidade.']);
        return EXIT.OK;
      }
      out({ id: d.id, decision: d.decision, signals: d.signals, evidence: d.evidence, visual_intent: d.visual_intent, subtitle_interaction: d.subtitle_interaction, placement: d.placement, density: d.density, route: d.route, alternatives: d.alternatives, constraints: d.constraints, approval: d.approval },
        [`${d.id} · ${d.start}–${d.end}s${d.tl_in_tc ? ` (${d.tl_in_tc}–${d.tl_out_tc})` : ''} · ${d.decision.action} · ${d.decision.priority} · confiança ${d.confidence}`,
          `  POR QUÊ: ${d.decision.reason}`, `  regra: ${d.decision.rule}`, `  evidência: "${d.evidence.transcript.replace(/\n/g, ' ')}"`, `  sinais: ${d.signals.join(', ') || '—'} (${d.evidence.signal_sources.length} origens)`,
          ...d.decision.user_intent_effects.map((e) => `  efeito: ${e}`), ...(d.visual_intent ? [`  intenção visual: ${d.visual_intent.purpose} · ${JSON.stringify(d.visual_intent.hierarchy)}`] : []),
          ...(d.subtitle_interaction ? [`  legenda: ${d.subtitle_interaction.status} — ${d.subtitle_interaction.reason}`] : []), ...(d.placement ? [`  enquadramento: ${d.placement.status}`] : []),
          ...(d.density ? [`  densidade: ${d.density.outcome} — ${d.density.reason}`] : []), `  ferramenta: ${d.route.tool} — ${d.route.rule}`,
          ...(d.candidate_assets ? [`  assets: ${d.candidate_assets.status}${d.candidate_assets.recommended ? ` → sugerido ${d.candidate_assets.recommended.rel_path}` : ''} (${d.candidate_assets.candidates.length} candidato(s))`] : []),
          ...d.constraints.map((c) => `  restrição: ${c}`), ...d.alternatives.map((a) => `  alternativa: ${a.action} — ${a.reason}`), `  aprovação: ${d.approval.status}`]);
      return EXIT.OK;
    }
    if (op === 'validate') {
      const p = loadPlan(pos[0]); const v = validatePlan(p);
      out(v, [`validação: ${v.status} (${v.errors.length} erro(s), ${v.warnings.length} aviso(s))${v.approvable ? '' : ' — NÃO aprovável'}`, ...v.errors.map((e) => `  ERRO ${e.code} ${e.decision ?? ''}: ${e.detail}`), ...v.warnings.map((w) => `  aviso ${w.code} ${w.decision ?? ''}: ${w.detail}`)]);
      return v.status === 'FAIL' ? EXIT.FAIL : EXIT.OK;
    }
    return fail('USAGE', `comando desconhecido: ${op}`);
  } catch (e) {
    if (e instanceof EditorialError || e instanceof TranscriptError || e instanceof TimeError || e instanceof AssetError) return fail(e.code, e.message.replace(/^[A-Z_0-9]+: /, ''), e.details ?? null);
    throw e;
  }
}

const stripIntent = (i) => Object.fromEntries(Object.entries(i ?? {}).filter(([k]) => !['source', 'matched', 'text'].includes(k)));
