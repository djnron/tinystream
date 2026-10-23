// Skins: every color, bevel, display and font in the app comes from these tokens (CSS custom
// properties), and the arrangement of the player comes from a layout (see LAYOUT). A skin is a name
// plus tokens plus a layout, so anyone can make one: download the template from Settings, edit the
// values, and load the file back in.

/** Every token a skin can set, with the "Deck 98" value as the fallback. */
import { applyPictures, validatePictures } from './pictures.js';

export const TOKENS = {
  // page + library
  bg: '#1b1c22',
  text: '#e6e7ee',
  muted: '#8f93a6',
  accent: '#38e07b',
  'accent-text': '#08130c',
  danger: '#ff6b6b',
  surface: '#26272f',
  'surface-2': '#31323c',
  line: '#ffffff14',
  radius: '2px',
  'font-ui': 'Tahoma, Verdana, "Segoe UI", sans-serif',
  // window chrome (the player "deck", playlist, title bars)
  'deck-bg': 'linear-gradient(180deg, #3b3d4a 0%, #262832 55%, #1d1e26 100%)',
  'bevel-light': '#6a6d80',
  'bevel-dark': '#0b0b10',
  'titlebar-bg': 'linear-gradient(90deg, #2a3a8c, #5866c9 50%, #2a3a8c)',
  'titlebar-text': '#f2f3ff',
  'btn-face': 'linear-gradient(180deg, #4a4c5c, #2d2f3a)',
  'btn-text': '#d7d9e6',
  // the little LCD screen
  'lcd-bg': '#05080a',
  'lcd-text': '#3dff6e',
  'lcd-dim': '#0f2a17',
  'lcd-glow': '0 0 6px #3dff6e88',
  'font-lcd': '"Lucida Console", "Courier New", ui-monospace, monospace',
  // visualizer
  'vis-low': '#2bd94f',
  'vis-high': '#f2d43a',
  'vis-peak': '#e6e7ee',
  // playlist window
  'list-bg': '#05080a',
  'list-text': '#3dff6e',
  'list-current': '#ffffff',
  'list-select': '#1f3bd1',
};

/**
 * Layout options. Each one is applied as a data-* attribute on <html> and styled in css/app.css.
 * The first value of each list is the default.
 */
export const LAYOUT = {
  deck: ['classic', 'hero', 'rack', 'boombox', 'cassette', 'strip', 'orbit', 'split'], // how the player is arranged
  buttons: ['bevel', 'round', 'pill', 'flat', 'keys', 'labels'], // transport button shape
  titlebar: ['grips', 'center', 'left', 'slim'],
  lcd: ['sunken', 'pill', 'crt', 'dots', 'outline'], // the screen's frame and texture
  seek: ['trough', 'line', 'led', 'thick'],
  frame: ['bevel', 'outline', 'soft', 'double'], // window chrome
  vis: ['bars', 'mirror', 'blocks', 'dots'], // how the spectrum is drawn
  list: ['plain', 'zebra', 'compact'], // playlist rows
  shape: ['box', 'blob', 'notch', 'arch', 'wave'], // window silhouettes (always upright)
  pattern: ['none', 'stripes', 'checker', 'polka', 'zigzag', 'plaid', 'sunburst', 'scan'], // deck texture
  fx: ['none', 'hue-drift', 'glow', 'float', 'glitch', 'rainbow', 'jelly'], // animation
  type: ['plain', 'wide', 'slanted', 'chunky'], // lettering on title bars and the display
  emblem: ['none', 'top', 'bottom'], // a big generated logo panel on the player (needs artwork)
  side: ['left', 'right'], // which side of the library the player sits on (wide screens)
  order: ['deck-first', 'list-first'], // player above or below the playlist
};
export const WIDTH_RANGE = [300, 460]; // player column width on wide screens, px

/** Generated artwork (see js/skin-art.js): a base fill plus overlay layers, drawn from a seed. */
export const ART = {
  base: ['none', 'chrome', 'plasma', 'dither', 'grid', 'contour', 'halftone'],
  overlay: ['rain', 'circuit', 'hexdump', 'hud', 'waves', 'stars', 'glyphs', 'barcode', 'logotype', 'hazard', 'grille'],
};

/** Keeps only known art layers and sane numbers; returns null for "no artwork". */
export function validateArt(input) {
  if (!input || typeof input !== 'object') return null;
  const base = ART.base.includes(input.base) ? input.base : 'none';
  const overlays = [...new Set((Array.isArray(input.overlays) ? input.overlays : []).filter((l) => ART.overlay.includes(l)))].slice(0, 4);
  if (base === 'none' && !overlays.length) return null;
  const seed = Math.abs(Math.floor(Number(input.seed))) % 2 ** 31 || 1;
  const strength = Math.min(1, Math.max(0.1, Number(input.strength) || 0.6));
  return { seed, base, overlays, glitch: Boolean(input.glitch), rivets: Boolean(input.rivets), strength };
}

export const DEFAULT_LAYOUT = { ...Object.fromEntries(Object.entries(LAYOUT).map(([k, v]) => [k, v[0]])), width: 380 };

/** Keeps known layout keys with allowed values; anything else falls back to the default. */
export function validateLayout(input = {}) {
  const out = { ...DEFAULT_LAYOUT };
  for (const [key, options] of Object.entries(LAYOUT)) {
    if (options.includes(input[key])) out[key] = input[key];
  }
  const w = Math.round(Number(input.width));
  if (Number.isFinite(w)) out.width = Math.min(WIDTH_RANGE[1], Math.max(WIDTH_RANGE[0], w));
  return out;
}

const skin = (id, name, tokens, layout = {}, art = null) => ({ id, name, tokens, layout: validateLayout(layout), art: validateArt(art) });

export const SKINS = [
  skin('deck98', 'Deck 98', {}, {}, { seed: 98, base: 'chrome', overlays: ['glyphs'], rivets: true, strength: 0.35 }),

  skin('amber', 'Amber Terminal', {
    bg: '#120c04', text: '#ffcf7a', muted: '#a77d3a', accent: '#ffb000', 'accent-text': '#1a0f00',
    surface: '#1d1408', 'surface-2': '#2a1d0b', line: '#ffb00022', radius: '0px',
    'font-ui': '"Courier New", ui-monospace, monospace',
    'deck-bg': '#1a1208', 'bevel-light': '#5a3f12', 'bevel-dark': '#000000',
    'titlebar-bg': '#ffb000', 'titlebar-text': '#1a0f00',
    'btn-face': '#231808', 'btn-text': '#ffb000',
    'lcd-bg': '#0d0802', 'lcd-text': '#ffb000', 'lcd-dim': '#2b1d05', 'lcd-glow': '0 0 8px #ffb000aa',
    'vis-low': '#a86a00', 'vis-high': '#ffd36b', 'vis-peak': '#fff1c9',
    'list-bg': '#0d0802', 'list-text': '#ffb000', 'list-current': '#fff1c9', 'list-select': '#5a3a00',
  }, { emblem: 'bottom', deck: 'strip', buttons: 'labels', titlebar: 'left', lcd: 'crt', seek: 'led', frame: 'outline', vis: 'blocks', list: 'compact', width: 420 }, { seed: 7, base: 'dither', overlays: ['hexdump', 'barcode'], glitch: true, strength: 0.5 }),

  skin('neon', 'Neon Arcade', {
    bg: '#07040f', text: '#f3e9ff', muted: '#9a86c4', accent: '#ff2bd6', 'accent-text': '#14001a',
    surface: '#120a22', 'surface-2': '#1c1033', line: '#ff2bd626', radius: '10px',
    'deck-bg': 'linear-gradient(160deg, #1a0b33, #0b0618 60%, #160a2b)',
    'bevel-light': '#ff2bd6', 'bevel-dark': '#2be3ff',
    'titlebar-bg': 'linear-gradient(90deg, #ff2bd6, #7a2bff, #2be3ff)', 'titlebar-text': '#ffffff',
    'btn-face': 'linear-gradient(180deg, #2a1550, #150a2b)', 'btn-text': '#2be3ff',
    'lcd-bg': '#05010c', 'lcd-text': '#2be3ff', 'lcd-dim': '#0b1d2a', 'lcd-glow': '0 0 10px #2be3ffcc',
    'vis-low': '#7a2bff', 'vis-high': '#ff2bd6', 'vis-peak': '#2be3ff',
    'list-bg': '#05010c', 'list-text': '#c9a8ff', 'list-current': '#2be3ff', 'list-select': '#3a0f5c',
  }, { emblem: 'top', deck: 'hero', buttons: 'round', titlebar: 'center', lcd: 'outline', seek: 'line', frame: 'soft', vis: 'mirror', side: 'right' }, { seed: 2077, base: 'grid', overlays: ['hud', 'glyphs'], strength: 0.7 }),

  skin('vapor', 'Vaporwave', {
    bg: '#2b1640', text: '#fff0fb', muted: '#d6a8d9', accent: '#7ff5e8', 'accent-text': '#24123a',
    surface: '#3a2055', 'surface-2': '#4a2a6a', line: '#ffffff22', radius: '6px',
    'font-ui': '"Trebuchet MS", Verdana, sans-serif',
    'deck-bg': 'linear-gradient(180deg, #ff71ce 0%, #b967ff 55%, #01cdfe 100%)',
    'bevel-light': '#ffd6f5', 'bevel-dark': '#5a1f7a',
    'titlebar-bg': 'linear-gradient(90deg, #01cdfe, #b967ff)', 'titlebar-text': '#ffffff',
    'btn-face': 'linear-gradient(180deg, #fffb96, #ff71ce)', 'btn-text': '#3b145a',
    'lcd-bg': '#1a0b2e', 'lcd-text': '#05ffa1', 'lcd-dim': '#2b2048', 'lcd-glow': '0 0 8px #05ffa199',
    'vis-low': '#01cdfe', 'vis-high': '#ff71ce', 'vis-peak': '#fffb96',
    'list-bg': '#1a0b2e', 'list-text': '#ff9de2', 'list-current': '#05ffa1', 'list-select': '#5a1f7a',
  }, { emblem: 'top', deck: 'cassette', buttons: 'pill', titlebar: 'center', lcd: 'pill', seek: 'thick', frame: 'soft', vis: 'bars', list: 'zebra' }, { seed: 1995, base: 'grid', overlays: ['stars', 'logotype'], strength: 0.6 }),

  skin('steel', 'Brushed Steel', {
    bg: '#d9dce1', text: '#1d2026', muted: '#5d636e', accent: '#1e6fd9', 'accent-text': '#ffffff',
    surface: '#eef0f3', 'surface-2': '#e2e5ea', line: '#00000018', radius: '4px',
    'deck-bg': 'repeating-linear-gradient(90deg, #c9cdd3 0 2px, #d5d8de 2px 4px), #cfd3d9',
    'bevel-light': '#ffffff', 'bevel-dark': '#7c828c',
    'titlebar-bg': 'linear-gradient(180deg, #8a9099, #5f656f)', 'titlebar-text': '#ffffff',
    'btn-face': 'linear-gradient(180deg, #f4f5f7, #c3c7ce)', 'btn-text': '#2a2e35',
    'lcd-bg': '#0b1a2e', 'lcd-text': '#8fd3ff', 'lcd-dim': '#14283f', 'lcd-glow': '0 0 6px #8fd3ff88',
    'vis-low': '#2f8cff', 'vis-high': '#8fd3ff', 'vis-peak': '#ffffff',
    'list-bg': '#f7f8fa', 'list-text': '#1d2026', 'list-current': '#1e6fd9', 'list-select': '#c9dcf7',
  }, { emblem: 'bottom', deck: 'rack', buttons: 'keys', titlebar: 'grips', lcd: 'dots', seek: 'trough', frame: 'bevel', vis: 'blocks', width: 400 }, { seed: 42, base: 'chrome', overlays: ['barcode', 'grille'], rivets: true, strength: 0.55 }),

  skin('bubblegum', 'Bubblegum', {
    bg: '#fff3f8', text: '#4a1f3a', muted: '#a0668a', accent: '#ff4fa3', 'accent-text': '#ffffff',
    surface: '#ffffff', 'surface-2': '#ffe3f0', line: '#ff4fa322', radius: '16px',
    'font-ui': '"Comic Sans MS", "Chalkboard SE", "Trebuchet MS", sans-serif',
    'deck-bg': 'linear-gradient(180deg, #ffd1e6, #ffb3d6)',
    'bevel-light': '#ffffff', 'bevel-dark': '#e07fae',
    'titlebar-bg': 'linear-gradient(90deg, #ff8cc6, #b38cff)', 'titlebar-text': '#ffffff',
    'btn-face': 'linear-gradient(180deg, #ffffff, #ffd6ea)', 'btn-text': '#c2186f',
    'lcd-bg': '#fff9fc', 'lcd-text': '#e0157a', 'lcd-dim': '#ffe0ef', 'lcd-glow': 'none',
    'font-lcd': '"Comic Sans MS", "Chalkboard SE", sans-serif',
    'vis-low': '#b38cff', 'vis-high': '#ff4fa3', 'vis-peak': '#7a2b5a',
    'list-bg': '#fff9fc', 'list-text': '#7a2b5a', 'list-current': '#e0157a', 'list-select': '#ffd6ea',
  }, { deck: 'boombox', buttons: 'round', titlebar: 'center', lcd: 'pill', seek: 'thick', frame: 'outline', vis: 'dots', list: 'zebra', order: 'list-first' }, { seed: 3, base: 'halftone', overlays: ['stars'], strength: 0.45 }),

  skin('clean', 'Clean (no retro)', {
    bg: '#15131d', text: '#f1eff7', muted: '#a7a2b8', accent: '#a58bff', 'accent-text': '#15131d',
    surface: '#1f1c2a', 'surface-2': '#2a2638', line: '#ffffff14', radius: '14px',
    'font-ui': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    'deck-bg': '#1f1c2a', 'bevel-light': '#ffffff10', 'bevel-dark': '#00000040',
    'titlebar-bg': 'transparent', 'titlebar-text': '#a7a2b8',
    'btn-face': '#2a2638', 'btn-text': '#f1eff7',
    'lcd-bg': '#15131d', 'lcd-text': '#f1eff7', 'lcd-dim': '#262234', 'lcd-glow': 'none',
    'font-lcd': 'system-ui, sans-serif',
    'vis-low': '#6a4ee0', 'vis-high': '#a58bff', 'vis-peak': '#f1eff7',
    'list-bg': '#1f1c2a', 'list-text': '#d9d4ea', 'list-current': '#a58bff', 'list-select': '#2f2a44',
  }, { deck: 'hero', buttons: 'flat', titlebar: 'slim', lcd: 'sunken', seek: 'line', frame: 'soft', vis: 'mirror', list: 'compact', width: 340 }),
];

// ---------- fonts ----------

/**
 * Fonts the Skin Studio offers. Ones marked `google` are loaded from Google Fonts when a skin uses
 * them; the rest are fonts most computers already have.
 */
const mono = 'ui-monospace, monospace';
const sans = 'Tahoma, Verdana, sans-serif';
export const DISPLAY_FONTS = [
  { name: 'Classic LCD', stack: '"Lucida Console", "Courier New", ui-monospace, monospace' },
  { name: 'VT323', google: true, stack: `"VT323", ${mono}` },
  { name: 'Share Tech Mono', google: true, stack: `"Share Tech Mono", ${mono}` },
  { name: 'Press Start 2P', google: true, stack: `"Press Start 2P", ${mono}` },
  { name: 'Silkscreen', google: true, stack: `"Silkscreen", ${mono}` },
  { name: 'Orbitron', google: true, stack: `"Orbitron", ${sans}` },
  { name: 'Major Mono Display', google: true, stack: `"Major Mono Display", ${mono}` },
  { name: 'Space Mono', google: true, stack: `"Space Mono", ${mono}` },
  { name: 'IBM Plex Mono', google: true, stack: `"IBM Plex Mono", ${mono}` },
  { name: 'Monoton', google: true, stack: `"Monoton", ${sans}` },
  { name: 'Courier', stack: '"Courier New", ui-monospace, monospace' },
];
export const LABEL_FONTS = [
  { name: 'Tahoma', stack: 'Tahoma, Verdana, "Segoe UI", sans-serif' },
  { name: 'Inter', google: true, stack: `"Inter", system-ui, sans-serif` },
  { name: 'Space Grotesk', google: true, stack: `"Space Grotesk", ${sans}` },
  { name: 'Chakra Petch', google: true, stack: `"Chakra Petch", ${sans}` },
  { name: 'Audiowide', google: true, stack: `"Audiowide", ${sans}` },
  { name: 'Bungee', google: true, stack: `"Bungee", ${sans}` },
  { name: 'Russo One', google: true, stack: `"Russo One", ${sans}` },
  { name: 'Righteous', google: true, stack: `"Righteous", ${sans}` },
  { name: 'Black Ops One', google: true, stack: `"Black Ops One", ${sans}` },
  { name: 'Rubik Mono One', google: true, stack: `"Rubik Mono One", ${sans}` },
  { name: 'Permanent Marker', google: true, stack: `"Permanent Marker", cursive` },
  { name: 'Pacifico', google: true, stack: `"Pacifico", cursive` },
  { name: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { name: 'Comic', stack: '"Comic Sans MS", "Marker Felt", cursive' },
];

const FONT_NAME = /^[A-Za-z0-9 ]{1,40}$/;
/** Google Fonts family names a skin loads (plain names only). */
export function validateFonts(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((f) => String(f).trim()).filter((f) => FONT_NAME.test(f)))].slice(0, 6);
}

/** The Google Fonts a skin needs: the ones its two font tokens start with. */
export function fontsFor(tokens, extra = []) {
  const known = new Set([...DISPLAY_FONTS, ...LABEL_FONTS].filter((f) => f.google).map((f) => f.name));
  const first = (v) => /^\s*"([^"]+)"/.exec(v || '')?.[1];
  const wanted = [first(tokens['font-lcd']), first(tokens['font-ui'])].filter((n) => n && (known.has(n) || extra.includes(n)));
  return validateFonts(wanted);
}

function applyFonts(fonts) {
  const list = validateFonts(fonts);
  let link = document.getElementById('skin-fonts');
  if (!list.length) { link?.remove(); return; }
  const href = `https://fonts.googleapis.com/css2?${list.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`).join('&')}&display=swap`;
  if (link?.href === href) return;
  link ??= Object.assign(document.createElement('link'), { id: 'skin-fonts', rel: 'stylesheet' });
  link.href = href;
  document.head.append(link);
}

// ---------- custom skin files ----------

const SAFE_VALUE = /^[\w\s#%(),.\-+'"/]*$/;
const MAX_NAME = 40;

/**
 * Checks a skin file and returns a clean skin, or throws with a readable reason.
 * Only known tokens are kept, and values can't load anything from the network (no url()).
 */
export function parseSkinFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON");
  }
  if (!data || typeof data !== 'object' || typeof data.tokens !== 'object') {
    throw new Error('A skin file needs a "tokens" object — download the template to see the format');
  }
  const name = String(data.name || 'My skin').slice(0, MAX_NAME);
  return {
    id: 'custom', name, tokens: validateTokens(data.tokens), layout: validateLayout(data.layout), art: validateArt(data.art),
    fonts: validateFonts(data.fonts), pictures: validatePictures(data.pictures).filter((p) => !p.src.startsWith('pic:')),
  };
}

/** Keeps known tokens only and rejects values that could load anything (no url()). */
export function validateTokens(input) {
  const tokens = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(key in TOKENS)) continue;
    const v = String(value).trim();
    if (v.length > 300 || !SAFE_VALUE.test(v) || /url\s*\(|expression|image-set/i.test(v)) {
      throw new Error(`The value for "${key}" isn't allowed`);
    }
    tokens[key] = v;
  }
  return tokens;
}

export function skinTemplate(base) {
  return JSON.stringify({
    name: `${base.name} (my copy)`,
    about: 'Music Box skin. Edit any token (CSS colors, gradients, fonts, sizes) and pick layout options '
      + 'from the lists in "layoutOptions", then load it from Settings → Skin.',
    tokens: { ...TOKENS, ...base.tokens },
    layout: validateLayout(base.layout),
    layoutOptions: { ...LAYOUT, width: `${WIDTH_RANGE[0]}-${WIDTH_RANGE[1]}` },
    art: validateArt(base.art),
    artOptions: { ...ART, strength: '0.1-1', seed: 'any whole number' },
    fonts: validateFonts(base.fonts),
  }, null, 2);
}

/** Applies a skin to the page. */
export function applySkin(s) {
  const all = { ...TOKENS, ...s.tokens };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(all)) root.style.setProperty(`--${k}`, v);
  root.dataset.skin = s.id;
  const layout = validateLayout(s.layout);
  for (const key of Object.keys(LAYOUT)) root.dataset[key] = layout[key];
  delete root.dataset.tilt; // removed option: skins always sit straight
  root.style.setProperty('--deck-w', `${layout.width}px`);
  applyFonts(s.fonts);
  applyPictures(s.pictures);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', solidColor(all.bg));
  window.dispatchEvent(new Event('skinchange'));
}

/** First plain color in a value (gradients included), for places that need one color. */
export function solidColor(value) {
  return /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i.exec(value)?.[0] || '#000000';
}
