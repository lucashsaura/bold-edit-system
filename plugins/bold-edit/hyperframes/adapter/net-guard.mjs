// NETWORK GUARD (R6.0.1) — pré-carregado em TODO processo Node do CLI HyperFrames (NODE_OPTIONS=--import …).
// Qualquer conexão TCP/TLS/HTTP(S)/fetch/DNS para fora do loopback é BLOQUEADA e REGISTRADA (JSONL em
// BOLD_NET_GUARD_LOG). Loopback (127.0.0.1, ::1, localhost) e pipes/unix sockets continuam permitidos: o servidor de
// arquivos local e o CDP do Chrome usam loopback. Não depende de "estar offline": a tentativa em si vira evidência.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const LOG = process.env.BOLD_NET_GUARD_LOG || null;
// prova de ativação: cada processo Node que carregou o guard registra-se em BOLD_NET_GUARD_PROC_LOG
if (process.env.BOLD_NET_GUARD_PROC_LOG) try { fs.appendFileSync(process.env.BOLD_NET_GUARD_PROC_LOG, `${JSON.stringify({ kind: 'guard_loaded', pid: process.pid, argv: process.argv.slice(1, 3).map((a) => a.split(/[\\/]/).pop()) })}\n`); } catch { /* best-effort */ }
const LOOP = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::ffff:127.0.0.1']);
const isLoop = (h) => !h || LOOP.has(String(h).replace(/^\[|\]$/g, '')) || /^127\./.test(String(h));
function record(kind, target) {
  const entry = { kind, target: String(target), pid: process.pid, argv: process.argv.slice(1, 3).map((a) => a.split(/[\\/]/).pop()), blocked: true };
  if (LOG) try { fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`); } catch { /* log best-effort */ }
  const e = new Error(`BOLD_NET_GUARD: conexão bloqueada (${kind} → ${target})`); e.code = 'ECONNREFUSED'; return e;
}
function hostOf(args) {
  const a = args[0];
  if (a && typeof a === 'object' && !Array.isArray(a)) { if (a.path) return null; return a.host ?? a.hostname ?? 'localhost'; }
  if (typeof a === 'string' && !/^\d+$/.test(a)) return null; // unix socket / pipe
  return typeof args[1] === 'string' ? args[1] : 'localhost';
}
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const norm = Array.isArray(args[0]) ? [args[0][0]] : args; // Node normaliza para [[options, cb]]
  const h = hostOf(norm);
  const port = typeof norm[0] === 'object' ? norm[0]?.port : norm[0];
  if (h !== null && !isLoop(h)) { const e = record('tcp', `${h}:${port}`); process.nextTick(() => this.destroy(e)); return this; }
  return origConnect.apply(this, args);
};
const origTls = tls.connect;
tls.connect = function (...args) { const h = hostOf(args); if (h !== null && !isLoop(h)) throw record('tls', h); return origTls.apply(this, args); };
for (const mod of [http, https]) for (const fn of ['request', 'get']) {
  const orig = mod[fn];
  mod[fn] = function (...args) {
    const u = args[0] instanceof URL ? args[0] : typeof args[0] === 'string' ? new URL(args[0]) : null;
    const h = u ? u.hostname : args[0]?.hostname ?? args[0]?.host;
    if (h && !isLoop(h)) throw record(mod === https ? 'https' : 'http', u ? u.origin : h);
    return orig.apply(this, args);
  };
}
if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const u = new URL(typeof input === 'string' ? input : input?.url ?? String(input));
    if (!isLoop(u.hostname) && u.protocol !== 'data:' && u.protocol !== 'file:') return Promise.reject(record('fetch', u.origin));
    return origFetch.call(this, input, init);
  };
}
for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  const orig = dns[fn];
  dns[fn] = function (host, ...rest) { if (!isLoop(host)) { const cb = rest.find((x) => typeof x === 'function'); const e = record('dns', host); if (cb) { process.nextTick(() => cb(e)); return undefined; } throw e; } return orig.call(this, host, ...rest); };
  if (dns.promises?.[fn]) { const op = dns.promises[fn]; dns.promises[fn] = (host, ...rest) => (isLoop(host) ? op(host, ...rest) : Promise.reject(record('dns', host))); }
}
// importações ESM nomeadas (import { connect } from 'node:net') passam a ver as versões guardadas
syncBuiltinESMExports();
