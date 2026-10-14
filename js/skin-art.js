// Generated skin artwork: the dense, techy, sometimes unreadable graphics of late-90s player skins
// (code rain, circuit boards, chrome, hex dumps, HUD rings, hazard stripes, rivets, barcodes...),
// drawn on a canvas from the skin's own colors. Nothing is copied from real skins: every image is
// generated from a small recipe (see ART in skins.js) and a seed, so a skin looks the same each time.
//
// The images are set as CSS variables (--art-deck, --art-list, --art-title, --art-screen) and
// css/app.css layers them over the skin's base colors.

import { ART, solidColor, TOKENS } from './skins.js';

// ---------- seeded randomness ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KATAKANA = Array.from({ length: 90 }, (_, i) => String.fromCharCode(0x30a1 + i)).join('');
const GLYPHS = '▓▒░█▄▀■□▪▫◢◣◤◥╬╳┼┤├┬┴╱╲⌘∆Ωψ¥§¤µ∑∏≈≠±÷×◊◘○●◉◎⊕⊗⌖⏚⏛';
const HEX = '0123456789ABCDEF';
const WORDS = ['SYS', 'BUS', 'AMP', 'DSP', 'FFT', 'KHZ', 'DB', 'CH.2', 'MODE', 'SYNC', 'LINK', 'NET', 'CORE',
  'RX', 'TX', 'v2.91', '0xFF', 'ERR', 'OK', 'PWR', 'NODE', 'GRID', 'CYBER', 'DECK', 'TRK', 'LOOP', 'GAIN',
  'PRE', 'PST', 'MUX', 'ANLG', 'DGTL', 'CRC', 'BIOS', 'RAM', 'ROM', 'I/O', 'HI-FI', 'STEREO', 'MONO', 'BPM',
  'SIGNAL', 'CARRIER', 'UPLINK', 'ACCESS', 'CODEC', 'BITSTREAM', 'SUBSYS', 'KERNEL', 'TAPE', 'RAW'];

const pickFrom = (r, s) => s[Math.floor(r() * s.length)];
const junk = (r, n, set) => Array.from({ length: n }, () => pickFrom(r, set)).join('');
const techLabel = (r) => `${pickFrom(r, WORDS)}${r() < 0.5 ? '.' : ' '}${junk(r, 2, HEX)}${r() < 0.4 ? ` // ${pickFrom(r, WORDS)}` : ''}`;

function rgba(hex, a) {
  const n = parseInt(solidColor(hex).slice(1, 7).padEnd(6, '0'), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- layers ----------
// Each layer draws into (g, w, h) with randomness r and palette p, at strength a (0-1).

const LAYERS = {
  chrome(g, w, h, r, p, a) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    const stops = [p.light, p.base, p.dark, p.light, p.base, p.dark, p.base];
    stops.forEach((c, i) => grad.addColorStop(Math.min(1, Math.max(0, i / (stops.length - 1) + (r() - 0.5) * 0.08)), rgba(c, a)));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // brushed streaks
    for (let i = 0; i < h; i += 2) {
      g.fillStyle = rgba(r() < 0.5 ? p.light : p.dark, 0.06 * a);
      g.fillRect(0, i, w, 1);
    }
  },

  plasma(g, w, h, r, p, a) {
    const s = 6;
    const cw = Math.ceil(w / s);
    const ch = Math.ceil(h / s);
    const f = [r() * 0.2 + 0.05, r() * 0.2 + 0.05, r() * 0.1 + 0.03];
    const cols = [p.fg, p.accent, p.dark, p.fg2];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const v = Math.sin(x * f[0]) + Math.sin(y * f[1]) + Math.sin((x + y) * f[2]) + Math.sin(Math.hypot(x - cw / 2, y - ch / 2) * f[0]);
        const k = Math.floor(((v + 4) / 8) * cols.length) % cols.length;
        g.fillStyle = rgba(cols[k], a * 0.8);
        g.fillRect(x * s, y * s, s, s);
      }
    }
  },

  dither(g, w, h, r, p, a) {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const s = 2;
    const angle = r() * Math.PI;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    g.fillStyle = rgba(p.fg, a * 0.7);
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        const t = ((x * dx + y * dy) / (w * Math.abs(dx) + h * Math.abs(dy)) + 1) / 2;
        if (t * 16 > bayer[((y / s) % 4) * 4 + ((x / s) % 4)] + 2) g.fillRect(x, y, s, s);
      }
    }
  },

  grid(g, w, h, r, p, a) {
    const hz = h * (0.45 + r() * 0.2);
    // sun
    const sr = Math.min(w, h) * (0.18 + r() * 0.12);
    const sx = w * (0.3 + r() * 0.4);
    const sun = g.createLinearGradient(0, hz - sr, 0, hz);
    sun.addColorStop(0, rgba(p.fg2, a));
    sun.addColorStop(1, rgba(p.accent, a));
    g.fillStyle = sun;
    g.beginPath();
    g.arc(sx, hz, sr, Math.PI, 0);
    g.fill();
    g.fillStyle = rgba(p.dark, a);
    for (let i = 0; i < 6; i++) g.fillRect(sx - sr, hz - (i + 1) * sr * 0.14, sr * 2, 1 + i);
    // floor grid
    g.strokeStyle = rgba(p.fg, a * 0.8);
    g.lineWidth = 1;
    for (let i = -20; i <= 20; i++) {
      g.beginPath();
      g.moveTo(w / 2 + i * 6, hz);
      g.lineTo(w / 2 + i * w * 0.18, h);
      g.stroke();
    }
    for (let y = hz, step = 2; y < h; step *= 1.3, y += step) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  },

  contour(g, w, h, r, p, a) {
    const cx = w * r();
    const cy = h * r();
    const ph = [r() * 6, r() * 6, r() * 6];
    g.strokeStyle = rgba(p.fg, a * 0.6);
    g.lineWidth = 1;
    for (let k = 1; k < 40; k++) {
      g.beginPath();
      for (let t = 0; t <= 64; t++) {
        const ang = (t / 64) * Math.PI * 2;
        const rad = k * 9 + 6 * Math.sin(ang * 3 + ph[0] + k * 0.2) + 4 * Math.sin(ang * 5 + ph[1]) + 3 * Math.sin(ang * 2 + ph[2] - k * 0.1);
        const x = cx + Math.cos(ang) * rad * 1.3;
        const y = cy + Math.sin(ang) * rad;
        if (t) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  },

  halftone(g, w, h, r, p, a) {
    const s = 7 + Math.floor(r() * 5);
    const ang = r() * Math.PI * 2;
    g.fillStyle = rgba(p.fg2, a * 0.6);
    for (let y = 0; y < h + s; y += s) {
      for (let x = 0; x < w + s; x += s) {
        const t = ((x - w / 2) * Math.cos(ang) + (y - h / 2) * Math.sin(ang)) / Math.max(w, h) + 0.5;
        const rad = Math.max(0, t) * s * 0.55;
        if (rad < 0.4) continue;
        g.beginPath();
        g.arc(x + ((y / s) % 2 ? s / 2 : 0), y, rad, 0, Math.PI * 2);
        g.fill();
      }
    }
  },

  rain(g, w, h, r, p, a) {
    const fs = 9 + Math.floor(r() * 6);
    g.font = `${fs}px "MS Gothic", "Osaka", monospace`;
    g.textBaseline = 'top';
    for (let x = 0; x < w; x += fs) {
      if (r() < 0.25) continue;
      const len = 4 + Math.floor(r() * (h / fs));
      const start = Math.floor(r() * (h / fs)) - len / 2;
      for (let i = 0; i < len; i++) {
        const y = (start + i) * fs;
        if (y < -fs || y > h) continue;
        const head = i === len - 1;
        g.fillStyle = head ? rgba('#ffffff', a) : rgba(i > len - 4 ? p.fg2 : p.fg, a * (0.15 + 0.85 * (i / len)));
        g.fillText(r() < 0.75 ? pickFrom(r, KATAKANA) : pickFrom(r, HEX), x, y);
      }
    }
  },

  circuit(g, w, h, r, p, a) {
    const step = 10 + Math.floor(r() * 8);
    g.lineWidth = 1.5;
    g.strokeStyle = rgba(p.light, a * 0.7);
    g.fillStyle = rgba(p.fg2, a * 0.9);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const n = Math.floor((w * h) / 2500);
    for (let k = 0; k < n; k++) {
      let x = Math.round((r() * w) / step) * step;
      let y = Math.round((r() * h) / step) * step;
      let d = dirs[Math.floor(r() * 4)];
      g.beginPath();
      g.moveTo(x, y);
      const segs = 2 + Math.floor(r() * 6);
      for (let s = 0; s < segs; s++) {
        const len = (1 + Math.floor(r() * 4)) * step;
        x += d[0] * len;
        y += d[1] * len;
        g.lineTo(x, y);
        if (r() < 0.6) d = dirs[Math.floor(r() * 8)];
      }
      g.stroke();
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
      if (r() < 0.3) g.fillRect(x - 5, y - 3, 10, 6); // chip pad
    }
  },

  hexdump(g, w, h, r, p, a) {
    const fs = 8 + Math.floor(r() * 3);
    g.font = `${fs}px "Lucida Console", "Courier New", monospace`;
    g.textBaseline = 'top';
    let addr = Math.floor(r() * 0xffff);
    for (let y = 2; y < h; y += fs + 2) {
      let line = `${addr.toString(16).toUpperCase().padStart(6, '0')}: `;
      while (line.length * fs * 0.62 < w) line += `${junk(r, 2, HEX)} `;
      g.fillStyle = rgba(p.fg, a * (r() < 0.1 ? 0.9 : 0.45));
      g.fillText(line, 3, y);
      addr += 16;
    }
  },

  hud(g, w, h, r, p, a) {
    const count = 1 + Math.floor(r() * 3);
    g.lineWidth = 1;
    g.font = '8px "Lucida Console", monospace';
    for (let k = 0; k < count; k++) {
      const cx = w * (0.15 + r() * 0.7);
      const cy = h * (0.15 + r() * 0.7);
      const R = Math.min(w, h) * (0.15 + r() * 0.3);
      g.strokeStyle = rgba(p.fg, a * 0.8);
      for (let i = 0; i < 4; i++) {
        g.setLineDash(i % 2 ? [2, 4] : []);
        const start = r() * Math.PI * 2;
        g.beginPath();
        g.arc(cx, cy, R * (1 - i * 0.18), start, start + Math.PI * (0.6 + r() * 1.4));
        g.stroke();
      }
      g.setLineDash([]);
      for (let t = 0; t < 36; t++) {
        const ang = (t / 36) * Math.PI * 2;
        const l = t % 3 ? 3 : 7;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
        g.lineTo(cx + Math.cos(ang) * (R + l), cy + Math.sin(ang) * (R + l));
        g.stroke();
      }
      g.beginPath();
      g.moveTo(cx - R * 1.2, cy);
      g.lineTo(cx + R * 1.2, cy);
      g.moveTo(cx, cy - R * 1.2);
      g.lineTo(cx, cy + R * 1.2);
      g.stroke();
      g.fillStyle = rgba(p.fg2, a);
      g.fillText(techLabel(r), cx + R * 0.75, cy - R * 0.75);
    }
  },

  waves(g, w, h, r, p, a) {
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const amp = h * (0.05 + r() * 0.15);
      const f1 = 0.01 + r() * 0.05;
      const f2 = 0.05 + r() * 0.2;
      const y0 = h * r();
      g.strokeStyle = rgba(k % 2 ? p.fg2 : p.fg, a * 0.8);
      g.lineWidth = 1 + Math.floor(r() * 2);
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = y0 + Math.sin(x * f1 + k) * amp + Math.sin(x * f2) * amp * 0.3;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  },

  stars(g, w, h, r, p, a) {
    const n = Math.floor((w * h) / 400);
    for (let i = 0; i < n; i++) {
      g.fillStyle = rgba(r() < 0.7 ? '#ffffff' : p.fg2, a * r());
      g.fillRect(r() * w, r() * h, 1, 1);
    }
    g.strokeStyle = rgba('#ffffff', a);
    for (let i = 0; i < 6; i++) {
      const x = r() * w;
      const y = r() * h;
      const s = 3 + r() * 6;
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.moveTo(x, y - s);
      g.lineTo(x, y + s);
      g.stroke();
    }
  },

  glyphs(g, w, h, r, p, a) {
    const n = 10 + Math.floor((w * h) / 4000);
    for (let i = 0; i < n; i++) {
      const fs = 7 + Math.floor(r() * 16);
      g.save();
      g.translate(r() * w, r() * h);
      if (r() < 0.3) g.rotate(Math.PI / 2 * (r() < 0.5 ? 1 : -1));
      g.font = `${r() < 0.3 ? 'bold ' : ''}${fs}px "Lucida Console", "MS Gothic", monospace`;
      g.fillStyle = rgba(pickFrom(r, [p.fg, p.fg2, p.light, p.accent]), a * (0.3 + r() * 0.6));
      const kind = r();
      g.fillText(kind < 0.35 ? junk(r, 3 + Math.floor(r() * 8), GLYPHS)
        : kind < 0.6 ? junk(r, 3 + Math.floor(r() * 6), KATAKANA)
          : techLabel(r), 0, 0);
      g.restore();
    }
  },

  barcode(g, w, h, r, p, a) {
    const bw = Math.min(110, w * 0.35);
    const bh = Math.min(34, h * 0.18);
    const x0 = r() < 0.5 ? 8 : w - bw - 8;
    const y0 = r() < 0.5 ? 8 : h - bh - 18;
    g.fillStyle = rgba(p.light, a * 0.9);
    for (let x = 0; x < bw;) {
      const bar = 1 + Math.floor(r() * 3);
      if (r() < 0.55) g.fillRect(x0 + x, y0, bar, bh);
      x += bar + 1;
    }
    g.font = '8px "Lucida Console", monospace';
    g.fillText(junk(r, 13, '0123456789'), x0, y0 + bh + 2);
  },

  logotype(g, w, h, r, p, a) {
    const text = (p.name || 'MUSIC BOX').toUpperCase();
    const vertical = !p.horizontal && r() < 0.35;
    const fonts = ['Impact', '"Arial Black"', 'Georgia', '"Courier New"', 'Copperplate', 'Futura', '"Brush Script MT"'];
    const font = pickFrom(r, fonts);
    const size = vertical ? Math.min(w * 0.22, h / (text.length * 0.55)) : Math.min(h * (p.horizontal ? 0.8 : 0.4), w / (text.length * 0.6));
    g.save();
    const style = r() < 0.5 ? 'italic ' : '';
    g.font = `${style}900 ${Math.max(12, size)}px ${font}, sans-serif`;
    // Shrink to fit the space it runs along (width, or height when it's turned on its side).
    const room = (vertical ? h : w) * 0.92;
    const measured = g.measureText(text).width;
    if (measured > room) g.font = `${style}900 ${Math.max(9, (size * room) / measured)}px ${font}, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    if (vertical) {
      g.translate(r() < 0.5 ? size * 0.6 : w - size * 0.6, h / 2);
      g.rotate(-Math.PI / 2);
    } else {
      g.translate(w / 2, h * (0.2 + r() * 0.6));
    }
    g.lineWidth = 2;
    g.strokeStyle = rgba(p.light, a);
    g.fillStyle = rgba(p.fg2, a * (p.horizontal ? 0.85 : 0.35));
    if (p.horizontal) {
      g.shadowColor = rgba(p.dark, 0.9);
      g.shadowOffsetX = 2;
      g.shadowOffsetY = 2;
    }
    g.fillText(text, 0, 0);
    g.strokeText(text, 0, 0);
    g.restore();
  },

  hazard(g, w, h, r, p, a) {
    const band = 8 + Math.floor(r() * 8);
    const ys = r() < 0.5 ? [0, h - band] : [h - band];
    for (const y of ys) {
      g.save();
      g.beginPath();
      g.rect(0, y, w, band);
      g.clip();
      for (let x = -band * 2; x < w + band * 2; x += band * 2) {
        g.fillStyle = rgba(p.fg2, a);
        g.beginPath();
        g.moveTo(x, y + band);
        g.lineTo(x + band, y);
        g.lineTo(x + band * 2, y);
        g.lineTo(x + band, y + band);
        g.fill();
      }
      g.restore();
    }
  },

  grille(g, w, h, r, p, a) {
    const s = 5;
    const gx = r() < 0.5 ? 6 : w * 0.6;
    const gw = w * 0.35;
    const gh = h * (0.25 + r() * 0.3);
    const gy = h * r() * 0.5;
    g.fillStyle = rgba(p.dark, a);
    for (let y = gy; y < gy + gh; y += s) {
      for (let x = gx + ((y / s) % 2 ? s / 2 : 0); x < gx + gw; x += s) {
        g.beginPath();
        g.arc(x, y, 1.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
};

/** Post effects that disturb what's already drawn. */
function glitch(g, w, h, r, p) {
  for (let i = 0; i < 6 + Math.floor(r() * 10); i++) {
    const y = Math.floor(r() * h);
    const sh = 2 + Math.floor(r() * 10);
    const dx = Math.floor((r() - 0.5) * 40);
    try {
      g.putImageData(g.getImageData(0, y, w, sh), dx, y);
    } catch { /* tainted or zero-size: skip */ }
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle = rgba(pickFrom(r, [p.fg, p.fg2, p.accent]), 0.35);
    g.fillRect(r() * w, r() * h, 10 + r() * 60, 2 + r() * 5);
  }
}

function rivets(g, w, h, p) {
  const pts = [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]];
  for (const [x, y] of pts) {
    const grad = g.createRadialGradient(x - 1, y - 1, 0.5, x, y, 4);
    grad.addColorStop(0, rgba(p.light, 1));
    grad.addColorStop(1, rgba(p.dark, 1));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(p.dark, 0.9);
    g.beginPath();
    g.moveTo(x - 2.5, y - 2.5);
    g.lineTo(x + 2.5, y + 2.5);
    g.stroke();
  }
}

// ---------- rendering ----------

function palette(tokens, name) {
  const t = { ...TOKENS, ...tokens };
  return {
    name,
    fg: solidColor(t['lcd-text']),
    fg2: solidColor(t['vis-high']),
    accent: solidColor(t.accent),
    light: solidColor(t['bevel-light']),
    dark: solidColor(t['bevel-dark']),
    base: solidColor(t['deck-bg']),
  };
}

/** Draws a recipe at a size. `scale` thins the layers out for smaller, quieter surfaces. */
function draw(art, p, w, h, seedOffset, strength = 1) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const r = rng(art.seed + seedOffset);
  if (art.base !== 'none') LAYERS[art.base](g, w, h, r, p, art.strength * strength);
  for (const layer of art.overlays) LAYERS[layer](g, w, h, r, p, art.strength * strength);
  if (art.glitch) glitch(g, w * dpr, h * dpr, r, p);
  if (art.rivets && strength >= 1) rivets(g, w, h, p);
  return canvas;
}

const toUrl = (canvas) => new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null)));

/** A second document the player may live in (the pop-out window); sizes are measured there too. */
let otherDoc = null;
export function setOtherDocument(doc) {
  otherDoc = doc;
}

/** Redraw the current skin's artwork at the surfaces' current sizes (e.g. after zooming). */
export function repaint() {
  if (current) paint(current);
}

let urls = [];
let current = null;
let observer = null;
let pending = 0;

/** Renders the skin's artwork for each skinned surface at its current size. */
export async function paint(skin) {
  current = skin;
  const job = ++pending;
  const root = document.documentElement;
  const art = skin?.art;
  if (!art || (art.base === 'none' && !art.overlays.length)) {
    for (const k of ['deck', 'list', 'title', 'screen', 'emblem']) root.style.removeProperty(`--art-${k}`);
    delete root.dataset.art;
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    return;
  }
  const p = palette(skin.tokens, skin.name);
  const size = (sel, fw, fh) => {
    const el = document.querySelector(sel) || otherDoc?.querySelector(sel);
    const rect = el?.getBoundingClientRect();
    return [Math.round(rect?.width || fw), Math.round(rect?.height || fh)];
  };
  const [dw, dh] = size('.deck', 380, 320);
  const [lw, lh] = size('.playlist', 380, 360);
  const [sw, sh] = size('.screen', 340, 110);
  const [ew, eh] = size('.emblem', 380, 60);
  const screenArt = { ...art, base: 'none', glitch: false, overlays: art.overlays.filter((l) => ['rain', 'hexdump', 'glyphs', 'waves', 'grid', 'circuit'].includes(l)).slice(0, 1) };
  const titleArt = { ...art, base: art.base === 'none' ? 'chrome' : art.base, overlays: ['glyphs'], glitch: false };
  // The emblem: the skin's name as a big logotype over busy tech detail, at full strength.
  const detail = art.overlays.filter((l) => ['glyphs', 'hexdump', 'barcode', 'circuit', 'hud', 'rain', 'hazard', 'waves'].includes(l));
  const emblemArt = { ...art, rivets: false, base: art.base === 'none' ? 'chrome' : art.base, overlays: [...detail.slice(0, 2), 'logotype'] };
  const made = await Promise.all([
    toUrl(draw(art, p, dw, dh, 0)),
    toUrl(draw({ ...art, overlays: art.overlays.slice(0, 2) }, p, lw, lh, 7, 0.7)),
    toUrl(draw(titleArt, p, Math.max(dw, lw), 22, 13, 0.8)),
    screenArt.overlays.length ? toUrl(draw(screenArt, p, sw, sh, 21, 0.32)) : null,
    toUrl(draw(emblemArt, { ...p, horizontal: true }, ew, eh, 29, 1.4)),
  ]);
  if (job !== pending) { made.forEach((u) => u && URL.revokeObjectURL(u)); return; }
  const old = urls;
  urls = made.filter(Boolean);
  const [deck, list, title, screen, emblem] = made;
  root.style.setProperty('--art-emblem', `url("${emblem}")`);
  root.style.setProperty('--art-deck', `url("${deck}")`);
  root.style.setProperty('--art-list', `url("${list}")`);
  root.style.setProperty('--art-title', `url("${title}")`);
  if (screen) root.style.setProperty('--art-screen', `url("${screen}")`);
  else root.style.removeProperty('--art-screen');
  root.dataset.art = 'on';
  // Let the browser swap images before freeing the old ones.
  setTimeout(() => old.forEach(URL.revokeObjectURL), 1000);
  watchSizes();
}

/** Re-render when the deck or playlist changes size (new layout, window resize, phone rotation). */
function watchSizes() {
  if (observer || !('ResizeObserver' in window)) return;
  let timer = 0;
  const last = new Map();
  observer = new ResizeObserver((entries) => {
    let changed = false;
    for (const e of entries) {
      const { width, height } = e.contentRect;
      const prev = last.get(e.target);
      if (!prev || Math.abs(prev[0] - width) > 24 || Math.abs(prev[1] - height) > 24) changed = true;
      last.set(e.target, [width, height]);
    }
    if (!changed) return;
    clearTimeout(timer);
    timer = setTimeout(() => current && paint(current), 200);
  });
  for (const sel of ['.deck', '.playlist']) {
    const el = document.querySelector(sel);
    if (el) observer.observe(el);
  }
}

/** A random artwork recipe. Green-on-black screens lean toward code rain and hex dumps. */
export function rollArt(rand, tokens) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const lcd = solidColor(tokens['lcd-text'] || '#00ff00');
  const greenish = /^#[0-6][0-9a-f][a-f8-9][0-9a-f][0-6][0-9a-f]/i.test(lcd);
  const overlays = new Set();
  const n = 2 + Math.floor(rand() * 3);
  while (overlays.size < n) {
    overlays.add(greenish && rand() < 0.35 ? pick(['rain', 'hexdump']) : pick(ART.overlay));
  }
  return {
    seed: Math.floor(rand() * 2 ** 31),
    base: rand() < 0.92 ? pick(ART.base.slice(1)) : 'none',
    overlays: [...overlays],
    glitch: rand() < 0.3,
    rivets: rand() < 0.45,
    strength: Math.round((0.6 + rand() * 0.4) * 100) / 100,
  };
}
