// FONTE DE CONFIANÇA do Setup Manager (R12.5 B3): o lock OFICIAL distribuído com o pacote (setup/toolchain.lock.json,
// validado por schema + regras de política). NADA vindo do ambiente pode substituí-lo, trocar o npm ou liberar URLs de
// loopback — o antigo "modo de teste" por variáveis (BOLD_SETUP_TEST_LOOPBACK, BOLD_SETUP_LOCK, BOLD_SETUP_TEST_NPM)
// foi REMOVIDO de todo caminho de produção. Variáveis herdadas de um shell contaminado são ignoradas.
// Os testes usam INJEÇÃO EXPLÍCITA EM PROCESSO (injectTestTrust), chamada só por código da suíte (tests/, fora da
// distribuição) — a CLI, o doctor, o portão de execução e o bootstrap de produção não oferecem forma de ativá-la.
// Quem consegue chamar esta função já executa código dentro do processo do BOLD (e, portanto, já não depende dela).
import { loadLock, LOCK_FILE } from './lock.mjs';

/** Variáveis do antigo modo de teste, APOSENTADAS: nenhum código distribuído pode lê-las (o `bold dist audit` reprova).
 *  Este é o ÚNICO arquivo distribuído que contém esses nomes (como lista da política). */
export const RETIRED_TEST_VARS = Object.freeze(['BOLD_SETUP_TEST_LOOPBACK', 'BOLD_SETUP_LOCK', 'BOLD_SETUP_TEST_NPM', 'BOLD_BOOTSTRAP_TEST_URL',
  'BOLD_BOOTSTRAP_TEST_SHA256', 'BOLD_BOOTSTRAP_TEST_SIZE', 'BOLD_BOOTSTRAP_TEST_BIN', 'BOLD_BOOTSTRAP_TEST_TEAM']);

const NONE = Object.freeze({ lock: null, allowLoopback: false, npm: null, sandboxHooks: false });
let injected = NONE;

/** Lock de confiança: o oficial, salvo injeção EXPLÍCITA de teste em processo. */
export function trustedLock() { return injected.lock ?? loadLock(LOCK_FILE); }
/** URLs de loopback (servidor local de teste): só com injeção de teste. Produção: sempre false. */
export const trustAllowsLoopback = () => injected.allowLoopback === true;
/** npm substituto (npm FALSO da suíte): só com injeção de teste. Produção: sempre null (npm do Node gerenciado/PATH). */
export const trustNpmOverride = () => injected.npm;
/** Ganchos de teste do sandbox do teste leve (leitura extra, sandbox-exec alternativo, perfil transformado). */
export const trustAllowsSandboxHooks = () => injected.sandboxHooks === true;
/** true se há injeção de teste ativa (diagnóstico). */
export const testTrustActive = () => injected !== NONE;

/**
 * SÓ TESTES: injeta confiança de teste NESTE processo (mescla com a atual). Devolve a função que restaura o estado
 * anterior. `lock` precisa ser um lock carregado e válido (loadLock) — um lock inválido nunca é aceito.
 * @param {{lock?:{valid:boolean,data:object}, allowLoopback?:boolean, npm?:{cmd:string,args:string[]}|null, sandboxHooks?:boolean}} t
 */
export function injectTestTrust(t = {}) {
  if (t.lock && t.lock.valid !== true) throw new Error(`injectTestTrust: lock de teste inválido (${t.lock.errors?.[0] ?? 'sem validação'})`);
  const prev = injected;
  injected = Object.freeze({ ...prev, ...t });
  return () => { injected = prev; };
}
