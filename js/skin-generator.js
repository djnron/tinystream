// One-button skin generator. It starts from the palette of a real classic skin from the Winamp Skin
// Museum (see skin-corpus.js), sometimes borrows the screen colors from a second skin, nudges the
// hues, then maps everything onto our skin tokens. Contrast is checked and fixed so the result is
// always readable, and the style choices (gradients, corners, fonts, glow) are rolled at random.

import { validateTokens } from './skins.js';

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
];
const RADII = ['0px', '0px', '2px', '2px', '3px', '4px', '6px', '10px', '16px'];

/** The skin's own playlist font, if it's a plain font name we can safely use. */
function uiFont(name, roll) {
  const clean = (name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (clean && roll < 0.5 && !/^arial$/i.test(clean)) return `"${clean}", Tahoma, Verdana, sans-serif`;
  return UI_FONTS[Math.floor(roll * 2 * UI_FONTS.length) % UI_FONTS.length];
}

// ---------- the generator ----------

/**
 * Returns a new skin: { id: 'custom', name, tokens, inspiredBy: [{ name, id }] }.
 * `rand` can be swapped for a seeded generator.
 */
export async function generateSkin(rand = Math.random) {
  const { CORPUS } = await import('./skin-corpus.js');
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const a = pick(CORPUS);
  const b = rand() < 0.35 ? pick(CORPUS) : a; // sometimes a second skin's screen
  const roll = rand();
  const shift = roll < 0.1 ? 150 + rand() * 60 : roll < 0.5 ? rand() * 50 - 25 : 0;
  const P = (c) => (shift ? hue(c, shift) : c);

  // Chrome from skin A, screen + playlist from skin B.
  const frame = P(a.frame);
  const title = P(a.title);
  let button = P(a.button);
  const lcdBg = P(b.lcd);
  const digits = readable(P(b.digits), lcdBg, 4.5);
  const [listText, listCurrent, listBg, listSelect] = b.list.map(P);
  const [, visTop, visMid, visBottom, , visPeak] = b.vis.map(P);

  // Page colors follow the deck: dark deck -> dark page, light deck -> light page.
  const dark = luminance(frame) < 0.3 || (luminance(frame) < 0.5 && rand() < 0.5);
  const bg = dark ? withL(frame, 0.08 + rand() * 0.05, 0.6) : withL(frame, 0.94 + rand() * 0.03, 0.5);
  const surface = dark ? light(bg, 0.05) : mix(bg, '#ffffff', 0.7);
  const surface2 = dark ? light(bg, 0.1) : light(bg, -0.05);
  const text = dark ? withL(frame, 0.92, 0.25) : withL(frame, 0.12, 0.3);
  const candidates = [digits, visTop, listCurrent, P(a.marquee), listSelect]
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
  const glyph = readable(P(a.glyph), [...btnStops(), ...deckStops], 3);

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
    'font-ui': uiFont(a.font, rand()),
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

  const name = `${pick(ADJECTIVES)} ${pick(NOUNS)}${pick(SUFFIXES)}`;
  const inspiredBy = [a, b].filter((s, i, all) => all.indexOf(s) === i).map((s) => ({ name: s.name, id: s.id }));
  return { id: 'custom', name, tokens: validateTokens(tokens), inspiredBy };
}

export const museumUrl = (id) => `https://skins.webamp.org/skin/${id}`;
