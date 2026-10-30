// INSTALAÇÃO GUIADA do SFX Kit (R13) — reaproveita o downloader e o extrator seguros do Setup Manager (R12):
// HTTPS + allowlist do lock, sha256 e tamanho exatos, extração sem symlinks/paths inseguros, staging → rename atômico.
// Só roda com confirmação explícita (--yes); a Skill NUNCA chama isto ao iniciar. Não sobrescreve uma instalação existente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { download } from '../../setup/download.mjs';
import { extractArchive } from '../../setup/extract.mjs';
import { AudioError } from './errors.mjs';
import { loadKit, verifyKit } from './sfxkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const readLibraryLock = (file = path.join(HERE, '..', 'sfx-kit.lock.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Plano somente leitura: o que seria baixado, quanto, para onde. */
export function libraryPlan(lock, librariesDir) {
  const target = path.join(librariesDir, lock.installed.dir);
  const installed = fs.existsSync(path.join(target, 'sounds.json'));
  return { component: lock.id, version: lock.version, license: lock.license, installed, target, download_bytes: installed ? 0 : lock.artifact.size, disk_bytes: lock.installed.bytes,
    url: lock.artifact.url, sha256: lock.artifact.sha256, hosts: lock.artifact.hosts, action: installed ? 'USE_EXISTING' : 'INSTALL' };
}

export async function installSfxKit({ lock, librariesDir, yes = false, allowLoopbackHttp = false, url = null, now = new Date() }) {
  const plan = libraryPlan(lock, librariesDir);
  if (plan.installed) return { ...plan, status: 'ALREADY_INSTALLED' };
  if (!yes) throw new AudioError('CONFIRMATION_REQUIRED', `baixa ${(lock.artifact.size / 1e6).toFixed(1)} MB de ${new URL(lock.artifact.url).hostname} e ocupa ~${(lock.installed.bytes / 1e6).toFixed(0)} MB: repita com --yes`);
  fs.mkdirSync(path.join(librariesDir, '.downloads'), { recursive: true });
  const zip = path.join(librariesDir, '.downloads', path.basename(new URL(lock.artifact.url).pathname));
  let got;
  if (fs.existsSync(zip)) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (h !== lock.artifact.sha256) throw new AudioError('INTEGRITY_FAIL', `${path.basename(zip)} já existe e não confere com o lock (não sobrescrevo; mova-o para a Lixeira e repita)`);
    got = { file: zip, sha256: h, bytes: fs.statSync(zip).size, reused: true };
  } else {
    got = await download({ url: url ?? lock.artifact.url, dest: zip, expected: { sha256: lock.artifact.sha256, size: lock.artifact.size }, allowHosts: lock.artifact.hosts, allowLoopbackHttp, userAgent: 'bold-audio-setup' })
      .catch((e) => { throw new AudioError(e.code || 'DOWNLOAD_FAILED', e.message, e.details ?? null); });
  }
  const staging = path.join(librariesDir, `.staging-${lock.installed.dir}-${process.pid}`);
  const stats = await extractArchive({ file: zip, format: lock.artifact.format, dest: staging }).catch((e) => { throw new AudioError(e.code || 'EXTRACT_FAILED', e.message); });
  if (stats.symlinks) throw new AudioError('UNSAFE_ARCHIVE', 'o pacote do kit não deveria ter symlinks');
  const root = path.join(staging, lock.artifact.root);
  const kit = loadKit(root); const v = verifyKit(kit, { full: true });
  if (v.status !== 'PASS' || kit.version !== lock.version || kit.license !== lock.license) throw new AudioError('VERIFY_FAILED', `kit extraído não confere (status ${v.status}, versão ${kit.version}, licença ${kit.license}); staging mantido para inspeção: ${staging}`, v);
  const target = plan.target;
  fs.renameSync(root, target);
  fs.rmdirSync(staging);
  const prov = path.join(librariesDir, `${lock.installed.dir}.provenance.json`);
  const record = { schema: 'bold.library-provenance/1', id: lock.id, name: lock.name, version: lock.version, license: lock.license, attribution_required: false,
    source: { repo: lock.repo, release_tag: lock.release_tag, release_tag_commit: lock.release_tag_commit, asset_url: lock.artifact.url, asset_sha256: got.sha256, asset_bytes: got.bytes, final_url: got.final_url ?? null },
    install: { path: lock.installed.dir, installed_at: now.toISOString(), verified: { sounds: v.sounds, sha256_ok: v.checked_sha256 - v.mismatched.length, mismatched: v.mismatched.length, missing: v.missing.length, categories: v.categories } } };
  fs.writeFileSync(prov, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return { ...plan, status: 'INSTALLED', zip: got, verify: v, provenance: prov };
}
