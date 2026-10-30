// Texto (R8): normalização para BUSCA (NFC → minúsculas → sem diacríticos) e tokenização com offsets de caractere.
// O texto original nunca é alterado; a normalização só serve para comparar.

export const nfc = (s) => (typeof s === 'string' ? s.normalize('NFC') : s);
export const fold = (s) => nfc(String(s)).toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-.,/][\p{L}\p{N}]+)*%?/gu;

/** Palavras do texto com offsets [start, end) no texto original e forma normalizada. */
export function tokenize(text) {
  const out = [];
  for (const m of nfc(text).matchAll(WORD_RE)) out.push({ text: m[0], norm: fold(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}

export const normWords = (s) => tokenize(s).map((t) => t.norm);

/** Alinha tokens do texto com words com timing (mesma sequência normalizada). Retorna tokenIndex → wordIndex ou null. */
export function alignWords(tokens, words) {
  if (!words?.length) return null;
  const wt = words.map((w) => normWords(w.text));
  const map = new Array(tokens.length).fill(null);
  let ti = 0;
  for (let wi = 0; wi < wt.length; wi++) {
    for (const piece of wt[wi]) {
      if (ti >= tokens.length || tokens[ti].norm !== piece) return null;
      map[ti++] = wi;
    }
  }
  return ti === tokens.length ? map : null;
}
