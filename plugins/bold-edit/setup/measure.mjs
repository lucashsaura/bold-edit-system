// Modo de MEDIÇÃO (R12.5C0) — evidência para o GATE de artefatos PENDING_MEASUREMENT (ex.: Python auxiliar/Pillow).
// Nunca instala, nunca ativa, nunca executa: (1) obtém cada parte (arquivo local em --archive-dir, ou download com
// confirmação explícita pelo downloader seguro do BOLD); (2) confere sha256 + tamanho do lock ANTES de extrair;
// (3) extrai com o extrator seguro SÓ num diretório de medição isolado (fora do toolchain); wheel (.whl) é aberto como zip;
// (4) remove o bit de execução de tudo o que extraiu; (5) inventaria TODO Mach-O (executável, dylib, extensão/bundle) e
// inspeciona a assinatura com /usr/bin/codesign (--verify --strict e -dv; nenhum binário é executado);
// (6) grava measure.json + measure.md. O lock NÃO é alterado — o artefato continua não instalável até o GATE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { artifactFor } from './lock.mjs';
import { download as secureDownload } from './download.mjs';
import { extractArchive, EXTRACT_LIMITS } from './extract.mjs';
import { fileSha256, checkNpmFiles, runNpmCi, readActive } from './engine.mjs';
import { CODESIGN, parseDisplay, AUTHORITY } from './codesign.mjs';
import { SetupError } from './errors.mjs';

const CPU = { 0x0100000c: 'arm64', 0x01000007: 'x86_64', 12: 'arm', 7: 'i386' };
const FILETYPE = { 1: 'OBJECT', 2: 'EXECUTE', 6: 'DYLIB', 8: 'BUNDLE', 9: 'DYLIB_STUB', 11: 'DSYM' };

/** Cabeçalho Mach-O (thin/fat) → {kind, archs[], filetype} ou null. Não executa nada; só lê bytes. */
export function machoInfo(file) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); if (n < 28) return null;
    const thin = (buf, off) => {
      const m = buf.readUInt32BE(off);
      const le = m === 0xcefaedfe || m === 0xcffaedfe; if (!le && m !== 0xfeedface && m !== 0xfeedfacf) return null;
      const rd = (o) => (le ? buf.readUInt32LE(off + o) : buf.readUInt32BE(off + o));
      return { arch: CPU[rd(4)] ?? `cpu:${rd(4)}`, filetype: FILETYPE[rd(12)] ?? `type:${rd(12)}` };
    };
    const t = thin(b, 0); if (t) return { kind: 'thin', archs: [t.arch], filetype: t.filetype };
    const m = b.readUInt32BE(0);
    if (m === 0xcafebabe || m === 0xcafebabf) {
      const nfat = b.readUInt32BE(4); if (nfat < 1 || nfat > 16) return null;           // > 16 = classe Java (CAFEBABE + versão)
      const w = m === 0xcafebabf ? 32 : 20; const archs = []; let filetype = null;
      for (let i = 0; i < nfat && 8 + (i + 1) * w <= n; i++) {
        const base = 8 + i * w; const cpu = b.readUInt32BE(base); archs.push(CPU[cpu] ?? `cpu:${cpu}`);
        if (i === 0) { const off = m === 0xcafebabf ? Number(b.readBigUInt64BE(base + 8)) : b.readUInt32BE(base + 8); const h = Buffer.alloc(32); if (fs.readSync(fd, h, 0, 32, off) >= 28) filetype = thin(h, 0)?.filetype ?? null; }
      }
      return { kind: 'fat', archs, filetype };
    }
    return null;
  } finally { fs.closeSync(fd); }
}

/** Inspeciona a assinatura de UM Mach-O sem executá-lo → classe + detalhes. */
export function inspectSignature(file, { run = spawnSync, codesign = CODESIGN } = {}) {
  const opts = { encoding: 'utf8', timeout: 30000, shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C' } };
  const v = run(codesign, ['--verify', '--strict', '--verbose=1', file], opts);
  if (v.error || v.signal || v.status === null) return { class: 'UNAVAILABLE', verify_ok: false, detail: 'codesign não executou' };
  const vtxt = String(v.stderr || '').split(file).join(path.basename(file)).trim().split('\n')[0];
  if (/not signed at all/.test(vtxt)) return { class: 'UNSIGNED', verify_ok: false, detail: vtxt };
  const d = run(codesign, ['-dv', '--verbose=4', file], opts); const info = parseDisplay(`${d.stderr || ''}\n${d.stdout || ''}`);
  const flags = (String(d.stderr || '').match(/^CodeDirectory .*flags=0x[0-9a-f]+\(([^)]*)\)/m) || [])[1] || '';
  const auth = info.authorities[0] || null;
  const cls = info.adhoc ? 'ADHOC' : auth?.startsWith(`${AUTHORITY}:`) && info.team_id ? 'DEVELOPER_ID' : auth === 'Software Signing' ? 'APPLE' : auth ? 'OTHER' : 'UNKNOWN';
  return { class: cls, verify_ok: v.status === 0, ...(v.status !== 0 ? { detail: vtxt } : {}), team_id: info.team_id, identifier: info.identifier, authority: auth, runtime: info.runtime, flags };
}

/** Inventário de uma árvore extraída: todo arquivo, com Mach-O identificado e assinatura inspecionada. */
export function inventoryTree(dir, { inspect = inspectSignature } = {}) {
  const files = [];
  const walk = (rel) => {
    for (const nm of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${nm}` : nm; const abs = path.join(dir, r); const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) { files.push({ path: r, type: 'symlink', target: fs.readlinkSync(abs) }); continue; }
      if (st.isDirectory()) { walk(r); continue; }
      if (!st.isFile()) { files.push({ path: r, type: 'special' }); continue; }
      const mo = machoInfo(abs);
      const row = { path: r, type: mo ? 'macho' : 'file', size: st.size, exec_bit: (st.mode & 0o111) !== 0 };
      if (mo) Object.assign(row, { sha256: fileSha256(abs).sha256, macho: mo, signature: inspect(abs) });
      files.push(row);
    }
  };
  walk('');
  return files;
}

/** Recomendação objetiva a partir das assinaturas medidas (a DECISÃO de política é do GATE). */
export function summarize(machos) {
  const by = {}; for (const m of machos) by[m.signature.class] = (by[m.signature.class] || 0) + 1;
  const teams = [...new Set(machos.map((m) => m.signature.team_id).filter(Boolean))];
  const allDevId = machos.length > 0 && machos.every((m) => m.signature.class === 'DEVELOPER_ID' && m.signature.verify_ok);
  const recommendation = !machos.length ? 'NO_MACHO'
    : allDevId && teams.length === 1 ? 'REQUIRED_CANDIDATE' : 'POLICY_DECISION_REQUIRED';
  return { macho_total: machos.length, by_class: by, team_ids: teams, all_developer_id: allDevId, recommendation,
    note: recommendation === 'REQUIRED_CANDIDATE' ? `todos os Mach-O com Developer ID do Team ID ${teams[0]}: candidato a codesign REQUIRED (decisão no GATE)`
      : recommendation === 'NO_MACHO' ? 'nenhum Mach-O no artefato' : 'há Mach-O sem Developer ID (ad-hoc/sem assinatura/Apple/outros): a política atual NÃO permite instalar — decisão no GATE' };
}

const within = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/**
 * Mede um componente/plataforma do lock. Lança SetupError em qualquer violação (nada é extraído antes do sha256).
 * @param {{lock, component:string, platform:string, output?:string, archiveDir?:string, yes?:boolean, allowLoopback?:boolean,
 *          toolchainRoot?:string, download?:Function, inspect?:Function, now?:Date}} o
 */
export async function measureComponent(o) {
  const a = artifactFor(o.lock, o.component, o.platform, { allowLoopback: !!o.allowLoopback });
  if (!(a.state === 'PINNED' || a.codesign_pending)) throw new SetupError('NOT_MEASURABLE', `${o.component}/${o.platform}: ${a.state}${a.reason ? ` — ${a.reason}` : ''}`);
  if (a.kind === 'npm') return measureNpm(o, a);
  const now = o.now || new Date();
  const out = path.resolve(o.output || path.join(os.tmpdir(), `bold-measure-${o.component}-${o.platform}-${now.toISOString().replace(/[:.]/g, '-')}`));
  if (o.toolchainRoot && within(out, path.resolve(o.toolchainRoot))) throw new SetupError('USAGE', 'o diretório de medição não pode ficar dentro do toolchain');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new SetupError('USAGE', `diretório de medição não vazio: ${out}`);
  // 1) obter + conferir CADA parte antes de extrair qualquer coisa
  const got = [];
  for (const p of a.parts) {
    let file = o.archiveDir ? path.join(path.resolve(o.archiveDir), p.artifact || p.filename || path.basename(new URL(p.url).pathname)) : null;
    if (file && !fs.existsSync(file)) throw new SetupError('ARCHIVE_MISSING', `${p.id}: ${path.basename(file)} ausente em --archive-dir (nada foi baixado)`);
    if (!file) {
      if (!o.yes) throw new SetupError('CONFIRMATION_REQUIRED', `${p.id}: download necessário (${p.size} B de ${p.url}) — use --yes para confirmar ou --archive-dir`);
      fs.mkdirSync(path.join(out, 'downloads'), { recursive: true });
      file = path.join(out, 'downloads', `${p.id}-${path.basename(new URL(p.url).pathname)}`);
      await (o.download || secureDownload)({ url: p.url, dest: file, expected: { sha256: p.sha256, size: p.size }, allowHosts: a.entry.hosts || [], allowLoopbackHttp: !!o.allowLoopback });
    }
    const h = fileSha256(file);
    if (h.size !== p.size) throw new SetupError('SIZE_MISMATCH', `${p.id}: ${h.size} B, lock diz ${p.size} B — nada extraído`);
    if (h.sha256 !== p.sha256) throw new SetupError('INTEGRITY_FAIL', `${p.id}: sha256 não confere (esperado ${p.sha256.slice(0, 12)}…, obtido ${h.sha256.slice(0, 12)}…) — nada extraído`);
    got.push({ part: p, file, sha256: h.sha256, size: h.size });
  }
  // 2) extrair SÓ no diretório de medição; tirar o bit de execução; 3) inventariar e inspecionar
  const parts = [];
  for (const g of got) {
    const p = g.part; const dest = path.join(out, 'extract', p.id);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const asZip = p.format === 'zip' || (p.format === 'file' && /\.whl$/i.test(p.filename || ''));
    if (p.format === 'tar.gz' || asZip) await extractArchive({ file: g.file, format: asZip ? 'zip' : 'tar.gz', dest, strip: asZip && p.format === 'file' ? 0 : (p.strip_components ?? 0), limits: EXTRACT_LIMITS });
    else { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(g.file, path.join(dest, p.filename || path.basename(g.file)), fs.constants.COPYFILE_EXCL); }
    const files = inventoryTree(dest, { inspect: o.inspect });
    for (const f of files) if (f.type !== 'symlink' && f.type !== 'special') fs.chmodSync(path.join(dest, f.path), 0o644);
    const bins = Object.entries(p.bins || {}).map(([b, rel]) => { const row = files.find((f) => f.path === rel) || null; const link = row?.type === 'symlink' ? files.find((f) => f.path === path.posix.normalize(path.posix.join(path.posix.dirname(rel), row.target))) : null;
      return { bin: b, path: rel, found: !!row, macho: !!(row?.macho || link?.macho), via_symlink: row?.type === 'symlink' ? row.target : null, signature: (row?.signature || link?.signature) ?? null }; });
    parts.push({ id: p.id, artifact: p.artifact || p.filename || null, url: p.url, sha256: g.sha256, size: g.size, format: p.format, extracted_as: asZip ? 'zip' : p.format === 'tar.gz' ? 'tar.gz' : 'copy',
      files_total: files.length, macho: files.filter((f) => f.type === 'macho'), declared_bins: bins, symlinks: files.filter((f) => f.type === 'symlink').length });
  }
  const machos = parts.flatMap((p) => p.macho.map((m) => ({ part: p.id, ...m })));
  const report = { schema: 'bold.setup-measure/1', measured_at: now.toISOString(), component: o.component, platform: o.platform, version: a.version, lock_state: a.state,
    lock_codesign: a.entry?.codesign ?? null, executed: [], activated: false, lock_modified: false, output: out, parts, summary: summarize(machos) };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'measure.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'measure.md'), renderMarkdown(report));
  return report;
}

/**
 * Medição de um componente NPM (R12.5C3a): `npm ci --ignore-scripts` isolado na pasta de medição (fora do toolchain), com o
 * npm do Node GERENCIADO e VERIFICADO (registro de assinatura) — nenhum código de pacote é executado — e inventário de
 * todo Mach-O de node_modules. Exige --yes (download do registro fixado). Lock inalterado; nada ativado.
 */
async function measureNpm(o, a) {
  const now = o.now || new Date();
  if (o.platform !== (o.hostPlatform || o.platform)) throw new SetupError('NOT_MEASURABLE', 'npm só mede a plataforma do próprio host');
  const out = path.resolve(o.output || path.join(os.tmpdir(), `bold-measure-${o.component}-${o.platform}-${now.toISOString().replace(/[:.]/g, '-')}`));
  if (o.toolchainRoot && within(out, path.resolve(o.toolchainRoot))) throw new SetupError('USAGE', 'o diretório de medição não pode ficar dentro do toolchain');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new SetupError('USAGE', `diretório de medição não vazio: ${out}`);
  if (!o.yes) throw new SetupError('CONFIRMATION_REQUIRED', `${o.component}: medição npm baixa ${a.npm.packages ?? '?'} pacotes de ${a.npm.registry} — use --yes para confirmar`);
  let npm = o.npm || null;
  if (!npm) {   // npm do Node gerenciado, e só se a assinatura do Node estiver registrada (nada não verificado executa)
    const t = o.toolchainRoot ? (() => { try { return readActive(o.toolchainRoot)?.tools?.node; } catch { return null; } })() : null;
    if (!t?.codesign) throw new SetupError('NPM_REQUIRES_VERIFIED_NODE', 'a medição npm exige o Node gerenciado com assinatura verificada (bold setup apply --components node)');
    const nodeBin = path.join(o.toolchainRoot, t.dir, t.bins.node); const cli = path.join(o.toolchainRoot, t.dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(nodeBin) || !fs.existsSync(cli)) throw new SetupError('NPM_REQUIRES_VERIFIED_NODE', 'npm do Node gerenciado ausente');
    npm = { cmd: nodeBin, args: [cli] };
  }
  const lf = checkNpmFiles({ packageJson: a.npm.package_json_abs, lockfile: a.npm.lockfile_abs, expected: a.npm, registry: a.npm.registry });
  const dest = path.join(out, 'npm');
  runNpmCi({ npm, cwd: dest, scratch: path.join(out, '.npm-scratch'), registry: a.npm.registry, packageJson: a.npm.package_json_abs, lockfile: a.npm.lockfile_abs, env: o.npmEnv || {} });
  fs.rmSync(path.join(out, '.npm-scratch'), { recursive: true, force: true });
  const files = inventoryTree(dest, { inspect: o.inspect });
  for (const f of files) if (f.type !== 'symlink' && f.type !== 'special') fs.chmodSync(path.join(dest, f.path), 0o644);
  const machos = files.filter((f) => f.type === 'macho').map((m) => ({ part: 'node_modules', ...m, package: (m.path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/) || [])[1] || null }));
  const report = { schema: 'bold.setup-measure/1', measured_at: now.toISOString(), component: o.component, platform: o.platform, version: a.version, kind: 'npm', lock_state: a.state,
    lock_codesign: a.entry?.codesign ?? null, executed: ['npm ci --ignore-scripts (npm do Node gerenciado verificado)'], package_code_executed: false, activated: false, lock_modified: false, output: out,
    npm: { packages: a.npm.packages, lockfile_sha256: lf.sha256, registry: a.npm.registry },
    parts: [{ id: 'node_modules', artifact: 'package-lock.json', url: a.npm.registry, sha256: lf.sha256, size: lf.size, format: 'npm', extracted_as: 'npm ci', files_total: files.length, macho: machos, declared_bins: [], symlinks: files.filter((f) => f.type === 'symlink').length }],
    summary: summarize(machos) };
  fs.writeFileSync(path.join(out, 'measure.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'measure.md'), renderMarkdown(report));
  return report;
}

export function renderMarkdown(r) {
  const L = [`# Medição — ${r.component} ${r.version} (${r.platform})`, '', `Medido em ${r.measured_at}. Estado no lock: ${r.lock_state}${r.lock_codesign ? ` · codesign ${r.lock_codesign.policy}` : ''}.`,
    'Nada foi executado, instalado ou ativado; o lock não foi alterado. Bits de execução removidos dos arquivos extraídos.', '',
    `**Resumo:** ${r.summary.macho_total} Mach-O · ${Object.entries(r.summary.by_class).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} · Team IDs: ${r.summary.team_ids.join(', ') || 'nenhum'}`, '',
    `**Recomendação:** ${r.summary.recommendation} — ${r.summary.note}`, ''];
  for (const p of r.parts) {
    L.push(`## Parte ${p.id}`, '', `- artefato: ${p.artifact ?? '-'} · ${p.size} B · sha256 \`${p.sha256}\` (= lock) · extraído como ${p.extracted_as}`, `- arquivos: ${p.files_total} · symlinks: ${p.symlinks} · Mach-O: ${p.macho.length}`);
    for (const b of p.declared_bins) L.push(`- bin declarado **${b.bin}** → \`${b.path}\`: ${b.found ? 'presente' : 'AUSENTE'}${b.via_symlink ? ` (symlink → ${b.via_symlink})` : ''}${b.signature ? ` · ${b.signature.class}${b.signature.team_id ? ` ${b.signature.team_id}` : ''}` : ''}`);
    if (p.macho.length) {
      L.push('', '| Mach-O | tipo | archs | assinatura | Team ID | verify | runtime |', '|---|---|---|---|---|---|---|');
      for (const m of p.macho) L.push(`| \`${m.path}\` | ${m.macho.filetype} | ${m.macho.archs.join('+')} | ${m.signature.class} | ${m.signature.team_id ?? '-'} | ${m.signature.verify_ok ? 'OK' : 'FALHA'} | ${m.signature.runtime ? 'sim' : 'não'} |`);
    }
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

