// Verificação de assinatura de código no macOS (R12.5B) — antes de QUALQUER execução ou ativação de binário gerenciado.
// Só /usr/bin/codesign por caminho ABSOLUTO (o PATH nunca é consultado), sem shell, com env mínimo e timeout. Offline:
// `--verify` e `--test-requirement` não consultam a rede (validado com a rede negada ao processo na R12.5B).
// Requisito: assinatura válida (--strict) + Developer ID ancorado na Apple + Team ID fixado no lock (+ identifier e
// hardened runtime). Não há variável de ambiente nem opção de CLI para pular; o verificador só é injetável pela API
// (testes/simulação), como o teste leve (`smoke`). Windows/Authenticode: fora (exige GATE separado).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CODESIGN = '/usr/bin/codesign';
export const AUTHORITY = 'Developer ID Application';
export const TEAM_RX = /^[A-Z0-9]{10}$/;
const MACHO = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/** Cabeçalho Mach-O (thin ou universal). Universal = CAFEBABE com 1..16 arquiteturas (classe Java tem a versão ali). */
export function isMachO(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(8); const n = fs.readSync(fd, b, 0, 8, 0); if (n < 4) return false;
      const m = b.readUInt32BE(0); if (!MACHO.has(m)) return false;
      if (m === 0xcafebabe || m === 0xbebafeca) { if (n < 8) return false; const k = m === 0xcafebabe ? b.readUInt32BE(4) : b.readUInt32LE(4); return k >= 1 && k <= 16; }
      return true;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/** Requisito de código: Developer ID (certificado intermediário + folha de aplicação da Apple) com Team ID fixo. */
export function developerIdRequirement(team) {
  if (!TEAM_RX.test(team || '')) throw new Error(`Team ID inválido: ${team}`);
  return `=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${team}"`;
}

/** Saída de `codesign -dv --verbose=4` (stderr) → campos usados na decisão. */
export function parseDisplay(text) {
  const s = String(text || '');
  const val = (k) => { const m = s.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : null; };
  const team = val('TeamIdentifier');
  const flags = (s.match(/^CodeDirectory .*flags=0x[0-9a-f]+\(([^)]*)\)/m) || [])[1] || '';
  return { identifier: val('Identifier'), team_id: team && team !== 'not set' ? team : null, authorities: [...s.matchAll(/^Authority=(.*)$/gm)].map((m) => m[1].trim()),
    runtime: /\bruntime\b/.test(flags), adhoc: /\badhoc\b/.test(flags) || /^Signature=adhoc$/m.test(s) };
}

const fail = (code, detail, extra = {}) => ({ ok: false, code, detail, ...extra });
const tidyErr = (r, file) => String(r.stderr || r.stdout || '').split(file).join(path.basename(file)).trim().split('\n')[0].slice(0, 200);

/**
 * Verifica UM binário contra a identidade esperada. Nunca executa o binário.
 * @param {string} file
 * @param {{team_id:string, identifier?:string, hardened_runtime?:boolean}} expect
 * @param {{run?:Function, platform?:string, codesign?:string}} [opt]  run = spawnSync (injetável só para testes)
 * @returns {{ok:true, team_id, identifier, runtime}|{ok:false, code:string, detail:string}}
 */
export function verifyBinary(file, expect, { run = spawnSync, platform = process.platform, codesign = CODESIGN } = {}) {
  if (platform !== 'darwin') return fail('CODESIGN_UNAVAILABLE', 'verificação de assinatura só existe no macOS');
  if (!expect || !TEAM_RX.test(expect.team_id || '')) return fail('CODESIGN_SPEC_INVALID', 'Team ID esperado ausente ou inválido');
  if (!fs.existsSync(codesign)) return fail('CODESIGN_UNAVAILABLE', `${codesign} ausente`);
  if (!isMachO(file)) return fail('CODESIGN_INVALID', 'não é um executável Mach-O');
  const opts = { encoding: 'utf8', timeout: 30000, shell: false, windowsHide: true, env: { PATH: '/usr/bin:/bin', LANG: 'C' } };
  const exec = (args) => { const r = run(codesign, args, opts); if (r.error || r.signal || r.status === null) return { unavailable: true, r }; return { r }; };
  let x = exec(['--verify', '--strict', '--verbose=1', file]);
  if (x.unavailable) return fail('CODESIGN_UNAVAILABLE', `codesign não executou (${x.r.error?.code || x.r.signal || 'timeout'})`);
  if (x.r.status !== 0) return fail('CODESIGN_INVALID', tidyErr(x.r, file) || `codesign --verify exit ${x.r.status}`);
  x = exec(['-dv', '--verbose=4', file]);
  if (x.unavailable) return fail('CODESIGN_UNAVAILABLE', 'codesign -dv não executou');
  const d = parseDisplay(`${x.r.stderr || ''}\n${x.r.stdout || ''}`);
  if (d.adhoc || !d.team_id) return fail('CODESIGN_TEAM_MISMATCH', `assinatura sem Team ID (${d.adhoc ? 'ad-hoc' : d.authorities[0] || 'desconhecida'}); esperado ${expect.team_id}`, { found: d });
  if (d.team_id !== expect.team_id) return fail('CODESIGN_TEAM_MISMATCH', `Team ID ${d.team_id}; esperado ${expect.team_id}`, { found: d });
  if (!String(d.authorities[0] || '').startsWith(`${AUTHORITY}:`)) return fail('CODESIGN_TEAM_MISMATCH', `autoridade "${d.authorities[0] || '?'}" não é ${AUTHORITY}`, { found: d });
  x = exec(['--verify', '--strict', `--test-requirement=${developerIdRequirement(expect.team_id)}`, file]);
  if (x.unavailable) return fail('CODESIGN_UNAVAILABLE', 'codesign --test-requirement não executou');
  if (x.r.status !== 0) return fail('CODESIGN_TEAM_MISMATCH', `requisito Developer ID/Team ID ${expect.team_id} não satisfeito`, { found: d });
  if (expect.identifier && d.identifier !== expect.identifier) return fail('CODESIGN_IDENTIFIER_MISMATCH', `identifier ${d.identifier}; esperado ${expect.identifier}`, { found: d });
  if (expect.hardened_runtime && !d.runtime) return fail('CODESIGN_RUNTIME_MISSING', 'hardened runtime ausente', { found: d });
  return { ok: true, team_id: d.team_id, identifier: d.identifier, runtime: d.runtime };
}

/**
 * Verifica TODOS os binários de um diretório contra a política (spec do lock ou registro gravado na instalação).
 * A política precisa cobrir exatamente os bins declarados — bin sem identidade esperada = falha (nunca "pula").
 * @param {string} dir  raiz da versão (staging ou instalada)
 * @param {Record<string,string>} bins  nome → caminho relativo
 * @param {{policy:'REQUIRED', team_id:string, hardened_runtime?:boolean, bins:Record<string,{identifier?:string}>}} spec
 * @returns {{ok:true, record:object}|{ok:false, code, detail, bin}}
 */
export function verifyTree(dir, bins, spec, { verifier = verifyBinary, now = new Date() } = {}) {
  if (spec?.policy !== 'REQUIRED') return { ok: false, code: 'CODESIGN_UNMEASURED', detail: 'política de assinatura não aprovada (PENDING_MEASUREMENT)' };
  const want = Object.keys(spec.bins || {}).sort(); const have = Object.keys(bins || {}).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) return { ok: false, code: 'CODESIGN_SPEC_INCOMPLETE', detail: `bins da política (${want.join(',') || '-'}) ≠ bins do artefato (${have.join(',') || '-'})` };
  const out = {};
  for (const b of have) {
    const r = verifier(path.join(dir, bins[b]), { team_id: spec.team_id, identifier: spec.bins[b].identifier, hardened_runtime: !!spec.hardened_runtime }, {});
    if (!r?.ok) return { ok: false, code: r?.code || 'CODESIGN_INVALID', detail: `${b}: ${r?.detail || 'falhou'}`, bin: b };
    out[b] = { identifier: spec.bins[b].identifier ?? r.identifier ?? null, path: bins[b] };
  }
  return { ok: true, record: { policy: 'REQUIRED', team_id: spec.team_id, authority: AUTHORITY, hardened_runtime: !!spec.hardened_runtime, bins: out, verified_at: now.toISOString() } };
}

/**
 * Linha de base (R12.5C0): binário Mach-O no macOS SEM política do lock precisa ao menos de assinatura VÁLIDA
 * (`codesign --verify --strict`) antes de ser executado. Script/não-Mach-O e outras plataformas: não se aplica.
 */
export function baselineValid(file, { run = spawnSync, platform = process.platform, codesign = CODESIGN } = {}) {
  if (platform !== 'darwin' || !isMachO(file)) return { ok: true, applies: false };
  if (!fs.existsSync(codesign)) return fail('CODESIGN_UNAVAILABLE', `${codesign} ausente`);
  const r = run(codesign, ['--verify', '--strict', file], { encoding: 'utf8', timeout: 30000, shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  if (r.error || r.signal || r.status === null) return fail('CODESIGN_UNAVAILABLE', 'codesign não executou');
  return r.status === 0 ? { ok: true, applies: true } : fail('CODESIGN_INVALID', tidyErr(r, file) || 'assinatura inválida');
}

// ───────────── R12.5C1B: política ADHOC_PINNED (Python auxiliar/Pillow) ─────────────
// Assinatura AD-HOC (sem Team ID) só é aceita quando o lock fixa, para CADA Mach-O do artefato, o CDHash (e o sha256 do
// arquivo) medido e aprovado em GATE. Inventário EXATO: Mach-O ausente, adicional, adulterado, sem assinatura, não ad-hoc
// ou com CDHash divergente → recusa. Não é fallback: entrada REQUIRED (Developer ID) nunca cai aqui, e vice-versa.
export const CDHASH_RX = /^[0-9a-f]{40}$/;

/** Mach-O de uma árvore (sem seguir symlinks), caminhos relativos com "/". */
export function machoFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const nm of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${nm}` : nm; const st = fs.lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) continue; if (st.isDirectory()) { walk(r); continue; }
      if (st.isFile() && isMachO(path.join(dir, r))) out.push(r);
    }
  };
  walk('');
  return out;
}

/** Inspeção ad-hoc de UM arquivo: --verify --strict + -dv (CDHash, flags, Team ID). Nunca executa o binário. */
export function inspectAdhoc(file, { run = spawnSync, codesign = CODESIGN } = {}) {
  if (!fs.existsSync(codesign)) return fail('CODESIGN_UNAVAILABLE', `${codesign} ausente`);
  const opts = { encoding: 'utf8', timeout: 30000, shell: false, windowsHide: true, env: { PATH: '/usr/bin:/bin', LANG: 'C' } };
  const v = run(codesign, ['--verify', '--strict', '--verbose=1', file], opts);
  if (v.error || v.signal || v.status === null) return fail('CODESIGN_UNAVAILABLE', 'codesign não executou');
  if (v.status !== 0) return fail('CODESIGN_INVALID', tidyErr(v, file) || 'assinatura inválida');
  const d = run(codesign, ['-dv', '--verbose=4', file], opts);
  if (d.error || d.signal || d.status === null) return fail('CODESIGN_UNAVAILABLE', 'codesign -dv não executou');
  const txt = `${d.stderr || ''}\n${d.stdout || ''}`; const info = parseDisplay(txt);
  const cdhash = (txt.match(/^CDHash=([0-9a-f]{40})$/m) || [])[1] || null;
  if (!info.adhoc || info.team_id) return fail('CODESIGN_NOT_ADHOC', `assinatura não é ad-hoc (${info.team_id ? `Team ID ${info.team_id}` : info.authorities[0] || 'desconhecida'})`, { found: info });
  if (!cdhash) return fail('CODESIGN_INVALID', 'CDHash ausente');
  return { ok: true, cdhash, identifier: info.identifier };
}

/** Resolve um bin declarado (pode ser symlink relativo DENTRO da árvore) até o arquivo real; null se sair da árvore. */
function resolveInTree(dir, rel) {
  let cur = rel;
  for (let i = 0; i < 8; i++) {
    let st; try { st = fs.lstatSync(path.join(dir, cur)); } catch { return null; }
    if (!st.isSymbolicLink()) return cur;
    const t = fs.readlinkSync(path.join(dir, cur)); if (path.isAbsolute(t)) return null;
    cur = path.posix.normalize(path.posix.join(path.posix.dirname(cur), t)); if (cur.startsWith('../') || cur === '..') return null;
  }
  return null;
}

/**
 * Verifica uma árvore contra a spec ADHOC_PINNED.
 * phase "extract": só os Mach-O presentes logo após a extração (antes do pós-instalação); "final": todos (antes da ativação,
 * verify, rollback). Cada bin declarado precisa resolver para um Mach-O fixado. Retorna {ok, record} ou {ok:false, code, detail}.
 * @param {{policy:'ADHOC_PINNED', approved:string, macho:Record<string,{cdhash:string, sha256?:string, phase?:string}>}} spec
 */
export function verifyAdhocTree(dir, bins, spec, { phase = 'final', inspect = inspectAdhoc, now = new Date() } = {}) {
  if (spec?.policy !== 'ADHOC_PINNED' || !spec.macho || !Object.keys(spec.macho).length) return { ok: false, code: 'CODESIGN_SPEC_INVALID', detail: 'spec ADHOC_PINNED sem Mach-O fixados' };
  const expected = Object.entries(spec.macho).filter(([, v]) => phase === 'final' || (v.phase ?? 'extract') === 'extract').map(([k]) => k).sort();
  const found = machoFiles(dir);
  const missing = expected.filter((k) => !found.includes(k)); const extra = found.filter((k) => !expected.includes(k));
  if (missing.length) return { ok: false, code: 'CODESIGN_ADHOC_MISSING', detail: `Mach-O fixado ausente: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3})` : ''}` };
  if (extra.length) return { ok: false, code: 'CODESIGN_ADHOC_UNEXPECTED', detail: `Mach-O NÃO autorizado: ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ` (+${extra.length - 3})` : ''}` };
  for (const [b, rel] of Object.entries(bins || {})) {
    const real = resolveInTree(dir, rel);
    if (!real || !(real in spec.macho)) return { ok: false, code: 'CODESIGN_SPEC_INCOMPLETE', detail: `bin ${b} (${rel}) não resolve para um Mach-O fixado`, bin: b };
    if (!expected.includes(real)) return { ok: false, code: 'CODESIGN_SPEC_INCOMPLETE', detail: `bin ${b} só existe depois do pós-instalação`, bin: b };
  }
  const out = {};
  for (const k of expected) {
    const want = spec.macho[k]; const abs = path.join(dir, k);
    if (want.sha256) { const h = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); if (h !== want.sha256) return { ok: false, code: 'CODESIGN_INVALID', detail: `${k}: sha256 do arquivo diverge do aprovado` }; }
    const r = inspect(abs);
    if (!r?.ok) return { ok: false, code: r?.code || 'CODESIGN_INVALID', detail: `${k}: ${r?.detail || 'falhou'}` };
    if (r.cdhash !== want.cdhash) return { ok: false, code: 'CODESIGN_CDHASH_MISMATCH', detail: `${k}: CDHash ${r.cdhash} ≠ aprovado ${want.cdhash}` };
    out[k] = { cdhash: r.cdhash, ...(want.sha256 ? { sha256: want.sha256 } : {}), ...(want.phase ? { phase: want.phase } : {}) };
  }
  return { ok: true, record: { policy: 'ADHOC_PINNED', approved: spec.approved, macho: phase === 'final' ? out : spec.macho, verified_at: now.toISOString() } };
}

// ───────────── R12.5C3b-A: política NPM_NATIVE_PINNED (binários nativos de pacotes npm) ─────────────
// Independente do ADHOC_PINNED do Pillow. Aprovação VINCULADA ao sha256 do package-lock.json; para CADA Mach-O de
// node_modules: caminho (dentro do pacote declarado), pacote, versão instalada, sha256 do arquivo, assinatura ad-hoc
// válida e CDHash. Inventário EXATO (ausente/adicional → recusa). Sem fallback para política menos rigorosa.
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/**
 * @param {string} dir  raiz do conjunto npm (contém package-lock.json e node_modules/)
 * @param {{policy:'NPM_NATIVE_PINNED', approved:string, lockfile_sha256:string, native:Record<string,{package:string, version:string, sha256:string, cdhash:string}>}} spec
 */
export function verifyNpmNativeTree(dir, spec, { inspect = inspectAdhoc, now = new Date() } = {}) {
  if (spec?.policy !== 'NPM_NATIVE_PINNED' || !spec.native || !Object.keys(spec.native).length || !/^[0-9a-f]{64}$/.test(spec.lockfile_sha256 || '')) return { ok: false, code: 'CODESIGN_SPEC_INVALID', detail: 'spec NPM_NATIVE_PINNED incompleta' };
  const lf = path.join(dir, 'package-lock.json');
  if (!fs.existsSync(lf) || sha256File(lf) !== spec.lockfile_sha256) return { ok: false, code: 'CODESIGN_NPM_LOCKFILE_MISMATCH', detail: 'package-lock.json diverge do aprovado (aprovação invalidada)' };
  const expected = Object.keys(spec.native).sort(); const found = machoFiles(dir);
  const missing = expected.filter((k) => !found.includes(k)); const extra = found.filter((k) => !expected.includes(k));
  if (missing.length) return { ok: false, code: 'CODESIGN_NPM_NATIVE_MISSING', detail: `binário nativo aprovado ausente: ${missing.join(', ')}` };
  if (extra.length) return { ok: false, code: 'CODESIGN_NPM_NATIVE_UNEXPECTED', detail: `binário nativo NÃO aprovado: ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ` (+${extra.length - 3})` : ''}` };
  const out = {};
  for (const k of expected) {
    const w = spec.native[k];
    if (!k.startsWith(`node_modules/${w.package}/`)) return { ok: false, code: 'CODESIGN_NPM_NATIVE_PATH', detail: `${k} fora do pacote ${w.package}` };
    let v = null; try { v = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', w.package, 'package.json'), 'utf8')).version; } catch { v = null; }
    if (v !== w.version) return { ok: false, code: 'CODESIGN_NPM_NATIVE_VERSION', detail: `${w.package}: versão instalada ${v ?? 'ausente'} ≠ aprovada ${w.version}` };
    if (sha256File(path.join(dir, k)) !== w.sha256) return { ok: false, code: 'CODESIGN_INVALID', detail: `${k}: sha256 do arquivo diverge do aprovado` };
    const r = inspect(path.join(dir, k));
    if (!r?.ok) return { ok: false, code: r?.code || 'CODESIGN_INVALID', detail: `${k}: ${r?.detail || 'falhou'}` };
    if (r.cdhash !== w.cdhash) return { ok: false, code: 'CODESIGN_CDHASH_MISMATCH', detail: `${k}: CDHash ${r.cdhash} ≠ aprovado ${w.cdhash}` };
    out[k] = { package: w.package, version: w.version, sha256: w.sha256, cdhash: r.cdhash };
  }
  return { ok: true, record: { policy: 'NPM_NATIVE_PINNED', approved: spec.approved, lockfile_sha256: spec.lockfile_sha256, native: out, verified_at: now.toISOString() } };
}

/** Despacho por política (sem fallback): REQUIRED → Developer ID; ADHOC_PINNED → CDHash fixado. */
export function verifyByPolicy(dir, bins, spec, { phase = 'final', verifier, inspect, now } = {}) {
  if (spec?.policy === 'REQUIRED') return verifyTree(dir, bins, spec, { verifier, now });
  if (spec?.policy === 'ADHOC_PINNED') return verifyAdhocTree(dir, bins, spec, { phase, inspect, now });
  if (spec?.policy === 'NPM_NATIVE_PINNED') return verifyNpmNativeTree(dir, spec, { inspect, now });
  return { ok: false, code: 'CODESIGN_UNMEASURED', detail: `política ${spec?.policy ?? 'ausente'} não instalável` };
}

/**
 * Classificação somente leitura de UM Mach-O (R12.5C3a): validade da assinatura, classe, Team ID e CDHash.
 * Nunca executa o binário. Classes: DEVELOPER_ID · APPLE · ADHOC · UNSIGNED · INVALID · OTHER · UNAVAILABLE.
 */
export function classifyMacho(file, { run = spawnSync, codesign = CODESIGN } = {}) {
  if (!fs.existsSync(codesign)) return { class: 'UNAVAILABLE', verify_ok: false };
  const opts = { encoding: 'utf8', timeout: 30000, shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C' } };
  const v = run(codesign, ['--verify', '--strict', '--verbose=1', file], opts);
  if (v.error || v.signal || v.status === null) return { class: 'UNAVAILABLE', verify_ok: false };
  if (/not signed at all/.test(String(v.stderr || ''))) return { class: 'UNSIGNED', verify_ok: false };
  const d = run(codesign, ['-dv', '--verbose=4', file], opts); const txt = `${d.stderr || ''}\n${d.stdout || ''}`; const i = parseDisplay(txt);
  const cdhash = (txt.match(/^CDHash=([0-9a-f]{40})$/m) || [])[1] || null; const a = i.authorities[0] || null;
  const cls = v.status !== 0 ? 'INVALID' : i.adhoc ? 'ADHOC' : a?.startsWith(`${AUTHORITY}:`) && i.team_id ? 'DEVELOPER_ID' : a === 'Software Signing' ? 'APPLE' : 'OTHER';
  return { class: cls, verify_ok: v.status === 0, team_id: i.team_id, identifier: i.identifier, cdhash, runtime: i.runtime };
}

/** Rótulo curto da política/identidade (exibição e log): Team ID ou "ad-hoc N CDHash". */
export const signatureLabel = (rec) => (!rec ? null : rec.policy === 'ADHOC_PINNED' ? `ad-hoc ${Object.keys(rec.macho || {}).length} CDHash` : rec.policy === 'NPM_NATIVE_PINNED' ? `npm nativo ${Object.keys(rec.native || {}).length} CDHash` : rec.team_id ?? null);

/** Registro gravado (receipt/active) → spec equivalente, para re-verificação (verify/rollback). */
export function specFromRecord(rec) {
  if (rec?.policy === 'ADHOC_PINNED') return { policy: 'ADHOC_PINNED', approved: rec.approved, macho: rec.macho };
  if (rec?.policy === 'NPM_NATIVE_PINNED') return { policy: 'NPM_NATIVE_PINNED', approved: rec.approved, lockfile_sha256: rec.lockfile_sha256, native: rec.native };
  return rec && rec.policy === 'REQUIRED' ? { policy: 'REQUIRED', team_id: rec.team_id, hardened_runtime: !!rec.hardened_runtime, bins: Object.fromEntries(Object.entries(rec.bins || {}).map(([b, v]) => [b, { identifier: v.identifier ?? undefined }])) } : null;
}

/** O registro gravado atende à spec do lock (mesma política e identidade)? */
export function recordMatches(rec, spec) {
  if (rec?.policy === 'NPM_NATIVE_PINNED' || spec?.policy === 'NPM_NATIVE_PINNED') {
    if (rec?.policy !== spec?.policy || rec.approved !== spec.approved || rec.lockfile_sha256 !== spec.lockfile_sha256) return false;
    const a = Object.keys(rec.native || {}).sort(); const b = Object.keys(spec.native || {}).sort();
    return JSON.stringify(a) === JSON.stringify(b) && b.every((k) => rec.native[k].cdhash === spec.native[k].cdhash && rec.native[k].sha256 === spec.native[k].sha256);
  }
  if (rec?.policy === 'ADHOC_PINNED' || spec?.policy === 'ADHOC_PINNED') {
    if (rec?.policy !== spec?.policy || rec.approved !== spec.approved) return false;
    const a = Object.keys(rec.macho || {}).sort(); const b = Object.keys(spec.macho || {}).sort();
    return JSON.stringify(a) === JSON.stringify(b) && b.every((k) => rec.macho[k].cdhash === spec.macho[k].cdhash);
  }
  if (!rec || !spec || spec.policy !== 'REQUIRED' || rec.team_id !== spec.team_id || !!rec.hardened_runtime !== !!spec.hardened_runtime) return false;
  const a = Object.keys(rec.bins || {}).sort(); const b = Object.keys(spec.bins || {}).sort();
  return JSON.stringify(a) === JSON.stringify(b) && b.every((k) => (spec.bins[k].identifier ?? null) === (rec.bins[k].identifier ?? null));
}

/** Instalação ANTERIOR à política (R12.5B): macOS, origem HTTPS e sem registro de assinatura. */
export const legacyUnverified = (entry) => !!entry && String(entry.platform || '').startsWith('darwin-') && !entry.codesign && /^https:\/\//.test(String(entry.artifact?.source || ''));
