// LEAK SCANNER — impede que dados de cliente, paths pessoais, segredos e binários proibidos
// entrem na distribuição. Retorna FAIL em qualquer achado.
//
// Fontes de regras:
//   1. core/leak/generic.denylist.json  (versionada, sem nomes de cliente)
//   2. denylists LOCAIS (fora do git): tests/leak-scan.local.denylist, $BOLD_LEAK_LOCAL_DENYLIST
//   3. core/leak/allowlist.json         (exceções revisadas, por caminho + regra)
//
// Quais arquivos: num repositório git, os arquivos que SERIAM versionados
// (git ls-files --cached --others --exclude-standard). Fora de git: varredura do diretório,
// ignorando .git e node_modules.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_HOME = path.resolve(HERE, '..', '..');
export const GENERIC_DENYLIST = path.join(HERE, 'generic.denylist.json');
export const ALLOWLIST = path.join(HERE, 'allowlist.json');
export const DEFAULT_LOCAL_DENYLIST = path.join(SKILL_HOME, 'tests', 'leak-scan.local.denylist');

const strip = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
const isUpper = (c) => !!c && c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = (c) => !!c && c !== c.toUpperCase() && c === c.toLowerCase();
const isAlnum = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Lê denylist local: um termo por linha; '#' comenta; 're:' prefixa regex. */
export function parseLocalDenylist(text) {
  const terms = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('re:')) terms.push({ kind: 'regex', source: line.slice(3), re: new RegExp(line.slice(3), 'giu') });
    else terms.push({ kind: 'term', source: line, needle: strip(line).toLowerCase() });
  }
  return terms;
}

/**
 * Casa um termo com fronteira de palavra tolerante a camelCase/snake_case:
 * "TermoX" e "termo_x" casam; "termoxyz" (continuação minúscula) não casa.
 */
export function findTerm(line, needle) {
  const hay = strip(line);
  const low = hay.toLowerCase();
  const hits = [];
  let from = 0;
  for (;;) {
    const i = low.indexOf(needle, from);
    if (i < 0) break;
    const prev = hay[i - 1];
    const first = hay[i];
    const last = hay[i + needle.length - 1];
    const next = hay[i + needle.length];
    const prevOk = !isAlnum(prev) || (isLower(prev) && isUpper(first));
    const nextOk = !isAlnum(next) || (isUpper(next) && isLower(last));
    if (prevOk && nextOk) hits.push(i);
    from = i + 1;
  }
  return hits;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function listFiles(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.resolve(top) === path.resolve(root)) {
      const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      return { method: 'git', files: out.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f))) };
    }
  } catch { /* não é repositório git */ }
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) files.push(path.relative(root, abs));
    }
  };
  walk(root);
  return { method: 'walk', files };
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * @param {string} root diretório a auditar
 * @param {{localDenylists?: string[], extraTerms?: string[], env?: object}} [opts]
 */
export function scanLeaks(root, opts = {}) {
  const env = opts.env || process.env;
  const absRoot = path.resolve(root);
  const generic = readJson(GENERIC_DENYLIST);
  const allow = fs.existsSync(ALLOWLIST) ? readJson(ALLOWLIST).entries || [] : [];
  const patterns = generic.patterns.map((p) => ({ ...p, re: new RegExp(p.regex, p.flags.includes('g') ? p.flags : `${p.flags}g`) }));
  const extToRule = new Map();
  for (const [group, exts] of Object.entries(generic.forbidden_extensions)) for (const e of exts) extToRule.set(e, group);

  const localFiles = opts.localDenylists
    ?? [DEFAULT_LOCAL_DENYLIST, env.BOLD_LEAK_LOCAL_DENYLIST].filter(Boolean);
  const localTerms = [];
  const localLoaded = [];
  for (const f of localFiles) {
    if (f && fs.existsSync(f)) { localTerms.push(...parseLocalDenylist(fs.readFileSync(f, 'utf8'))); localLoaded.push(f); }
  }
  for (const t of opts.extraTerms || []) localTerms.push(...parseLocalDenylist(t));

  // Os próprios arquivos de regras nunca são varridos.
  const skipAbs = new Set([GENERIC_DENYLIST, ALLOWLIST, DEFAULT_LOCAL_DENYLIST, ...localFiles.filter(Boolean)].map((f) => path.resolve(f)));
  // R10: também os arquivos de regras de QUALQUER cópia do pacote auditada (ex.: a distribuição), pelo caminho relativo.
  const skipRel = new Set(['core/leak/generic.denylist.json', 'core/leak/allowlist.json']);
  const allowed = (rel, rule) => allow.some((a) => a.path === rel && (a.rule === rule || a.rule === '*'));

  const { method, files } = listFiles(absRoot);
  const findings = [];
  const add = (f) => { if (!allowed(f.file, f.rule)) findings.push(f); };
  let scanned = 0;

  for (const rel of files) {
    const abs = path.join(absRoot, rel);
    const relPosix = rel.split(path.sep).join('/');
    if (skipAbs.has(path.resolve(abs)) || skipRel.has(relPosix)) continue;
    scanned++;

    // Estrutura: nenhum arquivo dentro de diretórios proibidos.
    const segs = relPosix.split('/').slice(0, -1);
    for (const fd of generic.forbidden_dirs) {
      const fdSegs = fd.split('/');
      for (let i = 0; i + fdSegs.length <= segs.length; i++) {
        if (fdSegs.every((s, j) => segs[i + j] === s)) { add({ file: relPosix, line: null, kind: 'structure', rule: `forbidden-dir:${fd}`, match: fd }); break; }
      }
    }
    // Extensão proibida.
    const ext = path.extname(relPosix).toLowerCase();
    if (extToRule.has(ext)) add({ file: relPosix, line: null, kind: 'extension', rule: `forbidden-ext:${extToRule.get(ext)}`, match: ext });

    // Nome do arquivo/caminho contra termos locais e padrões.
    for (const t of localTerms) {
      const hit = t.kind === 'term' ? findTerm(relPosix, t.needle).length > 0 : new RegExp(t.re.source, 'iu').test(relPosix);
      if (hit) add({ file: relPosix, line: null, kind: 'filename', rule: 'local-term', match: t.source });
    }

    // Conteúdo.
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.length > generic.max_content_bytes || isBinary(buf)) continue;
    const lines = buf.toString('utf8').normalize('NFC').split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const p of patterns) {
        p.re.lastIndex = 0;
        const m = p.re.exec(line);
        if (m) add({ file: relPosix, line: idx + 1, kind: 'pattern', rule: p.id, match: m[0] });
      }
      for (const t of localTerms) {
        if (t.kind === 'term') {
          if (findTerm(line, t.needle).length) add({ file: relPosix, line: idx + 1, kind: 'local-term', rule: 'local-term', match: t.source });
        } else {
          t.re.lastIndex = 0;
          const m = t.re.exec(strip(line));
          if (m) add({ file: relPosix, line: idx + 1, kind: 'local-term', rule: 'local-regex', match: m[0] });
        }
      }
    });
  }

  return {
    status: findings.length ? 'FAIL' : 'PASS',
    root: absRoot,
    method,
    files_scanned: scanned,
    local_denylists_loaded: localLoaded.length,
    local_terms: localTerms.length,
    findings,
  };
}
