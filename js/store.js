// Settings (localStorage) and on-device music storage (IndexedDB).
//
// Nothing is written to IndexedDB unless the user has turned on "Allow downloads".
// Turning it off stops all new writes; the user chooses whether to also wipe what's there.

const SETTINGS_KEY = 'mb.settings';
const DEFAULTS = {
  allowDownloads: false, // master switch: may this app store music on the device at all?
  saveOnPlay: false, // when allowed, keep a copy of every track as it plays
  visMode: 'off', // 'off' | 'bars' | 'scope' — off by default, see visualizer.js
  timeMode: 'elapsed', // 'elapsed' | 'remaining'
  skin: 'deck98',
  customSkin: null, // a skin loaded from a file, see skins.js
  repeat: 'all', // 'off' | 'all' | 'one'
  shuffle: false,
  volume: 1,
};

export const events = new EventTarget();
const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.visualizer === true && !saved.visMode) saved.visMode = 'bars'; // from v1
    delete saved.visualizer;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = loadSettings();

export function setSetting(key, value) {
  settings[key] = value;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* storage full or blocked: keep the in-memory value */ }
  emit('settings', { key, value });
}

// ---------- IndexedDB ----------

const DB_NAME = 'music-box';
const DB_VERSION = 3;
let dbPromise;

let blocked = null; // the error while an older copy of the app holds the database open
export const isBlocked = () => Boolean(blocked);

function openDb() {
  if (blocked) return Promise.reject(blocked);
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const add = (name, opts) => db.objectStoreNames.contains(name) || db.createObjectStore(name, opts);
      add('tracks', { keyPath: 'id' }); // metadata of saved tracks
      add('blobs'); // audio data, keyed by track id
      add('listings'); // folder listings, for browsing offline
      add('handles'); // the local music folder the user picked (a pointer, not music)
      add('pictures'); // pictures the user added to their own skins (Skin Studio)
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app opened in another tab or window: step aside so it can upgrade.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      if (blocked) {
        // The other copy closed and the upgrade went through: use the database from now on.
        blocked = null;
        dbPromise = Promise.resolve(db);
        emit('db-ready', {});
      }
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    // An older copy of the app (another tab, or the home-screen app) is holding the database open,
    // so it can't be upgraded until that copy closes. Say so instead of waiting forever. The request
    // stays queued and finishes by itself once the other copy closes (see onsuccess).
    req.onblocked = () => {
      blocked = new Error('Music Box is open in another tab or window (or the home-screen app). Close the others, then try again.');
      reject(blocked);
    };
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

/** Ids of tracks stored on the device, kept in memory for quick "saved" badges. */
export const savedIds = new Set();

export async function init() {
  try {
    const keys = await run('tracks', 'readonly', (t) => t.objectStore('tracks').getAllKeys());
    keys.forEach((k) => savedIds.add(k));
  } catch (err) {
    console.warn('IndexedDB unavailable', err);
  }
}

export async function saveTrack(track, blob) {
  if (!settings.allowDownloads) throw new Error('Turn on “Save songs on this device” in Settings first');
  const meta = { ...track, size: blob.size, savedAt: Date.now() };
  await run(['tracks', 'blobs'], 'readwrite', (t) => {
    t.objectStore('tracks').put(meta);
    t.objectStore('blobs').put(blob, track.id);
  });
  savedIds.add(track.id);
  emit('saved', { id: track.id });
}

export async function getBlob(id) {
  if (!savedIds.has(id)) return null;
  return run('blobs', 'readonly', (t) => t.objectStore('blobs').get(id));
}

export async function listSaved() {
  return run('tracks', 'readonly', (t) => t.objectStore('tracks').getAll());
}

export async function deleteTrack(id) {
  await run(['tracks', 'blobs'], 'readwrite', (t) => {
    t.objectStore('tracks').delete(id);
    t.objectStore('blobs').delete(id);
  });
  savedIds.delete(id);
  emit('saved', { id });
}

export async function clearAll() {
  await run(['tracks', 'blobs', 'listings'], 'readwrite', (t) => {
    t.objectStore('tracks').clear();
    t.objectStore('blobs').clear();
    t.objectStore('listings').clear();
  });
  savedIds.clear();
  emit('saved', {});
}

export async function putListing(key, listing) {
  if (!settings.allowDownloads) return;
  await run('listings', 'readwrite', (t) => t.objectStore('listings').put({ ...listing, at: Date.now() }, key));
}

export async function getListing(key) {
  try {
    return await run('listings', 'readonly', (t) => t.objectStore('listings').get(key));
  } catch {
    return null;
  }
}

/** The picked local folder handle. Not music data, so it's kept even when downloads are off. */
export async function putHandle(key, handle) {
  await run('handles', 'readwrite', (t) => t.objectStore('handles').put(handle, key));
}

export async function getHandle(key) {
  try {
    return await run('handles', 'readonly', (t) => t.objectStore('handles').get(key));
  } catch {
    return null;
  }
}

export async function deleteHandle(key) {
  await run('handles', 'readwrite', (t) => t.objectStore('handles').delete(key));
}

/** Pictures for the user's own skins. Small, theirs, and not music, so kept even when downloads are off. */
// Stored as plain bytes plus a type: some Safari versions can't keep Blobs in IndexedDB.
const memoryPictures = new Map(); // fallback when IndexedDB isn't available (some private modes)

export async function putPicture(id, blob) {
  const record = { type: blob.type, data: await blob.arrayBuffer() };
  try {
    await run('pictures', 'readwrite', (t) => t.objectStore('pictures').put(record, id));
  } catch (err) {
    if (err === blocked || /open in another tab/.test(err.message)) throw err;
    memoryPictures.set(id, blob);
    emit('picture-memory', { id });
  }
}

export async function getPicture(id) {
  if (memoryPictures.has(id)) return memoryPictures.get(id);
  try {
    const v = await run('pictures', 'readonly', (t) => t.objectStore('pictures').get(id));
    if (!v) return null;
    return v instanceof Blob ? v : new Blob([v.data], { type: v.type || 'image/png' });
  } catch {
    return null;
  }
}

export async function deletePicture(id) {
  memoryPictures.delete(id);
  await run('pictures', 'readwrite', (t) => t.objectStore('pictures').delete(id));
}

export async function storageInfo() {
  const est = (await navigator.storage?.estimate?.()) || {};
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { usage: est.usage || 0, quota: est.quota || 0, persisted };
}
