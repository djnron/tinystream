// Dropbox source, using OAuth 2 with PKCE (no server, no client secret) and the Dropbox HTTP API.
// Requested scopes are read-only: files.metadata.read and files.content.read.
// Create the Dropbox app with "App folder" access (see README): it can then only see
// Dropbox/Apps/<your app name>/, and paths here are relative to that folder.

import { CONFIG } from '../../config.js';
import { AuthRequiredError, base64Url, isAudio, naturalSort, randomString, stripExt, withAudioType } from '../util.js';

const ID = 'dropbox';
const TOKEN_KEY = 'mb.dropbox.token';
const PKCE_KEY = 'mb.dropbox.pkce';
const SCOPES = 'files.metadata.read files.content.read';
// Asked for only when you first share a record (tick these in the Dropbox app console too).
const SHARING_SCOPES = 'sharing.read sharing.write';
// Asked for only when someone shares a record with their own pictures (to save them in the app folder).
const PICTURE_SCOPES = 'files.content.write';

const redirectUri = () => location.origin + location.pathname;

// ---------- picked from anywhere (Dropbox Chooser) ----------
//
// The app itself only sees its app folder. To play music from elsewhere in Dropbox, you pick it in
// Dropbox's own Chooser. Dropbox hands back a share link for each pick; the app keeps those links
// in this browser only and reads the music through them (folders via the API, so subfolders work).

const PICKED_KEY = 'mb.dropbox.picked';
const CHOOSER = 'https://www.dropbox.com/static/api/2/dropins.js';
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.webm', '.aif', '.aiff', '.alac'];

function readPicked() {
  try {
    const list = JSON.parse(localStorage.getItem(PICKED_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const writePicked = (list) => localStorage.setItem(PICKED_KEY, JSON.stringify(list));

/** Loads Dropbox's Chooser script ahead of time: it has to open straight from a click. */
let chooserLoading = null;
function loadChooser() {
  if (window.Dropbox?.choose) return Promise.resolve();
  chooserLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHOOSER;
    s.id = 'dropboxjs';
    s.dataset.appKey = CONFIG.dropboxAppKey;
    s.onload = resolve;
    s.onerror = () => { chooserLoading = null; reject(new Error('Couldn’t load the Dropbox chooser. Check your connection and try again.')); };
    document.head.append(s);
  });
  return chooserLoading;
}

// Ids for picked things: "pick:<pickId>:<path inside the pick>" (the path is "" for the pick itself).
const pickId = (id, path = '') => `pick:${id}:${path}`;
function parsePick(id) {
  const m = /^pick:([\w-]+):(.*)$/.exec(id || '');
  if (!m) return null;
  const pick = readPicked().find((x) => x.id === m[1]);
  return pick ? { pick, path: m[2] } : null;
}

function readToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

function storeToken(resp, refreshToken) {
  const token = {
    access_token: resp.access_token,
    expires_at: Date.now() + (Number(resp.expires_in) - 60) * 1000,
    refresh_token: resp.refresh_token || refreshToken,
    scope: resp.scope || readToken()?.scope || SCOPES,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  return token;
}

async function tokenRequest(params) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: CONFIG.dropboxAppKey, ...params }),
  });
  if (res.status === 400 || res.status === 401) {
    throw new AuthRequiredError(ID, 'Dropbox sign-in expired');
  }
  if (!res.ok) throw new Error(`Dropbox sign-in error ${res.status}`);
  return res.json();
}

let refreshing;
async function getToken({ forceRefresh = false } = {}) {
  const t = readToken();
  if (!t) throw new AuthRequiredError(ID);
  if (!forceRefresh && t.expires_at > Date.now()) return t.access_token;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
    .then((resp) => storeToken(resp, t.refresh_token).access_token)
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** Dropbox-API-Arg header must be ASCII; escape anything else as \uXXXX. */
const headerJson = (obj) =>
  JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

async function call(url, init = {}) {
  const send = (token) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken({ forceRefresh: true }));
  if (res.status === 401) throw new AuthRequiredError(ID);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Dropbox error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
  return res;
}

/** Like rpc(), but hands back Dropbox's error details instead of throwing. */
async function rawRpc(endpoint, body) {
  const send = (token) => fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken({ forceRefresh: true }));
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { error_summary: text.slice(0, 120) }; }
  return { ok: res.ok, status: res.status, data };
}

const rpc = async (endpoint, body) =>
  (await call(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();

async function listEntries(path, recursive, limit = Infinity) {
  const entries = [];
  let data = await rpc('files/list_folder', { path, recursive, limit: 2000 });
  entries.push(...data.entries);
  while (data.has_more && entries.length < limit) {
    data = await rpc('files/list_folder/continue', { cursor: data.cursor });
    entries.push(...data.entries);
  }
  return entries;
}

function parentName(pathDisplay) {
  const parts = pathDisplay.split('/');
  return parts.length > 2 ? parts[parts.length - 2] : 'Dropbox app folder';
}

function toTrack(e) {
  return {
    id: `${ID}:${e.id}`,
    provider: ID,
    fileId: e.id,
    fileName: e.name,
    name: stripExt(e.name),
    folder: parentName(e.path_display),
    size: e.size || 0,
  };
}

const isTrack = (e) => e['.tag'] === 'file' && isAudio(e.name);

function pickTrack(pick, name, path, folder, size) {
  return {
    id: `${ID}:${pickId(pick.id, path)}`,
    provider: ID,
    fileId: pickId(pick.id, path),
    fileName: name,
    name: stripExt(name),
    folder,
    size: size || 0,
  };
}

/** Lists one folder inside a picked share link ("" is the picked folder itself). */
async function listPickEntries(pick, path) {
  const entries = [];
  let data = await rpc('files/list_folder', { path, shared_link: { url: pick.url } });
  entries.push(...data.entries);
  while (data.has_more) {
    data = await rpc('files/list_folder/continue', { cursor: data.cursor });
    entries.push(...data.entries);
  }
  return entries;
}

async function listPick(folderId, folderName) {
  const at = parsePick(folderId);
  if (!at) throw new Error('This folder was removed from Music Box');
  const { pick, path } = at;
  const entries = await listPickEntries(pick, path);
  const folders = entries.filter((e) => e['.tag'] === 'folder').sort((a, b) => naturalSort(a.name, b.name))
    .map((e) => ({ id: pickId(pick.id, `${path}/${e.name}`), name: e.name }));
  const tracks = entries.filter(isTrack).sort((a, b) => naturalSort(a.name, b.name))
    .map((e) => pickTrack(pick, e.name, `${path}/${e.name}`, folderName || pick.name, e.size));
  return { folders, tracks };
}

/** Shared links can only be listed one level at a time, so walk down (a few levels at most). */
async function listPickRecursive(folderId, folderName, limit, onProgress) {
  const at = parsePick(folderId);
  if (!at) throw new Error('This folder was removed from Music Box');
  const out = [];
  const walk = async (path, name, depth) => {
    if (out.length >= limit) return;
    const entries = await listPickEntries(at.pick, path);
    for (const e of entries.filter(isTrack).sort((a, b) => naturalSort(a.name, b.name))) {
      if (out.length >= limit) break;
      out.push(pickTrack(at.pick, e.name, `${path}/${e.name}`, name, e.size));
    }
    onProgress?.(out.length);
    if (depth >= 4) return;
    for (const f of entries.filter((e) => e['.tag'] === 'folder').sort((a, b) => naturalSort(a.name, b.name))) {
      await walk(`${path}/${f.name}`, f.name, depth + 1);
    }
  };
  await walk(at.path, folderName || at.pick.name, 0);
  return out;
}
const byPath = (a, b) => naturalSort(a.path_display, b.path_display);

export const dropbox = {
  id: ID,
  label: 'Dropbox',
  rootId: 'root',
  rootName: 'Dropbox app folder',

  isConfigured: () => Boolean(CONFIG.dropboxAppKey),
  isConnected: () => Boolean(readToken()),

  /** Leaves the page for Dropbox's consent screen; handleRedirect() finishes on return. */
  async connect({ sharing = false, pictures = false, back = location.hash } = {}) {
    const verifier = randomString(64);
    const state = randomString(16);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, back }));
    const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const params = new URLSearchParams({
      client_id: CONFIG.dropboxAppKey,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri(),
      token_access_type: 'offline', // gives a refresh token so playback isn't cut off after 4 hours
      scope: [SCOPES, sharing && SHARING_SCOPES, pictures && PICTURE_SCOPES].filter(Boolean).join(' '),
      state,
    });
    if (sharing || pictures) params.set('include_granted_scopes', 'user');
    location.assign(`https://www.dropbox.com/oauth2/authorize?${params}`);
    return new Promise(() => {}); // the page is navigating away
  },

  reconnect() {
    return this.connect();
  },

  /** True once the sharing permission has been granted (needed to make share links). */
  canShare() {
    return /\bsharing\.write\b/.test(readToken()?.scope || '');
  },

  /** True once Dropbox lets the app save files (only needed to share records with pictures). */
  canUploadPictures() {
    return /\bfiles\.content\.write\b/.test(readToken()?.scope || '');
  },

  /**
   * Saves a skin picture in the app folder ("Music Box pictures") and shares it by link, for shared
   * records. Returns { url, id }: the share link and the file's id.
   */
  async uploadPicture(blob, name) {
    const scopeError = () => Object.assign(new Error('Dropbox needs permission to save pictures'), { code: 'dropbox-picture-scope' });
    if (!this.canUploadPictures()) throw scopeError();
    let meta;
    try {
      meta = await (await call('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': headerJson({ path: `/Music Box pictures/${name}`, mode: 'overwrite', mute: true }),
        },
        body: blob,
      })).json();
    } catch (err) {
      if (/missing_scope|files\.content\.write/.test(err.message)) throw scopeError();
      throw err;
    }
    return { url: await this.shareFile(meta.id), id: meta.id };
  },

  /** Creates (or reuses) a public share link for one file and returns its URL. */
  async shareFile(fileId) {
    if (fileId.startsWith('pick:')) {
      // Picked songs already have the Chooser's link. Songs inside a picked folder don't have one of
      // their own, and the app can't make one (it can't see outside its folder).
      const at = parsePick(fileId);
      if (at && at.path === '') return at.pick.url;
      throw new Error('Songs inside a folder picked from Dropbox can’t go in a record yet. Pick the songs themselves '
        + '(“Add music from Dropbox”, then select the songs), or put the folder in the app folder.');
    }
    if (!this.canShare()) throw Object.assign(new Error('Dropbox needs permission to make share links'), { code: 'dropbox-scope' });
    const res = await rawRpc('sharing/create_shared_link_with_settings', { path: fileId });
    if (res.ok) return res.data.url;
    const tag = res.data?.error?.['.tag'];
    if (tag === 'shared_link_already_exists') {
      const existing = res.data.error.shared_link_already_exists?.metadata?.url;
      if (existing) return existing;
      const list = await rawRpc('sharing/list_shared_links', { path: fileId, direct_only: true });
      const url = list.data?.links?.[0]?.url;
      if (url) return url;
    }
    if (res.status === 401 || /missing_scope/.test(JSON.stringify(res.data))) {
      throw Object.assign(new Error('Dropbox needs permission to make share links'), { code: 'dropbox-scope' });
    }
    throw new Error(`Dropbox couldn't share a song (${res.data?.error_summary || res.status})`);
  },

  async unshareFile(url) {
    if (readPicked().some((p) => p.url === url)) return; // the Chooser's link: Music Box plays through it

    const res = await rawRpc('sharing/revoke_shared_link', { url });
    if (!res.ok && res.data?.error?.['.tag'] !== 'shared_link_not_found') {
      throw new Error(`Dropbox error ${res.data?.error_summary || res.status}`);
    }
  },

  emptyHint(folderId) {
    return folderId === 'root'
      ? 'Press “Add music from Dropbox” to pick songs or folders from anywhere in your Dropbox. (Music in Dropbox → Apps → your app’s folder shows here too.)'
      : 'No folders or audio files in this folder.';
  },

  /** Extra buttons on the Dropbox browse screen. */
  actions(folderId) {
    if (!this.isConnected()) return [];
    loadChooser().catch(() => {}); // ready before the click
    if (folderId === 'root') return [{ label: '＋ Add music from Dropbox', primary: true, run: () => this.addMusic() }];
    const at = parsePick(folderId);
    if (at && at.path === '') return [{ label: 'Remove from Music Box', run: () => this.removePick(at.pick.id) }];
    return [];
  },

  /** True once Dropbox lets the app read the share links the Chooser makes. */
  canReadPicks() {
    return /\bsharing\.read\b/.test(readToken()?.scope || '');
  },

  /**
   * Opens Dropbox's Chooser to pick songs or folders from anywhere in Dropbox. Reading them needs
   * the sharing permission (the same one sharing records uses), asked for once.
   */
  async addMusic() {
    if (!this.canReadPicks()) {
      throw Object.assign(new Error('Dropbox needs one more permission to play music picked from anywhere'), { code: 'dropbox-scope' });
    }
    if (!window.Dropbox?.choose) await loadChooser(); // normally already loaded
    const files = await new Promise((resolve) => {
      window.Dropbox.choose({
        success: resolve,
        cancel: () => resolve([]),
        linkType: 'preview', // a lasting link (direct links stop working after 4 hours)
        multiselect: true,
        folderselect: true,
        extensions: AUDIO_EXTS,
      });
    });
    if (!files.length) return null;
    const list = readPicked();
    const have = new Set(list.map((x) => x.url));
    let added = 0;
    for (const f of files) {
      if (!/^https:\/\/www\.dropbox\.com\//.test(f.link || '') || have.has(f.link)) continue;
      list.push({ id: `p${Date.now().toString(36)}${added}`, name: String(f.name || 'Dropbox').slice(0, 200), url: f.link, isDir: Boolean(f.isDir), size: Number(f.bytes) || 0 });
      have.add(f.link);
      added++;
    }
    writePicked(list);
    return added ? `Added ${added} from Dropbox` : 'Those are already in Music Box';
  },

  removePick(id) {
    writePicked(readPicked().filter((x) => x.id !== id));
    return { goUp: true, message: 'Removed from Music Box (it’s still in your Dropbox)' };
  },

  /** Returns true if this page load was the return from Dropbox's consent screen. */
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    const pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    if (!pending || !q.has('state') || q.get('state') !== pending.state) return false;
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', redirectUri() + (pending.back || '#/'));
    if (q.has('error')) throw new Error(q.get('error_description') || 'Dropbox access was not granted');
    const resp = await tokenRequest({
      grant_type: 'authorization_code',
      code: q.get('code'),
      code_verifier: pending.verifier,
      redirect_uri: redirectUri(),
    });
    storeToken(resp);
    return true;
  },

  async disconnect() {
    const t = readToken();
    localStorage.removeItem(TOKEN_KEY);
    if (t?.access_token) {
      fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t.access_token}` },
      }).catch(() => {});
    }
  },

  async list(folderId, folderName) {
    if (folderId.startsWith('pick:')) return listPick(folderId, folderName);
    const path = folderId === 'root' ? '' : folderId;
    const entries = await listEntries(path, false);
    const folders = entries
      .filter((e) => e['.tag'] === 'folder')
      .sort((a, b) => naturalSort(a.name, b.name))
      .map((e) => ({ id: e.path_lower, name: e.name }));
    const tracks = entries.filter(isTrack).sort(byPath).map((e) => ({ ...toTrack(e), folder: folderName || this.rootName }));
    if (folderId === 'root') {
      // Things picked from elsewhere in Dropbox sit alongside the app folder's own.
      for (const p of readPicked()) {
        if (p.isDir) folders.push({ id: pickId(p.id), name: p.name, sub: 'Picked from your Dropbox' });
        else tracks.push(pickTrack(p, p.name, '', folderName || this.rootName, p.size));
      }
    }
    return { folders, tracks };
  },

  async listRecursive(folderId, folderName, { limit = 5000, onProgress } = {}) {
    if (folderId.startsWith('pick:')) return listPickRecursive(folderId, folderName, limit, onProgress);
    const path = folderId === 'root' ? '' : folderId;
    const entries = await listEntries(path, true, limit * 2);
    const tracks = entries.filter(isTrack).sort(byPath).map(toTrack).slice(0, limit);
    onProgress?.(tracks.length);
    return tracks;
  },

  async fetchBlob(track, { signal } = {}) {
    if (track.fileId.startsWith('pick:')) {
      const at = parsePick(track.fileId);
      if (!at) throw new Error('This song was removed from Music Box');
      const arg = at.path ? { url: at.pick.url, path: at.path } : { url: at.pick.url };
      const res = await call('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
        method: 'POST',
        headers: { 'Dropbox-API-Arg': headerJson(arg) },
        signal,
      });
      return withAudioType(await res.blob(), track.fileName);
    }
    const res = await call('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': headerJson({ path: track.fileId }) },
      signal,
    });
    return withAudioType(await res.blob(), track.fileName);
  },
};
