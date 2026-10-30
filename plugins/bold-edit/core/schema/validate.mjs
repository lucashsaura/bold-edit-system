// Validador mínimo de JSON Schema (subconjunto do draft 2020-12), sem dependências.
// Suporta: $ref local (#/...), type, const, enum, properties, required,
// additionalProperties (bool|schema), patternProperties, items, minItems, maxItems,
// uniqueItems, minLength, maxLength, pattern, minimum, maximum, exclusiveMinimum,
// exclusiveMaximum, anyOf, oneOf, allOf.

export function validate(schema, data) {
  const errors = [];
  walk(schema, data, '$', schema, errors);
  return errors;
}

export function isValid(schema, data) {
  return validate(schema, data).length === 0;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v, t) {
  const tv = typeOf(v);
  if (t === 'number') return tv === 'number' || tv === 'integer';
  return tv === t;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#')) throw new Error(`$ref externo não suportado: ${ref}`);
  const parts = ref.slice(1).split('/').filter(Boolean)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const p of parts) {
    if (node == null || !(p in node)) throw new Error(`$ref não resolvido: ${ref}`);
    node = node[p];
  }
  return node;
}

function walk(s, v, p, root, errors) {
  if (s === true || s === undefined) return;
  if (s === false) { errors.push(`${p}: não permitido`); return; }
  if (s.$ref) { walk(resolveRef(root, s.$ref), v, p, root, errors); return; }

  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => matchesType(v, t))) {
      errors.push(`${p}: esperado ${types.join('|')}, recebido ${typeOf(v)}`);
      return;
    }
  }
  if ('const' in s && !deepEqual(v, s.const)) errors.push(`${p}: deve ser ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e) => deepEqual(e, v))) errors.push(`${p}: valor fora de ${JSON.stringify(s.enum)}`);

  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) errors.push(`${p}: menor que ${s.minLength} caracteres`);
    if (s.maxLength != null && v.length > s.maxLength) errors.push(`${p}: maior que ${s.maxLength} caracteres`);
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${p}: não casa com /${s.pattern}/`);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) errors.push(`${p}: < ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) errors.push(`${p}: > ${s.maximum}`);
    if (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) errors.push(`${p}: <= ${s.exclusiveMinimum}`);
    if (s.exclusiveMaximum != null && v >= s.exclusiveMaximum) errors.push(`${p}: >= ${s.exclusiveMaximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errors.push(`${p}: menos de ${s.minItems} itens`);
    if (s.maxItems != null && v.length > s.maxItems) errors.push(`${p}: mais de ${s.maxItems} itens`);
    if (s.uniqueItems) {
      const seen = new Set(v.map((x) => JSON.stringify(x)));
      if (seen.size !== v.length) errors.push(`${p}: itens repetidos`);
    }
    if (s.items) v.forEach((item, i) => walk(s.items, item, `${p}[${i}]`, root, errors));
  }
  if (typeOf(v) === 'object') {
    for (const req of s.required || []) {
      if (!(req in v)) errors.push(`${p}: campo obrigatório ausente "${req}"`);
    }
    const props = s.properties || {};
    const patterns = Object.entries(s.patternProperties || {}).map(([k, sub]) => [new RegExp(k, 'u'), sub]);
    for (const [k, val] of Object.entries(v)) {
      const kp = `${p}.${k}`;
      let matched = false;
      if (k in props) { walk(props[k], val, kp, root, errors); matched = true; }
      for (const [re, sub] of patterns) {
        if (re.test(k)) { walk(sub, val, kp, root, errors); matched = true; }
      }
      if (!matched && 'additionalProperties' in s) {
        if (s.additionalProperties === false) errors.push(`${kp}: campo não permitido`);
        else walk(s.additionalProperties, val, kp, root, errors);
      }
    }
  }
  if (s.allOf) s.allOf.forEach((sub) => walk(sub, v, p, root, errors));
  if (s.anyOf) {
    const ok = s.anyOf.some((sub) => { const e = []; walk(sub, v, p, root, e); return e.length === 0; });
    if (!ok) errors.push(`${p}: não satisfaz nenhuma alternativa (anyOf)`);
  }
  if (s.oneOf) {
    const n = s.oneOf.filter((sub) => { const e = []; walk(sub, v, p, root, e); return e.length === 0; }).length;
    if (n !== 1) errors.push(`${p}: deve satisfazer exatamente 1 alternativa (oneOf), satisfez ${n}`);
  }
}
