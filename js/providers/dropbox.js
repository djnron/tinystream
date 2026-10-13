// Dropbox source, using OAuth 2 with PKCE (no server, no client secret) and the Dropbox HTTP API.
// Requested scopes are read-only: files.metadata.read and files.content.read.

import { CONFIG } from '../../config.js';
import { AuthRequiredError, base64Url, isAudio, naturalSort, randomString, stripExt, withAudioType } from '../util.js';

const ID = 'dropbox';
const TOKEN_KEY = 'mb.dropbox.token';
const PKCE_KEY = 'mb.dropbox.pkce';
const SCOPES = 'files.metadata.read files.content.read';

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
  return parts.length > 2 ? parts[parts.length - 2] : 'Dropbox';
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
  rootName: 'Dropbox',

  isConfigured: () => Boolean(CONFIG.dropboxAppKey),
  isConnected: () => Boolean(readToken()),

  /** Leaves the page for Dropbox's consent screen; handleRedirect() finishes on return. */
  async connect() {
    const verifier = randomString(64);
    const state = randomString(16);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, back: location.hash }));
    const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const params = new URLSearchParams({
      client_id: CONFIG.dropboxAppKey,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri(),
      token_access_type: 'offline', // gives a refresh token so playback isn't cut off after 4 hours
      scope: SCOPES,
      state,
    });
    location.assign(`https://www.dropbox.com/oauth2/authorize?${params}`);
    return new Promise(() => {}); // the page is navigating away
  },

  reconnect() {
    return this.connect();
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
    const tracks = entries.filter(isTrack).sort(byPath).map((e) => ({ ...toTrack(e), folder: folderName || 'Dropbox' }));
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
