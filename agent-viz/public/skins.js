// 皮肤：铺在卡片内容下面的一层淡淡的图案，上面再盖一层蒙版，字照样清楚。
// 桌面卡片、看板和安卓卡片画的是同一套图形（安卓那边在 Skins.kt 里照着这里画）。
// Skins: a faint pattern under the card's content with a scrim on top, so text stays readable.
// The desktop card, the board and the Android card draw the same shapes (Skins.kt mirrors this file).
(function (root) {
  'use strict';
  const LIST = [
    { id: 'none', zh: '默认', en: 'Default' },
    // fox：淡橙底 + PAXON 像素字；右下角一只敲键盘的小狐狸浮在文字上面（只在桌面卡片和手机卡片上）
    // fox: soft orange wash + PAXON pixel lettering; a small fox typing at a desk floats above the text (desktop and phone cards only)
    { id: 'fox', zh: '小狐狸', en: 'Fox', anim: true, cardOnly: true },
    { id: 'clay', zh: '陶土', en: 'Clay' },
    { id: 'contour', zh: '等高线', en: 'Contour' },
    { id: 'terminal', zh: '终端', en: 'Terminal' },
    { id: 'dunes', zh: '沙丘', en: 'Dunes' },
    { id: 'aurora', zh: '极光', en: 'Aurora' },
    { id: 'night', zh: '星野', en: 'Night sky' },
  ];
  const IDS = LIST.map(s => s.id);
  const CLAY = '#D97757', SAND = '#E8B98A', SAND2 = '#F2D3AE', CLAY2 = '#DE9A70', VIOLET = '#A64BD6', SKY = '#409CFF';

  // 同一个种子每次画出一样的星星和颗粒 / a seeded generator, so stars and grain stay put
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f1 = n => Math.round(n * 10) / 10;

  // 图形清单（和安卓共用的描述）/ the shape list, the description shared with Android
  // blob: 径向渐变的光斑；dot: 小圆点；line: 折线；fill: 填到底部的波浪；rect: 方块；spark: 四角星
  // 像素字（5×7）/ 5×7 pixel letters
  const FONT = { P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'], A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'] };
  const FOX_WORD = 'PAXON';

  // wash: 铺满的线性渐变；text: 等宽字；scrim: 自带的蒙版；word: 像素描边立体字
  // wash: full-size linear gradient; text: monospace text; scrim: the skin's own scrim; word: layered pixel lettering
  function shapes(id, w, h, dark) {
    const R = Math.hypot(w, h), S = Math.min(w, h);
    const ink = dark ? '#FFFFFF' : '#3D2B22';
    const out = [];
    const blob = (x, y, r, color, a) => out.push({ t: 'blob', x, y, r, color, a });
    if (id === 'fox') {
      // 底色 → 暖光 → 斜光线 → 几行代码 → 自带的蒙版 → PAXON（在蒙版上面）/ wash, glow, light lines, code, its own scrim, then PAXON on top
      out.push(dark ? { t: 'wash', c0: '#241E1B', c1: '#131418' } : { t: 'wash', c0: '#FFF3EA', c1: '#F3EEE9' });
      blob(0.85 * w, 0.85 * h, 0.6 * w, CLAY, dark ? 0.28 : 0.2);
      for (let i = 0; i < 4; i++) out.push({ t: 'line', pts: [[-10, h * (0.6 + i * 0.13)], [w * (0.32 + i * 0.1), -10]], color: CLAY, a: dark ? 0.14 : 0.18, w: 0.8 });
      [[18, 0.2, 0.3], [30, 0.26, 0.12], [30 + 0.14 * w, 0.26, 0.16]].forEach(([x, y, bw]) => out.push({ t: 'rect', x, y: y * h, w: bw * w, h: 4, color: ink, a: 0.06 }));
      out.push({ t: 'text', x: 16, y: 0.5 * h, s: 12, text: '</>', color: CLAY, a: 0.25 }, { t: 'text', x: 16, y: 0.62 * h, s: 12, text: '$', color: CLAY, a: 0.22 });
      out.push({ t: 'scrim', color: dark ? '#1C1C1E' : '#FFFFFF', a: dark ? [0.5, 0.22, 0] : [0.55, 0.25, 0] });
      // PAXON 小一点，贴在小狐狸左边 / PAXON smaller, just left of the fox
      out.push({ t: 'word', x: w - 188, y: h - 57, b: 2.8, text: FOX_WORD, color: CLAY, a: dark ? 0.6 : 0.55 });
      return out;
    }
    if (id === 'clay') {
      blob(0.95 * w, 1.05 * h, 0.75 * R, CLAY, 0.6);
      blob(0.04 * w, -0.06 * h, 0.45 * R, SAND, 0.4);
      const r = rng(11), n = Math.round(w * h / 90);
      for (let i = 0; i < n; i++) out.push({ t: 'dot', x: r() * w, y: r() * h, r: 0.6, color: ink, a: 0.05 + r() * 0.08 });
    } else if (id === 'contour') {
      const cx = 0.88 * w, cy = 0.92 * h;
      blob(cx, cy, 0.42 * R, CLAY, 0.22);
      for (let i = 0; i < 13; i++) {
        const base = (0.06 + i * 0.07) * R, pts = [];
        for (let k = 0; k <= 96; k++) {
          const th = k / 96 * Math.PI * 2;
          const rr = base * (1 + 0.1 * Math.sin(3 * th + i * 0.45) + 0.05 * Math.sin(5 * th + 1.3 + i * 0.2));
          pts.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th) * 0.82]);
        }
        out.push({ t: 'line', pts, color: CLAY, a: Math.max(0.12, 0.6 - i * 0.035), w: i % 4 === 0 ? 1.4 : 0.9 });
      }
    } else if (id === 'terminal') {
      const gap = 16;
      for (let y = gap / 2; y < h; y += gap) for (let x = gap / 2; x < w; x += gap) {
        const fade = Math.min(1, Math.max(0.12, 1.15 - Math.hypot(w - x, h - y) / R * 1.3));
        out.push({ t: 'dot', x, y, r: 0.9, color: ink, a: (dark ? 0.22 : 0.18) * fade });
      }
      const u = Math.min(0.13 * S, 44), x0 = w - 2.5 * u - 16, y0 = h - u - 46;
      blob(w - 1.2 * u - 16, y0 + 0.5 * u, 2.4 * u, CLAY, 0.2);
      out.push({ t: 'line', pts: [[x0, y0], [x0 + 0.62 * u, y0 + 0.5 * u], [x0, y0 + u]], color: CLAY, a: 0.5, w: 0.12 * u, cap: true });
      out.push({ t: 'rect', x: x0 + 0.95 * u, y: y0 + 0.86 * u, w: 1.0 * u, h: 0.15 * u, color: CLAY, a: 0.42 });
    } else if (id === 'dunes') {
      if (!dark) blob(0.85 * w, 0.2 * h, 0.35 * R, SAND2, 0.35);
      const cols = [SAND2, SAND, CLAY2, CLAY], al = dark ? [0.16, 0.24, 0.34, 0.46] : [0.5, 0.5, 0.5, 0.55], fr = [0.9, 1.3, 0.8, 1.1], ph = [0.3, 1.9, 3.1, 4.4];
      for (let i = 0; i < 4; i++) {
        const pts = [];
        for (let k = 0; k <= 64; k++) {
          const x = k / 64 * w;
          pts.push([x, h * (0.54 + i * 0.12) + 0.055 * h * Math.sin(2 * Math.PI * (x / w) * fr[i] + ph[i])]);
        }
        out.push({ t: 'fill', pts, color: cols[i], a: al[i] });
      }
    } else if (id === 'aurora') {
      blob(0.85 * w, 0.95 * h, 0.55 * R, CLAY, 0.6);
      blob(0.5 * w, 1.08 * h, 0.45 * R, VIOLET, 0.38);
      blob(1.05 * w, 0.4 * h, 0.4 * R, SKY, 0.32);
      blob(0.12 * w, 1.1 * h, 0.35 * R, SAND, 0.4);
    } else if (id === 'night') {
      const r = rng(7), n = Math.round(w * h / 650);
      for (let i = 0; i < n; i++) { const q = r(); out.push({ t: 'dot', x: r() * w, y: r() * h, r: 0.4 + q * q * q * 1.3, color: ink, a: 0.2 + r() * 0.55 }); }
      const ell = (rx, ry, a, wd) => {
        const pts = [], cx = 0.98 * w, cy = 1.18 * h, rot = -12 * Math.PI / 180;
        for (let k = 0; k <= 120; k++) {
          const th = k / 120 * Math.PI * 2, ex = rx * Math.cos(th), ey = ry * Math.sin(th);
          pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
        }
        out.push({ t: 'line', pts, color: CLAY, a, w: wd });
      };
      blob(0.98 * w, 1.15 * h, 0.5 * R, CLAY, 0.25);
      ell(0.82 * w, 0.58 * h, 0.4, 1.1);
      ell(0.62 * w, 0.42 * h, 0.25, 0.9);
      for (const [x, y, s] of [[0.86, 0.12, 7], [0.94, 0.8, 5], [0.68, 0.9, 4]]) out.push({ t: 'spark', x: x * w, y: y * h, s, color: CLAY, a: 0.75 });
    }
    return out;
  }

  // 蒙版：左上（字多的地方）盖得厚，右下（图案集中的地方）盖得薄 / scrim: heavy top-left where the text is, light bottom-right
  const SCRIM = { light: [0.8, 0.2], dark: [0.68, 0.12] };

  // 像素描边立体字：两层错开的描边 + 实心字 / layered pixel lettering: two offset outlines + solid letters
  function wordCells(text, b) {
    const cells = [];
    [...text].forEach((ch, k) => (FONT[ch] || []).forEach((row, y) => [...row].forEach((v, x) => { if (v === '1') cells.push([k * 6 * b + x * b, y * b]); })));
    return cells;
  }
  const shadeHex = (hx, k) => '#' + [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16)).map(v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))))).map(v => v.toString(16).padStart(2, '0')).join('');
  function wordSvg(s) {
    const b = s.b, cells = wordCells(s.text, b), dk = shadeHex(s.color, -0.18);
    let o = '';
    for (const off of [b * 0.9, b * 0.5]) o += cells.map(([x, y]) => `<rect x="${f1(s.x + x + off + 0.4)}" y="${f1(s.y + y + off + 0.4)}" width="${f1(b - 0.8)}" height="${f1(b - 0.8)}" fill="none" stroke="${s.color}" stroke-width=".7"/>`).join('');
    o += cells.map(([x, y]) => `<rect x="${f1(s.x + x)}" y="${f1(s.y + y)}" width="${f1(b)}" height="${f1(b)}" fill="${s.color}" stroke="${dk}" stroke-width=".5"/>`).join('');
    return `<g opacity="${s.a}">${o}</g>`;
  }

  function svg(id, w, h, dark) {
    if (!id || id === 'none' || !IDS.includes(id)) return '';
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const defs = [], body = [];
    shapes(id, w, h, dark).forEach((s, i) => {
      if (s.t === 'wash') {
        defs.push(`<linearGradient id="w${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.c0}"/><stop offset="1" stop-color="${s.c1}"/></linearGradient>`);
        body.push(`<rect width="${w}" height="${h}" fill="url(#w${i})"/>`);
      } else if (s.t === 'scrim') {
        defs.push(`<linearGradient id="s${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="${s.a[0]}"/><stop offset=".55" stop-color="${s.color}" stop-opacity="${s.a[1]}"/><stop offset="1" stop-color="${s.color}" stop-opacity="${s.a[2]}"/></linearGradient>`);
        body.push(`<rect width="${w}" height="${h}" fill="url(#s${i})"/>`);
      } else if (s.t === 'word') body.push(wordSvg(s));
      else if (s.t === 'text') body.push(`<text x="${f1(s.x)}" y="${f1(s.y)}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${s.s}" fill="${s.color}" fill-opacity="${s.a}">${s.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`);
      else if (s.t === 'blob') {
        defs.push(`<radialGradient id="b${i}" gradientUnits="userSpaceOnUse" cx="${f1(s.x)}" cy="${f1(s.y)}" r="${f1(s.r)}"><stop offset="0" stop-color="${s.color}" stop-opacity="${s.a}"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></radialGradient>`);
        body.push(`<circle cx="${f1(s.x)}" cy="${f1(s.y)}" r="${f1(s.r)}" fill="url(#b${i})"/>`);
      } else if (s.t === 'dot') body.push(`<circle cx="${f1(s.x)}" cy="${f1(s.y)}" r="${s.r.toFixed(2)}" fill="${s.color}" fill-opacity="${s.a.toFixed(3)}"/>`);
      else if (s.t === 'line') body.push(`<polyline points="${s.pts.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ')}" fill="none" stroke="${s.color}" stroke-opacity="${s.a.toFixed(3)}" stroke-width="${f1(s.w)}"${s.cap ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}/>`);
      else if (s.t === 'fill') body.push(`<path d="M0,${h} L${s.pts.map(p => f1(p[0]) + ',' + f1(p[1])).join(' L')} L${w},${h} Z" fill="${s.color}" fill-opacity="${s.a}"/>`);
      else if (s.t === 'rect') body.push(`<rect x="${f1(s.x)}" y="${f1(s.y)}" width="${f1(s.w)}" height="${f1(s.h)}" rx="${f1(s.h / 3)}" fill="${s.color}" fill-opacity="${s.a}"/>`);
      else if (s.t === 'spark') { const a = s.s, b = s.s * 0.22; body.push(`<path d="M${f1(s.x)},${f1(s.y - a)} Q${f1(s.x)},${f1(s.y)} ${f1(s.x + a)},${f1(s.y)} Q${f1(s.x)},${f1(s.y)} ${f1(s.x)},${f1(s.y + a)} Q${f1(s.x)},${f1(s.y)} ${f1(s.x - a)},${f1(s.y)} Q${f1(s.x)},${f1(s.y)} ${f1(s.x)},${f1(s.y - a)}Z" fill="${s.color}" fill-opacity="${s.a}" stroke="${s.color}" stroke-opacity="${s.a}" stroke-width="${f1(b)}" stroke-linejoin="round"/>`); }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
  }

  // ---------- 小狐狸那一幕（等距方块）/ the fox scene, isometric blocks ----------
  // 16 帧一圈、每帧 150 毫秒；安卓的逐帧动画就是从这里截的（android/tools/fox-frames.js）
  // 16 frames per loop, 150 ms each; Android's frame animation is cut from this (android/tools/fox-frames.js)
  const FOX_FRAMES = 16, FOX_STEP = 150;
  function foxScene(dark, t) {
    const S0 = 10, P = (x, y, z) => [(x - y) * S0 * 0.866, (x + y) * S0 * 0.5 - z * S0];
    let bb = null;
    const pts = a => { for (const q of a) { if (!bb) bb = [q[0], q[1], q[0], q[1]]; bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); } return a.map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' '); };
    const cub = b => {
      const { x, y, z, dx, dy, dz, c } = b, T = shadeHex(c, 0.16), R = shadeHex(c, -0.22);
      return `<polygon points="${pts([P(x + dx, y, z), P(x + dx, y + dy, z), P(x + dx, y + dy, z + dz), P(x + dx, y, z + dz)])}" fill="${R}"/>`
        + `<polygon points="${pts([P(x, y + dy, z), P(x + dx, y + dy, z), P(x + dx, y + dy, z + dz), P(x, y + dy, z + dz)])}" fill="${c}"/>`
        + `<polygon points="${pts([P(x, y, z + dz), P(x + dx, y, z + dz), P(x + dx, y + dy, z + dz), P(x, y + dy, z + dz)])}" fill="${T}"/>`;
    };
    const patch = (x0, x1, y, z0, z1, c, op) => `<polygon points="${pts([P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)])}" fill="${c}"${op != null ? ` opacity="${op}"` : ''}/>`;
    const C = dark ? { desk: '#3A404E', leg: '#2C313C', fox: '#EC7B3C', wh: '#FBF3EA', dk: '#2B1F19', kb: '#474E5D', key: '#5E6676', keyOn: '#FF9F6B', mug: '#C8CCD4', cof: '#6E4630', glass: 'rgba(240,150,110,.14)', gl: '#F0A07E', code: '#F5A882' }
      : { desk: '#EFE8E1', leg: '#E0D6CC', fox: '#EC7B3C', wh: '#FFFFFF', dk: '#3A2A22', kb: '#FFFFFF', key: '#E3DBD2', keyOn: '#F2A27F', mug: '#FFFFFF', cof: '#A86E4B', glass: 'rgba(255,255,255,.6)', gl: '#E08A68', code: '#D97757' };
    let s = '';
    // 桌子 / desk
    s += cub({ x: -5.6, y: 2.6, z: -2.0, dx: 0.8, dy: 0.8, dz: 1.2, c: C.leg }) + cub({ x: 5.0, y: -2.6, z: -2.0, dx: 0.8, dy: 0.8, dz: 1.2, c: C.leg });
    s += cub({ x: -6, y: -3, z: -0.8, dx: 12, dy: 6.4, dz: 0.8, c: C.desk });
    s += cub({ x: 5.0, y: 2.6, z: -2.0, dx: 0.8, dy: 0.8, dz: 1.2, c: C.leg });
    // 玻璃终端：字一格一格地出来 / glass terminal: text appears one cell at a time
    const gy = -2, gx0 = -5.6, gx1 = -0.8;
    s += cub({ x: -3.8, y: gy - 0.6, z: 0, dx: 1.2, dy: 1.2, dz: 0.25, c: C.leg });
    s += patch(gx0, gx1, gy, 0.6, 6.0, C.glass) + `<polygon points="${pts([P(gx0, gy, 0.6), P(gx1, gy, 0.6), P(gx1, gy, 6), P(gx0, gy, 6)])}" fill="none" stroke="${C.gl}" stroke-width="1.1" stroke-linejoin="round"/>`;
    for (let i = 0; i < 3; i++) s += patch(gx0 + 0.5 + i * 0.5, gx0 + 0.8 + i * 0.5, gy, 5.3, 5.6, C.code, 0.7);
    s += patch(gx0 + 0.5, gx0 + 0.95, gy, 4.2, 4.7, C.code);
    let n = Math.floor(t * 16) * 2;
    [6, 4, 5].forEach((len, i) => { const c = Math.max(0, Math.min(len, n)); n -= len; for (let j = 0; j < c; j++) s += patch(gx0 + 1.2 + j * 0.48, gx0 + 1.56 + j * 0.48, gy, 4.25 - i * 0.9, 4.65 - i * 0.9, C.code, i ? 0.6 : 0.95); });
    if ((t * 4 | 0) % 2 === 0) s += patch(gx0 + 0.5, gx0 + 0.95, gy, 1.3, 2.0, C.code);
    // 小狐狸 / the fox
    const k = 0.9, ox = 0.4, oy = -0.6;
    const F = b => cub({ ...b, x: ox + b.x * k, y: oy + b.y * k, z: b.z * k, dx: b.dx * k, dy: b.dy * k, dz: b.dz * k });
    const FP = (x0, x1, y, z0, z1, c) => patch(ox + x0 * k, ox + x1 * k, oy + y * k, z0 * k, z1 * k, c);
    const sw = [0, 0.4, 0.8, 0.4][(t * 8 | 0) % 4];
    s += F({ x: 2.4, y: -1.2, z: 0, dx: 1.4, dy: 1.3, dz: 1.0, c: C.fox });
    s += F({ x: 3.0 + sw * 0.4, y: -1.2, z: 1.0, dx: 1.3, dy: 1.3, dz: 1.8, c: C.fox });
    s += F({ x: 3.0 + sw * 0.4, y: -1.2, z: 2.8, dx: 1.3, dy: 1.3, dz: 0.9, c: C.wh });
    s += F({ x: 0, y: 0, z: 0, dx: 2.8, dy: 2.4, dz: 2.6, c: C.fox });
    s += FP(0.6, 2.2, 2.4, 0.3, 2.4, C.wh);
    // 键盘，按下去的键会亮 / keyboard; the pressed key lights up
    const kx = ox - 1.2, ky = oy + 2.6 * k, step = (t * 8 | 0), hit = [3, 7, 1, 5, 2, 6, 0, 4][step];
    s += cub({ x: kx, y: ky, z: 0, dx: 4.6, dy: 1.9, dz: 0.3, c: C.kb });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const on = i + j * 4 === hit; s += cub({ x: kx + 0.25 + i * 1.08, y: ky + 0.22 + j * 0.85, z: 0.3, dx: 0.85, dy: 0.6, dz: on ? 0.04 : 0.1, c: on ? C.keyOn : C.key }); }
    // 两只前爪轮流敲 / the two front paws take turns
    const left = step % 2 === 0;
    s += cub({ x: ox + 0.3 * k, y: ky + 0.25, z: 0.3 + (left ? 0.05 : 0.45), dx: 0.75 * k, dy: 0.9, dz: 0.45, c: C.dk });
    s += cub({ x: ox + 1.75 * k, y: ky + 0.25, z: 0.3 + (left ? 0.45 : 0.05), dx: 0.75 * k, dy: 0.9, dz: 0.45, c: C.dk });
    // 头、耳朵、脸 / head, ears, face
    s += F({ x: -0.3, y: 0.2, z: 2.6, dx: 3.4, dy: 2.9, dz: 2.4, c: C.fox });
    s += FP(-0.3, 3.1, 3.1, 2.6, 3.5, C.wh);
    const tw = t > 0.55 && t < 0.62 ? 0.3 : 0;
    s += F({ x: -0.3, y: 0.8, z: 5.0, dx: 1.0, dy: 0.9, dz: 1.0, c: C.fox }) + F({ x: -0.3, y: 0.8, z: 6.0, dx: 1.0, dy: 0.9, dz: 0.5, c: C.dk });
    s += F({ x: 2.1, y: 0.8, z: 5.0, dx: 1.0, dy: 0.9, dz: 1.0 + tw, c: C.fox }) + F({ x: 2.1, y: 0.8, z: 6.0 + tw, dx: 1.0, dy: 0.9, dz: 0.5, c: C.dk });
    s += F({ x: 0.9, y: 3.1, z: 2.75, dx: 1.0, dy: 1.0, dz: 0.8, c: C.wh });
    s += FP(1.15, 1.65, 4.1, 3.15, 3.55, C.dk);
    const blink = t > 0.86 && t < 0.94;
    s += FP(0.0, 0.55, 3.1, 3.7, blink ? 3.8 : 4.35, C.dk) + FP(2.25, 2.8, 3.1, 3.7, blink ? 3.8 : 4.35, C.dk);
    // 杯子 / mug
    s += cub({ x: 3.4, y: 1.8, z: 0, dx: 1.3, dy: 1.3, dz: 1.5, c: C.mug }) + cub({ x: 4.7, y: 2.2, z: 0.35, dx: 0.4, dy: 0.5, dz: 0.8, c: C.mug });
    s += `<polygon points="${pts([P(3.5, 1.9, 1.51), P(4.6, 1.9, 1.51), P(4.6, 3.0, 1.51), P(3.5, 3.0, 1.51)])}" fill="${C.cof}"/>`;
    return { body: s, bb };
  }
  // 所有帧共用一个取景框，画面不会跟着动作抖 / one view box for every frame, so the picture doesn't jitter
  const foxViewCache = {};
  function foxView(dark) {
    if (foxViewCache[dark]) return foxViewCache[dark];
    let u = null;
    for (let i = 0; i < FOX_FRAMES; i++) { const b = foxScene(dark, i / FOX_FRAMES).bb; u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b; }
    const pad = 6;
    return (foxViewCache[dark] = { x: u[0] - pad, y: u[1] - pad, w: u[2] - u[0] + 2 * pad, h: u[3] - u[1] + 2 * pad });
  }
  function foxSvg(dark, t) {
    const v = foxView(dark);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}" width="100%" height="100%">${foxScene(dark, t).body}</svg>`;
  }
  /**
   * 把会动的小狐狸放进一个元素里（浮在文字上面的那一层）。id 不是会动的皮肤就清空。
   * Puts the animated fox into an element (the layer above the text); clears it for skins without one.
   */
  function mountScene(el, id, opts) {
    if (!el) return;
    const o = opts || {}, dark = !!o.dark, key = [id, dark, o.height].join('|');
    if (el.dataset.sceneKey === key) return;
    el.dataset.sceneKey = key;
    if (el._timer) { clearInterval(el._timer); el._timer = null; }
    if (id !== 'fox') { el.innerHTML = ''; el.hidden = true; return; }
    const v = foxView(dark), h = o.height || 86;
    el.hidden = false;
    el.style.height = h + 'px';
    el.style.width = Math.round(h * v.w / v.h) + 'px';
    let i = 0;
    const draw = () => { el.innerHTML = foxSvg(dark, (i % FOX_FRAMES) / FOX_FRAMES); i++; };
    draw();
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) el._timer = setInterval(draw, FOX_STEP);
  }
  const url = (id, w, h, dark) => { const s = svg(id, w, h, dark); return s ? `url("data:image/svg+xml,${encodeURIComponent(s)}")` : 'none'; };

  /**
   * 把皮肤铺到一个元素上：el 里面放一层图案、一层蒙版。surface 是蒙版颜色（卡片底色）。
   * Lays a skin on an element: one layer for the pattern, one for the scrim. surface is the scrim colour (the card colour).
   */
  function apply(el, id, opts) {
    if (!el) return;
    const o = opts || {};
    const dark = !!o.dark;
    const r = el.getBoundingClientRect();
    const w = Math.round(o.width || r.width || 340), h = Math.round(o.height || r.height || 260);
    const key = [id, w, h, dark, o.surface].join('|');
    if (el.dataset.skinKey === key) return;
    el.dataset.skinKey = key;
    if (!id || id === 'none' || !IDS.includes(id)) { el.style.backgroundImage = 'none'; el.hidden = true; return; }
    el.hidden = false;
    const [a0, a1] = SCRIM[dark ? 'dark' : 'light'];
    const c = o.surface || (dark ? '28,28,30' : '255,255,255');
    // fox 自带蒙版（PAXON 要在蒙版上面）/ fox brings its own scrim (PAXON sits above it)
    el.style.backgroundImage = id === 'fox' ? url(id, w, h, dark) : `linear-gradient(135deg, rgba(${c},${a0}) 0%, rgba(${c},${(a0 + a1) / 2}) 55%, rgba(${c},${a1}) 100%), ${url(id, w, h, dark)}`;
    el.style.backgroundSize = '100% 100%';
  }
  const name = (id, lang) => { const s = LIST.find(x => x.id === id) || LIST[0]; return lang === 'zh' ? s.zh : s.en; };

  const api = { LIST, IDS, shapes, svg, url, apply, name, SCRIM, FONT, FOX_WORD, FOX_FRAMES, FOX_STEP, foxSvg, foxView, mountScene };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Skins = api;
})(typeof window !== 'undefined' ? window : globalThis);
