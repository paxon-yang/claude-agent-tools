// 皮肤：铺在卡片内容下面的一层淡淡的图案，上面再盖一层蒙版，字照样清楚。
// 桌面卡片、看板和安卓卡片画的是同一套图形（安卓那边在 Skins.kt 里照着这里画）。
// Skins: a faint pattern under the card's content with a scrim on top, so text stays readable.
// The desktop card, the board and the Android card draw the same shapes (Skins.kt mirrors this file).
(function (root) {
  'use strict';
  const LIST = [
    { id: 'none', zh: '默认', en: 'Default' },
    { id: 'desk', zh: '工位', en: 'Desk', anim: true },
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
  // blob: 径向渐变的光斑；dot: 小圆点；line: 折线；fill: 填到底部的波浪；rect: 方块；spark: 四角星；
  // wash: 铺满的线性渐变；text: 等宽字
  // blob: radial glow; dot; line: polyline; fill: wave filled to the bottom; rect; spark: four-point star;
  // wash: full-size linear gradient; text: monospace text
  function shapes(id, w, h, dark) {
    const R = Math.hypot(w, h), S = Math.min(w, h);
    const ink = dark ? '#FFFFFF' : '#3D2B22';
    const out = [];
    const blob = (x, y, r, color, a) => out.push({ t: 'blob', x, y, r, color, a });
    if (id === 'desk') {
      // 工位：淡橙色渐变、左边几行代码、几道斜光；右下角那一幕（会动）另外放 / Desk: a soft orange wash, a few code lines,
      // some diagonal light; the animated scene in the bottom-right corner is a separate layer
      out.push(dark
        ? { t: 'wash', c0: '#262A36', a0: 1, c1: '#171A22', a1: 1 }
        : { t: 'wash', c0: '#FCE6D4', a0: 1, c1: '#E9EEF4', a1: 1 });
      blob(0.86 * w, 0.86 * h, 0.5 * R, CLAY, dark ? 0.32 : 0.22);
      blob(0.02 * w, 0.02 * h, 0.4 * R, dark ? CLAY : SAND, dark ? 0.12 : 0.3);
      for (let i = 0; i < 5; i++) {
        const y0 = (0.62 + i * 0.11) * h, x1 = (0.3 + i * 0.09) * w;
        out.push({ t: 'line', pts: [[-0.02 * w, y0], [x1, -0.02 * h]], color: i === 2 ? '#8E9AAF' : CLAY, a: dark ? 0.16 : 0.2, w: 0.8 });
      }
      for (let i = 0; i < 3; i++) out.push({ t: 'line', pts: [[-0.02 * w, (0.2 + i * 0.16) * h], [(0.42 + i * 0.05) * w, 1.02 * h]], color: CLAY, a: dark ? 0.1 : 0.14, w: 0.7 });
      const bars = [[0.07, 0.2, 0.32], [0.12, 0.27, 0.11], [0.25, 0.27, 0.15], [0.12, 0.33, 0.14], [0.28, 0.33, 0.13], [0.43, 0.33, 0.12],
        [0.09, 0.72, 0.2], [0.31, 0.72, 0.16], [0.09, 0.77, 0.15], [0.26, 0.77, 0.08], [0.09, 0.82, 0.13], [0.24, 0.82, 0.14], [0.4, 0.82, 0.12]];
      bars.forEach(([x, y, bw], i) => out.push({ t: 'rect', x: x * w, y: y * h, w: bw * w, h: 4, color: i >= 10 ? CLAY : ink, a: i >= 10 ? 0.16 : dark ? 0.08 : 0.07 }));
      for (const [x, y, txt, c] of [[0.07, 0.14, '</>', ink], [0.07, 0.43, '</>', CLAY], [0.07, 0.53, '$', ink], [0.05, 0.94, '</>', CLAY], [0.37, 0.215, '{', CLAY]])
        out.push({ t: 'text', x: x * w, y: y * h, s: 12, text: txt, color: c, a: c === CLAY ? 0.3 : dark ? 0.2 : 0.18 });
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
  // 工位自带底色，蒙版薄一些 / the Desk skin brings its own colour, so its scrim is thinner
  const SCRIM_DESK = { light: [0.5, 0.06], dark: [0.42, 0.04] };

  function svg(id, w, h, dark) {
    if (!id || id === 'none' || !IDS.includes(id)) return '';
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const defs = [], body = [];
    shapes(id, w, h, dark).forEach((s, i) => {
      if (s.t === 'wash') {
        defs.push(`<linearGradient id="w${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.c0}" stop-opacity="${s.a0}"/><stop offset="1" stop-color="${s.c1}" stop-opacity="${s.a1}"/></linearGradient>`);
        body.push(`<rect width="${w}" height="${h}" fill="url(#w${i})"/>`);
      } else if (s.t === 'text') body.push(`<text x="${f1(s.x)}" y="${f1(s.y)}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${s.s}" fill="${s.color}" fill-opacity="${s.a}">${s.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`);
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

  /**
   * 工位那一幕：桌上一块发光的玻璃终端在打字，一只小猫坐在桌上敲键盘、甩尾巴，旁边一杯冒热气的咖啡。
   * 所有动作的周期都能整除 2.4 秒，安卓的逐帧动画就是从这里按 2.4 秒截 16 帧（android/tools/desk-frames.js）。
   * The Desk scene: a glowing glass terminal typing on a desk, a small cat sitting on the desk tapping the keyboard and
   * swishing its tail, a mug of coffee steaming. Every loop divides 2.4 s; Android's frame animation is 16 frames cut
   * from this over 2.4 s (android/tools/desk-frames.js).
   */
  function scene(dark) {
    const C = dark ? {
      top: '#2C313D', edge: '#1F232C', leg: '#1A1D25', glass: 'rgba(240,150,110,0.10)', glassLine: 'rgba(245,160,120,0.75)', code: '#F2A27F', code2: 'rgba(242,162,127,0.55)',
      kb: '#3A404D', key: '#535A69', mug: 'rgba(255,255,255,0.10)', mugLine: 'rgba(255,255,255,0.35)', coffee: '#7A4E33', steam: 'rgba(255,225,205,0.55)',
      cat: '#5B6170', catShade: '#474C59', earIn: '#8A7472', eye: '#FFB98C', nose: '#D99A8F', collar: '#D97757', glow: 'rgba(240,140,100,0.45)',
    } : {
      top: '#EEE8E2', edge: '#DCD3CB', leg: '#D2CAC2', glass: 'rgba(255,255,255,0.55)', glassLine: 'rgba(217,119,87,0.65)', code: '#D97757', code2: 'rgba(217,119,87,0.5)',
      kb: '#F9F6F3', key: '#DED6CE', mug: 'rgba(255,255,255,0.65)', mugLine: '#CDC4BB', coffee: '#B9825B', steam: 'rgba(150,140,130,0.5)',
      cat: '#EBDCCB', catShade: '#D9C4AE', earIn: '#EBB8A6', eye: '#3D2B22', nose: '#D9897C', collar: '#D97757', glow: 'rgba(217,119,87,0.25)',
    };
    const css = `
.ds *{transform-box:view-box}
.ds .tail{transform-origin:194px 122px;animation:ds-tail 2.4s ease-in-out infinite}
.ds .paw{animation:ds-paw .6s ease-in-out infinite}
.ds .blink{transform-origin:160px 82px;animation:ds-blink 2.4s linear infinite}
.ds .ear{transform-origin:173px 72px;animation:ds-ear 2.4s ease-in-out infinite}
.ds .l1,.ds .l2,.ds .l3{transform-origin:0 0;animation:ds-type 2.4s linear infinite}
.ds .l1{--a:0;--b:.28}.ds .l2{animation-name:ds-type2}.ds .l3{animation-name:ds-type3}
.ds .cur{animation:ds-cur 1.2s steps(1) infinite}
.ds .st1,.ds .st2{animation:ds-steam 2.4s ease-in-out infinite}.ds .st2{animation-delay:-1.2s}
.ds .gl{animation:ds-glow 2.4s ease-in-out infinite}
@keyframes ds-tail{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}
@keyframes ds-paw{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.2px)}}
@keyframes ds-blink{0%,88%,100%{transform:scaleY(1)}92%{transform:scaleY(.1)}}
@keyframes ds-ear{0%,60%,72%,100%{transform:rotate(0)}66%{transform:rotate(-9deg)}}
@keyframes ds-type{0%{transform:scaleX(0)}25%,94%{transform:scaleX(1)}100%{transform:scaleX(1);opacity:0}}
@keyframes ds-type2{0%,25%{transform:scaleX(0)}50%,94%{transform:scaleX(1)}100%{transform:scaleX(1);opacity:0}}
@keyframes ds-type3{0%,50%{transform:scaleX(0)}75%,94%{transform:scaleX(1)}100%{transform:scaleX(1);opacity:0}}
@keyframes ds-cur{0%{opacity:1}50%{opacity:0}}
@keyframes ds-steam{0%{transform:translateY(4px);opacity:0}30%{opacity:1}100%{transform:translateY(-10px);opacity:0}}
@keyframes ds-glow{0%,100%{opacity:.75}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.ds *{animation:none!important}}`;
    // 玻璃屏是斜的：先在"正面"坐标里画，再整体斜切 / the glass is drawn face-on, then skewed into place
    const sk = 'matrix(1,-0.225,0,1,0,0)';
    return `<svg class="ds" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" preserveAspectRatio="xMaxYMax meet"><style>${css}</style>
<defs><radialGradient id="dsg"><stop offset="0" stop-color="${C.glow}"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient></defs>
<ellipse class="gl" cx="96" cy="86" rx="70" ry="52" fill="url(#dsg)"/>
<polygon points="10,140 18,140 18,180 10,180" fill="${C.leg}"/><polygon points="90,166 98,166 98,180 90,180" fill="${C.leg}"/><polygon points="226,128 234,126 234,180 226,180" fill="${C.leg}"/>
<polygon points="8,132 150,100 236,124 94,160" fill="${C.top}"/>
<polygon points="8,132 94,160 94,168 8,140" fill="${C.edge}"/><polygon points="94,160 236,124 236,132 94,168" fill="${C.edge}"/>
<g transform="${sk}">
  <rect x="46" y="70.4" width="80" height="62" rx="4" fill="${C.glass}" stroke="${C.glassLine}" stroke-width="1"/>
  <circle cx="52" cy="76" r="1.3" fill="${C.code2}"/><circle cx="56.5" cy="76" r="1.3" fill="${C.code2}"/><circle cx="61" cy="76" r="1.3" fill="${C.code2}"/>
  <text x="51" y="88" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="7" fill="${C.code}">$</text>
  <g transform="translate(57,84)"><rect class="l1" width="44" height="3" rx="1.5" fill="${C.code}"/></g>
  <g transform="translate(51,93)"><rect class="l2" width="30" height="3" rx="1.5" fill="${C.code2}"/></g>
  <g transform="translate(51,101)"><rect class="l3" width="52" height="3" rx="1.5" fill="${C.code2}"/></g>
  <text x="51" y="116" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="7" fill="${C.code}">&gt;</text>
  <rect class="cur" x="57" y="110" width="4" height="7" fill="${C.code}"/>
</g>
<polygon points="62,125 112,113.5 113,117 63,128.5" fill="${C.edge}"/>
<polygon points="70,130 128,116 150,122 92,136" fill="${C.kb}" stroke="${C.key}" stroke-width=".6"/>
<g fill="${C.key}">${[0, 1, 2].map(r => [0, 1, 2, 3, 4, 5, 6, 7].map(c => { const x = 79 + c * 6.2 + r * 5.2, y = 129 - c * 1.5 + r * 2.2; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="4" height="1.4" rx=".5" transform="rotate(-14 ${x.toFixed(1)} ${y.toFixed(1)})"/>`; }).join('')).join('')}</g>
<g class="tail"><path d="M194 122 Q214 122 212 102 Q210 90 220 86" fill="none" stroke="${C.cat}" stroke-width="5.5" stroke-linecap="round"/><path d="M216 88 Q219 86 220 86" stroke="${C.catShade}" stroke-width="5.5" stroke-linecap="round" fill="none"/></g>
<ellipse cx="179" cy="108" rx="17" ry="20" fill="${C.cat}"/>
<path d="M186 92 Q198 104 192 124 Q186 128 178 128 Q190 112 186 92Z" fill="${C.catShade}"/>
<g class="paw"><ellipse cx="153" cy="118" rx="7.5" ry="3.4" fill="${C.cat}" transform="rotate(-12 153 118)"/></g>
<path d="M166 104 Q158 112 152 117" stroke="${C.cat}" stroke-width="6" stroke-linecap="round" fill="none"/>
<ellipse cx="170" cy="94.5" rx="9.5" ry="2.4" fill="${C.collar}"/>
<polygon points="155,76 156,62 165,71" fill="${C.cat}"/><polygon points="157.5,73 158,66 162.5,71" fill="${C.earIn}"/>
<g class="ear"><polygon points="167,70 176,60 179,74" fill="${C.cat}"/><polygon points="170,70 175.5,64 177,72" fill="${C.earIn}"/></g>
<circle cx="166" cy="82" r="13" fill="${C.cat}"/>
<path d="M172 70 Q181 78 177 92 Q172 95 168 95 Q178 84 172 70Z" fill="${C.catShade}" opacity=".7"/>
<g class="blink"><ellipse cx="160" cy="82" rx="1.8" ry="2.5" fill="${C.eye}"/><ellipse cx="167.5" cy="81.5" rx="1.5" ry="2.3" fill="${C.eye}"/></g>
<path d="M154 87 L156.5 86 L155.6 88.3Z" fill="${C.nose}"/>
<path d="M155 89 Q153 91 151 90" stroke="${C.catShade}" stroke-width=".7" fill="none"/>
<g><path class="st1" d="M205 118 q-3 -4 0 -8 q3 -4 0 -8" stroke="${C.steam}" stroke-width="1.4" fill="none" stroke-linecap="round"/><path class="st2" d="M210 118 q-3 -4 0 -8 q3 -4 0 -8" stroke="${C.steam}" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>
<path d="M214 127 q6 0 6 5 q0 5 -6 5" stroke="${C.mugLine}" stroke-width="1.6" fill="none"/>
<path d="M200 122 L200 138 Q207 142 214 138 L214 122Z" fill="${C.mug}" stroke="${C.mugLine}" stroke-width=".8"/>
<ellipse cx="207" cy="124.5" rx="6.6" ry="2.2" fill="${C.coffee}"/>
<ellipse cx="207" cy="122" rx="7" ry="2.4" fill="none" stroke="${C.mugLine}" stroke-width=".8"/>
</svg>`;
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
    const old = el.querySelector(':scope > .skin-scene');
    if (old) old.remove();
    if (!id || id === 'none' || !IDS.includes(id)) { el.style.backgroundImage = 'none'; el.hidden = true; return; }
    el.hidden = false;
    // 会动的那一幕放在右下角 / the animated scene goes in the bottom-right corner
    if ((LIST.find(x => x.id === id) || {}).anim) {
      const sc = o.scene || {};
      const d = document.createElement('div');
      d.className = 'skin-scene';
      d.style.cssText = `position:absolute;right:${sc.right != null ? sc.right : 4}px;${sc.top != null ? `top:${sc.top}px` : `bottom:${sc.bottom != null ? sc.bottom : 4}px`};width:${sc.width || Math.round(Math.min(w * 0.5, 320))}px;aspect-ratio:4/3;opacity:${sc.opacity || 0.8};pointer-events:none`;
      d.innerHTML = scene(dark);
      el.appendChild(d);
    }
    const [a0, a1] = (id === 'desk' ? SCRIM_DESK : SCRIM)[dark ? 'dark' : 'light'];
    const c = o.surface || (dark ? '28,28,30' : '255,255,255');
    el.style.backgroundImage = `linear-gradient(135deg, rgba(${c},${a0}) 0%, rgba(${c},${(a0 + a1) / 2}) 55%, rgba(${c},${a1}) 100%), ${url(id, w, h, dark)}`;
    el.style.backgroundSize = '100% 100%';
  }
  const name = (id, lang) => { const s = LIST.find(x => x.id === id) || LIST[0]; return lang === 'zh' ? s.zh : s.en; };

  const api = { LIST, IDS, shapes, svg, url, apply, name, SCRIM, SCRIM_DESK, scene };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Skins = api;
})(typeof window !== 'undefined' ? window : globalThis);
