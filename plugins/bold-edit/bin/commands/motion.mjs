// `bold motion validate|compile|inspect` (R6.1) — SEM render de vídeo.
//   validate  autoria (schema) + compilação do backend declarado + validação do plano compilado + gate estático de fontes
//   compile   idem + grava o plano (e, no HyperFrames, o HTML gerado)
//   inspect   HyperFrames: job temporário → lint 0/0 → layout resolvido + gate dinâmico de fontes → stills PNG opcionais
import fs from 'node:fs';
import path from 'node:path';
import { preparePlan, RenderError } from '../../core/render/render.mjs';
import { validatePlan, FORMATS } from '../../hyperframes/src/compile.mjs';
import { generateHtml } from '../../hyperframes/src/html.mjs';
import { EXIT } from './media.mjs';

const fmtErr = (d) => (typeof d === 'string' ? `  - ${d}` : `  - [${d.code}] ${d.path}: ${d.message}${d.pattern ? ` (${d.pattern})` : ''}`);
function out(stream, json, payload, lines) { stream.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`); }

async function compileArg(args) {
  const specPath = args._[2];
  if (!specPath) return { usage: true };
  const format = args.opts.format ?? null;
  if (format && !FORMATS[format]) return { error: new RenderError('FORMAT_INVALID', `--format ${format}: 16:9 | 9:16 | 1:1`) };
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (format && spec?.decision?.backend !== 'hyperframes') return { error: new RenderError('FORMAT_UNSUPPORTED', '--format só existe no backend hyperframes (o Remotion V1 congelado usa o tamanho do spec)') };
  try {
    const specDir = path.dirname(path.resolve(specPath));
    if (spec?.decision?.backend === 'hyperframes' && format) {
      const { prepareHyperFrames } = await import('../../hyperframes/adapter/render.mjs');
      const r = prepareHyperFrames(spec, { specDir, format }); return { spec, specPath, specDir, backend: 'hyperframes', plan: r.plan, html: r.html };
    }
    const r = await preparePlan({ spec, specDir });
    return { spec, specPath, specDir, backend: r.backend, plan: r.plan, html: r.html ?? null };
  } catch (e) { if (e instanceof RenderError || e?.name === 'RenderError') return { error: e }; throw e; }
}

export async function cmdMotion(args, loaded, stream = process.stdout) {
  const sub = args._[1];
  if (!['validate', 'compile', 'inspect'].includes(sub)) { process.stderr.write('uso: bold motion validate|compile|inspect <motion.spec.json> [--format 16:9|9:16|1:1] [--output f] [--html f] [--stills t1,t2] [--json]\n'); return EXIT.USAGE; }
  const r = await compileArg(args);
  if (r.usage) { process.stderr.write(`uso: bold motion ${sub} <motion.spec.json> [--format 16:9|9:16|1:1] [--json]\n`); return EXIT.USAGE; }
  if (r.error) {
    const e = r.error; const details = Array.isArray(e.details) ? e.details : [];
    out(stream, args.json, { status: 'FAIL', code: e.code, message: e.message, errors: details }, [`bold motion ${sub}: ${e.message}`, ...details.map(fmtErr), '→ FAIL']);
    return e.code === 'BACKEND_DECISION_REQUIRED' ? EXIT.STOP : e.code === 'BACKEND_UNAVAILABLE' ? EXIT.UNAVAILABLE : EXIT.FAIL;
  }
  const planErrors = r.backend === 'hyperframes' ? validatePlan(r.plan) : [];
  const summary = r.backend === 'hyperframes'
    ? { schema: r.plan.schema, backend_version: r.plan.backend_version, format: r.plan.composition.format, size: `${r.plan.composition.width}x${r.plan.composition.height}`, aspect: r.plan.composition.aspect_class, layers: r.plan.layers.map((L) => `${L.id}:${L.pattern}`), fonts: r.plan.fonts.map((f) => `${f.family} (${f.file})`), refs: r.plan.references.edges.length }
    : { schema: 'remotion plan', version: r.plan.version, layers: r.plan.layers.map((L) => `${L.id}:${L.pattern}`) };
  if (planErrors.length) { out(stream, args.json, { status: 'FAIL', errors: planErrors }, ['bold motion: plano compilado inválido', ...planErrors.map(fmtErr), '→ FAIL']); return EXIT.FAIL; }

  if (sub === 'validate') { out(stream, args.json, { status: 'PASS', backend: r.backend, ...summary }, [`bold motion validate: ${path.basename(r.specPath)} → ${r.backend}`, ...Object.entries(summary).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`), '→ PASS']); return EXIT.OK; }

  if (sub === 'compile') {
    const planOut = args.opts.output ? path.resolve(args.opts.output) : null;
    if (planOut) fs.writeFileSync(planOut, `${JSON.stringify(r.plan, null, 2)}\n`);
    if (args.opts.html) { if (r.backend !== 'hyperframes') { process.stderr.write('--html só no backend hyperframes\n'); return EXIT.USAGE; } fs.writeFileSync(path.resolve(args.opts.html), generateHtml(r.plan)); }
    out(stream, args.json, planOut ? { status: 'PASS', backend: r.backend, plan: planOut, ...summary } : r.plan, planOut ? [`bold motion compile: plano → ${planOut}`, '→ PASS'] : [JSON.stringify(r.plan, null, 2)]);
    return EXIT.OK;
  }

  // inspect (HyperFrames): processos sim (lint, browser, snapshot), vídeo NÃO
  if (r.backend !== 'hyperframes') { process.stderr.write('bold motion inspect: só para decision.backend = "hyperframes"\n'); return EXIT.USAGE; }
  const { detectHF } = await import('../../hyperframes/adapter/browser.mjs');
  const { writeJob, lintJob, withJobPage, stillsJob } = await import('../../hyperframes/adapter/job.mjs');
  // R12.5C3b-B: HyperFrames GERENCIADO re-verificado (árvore + nativos/CDHash contra o lock) antes de CADA operação; Core intocado
  const { guardedDet, reverifyDet } = await import('../../setup/hf-guard.mjs');
  const refused = (e) => { out(stream, args.json, { status: 'FAIL', code: e.code, message: e.message }, [`bold motion inspect: ${e.message}`, '→ FAIL']); return EXIT.FAIL; };
  let det; try { det = guardedDet(detectHF()); } catch (e) { if (e.code === 'HF_MANAGED_INTEGRITY') return refused(e); throw e; }
  if (det.status !== 'AVAILABLE') { out(stream, args.json, { status: 'UNAVAILABLE', reason: det.reason }, [`bold motion inspect: HyperFrames indisponível — ${det.reason}`]); return EXIT.UNAVAILABLE; }
  const job = writeJob(r.plan, { projectDir: r.specDir });
  try {
    const t0 = Date.now(); const lint = lintJob(det, job); reverifyDet(det);
    // R12.5C3b-C: falha no launch do Core deixaria o servidor do job aberto (processo pendurado) → limpeza no BOLD
    const { withServerCleanup } = await import('../../core/render/server-cleanup.mjs');
    const page = await withServerCleanup(() => withJobPage(det, job, r.plan));
    let stills = [];
    if (args.opts.stills) {
      const times = String(args.opts.stills).split(',').map(Number); const dir = path.resolve(args.opts.output ?? `${r.plan.composition.id}_stills`);
      fs.mkdirSync(dir, { recursive: true });
      stills = stillsJob(det, job, times).map((s) => { const to = path.join(dir, s.name); fs.copyFileSync(s.path, to); return { file: to, sha256: s.sha256 }; });
    }
    const status = lint.status === 'PASS' && page.dynamic_font_gate.status === 'PASS' ? 'PASS' : 'FAIL';
    const payload = { status, ...summary, lint: { status: lint.status, errors: lint.errors, warnings: lint.warnings }, static_font_gate: job.static_font_gate.status, dynamic_font_gate: page.dynamic_font_gate, network_attempts: lint.net.length, layout: page.layout, stills, ms: Date.now() - t0 };
    out(stream, args.json, payload, [`bold motion inspect: ${path.basename(r.specPath)} (${summary.size}, ${summary.aspect})`, `  lint ${lint.status} (${lint.errors}/${lint.warnings}) · font gate estático ${job.static_font_gate.status} · dinâmico ${page.dynamic_font_gate.status} · rede ${lint.net.length}`,
      ...Object.entries(page.layout.layers).map(([id, L]) => `  ${id}: ${L.size_px.toFixed(1)} px · baseline ${L.lines[0].baseline.toFixed(1)} · tinta ${L.ink.left.toFixed(0)}..${L.ink.right.toFixed(0)} × ${L.ink.top.toFixed(0)}..${L.ink.bottom.toFixed(0)}`),
      ...stills.map((s) => `  still → ${s.file}`), `→ ${status}`]);
    return status === 'PASS' ? EXIT.OK : EXIT.FAIL;
  } catch (e) { if (e.code === 'HF_MANAGED_INTEGRITY') return refused(e); throw e; } finally { job.dispose(); }
}
