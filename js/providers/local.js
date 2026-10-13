// A music folder on this device. No account or key needed, and the files never leave the device.
//
// Chrome and Edge (File System Access API): the picked folder is remembered across visits; the
// browser may ask once per visit to allow reading it again. Other browsers: the folder is read
// through a folder <input> and is remembered until the page is closed.

import * as store from '../store.js';
import { AuthRequiredError, isAudio, naturalSort, stripExt, withAudioType } from '../util.js';

const ID = 'local';
const HANDLE_KEY = 'local-root';
const canPersist = 'showDirectoryPicker' in window;

let root = null; // FileSystemDirectoryHandle (Chrome/Edge)
let memory = null; // { name, files: Map<path, File> } (other browsers)
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  if (canPersist) root = (await store.getHandle(HANDLE_KEY)) || null;
}

async function ensurePermission() {
  if (!root) throw new AuthRequiredError(ID, 'Choose a music folder first');
  if ((await root.queryPermission({ mode: 'read' })) === 'granted') return;
  // Needs a recent click; the "Reconnect" button provides one if this is refused.
  if ((await root.requestPermission({ mode: 'read' }).catch(() => 'denied')) !== 'granted') {
    throw new AuthRequiredError(ID, 'Allow Music Box to read your music folder');
  }
}

/** Folder ids are paths relative to the chosen folder; '' (shown as 'root') is the folder itself. */
const rel = (folderId) => (folderId === 'root' ? '' : folderId);
const join = (a, b) => (a ? `${a}/${b}` : b);

function toTrack(path, name, size, folder) {
  return { id: `${ID}:${path}`, provider: ID, fileId: path, fileName: name, name: stripExt(name), folder, size };
}

async function dirAt(path) {
  let dir = root;
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);
  return dir;
}

function pickWithInput() {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
    input.webkitdirectory = true;
    input.addEventListener('change', () => {
      const files = [...input.files];
      if (!files.length) return reject(new Error('No folder chosen'));
      const name = files[0].webkitRelativePath.split('/')[0];
      // Paths without the top folder name, so they line up with the handle-based paths.
      const map = new Map(files.filter((f) => isAudio(f.name, f.type))
        .map((f) => [f.webkitRelativePath.split('/').slice(1).join('/'), f]));
      resolve({ name, files: map });
    });
    input.addEventListener('cancel', () => reject(new Error('No folder chosen')));
    input.click();
  });
}

export const local = {
  id: ID,
  label: 'Folder on this device',
  rootId: 'root',
  get rootName() { return root?.name || memory?.name || 'My music'; },

  isConfigured: () => true,
  isConnected: () => Boolean(root || memory),
  init: load,

  /** Opens the folder picker. Calling it again changes the folder. */
  async connect() {
    if (canPersist) {
      root = await window.showDirectoryPicker({ id: 'music-box', mode: 'read' });
      memory = null;
      await store.putHandle(HANDLE_KEY, root).catch(() => {});
    } else {
      memory = await pickWithInput();
      root = null;
    }
  },

  async reconnect() {
    if (root) return ensurePermission();
    return this.connect();
  },

  async disconnect() {
    root = null;
    memory = null;
    await store.deleteHandle(HANDLE_KEY).catch(() => {});
  },

  async list(folderId, folderName) {
    const path = rel(folderId);
    const folders = [];
    const tracks = [];
    if (root) {
      await ensurePermission();
      for await (const entry of (await dirAt(path)).values()) {
        if (entry.kind === 'directory') folders.push({ id: join(path, entry.name), name: entry.name });
        else if (isAudio(entry.name)) {
          const file = await entry.getFile();
          tracks.push(toTrack(join(path, entry.name), entry.name, file.size, folderName || this.rootName));
        }
      }
    } else if (memory) {
      const seen = new Set();
      const prefix = path ? `${path}/` : '';
      for (const [p, file] of memory.files) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length).split('/');
        if (rest.length > 1) {
          if (!seen.has(rest[0])) { seen.add(rest[0]); folders.push({ id: prefix + rest[0], name: rest[0] }); }
        } else tracks.push(toTrack(p, file.name, file.size, folderName || this.rootName));
      }
    } else throw new AuthRequiredError(ID, 'Choose a music folder first');
    folders.sort((a, b) => naturalSort(a.name, b.name));
    tracks.sort((a, b) => naturalSort(a.fileName, b.fileName));
    return { folders, tracks };
  },

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

  async fetchBlob(track) {
    let file;
    if (root) {
      await ensurePermission();
      const parts = track.fileId.split('/');
      const name = parts.pop();
      file = await (await (await dirAt(parts.join('/'))).getFileHandle(name)).getFile();
    } else {
      file = memory?.files.get(track.fileId);
      if (!file) throw new AuthRequiredError(ID, 'Choose your music folder again');
    }
    return withAudioType(file, track.fileName);
  },
};
