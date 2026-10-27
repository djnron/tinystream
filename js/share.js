// Shared records: a link that carries a track list, a title and the sender's skin, playable by
// anyone without an account.
//
// Making a record turns on "anyone with the link" for just those songs (Google Drive) or creates
// Dropbox share links for them. The record link itself holds everything else, compressed into the
// part after "#", so no server is involved and nothing is stored anywhere but the link.
//
// "Disable downloads" hides every download/save option for the record. It's a deterrent, not
// protection: a browser that can play a song has its data, so a determined person could still save it.

import { CONFIG } from '../config.js';
import { pictureBlob, setRemoteLoader, validatePicture } from './pictures.js';
import { getProvider } from './providers/index.js';
import { DEFAULT_LAYOUT, SKINS, solidColor, TOKENS, validateArt, validateFonts, validateLayout, validateTokens } from './skins.js';
import { stripExt, withAudioType } from './util.js';

const RECORDS_KEY = 'mb.records';
const MAX_TRACKS = 300;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const DROPBOX_PATH = /^\/(scl\/fi|s)\/[A-Za-z0-9_./%+()~-]+(\?[A-Za-z0-9_=&%.-]*)?$/;

// ---------- encoding the link ----------

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if ('CompressionStream' in window) return `z${toB64(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j${toB64(bytes)}`;
}

async function decode(text) {
  const kind = text[0];
  let bytes = fromB64(text.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('Unknown record format');
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Link previews (a picture and title when the link is pasted into a chat) need the small server
 * functions in api/, which run on Vercel. Elsewhere (GitHub Pages) links are plain.
 */
export const previewsAvailable = () => location.hostname.endsWith('.vercel.app') || Boolean(CONFIG.linkPreviews);

export function recordUrl(payload, card = '') {
  if (card && previewsAvailable()) return `${location.origin}/r?c=${card}#/r/${payload}`;
  return `${location.origin}${location.pathname}#/r/${payload}`;
}

/** The card for link previews: title, count, skin colors and the cover picture (if one was saved). */
async function makeCard({ title, count, skin, cover }) {
  const t = { ...TOKENS, ...(skin?.tokens || {}) };
  const hex = (v) => { const c = solidColor(v); return /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined; };
  return encode({
    t: title.slice(0, 80),
    n: count,
    s: skin?.name || '',
    r: parseInt(t.radius, 10) || 0,
    c: {
      bg: hex(t.bg), text: hex(t.text), muted: hex(t.muted), accent: hex(t.accent),
      deck: hex(t['deck-bg']), title: hex(t['titlebar-bg']), titleText: hex(t['titlebar-text']),
      btn: hex(t['btn-face']), btnText: hex(t['btn-text']), lcd: hex(t['lcd-bg']), lcdText: hex(t['lcd-text']),
      list: hex(t['list-bg']), listText: hex(t['list-text']),
    },
    i: cover || undefined,
  });
}

// ---------- keeping links short ----------
//
// Version 2 records leave out everything the listener's app can work out for itself: a built-in
// skin is sent as its id, a custom skin only as what differs from the defaults, Dropbox songs as
// just their link (the file name is in it), and no file sizes. Version 1 links still open.

const shortHex = (v) => String(v).replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi, '#$1$2$3');

function leanSkin(skin, pictureRows) {
  if (!skin) return undefined;
  const builtIn = SKINS.find((s) => s.id === skin.id);
  if (builtIn && !pictureRows.length && !skin.fonts?.length) return skin.id;
  // A skin straight from the dice: its seed rebuilds it exactly (see generateAndApply in app.js).
  if (Number.isInteger(skin.gen) && skin.id === 'custom' && !pictureRows.length) return { g: skin.gen };
  const k = {};
  for (const [key, value] of Object.entries(skin.tokens || {})) if (TOKENS[key] !== value) k[key] = shortHex(value);
  const l = {};
  for (const [key, value] of Object.entries(skin.layout || {})) if (DEFAULT_LAYOUT[key] !== value) l[key] = value;
  return {
    n: skin.name,
    k: Object.keys(k).length ? k : undefined,
    l: Object.keys(l).length ? l : undefined,
    a: skin.art || undefined,
    f: skin.fonts?.length ? skin.fonts : undefined,
    p: pictureRows.length ? pictureRows : undefined,
  };
}

const DROPBOX_LEAN = /^\/scl\/fi\/([a-z0-9]+)\/([^/?]+)\?rlkey=([a-z0-9]+)$/i;

/** One song: a Dropbox link becomes "id/name?key"; Google Drive songs are [g, id, name, key?]. */
function leanSong(x) {
  if (x.src === 'd') {
    const m = DROPBOX_LEAN.exec(x.ref);
    if (m && decodeURIComponent(m[2]) === x.name) return `${m[1]}/${m[2]}?${m[3]}`;
    return ['d', x.ref, x.name];
  }
  return x.key ? ['g', x.ref, x.name, x.key] : ['g', x.ref, x.name];
}

/** Version 2 songs back to version 1 rows: [src, ref, name, size, key]. */
function expandSong(row) {
  if (typeof row === 'string') {
    const m = /^([a-z0-9]+)\/([^/?]+)\?([a-z0-9]+)$/i.exec(row);
    if (!m) return null;
    let name;
    try { name = decodeURIComponent(m[2]); } catch { return null; }
    return ['d', `/scl/fi/${m[1]}/${m[2]}?rlkey=${m[3]}`, name, 0, 0];
  }
  if (!Array.isArray(row)) return null;
  const [src, ref, name, key] = row;
  return [src, ref, name, 0, key || 0];
}

// ---------- making a record ----------

/** Dropbox share URL -> the path on dl.dropboxusercontent.com (the host that allows web players). */
function dropboxPath(url) {
  const u = new URL(url);
  u.searchParams.delete('dl');
  u.searchParams.delete('raw');
  u.searchParams.delete('st');
  const path = u.pathname + (u.search || '');
  if (!DROPBOX_PATH.test(path)) throw new Error('Dropbox gave back a link Music Box doesn’t recognize. Try again.');
  return path;
}

/**
 * Shares the tracks and returns { url, record }. `onProgress(done, total)` reports sharing progress.
 * Throws { code: 'dropbox-scope' } when Dropbox needs the extra sharing permission first.
 */
export async function createRecord({ title, tracks, skin, noDownload, withPictures = true, source = null, makeCover = null, onProgress }) {
  const list = tracks.slice(0, MAX_TRACKS);
  const items = [];
  // Pictures first: if Dropbox needs a permission for them, nothing has been shared yet.
  const pics = withPictures && skin?.pictures?.length ? await sharePictures(skin, list[0]?.provider) : { rows: [], items: [] };
  for (const [i, t] of list.entries()) {
    const p = getProvider(t.provider);
    if (t.provider === 'gdrive') {
      const resourceKey = await p.shareFile(t.fileId);
      items.push({ src: 'g', ref: t.fileId, key: resourceKey || undefined, name: t.name, size: t.size });
    } else if (t.provider === 'dropbox') {
      const url = await p.shareFile(t.fileId);
      items.push({ src: 'd', ref: dropboxPath(url), url, name: t.name, size: t.size });
    } else {
      throw new Error('Only Google Drive and Dropbox songs can be shared');
    }
    onProgress?.(i + 1, list.length);
  }
  const payload = await encode({
    v: 2,
    t: title.slice(0, 80),
    d: noDownload ? 1 : undefined,
    s: leanSkin(skin, pics.rows),
    r: items.map(leanSong),
  });
  // The link preview picture: a snapshot of the player, saved next to the songs. Optional: if it
  // can't be made or saved, previews fall back to a drawn version of the player.
  let cover = null;
  if (makeCover && previewsAvailable()) {
    try {
      cover = await shareCover(await makeCover(), list[0]?.provider);
      if (cover) pics.items.push(cover.item);
    } catch (err) {
      console.warn('No link preview picture', err);
    }
  }
  const card = previewsAvailable() ? await makeCard({ title, count: items.length, skin, cover: cover?.ref }) : '';
  const url = recordUrl(payload, card);
  const record = {
    id: `r${Date.now().toString(36)}`,
    title,
    url,
    noDownload,
    source: source || undefined, // the folder it was made from, so the player's Share can offer it again
    created: Date.now(),
    count: items.length,
    items: [...items, ...pics.items].map((x) => ({ src: x.src, ref: x.ref, url: x.url })),
  };
  saveRecords([record, ...myRecords()]);
  return { url, record, truncated: tracks.length > list.length };
}

// ---------- pictures in records ----------
//
// A skin's own pictures are saved next to the songs (in the same Google Drive or Dropbox) and
// shared by link, so listeners see them without an account. The record carries each picture's id
// plus its settings (where it shows, fit, effect...). Pictures added from a web link travel as
// that link, and listeners choose whether to load them (that site would see their visit).

const UPLOADS_KEY = 'mb.pictureUploads'; // "<host>:<picture src>" -> what was uploaded, to reuse it
const PIC_FIELDS = ['area', 'fit', 'effect', 'blend', 'opacity', 'scale', 'hue', 'contrast', 'saturate', 'blur', 'pixel', 'rotate', 'corner'];
const picSettings = (p) => Object.fromEntries(PIC_FIELDS.map((k) => [k, p[k]]));

function uploads() {
  try { return JSON.parse(localStorage.getItem(UPLOADS_KEY)) || {}; } catch { return {}; }
}

/** Uploads and shares the skin's stored pictures; returns record rows and items to unshare later. */
async function sharePictures(skin, songsProvider) {
  const rows = [];
  const items = [];
  const drive = getProvider('gdrive');
  const dropbox = getProvider('dropbox');
  // Same place as the songs. Dropbox needs one more permission; use Drive instead if it's connected.
  const host = songsProvider === 'gdrive' || !(dropbox?.isConnected())
    ? 'gdrive'
    : dropbox.canUploadPictures() || !drive?.isConnected() ? 'dropbox' : 'gdrive';
  const done = uploads();
  for (const p of skin.pictures) {
    if (p.src.startsWith('pic:')) {
      const key = `${host}:${p.src}`;
      let up = done[key];
      if (up) {
        // Reuse the earlier upload; sharing it again covers "stopped sharing" since. If it was
        // deleted in the meantime, upload it again.
        try {
          if (host === 'gdrive') await drive.shareFile(up.ref);
          else up.url = await dropbox.shareFile(up.id);
        } catch (err) {
          if (err.code) throw err;
          up = null;
        }
      }
      if (!up) {
        const blob = await pictureBlob(p.src);
        if (!blob) continue;
        const name = `${p.src.slice(4)}.${(blob.type.split('/')[1] || 'webp').replace(/[^a-z]/g, '')}`;
        up = host === 'gdrive' ? await drive.uploadPicture(blob, name) : await dropbox.uploadPicture(blob, name);
      }
      done[key] = up;
      localStorage.setItem(UPLOADS_KEY, JSON.stringify(done));
      if (host === 'gdrive') {
        rows.push(['g', up.ref, up.key || 0, picSettings(p)]);
        items.push({ src: 'g', ref: up.ref });
      } else {
        const ref = dropboxPath(up.url);
        rows.push(['d', ref, 0, picSettings(p)]);
        items.push({ src: 'd', ref, url: up.url });
      }
    } else if (p.src.startsWith('https://')) {
      rows.push(['l', p.src, 0, picSettings(p)]);
    }
  }
  return { rows, items };
}

/** Saves and shares the link preview picture where the songs are, if that needs no new permission. */
async function shareCover(blob, songsProvider) {
  const drive = getProvider('gdrive');
  const dropbox = getProvider('dropbox');
  const name = `cover-${Date.now().toString(36)}.jpg`;
  if (songsProvider === 'dropbox' && dropbox.canUploadPictures()) {
    const up = await dropbox.uploadPicture(blob, name);
    const ref = dropboxPath(up.url);
    return { ref: ['d', ref], item: { src: 'd', ref, url: up.url } };
  }
  if (drive?.isConnected()) {
    const up = await drive.uploadPicture(blob, name);
    return { ref: ['g', up.ref, up.key || undefined], item: { src: 'g', ref: up.ref } };
  }
  return null; // Dropbox without the save permission: previews use the drawn player instead
}

/** Fetches a record's picture ("rec:g:<id>[:<key>]" or "rec:d:<path>") without any account. */
async function loadRecordPicture(src) {
  const [, kind, ...rest] = src.split(':');
  let res;
  if (kind === 'g') {
    const [id, key] = rest;
    if (!DRIVE_ID.test(id)) return null;
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(CONFIG.googleApiKey)}`;
    res = await fetch(url, { headers: key && /^[\w-]{1,100}$/.test(key) ? { 'X-Goog-Drive-Resource-Keys': `${id}/${key}` } : {} });
  } else {
    const path = rest.join(':');
    if (!DROPBOX_PATH.test(path)) return null;
    res = await fetch(`https://dl.dropboxusercontent.com${path}`);
  }
  if (!res.ok) return null;
  const blob = await res.blob();
  if (blob.size > 8e6) return null;
  // Dropbox labels everything as a download; trust only real image types (or sniff via decoding).
  if (blob.type.startsWith('image/')) return blob;
  const typed = new Blob([blob], { type: 'image/webp' });
  try { await createImageBitmap(typed); return typed; } catch { /* not WebP */ }
  const png = new Blob([blob], { type: 'image/png' });
  try { await createImageBitmap(png); return png; } catch { return null; }
}
setRemoteLoader(loadRecordPicture);

/** Turns link sharing back off for the record's songs and forgets it. */
export async function stopSharing(id) {
  const rec = myRecords().find((r) => r.id === id);
  if (!rec) return;
  // A song can be in more than one record; keep it shared if another record still uses it.
  const others = myRecords().filter((r) => r.id !== id).flatMap((r) => r.items.map((x) => `${x.src}:${x.ref}`));
  const failures = [];
  for (const x of rec.items) {
    if (others.includes(`${x.src}:${x.ref}`)) continue;
    try {
      if (x.src === 'g') await getProvider('gdrive').unshareFile(x.ref);
      else await getProvider('dropbox').unshareFile(x.url);
    } catch (err) {
      failures.push(err);
    }
  }
  saveRecords(myRecords().filter((r) => r.id !== id));
  if (failures.length) throw new Error(`${failures.length} song${failures.length === 1 ? '' : 's'} could not be unshared: ${failures[0].message}`);
}

/** Points records made from folders that moved (Dropbox app switch) at the folders' new ids. */
export function moveRecordSources(pid, moved) {
  saveRecords(myRecords().map((r) => (r.source?.pid === pid && moved.has(r.source.id) ? { ...r, source: { pid, id: moved.get(r.source.id) } } : r)));
}

export function myRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecords(list) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
}

// ---------- opening a record ----------

/** Decodes and checks a record link. Everything in it is treated as untrusted. */
export async function openRecord(payload) {
  const data = await decode(payload);
  if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.r)) throw new Error('This record link is damaged');
  if (data.v === 2) {
    data.r = data.r.map(expandSong).filter(Boolean);
    // A built-in skin travels as its id.
    if (typeof data.s === 'string') {
      const builtIn = SKINS.find((s) => s.id === data.s);
      data.s = builtIn ? { n: builtIn.name, k: builtIn.tokens, l: builtIn.layout, a: builtIn.art } : null;
    } else if (Number.isInteger(data.s?.g)) {
      // A generated skin travels as its seed. (Changing the generator changes how these look.)
      const { generateSkin, seeded } = await import('./skin-generator.js');
      const g = await generateSkin({ rand: seeded(data.s.g >>> 0) });
      data.s = { n: g.name, k: g.tokens, l: g.layout, a: g.art };
    }
  }
  const title = String(data.t || 'Untitled record').slice(0, 80);
  const noDownload = Boolean(data.d);
  let skin = null;
  if (data.s && typeof data.s === 'object') {
    try {
      skin = {
        id: 'record',
        name: String(data.s.n || 'Shared skin').slice(0, 40),
        tokens: validateTokens(data.s.k || {}),
        layout: validateLayout(data.s.l || {}),
        art: validateArt(data.s.a),
        fonts: validateFonts(data.s.f),
        pictures: [],
      };
    } catch {
      skin = null; // a skin that doesn't pass the checks is simply ignored
    }
  }
  // Pictures: ones saved next to the songs show straight away; web links wait until the listener agrees.
  const linkPictures = [];
  if (skin && Array.isArray(data.s?.p)) {
    for (const row of data.s.p.slice(0, 4)) {
      if (!Array.isArray(row)) continue;
      const [kind, ref, key, settings] = row;
      const src = kind === 'g' && DRIVE_ID.test(ref) ? `rec:g:${ref}${typeof key === 'string' && /^[\w-]{1,100}$/.test(key) ? `:${key}` : ''}`
        : kind === 'd' && DROPBOX_PATH.test(ref) ? `rec:d:${ref}`
          : kind === 'l' ? ref : null;
      const pic = src && validatePicture({ ...(settings && typeof settings === 'object' ? settings : {}), src });
      if (!pic) continue;
      if (kind === 'l') linkPictures.push(pic);
      else skin.pictures.push(pic);
    }
  }
  const tracks = [];
  for (const row of data.r.slice(0, MAX_TRACKS)) {
    if (!Array.isArray(row)) continue;
    const [src, ref, name, size, key] = row;
    if (src === 'g' && !DRIVE_ID.test(ref)) continue;
    if (src === 'd' && !DROPBOX_PATH.test(ref)) continue;
    if (src !== 'g' && src !== 'd') continue;
    const fileName = String(name || 'Track').slice(0, 200);
    tracks.push({
      id: `shared:${src}:${ref}`,
      provider: 'shared',
      src,
      fileId: ref,
      resourceKey: typeof key === 'string' && /^[\w-]{1,100}$/.test(key) ? key : null,
      fileName,
      name: stripExt(fileName),
      folder: title,
      size: Number(size) || 0,
      locked: noDownload,
    });
  }
  return { title, noDownload, skin, tracks, linkPictures };
}

/** A direct link to the file, offered only when the sender allowed downloads. */
export function downloadUrl(track) {
  if (track.locked) return null;
  return track.src === 'g'
    ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(track.fileId)}`
    : `https://dl.dropboxusercontent.com${track.fileId}${track.fileId.includes('?') ? '&' : '?'}dl=1`;
}

/** Plays shared songs without any account: public Drive files via the API key, Dropbox via share links. */
export const sharedSource = {
  id: 'shared',
  label: 'Shared record',
  /** Shared songs stream straight from Drive or Dropbox (no account needed). */
  async streamUrl(track) {
    if (track.src === 'd') return { url: `https://dl.dropboxusercontent.com${track.fileId}`, ttl: 6 * 3600e3 };
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(CONFIG.googleApiKey)}`;
    return track.resourceKey
      ? { url, headers: { 'X-Goog-Drive-Resource-Keys': `${track.fileId}/${track.resourceKey}` }, ttl: 6 * 3600e3 }
      : { url, ttl: 6 * 3600e3 };
  },

  async fetchBlob(track, { signal } = {}) {
    let res;
    if (track.src === 'g') {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(CONFIG.googleApiKey)}`;
      const headers = track.resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${track.fileId}/${track.resourceKey}` } : {};
      res = await fetch(url, { signal, headers });
    } else {
      res = await fetch(`https://dl.dropboxusercontent.com${track.fileId}`, { signal });
    }
    if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? 'The sender stopped sharing this song' : `Couldn’t load this song (error ${res.status})`);
    return withAudioType(await res.blob(), track.fileName);
  },
};
