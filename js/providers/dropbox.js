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
    const res = await rawRpc('sharing/revoke_shared_link', { url });
    if (!res.ok && res.data?.error?.['.tag'] !== 'shared_link_not_found') {
      throw new Error(`Dropbox error ${res.data?.error_summary || res.status}`);
    }
  },

  emptyHint(folderId) {
    return folderId === 'root'
      ? 'Music Box can only see its own app folder. Put music in Dropbox → Apps → (your Dropbox app’s name), then come back.'
      : 'No folders or audio files in this folder.';
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
    const path = folderId === 'root' ? '' : folderId;
    const entries = await listEntries(path, false);
    const folders = entries
      .filter((e) => e['.tag'] === 'folder')
      .sort((a, b) => naturalSort(a.name, b.name))
      .map((e) => ({ id: e.path_lower, name: e.name }));
    const tracks = entries.filter(isTrack).sort(byPath).map((e) => ({ ...toTrack(e), folder: folderName || this.rootName }));
    return { folders, tracks };
  },

  async listRecursive(folderId, _folderName, { limit = 5000, onProgress } = {}) {
    const path = folderId === 'root' ? '' : folderId;
    const entries = await listEntries(path, true, limit * 2);
    const tracks = entries.filter(isTrack).sort(byPath).map(toTrack).slice(0, limit);
    onProgress?.(tracks.length);
    return tracks;
  },

  async fetchBlob(track, { signal } = {}) {
    const res = await call('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': headerJson({ path: track.fileId }) },
      signal,
    });
    return withAudioType(await res.blob(), track.fileName);
  },
};
