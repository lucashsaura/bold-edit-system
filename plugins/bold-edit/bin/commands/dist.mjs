// `bold dist build | audit | compare` (R11). Local: nada é publicado, nenhum remote é criado.
import fs from 'node:fs';
import path from 'node:path';
import { build, audit, compare, plan, DistError, ROOT } from '../../install/dist-build.mjs';
import { EXIT } from './media.mjs';

const USAGE = `uso: bold dist <comando> [--json]
  build [--output DIR] [--ref REF]   distribuição só INCLUDE a partir do commit REF (padrão HEAD) → DIR (padrão dist/bold-edit)
  audit [DIR]                        lock ↔ disco, classes, caminhos proibidos, leak scan (com a denylist local do repo de desenvolvimento)
  compare DIR_A DIR_B                reprodutibilidade byte a byte
  plan [--ref REF]                   contagem por classe (sem escrever)`;

export async function cmdDist(args, loaded, stream = process.stdout) {
  const o = args.opts; const op = args._[1];
  if (!op) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const out = (payload, lines) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
  try {
    if (op === 'plan') { const p = plan(o.ref ?? 'HEAD'); out({ commit: p.commit, total: p.total, counts: p.counts, include: p.include.length }, [`commit ${p.commit.slice(0, 12)} · ${p.total} versionados · ${JSON.stringify(p.counts)}`]); return EXIT.OK; }
    if (op === 'build') {
      const dir = path.resolve(o.output ?? path.join(ROOT, 'dist', 'bold-edit'));
      const lock = build(dir, { ref: o.ref ?? 'HEAD' });
      out({ ok: true, output: dir, version: lock.version, commit: lock.source.commit, files: lock.totals.files, bytes: lock.totals.bytes, content_sha256: lock.content_sha256 },
        [`dist → ${dir}`, `  ${lock.product} ${lock.version} · commit ${lock.source.commit.slice(0, 12)} · ${lock.totals.files} arquivos · ${(lock.totals.bytes / 1024).toFixed(0)} KiB`, `  content_sha256 ${lock.content_sha256}`]);
      return EXIT.OK;
    }
    if (op === 'audit') {
      const dir = path.resolve(args._[2] ?? path.join(ROOT, 'dist', 'bold-edit'));
      const r = audit(dir);
      out(r, [`audit ${dir}: ${r.status} · ${r.files} arquivos · leak ${r.leak.status} (${r.leak.files_scanned} varridos, denylist local: ${r.leak.local_terms} termos)`, `  lock sha256 ${r.lock_sha256}`, ...r.issues.slice(0, 40).map((i) => `  ${i.code} ${i.path ?? ''} ${i.rule ?? ''}`)]);
      return r.status === 'PASS' ? EXIT.OK : EXIT.FAIL;
    }
    if (op === 'compare') {
      const [a, b] = args._.slice(2); if (!a || !b || !fs.existsSync(a) || !fs.existsSync(b)) { process.stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
      const r = compare(path.resolve(a), path.resolve(b));
      out(r, [`compare: ${r.identical ? 'BYTE-IDENTICAL' : 'DIFERENTE'} · ${r.files} arquivos`, ...r.diffs.slice(0, 20).map((d) => `  ${d.code} ${d.path ?? ''}`)]);
      return r.identical ? EXIT.OK : EXIT.FAIL;
    }
    process.stderr.write(`${USAGE}\n`); return EXIT.USAGE;
  } catch (e) {
    if (e instanceof DistError) { out({ ok: false, error: { code: e.code, message: e.message, details: e.details } }, [`bold dist ${op}: ${e.message}`, ...(e.details ? [JSON.stringify(e.details).slice(0, 1500)] : [])]); return e.code === 'OUT_NOT_EMPTY' ? EXIT.STOP : EXIT.FAIL; }
    throw e;
  }
}
