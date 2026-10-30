// DELIVERY MANIFEST — um JSON por encode criado pelo BOLD, ao lado do arquivo de saída.
// Caminhos: relativos ao PROJECT_ROOT quando possível; fora dele, só o nome do arquivo (nunca path pessoal).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function manifestPathFor(output) {
  const ext = path.extname(output);
  return path.join(path.dirname(output), `${path.basename(output, ext)}.delivery.json`);
}

export function portablePath(p, projectRoot) {
  if (!p) return null;
  const abs = path.resolve(p);
  if (projectRoot) {
    const rel = path.relative(path.resolve(projectRoot), abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { path: rel.split(path.sep).join('/'), base: 'PROJECT_ROOT' };
  }
  return { path: path.basename(abs), base: 'EXTERNAL' };
}

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

export function buildManifest({ kind, source, output, profile, fps, expectedFrames, meta, validation, ffmpegVersion, authorization, projectRoot, conversion = null, now = new Date() }) {
  const v = meta?.video || {};
  return {
    schema: 'bold.delivery.manifest/1',
    kind,
    timestamp: now.toISOString(),
    source: portablePath(source, projectRoot),
    output: portablePath(output, projectRoot),
    output_sha256: fs.existsSync(output) ? sha256File(output) : null,
    profile: profile ? { id: profile.id, version: profile.version } : null,
    fps,
    expected_frames: expectedFrames,
    actual_frames: meta?.nb_frames_counted ?? null,
    resolution: v.width ? { width: v.width, height: v.height } : null,
    codec: v.codec ?? null,
    codec_profile: v.profile ?? null,
    codec_tag: v.codec_tag ?? null,
    pix_fmt: v.pix_fmt ?? null,
    color: { primaries: v.color_primaries ?? null, transfer: v.color_transfer ?? null, space: v.color_space ?? null, range: v.color_range ?? null },
    alpha: profile ? { required: !!profile.alpha, capable: !!v.alpha_capable, mode: profile.alpha ? profile.alpha_mode : null } : { capable: !!v.alpha_capable },
    ffmpeg_version: ffmpegVersion,
    conversion,
    authorization: authorization ? {
      action: authorization.action, source: authorization.authorization_source, granted_by: authorization.granted_by ?? null,
      scope: authorization.scope ?? null, text: authorization.authorization_text ?? null, timestamp: authorization.timestamp,
    } : null,
    validation: validation ? { status: validation.status, summary: validation.summary, checks: validation.checks } : null,
  };
}

export function writeManifest(output, manifest) {
  const p = manifestPathFor(output);
  fs.writeFileSync(p, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return p;
}
