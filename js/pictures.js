// Pictures on skins (Skin Studio): a person's own images layered onto the player.
//
// A skin lists up to four picture layers. Each one shows in one place (behind the player, inside
// the screen, behind the playlist, behind the whole page, or as a sticker on the player) with its
// own fit, strength, blend and effects. Uploaded pictures are shrunk and kept on this device in
// IndexedDB; a link is copied in too when the other site allows it, otherwise it's shown straight
// from that link. Pictures never travel with shared records.

import { deletePicture, getPicture, putPicture } from './store.js';

export const MAX_PICTURES = 4;
export const AREAS = ['deck', 'screen', 'list', 'page', 'sticker'];
export const AREA_LABELS = { deck: 'Player', screen: 'Screen', list: 'Playlist', page: 'Page', sticker: 'Sticker' };
export const FITS = ['cover', 'contain', 'tile', 'stretch'];
export const FIT_LABELS = { cover: 'Fill', contain: 'Fit', tile: 'Tile', stretch: 'Stretch' };
export const EFFECTS = ['none', 'mono', 'tint', 'neon', 'sepia', 'invert', 'pixel', 'soft'];
export const EFFECT_LABELS = { none: 'Original', mono: 'Mono', tint: 'Tint', neon: 'Neon', sepia: 'Sepia', invert: 'Invert', pixel: 'Pixel', soft: 'Dreamy' };
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'difference', 'exclusion', 'luminosity'];
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

const LINK = /^https:\/\/[^\s"'()\\]{4,2000}$/;
const clampNum = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const oneOf = (v, list) => (list.includes(v) ? v : list[0]);

/** A clean picture layer, or null. Sources are a stored picture ("pic:<id>") or an https link. */
export function validatePicture(p) {
  if (!p || typeof p !== 'object') return null;
  const src = String(p.src || '');
  // "rec:..." are pictures from a shared record, fetched by the loader share.js registers.
  if (!/^pic:[\w-]{1,40}$/.test(src) && !/^rec:[gd]:[^\s"'\\]{1,600}$/.test(src) && !LINK.test(src)) return null;
  return {
    src,
    link: LINK.test(String(p.link || '')) ? String(p.link) : undefined,
    area: oneOf(p.area, AREAS),
    fit: oneOf(p.fit, FITS),
    effect: oneOf(p.effect, EFFECTS),
    blend: oneOf(p.blend, BLENDS),
    opacity: clampNum(p.opacity, 0.05, 1, 0.6),
    scale: clampNum(p.scale, 10, 300, 100), // tile size, or sticker size (% of the player width / 3)
    hue: clampNum(p.hue, -180, 180, 0),
    contrast: clampNum(p.contrast, 0.3, 2.5, 1),
    saturate: clampNum(p.saturate, 0, 3, 1),
    blur: clampNum(p.blur, 0, 12, 0),
    pixel: clampNum(p.pixel, 2, 24, 6),
    rotate: clampNum(p.rotate, -45, 45, 0),
    corner: oneOf(p.corner, CORNERS),
  };
}

export function validatePictures(list) {
  return (Array.isArray(list) ? list : []).map(validatePicture).filter(Boolean).slice(0, MAX_PICTURES);
}

// ---------- adding pictures ----------

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const withTimeout = (promise, ms, message) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error(message)), ms); }),
]);

/** Decodes a picture with whatever the browser supports (older Safari lacks some of these). */
async function decode(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob); } catch { /* try the old way */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Encodes a canvas, preferring WebP; Safari can't write WebP, so it gets JPEG (or PNG for cut-outs). */
async function encode(canvas, transparent) {
  const toBlob = (type, q) => (canvas.convertToBlob
    ? canvas.convertToBlob({ type, quality: q })
    : new Promise((resolve) => canvas.toBlob(resolve, type, q)));
  const webp = await toBlob('image/webp', 0.88);
  if (webp?.type === 'image/webp') return webp;
  return toBlob(transparent ? 'image/png' : 'image/jpeg', 0.86);
}

/** Shrinks an image to at most `max` px on its longest side and re-encodes it (keeps transparency). */
async function shrink(blob, max = 1600) {
  const img = await decode(blob);
  const w0 = img.width || img.naturalWidth;
  const h0 = img.height || img.naturalHeight;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  img.close?.();
  const transparent = /png|gif|webp/.test(blob.type) || /\.(png|gif|webp)$/i.test(blob.name || '');
  const out = await encode(canvas, transparent);
  if (!out) throw new Error('encode failed');
  return out;
}

const looksLikeImage = (file) => file.type.startsWith('image/') || (!file.type && /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i.test(file.name || ''));

/** Stores an uploaded file and returns a new picture layer. */
export async function addFile(file, defaults = {}) {
  if (!looksLikeImage(file)) throw new Error('That file is not a picture');
  if (file.size > 25e6) throw new Error('That picture is too big (25 MB at most)');
  let blob;
  try {
    blob = file.type === 'image/gif' ? file : await withTimeout(shrink(file), 20000, 'timeout'); // keep GIFs animated
  } catch {
    throw new Error("Couldn't read that picture. Try a JPEG or PNG.");
  }
  if (blob.size > 6e6) throw new Error('That animated picture is too big (6 MB at most)');
  const id = newId();
  await withTimeout(putPicture(id, blob), 15000, 'Couldn’t save the picture on this device. Close other Music Box tabs or windows, reload, and try again.');
  return validatePicture({ ...defaults, src: `pic:${id}` });
}

/** Adds a picture from a link: copied onto the device when the site allows it, linked otherwise. */
export async function addLink(url, defaults = {}) {
  const link = String(url).trim();
  if (!LINK.test(link)) throw new Error('Paste a link that starts with https://');
  try {
    const res = await withTimeout(fetch(link, { mode: 'cors' }), 12000, 'timeout');
    if (!res.ok) throw new Error(String(res.status));
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('not an image');
    const blob = await res.blob();
    const id = newId();
    await withTimeout(putPicture(id, type === 'image/gif' ? blob : await shrink(blob)), 15000, 'timeout');
    return { picture: validatePicture({ ...defaults, src: `pic:${id}`, link }), copied: true };
  } catch {
    // The site doesn't allow copying: show it straight from the link (it must load as an image).
    await withTimeout(new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = () => reject(new Error("Couldn't load a picture from that link. Use a link straight to the image (it usually ends in .jpg or .png)."));
      img.src = link;
    }), 15000, "That link took too long to load. Use a link straight to the image (it usually ends in .jpg or .png).");
    return { picture: validatePicture({ ...defaults, src: link }), copied: false };
  }
}

/** Deletes a stored picture if none of these skins uses it any more. */
export async function forgetIfUnused(src, skins) {
  if (!src.startsWith('pic:')) return;
  if (skins.some((s) => (s?.pictures || []).some((p) => p.src === src))) return;
  if (urls.has(src)) URL.revokeObjectURL(urls.get(src));
  urls.delete(src);
  await deletePicture(src.slice(4)).catch(() => {});
}

// ---------- showing them ----------

const urls = new Map(); // "pic:<id>" -> object URL
const pixelUrls = new Map(); // "<src>|<size>" -> object URL of a pixelated copy

let remoteLoader = null;
/** How to fetch a shared record's pictures ("rec:..." sources): set by share.js. */
export function setRemoteLoader(fn) {
  remoteLoader = fn;
}

/** The picture's data (stored or from a shared record), or null for plain links. */
export async function pictureBlob(src) {
  if (src.startsWith('pic:')) return getPicture(src.slice(4));
  if (src.startsWith('rec:')) return remoteLoader?.(src).catch(() => null) ?? null;
  return null;
}

/** Copies a shared record's picture onto this device and returns the picture pointing at the copy. */
export async function adoptPicture(p) {
  if (!p.src.startsWith('rec:')) return p;
  const blob = await pictureBlob(p.src);
  if (!blob) return null;
  const id = newId();
  await putPicture(id, blob);
  return validatePicture({ ...p, src: `pic:${id}` });
}

/** A URL the page can show for a picture source. */
export async function pictureUrl(src) {
  if (!src.startsWith('pic:') && !src.startsWith('rec:')) return src;
  if (urls.has(src)) return urls.get(src);
  const blob = await pictureBlob(src);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(src, url);
  return url;
}

/** A chunky low-resolution copy for the Pixel effect (stored pictures only; links show as-is). */
async function pixelUrl(src, size) {
  const key = `${src}|${size}`;
  if (pixelUrls.has(key)) return pixelUrls.get(key);
  const url = await pictureUrl(src);
  if (!url || !/^(pic|rec):/.test(src)) return url;
  try {
    const img = await decode(await (await fetch(url)).blob());
    const w = Math.max(8, Math.round((img.width || img.naturalWidth) / size));
    const h = Math.max(8, Math.round((img.height || img.naturalHeight) / size));
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const out = URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
    pixelUrls.set(key, out);
    return out;
  } catch {
    return url;
  }
}

const docs = new Set([document]);
/** Also draw pictures in another document (the pop-out player window). */
export function setPictureDoc(doc, on = true) {
  if (on) docs.add(doc); else docs.delete(doc);
}

const TARGETS = { deck: '.deck', screen: '.deck .screen', list: '.playlist', sticker: '.deck' };
let current = [];
let seq = 0;

/** Shows a skin's picture layers (or clears them) everywhere the player is. */
export async function applyPictures(list) {
  const mine = ++seq;
  const layers = validatePictures(list);
  const resolved = await Promise.all(layers.map(async (p) => ({
    ...p,
    url: p.effect === 'pixel' ? await pixelUrl(p.src, p.pixel) : await pictureUrl(p.src),
  })));
  if (mine !== seq) return; // a newer skin arrived while loading
  current = resolved;
  for (const doc of docs) draw(doc);
}

/** Redraws in a document whose player was just rebuilt or moved there. */
export function redrawPictures(doc = document) {
  draw(doc);
}

function draw(doc) {
  doc.querySelectorAll('.pic-layer').forEach((el) => el.remove());
  doc.querySelectorAll('.has-pic').forEach((el) => el.classList.remove('has-pic'));
  current.forEach((p, i) => {
    if (!p.url) return;
    const host = p.area === 'page' ? doc.body : doc.querySelector(TARGETS[p.area]);
    if (!host) return;
    const el = doc.createElement(p.area === 'sticker' ? 'img' : 'div');
    el.className = `pic-layer pic-${p.area}`;
    el.dataset.layer = String(i);
    el.setAttribute('aria-hidden', 'true');
    if (p.area === 'sticker') {
      el.src = p.url;
      el.alt = '';
      el.dataset.corner = p.corner;
      el.style.width = `${Math.round(p.scale / 3)}%`;
      el.style.setProperty('--rot', `${p.rotate}deg`);
    } else {
      el.style.backgroundImage = `url("${p.url.replace(/"/g, '%22')}")`;
      el.dataset.fit = p.fit;
      if (p.fit === 'tile') el.style.backgroundSize = `${Math.round(p.scale * 2)}px auto`;
    }
    if (p.effect === 'pixel') el.style.imageRendering = 'pixelated';
    el.dataset.effect = p.effect;
    el.style.opacity = String(p.opacity);
    el.style.mixBlendMode = p.blend;
    const filters = p.area === 'sticker' ? ['drop-shadow(0 3px 6px #0008)'] : [];
    if (p.effect === 'mono') filters.push('grayscale(1)');
    if (p.effect === 'sepia') filters.push('sepia(0.9)');
    if (p.effect === 'invert') filters.push('invert(1)');
    if (p.effect === 'soft') filters.push('blur(2px) saturate(1.4)');
    if (p.effect === 'neon') filters.push('contrast(1.6) saturate(1.8)');
    if (p.hue) filters.push(`hue-rotate(${p.hue}deg)`);
    if (p.contrast !== 1) filters.push(`contrast(${p.contrast})`);
    if (p.saturate !== 1) filters.push(`saturate(${p.saturate})`);
    if (p.blur) filters.push(`blur(${p.blur}px)`);
    el.style.filter = filters.join(' ');
    if (p.area !== 'page') host.classList.add('has-pic');
    host.prepend(el);
  });
}
