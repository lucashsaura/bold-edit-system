// SFX Kit (wyzowl/sfx-kit, CC0-1.0) — leitura dos METADADOS REAIS (sounds.json, conforme sounds.schema.json).
// Nenhum campo é inventado: o BOLD só lê os campos abaixo, e um registro sem os obrigatórios é recusado (fail-closed).
// Regra de posicionamento do próprio kit: início = (momento que o som deve encontrar) − sync.at  (÷ rate se o rate mudar).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AudioError } from './errors.mjs';

/** Campos do sounds.schema.json que o BOLD usa (required = o kit marca como obrigatório para todo som). */
export const SOUND_REQUIRED = Object.freeze(['id', 'name', 'category', 'file', 'variant', 'description', 'use_for', 'avoid_for', 'tags', 'duration', 'channels', 'sync', 'timing', 'level', 'under_voiceover_db', 'adapt', 'sha256']);
export const SOUND_OPTIONAL = Object.freeze(['parts', 'span_seconds', 'fits_seconds', 'tuning', 'pairs_with', 'character']);
export const SYNC_MEETS = Object.freeze(['instant', 'action-start', 'move-peak', 'arrival', 'release']);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function checkSound(s) {
  const miss = SOUND_REQUIRED.filter((k) => s[k] === undefined || s[k] === null);
  if (miss.length) return `faltam ${miss.join(', ')}`;
  if (!isNum(s.sync.at) || !SYNC_MEETS.includes(s.sync.meets)) return 'sync inválido';
  if (!['audible_start', 'onset', 'peak', 'body_end', 'audible_end'].every((k) => isNum(s.timing[k]))) return 'timing inválido';
  if (!isNum(s.level.lufs) || !isNum(s.level.true_peak_dbtp)) return 'level inválido';
  if (!Array.isArray(s.adapt.rate) || s.adapt.rate.length !== 2 || !s.adapt.rate.every(isNum)) return 'adapt.rate inválido';
  if (!/^[0-9a-f]{64}$/.test(s.sha256)) return 'sha256 inválido';
  if (path.isAbsolute(s.file) || s.file.split(/[\\/]/).includes('..')) return 'file fora do kit';
  return null;
}

/** Carrega o kit. Erros de schema → AudioError KIT_INVALID (nada é "consertado" em silêncio). */
export function loadKit(dir) {
  const f = path.join(dir, 'sounds.json');
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new AudioError('KIT_INVALID', `sounds.json ilegível: ${e.message}`); }
  for (const k of ['name', 'version', 'license', 'format', 'loudness', 'categories', 'sounds']) if (d[k] === undefined) throw new AudioError('KIT_INVALID', `sounds.json sem "${k}"`);
  const bad = [];
  for (const s of d.sounds) { const why = checkSound(s); if (why) bad.push({ id: s.id ?? '?', why }); }
  if (bad.length) throw new AudioError('KIT_INVALID', `${bad.length} registro(s) fora do schema`, bad.slice(0, 10));
  const byId = new Map(d.sounds.map((s) => [s.id, s]));
  return { dir, name: d.name, version: d.version, license: d.license, credit: d.credit ?? null, homepage: d.homepage ?? null, format: d.format, loudness: d.loudness,
    categories: d.categories, sounds: d.sounds, byId, file: (s) => path.join(dir, s.file) };
}

/** Verificação: rápida (existência + tamanho > 0) ou completa (sha256 de cada WAV contra o sounds.json). */
export function verifyKit(kit, { full = false } = {}) {
  const res = { name: kit.name, version: kit.version, license: kit.license, sounds: kit.sounds.length, categories: kit.categories.length, missing: [], mismatched: [], checked_sha256: 0, mode: full ? 'full' : 'quick' };
  for (const s of kit.sounds) {
    const f = kit.file(s);
    let st = null; try { st = fs.statSync(f); } catch { /* ausente */ }
    if (!st?.isFile() || st.size === 0) { res.missing.push(s.id); continue; }
    if (full) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
      res.checked_sha256 += 1;
      if (h !== s.sha256) res.mismatched.push(s.id);
    }
  }
  const declared = kit.categories.reduce((n, c) => n + (c.count || 0), 0);
  res.category_counts_ok = declared === kit.sounds.length;
  res.status = res.missing.length || res.mismatched.length || !res.category_counts_ok ? 'FAIL' : 'PASS';
  return res;
}

const WORD = /[a-z0-9]+/g;
export const words = (s) => (String(s).toLowerCase().match(WORD) ?? []);

/** Busca textual simples nos campos reais (id, name, description, use_for, tags, character, categoria). */
export function searchKit(kit, query, { category = null, meets = null, limit = 10 } = {}) {
  const q = new Set(words(query));
  const rows = [];
  for (const s of kit.sounds) {
    if (category && s.category !== category) continue;
    if (meets && s.sync.meets !== meets) continue;
    const fields = [[s.id, 3], [s.name, 2], [s.tags.join(' '), 3], [s.use_for.join(' '), 2], [s.description, 1], [s.character ?? '', 1], [s.category, 2]];
    let score = 0;
    for (const [txt, w] of fields) { const ws = new Set(words(txt)); for (const t of q) if (ws.has(t)) score += w; }
    let avoid = 0; const aw = new Set(words(s.avoid_for.join(' '))); for (const t of q) if (aw.has(t)) avoid += 1;
    if (score > 0) rows.push({ id: s.id, category: s.category, score: score - avoid, duration: s.duration, sync: s.sync, use_for: s.use_for.slice(0, 2), tier: s.level.tier });
  }
  return rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
