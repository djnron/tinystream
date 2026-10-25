// Google Drive source with the narrowest permission Google offers: `drive.file`. The app can only
// open files you pick in Google's own Picker window, never the rest of your Drive.
//
// Picked songs are kept as named "collections" (just their ids and names, in this browser), which
// show up like folders under Google Drive. Picking a folder adds the songs inside it when Google
// shares them; if it doesn't, you're asked to open the folder and select the songs instead.

import { CONFIG } from '../../config.js';
import { AuthRequiredError, isAudio, naturalSort, stripExt, withAudioType } from '../util.js';

const ID = 'gdrive';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const TOKEN_KEY = 'mb.gdrive.token';
const LIBRARY_KEY = 'mb.gdrive.library';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// ---------- scripts ----------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn’t reach ${new URL(src).hostname}. Check your connection and try again.`));
    document.head.append(s);
  });
}

let gisPromise;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= loadScript('https://accounts.google.com/gsi/client').catch((e) => { gisPromise = null; throw e; });
  return gisPromise;
}

let pickerPromise;
function loadPicker() {
  if (window.google?.picker) return Promise.resolve();
  pickerPromise ??= loadScript('https://apis.google.com/js/api.js')
    .then(() => new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject })))
    .catch((e) => { pickerPromise = null; throw e instanceof Error ? e : new Error('Couldn’t open Google’s file picker. Check your connection and try again.'); });
  return pickerPromise;
}

// ---------- sign-in ----------

function readToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

/** Opens Google's consent popup (prompt 'consent') or tries a silent renewal (prompt ''). */
async function requestToken(prompt) {
  if (!navigator.onLine) throw new TypeError('Offline');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new AuthRequiredError(ID, resp.error_description || resp.error));
        const token = {
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in) - 60) * 1000,
          scope: SCOPE,
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve(token.access_token);
      },
      // Popup blocked/closed: the user has to press "Reconnect" (a real click) to continue.
      error_callback: (err) => reject(new AuthRequiredError(ID, err?.message || 'Google sign-in didn’t finish. Try again.')),
    });
    client.requestAccessToken({ prompt });
  });
}

let renewing;
async function getToken({ forceRenew = false } = {}) {
  const t = readToken();
  if (!t) throw new AuthRequiredError(ID);
  if (!forceRenew && t.expires_at > Date.now() && t.scope === SCOPE) return t.access_token;
  renewing ??= requestToken('').finally(() => { renewing = null; });
  return renewing;
}

async function authedRequest(url, init = {}) {
  const send = (token) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken({ forceRenew: true }));
  if (res.status === 401) throw new AuthRequiredError(ID);
  return res;
}

async function authedFetch(url, { signal } = {}) {
  const res = await authedRequest(url, { signal });
  if (res.status === 404 || res.status === 403) {
    throw new Error('Music Box can’t open this song any more. Add it again with “＋ Add music from Google Drive”.');
  }
  if (!res.ok) throw new Error(`Google Drive had a problem (error ${res.status}). Try again in a moment.`);
  return res;
}

const PICTURE_FOLDER = 'mb.gdrive.pictureFolder';

/** The Drive folder for shared skin pictures, made the first time it's needed. */
async function pictureFolder() {
  const known = localStorage.getItem(PICTURE_FOLDER);
  if (known) {
    const res = await authedRequest(`${API}/files/${encodeURIComponent(known)}?fields=id,trashed`);
    if (res.ok && !(await res.json()).trashed) return known;
  }
  const res = await authedRequest(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Music Box pictures', mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw new Error(`Google Drive couldn’t make a folder for your pictures (error ${res.status}). Try again.`);
  const { id } = await res.json();
  localStorage.setItem(PICTURE_FOLDER, id);
  return id;
}

// ---------- the library of picked songs ----------

function readLibrary() {
  try {
    const lib = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    return Array.isArray(lib?.collections) ? lib : { collections: [] };
  } catch {
    return { collections: [] };
  }
}

function writeLibrary(lib) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

function toTrack(f, folderName) {
  return {
    id: `${ID}:${f.fileId}`,
    provider: ID,
    fileId: f.fileId,
    fileName: f.fileName,
    name: stripExt(f.fileName),
    folder: folderName || '',
    size: f.size || 0,
  };
}

/** Lists the audio files in a picked folder (and its subfolders), if Google shares them. */
async function listPickedFolder(folderId, depth = 0) {
  const out = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await (await authedFetch(`${API}/files?${params}`)).json();
    for (const f of data.files || []) {
      if (f.mimeType === FOLDER_MIME && depth < 4) out.push(...await listPickedFolder(f.id, depth + 1));
      else if (isAudio(f.name, f.mimeType)) out.push({ fileId: f.id, fileName: f.name, size: Number(f.size) || 0 });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

const today = () => new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const gdrive = {
  id: ID,
  label: 'Google Drive',
  rootId: 'root',
  rootName: 'Google Drive',

  isConfigured: () => Boolean(CONFIG.googleClientId && CONFIG.googleApiKey && CONFIG.googleAppId),
  isConnected: () => Boolean(readToken()),

  async connect() {
    await requestToken('consent');
  },

  /** Re-auth after expiry; must be called from a click so the popup isn't blocked. */
  async reconnect() {
    await requestToken('');
  },

  /**
   * Google browser tokens last one hour and can only be renewed from a click without the popup
   * being blocked. The UI calls this on every click so long listening sessions keep going.
   */
  keepAlive() {
    const t = readToken();
    if (t && t.expires_at - Date.now() < 15 * 60 * 1000 && navigator.onLine) {
      if (!renewing) {
        renewing = requestToken('').finally(() => { renewing = null; });
        renewing.catch(() => {}); // failures surface later as AuthRequiredError where it matters
      }
    }
  },

  async disconnect() {
    const t = readToken();
    localStorage.removeItem(TOKEN_KEY);
    if (t?.access_token) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.access_token)}`, {
        method: 'POST',
      }).catch(() => {});
    }
  },

  /** Root lists your collections; a collection lists its songs. */
  async list(folderId) {
    const { collections } = readLibrary();
    if (folderId === 'root') {
      return {
        folders: collections.map((c) => ({ id: c.id, name: c.name })),
        tracks: [],
      };
    }
    const c = collections.find((x) => x.id === folderId);
    if (!c) throw new Error('That folder was removed from Music Box');
    return { folders: [], tracks: c.tracks.map((f) => toTrack(f, c.name)) };
  },

  async listRecursive(folderId) {
    const { collections } = readLibrary();
    const chosen = folderId === 'root' ? collections : collections.filter((c) => c.id === folderId);
    return chosen.flatMap((c) => c.tracks.map((f) => toTrack(f, c.name)));
  },

  /** Where to stream a song from. Drive needs the sign-in as a header, so the player streams it via the service worker. */
  async streamUrl(track) {
    const token = await getToken();
    return {
      url: `${API}/files/${encodeURIComponent(track.fileId)}?alt=media&supportsAllDrives=true`,
      headers: { Authorization: `Bearer ${token}` },
      ttl: 40 * 60e3, // sign-ins last an hour
    };
  },

  async fetchBlob(track, { signal } = {}) {
    const url = `${API}/files/${encodeURIComponent(track.fileId)}?alt=media&supportsAllDrives=true`;
    const res = await authedFetch(url, { signal });
    return withAudioType(await res.blob(), track.fileName);
  },

  /**
   * Makes one picked file viewable by anyone with the link (for shared records). Returns the file's
   * resource key if it has one; older link-shared files need it to be opened.
   */
  async shareFile(fileId) {
    const res = await authedRequest(`${API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const reason = err?.error?.errors?.[0]?.reason || '';
      if (/publishOutNotPermitted|sharingRateLimit|cannotShare|domainPolicy|teamDrivesSharing/i.test(reason) || res.status === 403) {
        throw new Error('Google Drive won\'t share this song by link. Your organization may block sharing outside it '
          + '(Google Admin → Apps → Drive → Sharing settings).');
      }
      throw new Error(`Google Drive couldn’t share a song (error ${res.status}). Try again.`);
    }
    const meta = await (await authedRequest(`${API}/files/${encodeURIComponent(fileId)}?fields=resourceKey&supportsAllDrives=true`)).json().catch(() => ({}));
    return meta.resourceKey || null;
  },

  /**
   * Saves a skin picture to the user's Drive (in a "Music Box pictures" folder the app makes) and
   * shares it by link, for shared records. drive.file allows this: the app only sees files it made.
   * Returns { ref, key } (the file id and its resource key, if any).
   */
  async uploadPicture(blob, name) {
    const folder = await pictureFolder();
    const meta = { name, mimeType: blob.type || 'image/webp', parents: [folder] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', blob);
    const res = await authedRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
    if (res.status === 404) { localStorage.removeItem(PICTURE_FOLDER); }
    if (!res.ok) throw new Error(`Google Drive couldn’t save a picture (error ${res.status}). Try again.`);
    const { id } = await res.json();
    return { ref: id, key: await this.shareFile(id) };
  },

  /** Turns "anyone with the link" back off for one file. */
  async unshareFile(fileId) {
    const res = await authedRequest(`${API}/files/${encodeURIComponent(fileId)}/permissions/anyoneWithLink?supportsAllDrives=true`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Google Drive couldn’t stop sharing (error ${res.status}). Try again.`);
  },

  /** Extra buttons the browse screen shows for this source. */
  actions(folderId) {
    if (folderId === 'root') return [{ label: '＋ Add music from Google Drive', primary: true, run: () => this.addMusic() }];
    return [
      { label: '＋ Add more', run: () => this.addMusic(folderId) },
      { label: 'Rename', run: () => this.rename(folderId) },
      { label: 'Remove from Music Box', run: () => this.remove(folderId) },
    ];
  },

  emptyHint(folderId) {
    return folderId === 'root'
      ? 'Music Box only sees songs you choose. Press “＋ Add music from Google Drive” to pick songs or a folder.'
      : 'No songs here yet. Press “＋ Add more” to add some.';
  },

  /**
   * Opens Google's Picker. Returns a message describing what was added. Pass a collection id to
   * add to it; otherwise a new collection is made (named after the folder, if one was picked).
   */
  async addMusic(intoId = null) {
    const t = readToken();
    const token = t && t.expires_at > Date.now() && t.scope === SCOPE ? t.access_token : await requestToken(t ? '' : 'consent');
    await loadPicker();
    const docs = await new Promise((resolve) => {
      const P = google.picker;
      const view = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true).setParent('root');
      new P.PickerBuilder()
        .setAppId(CONFIG.googleAppId)
        .setDeveloperKey(CONFIG.googleApiKey)
        .setOAuthToken(token)
        .addView(view)
        .enableFeature(P.Feature.MULTISELECT_ENABLED)
        .setTitle('Choose songs or a folder for Music Box')
        .setCallback((data) => {
          if (data.action === P.Action.PICKED) resolve(data.docs || []);
          else if (data.action === P.Action.CANCEL) resolve([]);
        })
        .build()
        .setVisible(true);
    });
    if (!docs.length) return null;

    const added = [];
    const folderNames = [];
    let emptyFolders = 0;
    for (const d of docs) {
      if (d.mimeType === FOLDER_MIME) {
        folderNames.push(d.name);
        const inside = await listPickedFolder(d.id).catch(() => []);
        if (inside.length) added.push(...inside);
        else emptyFolders++;
      } else if (isAudio(d.name, d.mimeType)) {
        added.push({ fileId: d.id, fileName: d.name, size: Number(d.sizeBytes) || 0 });
      }
    }

    const lib = readLibrary();
    if (added.length) {
      let c = intoId && lib.collections.find((x) => x.id === intoId);
      if (!c) {
        c = { id: `c${Date.now().toString(36)}`, name: folderNames[0] || `Picked songs · ${today()}`, tracks: [] };
        lib.collections.push(c);
      }
      const have = new Set(c.tracks.map((x) => x.fileId));
      for (const f of added) if (!have.has(f.fileId)) { c.tracks.push(f); have.add(f.fileId); }
      c.tracks.sort((a, b) => naturalSort(a.fileName, b.fileName));
      writeLibrary(lib);
    }
    let msg = added.length ? `Added ${added.length} song${added.length === 1 ? '' : 's'}` : 'No songs were added';
    if (emptyFolders) {
      msg += `. Google didn’t include the songs inside ${emptyFolders === 1 ? 'that folder' : 'those folders'}. `
        + 'Open the folder in the picker and select the songs themselves (Shift+click selects several).';
    }
    return msg;
  },

  rename(id) {
    const lib = readLibrary();
    const c = lib.collections.find((x) => x.id === id);
    const name = c && prompt('Name this folder', c.name);
    if (!name?.trim()) return null;
    c.name = name.trim().slice(0, 60);
    writeLibrary(lib);
    return { message: `Renamed to “${c.name}”`, newName: c.name };
  },

  remove(id) {
    const lib = readLibrary();
    const c = lib.collections.find((x) => x.id === id);
    if (!c || !confirm(`Remove “${c.name}” from Music Box? Your files stay in Google Drive.`)) return null;
    lib.collections = lib.collections.filter((x) => x.id !== id);
    writeLibrary(lib);
    return { message: `Removed “${c.name}”`, goUp: true };
  },
};
