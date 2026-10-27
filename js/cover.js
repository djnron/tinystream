// The picture for a shared record's link preview: a snapshot of the real player, in your skin,
// laid out on a 1200 × 630 card with the record's title. It's saved next to the songs and shown
// by messaging apps (iMessage, WhatsApp, Slack...) when the link is pasted.
//
// The snapshot is made with html-to-image, loaded only when you share.

const HTML_TO_IMAGE = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm';
const W = 1200;
const H = 630;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => { setTimeout(() => no(new Error('timeout')), ms); })]);

/** Draws the player into a canvas, via an off-screen copy (the real one may be hidden on phones). */
async function snapshot(deck, width) {
  const lib = await import(HTML_TO_IMAGE);
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;pointer-events:none;`;
  const copy = deck.cloneNode(true);
  copy.style.margin = '0';
  copy.style.width = `${width}px`;
  copy.style.maxWidth = 'none';
  // Moving pictures and animations would be caught mid-step; hold them still.
  copy.querySelectorAll('*').forEach((n) => { n.style.animation = 'none'; n.style.transition = 'none'; });
  copy.querySelector('.tb-tools')?.remove(); // window buttons don't belong in the picture
  // Slider handles are drawn by the browser, which snapshots can't see: rebuild them as plain boxes.
  const real = deck.querySelectorAll('input[type="range"]');
  copy.querySelectorAll('input[type="range"]').forEach((input, i) => {
    const src = real[i];
    const cs = getComputedStyle(src);
    const pct = ((Number(src.value) - Number(src.min || 0)) / ((Number(src.max) || 100) - Number(src.min || 0))) * 100;
    const track = document.createElement('span');
    track.style.cssText = `display:block;position:relative;height:${cs.height};width:${src.getBoundingClientRect().width || 200}px;`
      + `flex:${cs.flex};max-width:${cs.maxWidth};background:${cs.background};border-radius:${cs.borderRadius};box-shadow:${cs.boxShadow};`;
    const thumb = document.createElement('span');
    thumb.style.cssText = `position:absolute;top:50%;left:calc(${Math.max(0, Math.min(100, pct || 0))}% - 13px);width:26px;height:14px;`
      + 'transform:translateY(-50%);background:var(--btn-face);border-radius:2px;box-shadow:var(--raised),0 1px 2px #0008;';
    if (src.closest('.deck-body')) track.style.gridArea = cs.gridArea;
    track.append(thumb);
    input.replaceWith(track);
  });
  holder.append(copy);
  document.body.append(holder);
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const opts = { pixelRatio: 2, cacheBust: false };
    try {
      return await withTimeout(lib.toCanvas(copy, opts), 12000);
    } catch {
      return await withTimeout(lib.toCanvas(copy, { ...opts, skipFonts: true }), 12000); // fonts failed to embed
    }
  } finally {
    holder.remove();
  }
}

function wrap(g, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last && g.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Makes the preview picture. `deck` is the player element (in whichever window it's in). */
export async function makeCover({ deck, title, count, skinName }) {
  const css = getComputedStyle(document.documentElement);
  const v = (k) => css.getPropertyValue(`--${k}`).trim();
  const width = Math.round(parseFloat(v('deck-w')) || 380);
  const shot = await snapshot(deck, width);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  // Page color, with a soft glow of the skin's accent behind the player.
  g.fillStyle = /^#|^rgb/.test(v('bg')) ? v('bg') : '#1b1c22';
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(330, H / 2, 40, 330, H / 2, 420);
  const accent = v('accent');
  glow.addColorStop(0, /^#[0-9a-f]{6}$/i.test(accent) ? `${accent}55` : 'rgba(255,255,255,0.12)');
  glow.addColorStop(1, 'transparent');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // The player, as large as fits on the left.
  const box = { x: 50, y: 40, w: 560, h: H - 80 };
  const k = Math.min(box.w / shot.width, box.h / shot.height);
  const dw = shot.width * k;
  const dh = shot.height * k;
  const dx = box.x + (box.w - dw) / 2;
  const dy = box.y + (box.h - dh) / 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 18;
  g.drawImage(shot, dx, dy, dw, dh);
  g.restore();

  // The words, in the skin's own font and colors.
  const font = v('font-ui') || 'sans-serif';
  const left = 660;
  const textW = W - left - 50;
  g.textBaseline = 'alphabetic';
  g.fillStyle = v('accent') || '#38e07b';
  g.font = `700 22px ${font}`;
  if ('letterSpacing' in g) g.letterSpacing = '5px';
  g.fillText('A RECORD FOR YOU', left, 200);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.fillStyle = v('text') || '#ffffff';
  const size = title.length > 36 ? 48 : 60;
  g.font = `800 ${size}px ${font}`;
  const lines = wrap(g, title, textW, 3);
  lines.forEach((l, i) => g.fillText(l, left, 270 + i * size * 1.12));
  const after = 270 + lines.length * size * 1.12 + 10;
  g.fillStyle = v('muted') || '#999999';
  g.font = `500 26px ${font}`;
  const sub = [`${count} song${count === 1 ? '' : 's'}`, skinName && `skin “${skinName}”`].filter(Boolean).join(' · ');
  wrap(g, sub, textW, 2).forEach((l, i) => g.fillText(l, left, after + i * 34));
  g.font = `700 20px ${font}`;
  if ('letterSpacing' in g) g.letterSpacing = '5px';
  g.fillText('MUSIC BOX', left, H - 60);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', 0.88));
}
