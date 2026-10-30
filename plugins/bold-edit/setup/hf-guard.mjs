// Portão de EXECUÇÃO do HyperFrames GERENCIADO (R12.5C3b-B) — imediatamente antes de cada operação (lint, snapshot,
// render, página), no BOLD, SEM modificar o HyperFrames Core congelado (o Core recebe o `det` já verificado).
// Não depende do verify/doctor/instalação anteriores: a cada operação refaz (1) o hash de árvore completo da versão
// ativa contra o recibo e (2) o inventário completo dos Mach-O nativos, com sha256, assinatura ad-hoc válida e CDHash,
// contra a spec NPM_NATIVE_PINNED do LOCK (fora do toolchain; o registro gravado na ativação precisa coincidir com ela —
// active.json/receipt.json forjados junto com os binários não bastam) e (3, R12.5C3c-B) o hash da árvore contra o
// `installed_tree_sha256` do LOCK, na versão do lock. Divergência → HF_MANAGED_INTEGRITY (nada executa).
// Lock sem NPM_NATIVE_PINNED para a plataforma → NENHUM Mach-O admitido (mesmo que o registro diga o contrário).
// HyperFrames NÃO gerenciado (cache do npx, caminho do usuário): não é tocado (managed:false) — comportamento anterior.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolchainRoot } from '../core/config/paths.mjs';
import { readActive, readReceipt, treeHash, SetupError } from './engine.mjs';
import { verifyNpmNativeTree, recordMatches, machoFiles } from './codesign.mjs';
import { trustedLock } from './trust.mjs';

const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/**
 * @param {{nm?:string}} det  resultado do detectHF do Core
 * @returns {{managed:false}|{managed:true, ok:true, dir:string, natives:number, policy:string|null}}
 * @throws SetupError HF_MANAGED_INTEGRITY
 */
export function guardManagedHyperFrames(det, { env = process.env, platform = process.platform, home = os.homedir(), inspect, lock } = {}) {
  if (!det?.nm) return { managed: false };
  const root = toolchainRoot({ platform, env, home }); const rootReal = real(root); const detNm = real(det.nm) ?? path.resolve(det.nm);
  // dentro da raiz do toolchain = território gerenciado: só a versão ATIVA e íntegra passa (anterior/órfã/ilegível → recusa)
  const inside = !!rootReal && (detNm === rootReal || detNm.startsWith(rootReal + path.sep));
  const fail = (detail, dir = null) => { throw new SetupError('HF_MANAGED_INTEGRITY', `HyperFrames gerenciado recusado: ${detail} — nada foi executado; rode \`bold setup verify\` e reinstale`, { dir }); };
  let active = null; try { active = rootReal ? readActive(root) : null; } catch (e) { if (inside) fail(`active.json ilegível (${e.code ?? e.message})`); return { managed: false }; }
  const t = active?.tools?.hyperframes;
  const managedNm = t ? real(path.join(root, t.dir, t.paths?.['hyperframes-node-modules'] ?? 'node_modules')) : null;
  if (!managedNm || detNm !== managedNm) {
    if (inside) fail('node_modules dentro do toolchain que não é o da versão ativa verificada');
    return { managed: false };   // outro HyperFrames (npx/usuário), fora do toolchain: este portão não interfere
  }
  const dir = path.join(root, t.dir);
  const entry = (() => { try { return readReceipt(root).entries.find((e) => e.dir === t.dir) ?? null; } catch { return null; } })();
  if (!entry) fail('versão ativa fora do recibo');
  if (entry.tree_sha256 !== t.tree_sha256) fail('recibo e ponteiro ativo divergem');
  let h; try { h = treeHash(dir); } catch (e) { fail(`árvore insegura (${e.code ?? e.message})`); }
  if (h.sha256 !== entry.tree_sha256) fail('árvore modificada desde a instalação/último verify (hash de árvore)');
  const rec = t.codesign ?? entry.codesign ?? null;
  let L; try { L = lock ?? trustedLock(); }   // R12.5 B3: lock oficial; nunca do ambiente
   catch (e) { fail(`lock ilegível (${e.message})`); }
  if (L.valid === false) fail(`lock inválido (${L.errors?.[0] ?? 'schema'})`);
  const cs = L.data?.components?.hyperframes?.platforms?.[active.platform]?.codesign ?? null;
  if (cs?.policy === 'NPM_NATIVE_PINNED') {
    if (!rec || !recordMatches(rec, cs)) fail('registro de assinatura da versão ativa diverge da aprovação do lock (reinstale)');
    const v = verifyNpmNativeTree(dir, cs, { ...(inspect ? { inspect } : {}) });   // spec do LOCK, não do registro
    if (!v.ok) fail(`${v.code}: ${v.detail}`);
    // R12.5C3c-B: a árvore INTEIRA contra o hash APROVADO no lock (fora do toolchain) — recibo/ativo forjados junto com
    // a árvore não bastam (antes, um .js alterado + recibo reescrito passava). Versão ativa = versão do lock.
    const hfLock = L.data?.components?.hyperframes; const want = hfLock?.platforms?.[active.platform]?.npm?.installed_tree_sha256 ?? null;
    if (t.version !== hfLock?.version) fail(`versão ativa ${t.version} ≠ versão aprovada no lock (${hfLock?.version ?? '-'})`);
    if (!want) fail('o lock não aprova o hash da árvore instalada (installed_tree_sha256)');
    if (h.sha256 !== want) fail(`árvore ≠ hash aprovado no lock (installed_tree_sha256 ${want.slice(0, 12)}…, obtido ${h.sha256.slice(0, 12)}…)`);
    return { managed: true, ok: true, dir: t.dir, natives: Object.keys(cs.native).length, policy: cs.policy, tree_sha256: h.sha256 };
  }
  // lock sem aprovação de nativos para a plataforma: no macOS, NENHUM Mach-O é admitido (registro não substitui o lock)
  if (platform === 'darwin') { const m = machoFiles(dir); if (m.length) fail(`${m.length} binário(s) nativo(s) sem aprovação no lock (ex.: ${m[0]})`); }
  return { managed: true, ok: true, dir: t.dir, natives: 0, policy: cs?.policy ?? null };
}

/**
 * `det` para o Core com o portão em CADA uso: o Core lê `det.nm` exatamente antes de cada operação (runHF: lint,
 * snapshot, render; launch: página/puppeteer). O getter refaz a verificação completa nesse instante — sem tocar no Core.
 * HyperFrames não gerenciado → o MESMO objeto, sem verificação nem custo (não interfere). Gerenciado → falha cedo aqui.
 */
export function guardedDet(det, opts = {}) {
  if (det?.status !== 'AVAILABLE' || !det.nm) return det;
  if (!guardManagedHyperFrames(det, opts).managed) return det;
  const nm = det.nm; const out = { ...det };
  Object.defineProperty(out, 'nm', { enumerable: true, configurable: false, get() {
    if (!guardManagedHyperFrames({ nm }, opts).managed) throw new SetupError('HF_MANAGED_INTEGRITY', 'HyperFrames gerenciado recusado: deixou de ser a versão ativa do toolchain — nada foi executado');
    return nm;
  } });
  return Object.freeze(out);
}

/** Re-verificação explícita (det de guardedDet): usada antes do withJobPage do Core, que abre um servidor ANTES do
 *  launch e não o fecha se o launch falhar — recusar aqui evita o processo pendurado. Det não protegido: no-op. */
export const reverifyDet = (det) => { void det?.nm; };
