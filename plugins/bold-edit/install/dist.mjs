// Classificação da distribuição (R10; consumida pelo build limpo da R11). Glob mínimo: **, *, {a,b}. Primeira regra vence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function globToRegExp(glob) {
  let re = ''; let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 3 : 2; continue; }
    if (c === '*') { re += '[^/]*'; i++; continue; }
    if (c === '{') { const j = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, j).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = j + 1; continue; }
    re += /[.+^$()|[\]\\?]/.test(c) ? `\\${c}` : c; i++;
  }
  return new RegExp(`^${re}$`);
}

export function loadDistribution(root = ROOT) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'distribution-manifest.json'), 'utf8'));
  return { ...m, compiled: m.rules.map((r) => ({ ...r, re: globToRegExp(r.pattern) })) };
}

/** → {class, rule} da primeira regra que casa, ou {class: null}. */
export function classifyPath(rel, dist) {
  const p = rel.split(path.sep).join('/');
  for (const r of dist.compiled) if (r.re.test(p)) return { class: r.class, rule: r.pattern };
  return { class: null, rule: null };
}
