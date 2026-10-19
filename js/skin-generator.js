// One-button skin generator. It starts from the palette of a real classic skin from the Winamp Skin
// Museum (see skin-corpus.js), sometimes borrows the screen colors from a second skin, nudges the
// hues, then maps everything onto our skin tokens. Contrast is checked and fixed so the result is
// always readable. The style (gradients, corners, fonts, glow) and the whole player layout (deck
// arrangement, buttons, title bar, screen, seek bar, frame, visualizer, playlist, side, width) are
// rolled at random too, so every skin looks and is arranged differently.

import { rollArt } from './skin-art.js';
import { LAYOUT, validateArt, validateLayout, validateTokens, WIDTH_RANGE } from './skins.js';

// ---------- color helpers ----------

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

function toRgb(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

function toHsl(hex) {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

const hue = (hex, deg) => { const [h, s, l] = toHsl(hex); return fromHsl([h + deg, s, l]); };
const light = (hex, dl) => { const [h, s, l] = toHsl(hex); return fromHsl([h, s, clamp(l + dl)]); };
const withL = (hex, l, sMul = 1) => { const [h, s] = toHsl(hex); return fromHsl([h, clamp(s * sMul), l]); };
const sat = (hex) => toHsl(hex)[1];

function mix(a, b, t) {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Moves `fg` lighter or darker until it reaches the contrast ratio `min` against the background
 * (or every color in a list of backgrounds, e.g. both ends of a gradient).
 */
function readable(fg, bg, min) {
  const bgs = Array.isArray(bg) ? bg : [bg];
  const worst = (c) => Math.min(...bgs.map((b) => contrast(c, b)));
  if (worst(fg) >= min) return fg;
  // Head toward whichever extreme (white or black) contrasts more with the background.
  const dir = worst('#ffffff') >= worst('#000000') ? 1 : -1;
  const [h, s, l0] = toHsl(fg);
  for (let step = 1; step <= 25; step++) {
    const c = fromHsl([h, s, clamp(l0 + dir * step * 0.04)]);
    if (worst(c) >= min) return c;
  }
  return dir > 0 ? '#ffffff' : '#000000';
}

const bw = (bg) => (contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000');

// ---------- random choices ----------

const ADJECTIVES = ['Chrome', 'Velvet', 'Turbo', 'Midnight', 'Plasma', 'Lo-Fi', 'Hyper', 'Rusty', 'Glacier',
  'Cosmic', 'Analog', 'Neon', 'Dusty', 'Electric', 'Pixel', 'Liquid', 'Atomic', 'Retro', 'Solar', 'Static',
  'Burnt', 'Frosted', 'Haunted', 'Golden', 'Bootleg', 'Laser', 'Sunset', 'Toxic', 'Lunar', 'Candy'];
const NOUNS = ['Llama', 'Cassette', 'Kilobyte', 'Mixtape', 'Amp', 'Dial-Up', 'Equalizer', 'Walkman', 'Satellite',
  'Jukebox', 'Modem', 'Tape Deck', 'Boombox', 'Subwoofer', 'Floppy', 'Arcade', 'Mainframe', 'Synth', 'Radio',
  'Vinyl', 'Hi-Fi', 'Megabyte', 'Transistor', 'Woofer', 'Decibel'];
const SUFFIXES = ['', '', '', ' 98', ' XP', ' Deluxe', ' Pro', ' Gold', ' v2.0', ' 3000', ' Turbo', ' SE'];

const LCD_FONTS = [
  '"Lucida Console", "Courier New", ui-monospace, monospace',
  '"Courier New", ui-monospace, monospace',
  'Consolas, "Lucida Console", ui-monospace, monospace',
  'ui-monospace, Menlo, Monaco, monospace',
  '"Andale Mono", "Courier New", monospace',
];
const UI_FONTS = [
  'Tahoma, Verdana, "Segoe UI", sans-serif',
  'Verdana, Tahoma, sans-serif',
  '"Trebuchet MS", Verdana, sans-serif',
  'Arial, Helvetica, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Arial Black", Arial, sans-serif',
  'system-ui, -apple-system, "Segoe UI", sans-serif',
  'Impact, "Arial Narrow Bold", sans-serif',
  'Papyrus, fantasy',
  '"Brush Script MT", "Segoe Script", cursive',
  'Copperplate, "Copperplate Gothic Light", fantasy',
  'Rockwell, "Courier New", serif',
  'Futura, "Century Gothic", sans-serif',
  '"Marker Felt", "Comic Sans MS", cursive',
  '"Courier New", monospace',
];
const RADII = ['0px', '0px', '2px', '3px', '4px', '6px', '10px', '16px', '22px', '28px'];

/** The skin's own playlist font, if it's a plain font name we can safely use. */
function uiFont(name, roll) {
  const clean = (name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (clean && roll < 0.5 && !/^arial$/i.test(clean)) return `"${clean}", Tahoma, Verdana, sans-serif`;
  return UI_FONTS[Math.floor(roll * 2 * UI_FONTS.length) % UI_FONTS.length];
}

// ---------- the generator ----------

/**
 * Returns a new skin: { id: 'custom', name, tokens, layout, inspiredBy: [{ name, id }] }.
 * Pass the current skin's layout as `previous` so the new one is arranged differently.
 * `rand` can be swapped for a seeded generator.
 */
export async function generateSkin({ previous = null, rand = Math.random } = {}) {
  const { CORPUS } = await import('./skin-corpus.js');
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const a = pick(CORPUS);
  const b = rand() < 0.35 ? pick(CORPUS) : a; // sometimes a second skin's screen
  // Color mutations, applied to every color from the source skins:
  //  - hue shift: a quarter of skins get a dramatic one (120-240°), almost half a moderate one;
  //  - acid: one in five gets its saturation cranked up.
  const roll = rand();
  const shift = roll < 0.25 ? 120 + rand() * 120 : roll < 0.7 ? rand() * 80 - 40 : 0;
  const acid = rand() < 0.2;
  const P = (c) => {
    let out = shift ? hue(c, shift) : c;
    if (acid) { const [hh, ss, ll] = toHsl(out); out = fromHsl([hh, clamp(ss * 1.7 + 0.15), ll]); }
    return out;
  };

  // Chrome from skin A, screen + playlist from skin B.
  const palette = {
    frame: P(a.frame), title: P(a.title), button: P(a.button), glyph: P(a.glyph), marquee: P(a.marquee),
    lcd: P(b.lcd), digits: P(b.digits), list: b.list.map(P), vis: b.vis.map(P), font: a.font,
  };
  const tokens = tokensFromPalette(palette, rand);
  const layout = rollLayout(rand, pick, previous);
  const name = randomName(rand);
  const inspiredBy = [a, b].filter((s, i, all) => all.indexOf(s) === i).map((s) => ({ name: s.name, id: s.id }));
  return { id: 'custom', name, tokens, layout, art: validateArt(rollArt(rand, tokens)), inspiredBy };
}

/** A fun random skin name. */
export function randomName(rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}${pick(SUFFIXES)}`;
}

/** A seeded random number generator (mulberry32), so the same seed rolls the same choices. */
export function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A few hand-picked colors -> a full palette in the museum's shape, so the same token mapping (and
 * its contrast checks) works for colors a person picks, or colors taken from a picture.
 */
export function paletteFromColors({ body, title, buttons, screen, digits }) {
  return {
    frame: body,
    title,
    button: buttons,
    glyph: bw(buttons),
    marquee: digits,
    lcd: screen,
    digits,
    list: [digits, light(digits, 0.25), screen, mix(title, screen, 0.5)],
    vis: [screen, light(digits, 0.2), digits, hue(digits, -40), screen, light(digits, 0.35)],
    font: '',
  };
}

/** The five "easy" colors of a skin, read back from its tokens (for the color pickers). */
export function colorsFromTokens(t) {
  const c = (v, fallback) => solid(v) || fallback;
  return {
    body: c(t['deck-bg'], '#2a2c36'),
    title: c(t['titlebar-bg'], '#2a3a8c'),
    buttons: c(t['btn-face'], '#3a3c4a'),
    screen: c(t['lcd-bg'], '#05080a'),
    digits: c(t['lcd-text'], '#3dff6e'),
  };
}

const solid = (v) => {
  const m = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i.exec(v || '');
  if (!m) return null;
  const hex = m[0];
  return hex.length === 4 ? `#${[...hex.slice(1)].map((x) => x + x).join('')}` : hex.toLowerCase();
};

/** The most distinct, lively colors in an image, as the five easy colors. */
export function colorsFromImage(img) {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  // Bucket colors coarsely and count them.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  }
  const colors = [...buckets.values()].sort((x, y) => y.n - x.n)
    .map((b) => toHex([b.r / b.n, b.g / b.n, b.b / b.n]));
  if (!colors.length) return null;
  const byLight = [...colors.slice(0, 24)].sort((x, y) => luminance(x) - luminance(y));
  const vivid = [...colors.slice(0, 40)].sort((x, y) => sat(y) * (0.4 + luminance(y)) - sat(x) * (0.4 + luminance(x)));
  const body = colors[0];
  const dark = byLight[0];
  const pop = vivid[0];
  const second = vivid.find((c) => contrast(c, pop) > 1.6) || hue(pop, 150);
  return {
    body,
    title: second,
    buttons: mix(body, second, 0.25),
    screen: luminance(dark) < 0.08 ? dark : withL(dark, 0.06),
    digits: pop,
  };
}

/** Maps a palette onto every skin token, fixing contrast so text always reads. */
export function tokensFromPalette(pal, rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const frame = pal.frame;
  const title = pal.title;
  let button = pal.button;
  const lcdBg = pal.lcd;
  const digits = readable(pal.digits, lcdBg, 4.5);
  const [listText, listCurrent, listBg, listSelect] = pal.list;
  const [, visTop, visMid, visBottom, , visPeak] = pal.vis;

  // Page colors follow the deck: dark deck -> dark page, light deck -> light page.
  // Usually the page follows the deck (dark deck, dark page); sometimes it's flipped on purpose.
  const follows = luminance(frame) < 0.3 || (luminance(frame) < 0.5 && rand() < 0.5);
  const dark = rand() < 0.15 ? !follows : follows;
  const bg = dark ? withL(frame, 0.08 + rand() * 0.05, 0.6) : withL(frame, 0.94 + rand() * 0.03, 0.5);
  const surface = dark ? light(bg, 0.05) : mix(bg, '#ffffff', 0.7);
  const surface2 = dark ? light(bg, 0.1) : light(bg, -0.05);
  const text = dark ? withL(frame, 0.92, 0.25) : withL(frame, 0.12, 0.3);
  const candidates = [digits, visTop, listCurrent, pal.marquee, listSelect]
    .map((c) => readable(c, bg, 3))
    .sort((x, y) => sat(y) - sat(x));
  const accent = candidates[0];

  const worst = (c, list) => Math.min(...list.map((x) => contrast(c, x)));
  /** Is there any text color (at best black or white) that reads on all of these colors? */
  const feasible = (stops, min) => Math.max(worst('#ffffff', stops), worst('#000000', stops)) >= min;

  // Deck styles return [css, color stops] so labels on the deck can be checked against every stop.
  const deckStyles = [
    () => [frame, [frame]],
    () => [`linear-gradient(180deg, ${light(frame, 0.1)} 0%, ${frame} 55%, ${light(frame, -0.07)} 100%)`,
      [light(frame, 0.1), frame, light(frame, -0.07)]],
    () => [`repeating-linear-gradient(90deg, ${frame} 0 2px, ${light(frame, 0.035)} 2px 4px), ${frame}`,
      [frame, light(frame, 0.035)]],
    () => [`linear-gradient(135deg, ${frame}, ${mix(frame, title, 0.35)})`, [frame, mix(frame, title, 0.35)]],
    () => [`linear-gradient(180deg, ${frame} 0 50%, ${light(frame, -0.05)} 50%)`, [frame, light(frame, -0.05)]],
  ];
  let [deckBg, deckStops] = pick(deckStyles)();
  if (!feasible(deckStops, 3)) [deckBg, deckStops] = deckStyles[0]();
  // Each title bar style lists its color stops so the text can be checked against all of them.
  const titleStyles = [
    [title, light(title, 0.12), title],
    [title],
    [light(title, 0.1), light(title, -0.08)],
    [title, mix(title, accent, 0.5)],
  ];
  let titleStops = pick(titleStyles);
  // A two-tone bar can be too dark at one end and too light at the other for any text color.
  if (!feasible(titleStops, 4.5)) titleStops = [title];
  const titleBg = titleStops.length === 1 ? titleStops[0]
    : `linear-gradient(${titleStops.length === 2 && titleStops[0] !== title ? '180deg' : '90deg'}, ${titleStops.join(', ')})`;
  const titleText = rand() < 0.3 && worst(digits, titleStops) >= 4.5 ? digits
    : worst('#ffffff', titleStops) >= worst('#000000', titleStops) ? '#ffffff' : '#000000';
  // Button icons must read on both ends of the button's gradient, and the same color labels the
  // volume slider and playlist footer, which sit on the deck. If the button and deck are too far
  // apart for one label color to work on both, pull the button color toward the frame.
  const btnStops = () => [light(button, 0.08), button, light(button, -0.06)];
  for (let i = 0; i < 6 && !feasible([...btnStops(), ...deckStops], 3); i++) button = mix(button, frame, 0.4);
  const [btnTop, , btnBottom] = btnStops();
  const glyph = readable(pal.glyph, [...btnStops(), ...deckStops], 3);

  const tokens = {
    bg,
    text,
    muted: mix(text, bg, 0.42),
    accent,
    'accent-text': bw(accent),
    danger: readable(dark ? '#ff6b6b' : '#c42a3c', bg, 3),
    surface,
    'surface-2': surface2,
    line: dark ? '#ffffff14' : '#00000018',
    radius: pick(RADII),
    'font-ui': uiFont(pal.font, rand()),
    'deck-bg': deckBg,
    'bevel-light': light(frame, 0.18),
    'bevel-dark': light(frame, -0.3),
    'titlebar-bg': titleBg,
    'titlebar-text': titleText,
    'btn-face': rand() < 0.7 ? `linear-gradient(180deg, ${btnTop}, ${btnBottom})` : button,
    'btn-text': glyph,
    'lcd-bg': lcdBg,
    'lcd-text': digits,
    'lcd-dim': mix(digits, lcdBg, 0.84),
    'lcd-glow': rand() < 0.55 ? `0 0 ${4 + Math.floor(rand() * 6)}px ${digits}99` : 'none',
    'font-lcd': pick(LCD_FONTS),
    'vis-low': readable(visBottom, lcdBg, 1.6),
    'vis-high': readable(contrast(visTop, visBottom) > 1.3 ? visTop : visMid, lcdBg, 2),
    'vis-peak': contrast(visPeak, lcdBg) >= 2 ? visPeak : digits,
    'list-bg': listBg,
    'list-text': readable(listText, listBg, 4.5),
    'list-current': readable(listCurrent, listSelect, 4.5),
    'list-select': listSelect,
  };

  return validateTokens(tokens);
}

/**
 * A random player layout. Every option is equally likely, except side and order (which lean to the
 * default) and the wild extras (shape, tilt, pattern, effect), which are on more often than off.
 */
export function rollLayout(rand, pick, previous) {
  const layout = Object.fromEntries(Object.entries(LAYOUT).map(([key, options]) => [key, pick(options)]));
  for (const key of ['shape', 'pattern', 'fx']) {
    if (layout[key] === LAYOUT[key][0] && rand() < 0.6) layout[key] = pick(LAYOUT[key].slice(1));
  }
  // Never the same deck arrangement or button style twice in a row.
  for (const key of ['deck', 'buttons']) {
    while (previous && layout[key] === previous[key]) layout[key] = pick(LAYOUT[key]);
  }
  layout.side = rand() < 0.35 ? 'right' : 'left';
  layout.emblem = rand() < 0.88 ? (rand() < 0.5 ? 'top' : 'bottom') : 'none';
  layout.order = rand() < 0.25 ? 'list-first' : 'deck-first';
  const [lo, hi] = WIDTH_RANGE;
  layout.width = lo + Math.round((rand() * (hi - lo)) / 10) * 10;
  return validateLayout(layout);
}

export const museumUrl = (id) => `https://skins.webamp.org/skin/${id}`;
