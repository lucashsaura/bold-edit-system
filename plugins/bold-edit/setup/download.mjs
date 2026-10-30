// Downloader seguro do Setup Manager (R12.2). Node puro, sem dependências.
// HTTPS obrigatório + allowlist de hosts (revalidada a cada redirect) · sha256 calculado DURANTE o stream ·
// tamanho exato do lock (Content-Length e bytes recebidos) · teto absoluto · timeout de inatividade e prazo total ·
// sem transformação (Accept-Encoding: identity) · grava em <dest>.part e só renomeia depois de tudo conferir.
// Exceção ÚNICA: http://127.0.0.1 / [::1] para o servidor LOCAL de testes, apenas com allowLoopbackHttp=true.
// Trava OFFLINE (BOLD_SETUP_OFFLINE=1, ligada pela suíte de testes): recusa QUALQUER URL que não seja loopback.
// R12.3: fetchMetadata (GET limitado) e headInfo (HEAD) para o gerador do lock — mesma política de URL/redirect.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { SetupError } from './errors.mjs';

export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1', '[::1]']);
export const DEFAULTS = Object.freeze({ maxRedirects: 5, idleTimeoutMs: 30_000, totalTimeoutMs: 15 * 60_000, maxBytes: 1024 ** 3 });

/** Valida uma URL contra a política: https + host na allowlist; http só em loopback quando permitido (testes). */
export function checkUrl(raw, { allowHosts = [], allowLoopbackHttp = false, env = process.env } = {}) {
  let u; try { u = new URL(raw); } catch { throw new SetupError('URL_INVALID', `URL inválida: ${String(raw).slice(0, 120)}`); }
  if (u.username || u.password) throw new SetupError('URL_CREDENTIALS', 'URL com credenciais é proibida');
  const host = u.hostname.toLowerCase();
  const loop = LOOPBACK_HOSTS.includes(host) || LOOPBACK_HOSTS.includes(`[${host}]`);
  if (env.BOLD_SETUP_OFFLINE === '1' && !loop) throw new SetupError('OFFLINE', `modo offline (BOLD_SETUP_OFFLINE=1): ${host} recusado`);
  if (u.protocol === 'http:') {
    if (!(allowLoopbackHttp && loop)) throw new SetupError('HTTPS_REQUIRED', `HTTPS obrigatório (${u.protocol}//${host})`);
    return u;
  }
  if (u.protocol !== 'https:') throw new SetupError('HTTPS_REQUIRED', `protocolo proibido: ${u.protocol}`);
  if (loop && allowLoopbackHttp) return u;
  if (!allowHosts.map((h) => h.toLowerCase()).includes(host)) throw new SetupError('HOST_NOT_ALLOWED', `host fora da allowlist: ${host}`);
  return u;
}

/**
 * Baixa `url` para `dest` conferindo tamanho e sha256 esperados.
 * @param {{url:string, dest:string, expected:{sha256:string, size:number}, allowHosts:string[], allowLoopbackHttp?:boolean,
 *          maxRedirects?:number, idleTimeoutMs?:number, totalTimeoutMs?:number, maxBytes?:number, onProgress?:(n:number)=>void,
 *          userAgent?:string}} o
 * @returns {Promise<{file:string, bytes:number, sha256:string, final_url:string, redirects:number}>}
 */
export function download(o) {
  const opt = { ...DEFAULTS, ...o };
  if (!/^[0-9a-f]{64}$/.test(opt.expected?.sha256 || '')) return Promise.reject(new SetupError('LOCK_INCOMPLETE', 'sha256 esperado ausente/inválido'));
  if (!Number.isInteger(opt.expected?.size) || opt.expected.size <= 0) return Promise.reject(new SetupError('LOCK_INCOMPLETE', 'tamanho esperado ausente/inválido'));
  if (opt.expected.size > opt.maxBytes) return Promise.reject(new SetupError('TOO_LARGE', `artefato (${opt.expected.size} B) acima do teto (${opt.maxBytes} B)`));
  const part = `${opt.dest}.part`;
  let fd;
  try { fd = fs.openSync(part, 'wx', 0o600); } catch (e) { return Promise.reject(new SetupError(e.code === 'EEXIST' ? 'PARTIAL_EXISTS' : 'IO', `não foi possível criar ${part}: ${e.code}`)); }
  const cleanup = () => { try { fs.closeSync(fd); } catch { /* fechado */ } try { fs.unlinkSync(part); } catch { /* ausente */ } };

  return new Promise((resolve, reject) => {
    let settled = false; let currentReq = null;
    const fail = (err) => { if (settled) return; settled = true; clearTimeout(total); try { currentReq?.destroy(); } catch { /* ok */ } cleanup(); reject(err); };
    const total = setTimeout(() => fail(new SetupError('TIMEOUT', `prazo total de ${opt.totalTimeoutMs} ms excedido`)), opt.totalTimeoutMs);

    const get = (raw, hops) => {
      let u; try { u = checkUrl(raw, opt); } catch (e) { fail(e); return; }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(u, { headers: { 'Accept-Encoding': 'identity', 'User-Agent': opt.userAgent || 'bold-setup' } , timeout: opt.idleTimeoutMs }, (res) => {
        const sc = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(sc)) {
          res.resume();
          if (hops >= opt.maxRedirects) { fail(new SetupError('TOO_MANY_REDIRECTS', `mais de ${opt.maxRedirects} redirects`)); return; }
          const loc = res.headers.location;
          if (!loc) { fail(new SetupError('BAD_REDIRECT', 'redirect sem Location')); return; }
          let next; try { next = new URL(loc, u).toString(); } catch { fail(new SetupError('BAD_REDIRECT', 'Location inválido')); return; }
          // R12.4: redirect para host FORA da allowlist (ex.: CDN regional desconhecido) → recusa explícita, com diagnóstico.
          // Nunca aceita host novo automaticamente: o mantenedor verifica e o inclui no lock (GATE).
          try { checkUrl(next, opt); } catch (e) {
            if (e.code === 'HOST_NOT_ALLOWED') { const to = new URL(next).hostname; fail(new SetupError('UNKNOWN_REDIRECT_HOST', `redirect de ${u.hostname} para host NÃO verificado: ${to} — nada foi baixado. Provável CDN regional/novo; o host só pode ser aceito depois de verificado pelo mantenedor e incluído no lock (setup/toolchain.lock.json, campo hosts).`, { from: u.hostname, to, allowed: opt.allowHosts })); return; }
            fail(e); return;
          }
          get(next, hops + 1); return;
        }
        if (sc !== 200) { res.resume(); fail(new SetupError('HTTP_STATUS', `HTTP ${sc}`)); return; }
        const enc = String(res.headers['content-encoding'] || 'identity').toLowerCase();
        if (enc !== 'identity') { res.resume(); fail(new SetupError('ENCODING_NOT_ALLOWED', `Content-Encoding ${enc} recusado`)); return; }
        const cl = res.headers['content-length'];
        if (cl !== undefined && Number(cl) !== opt.expected.size) { res.resume(); fail(new SetupError('SIZE_MISMATCH', `Content-Length ${cl} ≠ esperado ${opt.expected.size}`)); return; }
        const hash = crypto.createHash('sha256'); let bytes = 0;
        res.on('data', (chunk) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > opt.expected.size || bytes > opt.maxBytes) { fail(new SetupError('SIZE_MISMATCH', `recebido mais que o esperado (${opt.expected.size} B)`)); return; }
          hash.update(chunk);
          try { fs.writeSync(fd, chunk); } catch (e) { fail(new SetupError('IO', `falha ao gravar: ${e.code}`)); return; }
          opt.onProgress?.(bytes);
        });
        res.on('aborted', () => fail(new SetupError('INCOMPLETE', 'conexão interrompida')));
        res.on('error', (e) => fail(new SetupError('NETWORK', e.code || e.message)));
        res.on('end', () => {
          if (settled) return;
          if (!res.complete || bytes !== opt.expected.size) { fail(new SetupError('INCOMPLETE', `download incompleto (${bytes}/${opt.expected.size} B)`)); return; }
          const got = hash.digest('hex');
          if (got !== opt.expected.sha256) { fail(new SetupError('INTEGRITY_FAIL', `sha256 não confere (esperado ${opt.expected.sha256.slice(0, 12)}…, obtido ${got.slice(0, 12)}…)`)); return; }
          try { fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(part, opt.dest); } catch (e) { fail(new SetupError('IO', `falha ao finalizar: ${e.code}`)); return; }
          settled = true; clearTimeout(total);
          resolve({ file: opt.dest, bytes, sha256: got, final_url: u.toString().replace(/\?.*$/, ''), redirects: hops });
        });
      });
      currentReq = req;
      req.on('timeout', () => { fail(new SetupError('TIMEOUT', `sem dados por ${opt.idleTimeoutMs} ms`)); });
      req.on('error', (e) => fail(new SetupError('NETWORK', e.code || e.message)));
    };
    get(opt.url, 0);
  });
}

/**
 * Requisição de METADADOS (GET com teto pequeno, ou HEAD), com a mesma política de URL e redirects do download.
 * Registra a cadeia de hosts (sem query string). Usada só pelo gerador do lock (ferramenta de desenvolvimento).
 * @returns {Promise<{status:number, headers:object, body:Buffer|null, final_url:string, chain:string[]}>}
 */
export function request(method, url, { allowHosts = [], allowLoopbackHttp = false, maxBytes = 4 * 1024 * 1024, maxRedirects = 5, idleTimeoutMs = 20_000, accept, userAgent = 'bold-setup-lockgen', followRedirects = true } = {}) {
  return new Promise((resolve, reject) => {
    const chain = []; let done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    const go = (raw, hops) => {
      let u; try { u = checkUrl(raw, { allowHosts, allowLoopbackHttp }); } catch (e) { fail(e); return; }
      chain.push(`${u.protocol}//${u.host}${u.pathname}`);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, { method, headers: { 'Accept-Encoding': 'identity', 'User-Agent': userAgent, ...(accept ? { Accept: accept } : {}) }, timeout: idleTimeoutMs }, (res) => {
        const sc = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(sc)) {
          res.resume();
          // followRedirects=false: devolve o 3xx (cabeçalhos + Location) SEM contatar o destino
          if (!followRedirects) { done = true; resolve({ status: sc, headers: res.headers, body: null, final_url: chain[chain.length - 1], chain, location: res.headers.location ? new URL(res.headers.location, u).toString() : null }); return; }
          if (hops >= maxRedirects) { fail(new SetupError('TOO_MANY_REDIRECTS', `mais de ${maxRedirects} redirects`)); return; }
          if (!res.headers.location) { fail(new SetupError('BAD_REDIRECT', 'redirect sem Location')); return; }
          go(new URL(res.headers.location, u).toString(), hops + 1); return;
        }
        if (method === 'HEAD') { res.resume(); done = true; resolve({ status: sc, headers: res.headers, body: null, final_url: chain[chain.length - 1], chain }); return; }
        if (sc !== 200) { res.resume(); fail(new SetupError('HTTP_STATUS', `HTTP ${sc} em ${chain[chain.length - 1]}`)); return; }
        const enc = String(res.headers['content-encoding'] || 'identity').toLowerCase();
        if (enc !== 'identity') { res.resume(); fail(new SetupError('ENCODING_NOT_ALLOWED', `Content-Encoding ${enc} recusado`)); return; }
        const parts = []; let n = 0;
        res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(); fail(new SetupError('TOO_LARGE', `metadado acima de ${maxBytes} B`)); return; } parts.push(c); });
        res.on('end', () => { if (done) return; if (!res.complete) { fail(new SetupError('INCOMPLETE', 'resposta incompleta')); return; } done = true; resolve({ status: sc, headers: res.headers, body: Buffer.concat(parts), final_url: chain[chain.length - 1], chain }); });
        res.on('error', (e) => fail(new SetupError('NETWORK', e.code || e.message)));
      });
      req.on('timeout', () => { req.destroy(); fail(new SetupError('TIMEOUT', `sem resposta por ${idleTimeoutMs} ms`)); });
      req.on('error', (e) => fail(new SetupError('NETWORK', e.code || e.message)));
      req.end();
    };
    go(url, 0);
  });
}
export const fetchMetadata = (url, o) => request('GET', url, o);
export const headInfo = (url, o) => request('HEAD', url, o);
