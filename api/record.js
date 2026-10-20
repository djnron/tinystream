// A shared record's link: https://<site>/r?c=<card>#/r/<record>. Link previews (iMessage, WhatsApp,
// Slack...) read the title and picture from this page; people are sent straight on to the app,
// which reads the record from the part after "#" (never sent to any server).

import { decodeCard, escapeHtml } from './_card.js';

export function GET(request) {
  const url = new URL(request.url);
  const c = url.searchParams.get('c') || '';
  const card = decodeCard(c);
  const title = card?.title || 'A record on Music Box';
  const songs = card?.count ? `${card.count} song${card.count === 1 ? '' : 's'}` : 'Songs';
  const desc = `${songs} to play right in your browser, no account needed${card?.skin ? `, in the skin “${card.skin}”` : ''}.`;
  const image = `${url.origin}/api/card?c=${encodeURIComponent(c)}`;
  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · Music Box</title>
<meta name="description" content="${e(desc)}">
<meta name="theme-color" content="${e(card?.colors.bg || '#1b1c22')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Music Box">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:image" content="${e(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(`The Music Box player in ${card?.skin ? `the skin “${card.skin}”` : 'its skin'}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">
<meta name="twitter:image" content="${e(image)}">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<script>location.replace('/' + location.search + location.hash);</script>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#1b1c22;color:#e6e7ee;font:16px system-ui,sans-serif}a{color:#38e07b}</style>
</head>
<body><p>Opening <a id="go" href="/">${e(title)}</a>…</p>
<script>document.getElementById('go').href = '/' + location.search + location.hash;</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=86400' },
  });
}
