// Perfis de entrega (versionados em profiles.json) e construção dos argumentos de encode.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = JSON.parse(fs.readFileSync(path.join(HERE, 'profiles.json'), 'utf8'));

export const PROFILES = Object.freeze(DOC.profiles);
export const PROFILE_IDS = Object.freeze(Object.keys(DOC.profiles));

/** Aceita o id canônico ou o alias em minúsculas com hífen (ex.: alpha-4444-bt709). */
export function getProfile(id) {
  if (!id) return null;
  const key = String(id).trim().toUpperCase().replace(/-/g, '_');
  const p = PROFILES[key];
  if (!p) throw new Error(`perfil desconhecido: ${id} (válidos: ${PROFILE_IDS.join(', ')})`);
  return { id: key, ...p };
}

const SCALE_FLAGS = 'accurate_rnd+full_chroma_int+bitexact';

/**
 * Filtro de conversão RGB (full range) → YCbCr BT.709 limited, com setparams explícito.
 * `inMatrix`/`inRange` permitem conversões de legado (ex.: decodificar como BT.601).
 */
export function colorFilter(profile, { source = 'rgb', inMatrix = null, inRange = null } = {}) {
  const c = profile.color;
  const set = `setparams=range=${c.range}:color_primaries=${c.primaries}:color_trc=${c.transfer}:colorspace=${c.space}`;
  if (source === 'rgb') {
    return `scale=in_range=full:out_range=${c.range}:out_color_matrix=${c.space}:flags=${SCALE_FLAGS},format=${profile.pix_fmt},${set}`;
  }
  // source === 'yuv': decodifica explicitamente (matriz/range informados) → RGB 16 bit → BT.709
  const mid = profile.alpha ? 'gbrap16le' : 'gbrp16le';
  return `scale=in_color_matrix=${inMatrix}:in_range=${inRange}:flags=${SCALE_FLAGS},format=${mid},`
    + `scale=out_color_matrix=${c.space}:out_range=${c.range}:flags=${SCALE_FLAGS},format=${profile.pix_fmt},${set}`;
}

/** Argumentos de codec/tags do perfil (sem entrada/saída). */
export function codecArgs(profile) {
  const c = profile.color;
  const args = ['-c:v', profile.encoder, '-profile:v', profile.encoder_profile, '-vendor', profile.vendor];
  if (profile.alpha) args.push('-alpha_bits', String(profile.alpha_bits));
  args.push('-pix_fmt', profile.pix_fmt,
    '-color_primaries', c.primaries, '-color_trc', c.transfer, '-colorspace', c.space, '-color_range', c.range,
    '-movflags', '+write_colr',
    // determinismo e ausência de metadados variáveis/streams extras
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', '-an', '-sn', '-dn');
  return args;
}
