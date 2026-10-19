// Skin Studio: make the player your own.
//
// "Quick" has the fun, one-tap controls: five colors (or colors taken from your picture), fonts,
// a picture, the player's arrangement, artwork and effects, each with its own dice. "Deep" opens
// up everything: every layout option, every color and style token, artwork details, any Google
// Font, picture blend modes and filters, and the raw skin file.
//
// Every change shows on the real player straight away and is saved as one of "My skins", with
// undo and redo. Nothing is uploaded anywhere: pictures stay on this device.

import { icons } from './icons.js';
import {
  addFile, addLink, AREA_LABELS, AREAS, BLENDS, CORNERS, EFFECT_LABELS, EFFECTS, FIT_LABELS, FITS,
  forgetIfUnused, MAX_PICTURES, pictureUrl, validatePictures,
} from './pictures.js';
import { rollArt } from './skin-art.js';
import {
  colorsFromImage, colorsFromTokens, generateSkin, paletteFromColors, randomName, rollLayout, seeded,
  tokensFromPalette,
} from './skin-generator.js';
import {
  ART, DISPLAY_FONTS, fontsFor, LABEL_FONTS, LAYOUT, parseSkinFile, TOKENS, validateArt, validateFonts,
  validateLayout, validateTokens, WIDTH_RANGE,
} from './skins.js';
import { h, toast } from './util.js';

const MAX_SKINS = 24;
const icon = (name) => h('span', { class: 'ico', html: icons[name] });
const clone = (x) => JSON.parse(JSON.stringify(x));

// Friendly names for the layout options shown as chips.
const LAYOUT_LABELS = {
  deck: 'Arrangement', buttons: 'Buttons', titlebar: 'Title bar', lcd: 'Screen frame', seek: 'Seek bar',
  frame: 'Window frame', vis: 'Visualizer', list: 'Playlist rows', shape: 'Silhouette', pattern: 'Texture',
  fx: 'Animation', type: 'Lettering', emblem: 'Logo panel', side: 'Player side', order: 'Order',
};
const TOKEN_GROUPS = [
  ['Page & library', ['bg', 'text', 'muted', 'accent', 'accent-text', 'danger', 'surface', 'surface-2', 'line', 'radius', 'font-ui']],
  ['Player window', ['deck-bg', 'bevel-light', 'bevel-dark', 'titlebar-bg', 'titlebar-text', 'btn-face', 'btn-text']],
  ['Screen', ['lcd-bg', 'lcd-text', 'lcd-dim', 'lcd-glow', 'font-lcd']],
  ['Visualizer', ['vis-low', 'vis-high', 'vis-peak']],
  ['Playlist', ['list-bg', 'list-text', 'list-current', 'list-select']],
];
const EASY_COLORS = [['body', 'Body'], ['title', 'Title bar'], ['buttons', 'Buttons'], ['screen', 'Screen'], ['digits', 'Digits']];

// ---------- session state (kept while you move around the app) ----------

let ctx;
let draft = null; // the skin being edited
let saved = false; // has the draft been stored in "My skins" yet?
let undoStack = [];
let redoStack = [];
let lastKey = '';
let lastAt = 0;
let tab = 'quick';
let root = null;

/**
 * Opens the studio on the current skin. `deps` comes from app.js:
 * { store, show, setTitle, currentSkin, useSkin, paintArt, openPreview, isWide }
 */
export function studioView(deps) {
  ctx = deps;
  const cur = ctx.currentSkin();
  if (!draft || draft.id !== cur.id) startFrom(cur);
  ctx.setTitle('Skin Studio');
  loadFontPreviews();
  root = h('div', { class: 'stack studio' });
  build();
  ctx.show(root);
}

function startFrom(skin) {
  const mine = skin.id.startsWith('my-');
  draft = {
    id: mine ? skin.id : `my-${Date.now().toString(36)}`,
    name: mine ? skin.name : `${skin.name} (mine)`.slice(0, 40),
    tokens: { ...TOKENS, ...clone(skin.tokens || {}) },
    layout: validateLayout(skin.layout),
    art: clone(skin.art || null),
    fonts: validateFonts(skin.fonts),
    pictures: validatePictures(skin.pictures),
    meta: { seed: skin.meta?.seed || Math.floor(Math.random() * 1e9), customFonts: skin.meta?.customFonts || [] },
  };
  saved = mine;
  undoStack = [];
  redoStack = [];
}

const mySkins = () => ctx.store.settings.mySkins || [];

/**
 * Records a change: shows it, saves it, and remembers the previous state for undo. Quick repeats of
 * the same control (dragging a slider) count as one step.
 */
function commit(change, key = '') {
  const before = clone(draft);
  change(draft);
  const now = Date.now();
  if (!(key && key === lastKey && now - lastAt < 800)) {
    undoStack.push(before);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }
  lastKey = key;
  lastAt = now;
  persist();
  updateUndo();
}

let artTimer = 0;
function persist() {
  draft.fonts = fontsFor(draft.tokens, draft.meta.customFonts);
  const sk = clone(draft);
  const list = mySkins().filter((s) => s.id !== sk.id);
  if (!saved && list.length >= MAX_SKINS) list.shift(); // oldest goes first
  ctx.store.setSetting('mySkins', [...list, sk]);
  saved = true;
  ctx.useSkin(sk, { quiet: true });
  // Artwork is slow to draw, so wait until a slider stops moving.
  clearTimeout(artTimer);
  artTimer = setTimeout(() => ctx.paintArt(sk), 140);
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(clone(draft));
  draft = undoStack.pop();
  lastKey = '';
  persist();
  rebuild();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(clone(draft));
  draft = redoStack.pop();
  lastKey = '';
  persist();
  rebuild();
}

function updateUndo() {
  root?.querySelector('#st-undo')?.toggleAttribute('disabled', !undoStack.length);
  root?.querySelector('#st-redo')?.toggleAttribute('disabled', !redoStack.length);
}

/** Rebuilds the controls (after undo, a dice roll...) without losing your place on the page. */
function rebuild() {
  const y = window.scrollY;
  const main = document.querySelector('main');
  const my = main?.scrollTop || 0;
  build();
  window.scrollTo(0, y);
  if (main) main.scrollTop = my;
}

/** Loads every studio font once, so the font chips show what they look like. */
function loadFontPreviews() {
  if (document.getElementById('studio-fonts')) return;
  const names = [...DISPLAY_FONTS, ...LABEL_FONTS].filter((f) => f.google).map((f) => f.name);
  document.head.append(h('link', {
    id: 'studio-fonts',
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?${names.map((n) => `family=${n.replace(/ /g, '+')}`).join('&')}&display=swap`,
  }));
}

// ---------- page ----------

function build() {
  root.replaceChildren(header(), tab === 'quick' ? quickTab() : deepTab());
  updateUndo();
}

function header() {
  return h('section', { class: 'card studio-head' },
    h('div', { class: 'studio-title' },
      h('input', {
        class: 'studio-name', value: draft.name, maxlength: 40, 'aria-label': 'Skin name',
        oninput: (e) => commit((d) => { d.name = e.target.value.trim() || 'My skin'; }, 'name'),
      }),
      h('button', { class: 'icon-btn', title: 'New name', 'aria-label': 'Roll a new name', html: icons.dice,
        onclick: (e) => {
          const name = randomName();
          commit((d) => { d.name = name; });
          e.currentTarget.parentElement.querySelector('input').value = name;
        } })),
    h('div', { class: 'studio-bar' },
      h('div', { class: 'tabs', role: 'tablist' },
        ['quick', 'deep'].map((t) => h('button', {
          role: 'tab', class: tab === t ? 'on' : '', 'aria-selected': String(tab === t),
          onclick: () => { tab = t; build(); },
        }, t === 'quick' ? 'Quick' : 'Deep'))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', id: 'st-undo', title: 'Undo', onclick: undo }, '↶'),
      h('button', { class: 'btn', id: 'st-redo', title: 'Redo', onclick: redo }, '↷'),
      h('button', { class: 'btn primary', onclick: surpriseMe, title: 'Roll everything but your pictures and fonts' },
        icon('dice'), 'Surprise me'),
      !ctx.isWide() && h('button', { class: 'btn', onclick: ctx.openPreview }, icon('play'), 'Preview')),
    h('p', { class: 'setting-desc' }, saved
      ? 'Changes show on the player straight away and are saved in My skins.'
      : 'This is a copy of your current skin. Change anything and it’s saved in My skins.'));
}

async function surpriseMe() {
  const g = await generateSkin({ previous: draft.layout });
  commit((d) => {
    d.tokens = { ...g.tokens, 'font-ui': d.tokens['font-ui'], 'font-lcd': d.tokens['font-lcd'] };
    d.layout = g.layout;
    d.art = g.art;
  });
  rebuild();
}

// ---------- shared bits ----------

function section(title, dice, ...body) {
  return h('section', { class: 'card studio-sec' },
    h('div', { class: 'sec-head' }, h('h2', {}, title), dice && h('button', {
      class: 'btn small', onclick: dice.run, title: dice.title,
    }, icon('dice'), dice.label || 'Shuffle')),
    ...body);
}

/** A row of one-tap choices. */
function chips(options, value, onpick, { label = (o) => o, style = null, multi = false, name = '' } = {}) {
  const isOn = (o) => (multi ? value.includes(o) : value === o);
  return h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup', 'aria-label': name },
    options.map((o) => {
      const b = h('button', {
        class: `chip${isOn(o) ? ' on' : ''}`,
        role: multi ? 'checkbox' : 'radio',
        'aria-checked': String(isOn(o)),
        onclick: () => {
          onpick(o);
          const row = b.parentElement;
          if (!multi) row.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
          const on = multi ? !b.classList.contains('on') : true;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
        },
      }, label(o));
      if (style) b.setAttribute('style', style(o));
      return b;
    }));
}

function slider(label, value, min, max, step, oninput, fmt = (v) => v) {
  const out = h('output', {}, fmt(value));
  return h('label', { class: 'st-slider' },
    h('span', {}, label), out,
    h('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); oninput(v); } }));
}

function field(label, ...control) {
  return h('div', { class: 'st-field' }, h('span', { class: 'st-label' }, label), ...control);
}

// ---------- Quick ----------

function quickTab() {
  return h('div', { class: 'stack studio-body' },
    picturesSection(false),
    colorsSection(),
    fontsSection(),
    layoutSection(),
    artSection(false),
    effectsSection());
}

function easyColors() {
  return draft.meta.colors || colorsFromTokens(draft.tokens);
}

/** Five colors in, a whole readable skin out (fonts and corners are kept as they are). */
function setColors(colors, key) {
  commit((d) => {
    const keep = { 'font-ui': d.tokens['font-ui'], 'font-lcd': d.tokens['font-lcd'], radius: d.tokens.radius };
    d.tokens = { ...tokensFromPalette(paletteFromColors(colors), seeded(d.meta.seed)), ...keep };
    d.meta.colors = colors;
  }, key);
}

function colorsSection() {
  const colors = easyColors();
  const firstPic = draft.pictures[0];
  return section('Colors', { run: async () => {
    const g = await generateSkin({ previous: draft.layout });
    const c = colorsFromTokens(g.tokens);
    commit((d) => {
      d.tokens = { ...g.tokens, 'font-ui': d.tokens['font-ui'], 'font-lcd': d.tokens['font-lcd'], radius: d.tokens.radius };
      d.meta.colors = c;
    });
    rebuild();
  }, title: 'Borrow colors from a classic skin in the Winamp Skin Museum' },
  h('div', { class: 'swatches' }, EASY_COLORS.map(([key, label]) => h('label', { class: 'swatch-pick' },
    h('input', { type: 'color', value: colors[key], oninput: (e) => setColors({ ...easyColors(), [key]: e.target.value }, `color-${key}`) }),
    h('span', {}, label)))),
  h('div', { class: 'actions' },
    firstPic && h('button', { class: 'btn', onclick: () => colorsFromPicture(firstPic) }, '🎨 Colors from my picture'),
    slider('Corners', parseInt(draft.tokens.radius, 10) || 0, 0, 28, 1,
      (v) => commit((d) => { d.tokens.radius = `${v}px`; }, 'radius'), (v) => `${v}px`)),
  h('p', { class: 'setting-desc' }, 'Pick five colors and the rest is worked out for you, always readable. Deep has every color on its own.'));
}

async function colorsFromPicture(pic) {
  const url = await pictureUrl(pic.src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try {
    await img.decode();
    const colors = colorsFromImage(img);
    if (!colors) throw new Error('empty');
    setColors(colors);
    rebuild();
  } catch {
    toast('Couldn’t read the colors from that picture (the site it’s linked from doesn’t allow it)');
  }
}

function fontChips(list, token, sample) {
  const current = draft.tokens[token];
  return h('div', { class: 'font-row' }, list.map((f) => h('button', {
    class: `font-chip${current === f.stack ? ' on' : ''}`,
    style: `font-family: ${f.stack}`,
    'aria-pressed': String(current === f.stack),
    title: f.name,
    onclick: (e) => {
      commit((d) => { d.tokens[token] = f.stack; });
      e.currentTarget.parentElement.querySelectorAll('.font-chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget));
    },
  }, h('span', { class: 'fc-sample' }, sample), h('span', { class: 'fc-name' }, f.name))));
}

function fontsSection() {
  return section('Fonts', null,
    field('Screen & playlist', fontChips(DISPLAY_FONTS, 'font-lcd', '12:34')),
    field('Labels & library', fontChips(LABEL_FONTS, 'font-ui', 'Aa')),
    h('p', { class: 'setting-desc' }, 'Want another one? Deep lets you type any Google Font.'));
}

function layoutSection() {
  return section('Shape', { run: () => {
    commit((d) => { d.layout = rollLayout(Math.random, (l) => l[Math.floor(Math.random() * l.length)], d.layout); });
    rebuild();
  }, title: 'A new arrangement' },
  ...['deck', 'buttons', 'shape', 'lcd'].map((key) => field(LAYOUT_LABELS[key],
    chips(LAYOUT[key], draft.layout[key], (v) => commit((d) => { d.layout[key] = v; }), { name: LAYOUT_LABELS[key] }))),
  slider('Player width', draft.layout.width, WIDTH_RANGE[0], WIDTH_RANGE[1], 10,
    (v) => commit((d) => { d.layout.width = v; }, 'width'), (v) => `${v}px`));
}

function artSection(deep) {
  const art = draft.art || { base: 'none', overlays: [], strength: 0.6, seed: 1 };
  const setArt = (fn, key) => commit((d) => {
    const a = d.art || { base: 'none', overlays: [], strength: 0.6, seed: Math.floor(Math.random() * 1e6) };
    fn(a);
    d.art = validateArt(a);
  }, key);
  return section('Artwork', { run: () => {
    commit((d) => { d.art = validateArt(rollArt(Math.random, d.tokens)); });
    rebuild();
  }, title: 'New generated artwork' },
  field('Base', chips(ART.base, art.base, (v) => setArt((a) => { a.base = v; }), { name: 'Base' })),
  field('Layers (up to 4)', chips(ART.overlay, art.overlays || [], (v) => setArt((a) => {
    const set = new Set(a.overlays || []);
    if (set.has(v)) set.delete(v); else set.add(v);
    a.overlays = [...set].slice(-4);
  }), { multi: true, name: 'Layers' })),
  slider('Strength', Math.round((art.strength ?? 0.6) * 100), 10, 100, 5, (v) => setArt((a) => { a.strength = v / 100; }, 'art-strength'), (v) => `${v}%`),
  h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => setArt((a) => { a.seed = Math.floor(Math.random() * 1e9); }) }, icon('dice'), 'Redraw'),
    deep && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(art.glitch), onchange: (e) => setArt((a) => { a.glitch = e.target.checked; }) }), 'Glitch'),
    deep && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(art.rivets), onchange: (e) => setArt((a) => { a.rivets = e.target.checked; }) }), 'Rivets'),
    deep && h('label', { class: 'check' }, 'Seed ', h('input', {
      type: 'number', class: 'st-num', value: art.seed || 1, min: 1,
      onchange: (e) => setArt((a) => { a.seed = Number(e.target.value) || 1; }),
    }))));
}

function effectsSection() {
  return section('Effects', null,
    field(LAYOUT_LABELS.fx, chips(LAYOUT.fx, draft.layout.fx, (v) => commit((d) => { d.layout.fx = v; }), { name: 'Animation' })),
    field(LAYOUT_LABELS.pattern, chips(LAYOUT.pattern, draft.layout.pattern, (v) => commit((d) => { d.layout.pattern = v; }), { name: 'Texture' })),
    field(LAYOUT_LABELS.vis, chips(LAYOUT.vis, draft.layout.vis, (v) => commit((d) => { d.layout.vis = v; }), { name: 'Visualizer' })));
}

// ---------- Pictures ----------

function picturesSection(deep) {
  const list = draft.pictures;
  const addZone = list.length < MAX_PICTURES ? pictureAdder() : h('p', { class: 'setting-desc' }, `Up to ${MAX_PICTURES} pictures.`);
  return section('Pictures', null,
    list.length ? h('div', { class: 'pic-cards' }, list.map((p, i) => pictureCard(p, i, deep))) : null,
    addZone,
    h('p', { class: 'setting-desc' }, 'Pictures stay on this device. They aren’t included when you share a record.'));
}

function pictureAdder() {
  const status = h('span', { class: 'muted pic-status' });
  const input = h('input', { type: 'url', placeholder: 'https://… link to a picture', 'aria-label': 'Picture link' });
  const defaults = () => (draft.pictures.length ? { area: 'sticker', fit: 'contain', opacity: 1, scale: 60 } : { area: 'deck', fit: 'cover', opacity: 0.55 });
  const add = async (job) => {
    status.textContent = 'Adding…';
    try {
      const out = await job();
      const pic = out.picture || out;
      commit((d) => { d.pictures = [...d.pictures, pic]; });
      if (out.copied === false) toast('Linked: that site doesn’t allow a copy, so it needs the internet and some effects won’t apply');
      rebuild();
    } catch (err) {
      status.textContent = err.message;
    }
  };
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true,
    onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) add(() => addFile(f, defaults())); } });
  const zone = h('div', { class: 'pic-drop' },
    h('label', { class: 'btn primary' }, '⬆ Upload a picture', fileInput),
    h('span', { class: 'muted' }, 'or'),
    h('form', { class: 'pic-link', onsubmit: (e) => { e.preventDefault(); if (input.value) add(() => addLink(input.value, defaults())); } },
      input, h('button', { class: 'btn', type: 'submit' }, 'Add')),
    status);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files?.[0];
    if (f) add(() => addFile(f, defaults()));
  });
  return zone;
}

function pictureCard(p, i, deep) {
  const set = (fn, key) => commit((d) => { fn(d.pictures[i]); d.pictures = validatePictures(d.pictures); }, key && `pic${i}-${key}`);
  const thumb = h('span', { class: 'pic-thumb' });
  pictureUrl(p.src).then((url) => { if (url) thumb.style.backgroundImage = `url("${url}")`; });
  const rest = p.area === 'sticker'
    ? [slider('Size', p.scale, 20, 300, 5, (v) => set((x) => { x.scale = v; }, 'scale'), (v) => `${v}%`),
      field('Spot', chips(CORNERS, p.corner, (v) => set((x) => { x.corner = v; }), { label: (c) => c.replace('-', ' '), name: 'Spot' })),
      slider('Turn', p.rotate, -45, 45, 1, (v) => set((x) => { x.rotate = v; }, 'rotate'), (v) => `${v}°`)]
    : [field('Fit', chips(FITS, p.fit, (v) => { set((x) => { x.fit = v; }); rebuild(); }, { label: (f) => FIT_LABELS[f], name: 'Fit' })),
      p.fit === 'tile' && slider('Tile size', p.scale, 10, 300, 5, (v) => set((x) => { x.scale = v; }, 'scale'), (v) => `${v}%`)];
  return h('div', { class: 'pic-card' },
    h('div', { class: 'pic-top' }, thumb,
      h('div', { class: 'pic-where' },
        field('Show it on', chips(AREAS, p.area, (v) => { set((x) => { x.area = v; if (v === 'sticker') { x.fit = 'contain'; x.opacity = Math.max(x.opacity, 0.9); } }); rebuild(); }, { label: (a) => AREA_LABELS[a], name: 'Where' }))),
      h('button', { class: 'icon-btn', title: 'Remove picture', 'aria-label': 'Remove picture', html: icons.trash, onclick: async () => {
        const src = p.src;
        commit((d) => { d.pictures = d.pictures.filter((_, j) => j !== i); });
        await forgetIfUnused(src, [draft, ...mySkins(), ctx.store.settings.customSkin]);
        rebuild();
      } })),
    ...rest,
    slider('Strength', Math.round(p.opacity * 100), 5, 100, 5, (v) => set((x) => { x.opacity = v / 100; }, 'opacity'), (v) => `${v}%`),
    field('Effect', chips(EFFECTS, p.effect, (v) => set((x) => { x.effect = v; }), { label: (e) => EFFECT_LABELS[e], name: 'Effect' })),
    deep && h('div', { class: 'pic-deep' },
      field('Blend', h('select', { onchange: (e) => set((x) => { x.blend = e.target.value; }) },
        BLENDS.map((b) => h('option', { value: b, selected: p.blend === b }, b)))),
      slider('Hue', p.hue, -180, 180, 5, (v) => set((x) => { x.hue = v; }, 'hue'), (v) => `${v}°`),
      slider('Contrast', Math.round(p.contrast * 100), 30, 250, 5, (v) => set((x) => { x.contrast = v / 100; }, 'contrast'), (v) => `${v}%`),
      slider('Saturation', Math.round(p.saturate * 100), 0, 300, 5, (v) => set((x) => { x.saturate = v / 100; }, 'sat'), (v) => `${v}%`),
      slider('Blur', p.blur, 0, 12, 0.5, (v) => set((x) => { x.blur = v; }, 'blur'), (v) => `${v}px`),
      slider('Pixel size', p.pixel, 2, 24, 1, (v) => set((x) => { x.pixel = v; }, 'pixel'), (v) => `${v}px`),
      p.link && h('p', { class: 'setting-desc' }, 'From ', h('a', { href: p.link, target: '_blank', rel: 'noopener' }, new URL(p.link).hostname))));
}

// ---------- Deep ----------

function deepTab() {
  return h('div', { class: 'stack studio-body' },
    picturesSection(true),
    allLayoutSection(),
    tokensSection(),
    customFontsSection(),
    artSection(true),
    fileSection());
}

function allLayoutSection() {
  return section('Every layout option', null,
    ...Object.keys(LAYOUT).map((key) => field(LAYOUT_LABELS[key] || key,
      chips(LAYOUT[key], draft.layout[key], (v) => commit((d) => { d.layout[key] = v; }), { name: key }))),
    slider('Player width', draft.layout.width, WIDTH_RANGE[0], WIDTH_RANGE[1], 10,
      (v) => commit((d) => { d.layout.width = v; }, 'width'), (v) => `${v}px`));
}

const HEX = /^#[0-9a-f]{6}$/i;

function tokenRow(key) {
  const value = draft.tokens[key] ?? TOKENS[key];
  const text = h('input', { type: 'text', class: 'tok-text', value, spellcheck: false, 'aria-label': key });
  const color = h('input', { type: 'color', value: HEX.test(value) ? value : '#000000', disabled: !HEX.test(value), 'aria-label': `${key} color` });
  const apply = (v, from) => {
    try {
      validateTokens({ [key]: v });
      text.classList.remove('bad');
      commit((d) => { d.tokens[key] = v; delete d.meta.colors; }, `tok-${key}`);
      if (from !== text) text.value = v;
      if (HEX.test(v)) { color.disabled = false; if (from !== color) color.value = v; } else color.disabled = true;
    } catch {
      text.classList.add('bad');
    }
  };
  text.addEventListener('input', () => apply(text.value.trim(), text));
  color.addEventListener('input', () => apply(color.value, color));
  return h('div', { class: 'tok-row' }, color, h('span', { class: 'tok-key' }, key), text);
}

function tokensSection() {
  return section('Every color & style', null,
    h('p', { class: 'setting-desc' }, 'Any CSS color, gradient, shadow or font list works. Pictures go in Pictures, not here.'),
    TOKEN_GROUPS.map(([title, keys]) => h('details', { class: 'tok-group', open: title === 'Player window' },
      h('summary', {}, title), keys.map(tokenRow))));
}

function customFontsSection() {
  const row = (label, token, fallback) => {
    const input = h('input', { type: 'text', placeholder: 'e.g. Bungee Shade', 'aria-label': label });
    const status = h('span', { class: 'muted' });
    return field(label, h('form', { class: 'pic-link', onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!validateFonts([name]).length) { status.textContent = 'Letters, numbers and spaces only'; return; }
      commit((d) => {
        d.meta.customFonts = validateFonts([...(d.meta.customFonts || []), name]).slice(-4);
        d.tokens[token] = `"${name}", ${fallback}`;
      });
      status.textContent = `Using ${name} (if Google Fonts has it)`;
    } }, input, h('button', { class: 'btn', type: 'submit' }, 'Use')), status);
  };
  return section('Any Google Font', null,
    h('p', { class: 'setting-desc' }, 'Type a family name from ',
      h('a', { href: 'https://fonts.google.com/', target: '_blank', rel: 'noopener' }, 'fonts.google.com'), '.'),
    row('Screen & playlist', 'font-lcd', 'ui-monospace, monospace'),
    row('Labels & library', 'font-ui', 'Tahoma, Verdana, sans-serif'));
}

function fileSection() {
  const plain = () => {
    const { meta, ...rest } = clone(draft);
    return JSON.stringify({ ...rest, pictures: rest.pictures.filter((p) => !p.src.startsWith('pic:')) }, null, 2);
  };
  const area = h('textarea', { class: 'st-json', rows: 14, spellcheck: false }, plain());
  const status = h('span', { class: 'muted' });
  return section('Skin file', null,
    h('p', { class: 'setting-desc' }, 'Edit the whole skin as text. Uploaded pictures aren’t in the file.'),
    area,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => {
        try {
          const sk = parseSkinFile(area.value);
          commit((d) => {
            d.name = sk.name; d.tokens = { ...TOKENS, ...sk.tokens }; d.layout = sk.layout; d.art = sk.art;
            d.pictures = [...d.pictures.filter((p) => p.src.startsWith('pic:')), ...sk.pictures].slice(0, MAX_PICTURES);
            delete d.meta.colors;
          });
          rebuild();
          toast('Skin file applied');
        } catch (err) {
          status.textContent = err.message;
        }
      } }, 'Apply'),
      h('button', { class: 'btn', onclick: () => { area.value = plain(); status.textContent = ''; } }, 'Reset text'),
      h('button', { class: 'btn', onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([plain()], { type: 'application/json' })), download: `${draft.name.replace(/[^\w-]+/g, '-')}.json` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }, 'Download'),
      status),
    h('div', { class: 'actions danger-zone' },
      h('button', { class: 'btn danger', onclick: deleteSkin }, icon('trash'), 'Delete this skin')));
}

async function deleteSkin() {
  if (!saved) { toast('This skin isn’t saved yet'); return; }
  const gone = draft;
  ctx.store.setSetting('mySkins', mySkins().filter((s) => s.id !== gone.id));
  for (const p of gone.pictures) await forgetIfUnused(p.src, [...mySkins(), ctx.store.settings.customSkin]);
  draft = null;
  ctx.useSkin(ctx.fallbackSkin());
  toast(`Deleted “${gone.name}”`);
  location.hash = '#/settings';
}
