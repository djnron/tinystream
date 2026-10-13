// Google Drive source, using Google Identity Services (browser token flow) and the Drive v3 REST API.
// Scope is read-only: the app can never change or delete anything in your Drive.

import { CONFIG } from '../../config.js';
import { AuthRequiredError, isAudio, naturalSort, stripExt, withAudioType } from '../util.js';

const ID = 'gdrive';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const TOKEN_KEY = 'mb.gdrive.token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let gisPromise;
function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in')); };
    document.head.append(s);
  });
  return gisPromise;
}

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
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve(token.access_token);
      },
      // Popup blocked/closed: the user has to press "Reconnect" (a real click) to continue.
      error_callback: (err) => reject(new AuthRequiredError(ID, err?.message || 'Google sign-in was interrupted')),
    });
    client.requestAccessToken({ prompt });
  });
}

let renewing;
async function getToken({ forceRenew = false } = {}) {
  const t = readToken();
  if (!t) throw new AuthRequiredError(ID);
  if (!forceRenew && t.expires_at > Date.now()) return t.access_token;
  renewing ??= requestToken('').finally(() => { renewing = null; });
  return renewing;
}

async function authedFetch(url, { signal } = {}) {
  let token = await getToken();
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (res.status === 401) {
    token = await getToken({ forceRenew: true });
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  }
  if (res.status === 401) throw new AuthRequiredError(ID);
  if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
  return res;
}

function toTrack(f, folderName) {
  return {
    id: `${ID}:${f.id}`,
    provider: ID,
    fileId: f.id,
    fileName: f.name,
    name: stripExt(f.name),
    folder: folderName || '',
    size: Number(f.size) || 0,
  };
}

async function listRaw(folderId) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      orderBy: 'folder,name_natural',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await (await authedFetch(`${API}/files?${params}`)).json();
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

export const gdrive = {
  id: ID,
  label: 'Google Drive',
  rootId: 'root',
  rootName: 'My Drive',

  isConfigured: () => Boolean(CONFIG.googleClientId),
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

  async list(folderId, folderName) {
    const files = await listRaw(folderId);
    const folders = files
      .filter((f) => f.mimeType === FOLDER_MIME)
      .map((f) => ({ id: f.id, name: f.name }));
    const tracks = files
      .filter((f) => f.mimeType !== FOLDER_MIME && isAudio(f.name, f.mimeType))
      .map((f) => toTrack(f, folderName))
      .sort((a, b) => naturalSort(a.fileName, b.fileName));
    return { folders, tracks };
  },

  /** Every track below a folder (breadth-first), for "play everything here". */
  async listRecursive(folderId, folderName, { limit = 5000, onProgress } = {}) {
    const out = [];
    const queue = [{ id: folderId, name: folderName }];
    while (queue.length && out.length < limit) {
      const dir = queue.shift();
      const { folders, tracks } = await this.list(dir.id, dir.name);
      out.push(...tracks);
      queue.push(...folders);
      onProgress?.(out.length);
    }
    return out.slice(0, limit);
  },

  async fetchBlob(track, { signal } = {}) {
    const url = `${API}/files/${encodeURIComponent(track.fileId)}?alt=media&supportsAllDrives=true`;
    const res = await authedFetch(url, { signal });
    return withAudioType(await res.blob(), track.fileName);
  },
};
