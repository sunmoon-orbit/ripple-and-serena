/*!
 * 焦糖布丁 · Caramel Pudding  v1.0.0
 * ─────────────────────────────────────────────
 * 布丁（Pudding）：按下回弹、松手果冻抖；浮层弹出；长按菜单从指尖长出来
 * 焦糖（Caramel）：一排圆角按钮里，选中色像糖浆一样从旧的那颗流到新的那颗
 * 一个文件 · 零依赖 · 引入即生效 · MIT License
 * https://github.com/wave2234/caramel-pudding
 */
(function (root) {
  'use strict';
  if (!root || !root.document || root.CaramelPudding) return;

  /* ───────────────────────── 配置 ───────────────────────── */
  var cfg = {
    speed: 1,        // 全局速度：0.25 = 慢放四倍（调参、录屏用，请用 CaramelPudding.setSpeed 改）
    pudding: true,   // 布丁层：按下回弹、松手果冻
    caramel: true,   // 焦糖层：选中色黏连流动
    touchDelay: 70,  // 触屏按住多久才压下去——防止滑动列表时按钮乱缩
    moveCancel: 10   // 按下后手指移动超过多少 px 就当作在滑动，取消
  };

  var SVGNS = 'http://www.w3.org/2000/svg';
  var CSSX = root.CSS && root.CSS.supports ? root.CSS : null;
  var HAS_SCALE = !!(CSSX && CSSX.supports('scale', '1 1'));
  var HAS_HAS = (function () { try { root.document.querySelector(':has(*)'); return true; } catch (e) { return false; } })();

  // 哪些东西算「点了会有反应的」
  var TAP = 'button,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="switch"],[role="option"],[role="radio"],[role="checkbox"],summary,' +
    'input[type="button"],input[type="submit"],input[type="reset"],input[type="checkbox"],input[type="radio"],.btn,[data-cp]' +
    (HAS_HAS ? ',label:has(>input[type="radio"]),label:has(>input[type="checkbox"])' : '');
  // 永远不碰：输入框、媒体、可编辑区域
  var NO = 'textarea,select,input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]),' +
    '[contenteditable=""],[contenteditable="true"],canvas,video,audio,iframe,html,body,[data-cp-layer],[data-cp-ghost]';
  // 开关一类：只淡一下，绝不晃
  var TINY = '[role="switch"],[role="checkbox"],summary,input[type="checkbox"],input[type="radio"]';
  var STATE_TOKEN = /^(is-)?(on|active|current|cur|sel|selected|checked|chosen)$|[-_](on|active|current|selected|checked|chosen)$/;
  var ATTRS = ['aria-selected', 'aria-pressed', 'aria-current', 'aria-checked', 'data-active', 'data-state', 'data-selected'];
  var JELLY = { pudding: 1, card: 1, big: 1 };
  var EASE = {
    pull: 'cubic-bezier(.3,0,.5,1)',     // 被拉住
    move: 'cubic-bezier(.4,0,.2,1)',     // 流过去
    wobble: 'cubic-bezier(.45,0,.55,1)', // 晃一晃
    snap: 'cubic-bezier(.55,0,.8,.3)',   // 被吸进去（越来越快）
    out: 'cubic-bezier(.2,.7,.3,1)'      // 松开、回位
  };

  /* ───────────────────────── 小工具 ───────────────────────── */
  function now() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function T(ms) { return ms / (cfg.speed > 0 ? cfg.speed : 1); }          // 设计时长 → 实际时长
  function later(fn, ms) { return setTimeout(fn, T(ms)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function winOf(n) { return (n.ownerDocument || n).defaultView || root; }
  function csOf(el) { return winOf(el).getComputedStyle(el); }
  function reduced(win) { try { return (win || root).matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function saveProps(el, props) { var st = el.style; return props.map(function (p) { return [p, st.getPropertyValue(p), st.getPropertyPriority(p)]; }); }
  function restoreProps(el, saved) { var st = el.style; saved.forEach(function (s) { if (s[1]) st.setProperty(s[0], s[1], s[2]); else st.removeProperty(s[0]); }); }

  /* ───────────────────────── 颜色 ───────────────────────── */
  var cvx = null, ccache = Object.create(null);
  function parseRGBA(s) {
    var m = /^rgba?\(([^)]+)\)$/.exec(String(s || '').trim());
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  // 把任意 CSS 颜色（含 oklch / color()）换成 rgba
  function toRGBA(s) {
    if (!s || s === 'transparent' || s === 'none') return null;
    if (s in ccache) return ccache[s];
    var c = parseRGBA(s);
    if (!c && CSSX && CSSX.supports('color', s)) {
      try {
        if (!cvx) { var cv = root.document.createElement('canvas'); cv.width = cv.height = 1; cvx = cv.getContext('2d', { willReadFrequently: true }); }
        cvx.clearRect(0, 0, 1, 1); cvx.fillStyle = s;
        var f = String(cvx.fillStyle);
        if (/^#[0-9a-f]{6}$/i.test(f)) c = { r: parseInt(f.substr(1, 2), 16), g: parseInt(f.substr(3, 2), 16), b: parseInt(f.substr(5, 2), 16), a: 1 };
        else c = parseRGBA(f);
        if (!c) { cvx.fillRect(0, 0, 1, 1); var d = cvx.getImageData(0, 0, 1, 1).data; c = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; }
      } catch (e) { c = null; }
    }
    return (ccache[s] = c);
  }
  function rgbCss(c) { return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')'; }
  function lum(c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }

  /* ───────────────────────── 读样式 ───────────────────────── */
  // 一个元素「有没有底色」：纯色或渐变的第一个色标
  function fillOf(el, cs) {
    cs = cs || csOf(el);
    var c = toRGBA(cs.backgroundColor);
    if (c && c.a > 0.04) return { css: rgbCss(c), a: c.a, c: c, key: cs.backgroundColor };
    var bi = cs.backgroundImage;
    if (bi && bi !== 'none' && bi.indexOf('gradient') >= 0) {
      var m = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|(?:oklch|oklab|lch|lab|hsla?|hwb|color)\([^)]*\))/i.exec(bi);
      var g = m && toRGBA(m[1]);
      if (g && g.a > 0.04) return { css: rgbCss(g), a: 1, c: g, key: bi };
    }
    return null;
  }
  function radiusOf(cs, w, h) {
    var s = cs.borderTopLeftRadius || '0', v = parseFloat(s) || 0;
    if (s.indexOf('%') >= 0) v = v / 100 * Math.min(w, h);
    return Math.min(v, w / 2, h / 2);
  }
  function vis(el) {
    if (el.hasAttribute('data-cp-layer') || el.hasAttribute('data-cp-ghost')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = csOf(el);
    return cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  }
  function inputOf(el) { return el.matches('input') ? el : el.querySelector('input[type="radio"],input[type="checkbox"]'); }
  function stateOf(el) {
    var s = el.getAttribute('class') || '';
    for (var i = 0; i < ATTRS.length; i++) s += '|' + (el.getAttribute(ATTRS[i]) || '');
    var inp = inputOf(el); if (inp) s += '|' + (inp.checked ? 1 : 0);
    return s;
  }
  // 从 class / aria / data-state 看起来是不是「选中」
  function isOn(el) {
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true') return true;
    var a = el.getAttribute('aria-current'); if (a && a !== 'false') return true;
    a = el.getAttribute('data-state'); if (a === 'active' || a === 'on' || a === 'checked' || a === 'selected') return true;
    if (el.getAttribute('data-active') === 'true' || el.getAttribute('data-selected') === 'true') return true;
    var cls = (el.getAttribute('class') || '').split(/\s+/);
    for (var i = 0; i < cls.length; i++) if (cls[i] && STATE_TOKEN.test(cls[i])) return true;
    var inp = inputOf(el); return !!(inp && inp.checked);
  }
  // 选中色可能画在按钮自己身上，也可能画在里面的小块上（比如底栏图标后面那颗药丸）
  function carriers(item) {
    var out = [item], q = [item];
    for (var depth = 0; depth < 2 && q.length && out.length < 8; depth++) {
      var next = [];
      for (var i = 0; i < q.length && out.length < 8; i++) {
        for (var c = q[i].firstElementChild; c && out.length < 8; c = c.nextElementSibling) {
          if (c.hasAttribute('data-cp-layer') || c.hasAttribute('data-cp-ghost')) continue;
          out.push(c); next.push(c);
        }
      }
      q = next;
    }
    return out;
  }
  function look(item) {
    var cs = csOf(item), cars = carriers(item), fills = [], keys = [];
    for (var i = 0; i < cars.length; i++) {
      var ccs = i ? csOf(cars[i]) : cs, f = fillOf(cars[i], ccs);
      fills.push(f); keys.push(f ? f.key + '/' + ccs.boxShadow : '');
    }
    return {
      cars: cars, fills: fills, color: cs.color, border: cs.borderTopColor,
      key: keys.join(';') + '|' + cs.color + '|' + cs.borderTopColor + '|' + cs.fontWeight
    };
  }

  /* ───────────────────────── 分档：这个元素该怎么动 ───────────────────────── */
  function kindOf(n) { return n.tagName + '|' + (n.getAttribute('role') || ''); }
  function kindSel(n) { var r = n.getAttribute('role'); return n.tagName.toLowerCase() + (r ? '[role="' + r + '"]' : ''); }
  // 往上找三层，看它是不是「一排同类按钮」里的一颗
  function groupOf(el) {
    var d = el.ownerDocument, force = el.parentElement && el.parentElement.closest('[data-cp-group]');
    if (force && force.getAttribute('data-cp-group') === 'off') return null;
    var node = el;
    for (var lv = 0; lv < 3 && node; lv++) {
      var p = node.parentElement;
      if (!p || p === d.body || p === d.documentElement) break;
      if (force && !force.contains(p)) break;
      var k = kindOf(node), items = [];
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) if (kindOf(c) === k && vis(c)) items.push(c);
      if (items.length >= 2 && items.length <= 42 && items.indexOf(node) >= 0) return { row: p, items: items, item: node, sel: kindSel(node), forced: p === force };
      if (force && p === force) break;
      node = p;
    }
    return null;
  }
  function smallRect(r, vw) { return r.width >= 16 && r.height >= 16 && r.width <= vw * 0.62 && r.height <= 80; }
  // 这一排是不是「单选」：有 tab/radio 角色、有选中状态，或者恰好有一颗长得和别人不一样
  function choiceLike(g) {
    if (g.forced) return true;
    var items = g.items, n = items.length, i, k;
    for (i = 0; i < n; i++) {
      var it = items[i], role = it.getAttribute('role');
      if (role === 'tab' || role === 'option' || role === 'radio' || role === 'menuitemradio') return true;
      for (var j = 0; j < 4; j++) if (it.hasAttribute(ATTRS[j])) return true;
      if (isOn(it)) return true;
    }
    // 按下的这颗不算（它可能正处在 hover / active 样式里）
    if (n < 3) return false;
    var counts = {}, distinct = 0, min = n;
    for (i = 0; i < n; i++) {
      if (items[i] === g.item) continue;
      k = look(items[i]).key; if (!(k in counts)) { counts[k] = 0; distinct++; } counts[k]++;
    }
    if (distinct !== 2) return false;
    for (k in counts) min = Math.min(min, counts[k]);
    return min <= (n - 1) / 2;
  }
  /*
   * 档位：
   *  none    不动
   *  tiny    只淡一下（小字、小图标、开关、列表行）
   *  press   轻压 + 小回弹（普通按钮）
   *  big     果冻（大按钮）
   *  card    果冻（大卡片）
   *  pudding 果冻，最 Q（data-cp="pudding" 手动指定，比如角色卡、封面卡）
   *  choice  一排单选里的一颗：按下淡一下，选中色走焦糖
   */
  function tierOf(el) {
    var win = winOf(el), v = el.getAttribute('data-cp');
    if (v === 'none' || el.closest('[data-cp="none"]') || el.matches(NO) || el.disabled || el.getAttribute('aria-disabled') === 'true') return { t: 'none' };
    var r = el.getBoundingClientRect(), vw = win.innerWidth, vh = win.innerHeight;
    if (r.width < 4 || r.height < 4) return { t: 'none' };
    if (v === 'pudding' || v === 'press' || v === 'tiny') return { t: v, r: r, vw: vw };
    if (el.matches(TINY)) return { t: 'tiny', r: r, vw: vw };
    var g = cfg.caramel ? groupOf(el) : null;
    if (g && (g.forced || smallRect(g.item.getBoundingClientRect(), vw)) && choiceLike(g)) return { t: 'choice', g: g, r: r, vw: vw };
    if (r.width * r.height > vw * vh * 0.4 || (r.width > vw * 0.95 && r.height > 200)) return { t: 'none' };
    var cs = win.getComputedStyle(el);
    var bg = !!fillOf(el, cs) || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') || cs.boxShadow !== 'none';
    var w = r.width, h = r.height, t;
    if (Math.min(w, h) <= 34 || w * h <= 2200) t = 'tiny';
    else if (w >= 132 && h >= 90) t = bg ? 'card' : 'press';
    else if (w >= vw * 0.7) t = bg && h >= 38 ? 'big' : 'tiny';
    else if (bg && w >= 110 && h >= 40) t = 'big';
    else if (!bg && h < 60) t = 'tiny';
    else t = 'press';
    return { t: t, r: r, vw: vw };
  }
  // 越宽的东西晃得越少，不然整条横幅一起抖会很吵
  function ampOf(t, r, vw) {
    var wide = r && r.width > vw * 0.7;
    if (t === 'pudding') return wide ? 0.62 : 0.95;
    if (t === 'card') return wide ? 0.5 : 0.85;
    if (t === 'big') return wide ? 0.42 : 0.75;
    if (t === 'press') return 0.55;
    return 1;
  }

  /* ───────────────────────── 布丁：按下 / 松手 ───────────────────────── */
  var anims = new WeakMap(), bases = new WeakMap();
  function setAnim(el, a) {
    var o = anims.get(el);
    if (o && o !== a) { try { o.cancel(); } catch (e) {} }
    if (a) anims.set(el, a); else anims.delete(el);
  }
  function curScale(el) {
    var cs = csOf(el), s = HAS_SCALE ? cs.scale : '';
    if (s && s !== 'none') { var p = s.split(/\s+/).map(parseFloat); return [p[0], p.length > 1 ? p[1] : p[0]]; }
    var m = /matrix\(([^)]+)\)/.exec(cs.transform || '');
    if (m && anims.get(el)) { var q = m[1].split(',').map(parseFloat); return [Math.hypot(q[0], q[1]), Math.hypot(q[2], q[3])]; }
    return [1, 1];
  }
  // 用独立的 scale 属性做形变，不和元素自己的 transform 打架
  function scaleAnim(el, frames, opt) {
    if (!HAS_SCALE && csOf(el).transform !== 'none' && !anims.get(el)) return null;
    var kf = frames.map(function (f) {
      var k = HAS_SCALE ? { scale: f[0] + ' ' + f[1] } : { transform: 'scale(' + f[0] + ',' + f[1] + ')' };
      if (f[2] != null) k.offset = f[2];
      if (f[3]) k.easing = f[3];
      return k;
    });
    try { return el.animate(kf, opt); } catch (e) { return null; }
  }
  function fadeTier(t) { return t === 'tiny' || t === 'choice'; }
  function press(el, t, a) {
    if (fadeTier(t)) {
      var cur = parseFloat(csOf(el).opacity); setAnim(el, null);
      var base = parseFloat(csOf(el).opacity); bases.set(el, base);
      setAnim(el, el.animate([{ opacity: cur }, { opacity: base * (t === 'choice' ? 0.7 : 0.62) }], { duration: T(100), easing: 'ease-out', fill: 'forwards' }));
      return;
    }
    var jelly = JELLY[t], s = 1 - (jelly ? 0.075 : 0.05) * a, c = curScale(el);
    setAnim(el, null);
    setAnim(el, scaleAnim(el, [[c[0], c[1]], [s, s]], {
      duration: T(jelly ? 340 : 260),
      easing: jelly ? 'cubic-bezier(.34,1.56,.64,1)' : 'cubic-bezier(.25,.8,.25,1)',
      fill: 'forwards'
    }));
  }
  function done(el, an) { if (an) an.onfinish = function () { if (anims.get(el) === an) anims.delete(el); }; }
  function unfade(el, ms) {
    var cur = parseFloat(csOf(el).opacity), base = bases.has(el) ? bases.get(el) : 1;
    setAnim(el, null);
    var an = el.animate([{ opacity: cur }, { opacity: base }], { duration: T(ms), easing: 'ease-out' });
    setAnim(el, an); done(el, an);
  }
  // 按下又没点成（手指滑走了）：轻轻弹回
  function unpress(el, t, a) {
    if (fadeTier(t)) return unfade(el, 200);
    var c = curScale(el), up = 1 + 0.025 * a;
    setAnim(el, null);
    var an = scaleAnim(el, [[c[0], c[1]], [up, up, 0.6], [1, 1]], { duration: T(380), easing: 'cubic-bezier(.25,.8,.3,1)' });
    setAnim(el, an); done(el, an);
  }
  // 点成了：普通按钮小回弹，大卡大按钮果冻抖
  function release(el, t, a, pressed) {
    if (fadeTier(t)) return unfade(el, t === 'choice' ? 260 : 200);
    var c = curScale(el), an;
    setAnim(el, null);
    if (!JELLY[t]) {
      var lo = 1 - 0.05 * a, up = 1 + 0.025 * a;
      an = scaleAnim(el, pressed
        ? [[c[0], c[1], 0, 'cubic-bezier(.22,1,.36,1)'], [up, up, 0.55, 'ease-in-out'], [1, 1, 1]]
        : [[1, 1, 0, 'ease-out'], [lo, lo, 0.18, 'cubic-bezier(.22,1,.36,1)'], [up, up, 0.6, 'ease-in-out'], [1, 1, 1]],
        { duration: T(420) });
    } else {
      var f = function (x, y, o) { return [1 + x * a, 1 + y * a, o]; };
      var fr = pressed ? [[c[0], c[1], 0]] : [[1, 1, 0], f(-0.08, -0.08, 0.1)];
      fr.push(f(0.12, -0.13, 0.28), f(-0.07, 0.08, 0.48), f(0.035, -0.035, 0.66), f(-0.012, 0.012, 0.82), [1, 1, 1]);
      an = scaleAnim(el, fr, { duration: T(700), easing: 'cubic-bezier(.3,.7,.4,1)' });
    }
    setAnim(el, an); done(el, an);
  }

  /* ───────────────────────── 焦糖：黏连层 ───────────────────────── */
  var layers = new WeakMap();   // row → 正在流的糖浆层
  var hidden = new WeakMap();   // 被我们暂时藏起底色的元素
  var notrans = new WeakMap();  // 被我们暂时关掉过渡的元素

  function noTrans(el) { if (notrans.has(el)) return; notrans.set(el, saveProps(el, ['transition'])); el.style.setProperty('transition', 'none', 'important'); }
  function reTrans(el) { var s = notrans.get(el); if (!s) return; notrans.delete(el); restoreProps(el, s); }
  // 动画期间把按钮自己的底色藏起来，颜色全由糖浆层来画
  function hideFill(el) {
    if (hidden.has(el)) return;
    noTrans(el);
    hidden.set(el, saveProps(el, ['background-color', 'background-image', 'box-shadow']));
    var st = el.style;
    st.setProperty('background-color', 'transparent', 'important');
    st.setProperty('background-image', 'none', 'important');
    st.setProperty('box-shadow', 'none', 'important');
  }
  // 还回底色：先在「过渡关着」的时候还，再开过渡——不然会从透明慢慢渐变回来
  function showFill(el, fadeShadow) {
    var s = hidden.get(el); if (!s) return;
    hidden.delete(el);
    restoreProps(el, s);
    var sh = csOf(el).boxShadow;
    reTrans(el);
    if (fadeShadow && sh && sh !== 'none') { try { el.animate([{ boxShadow: 'none' }, { boxShadow: sh }], { duration: T(180), easing: 'ease-out' }); } catch (e) {} }
  }
  // 读「真实样式」时，先把我们藏起来的底色临时还回去（同一帧里完成，不会闪）
  function peek(els, fn) {
    var back = [];
    els.forEach(function (el) {
      var s = hidden.get(el);
      if (s) { back.push([el, saveProps(el, ['background-color', 'background-image', 'box-shadow'])]); restoreProps(el, s); }
    });
    try { return fn(); } finally { back.forEach(function (b) { restoreProps(b[0], b[1]); }); }
  }

  // 黏连滤镜：模糊 → 透明度阈值（把模糊边缘「收紧」成黏在一起的液体）→ atop 合成保留原形状
  function gooFilter(d, std) {
    var id = 'cp-goo-' + String(std).replace('.', '-');
    if (d.getElementById(id)) return id;
    var svg = d.getElementById('cp-defs');
    if (!svg) {
      svg = d.createElementNS(SVGNS, 'svg');
      svg.setAttribute('id', 'cp-defs'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      svg.appendChild(d.createElementNS(SVGNS, 'defs'));
      (d.body || d.documentElement).appendChild(svg);
    }
    var mk = function (tag, at) { var n = d.createElementNS(SVGNS, tag); for (var k in at) n.setAttribute(k, at[k]); return n; };
    var f = mk('filter', { id: id, x: '-40%', y: '-80%', width: '180%', height: '260%', 'color-interpolation-filters': 'sRGB' });
    f.appendChild(mk('feGaussianBlur', { 'in': 'SourceGraphic', stdDeviation: std, result: 'blur' }));
    f.appendChild(mk('feColorMatrix', { 'in': 'blur', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8', result: 'goo' }));
    f.appendChild(mk('feComposite', { 'in': 'SourceGraphic', in2: 'goo', operator: 'atop' }));
    svg.firstChild.appendChild(f);
    return id;
  }

  // 插一个子元素进去之后，确认没有因为 :last-child 之类的选择器把别的按钮挤动
  function probeKey(items) {
    var out = '';
    [items[0], items[items.length - 1]].forEach(function (it) {
      if (!it || !it.isConnected) return;
      var r = it.getBoundingClientRect(), c = csOf(it);
      out += [r.left, r.top, r.width, r.height, c.marginLeft, c.marginRight, c.borderLeftColor, c.borderRightColor, c.borderTopLeftRadius, c.borderTopRightRadius].join(',') + ';';
    });
    return out;
  }

  /*
   * 糖浆层：一个放在这排按钮「后面」的 div（z-index:-1，父元素 isolation:isolate），
   * 里面是几颗绝对定位的圆角块（blob），整层套黏连滤镜。按钮文字永远在糖浆上面，不会被滤镜糊掉。
   */
  function openLayer(row, items, ghost) {
    var d = row.ownerDocument, cs = csOf(row);
    if (cs.display === 'contents' || cs.display === 'inline') return null;
    var L = { row: row, doc: d, hid: [], notr: [], blobs: {}, ghosts: {}, timers: [], ended: false,
      saved: saveProps(row, ['isolation', 'position']) };
    var base = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;pointer-events:none;overflow:hidden;overflow:clip;contain:layout style size;';
    var el = d.createElement('div');
    el.setAttribute('data-cp-layer', ''); el.setAttribute('aria-hidden', 'true');
    el.style.cssText = base + 'z-index:-1;';
    var gel = null;
    if (ghost) {
      gel = d.createElement('div');
      gel.setAttribute('data-cp-ghost', ''); gel.setAttribute('aria-hidden', 'true');
      gel.style.cssText = base + 'z-index:-2;';
    }
    var before = probeKey(items);
    var put = function (first) {
      if (first) { if (gel) row.insertBefore(gel, row.firstChild); row.insertBefore(el, row.firstChild); }
      else { if (gel) row.appendChild(gel); row.appendChild(el); }
    };
    put(false);
    if (probeKey(items) !== before) {
      put(true);
      if (probeKey(items) !== before) { el.remove(); if (gel) gel.remove(); return null; }
    }
    if (cs.position === 'static') row.style.setProperty('position', 'relative');
    row.style.setProperty('isolation', 'isolate');
    var rr = row.getBoundingClientRect();
    L.ox = rr.left + (parseFloat(cs.borderLeftWidth) || 0) - row.scrollLeft;
    L.oy = rr.top + (parseFloat(cs.borderTopWidth) || 0) - row.scrollTop;
    var w = Math.max(row.scrollWidth, row.clientWidth) + 'px', h = Math.max(row.scrollHeight, row.clientHeight) + 'px';
    el.style.width = w; el.style.height = h;
    if (gel) { gel.style.width = w; gel.style.height = h; }
    L.el = el; L.gel = gel;
    L.rect = function (node) {
      var r = node.getBoundingClientRect();
      return { x: r.left - L.ox, y: r.top - L.oy, w: r.width, h: r.height, r: radiusOf(csOf(node), r.width, r.height) };
    };
    L.filter = function (fs) { el.style.filter = 'url(#' + gooFilter(d, fs <= 30 ? 4 : fs <= 46 ? 5.5 : 7) + ')'; };
    L.blob = function (name, color) {
      var b = L.blobs[name];
      if (!b) { b = d.createElement('i'); b.style.cssText = 'position:absolute;display:block;left:0;top:0;width:0;height:0;'; el.appendChild(b); L.blobs[name] = b; }
      b.style.background = color;
      return b;
    };
    // 「影子」：按钮没选中时自己也有底色（比如浅灰药丸），动画期间用它垫在糖浆下面
    L.ghost = function (name, R, fill, fadeOut, D) {
      if (!gel) return;
      var g = d.createElement('i');
      g.style.cssText = 'position:absolute;display:block;left:' + R.x + 'px;top:' + R.y + 'px;width:' + R.w + 'px;height:' + R.h + 'px;border-radius:' + R.r + 'px;background:' + fill.css + ';opacity:' + fill.a;
      gel.appendChild(g); L.ghosts[name] = g;
      if (fadeOut) g.animate([{ opacity: fill.a }, { opacity: fill.a, offset: 0.45 }, { opacity: 0, offset: 0.75 }, { opacity: 0 }], { duration: T(D), fill: 'forwards' });
    };
    L.end = function () {
      if (L.ended) return;
      L.ended = true;
      L.timers.forEach(clearTimeout);
      L.hid.forEach(function (e) { showFill(e, e === L.main); });
      L.notr.forEach(reTrans);
      if (el.parentNode) el.remove();
      if (gel && gel.parentNode) gel.remove();
      restoreProps(row, L.saved);
      if (layers.get(row) === L) layers.delete(row);
    };
    layers.set(row, L);
    return L;
  }

  /* ───────── 形状 & 关键帧 ───────── */
  function centerOf(s) { return { x: s.x + s.w / 2, y: s.y + s.h / 2 }; }
  function around(c, w, h, r) {
    w = Math.max(0, w); h = Math.max(0, h);
    return { x: c.x - w / 2, y: c.y - h / 2, w: w, h: h, r: r == null ? Math.min(w, h) / 2 : Math.min(r, w / 2, h / 2) };
  }
  function K(s, o, e) {
    var k = { left: s.x + 'px', top: s.y + 'px', width: Math.max(0, s.w) + 'px', height: Math.max(0, s.h) + 'px', borderRadius: Math.max(0, Math.min(s.r, s.w / 2, s.h / 2)) + 'px', offset: o };
    if (e) k.easing = e;
    return k;
  }
  function nowShape(b) {
    var c = csOf(b);
    return { x: parseFloat(c.left) || 0, y: parseFloat(c.top) || 0, w: parseFloat(c.width) || 0, h: parseFloat(c.height) || 0, r: parseFloat(c.borderTopLeftRadius) || 0 };
  }
  function spin(b, G) { b.style.transform = 'rotate(' + G.ang.toFixed(4) + 'rad)'; return b; }
  function go(b, frames, D) {
    b.getAnimations().forEach(function (a) { a.cancel(); });
    return b.animate(frames, { duration: T(D), fill: 'forwards' });
  }
  // A → B 的几何：方向、主轴、两边相对的边缘、缝隙
  function geo(A, B) {
    var ca = centerOf(A), cb = centerOf(B), dx = cb.x - ca.x, dy = cb.y - ca.y, dist = Math.hypot(dx, dy) || 1;
    var ux = dx / dist, uy = dy / dist, hz = Math.abs(ux) >= Math.abs(uy);
    var reach = function (S) {
      var rx = Math.abs(ux) > 1e-6 ? S.w / 2 / Math.abs(ux) : Infinity, ry = Math.abs(uy) > 1e-6 ? S.h / 2 / Math.abs(uy) : Infinity;
      return Math.min(rx, ry);
    };
    var rA = reach(A), rB = reach(B), G = {
      ca: ca, cb: cb, ux: ux, uy: uy, hz: hz, dist: dist, gap: Math.max(0, dist - rA - rB), rA: rA, rB: rB,
      eA: { x: ca.x + ux * rA, y: ca.y + uy * rA }, eB: { x: cb.x - ux * rB, y: cb.y - uy * rB },
      aA: hz ? A.w : A.h, aB: hz ? B.w : B.h, tA: hz ? A.h : A.w, tB: hz ? B.h : B.w
    };
    G.fs = Math.min(G.tA, G.tB);
    G.mv = function (p, k) { return { x: p.x + ux * k, y: p.y + uy * k }; };
    G.mid = function (t) { return { x: G.eA.x + (G.eB.x - G.eA.x) * t, y: G.eA.y + (G.eB.y - G.eA.y) * t }; };
    G.sz = function (c, al, cr, r) { return hz ? around(c, al, cr, r) : around(c, cr, al, r); };   // 沿运动方向的长度 / 横向厚度（轴对齐）
    G.ov = function (c, al, cr) { return around(c, al, cr); };   // 糖丝、糖珠：配合 spin() 沿运动方向转过去
    G.ang = Math.atan2(uy, ux);
    return G;
  }

  /* ───────── 四种流法 ───────── */
  // 1) 相邻：旧的被拉长 → 缩成一颗糖珠被吸过去，新的从靠近那一侧鼓出来，过冲一下落定
  function flowNear(L, G, A0, A, B, cA, cB, b0) {
    var D = 500, st = Math.min(5, 2 + G.gap * 0.5), out = G.mv(G.eB, G.aB * 0.2);
    go(L.blob('a', cA), [
      K(A0, 0, EASE.pull),
      K(G.sz(G.mv(G.ca, st / 2), G.aA + st, G.tA, A.r), 0.16, EASE.move),
      K(G.sz(G.mv(G.ca, G.dist * 0.24), G.aA * 0.6, G.tA * 0.72), 0.4, EASE.snap),
      K(G.sz(G.eB, G.tA * 0.42, G.tA * 0.42), 0.64),
      K(G.sz(out, 0, 0), 0.82), K(G.sz(out, 0, 0), 1)
    ], D);
    go(L.blob('b', cB), [
      K(b0 || G.sz(G.eB, 0, 0), 0, EASE.move),
      K(G.sz(G.mv(G.eB, G.tB * 0.2), G.tB * 0.4, G.tB * 0.4), 0.26, EASE.wobble),
      K(G.sz(G.mv(G.cb, -G.aB * 0.15), G.aB * 0.7, G.tB * 0.82, B.r), 0.46, EASE.wobble),
      K(G.sz(G.cb, G.aB * 1.035, G.tB * 0.955, B.r), 0.68, EASE.wobble),
      K(G.sz(G.cb, G.aB * 0.99, G.tB * 1.02, B.r), 0.84, EASE.wobble),
      K(B, 1)
    ], D);
    if (G.gap > G.fs * 0.9) {   // 中间缝比较宽：补一段「糖丝」连着
      var m = G.mid(0.5), s0 = G.ov(G.mv(G.eA, G.gap * 0.2), 0, 0), s1 = G.ov(G.eB, 0, 0);
      go(spin(L.blob('n', cB), G), [
        K(s0, 0), K(s0, 0.12, EASE.move),
        K(G.ov(G.mv(m, -G.gap * 0.15), G.gap * 0.7 + G.fs * 0.25, G.fs * 0.38), 0.3, EASE.move),
        K(G.ov(m, G.gap + G.fs * 0.3, G.fs * 0.3), 0.46, EASE.snap),
        K(G.ov(G.mv(G.eB, -G.gap * 0.2), G.gap * 0.4, G.fs * 0.2), 0.62),
        K(s1, 0.74), K(s1, 1)
      ], D);
    }
    return D;
  }
  // 2) 隔得远、中间是空的：旧的挤出一滴糖珠（带一条小尾巴）滑过去，新的晚一点才鼓起来
  function flowFar(L, G, A0, A, B, cA, cB, b0) {
    var D = Math.min(760, 560 + G.gap * 0.5), fs = G.fs, m = G.mid(0.5);
    var a3 = G.sz(G.mv(G.eA, fs * 0.3), 0, 0), e0 = G.ov(G.eA, 0, 0), dEnd = G.ov(G.mv(G.eB, fs * 0.2), 0, 0), tEnd = G.ov(G.eB, 0, 0);
    go(L.blob('a', cA), [
      K(A0, 0, EASE.pull),
      K(G.sz(G.mv(G.ca, 2.5), G.aA + 5, G.tA, A.r), 0.12, EASE.move),
      K(G.sz(G.mv(G.ca, G.aA * 0.18), G.aA * 0.5, G.tA * 0.6), 0.3, EASE.snap),
      K(G.sz(G.mv(G.eA, fs * 0.15), fs * 0.36, fs * 0.36), 0.42),
      K(a3, 0.5), K(a3, 1)
    ], D);
    go(spin(L.blob('d', cB), G), [
      K(e0, 0), K(e0, 0.2, EASE.move),
      K(G.ov(G.mv(G.eA, fs * 0.2), fs * 0.42, fs * 0.42), 0.32, EASE.move),
      K(G.ov(m, fs * 1.15, fs * 0.46), 0.5, EASE.move),
      K(G.ov(G.mv(G.eB, -fs * 0.2), fs * 0.5, fs * 0.5), 0.64, EASE.snap),
      K(dEnd, 0.74), K(dEnd, 1)
    ], D);
    go(spin(L.blob('t', cB), G), [
      K(e0, 0), K(e0, 0.3, EASE.move),
      K(G.ov(G.mv(m, -fs * 0.9), fs * 0.62, fs * 0.3), 0.52, EASE.move),
      K(G.ov(G.mv(G.eB, -fs * 0.35), fs * 0.24, fs * 0.24), 0.68, EASE.snap),
      K(tEnd, 0.76), K(tEnd, 1)
    ], D);
    go(L.blob('b', cB), [
      K(b0 || G.sz(G.eB, 0, 0), 0), K(G.sz(G.eB, 0, 0), 0.56, EASE.move),
      K(G.sz(G.mv(G.eB, fs * 0.3), fs * 0.55, fs * 0.55), 0.66, EASE.wobble),
      K(G.sz(G.cb, G.aB * 1.03, G.tB * 0.96, B.r), 0.8, EASE.wobble),
      K(G.sz(G.cb, G.aB * 0.99, G.tB * 1.02, B.r), 0.9, EASE.wobble),
      K(B, 1)
    ], D);
    return D;
  }
  // 3) 隔得远、中间的按钮自己也有底色（糖珠会钻到它们下面看不见）：原地收、原地鼓
  function flowInPlace(L, G, A0, A, B, cA, cB, b0) {
    var D = 580, a0 = G.sz(G.ca, 0, 0), bz = G.sz(G.cb, 0, 0);
    go(L.blob('a', cA), [K(A0, 0, EASE.move), K(G.sz(G.ca, G.aA * 0.5, G.tA * 0.6), 0.38, EASE.snap), K(a0, 0.5), K(a0, 1)], D);
    go(L.blob('b', cB), [
      K(b0 || bz, 0), K(bz, 0.2, EASE.move),
      K(G.sz(G.cb, G.aB * 0.72, G.tB * 0.82, B.r), 0.5, EASE.wobble),
      K(G.sz(G.cb, G.aB * 1.03, G.tB * 0.96, B.r), 0.7, EASE.wobble),
      K(G.sz(G.cb, G.aB * 0.99, G.tB * 1.02, B.r), 0.86, EASE.wobble),
      K(B, 1)
    ], D);
    return D;
  }
  // 4) 之前没有选中的：一滴糖从手指按下的地方鼓起来，铺满
  function flowBloom(L, B, p, cB) {
    var D = 480, cb = centerOf(B), fs = Math.min(B.w, B.h), hz = B.w >= B.h, aB = hz ? B.w : B.h, tB = hz ? B.h : B.w;
    var sz = function (c, al, cr, r) { return hz ? around(c, al, cr, r) : around(c, cr, al, r); };
    go(L.blob('b', cB), [
      K(around(p, 0, 0), 0, EASE.out),
      K(around({ x: (p.x + cb.x) / 2, y: (p.y + cb.y) / 2 }, fs, fs), 0.45, EASE.wobble),
      K(sz(cb, aB * 1.03, tB * 0.96, B.r), 0.7, EASE.wobble),
      K(sz(cb, aB * 0.99, tB * 1.02, B.r), 0.86, EASE.wobble),
      K(B, 1)
    ], D);
    return D;
  }
  // 文字颜色跟着糖浆走：旧的等糖流走了才变暗，新的等糖流到了才变亮
  function follow(el, from, to, o1, o2, D, prop) {
    if (!el || !from || !to || from === to) return;
    var a = {}, b = {};
    a[prop || 'color'] = from; b[prop || 'color'] = to;
    try {
      el.animate([Object.assign({ offset: 0 }, a), Object.assign({ offset: o1 }, a), Object.assign({ offset: o2 }, b), Object.assign({ offset: 1 }, b)], { duration: T(D) });
    } catch (e) {}
  }

  /* ───────── 检测：点之前拍一张，点之后对比，找出「谁灭了、谁亮了」 ───────── */
  function snapshot(g) {
    var lay = layers.get(g.row);
    return peek(lay ? lay.hid : [], function () {
      var s = { items: g.items.slice(), looks: [], states: [], cen: [], text: [] };
      g.items.forEach(function (it) {
        var r = it.getBoundingClientRect();
        s.looks.push(look(it)); s.states.push(stateOf(it));
        s.cen.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        s.text.push((it.textContent || '').trim().slice(0, 40));
      });
      return s;
    });
  }
  // 框架（React / Vue …）可能把整排 DOM 换掉了：按原来的位置和文字把新节点找回来
  function resolve(ch) {
    var s = ch.snap, g = ch.g, d = ch.doc, out = [], row = g.row, rowOK = row.isConnected, i;
    for (i = 0; i < s.items.length; i++) {
      var it = s.items[i];
      if (it.isConnected && (!rowOK || it.parentElement === row)) { out.push(it); continue; }
      var hit = d.elementFromPoint(s.cen[i].x, s.cen[i].y), cand = hit && hit.closest ? hit.closest(g.sel) : null;
      out.push(cand && (!s.text[i] || (cand.textContent || '').trim().slice(0, 40) === s.text[i]) ? cand : null);
    }
    if (!rowOK) for (i = 0; i < out.length; i++) if (out[i]) { g.row = out[i].parentElement; break; }
    return out;
  }
  function gained(o, n) {
    for (var j = 0; j < n.fills.length; j++) { var a = o.fills[j], b = n.fills[j]; if (b && (!a || a.key !== b.key)) return true; }
    return false;
  }
  function diff(ch) {
    var s = ch.snap, items = resolve(ch), row = ch.g.row;
    if (!row || !row.isConnected) return null;
    var lay = layers.get(row), touched = [];
    // 先关过渡再读：不然读到的是过渡的起点，而不是最终的选中色
    items.forEach(function (it) { if (it) carriers(it).forEach(function (c) { if (!notrans.has(c)) { noTrans(c); touched.push(c); } }); });
    var res = peek(lay ? lay.hid : [], function () {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        if (!items[i]) continue;
        var lk = look(items[i]), st = stateOf(items[i]);
        if (st !== s.states[i] || lk.key !== s.looks[i].key) out.push({ i: i, sc: st !== s.states[i], look: lk });
      }
      return out;
    });
    ch.touched = touched;
    var back = function () { touched.forEach(reTrans); return null; };
    if (!res.length) return back();
    var bi = -1, ai = -1, best = 1e9, anyState = false, k;
    for (k = 0; k < res.length; k++) { if (res[k].sc) anyState = true; if (res[k].i === ch.idx) bi = res[k].i; }
    if (bi < 0) for (k = 0; k < res.length; k++) if (gained(s.looks[res[k].i], res[k].look)) { bi = res[k].i; break; }
    if (bi < 0) bi = res[0].i;
    for (k = 0; k < res.length; k++) {
      var c = res[k]; if (c.i === bi) continue;
      var dd = Math.abs(c.i - bi) + (c.sc ? 0 : 100);
      if (dd < best) { best = dd; ai = c.i; }
    }
    // 只有样式变了、class/aria 都没变：至少要两颗一起变，免得把 hover 当成选中
    if (!anyState && ai < 0) return back();
    var r = { items: items, bi: bi, ai: ai };
    for (k = 0; k < res.length; k++) { if (res[k].i === bi) r.bLook = res[k].look; else if (res[k].i === ai) r.aLook = res[k].look; }
    return r;
  }
  // 找出真正「亮起来 / 灭掉」的那一层（可能是按钮本身，也可能是里面的小块）
  function pickCarrier(o, n, wantNew) {
    var m = Math.min(o.fills.length, n.fills.length);
    for (var j = 0; j < m; j++) {
      var a = o.fills[j], b = n.fills[j];
      if ((!a) === (!b) && (!a || a.key === b.key)) continue;
      if (wantNew ? b : a) return j;
    }
    return -1;
  }
  function indicatorIn(row, items) {   // 这排自己带了滑动指示条：就别再叠一层了
    for (var c = row.firstElementChild; c; c = c.nextElementSibling) {
      if (items.indexOf(c) >= 0 || c.hasAttribute('data-cp-layer') || c.hasAttribute('data-cp-ghost')) continue;
      if (vis(c) && fillOf(c)) return true;
    }
    return false;
  }
  function blocked(L, G, items, ai, bi) {   // A、B 之间的路上有没有自带底色的按钮
    for (var i = 0; i < items.length; i++) {
      if (i === ai || i === bi || !items[i]) continue;
      var R = L.rect(items[i]), c = centerOf(R), t = (c.x - G.eA.x) * G.ux + (c.y - G.eA.y) * G.uy;
      if (t < 0 || t > G.gap) continue;
      if (Math.hypot(c.x - (G.eA.x + G.ux * t), c.y - (G.eA.y + G.uy * t)) > Math.max(R.w, R.h) / 2) continue;
      if (look(items[i]).fills.some(Boolean)) return true;
    }
    return false;
  }
  function absShape(S, L) { return S && { x: S.x + L.ox, y: S.y + L.oy, w: S.w, h: S.h, r: S.r }; }
  function relShape(S, L) { return S && { x: S.x - L.ox, y: S.y - L.oy, w: S.w, h: S.h, r: S.r }; }

  function run(ch, r) {
    var s = ch.snap, g = ch.g, row = g.row;
    var B = r.items[r.bi], A = r.ai >= 0 ? r.items[r.ai] : null;
    var oB = s.looks[r.bi], nB = r.bLook, oA = A ? s.looks[r.ai] : null, nA = r.aLook;
    var jb = pickCarrier(oB, nB, true), ja = oA && nA ? pickCarrier(oA, nA, false) : -1;
    var bF = jb >= 0 ? nB.fills[jb] : null, aF = ja >= 0 ? oA.fills[ja] : null, mode = null;
    if (bF && aF) mode = 'flow';
    else if (bF) mode = 'bloom';
    else if (!aF && A && nA && nB.color !== oB.color && !indicatorIn(row, g.items)) { mode = 'tint'; jb = ja = 0; }
    if (!mode) { (ch.touched || []).forEach(reTrans); if (ch.lean) leanBack(ch); return; }
    var bEl = nB.cars[jb] || B, aEl = mode === 'bloom' ? null : (nA.cars[ja] || A);
    var cB = mode === 'tint' ? toRGBA(nB.color) : bF.c, cA = mode === 'flow' ? aF.c : cB;
    if (!cB) { (ch.touched || []).forEach(reTrans); if (ch.lean) leanBack(ch); return; }

    // 上一段糖浆还没流完（连点）或者刚刚在「按住预备」：接着它现在的形状继续流
    var prev = layers.get(row), carryA = null, carryB = null;
    if (prev && !prev.el.isConnected) prev.end();
    else if (prev) {
      if (ch.lean && ch.lean.L === prev) {
        if (prev.blobs.a) carryA = absShape(nowShape(prev.blobs.a), prev);
        if (prev.blobs.b) carryB = absShape(nowShape(prev.blobs.b), prev);
      } else if (prev.blobs.b && prev.bIdx === r.ai) carryA = absShape(nowShape(prev.blobs.b), prev);
      prev.end();
    }
    ch.lean = null;

    var needGhost = (mode === 'flow' && nA.fills[ja]) || (mode !== 'tint' && oB.fills[jb]);
    var L = openLayer(row, r.items.filter(Boolean), !!needGhost);
    if (!L) { (ch.touched || []).forEach(reTrans); return; }
    L.bIdx = r.bi; L.main = bEl;
    var Ar = aEl ? L.rect(aEl) : null, Br = L.rect(bEl);
    var alpha = mode === 'tint' ? 0.16 : bF.a;
    if (mode === 'flow' && (Math.abs(lum(cA) - lum(cB)) > 0.35 || Math.abs(aF.a - bF.a) > 0.25)) cA = cB;   // 比如同时换了深色模式
    L.el.style.opacity = alpha;
    if (mode !== 'tint') { hideFill(bEl); L.hid.push(bEl); }
    if (mode === 'flow') { hideFill(aEl); L.hid.push(aEl); }
    var keep = [A, B, aEl, bEl];
    (ch.touched || []).forEach(function (el) { if (keep.indexOf(el) >= 0) L.notr.push(el); else reTrans(el); });

    var D, colA = rgbCss(cA), colB = rgbCss(cB), b0 = relShape(carryB, L);
    if (mode === 'bloom') {
      var p = (ch.x || ch.y) ? { x: clamp(ch.x - L.ox, Br.x + 2, Br.x + Br.w - 2), y: clamp(ch.y - L.oy, Br.y + 2, Br.y + Br.h - 2) } : centerOf(Br);
      L.filter(Math.min(Br.w, Br.h));
      D = flowBloom(L, Br, p, colB);
    } else {
      var G = geo(Ar, Br), A0 = relShape(carryA, L) || Ar;
      L.filter(G.fs);
      if (Math.abs(r.ai - r.bi) <= 1 && G.gap <= G.fs * 2.2) D = flowNear(L, G, A0, Ar, Br, colA, colB, b0);
      else if (!blocked(L, G, r.items, r.ai, r.bi)) D = flowFar(L, G, A0, Ar, Br, colA, colB, b0);
      else D = flowInPlace(L, G, A0, Ar, Br, colA, colB, b0);
    }
    if (mode === 'flow' && nA.fills[ja]) L.ghost('a', Ar, nA.fills[ja], false, D);
    if (mode !== 'tint' && oB.fills[jb]) L.ghost('b', Br, oB.fills[jb], true, D);
    if (mode === 'tint') L.el.animate([{ opacity: alpha }, { opacity: alpha, offset: 0.7 }, { opacity: 0 }], { duration: T(D), fill: 'forwards' });

    var bloom = mode === 'bloom';
    follow(A, oA && oA.color, nA && nA.color, 0.3, 0.6, D);
    follow(B, oB.color, nB.color, bloom ? 0.2 : 0.42, bloom ? 0.5 : 0.72, D);
    follow(A, oA && oA.border, nA && nA.border, 0.3, 0.6, D, 'borderColor');
    follow(B, oB.border, nB.border, bloom ? 0.2 : 0.42, bloom ? 0.5 : 0.72, D, 'borderColor');

    if (mode === 'flow') L.timers.push(later(function () {
      showFill(aEl); var i = L.hid.indexOf(aEl); if (i >= 0) L.hid.splice(i, 1);
      if (L.ghosts.a) L.ghosts.a.remove();
    }, D * 0.7));
    L.timers.push(later(L.end, D + 16));
  }

  // 按住还没松手：旧的那颗先被「吸」过去一点点，像表面张力
  function lean(ch) {
    var g = ch.g, row = g.row, s = ch.snap, idx = ch.idx, ai = -1, i, j;
    if (layers.get(row) || idx < 0) return;
    for (i = 0; i < s.items.length; i++) if (i !== idx && isOn(s.items[i]) && s.looks[i].fills.some(Boolean)) { ai = i; break; }
    if (ai < 0) {   // 没有状态标记：找「和别人都不一样」的那颗
      var counts = {};
      s.looks.forEach(function (l) { counts[l.key] = (counts[l.key] || 0) + 1; });
      for (i = 0; i < s.looks.length; i++) if (i !== idx && s.looks.length > 2 && counts[s.looks[i].key] === 1 && s.looks[i].fills.some(Boolean)) { ai = i; break; }
    }
    if (ai < 0) return;
    var la = s.looks[ai], lb = s.looks[idx], ja = -1;
    for (j = 0; j < la.fills.length; j++) if (la.fills[j] && (!lb.fills[j] || lb.fills[j].key !== la.fills[j].key)) { ja = j; break; }
    if (ja < 0) return;
    var aEl = la.cars[ja], bEl = lb.cars[ja] || s.items[idx], fill = la.fills[ja];
    if (!aEl.isConnected || !bEl.isConnected) return;
    var L = openLayer(row, g.items, false);
    if (!L) return;
    ch.lean = { L: L };
    L.el.style.opacity = fill.a;
    var A = L.rect(aEl), B = L.rect(bEl), G = geo(A, B), n = Math.min(G.dist * 0.1, 7);
    L.filter(G.fs);
    hideFill(aEl); L.hid.push(aEl);
    go(L.blob('a', fill.css), [K(A, 0, EASE.out), K(G.sz(G.mv(G.ca, n / 2), G.aA + n, G.tA, A.r), 1)], 300);
    if (G.gap < G.fs * 3) {
      var z = G.sz(G.eB, 0, 0);
      go(L.blob('b', fill.css), [K(z, 0), K(z, 0.25, EASE.out), K(G.sz(G.mv(G.eB, -G.fs * 0.06), G.fs * 0.3, G.fs * 0.3), 1)], 300);
    }
  }
  function leanBack(ch) {
    var l = ch.lean; ch.lean = null;
    if (!l || l.L.ended) return;
    var L = l.L, a = L.blobs.a, b = L.blobs.b;
    if (a && L.hid[0]) { var A = L.rect(L.hid[0]); go(a, [K(nowShape(a), 0, EASE.out), K(A, 1)], 240); }
    if (b) { var S = nowShape(b); go(b, [K(S, 0, EASE.out), K(around(centerOf(S), 0, 0), 1)], 240); }
    L.timers.push(later(L.end, 250));
  }

  /* ───────────────────────── 事件 ───────────────────────── */
  var cur = null, pending = [], lastPt = { x: 0, y: 0, t: -1e9 };
  function newWatch(ti, d, x, y) {
    return { g: ti.g, doc: d, idx: ti.g.items.indexOf(ti.g.item), snap: snapshot(ti.g), x: x, y: y, done: false, lean: null };
  }
  function check(ch, final) {
    if (ch.done) return;
    var r = diff(ch);
    if (r) { ch.done = true; run(ch, r); }
    else if (final) { ch.done = true; if (ch.lean) leanBack(ch); }
  }
  // 不同框架改 DOM 的时机不一样：同步、微任务、下一帧、稍后——都看一眼
  function watchAfter(ch) {
    pending.push(ch);
    Promise.resolve().then(function () { check(ch, false); });
    setTimeout(function () { requestAnimationFrame(function () { check(ch, false); }); }, 0);
    setTimeout(function () { check(ch, true); }, 150);
  }
  function drainPending() { var p = pending; pending = []; p.forEach(function (ch) { check(ch, false); }); }
  function cancelCur(c) {
    c = c || cur; if (!c) return;
    c.timers.forEach(clearTimeout); c.timers = [];
    if (c.pressed) unpress(c.el, c.t, c.a);
    if (c.ch && !c.ch.done) { c.ch.done = true; if (c.ch.lean) leanBack(c.ch); }
    if (cur === c) cur = null;
  }
  function onDown(e) {
    lastPt = { x: e.clientX, y: e.clientY, t: now() };
    if (cur) cancelCur(cur);
    var d = e.target.ownerDocument || root.document;
    if (e.button !== 0 || reduced(d.defaultView) || (!cfg.pudding && !cfg.caramel)) return;
    var el = e.target.closest ? e.target.closest(TAP) : null;
    if (!el) return;
    var ti = tierOf(el);
    if (ti.t === 'none') return;
    var c = cur = { el: el, ti: ti, t: ti.t, a: ampOf(ti.t, ti.r, ti.vw), id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, pressed: false, timers: [] };
    if (cfg.pudding) {
      var doPress = function () { if (cur === c) { c.pressed = true; press(el, c.t, c.a); } };
      if (e.pointerType === 'touch' || e.pointerType === 'pen') c.timers.push(later(doPress, cfg.touchDelay)); else doPress();
    }
    if (ti.t === 'choice') {
      var ch = c.ch = newWatch(ti, d, e.clientX, e.clientY);
      requestAnimationFrame(function () { check(ch, false); });   // 有的组件在按下时就切换了
      c.timers.push(later(function () { if (cur === c && !ch.done) lean(ch); }, e.pointerType === 'mouse' ? 60 : 110));
    }
  }
  function onAfterDown() { if (cur && cur.ch) check(cur.ch, false); }
  function onMove(e) {
    var c = cur;
    if (c && e.pointerId === c.id && Math.hypot(e.clientX - c.x, e.clientY - c.y) > cfg.moveCancel) cancelCur(c);
  }
  function onUp(e) {
    var c = cur;
    if (!c || e.pointerId !== c.id) return;
    c.timers.push(setTimeout(function () { if (cur === c) cancelCur(c); }, 160));   // 松手了却没有 click：弹回去
  }
  function onClick(e) {
    if (!e.isTrusted) return;
    var d = e.target.ownerDocument || root.document;
    if (reduced(d.defaultView)) return;
    var el = e.target.closest ? e.target.closest(TAP) : null;
    if (!el) return;
    var c = cur && cur.el === el ? cur : null;
    if (c) { c.timers.forEach(clearTimeout); c.timers = []; cur = null; }
    var ti = c ? c.ti : tierOf(el);
    if (ti.t === 'none') return;
    if (cfg.pudding) release(el, ti.t, c ? c.a : ampOf(ti.t, ti.r, ti.vw), !!(c && c.pressed));
    if (ti.t === 'choice') {
      var kb = !e.detail && !e.clientX && !e.clientY;   // 键盘回车 / 空格触发的 click
      watchAfter(c && c.ch ? c.ch : newWatch(ti, d, kb ? 0 : e.clientX, kb ? 0 : e.clientY));
    }
  }
  function onKey(e) {   // 方向键在 tab 之间切换
    if (!/^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) return;
    var el = e.target && e.target.closest ? e.target.closest(TAP) : null;
    if (!el || reduced(el.ownerDocument.defaultView)) return;
    var ti = tierOf(el);
    if (ti.t !== 'choice') return;
    var ch = newWatch(ti, el.ownerDocument, 0, 0);
    ch.idx = -1;
    watchAfter(ch);
  }

  /* ───────────────────────── 浮层：弹出 / 菜单从指尖长出来 / 收起 ───────────────────────── */
  var CSS_TEXT = [
    '@keyframes cp-pop{0%{opacity:0;translate:0 24px;scale:.86;animation-timing-function:cubic-bezier(.2,.8,.3,1)}50%{opacity:1;translate:0 -4px;scale:1.03 .975;animation-timing-function:cubic-bezier(.45,0,.55,1)}70%{translate:0 1px;scale:.988 1.016}86%{translate:0 0;scale:1.004 .997}100%{opacity:1;translate:0 0;scale:1}}',
    '.cp-pop{animation:cp-pop calc(580ms / var(--cp-speed,1)) backwards}',
    '@keyframes cp-menu{0%{opacity:0;scale:.16 .1;border-radius:999px;animation-timing-function:cubic-bezier(.2,.8,.3,1)}18%{opacity:1}46%{scale:1.05 .955;border-radius:var(--cp-radius,16px);animation-timing-function:cubic-bezier(.45,0,.55,1)}66%{scale:.982 1.03;animation-timing-function:cubic-bezier(.45,0,.55,1)}84%{scale:1.007 .993}100%{opacity:1;scale:1}}',
    '.cp-menu{animation:cp-menu calc(600ms / var(--cp-speed,1)) backwards;transform-origin:var(--cp-ox,50%) var(--cp-oy,0%)}',
    '.cp-menu>*{animation:cp-menu-in calc(360ms / var(--cp-speed,1)) calc(130ms / var(--cp-speed,1)) backwards}',
    '@keyframes cp-menu-in{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}',
    '@keyframes cp-out{to{opacity:0;scale:.94}}',
    '.cp-out,.cp-out.cp-pop,.cp-out.cp-menu{animation:cp-out calc(170ms / var(--cp-speed,1)) cubic-bezier(.4,0,1,1) forwards;pointer-events:none}',
    '@media (prefers-reduced-motion:reduce){.cp-pop,.cp-menu,.cp-menu>*{animation:none}.cp-out,.cp-out.cp-pop,.cp-out.cp-menu{animation-duration:1ms}}'
  ].join('\n');
  function injectCSS(d) {
    if (d.getElementById('cp-style')) return;
    var st = d.createElement('style'); st.id = 'cp-style'; st.textContent = CSS_TEXT;
    (d.head || d.documentElement).appendChild(st);
  }
  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  // 把菜单的 transform-origin 设到手指按下的地方
  function origin(el, x, y) {
    if (x == null) { if (now() - lastPt.t > 1200) return; x = lastPt.x; y = lastPt.y; }
    if (!el.getClientRects().length) return;
    var st = el.style, an = st.getPropertyValue('animation'), ap = st.getPropertyPriority('animation');
    st.setProperty('animation', 'none', 'important');
    var r = el.getBoundingClientRect();
    st.setProperty('--cp-ox', clamp(x - r.left, 0, r.width).toFixed(1) + 'px');
    st.setProperty('--cp-oy', clamp(y - r.top, 0, r.height).toFixed(1) + 'px');
    if (an) st.setProperty('animation', an, ap); else st.removeProperty('animation');
  }
  var shown = new WeakMap();
  function observeMenus(d) {
    if (!root.MutationObserver) return;
    var visit = function (el) {
      var v = el.getClientRects().length > 0, was = shown.get(el);
      shown.set(el, v);
      if (v && !was) origin(el);
    };
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1 || n.hasAttribute('data-cp-layer') || n.hasAttribute('data-cp-ghost')) continue;
            if (n.classList.contains('cp-menu')) visit(n);
            if (n.firstElementChild) { var q = n.querySelectorAll('.cp-menu'); for (var k = 0; k < q.length; k++) visit(q[k]); }
          }
        } else if (m.target.classList && m.target.classList.contains('cp-menu')) visit(m.target);
      });
    }).observe(d.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
  }

  /* ───────────────────────── 对外 ───────────────────────── */
  var bound = [];
  function bind(d) {
    d = d || root.document;
    if (bound.indexOf(d) >= 0) return;
    bound.push(d);
    var win = d.defaultView || root;
    injectCSS(d);
    if (cfg.speed !== 1) d.documentElement.style.setProperty('--cp-speed', cfg.speed);
    d.addEventListener('pointerdown', onDown, true);
    d.addEventListener('pointermove', onMove, true);
    d.addEventListener('pointerup', onUp, true);
    d.addEventListener('pointercancel', function () { cancelCur(); }, true);
    d.addEventListener('dragstart', function () { cancelCur(); }, true);
    d.addEventListener('contextmenu', function () { cancelCur(); }, true);
    d.addEventListener('click', onClick, true);
    d.addEventListener('keydown', onKey, true);
    win.addEventListener('pointerdown', onAfterDown, false);
    win.addEventListener('mousedown', onAfterDown, false);
    win.addEventListener('click', drainPending, false);
    win.addEventListener('keydown', drainPending, false);
    observeMenus(d);
  }
  // 手动版：你自己的组件把选中态从 a 换到了 b 之后调用（自动检测不到时用）
  function flow(a, b) {
    if (!a || !b || a === b || reduced(winOf(b))) return;
    var row = b.parentElement;
    while (row && !row.contains(a)) row = row.parentElement;
    var fill = row && fillOf(b);
    if (!row || !fill) return;
    var prev = layers.get(row); if (prev) prev.end();
    var L = openLayer(row, [b], false); if (!L) return;
    L.main = b; L.el.style.opacity = fill.a;
    hideFill(b); L.hid.push(b);
    var Ar = L.rect(a), Br = L.rect(b), G = geo(Ar, Br), D;
    L.filter(G.fs);
    D = G.gap <= G.fs * 2.2 ? flowNear(L, G, Ar, Ar, Br, fill.css, fill.css) : flowFar(L, G, Ar, Ar, Br, fill.css, fill.css);
    L.timers.push(later(L.end, D + 16));
  }
  function pop(el) { if (el) replay(el, 'cp-pop'); }
  function menu(el, x, y) { if (!el) return; el.classList.remove('cp-out'); origin(el, x, y); replay(el, 'cp-menu'); }
  // 收起：opts = 'remove' 动画完删掉元素；'hide' 动画完设 hidden
  function out(el, opts) {
    return new Promise(function (res) {
      if (!el) return res();
      var fin = function () {
        if (fin.done) return; fin.done = true;
        if (opts === 'remove') el.remove();
        else if (opts === 'hide') { el.hidden = true; el.classList.remove('cp-out'); }
        res();
      };
      if (reduced(winOf(el))) return fin();
      el.classList.add('cp-out');
      el.addEventListener('animationend', function h(e) { if (e.target === el) { el.removeEventListener('animationend', h); fin(); } });
      setTimeout(fin, T(260));
    });
  }
  function setSpeed(k) {
    cfg.speed = k > 0 ? k : 1;
    bound.forEach(function (d) { if (cfg.speed === 1) d.documentElement.style.removeProperty('--cp-speed'); else d.documentElement.style.setProperty('--cp-speed', cfg.speed); });
  }

  root.CaramelPudding = {
    version: '1.0.0',
    config: cfg,
    bind: bind,
    tier: function (el) { return tierOf(el).t; },
    pop: pop,
    menu: menu,
    out: out,
    flow: flow,
    setSpeed: setSpeed
  };
  bind(root.document);
})(typeof window !== 'undefined' ? window : this);
