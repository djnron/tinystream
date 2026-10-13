// Small shared helpers: errors, formatting, file-type detection, DOM building.

/** Thrown when a provider needs the user to sign in (again) before it can continue. */
export class AuthRequiredError extends Error {
  constructor(providerId, message = 'Sign-in required') {
    super(message);
    this.name = 'AuthRequiredError';
    this.providerId = providerId;
  }
}

const AUDIO_TYPES = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
};

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function isAudio(name, mimeType = '') {
  return mimeType.startsWith('audio/') || extOf(name) in AUDIO_TYPES;
}

export function mimeFromName(name) {
  return AUDIO_TYPES[extOf(name)] || '';
}

/** Some providers return application/octet-stream; Safari won't play that, so retype it. */
export function withAudioType(blob, fileName) {
  if (blob.type.startsWith('audio/')) return blob;
  const type = mimeFromName(fileName);
  return type ? new Blob([blob], { type }) : blob;
}

export function stripExt(name) {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '');
}

export const naturalSort = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Stable hue from a string, used for placeholder artwork colors. */
export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Tiny hyperscript: h('button', { class: 'x', onclick }, 'Label', childNode)
 * Props starting with "on" become listeners; `html` sets innerHTML (trusted strings only).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function toast(message, { timeout = 3500, action } = {}) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  if (action) {
    t.append(h('button', { class: 'link', onclick: () => { action.run(); t.remove(); } }, action.label));
  }
  box.append(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
  return t;
}

export function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isNetworkError(err) {
  return err instanceof TypeError || !navigator.onLine;
}
