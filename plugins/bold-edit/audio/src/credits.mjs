// CRÉDITOS E ORIGENS (R13). Dois registros no projeto, ambos SÓ ACRESCENTAM (nunca reescrevem):
//   sons/creditos.txt + sons/creditos.jsonl  → efeitos de terceiros com crédito (Openverse): arquivo, título, autor,
//                                               licença + versão, URL da licença, URL da obra, atribuição, data do download
//   sons/origens.jsonl                        → registro INTERNO de tudo que entrou (SFX Kit CC0, Earshot, Openverse):
//                                               origem, versão, licença, sha256 — o SFX Kit (CC0) não exige crédito público
import fs from 'node:fs';
import path from 'node:path';

const append = (file, text) => fs.appendFileSync(file, text, { encoding: 'utf8', mode: 0o644 });

export function recordOpenverseCredit(sonsDir, dl) {
  const it = dl.item; const date = dl.downloaded_at.slice(0, 10);
  const lic = `${it.license.toUpperCase()}${it.license_version ? ` ${it.license_version}` : ''}`;
  const txt = [
    `Arquivo: ${dl.name}`, `Título: ${it.title ?? '—'}`, `Autor: ${it.creator ?? '—'}`, `Licença: ${lic}`, `URL da licença: ${it.license_url ?? '—'}`,
    `URL da obra: ${it.landing_url ?? '—'}`, `Atribuição: ${it.attribution ?? '—'}`, `Fonte: Openverse (${it.source ?? it.provider ?? '—'})`, `Data do download: ${date}`,
    `Uso comercial: ${it.commercial}${it.commercial === 'OK_ATTRIBUTION' ? ' (crédito obrigatório)' : ''}`, `sha256: ${dl.sha256}`, '',
  ].join('\n');
  const f = path.join(sonsDir, 'creditos.txt');
  if (!fs.existsSync(f)) append(f, '# Créditos de efeitos sonoros de terceiros (gerado pelo BOLD; só acrescenta)\n\n');
  append(f, `${txt}\n`);
  const rec = { file: dl.name, title: it.title, creator: it.creator, license: it.license, license_version: it.license_version, license_url: it.license_url, work_url: it.landing_url,
    attribution: it.attribution, source: it.source, provider: it.provider, openverse_id: it.id, downloaded_at: dl.downloaded_at, commercial: it.commercial, sha256: dl.sha256, bytes: dl.bytes, final_url: dl.final_url };
  append(path.join(sonsDir, 'creditos.jsonl'), `${JSON.stringify(rec)}\n`);
  recordOrigin(sonsDir, { file: dl.name, origin: 'openverse', license: lic, credit_required: it.commercial === 'OK_ATTRIBUTION', commercial: it.commercial, sha256: dl.sha256, at: dl.downloaded_at });
  return rec;
}

export function recordOrigin(sonsDir, rec) {
  fs.mkdirSync(sonsDir, { recursive: true });
  append(path.join(sonsDir, 'origens.jsonl'), `${JSON.stringify(rec)}\n`);
}

/** Lê os créditos para checar uma entrega: todo arquivo de terceiros usado precisa estar aqui e ser comercialmente liberado. */
export function readOrigins(sonsDir) {
  const f = path.join(sonsDir, 'origens.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
