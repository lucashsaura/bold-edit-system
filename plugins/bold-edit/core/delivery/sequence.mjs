// Sequências de imagens (padrão printf: frame_%06d.png). Contagem e continuidade verificadas ANTES do encode.

import fs from 'node:fs';
import path from 'node:path';

export function patternToRegex(base) {
  const m = base.match(/%(0?)(\d*)d/);
  if (!m) throw new Error(`padrão de sequência inválido (use %06d): ${base}`);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const [pre, post] = [base.slice(0, m.index), base.slice(m.index + m[0].length)];
  const digits = m[2] ? (m[1] ? `\\d{${m[2]}}` : `\\d{${m[2]},}`) : '\\d+';
  return new RegExp(`^${esc(pre)}(${digits})${esc(post)}$`);
}

export function framePath(pattern, n) {
  return pattern.replace(/%(0?)(\d*)d/, (_, z, w) => String(n).padStart(z ? Number(w) : 0, '0'));
}

/**
 * @returns {{pattern: string, dir: string, start: number, count: number, contiguous: boolean, first: number|null, last: number|null, missing: number[]}}
 */
export function resolveSequence(pattern, startNumber = null) {
  const dir = path.dirname(pattern);
  const re = patternToRegex(path.basename(pattern));
  if (!fs.existsSync(dir)) throw new Error(`diretório da sequência não existe: ${dir}`);
  const nums = fs.readdirSync(dir).map((f) => f.match(re)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
  if (!nums.length) return { pattern, dir, start: startNumber ?? 0, count: 0, contiguous: false, first: null, last: null, missing: [] };
  const start = startNumber ?? nums[0];
  const set = new Set(nums);
  let count = 0;
  while (set.has(start + count)) count++;
  const last = nums[nums.length - 1];
  const missing = [];
  for (let n = start; n <= last && missing.length < 20; n++) if (!set.has(n)) missing.push(n);
  return { pattern, dir, start, count, contiguous: missing.length === 0 && nums[0] === start, first: nums[0], last, missing };
}
