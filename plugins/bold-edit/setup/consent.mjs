// Consentimento EXPLÍCITO de licença (R12.4) — necessário antes de instalar componentes com portão de licença (Remotion).
// O BOLD NÃO concede licença: cada usuário/empresa declara a PRÓPRIA base de elegibilidade. A licença da Bold não cobre terceiros.
// Registro em <toolchain>/consent.json (atômico), vinculado à versão e ao hash do texto mostrado. Nunca é inferido.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SetupError } from './errors.mjs';
import { appendSetupLog } from './log.mjs';

export const CONSENT_FILE = 'consent.json';

export const LICENSES = Object.freeze({
  remotion: {
    id: 'remotion-license',
    terms_version: '2026-10 (remotion.dev/license; LICENSE.md do repositório remotion-dev/remotion)',
    url: 'https://www.remotion.dev/license',
    summary: [
      'O Remotion NÃO é software livre irrestrito: o uso é regido pela Remotion License.',
      'Uso gratuito: pessoa física; empresa com até 3 funcionários; organização sem fins lucrativos; avaliação.',
      'Empresas com 4 ou mais pessoas precisam de uma Company License (remotion.pro).',
      'A licença da Bold NÃO cobre você nem sua empresa: cada usuário verifica e responde pela PRÓPRIA elegibilidade.',
      'Mudanças futuras dos termos (ex.: Remotion 5) podem exigir novo aceite.',
    ],
    bases: {
      individual: 'sou pessoa física usando em nome próprio',
      'small-company': 'minha empresa tem no máximo 3 funcionários',
      nonprofit: 'organização sem fins lucrativos',
      evaluation: 'uso apenas para avaliação, sem produção',
      'company-license': 'minha empresa possui Company License válida do Remotion',
    },
  },
});

export const consentText = (component) => {
  const L = LICENSES[component]; if (!L) throw new SetupError('USAGE', `sem portão de licença para ${component}`);
  return [`Licença: ${L.id} · termos ${L.terms_version}`, `Texto completo: ${L.url}`, ...L.summary.map((s) => `  • ${s}`)].join('\n');
};
export const textHash = (component) => crypto.createHash('sha256').update(consentText(component)).digest('hex');

export function readConsents(root) {
  const f = path.join(root, CONSENT_FILE);
  if (!fs.existsSync(f)) return { schema: 'bold.setup-consent/1', consents: [] };
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (d?.schema !== 'bold.setup-consent/1' || !Array.isArray(d.consents)) throw new SetupError('CONSENT_INVALID', 'consent.json inválido (nada será alterado)');
  return d;
}

/** Consentimento VÁLIDO = mesmo componente, mesma licença e MESMO texto (hash) apresentado agora; não revogado. */
export function consentFor(root, component) {
  const L = LICENSES[component]; if (!L) return null;
  let d; try { d = readConsents(root); } catch { return null; }
  return d.consents.filter((c) => c.component === component && c.license === L.id && c.text_sha256 === textHash(component) && !c.revoked_at).pop() || null;
}

export function recordConsent({ root, component, basis, now = new Date(), home }) {
  const L = LICENSES[component]; if (!L) throw new SetupError('USAGE', `sem portão de licença para ${component}`);
  if (!L.bases[basis]) throw new SetupError('USAGE', `base inválida para ${component}: ${basis} (válidas: ${Object.keys(L.bases).join(', ')})`);
  fs.mkdirSync(root, { recursive: true });
  const d = readConsents(root);
  const rec = { component, license: L.id, terms_version: L.terms_version, url: L.url, basis, basis_text: L.bases[basis], text_sha256: textHash(component),
    accepted_at: now.toISOString(), statement: 'aceite explícito do usuário; a licença da Bold não cobre terceiros' };
  d.consents.push(rec);
  const f = path.join(root, CONSENT_FILE); const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(d, null, 2)}\n`); fs.renameSync(tmp, f);
  appendSetupLog(root, { event: 'consent', component, license: L.id, basis, result: 'ACCEPTED' }, { home, now });
  return rec;
}

export function revokeConsent({ root, component, now = new Date(), home }) {
  if (!fs.existsSync(path.join(root, CONSENT_FILE))) return { revoked: 0 };
  const d = readConsents(root); let n = 0;
  for (const c of d.consents) if (c.component === component && !c.revoked_at) { c.revoked_at = now.toISOString(); n++; }
  const f = path.join(root, CONSENT_FILE); const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(d, null, 2)}\n`); fs.renameSync(tmp, f);
  appendSetupLog(root, { event: 'consent', component, result: 'REVOKED', count: n }, { home, now });
  return { revoked: n };
}
