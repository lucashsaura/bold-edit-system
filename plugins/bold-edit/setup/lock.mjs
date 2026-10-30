// toolchain.lock.json (R12): leitura + validação.
// Um artefato só é INSTALÁVEL se estiver PINNED com url, sha256, tamanho, formato e — para HTTPS — host da URL na allowlist.
// R12.5 B3: o lock de confiança é SEMPRE este arquivo (setup/trust.mjs). Nenhuma variável de ambiente o substitui;
// URLs de loopback só com `allowLoopback` passado explicitamente por código (testes, via injeção em processo).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../core/schema/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LOCK_FILE = path.join(HERE, 'toolchain.lock.json');
const SCHEMA = path.join(HERE, 'schema', 'toolchain-lock.schema.json');
const LOOP = /^http:\/\/(127\.0\.0\.1|\[::1\])[:/]/;

/**
 * Regras de política que o JSON Schema não expressa (R12.5B — assinatura de código no macOS):
 *  - `codesign` só em plataformas macOS (Windows/Authenticode exige GATE separado);
 *  - binário macOS fixado com origem na internet (HTTPS) EXIGE `codesign` (REQUIRED com Team ID, ou PENDING_MEASUREMENT,
 *    que deixa o artefato NÃO instalável até a medição ser aprovada em GATE). Artefatos de teste (loopback) ficam fora;
 *  - REQUIRED: Team ID, autoridade, hardened_runtime e identidade de CADA bin declarado (nem mais, nem menos).
 */
/**
 * R12.5C1B: componentes que PODEM usar ADHOC_PINNED (allowlist no CÓDIGO, revisada em GATE). Node/FFmpeg nunca:
 * para eles a política é Developer ID (REQUIRED) e um lock que tente o contrário é inválido.
 */
export const ADHOC_PINNED_COMPONENTS = Object.freeze(['pillow']);

/** R12.5C3b-A: binários nativos npm fixados — allowlist no CÓDIGO por componente E plataforma (independente do ADHOC). */
export const NPM_NATIVE_PINNED_COMPONENTS = Object.freeze({ hyperframes: Object.freeze(['darwin-arm64']) });

export function lockPolicyErrors(data) {
  const errors = [];
  for (const [cid, c] of Object.entries(data?.components || {})) {
    for (const [pid, e] of Object.entries(c?.platforms || {})) {
      const at = `$.components.${cid}.platforms.${pid}`; const cs = e?.codesign;
      const parts = Array.isArray(e?.parts) ? e.parts : [e];
      const bins = parts.flatMap((p) => Object.keys(p?.bins || {}));
      if (cs && !pid.startsWith('darwin-')) { errors.push(`${at}.codesign: só para macOS (política do Windows exige GATE separado)`); continue; }
      const internet = parts.some((p) => /^https:\/\//.test(String(p?.url || '')));
      if (pid.startsWith('darwin-') && e?.status === 'PINNED' && e.kind !== 'npm' && bins.length && internet && !cs) errors.push(`${at}: binário macOS fixado sem política de assinatura (codesign)`);
      if (cs?.policy === 'REQUIRED') {
        for (const k of ['team_id', 'authority', 'hardened_runtime', 'bins']) if (cs[k] === undefined) errors.push(`${at}.codesign.${k}: obrigatório com policy REQUIRED`);
        const want = Object.keys(cs.bins || {}).sort();
        if (cs.bins && JSON.stringify(want) !== JSON.stringify([...bins].sort())) errors.push(`${at}.codesign.bins: deve listar exatamente os bins do artefato (${[...bins].sort().join(', ') || '-'})`);
      }
      // R12.5C3a: npm no macOS — binários nativos em node_modules exigem política; hoje só PENDING_MEASUREMENT (não instalável)
      if (pid.startsWith('darwin-') && e?.status === 'PINNED' && e.kind === 'npm') {
        if (!cs) errors.push(`${at}: pacote npm no macOS sem política para binários nativos (codesign PENDING_MEASUREMENT até medição + GATE)`);
        else if (!['PENDING_MEASUREMENT', 'NO_NATIVE', 'NPM_NATIVE_PINNED'].includes(cs.policy)) errors.push(`${at}.codesign: política ${cs.policy} não aprovada para npm (PENDING_MEASUREMENT, NO_NATIVE ou NPM_NATIVE_PINNED)`);
      }
      if (cs?.policy === 'NPM_NATIVE_PINNED') {
        if (!(NPM_NATIVE_PINNED_COMPONENTS[cid] || []).includes(pid)) errors.push(`${at}.codesign: NPM_NATIVE_PINNED não autorizado para ${cid}/${pid} (allowlist: hyperframes/darwin-arm64)`);
        if (e?.kind !== 'npm') errors.push(`${at}.codesign: NPM_NATIVE_PINNED só vale para npm`);
        for (const k of ['team_id', 'authority', 'hardened_runtime', 'bins', 'macho']) if (cs[k] !== undefined) errors.push(`${at}.codesign.${k}: não se aplica a NPM_NATIVE_PINNED`);
        if (!cs.approved) errors.push(`${at}.codesign.approved: obrigatório (referência do GATE)`);
        if (!cs.lockfile_sha256 || cs.lockfile_sha256 !== e?.npm?.lockfile_sha256) errors.push(`${at}.codesign.lockfile_sha256: deve ser o sha256 do package-lock.json aprovado (${e?.npm?.lockfile_sha256 ?? '-'})`);
        const nat = Object.entries(cs.native || {});
        if (!nat.length) errors.push(`${at}.codesign.native: obrigatório e não vazio`);
        for (const [p, v] of nat) { if (!p.startsWith(`node_modules/${v.package}/`)) errors.push(`${at}.codesign.native: ${p} fora do pacote ${v.package}`); if (p.split('/').some((x) => x === '..' || x === '.')) errors.push(`${at}.codesign.native: caminho inseguro ${p}`); }
      }
      // R12.5C3c-B: hash da árvore INSTALADA (medida e reproduzida) só faz sentido com os nativos aprovados (NPM_NATIVE_PINNED)
      if (e?.npm?.installed_tree_sha256 !== undefined && cs?.policy !== 'NPM_NATIVE_PINNED') errors.push(`${at}.npm.installed_tree_sha256: só com codesign NPM_NATIVE_PINNED (nativos medidos e aprovados)`);
      // NO_NATIVE: o conjunto npm declara ZERO Mach-O — o motor verifica (qualquer Mach-O → NPM_NATIVE_UNVERIFIED)
      if (cs?.policy === 'NO_NATIVE') {
        if (e?.kind !== 'npm') errors.push(`${at}.codesign: NO_NATIVE só vale para npm`);
        for (const k of ['team_id', 'bins', 'macho', 'approved']) if (cs[k] !== undefined) errors.push(`${at}.codesign.${k}: não se aplica a NO_NATIVE`);
      }
      if (cs?.policy === 'PENDING_MEASUREMENT' && (cs.team_id || cs.bins || cs.macho)) errors.push(`${at}.codesign: PENDING_MEASUREMENT não pode fixar team_id/bins/macho (medição pendente de GATE)`);
      if (cs?.policy === 'REQUIRED' && (cs.macho || cs.approved)) errors.push(`${at}.codesign: REQUIRED (Developer ID) não aceita macho/approved — sem mistura de políticas`);
      if (cs?.policy === 'ADHOC_PINNED') {
        if (!ADHOC_PINNED_COMPONENTS.includes(cid)) errors.push(`${at}.codesign: ADHOC_PINNED não autorizado para ${cid} (só ${ADHOC_PINNED_COMPONENTS.join(', ')}; Developer ID obrigatório)`);
        if (e.kind === 'npm') errors.push(`${at}.codesign: ADHOC_PINNED não vale para npm`);
        for (const k of ['team_id', 'authority', 'hardened_runtime', 'bins']) if (cs[k] !== undefined) errors.push(`${at}.codesign.${k}: não se aplica a ADHOC_PINNED`);
        if (!cs.approved) errors.push(`${at}.codesign.approved: obrigatório (referência do GATE que aprovou os CDHash)`);
        const m = Object.entries(cs.macho || {});
        if (!m.length) errors.push(`${at}.codesign.macho: obrigatório e não vazio (todo Mach-O do artefato com CDHash)`);
        if (m.length && !m.some(([, v]) => (v.phase ?? 'extract') === 'extract')) errors.push(`${at}.codesign.macho: nenhum Mach-O na fase extract (o executável precisa ser verificável antes do pós-instalação)`);
        for (const [k] of m) if (k.split('/').some((seg) => seg === '..' || seg === '.')) errors.push(`${at}.codesign.macho: caminho inseguro ${k}`);
      }
    }
  }
  return errors;
}

/** Valida um objeto de lock contra o schema + regras de política (sem tocar em disco). */
export function validateLockData(data) { const e = validate(JSON.parse(fs.readFileSync(SCHEMA, 'utf8')), data); return e.length ? e : lockPolicyErrors(data); }

export function loadLock(file = LOCK_FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateLockData(data);
  return { file, data, errors, valid: errors.length === 0 };
}

const HEX64 = /^[0-9a-f]{64}$/;
const completePart = (p) => HEX64.test(p?.sha256 || '') && Number.isInteger(p?.size) && p.size > 0 && typeof p.url === 'string'
  && (p.format === 'file' ? /^[A-Za-z0-9._+-]+$/.test(p.filename || '') : (['tar.gz', 'zip'].includes(p?.format) && p?.bins && Object.keys(p.bins).length > 0));
export const PACKAGE_ROOT = path.join(HERE, '..');
const fileSha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };

/** Entrada npm (R12.4): package.json + package-lock.json DO PACOTE, conferidos pelo sha256 do lock; registro fixo. */
function npmArtifact(base, e, packageRoot = PACKAGE_ROOT) {
  const n = e.npm || {};
  const pj = path.join(packageRoot, n.package_json || ''); const lf = path.join(packageRoot, n.lockfile || '');
  if (e.status !== 'PINNED' || !HEX64.test(n.package_json_sha256 || '') || !HEX64.test(n.lockfile_sha256 || '')) return { ...base, state: 'PENDING', reason: 'lockfile npm não fixado' };
  if (fileSha(pj) !== n.package_json_sha256 || fileSha(lf) !== n.lockfile_sha256) return { ...base, state: 'PENDING', reason: 'package.json/package-lock.json do setup ausentes ou divergentes do lock' };
  if (n.registry !== 'https://registry.npmjs.org/') return { ...base, state: 'PENDING', reason: 'registro npm não permitido' };
  return { ...base, state: 'PINNED', kind: 'npm', npm: { ...n, package_json_abs: pj, lockfile_abs: lf } };
}

/** Política de URL de UMA parte: loopback só em modo teste; senão HTTPS com host na allowlist do lock. Retorna null se ok. */
function urlProblem(url, hosts, allowLoopback) {
  if (LOOP.test(url)) return allowLoopback ? null : 'URL de loopback só vale em modo de teste';
  if (allowLoopback) return 'modo de teste: URL externa recusada';
  let host = null; try { const u = new URL(url); if (u.protocol === 'https:') host = u.hostname.toLowerCase(); } catch { /* inválida */ }
  if (!host) return 'URL não é HTTPS';
  if (!(hosts || []).includes(host)) return `host ${host} fora da allowlist do lock`;
  return null;
}

/**
 * Artefato do componente na plataforma: {state: PINNED|PENDING|NOT_PROVIDED|ABSENT, entry, parts, reason?}.
 * Componente COMPOSTO (R12.3): `entry.parts[]` — cada parte é validada individualmente (url/sha256/tamanho/formato/bins/host).
 * Componente simples: os campos ficam no próprio `entry` e viram uma parte única (`parts[0]`, id = componente, sem subpasta).
 */
export function artifactFor(lock, componentId, platformId, { allowLoopback = false, packageRoot } = {}) {
  const c = lock?.data?.components?.[componentId];
  if (!c) return { state: 'ABSENT', entry: null, version: null, parts: [] };
  const e = c.platforms?.[platformId];
  if (!e) return { state: 'ABSENT', entry: null, version: c.version, parts: [] };
  if (e.status === 'NOT_PROVIDED') return { state: 'NOT_PROVIDED', entry: e, version: c.version, parts: [] };
  if (e.kind === 'npm') {
    const n = npmArtifact({ entry: e, version: c.version, license: c.license, composite: false, parts: [] }, e, packageRoot);
    // R12.5C3a: binários nativos npm sem medição aprovada → NÃO instalável (o motor também recusa nativo não verificado)
    if (n.state === 'PINNED' && e.codesign?.policy === 'PENDING_MEASUREMENT') return { ...n, state: 'PENDING', codesign_pending: true, reason: 'CODESIGN_UNMEASURED: binários nativos do npm (node_modules) ainda não medidos/aprovados em GATE' };
    // R12.5C3b-A: aprovação dos nativos INVALIDADA se o lockfile ou a versão de um pacote aprovado mudou (sem fallback)
    if (n.state === 'PINNED' && e.codesign?.policy === 'NPM_NATIVE_PINNED') {
      const cs = e.codesign; const why = (r) => ({ ...n, state: 'PENDING', codesign_pending: true, reason: `CODESIGN_INVALIDATED: ${r} — nova medição + GATE` });
      if (!(NPM_NATIVE_PINNED_COMPONENTS[componentId] || []).includes(platformId)) return why('NPM_NATIVE_PINNED fora da allowlist');
      if (cs.lockfile_sha256 !== n.npm.lockfile_sha256 || fileSha(n.npm.lockfile_abs) !== cs.lockfile_sha256) return why('package-lock.json diverge do aprovado');
      let lf = null; try { lf = JSON.parse(fs.readFileSync(n.npm.lockfile_abs, 'utf8')); } catch { return why('package-lock.json ilegível'); }
      for (const v of Object.values(cs.native || {})) if (lf.packages?.[`node_modules/${v.package}`]?.version !== v.version) return why(`${v.package}@${v.version} não corresponde ao lockfile`);
      // R12.5C3c-B: sem o hash da árvore instalada aprovado, NÃO instalável (falha fechada; nativos aprovados não bastam)
      if (!HEX64.test(n.npm.installed_tree_sha256 || '')) return { ...n, state: 'PENDING', tree_pending: true, reason: 'INSTALLED_TREE_UNMEASURED: hash da árvore instalada não medido/aprovado (2 instalações independentes + GATE)' };
      return { ...n, codesign: cs };
    }
    return n;
  }
  const composite = Array.isArray(e.parts);
  const parts = composite
    ? e.parts.map((p) => ({ ...p, subdir: p.id }))
    : [{ id: componentId, artifact: e.artifact, url: e.url, sha256: e.sha256, size: e.size, format: e.format, strip_components: e.strip_components, installed_size: e.installed_size, bins: e.bins, subdir: null }];
  const base = { entry: e, version: c.version, license: c.license, composite, parts };
  if (e.status !== 'PINNED' || !parts.every(completePart)) return { ...base, state: 'PENDING', reason: 'artefato não fixado (url/sha256/tamanho/formato/bins)' };
  const ids = new Set(); const bins = new Set();
  for (const p of parts) {
    if (ids.has(p.id)) return { ...base, state: 'PENDING', reason: `parte duplicada: ${p.id}` };
    ids.add(p.id);
    for (const b of Object.keys(p.bins || {})) { if (bins.has(b)) return { ...base, state: 'PENDING', reason: `binário ${b} em mais de uma parte` }; bins.add(b); }
    const why = urlProblem(p.url, e.hosts, allowLoopback);
    if (why) return { ...base, state: 'PENDING', reason: composite ? `${p.id}: ${why}` : why };
  }
  // R12.5B: fixado, mas a assinatura de código ainda não foi medida/aprovada → NÃO instalável (falha fechada)
  if (e.codesign?.policy === 'PENDING_MEASUREMENT') return { ...base, state: 'PENDING', codesign_pending: true, reason: 'CODESIGN_UNMEASURED: assinatura de código desta plataforma ainda não medida/aprovada em GATE' };
  return { ...base, state: 'PINNED', codesign: ['REQUIRED', 'ADHOC_PINNED'].includes(e.codesign?.policy) ? e.codesign : null };
}
