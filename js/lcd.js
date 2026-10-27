// Seven-segment LCD digits as inline SVG. Unlit segments stay faintly visible, like a real display.
// Colors come from the skin: --lcd-text (lit), --lcd-dim (unlit), --lcd-glow.

const DIGIT_W = 12;
const ADVANCE = 15;
const COLON_W = 7;
const H = 22;

const hSeg = (cy, x0 = 1.4, x1 = 10.6) =>
  `${x0},${cy} ${x0 + 1.2},${cy - 1.2} ${x1 - 1.2},${cy - 1.2} ${x1},${cy} ${x1 - 1.2},${cy + 1.2} ${x0 + 1.2},${cy + 1.2}`;
const vSeg = (cx, y0, y1) =>
  `${cx},${y0} ${cx + 1.2},${y0 + 1.2} ${cx + 1.2},${y1 - 1.2} ${cx},${y1} ${cx - 1.2},${y1 - 1.2} ${cx - 1.2},${y0 + 1.2}`;

const SEGMENTS = {
  a: hSeg(1.2),
  b: vSeg(10.8, 1.4, 10.8),
  c: vSeg(10.8, 11.2, 20.6),
  d: hSeg(20.8),
  e: vSeg(1.2, 11.2, 20.6),
  f: vSeg(1.2, 1.4, 10.8),
  g: hSeg(11),
};

const GLYPHS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
  5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', ' ': '',
};

function glyph(ch, x) {
  if (ch === ':') {
    return `<g transform="translate(${x} 0)" class="on"><circle cx="3.5" cy="7" r="1.4"/><circle cx="3.5" cy="15" r="1.4"/></g>`;
  }
  const lit = GLYPHS[ch] ?? '';
  const polys = Object.entries(SEGMENTS).map(([name, pts]) =>
    `<polygon class="${lit.includes(name) ? 'on' : 'off'}" points="${pts}"/>`).join('');
  return `<g transform="translate(${x} 0) skewX(-6)">${polys}</g>`;
}

/** SVG markup for a string of digits, ':', '-' and spaces. */
export function lcdDigits(text) {
  let x = 2;
  const parts = [];
  for (const ch of text) {
    parts.push(glyph(ch, x));
    x += ch === ':' ? COLON_W : ADVANCE;
  }
  const w = x - (ADVANCE - DIGIT_W) + 2;
  return `<svg class="seg" viewBox="0 0 ${w} ${H}" aria-hidden="true">${parts.join('')}</svg>`;
}

/** "m:ss" padded for the display, with an optional leading minus for remaining time. */
export function lcdTime(seconds, negative = false) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.min(99, Math.floor(s / 60));
  const txt = `${String(m).padStart(2, ' ')}:${String(s % 60).padStart(2, '0')}`;
  return negative ? `-${txt}` : ` ${txt}`;
}
