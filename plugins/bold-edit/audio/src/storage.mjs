// ARMAZENAMENTO EXTERNO do áudio (R13): SFX Kit, Earshot, modelos, caches e temporários num SSD/volume escolhido.
// Registro PRÓPRIO em <dados do BOLD>/audio-storage.json (bold.audio-storage/1), fora do bold.config.json: as versões
// anteriores validam o bold.config com additionalProperties:false e um campo novo ali quebraria instalações antigas.
// Marca no volume: <root>/.bold-storage.json com o mesmo id → o volume montado é mesmo o escolhido.
// Ausente ≠ desinstalado: com o SSD fora, NADA cai para o disco interno nem é reinstalado; o estado diz o que fica
// indisponível, o que continua funcionando e como recuperar (montar a imagem APFS / reconectar o SSD).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AudioError } from './errors.mjs';

export const STORAGE_SCHEMA = 'bold.audio-storage/1';
export const MARKER = '.bold-storage.json';
export const LAYOUT = Object.freeze({ sfx_kit: 'sfx-kit', earshot: 'earshot', models: 'models', cache: 'cache', temp: 'temp' });
/** Sistemas de arquivos que não servem para a venv/modelos (sem symlinks, sem journaling; exFAT/FAT com blocos grandes). */
const UNSUITABLE_FS = /^(exfat|msdos|fat\d*|ntfs|ufsd_ntfs|tuxera_ntfs)$/i;

/** Pasta de dados do BOLD por SO (a mesma de libraries/ e tools/). */
export function dataBase({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'bold');
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'bold');
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'bold');
}

export const storageFile = (o = {}) => (o.env ?? process.env).BOLD_AUDIO_STORAGE_FILE || path.join(dataBase(o), 'audio-storage.json');

/** Registro (ou null). JSON inválido → erro explícito: nunca adivinho caminhos. */
export function readStorage(o = {}) {
  const f = storageFile(o);
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch { return null; }
  let reg; try { reg = JSON.parse(text); } catch (e) { throw new AudioError('STORAGE_INVALID', `${f}: JSON inválido (${e.message})`); }
  if (reg?.schema !== STORAGE_SCHEMA || typeof reg.root !== 'string' || typeof reg.id !== 'string') throw new AudioError('STORAGE_INVALID', `${f}: esperado ${STORAGE_SCHEMA} com id e root`);
  return { ...reg, file: f, paths: { ...Object.fromEntries(Object.entries(LAYOUT).map(([k, v]) => [k, path.join(reg.root, v)])), ...(reg.paths ?? {}) } };
}

const readMarker = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8')); } catch { return null; } };

/** O que depende do armazenamento externo e o que continua funcionando sem ele. */
export const OFFLINE_IMPACT = Object.freeze({
  unavailable: ['SFX Kit (bold audio plan/select/search/library)', 'Earshot (describe/timeline/critique/render procedural)', 'modelos CLAP/AST', 'MCP do Earshot'],
  available: ['Openverse (search/fetch, com rede)', 'render/mix/verify/measure/export/mux de planos já gerados (ffmpeg)', 'todos os módulos que não são de áudio'],
});

/**
 * Estado do armazenamento configurado — SOMENTE LEITURA.
 * NOT_CONFIGURED (padrão interno) | ONLINE | IMAGE_DETACHED (SSD presente, imagem não montada) | DISCONNECTED | WRONG_VOLUME
 */
export function storageState(reg) {
  if (!reg) return { configured: false, state: 'NOT_CONFIGURED' };
  const base = { configured: true, id: reg.id, root: reg.root, file: reg.file, volume: reg.volume ?? null, paths: reg.paths };
  if (fs.existsSync(reg.root)) {
    const m = readMarker(reg.root);
    if (m?.id === reg.id) return { ...base, state: 'ONLINE', online: true };
    return { ...base, state: 'WRONG_VOLUME', online: false, detail: m ? `a marca do volume tem outro id (${String(m.id).slice(0, 8)}…)` : `sem ${MARKER} em ${reg.root}`, ...OFFLINE_IMPACT,
      recover: 'confira qual volume está montado nesse caminho; nada foi usado dele' };
  }
  const img = reg.volume?.image ?? null;
  if (img && fs.existsSync(img)) return { ...base, state: 'IMAGE_DETACHED', online: false, detail: `SSD conectado, imagem não montada (${path.basename(img)})`, ...OFFLINE_IMPACT, recover: 'bold audio storage attach --yes' };
  const host = reg.volume?.host ?? null;
  return { ...base, state: 'DISCONNECTED', online: false, detail: host ? `${host} não está conectado` : `${reg.volume?.mount ?? reg.root} não está montado`, ...OFFLINE_IMPACT,
    recover: `reconecte o SSD${img ? ' e rode bold audio storage attach --yes' : ''}; nada será reinstalado no disco interno` };
}

/** Atalho para locate/doctor/CLI: registro + estado (registro inválido vira estado, não exceção). */
export function currentStorage(o = {}) {
  try { return storageState(readStorage(o)); } catch (e) { return { configured: true, state: 'INVALID', online: false, detail: e.message, ...OFFLINE_IMPACT, recover: `corrija ou renomeie ${storageFile(o)}` }; }
}

/** Sistema de arquivos e espaço do volume que contém `p` (macOS: diskutil; outros: só espaço). */
export function volumeInfo(p, { platform = process.platform, run = execFileSync } = {}) {
  let free = null; try { const s = fs.statfsSync(p); free = s.bavail * s.bsize; } catch { /* inexistente */ }
  const info = { path: p, free_bytes: free, fs: null, block_bytes: null, location: null, volume_uuid: null };
  if (platform === 'darwin') {
    try {
      // diskutil só aceita dispositivo ou ponto de montagem: resolve o dispositivo do caminho antes
      const dev = String(run('/usr/bin/stat', ['-f', '%Sd', p], { encoding: 'utf8', timeout: 5000 })).trim();
      const t = String(run('/usr/sbin/diskutil', ['info', dev], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }));
      const get = (k) => (new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm').exec(t)?.[1] ?? '').trim() || null;
      info.fs = get('Type \\(Bundle\\)') ?? get('File System Personality');
      info.block_bytes = Number.parseInt(get('Allocation Block Size') ?? '', 10) || null;
      info.location = get('Device Location'); info.volume_uuid = get('Volume UUID'); info.mount = get('Mount Point');
    } catch { /* diskutil indisponível */ }
  }
  info.suitable = info.fs ? !UNSUITABLE_FS.test(info.fs) : null;
  return info;
}

/** Volumes externos montados (macOS: /Volumes) com recomendação — SOMENTE LEITURA. */
export function storageCandidates({ platform = process.platform, run = execFileSync, volumesDir = '/Volumes' } = {}) {
  if (platform !== 'darwin') return [];
  let names = []; try { names = fs.readdirSync(volumesDir); } catch { /* nenhum */ }
  return names.map((n) => path.join(volumesDir, n)).filter((m) => { try { return fs.statSync(m).isDirectory() && fs.realpathSync(m) !== '/'; } catch { return false; } })
    .map((m) => { const v = volumeInfo(m, { platform, run });
      const imageCmd = `hdiutil create -type SPARSEBUNDLE -fs APFS -size 20g -volname BOLD_EDIT_SYSTEM "${path.join(m, 'BOLD_EDIT_SYSTEM', 'bold-edit-system.sparsebundle')}"`;
      return { ...v, recommendation: v.suitable === false ? { use: 'apfs-image', why: `${v.fs}${v.block_bytes ? ` (bloco ${v.block_bytes / 1024} KiB)` : ''}: sem symlinks nem journaling; a venv (~41 mil arquivos) não cabe bem`, command: imageCmd } : { use: 'direct', why: v.fs ?? 'sistema de arquivos não identificado' } }; });
}

/**
 * Escolhe/adota o armazenamento: valida o volume, grava a marca (se ausente) e o registro. Não move nem copia dados.
 * Sem --yes → só o plano. Volume inadequado (exFAT/FAT/NTFS direto) → recusa e sugere a imagem APFS.
 */
export function setStorage({ root, image = null, yes = false, platform = process.platform, env = process.env, home = os.homedir(), run = execFileSync, now = new Date() }) {
  if (!root || !path.isAbsolute(root)) throw new AudioError('USAGE', 'bold audio storage set <pasta absoluta no volume> [--image <arquivo.sparsebundle>] --yes');
  const mountOf = (p) => { let q = path.resolve(p); while (!fs.existsSync(q) && path.dirname(q) !== q) q = path.dirname(q); return q; };
  const existing = mountOf(root);
  if (existing === path.parse(root).root && !fs.existsSync(root)) throw new AudioError('STORAGE_OFFLINE', `nenhuma parte de ${root} existe: o volume está conectado/montado?`);
  const v = volumeInfo(existing, { platform, run });
  if (platform === 'darwin' && v.suitable === null) throw new AudioError('STORAGE_FS_UNKNOWN', `não consegui identificar o sistema de arquivos de ${existing} (diskutil): não gravo um destino que não validei`);
  if (v.suitable === false) throw new AudioError('STORAGE_FS_UNSUITABLE', `${v.fs} em ${v.mount ?? existing}: sem symlinks e sem journaling (a venv do Earshot e o cache de modelos dependem deles). Crie uma imagem APFS no SSD (bold audio storage candidates mostra o comando) e aponte para dentro dela.`);
  if (image && !fs.existsSync(image)) throw new AudioError('USAGE', `--image não encontrado: ${image}`);
  const file = storageFile({ platform, env, home });
  let prev = null; try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* novo */ }
  const marker = fs.existsSync(root) ? readMarker(root) : null;
  const id = marker?.id ?? crypto.randomUUID();
  const volume = { mount: v.mount ?? existing, image: image ?? null, host: image ? (volumeInfo(path.dirname(image), { platform, run }).mount ?? null) : null, fs: v.fs, volume_uuid: v.volume_uuid };
  const reg = { schema: STORAGE_SCHEMA, id, root, volume, created_at: prev?.id === id ? prev.created_at : now.toISOString(), updated_at: now.toISOString() };
  const plan = { action: marker ? 'ADOPT' : 'CREATE', file, root, marker: path.join(root, MARKER), registry: reg, replaces: prev && prev.id !== id ? { id: prev.id, root: prev.root } : null, free_bytes: v.free_bytes, moves_data: false };
  if (!yes) return { ...plan, status: 'PLAN', note: 'nada foi gravado: repita com --yes' };
  fs.mkdirSync(root, { recursive: true });
  for (const d of Object.values(LAYOUT)) fs.mkdirSync(path.join(root, d), { recursive: true });
  if (!marker) fs.writeFileSync(path.join(root, MARKER), `${JSON.stringify({ schema: 'bold.storage-marker/1', id, created_at: now.toISOString(), note: 'BOLD EDIT SYSTEM — armazenamento do áudio. Não apague: identifica este volume.' }, null, 2)}\n`, { flag: 'wx' });
  if (prev) fs.renameSync(file, `${file}.${now.toISOString().replace(/[:.]/g, '-')}.bak`);   // o anterior fica guardado, não apagado
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(reg, null, 2)}\n`, { flag: 'wx' });
  return { ...plan, status: 'SAVED' };
}

/** Recuperação: monta a imagem APFS registrada (macOS, hdiutil; sem sudo) e confere a marca. */
export function attachStorage({ yes = false, platform = process.platform, env = process.env, home = os.homedir(), run = execFileSync } = {}) {
  const reg = readStorage({ platform, env, home }); const st = storageState(reg);
  if (!reg) throw new AudioError('STORAGE_NOT_CONFIGURED', 'nenhum armazenamento externo configurado (padrão interno)');
  if (st.state === 'ONLINE') return { ...st, status: 'ALREADY_ONLINE' };
  if (st.state !== 'IMAGE_DETACHED') throw new AudioError('STORAGE_OFFLINE', `${st.detail}: ${st.recover}`);
  if (platform !== 'darwin') throw new AudioError('UNSUPPORTED', 'montagem de imagem só no macOS');
  if (!yes) return { ...st, status: 'PLAN', command: `hdiutil attach "${reg.volume.image}"`, note: 'repita com --yes para montar' };
  run('/usr/bin/hdiutil', ['attach', reg.volume.image], { encoding: 'utf8', timeout: 120000 });
  const after = storageState(reg);
  if (after.state !== 'ONLINE') throw new AudioError('STORAGE_ATTACH_FAILED', `imagem montada, mas ${after.detail ?? after.state}`);
  return { ...after, status: 'ATTACHED' };
}

/** Volta ao padrão interno sem tocar nos dados: o registro é renomeado para .bak (nunca apagado). */
export function clearStorage({ yes = false, platform = process.platform, env = process.env, home = os.homedir(), now = new Date() } = {}) {
  const file = storageFile({ platform, env, home });
  if (!fs.existsSync(file)) return { status: 'NOT_CONFIGURED', file };
  if (!yes) return { status: 'PLAN', file, note: 'o registro vira .bak; os dados no SSD ficam intactos; nada é reinstalado no disco interno. Repita com --yes' };
  const bak = `${file}.${now.toISOString().replace(/[:.]/g, '-')}.bak`; fs.renameSync(file, bak);
  return { status: 'CLEARED', file, backup: bak };
}
