// VALIDADOR CENTRAL — usado por `bold probe`, `bold qc` e pela entrega (encode/blur/fix-color).
// Regras ficam SÓ aqui. Cada check: {id, status: PASS|WARNING|FAIL, expected, actual, message}.

const FPS_TOL = 1e-6;

function chk(id, status, expected, actual, message) {
  return { id, status, expected: expected ?? null, actual: actual ?? null, message };
}

export function summarize(checks) {
  const s = { PASS: 0, WARNING: 0, FAIL: 0 };
  for (const c of checks) s[c.status] += 1;
  return { status: s.FAIL ? 'FAIL' : s.WARNING ? 'WARNING' : 'PASS', summary: s };
}

/**
 * @param {object} meta     saída de probeFile (+ nb_frames_counted, se contado)
 * @param {object} [opts]
 * @param {object} [opts.profile]          perfil de entrega (getProfile)
 * @param {number} [opts.expectedFrames]
 * @param {number} [opts.fps]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 */
export function validateMedia(meta, { profile = null, expectedFrames = null, fps = null, width = null, height = null } = {}) {
  const checks = [];
  const v = meta.video;
  if (!v) {
    checks.push(chk('video.stream', 'FAIL', 'video', 'nenhum stream de vídeo', 'arquivo sem stream de vídeo'));
    return { ...summarize(checks), checks };
  }
  checks.push(chk('video.stream', 'PASS', 'video', v.codec, 'stream de vídeo presente'));

  // Perfil: container/codec/profile/tag/pix_fmt/alpha
  if (profile) {
    const okContainer = String(meta.container || '').split(',').includes(profile.container);
    checks.push(chk('container', okContainer ? 'PASS' : 'FAIL', profile.container, meta.container, 'container'));
    checks.push(chk('codec', v.codec === profile.codec_name ? 'PASS' : 'FAIL', profile.codec_name, v.codec, 'codec'));
    checks.push(chk('codec.profile', v.profile === profile.expect_profile ? 'PASS' : 'FAIL', profile.expect_profile, v.profile, 'profile do codec'));
    checks.push(chk('codec.tag', v.codec_tag === profile.expect_codec_tag ? 'PASS' : 'FAIL', profile.expect_codec_tag, v.codec_tag, 'codec tag (fourcc)'));
    checks.push(chk('pix_fmt', v.pix_fmt === profile.pix_fmt ? 'PASS' : 'FAIL', profile.pix_fmt, v.pix_fmt, 'pixel format'));
    if (profile.alpha) checks.push(chk('alpha.capable', v.alpha_capable ? 'PASS' : 'FAIL', true, v.alpha_capable, 'pixel format com canal alpha'));
  }

  // Cor — com perfil: obrigatório (FAIL). Sem perfil: informativo (WARNING se não for BT.709 tv).
  const want = profile?.color || { primaries: 'bt709', transfer: 'bt709', space: 'bt709', range: 'tv' };
  const sev = profile ? 'FAIL' : 'WARNING';
  const colorPairs = [
    ['color.primaries', want.primaries, v.color_primaries],
    ['color.transfer', want.transfer, v.color_transfer],
    ['color.space', want.space, v.color_space],
    ['color.range', want.range, v.color_range],
  ];
  for (const [id, exp, act] of colorPairs) {
    checks.push(chk(id, act === exp ? 'PASS' : sev, exp, act,
      act === exp ? 'tag explícita correta' : `tag ${act === 'unknown' ? 'ausente' : 'divergente'}${profile ? ' — perfil exige' : ''}`));
  }

  // Dimensões
  if (width != null) checks.push(chk('width', v.width === width ? 'PASS' : 'FAIL', width, v.width, 'largura'));
  if (height != null) checks.push(chk('height', v.height === height ? 'PASS' : 'FAIL', height, v.height, 'altura'));

  // FPS
  if (fps != null) {
    const ok = v.fps != null && Math.abs(v.fps - fps) < FPS_TOL;
    checks.push(chk('fps', ok ? 'PASS' : 'FAIL', fps, v.fps, `r_frame_rate ${v.r_frame_rate}`));
  }

  // Frame count: nunca confiar em duration × fps
  if (expectedFrames != null) {
    if (meta.nb_frames_counted == null) {
      checks.push(chk('frames.count', 'FAIL', expectedFrames, null, 'contagem real de frames indisponível'));
    } else {
      checks.push(chk('frames.count', meta.nb_frames_counted === expectedFrames ? 'PASS' : 'FAIL', expectedFrames, meta.nb_frames_counted,
        meta.nb_frames_counted === expectedFrames ? 'frames reais = esperados' : 'EXPECTED_FRAMES ≠ ACTUAL_FRAMES'));
    }
  }
  if (meta.nb_frames_counted != null && v.nb_frames_header != null && meta.nb_frames_counted !== v.nb_frames_header) {
    checks.push(chk('frames.header', 'WARNING', meta.nb_frames_counted, v.nb_frames_header, 'cabeçalho diverge da contagem real'));
  }

  // Streams inesperados
  if (meta.audio_streams > 0) {
    const allow = profile ? profile.allow_audio : true;
    checks.push(chk('streams.audio', allow ? 'PASS' : 'WARNING', allow ? 'qualquer' : 0, meta.audio_streams, allow ? 'áudio presente' : 'stream de áudio inesperado (remova com -an)'));
  }
  if (meta.other_streams.length) {
    checks.push(chk('streams.other', 'WARNING', [], meta.other_streams, 'streams extras (dados/timecode/legenda)'));
  }

  return { ...summarize(checks), checks };
}
