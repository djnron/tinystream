// The picture for a shared record's link preview (1200 × 630). Normally it's the snapshot of the
// player the sender's app made and saved next to the songs; if there isn't one (or it can't be
// fetched), a simple version of the player is drawn here in the skin's colors.

import { ImageResponse } from '@vercel/og';
import { CONFIG } from '../config.js';
import { decodeCard } from './_card.js';

const CACHE = 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=604800';

async function savedCover(image, origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    let res;
    if (image.kind === 'g') {
      const headers = { Referer: `${origin}/` }; // the API key only works from the site's own address
      if (image.key) headers['X-Goog-Drive-Resource-Keys'] = `${image.id}/${image.key}`;
      res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(image.id)}?alt=media&key=${encodeURIComponent(CONFIG.googleApiKey)}`, { headers, signal: ctrl.signal });
    } else {
      res = await fetch(`https://dl.dropboxusercontent.com${image.path}`, { signal: ctrl.signal });
    }
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 4e6) return null;
    // Only real JPEG or PNG files are passed on.
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!jpeg && !png) return null;
    return new Response(bytes, { headers: { 'Content-Type': jpeg ? 'image/jpeg' : 'image/png', 'Cache-Control': CACHE } });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Tiny element builder for Satori (the renderer behind ImageResponse), no JSX needed.
const el = (style, ...children) => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

function drawn(card) {
  const c = {
    bg: '#1b1c22', text: '#e6e7ee', muted: '#8f93a6', accent: '#38e07b', deck: '#2a2c36', title: '#3a4aa0',
    titleText: '#f2f3ff', btn: '#3a3c4a', btnText: '#d7d9e6', lcd: '#05080a', lcdText: '#3dff6e',
    list: '#05080a', listText: '#3dff6e', ...card?.colors,
  };
  const r = card?.radius ?? 4;
  const title = card?.title || 'A record on Music Box';
  const songs = card?.count ? `${card.count} song${card.count === 1 ? '' : 's'}` : '';
  const button = (shape) => el({ width: 54, height: 42, borderRadius: Math.min(r, 12), background: c.btn, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.18), inset 0 -2px 0 rgba(0,0,0,0.35)' }, shape);
  const icon = (d) => ({ type: 'svg', props: { width: 22, height: 22, viewBox: '0 0 22 22', children: { type: 'path', props: { d, fill: c.btnText } } } });
  const tri = icon('M5 2 L19 11 L5 20 Z');
  const prev = icon('M3 3h3v16H3z M19 3 L7 11 L19 19 Z');
  const next = icon('M16 3h3v16h-3z M3 3 L15 11 L3 19 Z');
  const bars = el({ gap: 5 }, el({ width: 6, height: 20, background: c.btnText }), el({ width: 6, height: 20, background: c.btnText }));
  const square = el({ width: 18, height: 18, background: c.btnText });
  const row = (text, on) => el({ padding: '6px 14px', fontSize: 22, color: on ? c.lcd : c.listText, background: on ? c.listText : 'transparent' }, text);
  const deck = el({ flexDirection: 'column', width: 540, borderRadius: r, background: c.deck, overflow: 'hidden', boxShadow: '0 30px 60px rgba(0,0,0,0.45)' },
    el({ height: 44, background: c.title, color: c.titleText, alignItems: 'center', justifyContent: 'center', fontSize: 22, letterSpacing: 4, fontWeight: 700 }, (card?.skin || 'MUSIC BOX').toUpperCase()),
    el({ flexDirection: 'column', padding: 22, gap: 18 },
      el({ background: c.lcd, borderRadius: Math.min(r, 14), padding: '18px 22px', alignItems: 'center', gap: 22 },
        el({ fontSize: 76, color: c.lcdText, fontWeight: 700, letterSpacing: 2 }, '0:00'),
        el({ flexDirection: 'column', gap: 8, flex: 1 },
          el({ fontSize: 22, color: c.lcdText }, title.length > 22 ? `${title.slice(0, 21)}…` : title),
          el({ gap: 4, alignItems: 'flex-end', height: 34 }, ...[18, 30, 22, 34, 14, 26, 20, 31, 12, 24].map((h) => el({ width: 12, height: h, background: c.lcdText, opacity: 0.85 }))))),
      el({ height: 12, borderRadius: 6, background: c.lcd },
        el({ width: '35%', height: 12, borderRadius: 6, background: c.lcdText })),
      el({ gap: 10 }, button(prev), button(tri), button(bars), button(square), button(next))),
    el({ flexDirection: 'column', margin: '0 22px 22px', padding: '8px 0', background: c.list, borderRadius: Math.min(r, 10) },
      row(`1. ${title.slice(0, 32)}`, true), row(songs ? `${songs} in this record` : 'Press play'), row('No account needed')));
  return new ImageResponse(
    el({ width: '100%', height: '100%', background: c.bg, padding: '0 70px', alignItems: 'center', gap: 60, fontFamily: 'sans-serif' },
      deck,
      el({ flexDirection: 'column', flex: 1, gap: 18 },
        el({ fontSize: 24, letterSpacing: 6, color: c.accent, fontWeight: 700 }, 'A RECORD FOR YOU'),
        el({ fontSize: title.length > 40 ? 50 : 64, fontWeight: 800, color: c.text, lineHeight: 1.1 }, title),
        el({ fontSize: 28, color: c.muted }, [songs, card?.skin && `skin “${card.skin}”`].filter(Boolean).join(' · ') || 'Play it in your browser'),
        el({ marginTop: 30, fontSize: 22, letterSpacing: 5, color: c.muted, fontWeight: 700 }, 'MUSIC BOX'))),
    { width: 1200, height: 630, headers: { 'Cache-Control': CACHE } },
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const card = decodeCard(url.searchParams.get('c') || '');
  if (card?.image) {
    const saved = await savedCover(card.image, url.origin);
    if (saved) return saved;
  }
  return drawn(card);
}
