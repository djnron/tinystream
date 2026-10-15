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
import { getProvider } from './providers/index.js';
import { validateArt, validateLayout, validateTokens } from './skins.js';
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

export function recordUrl(payload) {
  return `${location.origin}${location.pathname}#/r/${payload}`;
}

// ---------- making a record ----------

/** Dropbox share URL -> the path on dl.dropboxusercontent.com (the host that allows web players). */
function dropboxPath(url) {
  const u = new URL(url);
  u.searchParams.delete('dl');
  u.searchParams.delete('raw');
  u.searchParams.delete('st');
  const path = u.pathname + (u.search || '');
  if (!DROPBOX_PATH.test(path)) throw new Error('Dropbox returned a link Music Box does not recognise');
  return path;
}

/**
 * Shares the tracks and returns { url, record }. `onProgress(done, total)` reports sharing progress.
 * Throws { code: 'dropbox-scope' } when Dropbox needs the extra sharing permission first.
 */
export async function createRecord({ title, tracks, skin, noDownload, onProgress }) {
  const list = tracks.slice(0, MAX_TRACKS);
  const items = [];
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
    v: 1,
    t: title.slice(0, 80),
    d: noDownload ? 1 : 0,
    s: skin ? { n: skin.name, k: skin.tokens, l: skin.layout, a: skin.art } : null,
    r: items.map((x) => [x.src, x.ref, x.name, x.size || 0, x.key || 0]),
  });
  const url = recordUrl(payload);
  const record = {
    id: `r${Date.now().toString(36)}`,
    title,
    url,
    noDownload,
    created: Date.now(),
    count: items.length,
    items: items.map((x) => ({ src: x.src, ref: x.ref, url: x.url })),
  };
  saveRecords([record, ...myRecords()]);
  return { url, record, truncated: tracks.length > list.length };
}

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
  if (!data || data.v !== 1 || !Array.isArray(data.r)) throw new Error('This record link is damaged');
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
      };
    } catch {
      skin = null; // a skin that doesn't pass the checks is simply ignored
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
  return { title, noDownload, skin, tracks };
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
  async fetchBlob(track, { signal } = {}) {
    let res;
    if (track.src === 'g') {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(CONFIG.googleApiKey)}`;
      const headers = track.resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${track.fileId}/${track.resourceKey}` } : {};
      res = await fetch(url, { signal, headers });
    } else {
      res = await fetch(`https://dl.dropboxusercontent.com${track.fileId}`, { signal });
    }
    if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? 'The sender stopped sharing this song' : `Couldn't load (${res.status})`);
    return withAudioType(await res.blob(), track.fileName);
  },
};
