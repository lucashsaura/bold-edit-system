// Limpeza de servidores HTTP deixados abertos pelo HyperFrames Core após falhas (R12.5C3b-C) — camada de integração
// do BOLD, SEM modificar o Core congelado. O `withJobPage` do Core abre o servidor do job ANTES do `launch` e fora do
// `try`: qualquer falha no launch (recusa de integridade, Chrome ausente, puppeteer quebrado) deixa o servidor escutando
// e o processo nunca termina. O BOLD não tem referência a esse servidor; por isso:
//  • canal OFICIAL do Node `net.server.listen` (node:diagnostics_channel) — notifica cada servidor que começa a escutar;
//  • AsyncLocalStorage — só entram os servidores criados DENTRO do contexto assíncrono da operação HyperFrames
//    (servidores de outras operações/contextos do mesmo processo nunca são registrados nem tocados);
//  • SÓ em caso de FALHA: fecha os registrados que ainda escutam. Sucesso → nada muda (o Core fecha os seus).
//  • o erro ORIGINAL é relançado (mesmo objeto, mesmo código); o relatório da limpeza vai em `err.serverCleanup`
//    (não enumerável). Falha ao fechar → `unref()` (o servidor não segura mais o processo) e nunca substitui o erro.
//  • espera limitada (timer `unref`): a limpeza não cria um novo travamento.
// Canal indisponível (Node sem o canal) → a operação roda igual, sem limpeza (comportamento anterior; nunca pior).
import dc from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();
let supported = null;   // null: ainda não assinado; true/false: canal disponível
let active = 0;
export const CLOSE_WAIT_MS = 2000;

function subscribe() {
  if (supported !== null) return supported;
  try {
    dc.tracingChannel('net.server.listen').subscribe({
      start() {}, end() {}, asyncEnd() {}, error() {},
      asyncStart(m) { const tracked = scope.getStore(); if (tracked && m?.server) tracked.add(m.server); },
    });
    supported = true;
  } catch { supported = false; }
  return supported;
}

/** Fecha UM servidor: derruba as conexões, `close()` com espera limitada. → null (fechado) ou o motivo da falha. */
function closeServer(srv) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(new Error(`close sem confirmação em ${CLOSE_WAIT_MS} ms`)), CLOSE_WAIT_MS); timer.unref();
    const done = (err) => { clearTimeout(timer); resolve(err ?? null); };
    try { srv.closeAllConnections?.(); srv.close(done); } catch (e) { done(e); }
  });
}

/**
 * Executa `fn` (operação HyperFrames do Core) e, se ela FALHAR, fecha os servidores que ela deixou abertos.
 * @template T @param {() => Promise<T>|T} fn @returns {Promise<T>}
 */
export async function withServerCleanup(fn) {
  const tracked = new Set(); subscribe(); active++;
  try {
    return await scope.run(tracked, fn);
  } catch (err) {
    const report = { supported, tracked: tracked.size, closed: 0, failed: [] };
    for (const srv of tracked) {
      if (!srv.listening) continue;   // o próprio Core fechou
      const why = await closeServer(srv);
      if (!why) { report.closed++; continue; }
      report.failed.push(String(why?.message ?? why));
      try { srv.unref(); } catch { /* sem handle: nada a segurar */ }
    }
    if (report.tracked && err && typeof err === 'object' && Object.isExtensible(err)) {
      try { Object.defineProperty(err, 'serverCleanup', { value: report, enumerable: false, configurable: true }); } catch { /* erro selado */ }
    }
    throw err;
  } finally { tracked.clear(); active--; }
}

/** Diagnóstico (testes): canal disponível e escopos em andamento. */
export const serverCleanupState = () => ({ supported, active });
