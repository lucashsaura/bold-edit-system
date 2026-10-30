// HYPERFRAMES ADAPTER — JOB (R6.1). Plano compilado → diretório de job TEMPORÁRIO (index.html gerado + fontes do
// manifesto por link, conferidas por sha256) → lint / layout+font gate dinâmico / stills PNG. Sem render de vídeo:
// o render (png-sequence) existe só em render.mjs, atrás do policy gate.
// Todo processo HyperFrames passa por run.mjs (opt-outs HF3, network guard, cache de fontes isolado por job).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { generateHtml } from '../src/html.mjs';
import { staticFontGate, dynamicFontGate, FontGateError } from './font-gate.mjs';
import { runHF } from './run.mjs';
import { launch } from './browser.mjs';

export class JobError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Cria o job: index.html + links para as fontes do manifesto (mesmos caminhos relativos). Gate estático aplicado. */
export function writeJob(plan, { projectDir, jobRoot = os.tmpdir() }) {
  const html = generateHtml(plan);
  const fonts = plan.fonts.map((f) => ({ ...f, abs: path.join(fs.realpathSync(projectDir), f.file) }));
  for (const f of fonts) if (!fs.existsSync(f.abs) || sha(fs.readFileSync(f.abs)) !== f.sha256) throw new FontGateError([`fonte do manifesto alterada ou ausente: ${f.file}`]);
  const gate = staticFontGate(html, fonts, { projectDir });
  if (gate.status !== 'PASS') throw new FontGateError(gate.errors);
  const dir = fs.mkdtempSync(path.join(jobRoot, 'bold-hf-job-'));
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  for (const f of fonts) { const to = path.join(dir, f.file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.symlinkSync(fs.realpathSync(f.abs), to); }
  const policy = { fontCacheDir: path.join(dir, '.font-cache'), netLog: path.join(dir, '.net.log'), procLog: path.join(dir, '.proc.log') };
  return { dir, html, html_sha256: sha(html), static_font_gate: gate, policy, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** `hyperframes lint` sob a política. 0 errors e 0 warnings, ou FAIL. */
export function lintJob(det, job) {
  const r = runHF(det, ['lint', '.'], { cwd: job.dir, ...job.policy });
  const m = (r.stdout + r.stderr).match(/(\d+) error\(?s?\)?,\s*(\d+) warning/);
  const errors = m ? Number(m[1]) : null; const warnings = m ? Number(m[2]) : null;
  return { status: r.status === 0 && errors === 0 && warnings === 0 && r.net.length === 0 ? 'PASS' : 'FAIL', errors, warnings, net: r.net, output: (r.stdout + r.stderr).slice(-1200) };
}

function serve(dir) {
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.otf': 'font/otf' };
  const srv = http.createServer((q, s) => {
    const rel = path.normalize(decodeURIComponent(new URL(q.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const f = path.join(dir, rel);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; }
    s.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(s);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ origin: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((c) => srv.close(c)) })));
}

/**
 * Abre o job no Chrome do HyperFrames (software GL), espera o runtime, devolve o LAYOUT resolvido (âncoras em frame
 * space) e o gate DINÂMICO de fontes. `fn(page)` opcional para medições extras (testes). Não gera vídeo.
 */
export async function withJobPage(det, job, plan, fn = null) {
  const srv = await serve(job.dir); const browser = await launch(det);
  try {
    const page = await browser.newPage(); const requests = []; page.on('request', (q) => requests.push(q.url()));
    await page.setViewport({ width: plan.composition.width, height: plan.composition.height, deviceScaleFactor: 1 });
    await page.goto(`${srv.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__bold && (window.__bold.layout || window.__bold.error)', { timeout: 20000 });
    const err = await page.evaluate(() => window.__bold.error);
    if (err) throw new JobError('RUNTIME_ERROR', err);
    const layout = await page.evaluate(() => window.__bold.layout);
    await page.evaluate((t) => window.__bold.seek(t), plan.composition.duration_s - 1 / plan.composition.fps);
    const fontGate = await dynamicFontGate(page, { requests });
    const extra = fn ? await fn(page) : null;
    return { layout, dynamic_font_gate: fontGate, requests, extra };
  } finally { await browser.close(); await srv.close(); }
}

/** Stills PNG pelo caminho de captura do PRÓPRIO HyperFrames (`snapshot`, HF10). Só PNG; nenhuma sequência de vídeo. */
export function stillsJob(det, job, times) {
  if (!Array.isArray(times) || !times.length || times.some((t) => !(typeof t === 'number' && t >= 0))) throw new JobError('STILLS_INVALID', 'times: lista de segundos ≥ 0');
  const r = runHF(det, ['snapshot', '.', '--at', times.join(','), '--no-end', '--no-browser-gpu', '--describe', 'false'], { cwd: job.dir, ...job.policy });
  if (r.status !== 0) throw new JobError('SNAPSHOT_FAILED', `exit ${r.status}`, (r.stdout + r.stderr).slice(-800));
  if (r.net.length) throw new JobError('NETWORK_ATTEMPT', r.net.map((n) => `${n.kind}→${n.target}`).join(', '));
  const dir = path.join(job.dir, 'snapshots');
  const files = fs.readdirSync(dir).filter((f) => /^frame-\d+-at-.*\.png$/.test(f)).sort();
  return files.map((f) => { const buf = fs.readFileSync(path.join(dir, f)); return { name: f, path: path.join(dir, f), sha256: sha(buf), png: buf }; });
}
