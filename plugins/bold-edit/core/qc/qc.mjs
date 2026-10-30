// `bold qc file` e `bold qc alpha` — MACHINE QC.
// O resultado nunca afirma que a composição visual está correta: `visual_qc` fica PENDING para revisão humana.

import { probeFile, countFrames } from '../delivery/ffprobe.mjs';
import { validateMedia, summarize } from '../delivery/validate.mjs';
import { decodeFramesRGBA, sampleIndices } from './frames.mjs';
import { alphaStats, edgeAnalysis, edgeVerdict } from './alpha.mjs';

const VISUAL_PENDING = {
  status: 'PENDING',
  note: 'MACHINE QC não avalia composição, timing, legibilidade nem halo sobre o fundo real. Revisão humana necessária (qc-methods.md níveis 3–4).',
};

function c(id, status, expected, actual, message) { return { id, status, expected: expected ?? null, actual: actual ?? null, message }; }

export function qcFile({ tools, file, profile = null, expectedFrames = null, fps = null, width = null, height = null }) {
  let meta;
  try { meta = probeFile(tools.ffprobe, file); } catch (e) {
    const checks = [c(e.code === 'ENOENT' ? 'file.exists' : 'ffprobe', 'FAIL', 'ok', e.message, e.message)];
    return { kind: 'file', file, meta: null, machine_qc: { ...summarize(checks), checks }, visual_qc: VISUAL_PENDING };
  }
  meta.nb_frames_counted = countFrames(tools.ffprobe, file);
  const v = validateMedia(meta, { profile, expectedFrames, fps, width, height });
  const checks = [c('file.exists', 'PASS', true, true, 'arquivo existe'), c('ffprobe', 'PASS', 'ok', 'ok', 'ffprobe leu o arquivo'), ...v.checks];
  if (meta.nb_frames_counted == null) checks.push(c('frames.counted', 'FAIL', 'contagem', null, 'não foi possível contar frames reais'));
  else checks.push(c('frames.counted', 'PASS', null, meta.nb_frames_counted, 'frames reais contados'));
  return { kind: 'file', file, meta, machine_qc: { ...summarize(checks), checks }, visual_qc: VISUAL_PENDING };
}

export function qcAlpha({ tools, file, profile = null, expectedFrames = null, fps = null, width = null, height = null, expectEmptyEnds = false, samples = 5 }) {
  const base = qcFile({ tools, file, profile, expectedFrames, fps, width, height });
  base.kind = 'alpha';
  if (!base.meta) return base;
  const checks = [...base.machine_qc.checks];
  const v = base.meta.video;
  if (!v || !v.alpha_capable) {
    checks.push(c('alpha.present', 'FAIL', true, v ? v.pix_fmt : null, 'pixel format sem canal alpha'));
    return { ...base, machine_qc: { ...summarize(checks), checks } };
  }
  checks.push(c('alpha.present', 'PASS', true, v.pix_fmt, 'pixel format com alpha'));

  const total = base.meta.nb_frames_counted ?? base.meta.video.nb_frames_header ?? 0;
  const idx = sampleIndices(total, samples);
  const frames = decodeFramesRGBA({ ffmpeg: tools.ffmpeg, file, indices: idx, width: v.width, height: v.height,
    matrix: v.color_space === 'unknown' ? 'bt709' : v.color_space, range: v.color_range });
  const per = frames.map((buf, k) => ({ frame: idx[k], ...alphaStats(buf, v.width, v.height), edges: edgeAnalysis(buf, v.width, v.height) }));
  if (per.length !== idx.length) checks.push(c('alpha.decode', 'FAIL', idx.length, per.length, 'falha ao decodificar frames amostrados'));

  const anyTransparency = per.some((f) => f.alpha0 > 0 || f.partial > 0);
  checks.push(c('alpha.transparency', anyTransparency ? 'PASS' : 'FAIL', 'pixels com α<255', anyTransparency,
    anyTransparency ? 'há transparência nos frames amostrados' : 'alpha TOTALMENTE OPACO: o overlay não tem transparência'));
  checks.push(c('alpha.pixel_sum', per.every((f) => f.sum_ok) ? 'PASS' : 'FAIL', 'α0+α255+parcial = W×H', per.map((f) => f.sum_ok), 'contagem de pixels por frame'));
  const partial = per.reduce((s, f) => s + f.partial, 0);
  checks.push(c('alpha.partial', partial > 0 ? 'PASS' : 'WARNING', '>0', partial,
    partial > 0 ? 'há alpha parcial (bordas suaves/sombras)' : 'sem alpha parcial: bordas duras ou alpha binário (conferir antialiasing)'));

  const cornerAlpha = per.flatMap((f) => f.corners.map((k) => k.rgba[3]));
  checks.push(c('alpha.corners', cornerAlpha.every((a) => a === 0) ? 'PASS' : 'WARNING', 'α=0 nos 4 cantos', cornerAlpha,
    cornerAlpha.every((a) => a === 0) ? 'cantos transparentes' : 'cantos não transparentes (design de tela cheia?)'));

  const first = per.find((f) => f.frame === 0); const last = per.find((f) => f.frame === total - 1);
  for (const [id, f, label] of [['alpha.first_frame', first, 'primeiro'], ['alpha.last_frame', last, 'último']]) {
    if (!f) continue;
    const st = f.empty ? 'PASS' : expectEmptyEnds ? 'FAIL' : 'PASS';
    checks.push(c(id, st, expectEmptyEnds ? 'vazio' : 'informativo', f.empty ? 'vazio' : 'com conteúdo', `${label} frame ${f.empty ? 'inteiramente transparente' : 'tem conteúdo'}`));
  }

  // Borda / halo (agregado dos frames amostrados)
  const agg = per.reduce((a, f) => {
    if (!f.edges.sampled) return a;
    a.sampled += f.edges.sampled; a.sd += f.edges.straight_dev_mean * f.edges.sampled; a.pd += f.edges.premult_dev_mean * f.edges.sampled;
    return a;
  }, { sampled: 0, sd: 0, pd: 0 });
  const edges = { sampled: agg.sampled, straight_dev_mean: agg.sampled ? Number((agg.sd / agg.sampled).toFixed(2)) : null, premult_dev_mean: agg.sampled ? Number((agg.pd / agg.sampled).toFixed(2)) : null };
  const verdict = edgeVerdict(edges);
  checks.push(c('alpha.edges', verdict.status, 'bordas straight sem contaminação', { ...edges, code: verdict.code }, verdict.message));

  return { ...base, frames_analyzed: per.map(({ corners, ...rest }) => rest), machine_qc: { ...summarize(checks), checks } };
}
