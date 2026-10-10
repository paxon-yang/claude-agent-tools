// 皮肤：铺在卡片内容下面的一层淡淡的图案，上面再盖一层蒙版，字照样清楚。
// 桌面卡片、看板和安卓卡片画的是同一套图形（安卓那边在 Skins.kt 里照着这里画）。
// Skins: a faint pattern under the card's content with a scrim on top, so text stays readable.
// The desktop card, the board and the Android card draw the same shapes (Skins.kt mirrors this file).
(function (root) {
  'use strict';
  const LIST = [
    { id: 'none', zh: '默认', en: 'Default' },
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
  function shapes(id, w, h, dark) {
    const R = Math.hypot(w, h), S = Math.min(w, h);
    const ink = dark ? '#FFFFFF' : '#3D2B22';
    const out = [];
    const blob = (x, y, r, color, a) => out.push({ t: 'blob', x, y, r, color, a });
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
      const u = Math.min(0.13 * S, 44), x0 = w - 2.5 * u - 16, y0 = h - 1.25 * u - 14;
      blob(w - 1.2 * u - 16, h - 0.6 * u - 14, 2.4 * u, CLAY, 0.2);
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

  function svg(id, w, h, dark) {
    if (!id || id === 'none' || !IDS.includes(id)) return '';
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const defs = [], body = [];
    shapes(id, w, h, dark).forEach((s, i) => {
      if (s.t === 'blob') {
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
    el.style.backgroundImage = `linear-gradient(135deg, rgba(${c},${a0}) 0%, rgba(${c},${(a0 + a1) / 2}) 55%, rgba(${c},${a1}) 100%), ${url(id, w, h, dark)}`;
    el.style.backgroundSize = '100% 100%';
  }
  const name = (id, lang) => { const s = LIST.find(x => x.id === id) || LIST[0]; return lang === 'zh' ? s.zh : s.en; };

  const api = { LIST, IDS, shapes, svg, url, apply, name, SCRIM };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Skins = api;
})(typeof window !== 'undefined' ? window : globalThis);
