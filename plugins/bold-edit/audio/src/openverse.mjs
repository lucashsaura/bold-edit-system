// OPENVERSE (R13) — fallback online quando o SFX Kit não tem um bom candidato. API pública https://api.openverse.org/v1/audio/
// Busca: termos em inglês, license_type=commercial, paginação, limites (anônimo: 20/min, 200/dia → 429 + Retry-After),
// erros e resultado vazio (tenta termos alternativos). Avaliação ANTES de baixar: título, autor, fonte, licença, duração, formato.
// Download: só itens escolhidos, só para <projeto autorizado>/sons/, HTTPS + allowlist de hosts (revalidada a cada redirect),
// teto de tamanho, nunca sobrescreve, ffprobe confirma que é áudio, sha256 registrado, nada é executado.
// Licença: cc0 / pdm → uso comercial OK; by → OK com crédito obrigatório; by-sa → NÃO automático (o ShareAlike alcançaria o
// vídeo sincronizado); nc / nd / sampling / desconhecida / não verificável → bloqueado para entrega comercial.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { checkUrl, request } from '../../setup/download.mjs';
import { AudioError } from './errors.mjs';

export const API = 'https://api.openverse.org/v1/audio/';
export const API_HOSTS = Object.freeze(['api.openverse.org']);
/** Hosts de ARQUIVO aceitos (provedores do Openverse áudio). Host novo → recusado com diagnóstico, nunca aceito sozinho. */
export const DOWNLOAD_HOSTS = Object.freeze(['cdn.freesound.org', 'upload.wikimedia.org', 'prod-1.storage.jamendo.com', 'mp3l.jamendo.com', 'mp3d.jamendo.com', 'ccmixter.org']);
export const LANDING_HOSTS = Object.freeze(['freesound.org', 'commons.wikimedia.org', 'www.jamendo.com', 'jamendo.com', 'ccmixter.org', 'dig.ccmixter.org']);
export const AUDIO_TYPES = Object.freeze(['mp3', 'wav', 'flac', 'ogg', 'oga', 'aif', 'aiff', 'm4a']);
export const LIMITS = Object.freeze({ maxBytes: 25 * 1024 * 1024, maxDurationS: 600, pageSize: 20 });
const UA = 'bold-edit-system (sound design)';

/** Termos alternativos (inglês) quando a busca volta vazia. */
export const ALTERNATIVES = Object.freeze({
  whoosh: ['swoosh', 'swish', 'woosh', 'air pass'], pop: ['bubble pop', 'pop click', 'plop'], impact: ['hit', 'thud', 'punch hit'], riser: ['rise', 'build up', 'swell'],
  ambience: ['ambient', 'room tone', 'atmosphere'], click: ['ui click', 'button click', 'tap'], transition: ['whoosh transition', 'swish'], boom: ['cinematic boom', 'sub drop'],
  shimmer: ['sparkle', 'chime'], typing: ['keyboard typing', 'keys'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON da API com política de URL, teto de bytes, 429 (Retry-After) e 1 nova tentativa em 5xx/rede. */
export function getJson(url, { allowLoopbackHttp = false, env = process.env, timeoutMs = 20_000, maxBytes = 2 * 1024 * 1024, apiHosts = API_HOSTS } = {}) {
  const once = () => new Promise((resolve, reject) => {
    let u; try { u = checkUrl(url, { allowHosts: [...apiHosts], allowLoopbackHttp, env }); } catch (e) { reject(new AudioError(e.code || 'URL_REFUSED', e.message)); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': UA }, timeout: timeoutMs }, (res) => {
      const sc = res.statusCode || 0; const rl = { burst: res.headers['x-ratelimit-available-anon_burst'] ?? null, sustained: res.headers['x-ratelimit-available-anon_sustained'] ?? null };
      if (sc === 429) { res.resume(); reject(new AudioError('RATE_LIMITED', `Openverse: limite de requisições atingido; tente de novo em ${res.headers['retry-after'] ?? '?'} s`, { retry_after_s: Number(res.headers['retry-after'] ?? 60), ratelimit: rl })); return; }
      if (sc >= 500) { res.resume(); reject(Object.assign(new AudioError('API_ERROR', `Openverse HTTP ${sc}`), { retryable: true })); return; }
      if (sc !== 200) { res.resume(); reject(new AudioError('API_ERROR', `Openverse HTTP ${sc}`)); return; }
      const parts = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(); reject(new AudioError('TOO_LARGE', 'resposta da API grande demais')); } else parts.push(c); });
      res.on('end', () => { try { resolve({ json: JSON.parse(Buffer.concat(parts).toString('utf8')), ratelimit: rl }); } catch (e) { reject(new AudioError('API_ERROR', `JSON inválido: ${e.message}`)); } });
    });
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new AudioError('TIMEOUT', `Openverse sem resposta por ${timeoutMs} ms`), { retryable: true })); });
    req.on('error', (e) => reject(Object.assign(new AudioError('NETWORK', e.code || e.message), { retryable: true })));
  });
  return once().catch(async (e) => { if (!e.retryable) throw e; await sleep(1500); return once(); });
}

export function searchUrl(q, { page = 1, pageSize = LIMITS.pageSize, licenseType = 'commercial', base = API } = {}) {
  const u = new URL(base);
  u.searchParams.set('q', q); u.searchParams.set('license_type', licenseType); u.searchParams.set('page_size', String(pageSize)); if (page !== 1) u.searchParams.set('page', String(page));   // page=1 é o padrão da API (e a URL que a CDN costuma ter)
  return u.toString();
}

/** Busca com fallback de termos. Devolve resultados AVALIADOS (nada é baixado). */
export async function search(q, { page = 1, pageSize = LIMITS.pageSize, maxDurationS = null, base = API, allowLoopbackHttp = false, env = process.env, apiHosts = API_HOSTS } = {}) {
  if (!/^[\x20-\x7e]{2,80}$/.test(q)) throw new AudioError('USAGE', 'termo de busca: 2–80 caracteres ASCII (inglês)');
  const tried = [];
  const terms = [q, ...(ALTERNATIVES[q.toLowerCase()] ?? [])];
  for (const term of terms) {
    const { json, ratelimit } = await getJson(searchUrl(term, { page, pageSize, base }), { allowLoopbackHttp, env, apiHosts });
    tried.push({ term, result_count: json.result_count ?? 0 });
    let results = (json.results ?? []).map(evaluate);
    if (maxDurationS) results = results.filter((r) => r.duration_s === null || r.duration_s <= maxDurationS);
    if (results.length) return { query: q, term, page: json.page ?? page, page_count: json.page_count ?? null, result_count: json.result_count ?? null, tried, ratelimit, results };
  }
  return { query: q, term: null, page, page_count: 0, result_count: 0, tried, ratelimit: null, results: [], note: 'nenhum resultado (termos alternativos incluídos)' };
}

const hostOf = (s) => { try { return new URL(s).hostname.toLowerCase(); } catch { return null; } };
const LICENSE_PATH = { cc0: '/publicdomain/zero/', pdm: '/publicdomain/mark/', by: '/licenses/by/', 'by-sa': '/licenses/by-sa/' };

/** Avalia um resultado da API: o que se sabe, o que falta e se pode ir para entrega comercial. */
export function evaluate(r) {
  const reasons = []; let commercial = 'UNVERIFIED';
  const lic = String(r.license ?? '').toLowerCase(); const ver = r.license_version ?? null;
  const lurl = r.license_url ?? null; const lhost = hostOf(lurl);
  const licOk = lhost === 'creativecommons.org' && LICENSE_PATH[lic] && new URL(lurl).pathname.startsWith(LICENSE_PATH[lic]) && (!ver || new URL(lurl).pathname.includes(`/${ver}/`));
  if (['cc0', 'pdm'].includes(lic)) commercial = licOk ? 'OK' : 'UNVERIFIED';
  else if (lic === 'by') commercial = licOk && r.creator ? 'OK_ATTRIBUTION' : 'UNVERIFIED';
  else if (lic === 'by-sa') { commercial = 'BLOCKED'; reasons.push('BY-SA: o ShareAlike alcançaria o vídeo sincronizado — não usar automaticamente em entrega comercial'); }
  else { commercial = 'BLOCKED'; reasons.push(`licença ${lic || 'ausente'} não permite uso comercial automático`); }
  if (!licOk && commercial !== 'BLOCKED') reasons.push('license_url ausente ou não confere com a licença declarada (creativecommons.org)');
  if (lic === 'by' && !r.creator) reasons.push('CC BY sem autor: crédito impossível');
  const fileHost = hostOf(r.url); const landHost = hostOf(r.foreign_landing_url);
  const ft = String(r.filetype ?? path.extname(new URL(r.url ?? 'https://x/x').pathname).slice(1)).toLowerCase();
  const download = { ok: true, why: [] };
  if (!r.url || !String(r.url).startsWith('https://')) { download.ok = false; download.why.push('URL do arquivo não é HTTPS'); }
  else if (!DOWNLOAD_HOSTS.includes(fileHost)) { download.ok = false; download.why.push(`host do arquivo não verificado: ${fileHost}`); }
  if (!AUDIO_TYPES.includes(ft)) { download.ok = false; download.why.push(`formato ${ft || '?'} não aceito`); }
  if (r.filesize && r.filesize > LIMITS.maxBytes) { download.ok = false; download.why.push(`arquivo grande demais (${r.filesize} B)`); }
  if (r.mature) { download.ok = false; download.why.push('marcado como sensível (mature)'); }
  if (!r.foreign_landing_url || !LANDING_HOSTS.includes(landHost)) { reasons.push(`página de origem não verificada (${landHost ?? 'ausente'})`); if (commercial !== 'BLOCKED') commercial = 'UNVERIFIED'; }
  const dur = typeof r.duration === 'number' ? r.duration / 1000 : null;
  if (dur !== null && dur > LIMITS.maxDurationS) { download.ok = false; download.why.push(`longo demais (${dur.toFixed(0)} s)`); }
  return {
    id: r.id, title: r.title ?? null, creator: r.creator ?? null, creator_url: r.creator_url ?? null, provider: r.provider ?? null, source: r.source ?? null,
    license: lic, license_version: ver, license_url: lurl, landing_url: r.foreign_landing_url ?? null, url: r.url ?? null, filetype: ft, filesize: r.filesize ?? null,
    duration_s: dur, sample_rate: r.sample_rate ?? null, bit_rate: r.bit_rate ?? null, attribution: r.attribution ?? null, tags: (r.tags ?? []).map((t) => t.name).slice(0, 12),
    commercial, reasons, download,
  };
}

/** Item AVALIADO (saída de `search --json`) → campos da API → evaluate() de novo: a política vale mesmo vindo de arquivo. */
export function reevaluate(e) {
  return evaluate({ id: e.id, title: e.title, creator: e.creator, creator_url: e.creator_url, provider: e.provider, source: e.source, license: e.license, license_version: e.license_version,
    license_url: e.license_url, foreign_landing_url: e.landing_url, url: e.url, filetype: e.filetype, filesize: e.filesize, duration: e.duration_s === null || e.duration_s === undefined ? undefined : Math.round(e.duration_s * 1000),
    sample_rate: e.sample_rate, bit_rate: e.bit_rate, attribution: e.attribution, mature: false, tags: (e.tags ?? []).map((name) => ({ name })) });
}

const slug = (s) => String(s ?? 'audio').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'audio';

function probeAudio(ffprobe, file) {
  let j; try { j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })); } catch (e) { throw new AudioError('NOT_AUDIO', `ffprobe recusou o arquivo: ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
  const a = (j.streams ?? []).filter((s) => s.codec_type === 'audio'); const v = (j.streams ?? []).filter((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic));
  if (a.length !== 1 || v.length) throw new AudioError('NOT_AUDIO', `esperado 1 stream de áudio e nenhum vídeo (áudio ${a.length}, vídeo ${v.length})`);
  return { format: j.format?.format_name ?? null, codec: a[0].codec_name, sample_rate: Number(a[0].sample_rate), channels: a[0].channels, duration_s: Number(j.format?.duration ?? a[0].duration ?? 0) };
}

/**
 * Baixa UM resultado avaliado para `sonsDir` (dentro do projeto autorizado) e registra o crédito.
 * Recusa: download não verificável, licença bloqueada (salvo allowUnverified para prévia NÃO comercial), destino existente.
 */
export async function download(item, { sonsDir, ffprobe, allowUnverified = false, now = new Date(), allowLoopbackHttp = false, downloadHosts = DOWNLOAD_HOSTS } = {}) {
  if (!item?.download?.ok) throw new AudioError('DOWNLOAD_REFUSED', `download recusado: ${(item?.download?.why ?? ['item não avaliado']).join('; ')}`);
  if (item.commercial === 'BLOCKED' || (item.commercial === 'UNVERIFIED' && !allowUnverified)) throw new AudioError('LICENSE_REFUSED', `licença ${item.commercial}: ${item.reasons.join('; ') || 'não verificável'} (use --allow-unverified só para prévia NÃO comercial)`);
  fs.mkdirSync(sonsDir, { recursive: true });
  const name = `ov-${slug(item.title)}-${String(item.id).slice(0, 8)}.${item.filetype}`;
  const dest = path.join(sonsDir, name);
  if (fs.existsSync(dest)) throw new AudioError('OUTPUT_EXISTS', `já existe (nunca sobrescrevo): ${name}`);
  const res = await request('GET', item.url, { allowHosts: [...downloadHosts], allowLoopbackHttp, maxBytes: LIMITS.maxBytes, userAgent: UA, accept: 'audio/*' })
    .catch((e) => { throw new AudioError(e.code || 'DOWNLOAD_FAILED', e.message); });
  const ct = String(res.headers['content-type'] ?? '');
  if (ct && !/^(audio\/|application\/octet-stream|application\/ogg)/i.test(ct)) throw new AudioError('NOT_AUDIO', `Content-Type ${ct} não é áudio`);
  if (item.filesize && Math.abs(res.body.length - item.filesize) > Math.max(1024, item.filesize * 0.02)) throw new AudioError('SIZE_MISMATCH', `tamanho ${res.body.length} B ≠ declarado ${item.filesize} B`);
  const part = `${dest}.part`;
  fs.writeFileSync(part, res.body, { flag: 'wx', mode: 0o644 });
  let probe;
  try { probe = probeAudio(ffprobe, part); } catch (e) { fs.rmSync(part, { force: true }); throw e; }
  if (item.duration_s && Math.abs(probe.duration_s - item.duration_s) > Math.max(0.5, item.duration_s * 0.05)) { fs.rmSync(part, { force: true }); throw new AudioError('DURATION_MISMATCH', `duração ${probe.duration_s.toFixed(2)} s ≠ declarada ${item.duration_s.toFixed(2)} s`); }
  fs.linkSync(part, dest); fs.unlinkSync(part);                                   // link falha se o destino surgiu no meio: nunca sobrescreve
  const sha256 = crypto.createHash('sha256').update(res.body).digest('hex');
  return { file: dest, name, bytes: res.body.length, sha256, final_url: res.final_url, chain: res.chain, probe, downloaded_at: now.toISOString(), item };
}
