/* BOLD HYPERFRAMES RUNTIME V1 — inlinado em toda composição gerada (sem dependências, sem GSAP, sem rede).
 * Entrada: window.__BOLD_PLAN__ (bold.hyperframes.spec/0). Estado visual = função PURA do frame (t × fps).
 * 1) espera as fontes do manifesto (FontFace já declaradas por @font-face) — família ausente = erro (fail-closed)
 * 2) LAYOUT de repouso medido no DOM real: posições por caractere via Range (kerning, features e eixos exatos),
 *    baseline por sonda, ascent/descent pela caixa da fonte, tinta por canvas (actualBoundingBox)
 * 3) resolve as referências de texto (frame space) na ordem topológica do plano → formas do TYPE_LOCKUP
 * 4) registra um objeto timeline-like em window.__timelines[id] (o HyperFrames faz seek por totalTime(t)) */
(function () {
  'use strict';
  var PLAN = window.__BOLD_PLAN__; var C = PLAN.composition; var FPS = C.fps;
  var root = document.getElementById('root');

  // ── kit ──
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function progress(f, start, dur) { return dur <= 0 ? (f >= start ? 1 : 0) : clamp((f - start) / dur, 0, 1); }
  function bezier(e) {
    var x1 = e[0], y1 = e[1], x2 = e[2], y2 = e[3];
    function bx(t) { return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t; }
    function by(t) { return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t; }
    function dx(t) { return 3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1; }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x; for (var i = 0; i < 8; i++) { var d = dx(t); if (Math.abs(d) < 1e-7) break; t -= (bx(t) - x) / d; }
      if (t < 0 || t > 1 || Math.abs(bx(t) - x) > 1e-6) { var lo = 0, hi = 1; t = x; for (var k = 0; k < 40; k++) { if (bx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
      return by(t);
    };
  }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6d2b79f5) >>> 0; var x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  function fontStr(st, px) { return st.style + ' ' + st.weight + ' ' + px + 'px "' + st.family + '"'; }
  function featureCss(o) { var k = Object.keys(o).sort(); return k.length ? k.map(function (t) { return '"' + t + '" ' + o[t]; }).join(', ') : 'normal'; }
  function el(parent, css, text) { var d = document.createElement('div'); d.style.cssText = 'position:absolute;margin:0;padding:0;' + (css || ''); if (text !== undefined) d.textContent = text; parent.appendChild(d); return d; }
  function textCss(st, px, ls, splitSafe) {
    return 'font:' + fontStr(st, px) + ';white-space:pre;color:' + st.color + ';letter-spacing:' + ls + 'px;font-kerning:normal;' +
      'font-feature-settings:' + featureCss(st.features) + ';font-variation-settings:' + featureCss(st.variation) + ';' + (splitSafe ? 'font-variant-ligatures:none;' : '');
  }
  var cv = document.createElement('canvas').getContext('2d');

  /** Mede uma linha no DOM real (estado de repouso). x[i] relativo ao início do avanço; inclui tracking. */
  function measureLine(text, st, px, lsPx, splitSafe) {
    var probe = el(document.body, 'left:0;top:0;visibility:hidden;line-height:normal;' + textCss(st, px, lsPx, splitSafe));
    var span = document.createElement('span'); span.textContent = text; probe.appendChild(span);
    var base = document.createElement('span'); base.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; probe.appendChild(base);
    var r0 = span.getBoundingClientRect(); var tn = span.firstChild; var rg = document.createRange(); var chars = Array.from(text); var x = []; var off = 0;
    for (var i = 0; i < chars.length; i++) { rg.setStart(tn, off); rg.setEnd(tn, off + chars[i].length); x.push(rg.getBoundingClientRect().left - r0.left); off += chars[i].length; }
    var adv = r0.width - lsPx; // avanço tipográfico sem o tracking final (CSS soma depois do último caractere)
    cv.font = fontStr(st, px); cv.fontKerning = 'normal'; if ('letterSpacing' in cv) cv.letterSpacing = '0px';
    var fm = cv.measureText('Hg'); var asc = fm.fontBoundingBoxAscent; var desc = fm.fontBoundingBoxDescent;
    var ink = chars.map(function (ch, i) { var m = cv.measureText(ch); return { l: x[i] - m.actualBoundingBoxLeft, r: x[i] + m.actualBoundingBoxRight, t: m.actualBoundingBoxAscent, b: m.actualBoundingBoxDescent, blank: !ch.trim() }; });
    document.body.removeChild(probe);
    return { chars: chars, x: x, adv: adv, asc: asc, desc: desc, ink: ink };
  }

  function placeBox(box, w, h, a) {
    var ax = /left$/.test(a) ? 0 : /right$/.test(a) ? 1 : 0.5; var ay = /^top/.test(a) ? 0 : /^bottom/.test(a) ? 1 : 0.5;
    return { x: box.x + (box.w - w) * ax, y: box.y + (box.h - h) * ay, w: w, h: h };
  }

  /** Layout de repouso de uma camada de texto → métricas em FRAME SPACE (px). */
  function layoutLayer(L) {
    var st = L.style; var split = L.pattern === 'TYPE_CASCADE';
    var px;
    if (st.size.px) px = st.size.px;
    else { // fit: largura escala linearmente com o tamanho (hinting desligado) → medida em 100 px
      var w100 = Math.max.apply(null, L.lines.map(function (s) { return measureLine(s, st, 100, st.tracking_em * 100, split).adv; }));
      px = clamp(Math.floor(st.size.fit.width_px * 100 / w100 * 100) / 100, st.size.fit.min_px, st.size.fit.max_px);
    }
    var ls = st.tracking_em * px; var lead = st.line_height * px;
    var ms = L.lines.map(function (s) { return measureLine(s, st, px, ls, split); });
    var asc = ms[0].asc; var desc = ms[0].desc;
    var blockW = Math.max.apply(null, ms.map(function (m) { return m.adv; }));
    var blockH = asc + desc + (ms.length - 1) * lead;
    var b = placeBox(L.box, blockW, blockH, L.anchor);
    var lines = []; var chars = []; var bi = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    ms.forEach(function (m, k) {
      var lx = b.x + (L.align === 'center' ? (blockW - m.adv) / 2 : L.align === 'right' ? blockW - m.adv : 0); var base = b.y + asc + k * lead;
      var li = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
      m.chars.forEach(function (ch, i) {
        var k2 = m.ink[i]; var c = { ch: ch, x: lx + m.x[i], y: base, ink: { left: lx + k2.l, right: lx + k2.r, top: base - k2.t, bottom: base + k2.b }, blank: k2.blank, line: k };
        chars.push(c); if (!k2.blank) { li.l = Math.min(li.l, c.ink.left); li.r = Math.max(li.r, c.ink.right); li.t = Math.min(li.t, c.ink.top); li.b = Math.max(li.b, c.ink.bottom); }
      });
      lines.push({ x: lx, baseline: base, adv: m.adv, ink: { left: li.l, right: li.r, top: li.t, bottom: li.b }, chars: m.chars.length });
      bi.l = Math.min(bi.l, li.l); bi.r = Math.max(bi.r, li.r); bi.t = Math.min(bi.t, li.t); bi.b = Math.max(bi.b, li.b);
    });
    return { px: px, ls: ls, lead: lead, asc: asc, desc: desc, block: b, lines: lines, chars: chars, ink: { left: bi.l, right: bi.r, top: bi.t, bottom: bi.b }, measured: ms };
  }

  // ── referências (frame space, repouso) ──
  var LAYOUT = {}; var SHAPES = {};
  function metricOf(R) {
    if (R.scope === 'shape') { var s = SHAPES[R.layer + '.shape.' + R.shape]; if (!s) throw new Error('ref não resolvida (ordem): ' + R.text); return s[R.metric]; }
    var T = LAYOUT[R.layer]; if (!T) throw new Error('ref para camada sem layout: ' + R.text);
    var node = R.scope === 'block' ? { baseline: T.lines[0].baseline, ink: T.ink, adv: { left: T.block.x, right: T.block.x + T.block.w } } : R.scope === 'line' ? T.lines[R.index] : T.chars[R.index];
    var ink = node.ink; var m = R.metric;
    if (m === 'baseline') return R.scope === 'char' ? node.y : node.baseline;
    if (m.indexOf('ink.') === 0) return ink[m.slice(4)];
    if (m === 'center') return [(ink.left + ink.right) / 2, (ink.top + ink.bottom) / 2];
    if (m.indexOf('advance.') === 0) return node.adv[m.slice(8)];
    if (m === 'origin') return R.scope === 'char' ? [node.x, node.y] : [node.x, node.baseline];
    throw new Error('métrica desconhecida ' + R.text);
  }
  var RE = new RegExp(window.__BOLD_REF_RE__);
  function parseRef(s) { // mesma gramática do compilador (refs.mjs) — o compilador já validou tudo
    var m = s.match(RE); var r;
    if (m[2]) r = { scope: 'block', metric: 'baseline' }; else if (m[3]) r = { scope: 'block', metric: 'ink.' + m[3] }; else if (m[4]) r = { scope: 'block', metric: 'center' };
    else if (m[5]) r = { scope: 'block', metric: 'advance.' + m[5] };
    else if (m[6] !== undefined) r = { scope: 'line', index: +m[6], metric: m[7] ? 'baseline' : m[8] ? 'ink.' + m[8] : m[9] ? 'center' : 'origin' };
    else if (m[10] !== undefined) r = { scope: 'char', index: +m[10], metric: m[11] ? 'baseline' : m[12] ? 'ink.' + m[12] : m[13] ? 'center' : 'origin' };
    else r = { scope: 'shape', shape: m[14], metric: m[15] };
    r.layer = m[1]; r.axis = m[16] || null; r.text = s; return r;
  }
  function evalExpr(ex, emPx) {
    var R = parseRef(ex.ref); var v = metricOf(R);
    if (R.axis) v = v[R.axis === 'x' ? 0 : 1];
    if (ex.type === 'point') return [v[0] + ex.offset[0].px + ex.offset[0].em * emPx, v[1] + ex.offset[1].px + ex.offset[1].em * emPx];
    return v + ex.offset[0].px + ex.offset[0].em * emPx;
  }
  function len(spec, emPx) { return spec.px + spec.em * emPx; }

  // ── construção ──
  var BUILT = [];
  function order(n, mode) { var a = []; for (var i = 0; i < n; i++) a.push(mode === 'end' ? n - 1 - i : mode === 'center' ? Math.abs(i - (n - 1) / 2) * 2 : i); return a; }
  function build(L) {
    var lay = LAYOUT[L.id]; var st = L.style; var m = L.motion;
    var host = el(root, 'left:0;top:0;width:' + C.width + 'px;height:' + C.height + 'px;'); host.dataset.layer = L.id;
    var B = { L: L, host: host, ease: bezier(m.ease), exitEase: bezier(m.exit_ease) };
    var boxH = lay.asc + lay.desc;
    if (L.pattern === 'TYPE_CASCADE') {
      var r = rng(L.seed); var ord = order(lay.chars.length, m.order);
      B.items = lay.chars.map(function (c, i) {
        var d = el(host, 'left:' + c.x + 'px;top:' + (c.y - lay.asc) + 'px;line-height:' + boxH + 'px;transform-origin:50% ' + (lay.asc / boxH * 100) + '%;' + textCss(st, lay.px, 0, true), c.ch);
        d.style.fontKerning = 'none';
        return { el: d, o: ord[i], v: { x: r() * 2 - 1, y: r() * 2 - 1, rotate: r() * 2 - 1, scale: r() * 2 - 1 } };
      });
    } else if (L.pattern === 'TYPE_MASK_LINES' || L.pattern === 'TYPE_LOCKUP') {
      B.items = lay.lines.map(function (ln, k) {
        var win = el(host, 'left:0;width:' + C.width + 'px;top:' + (ln.baseline - lay.asc) + 'px;height:' + boxH + 'px;overflow:hidden;');
        var inner = el(win, 'left:' + ln.x + 'px;top:0;line-height:' + boxH + 'px;' + textCss(st, lay.px, lay.ls, false), L.lines[k]);
        return { el: inner, win: win, h: boxH, k: k };
      });
      if (L.pattern === 'TYPE_LOCKUP') B.shapes = (L.shapes || []).map(function (s) { return buildShape(L, s, host); });
    } else if (L.pattern === 'TYPE_TRACK') {
      var ln = lay.lines[0]; var j = L.align === 'center' ? 'center' : L.align === 'right' ? 'flex-end' : 'flex-start';
      var row = el(host, 'left:' + lay.block.x + 'px;width:' + lay.block.w + 'px;top:' + (ln.baseline - lay.asc) + 'px;height:' + boxH + 'px;display:flex;justify-content:' + j + ';');
      var span = document.createElement('span'); span.style.cssText = 'line-height:' + boxH + 'px;' + textCss(st, lay.px, lay.ls, false); span.textContent = L.lines[0]; row.appendChild(span);
      B.span = span;
    } else if (L.pattern === 'TYPE_PLANE') {
      var P = L.plane; var pad = P.padding_em * lay.px; var b = lay.block;
      var pr = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
      var lens = el(host, 'left:0;top:0;width:' + C.width + 'px;height:' + C.height + 'px;perspective:' + P.perspective_px + 'px;perspective-origin:' + (pr.x + pr.w / 2) + 'px ' + (pr.y + pr.h / 2) + 'px;');
      var plane = el(lens, 'left:' + pr.x + 'px;top:' + pr.y + 'px;width:' + pr.w + 'px;height:' + pr.h + 'px;transform-origin:' + (P.origin[0] * 100) + '% ' + (P.origin[1] * 100) + '%;' + (P.plate ? 'background:' + P.plate + ';' : ''));
      lay.lines.forEach(function (ln, k) { el(plane, 'left:' + (ln.x - pr.x) + 'px;top:' + (ln.baseline - lay.asc - pr.y) + 'px;line-height:' + boxH + 'px;' + textCss(st, lay.px, lay.ls, false), L.lines[k]); });
      B.plane = plane; B.planeRect = pr;
    }
    return B;
  }
  function buildShape(L, s, host) {
    var em = LAYOUT[L.id].px; var g = s.geom; var th = len(s.thickness, em); var d; var info;
    if (s.kind === 'line') {
      var x1 = evalExpr(g.x1, em), y1 = evalExpr(g.y1, em), x2 = evalExpr(g.x2, em), y2 = evalExpr(g.y2, em);
      var L2 = Math.hypot(x2 - x1, y2 - y1); var ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      d = el(host, 'left:' + x1 + 'px;top:' + (y1 - th / 2) + 'px;width:' + L2 + 'px;height:' + th + 'px;background:' + s.color + ';transform-origin:0 50%;');
      info = { start: [x1, y1], end: [x2, y2], center: [(x1 + x2) / 2, (y1 + y2) / 2], rot: ang };
    } else if (s.kind === 'rect') {
      var l = evalExpr(g.left, em), r = evalExpr(g.right, em), t = evalExpr(g.top, em), b = evalExpr(g.bottom, em);
      d = el(host, 'left:' + l + 'px;top:' + t + 'px;width:' + (r - l) + 'px;height:' + (b - t) + 'px;box-sizing:border-box;' + (s.fill ? 'background:' + s.color + ';' : 'border:' + th + 'px solid ' + s.color + ';'));
      info = { start: [l, t], end: [r, b], center: [(l + r) / 2, (t + b) / 2] };
    } else {
      var c = evalExpr(g.center, em); var rad = len(s.r, em);
      d = el(host, 'left:' + (c[0] - rad) + 'px;top:' + (c[1] - rad) + 'px;width:' + 2 * rad + 'px;height:' + 2 * rad + 'px;border-radius:50%;box-sizing:border-box;' + (s.fill ? 'background:' + s.color + ';' : 'border:' + th + 'px solid ' + s.color + ';'));
      info = { start: [c[0] - rad, c[1]], end: [c[0] + rad, c[1]], center: c };
    }
    SHAPES[L.id + '.shape.' + s.id] = info;
    return { s: s, el: d, info: info };
  }

  // ── estado em função do frame ──
  function seekFrame(f) {
    BUILT.forEach(function (B) {
      var L = B.L; var m = L.motion; var vis = f >= L.in_f && f < L.out_f; B.host.style.visibility = vis ? 'visible' : 'hidden';
      var t0 = L.in_f + m.delay_f; var px = m.exit_f > 0 ? B.exitEase(progress(f, L.out_f - m.exit_f, m.exit_f)) : 0; var lay = LAYOUT[L.id];
      if (L.pattern === 'TYPE_CASCADE') {
        B.items.forEach(function (it) {
          var pe = B.ease(progress(f, t0 + it.o * m.stagger_f, m.enter_f)); var q = pe * (1 - px); var F = m.from; var V = m.variation; var e = lay.px;
          var tx = (1 - q) * (F.x + V.x * it.v.x) * e; var ty = (1 - q) * (F.y + V.y * it.v.y) * e; var rot = (1 - q) * (F.rotate + V.rotate * it.v.rotate);
          var sc = lerp(F.scale + V.scale * it.v.scale, 1, q); var op = lerp(F.opacity, 1, q);
          it.el.style.transform = q >= 1 ? 'none' : 'translate(' + tx + 'px,' + ty + 'px) rotate(' + rot + 'deg) scale(' + sc + ')'; it.el.style.opacity = String(op);
        });
      } else if (L.pattern === 'TYPE_MASK_LINES') {
        var dir = m.direction === 'up' ? 1 : -1;
        B.items.forEach(function (it) {
          var pe = B.ease(progress(f, t0 + it.k * m.stagger_f, m.enter_f)); var dist = m.distance * it.h;
          var y = (1 - pe) * dist * dir - px * dist * dir; it.el.style.transform = y === 0 ? 'none' : 'translateY(' + y + 'px)';
          it.el.style.opacity = m.fade ? String(pe * (1 - px)) : '1';
        });
      } else if (L.pattern === 'TYPE_TRACK') {
        var pe2 = B.ease(progress(f, t0, m.enter_f)); var em = lerp(m.tracking_from_em, m.tracking_to_em, pe2 * (1 - px)) * lay.px;
        B.span.style.letterSpacing = em + 'px'; B.span.style.marginRight = (-em) + 'px';
        B.span.style.opacity = String((m.fade ? pe2 : 1) * (1 - px));
      } else if (L.pattern === 'TYPE_PLANE') {
        var P = L.plane; var F2 = m.from; var q2 = B.ease(progress(f, t0, m.enter_f)) * (1 - px);
        var tr = 'translate3d(' + lerp(F2.translate_x_px, 0, q2) + 'px,' + lerp(F2.translate_y_px, 0, q2) + 'px,' + lerp(F2.translate_z_px, P.translate_z_px, q2) + 'px) ' +
          'rotateX(' + lerp(F2.rotate_x, P.rotate_x, q2) + 'deg) rotateY(' + lerp(F2.rotate_y, P.rotate_y, q2) + 'deg) rotateZ(' + lerp(F2.rotate_z, P.rotate_z, q2) + 'deg) scale(' + lerp(F2.scale, P.scale, q2) + ')';
        B.plane.style.transform = tr; B.plane.style.opacity = String(lerp(F2.opacity, 1, q2));
      } else if (L.pattern === 'TYPE_LOCKUP') {
        B.items.forEach(function (it) {
          var pe3 = B.ease(progress(f, t0 + it.k * m.shape_stagger_f, m.enter_f));
          if (m.text === 'up') { var y3 = (1 - pe3) * it.h; it.el.style.transform = y3 === 0 ? 'none' : 'translateY(' + y3 + 'px)'; it.el.style.opacity = String(1 - px); }
          else it.el.style.opacity = String((m.text === 'fade' ? pe3 : 1) * (1 - px));
        });
        B.shapes.forEach(function (S, j) {
          var p3 = B.ease(progress(f, t0 + m.shape_delay_f + j * m.shape_stagger_f, m.shape_duration_f)); var k3 = S.s.kind;
          if (k3 === 'line') S.el.style.transform = 'rotate(' + S.info.rot + 'deg) scaleX(' + p3 + ')';
          else if (k3 === 'rect') S.el.style.clipPath = p3 >= 1 ? 'none' : 'inset(0 ' + ((1 - p3) * 100) + '% 0 0)';
          else S.el.style.transform = p3 >= 1 ? 'none' : 'scale(' + p3 + ')';
          S.el.style.opacity = String((k3 === 'circle' ? p3 : 1) * (1 - px));
        });
      }
    });
  }

  var bold = window.__bold = { plan_id: C.id, error: null, layout: null };
  bold.ready = (async function () {
    try {
      var faces = {}; PLAN.layers.forEach(function (L) { faces[fontStr(L.style, 40)] = L.lines.join(''); });
      for (var k in faces) await document.fonts.load(k, faces[k]);
      await document.fonts.ready;
      PLAN.layers.forEach(function (L) { if (!document.fonts.check(fontStr(L.style, 40), L.lines.join(''))) throw new Error('FONT_NOT_LOADED: ' + L.style.family + ' (' + L.id + ')'); });
      PLAN.layers.forEach(function (L) { if (L.pattern) LAYOUT[L.id] = layoutLayer(L); });
      var byId = {}; PLAN.layers.forEach(function (L) { byId[L.id] = L; });
      // formas: na ORDEM TOPOLÓGICA do compilador (dependências antes)
      var built = {}; PLAN.layers.forEach(function (L) { var B = build(Object.assign({}, L, { shapes: [] })); built[L.id] = B; BUILT.push(B); });
      PLAN.references.order.forEach(function (node) { var parts = node.split('.shape.'); var L = byId[parts[0]]; var s = L.shapes.filter(function (x) { return x.id === parts[1]; })[0]; built[L.id].shapes = built[L.id].shapes || []; built[L.id].shapes.push(buildShape(L, s, built[L.id].host)); });
      BUILT.forEach(function (B) { if (B.L.pattern === 'TYPE_LOCKUP') { var ids = B.L.shapes.map(function (s) { return s.id; }); B.shapes.sort(function (a, b) { return ids.indexOf(a.s.id) - ids.indexOf(b.s.id); }); } });
      bold.layout = JSON.parse(JSON.stringify({ layers: Object.keys(LAYOUT).reduce(function (o, id) { var x = LAYOUT[id]; o[id] = { size_px: x.px, tracking_px: x.ls, ascent: x.asc, descent: x.desc, block: x.block, ink: x.ink, lines: x.lines, chars: x.chars.map(function (c) { return { ch: c.ch, x: c.x, baseline: c.y, ink: c.ink }; }) }; return o; }, {}), shapes: SHAPES }));
      seekFrame(0);
      var time = 0; var D = C.frames / FPS;
      var tl = { play: function () {}, pause: function () {}, paused: function () { return true; }, time: function () { return time; }, duration: function () { return D; }, timeScale: function () {}, set: function () {}, add: function () {}, getChildren: function () { return []; },
        seek: function (t) { if (t === undefined) return time; time = t; seekFrame(t * FPS); return tl; }, totalTime: function (t) { if (t === undefined) return time; time = t; seekFrame(t * FPS); return tl; } };
      window.__timelines = window.__timelines || {}; window.__timelines[C.id] = tl; bold.seek = function (t) { tl.totalTime(t); };
    } catch (e) { bold.error = String(e && e.message || e); document.documentElement.setAttribute('data-bold-error', bold.error); throw e; }
  })();
})();
