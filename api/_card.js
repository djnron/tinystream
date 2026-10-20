// The "card" of a shared record: the little bit of it link previews need (title, song count, skin
// colors, and where its cover picture is saved). It travels in the link's ?c= part, which servers
// see; the songs stay after the "#", which they never do. Everything here is treated as untrusted.

import { inflateRawSync } from 'node:zlib';

const HEX = /^#[0-9a-f]{3,8}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const DROPBOX_PATH = /^\/(scl\/fi|s)\/[A-Za-z0-9_./%+()~-]+(\?[A-Za-z0-9_=&%.-]*)?$/;
const COLOR_KEYS = ['bg', 'text', 'muted', 'accent', 'deck', 'title', 'titleText', 'btn', 'btnText', 'lcd', 'lcdText', 'list', 'listText'];

export function decodeCard(text) {
  try {
    if (!text || text.length > 3000) return null;
    const kind = text[0];
    let bytes = Buffer.from(text.slice(1).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (kind === 'z') bytes = inflateRawSync(bytes, { maxOutputLength: 20000 });
    else if (kind !== 'j') return null;
    const raw = JSON.parse(bytes.toString('utf8'));
    const colors = {};
    for (const k of COLOR_KEYS) if (HEX.test(raw?.c?.[k] || '')) colors[k] = raw.c[k];
    let image = null;
    const i = raw?.i;
    if (Array.isArray(i) && i[0] === 'g' && DRIVE_ID.test(i[1])) image = { kind: 'g', id: i[1], key: /^[\w-]{1,100}$/.test(i[2] || '') ? i[2] : null };
    if (Array.isArray(i) && i[0] === 'd' && DROPBOX_PATH.test(i[1])) image = { kind: 'd', path: i[1] };
    return {
      title: String(raw?.t || 'A record').slice(0, 80),
      count: Math.max(0, Math.min(9999, Number(raw?.n) || 0)),
      skin: String(raw?.s || '').slice(0, 40),
      radius: Math.max(0, Math.min(28, Number(raw?.r) || 0)),
      colors,
      image,
    };
  } catch {
    return null;
  }
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
