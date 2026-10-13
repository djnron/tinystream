import * as downloads from './downloads.js';
import { icons } from './icons.js';
import { Player } from './player.js';
import { getProvider, providers } from './providers/index.js';
import * as store from './store.js';
import { AuthRequiredError, extOf, fmtBytes, h, isNetworkError, toast } from './util.js';
import { lcdDigits, lcdTime } from './lcd.js';
import { applySkin, parseSkinFile, SKINS, skinTemplate, TOKENS } from './skins.js';
import * as visualizer from './visualizer.js';

const player = new Player();
const $ = (sel) => document.querySelector(sel);
const view = $('#view');
let renderSeq = 0;

// ---------------------------------------------------------------- routing

const hashFor = {
  home: () => '#/',
  folder: (pid, id, name) => `#/b/${pid}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
  saved: () => '#/saved',
  settings: () => '#/settings',
};

/** Breadcrumb trail for the folder being browsed: [{ pid, id, name }]. */
let trail = [];

function updateTrail(pid, id, name) {
  const p = getProvider(pid);
  if (trail[0]?.pid !== pid) trail = [{ pid, id: p.rootId, name: p.rootName }];
  const i = trail.findIndex((c) => c.id === id);
  trail = i >= 0 ? trail.slice(0, i + 1) : [...trail, { pid, id, name }];
}

function parentHash(route) {
  if (route[0] === 'b' && trail.length > 1) {
    const up = trail[trail.length - 2];
    return hashFor.folder(up.pid, up.id, up.name);
  }
  return hashFor.home();
}

async function render() {
  const seq = ++renderSeq;
  const route = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const back = $('#back');
  back.hidden = route.length === 0;
  back.onclick = () => { location.hash = parentHash(route); };
  const stale = () => seq !== renderSeq;

  if (route[0] === 'b') return browseView(route[1], route[2], route[3], stale);
  if (route[0] === 'saved') return savedView(stale);
  if (route[0] === 'settings') return settingsView(stale);
  return homeView();
}

function setTitle(text) {
  $('#title').textContent = text;
  document.title = text === 'Music Box' ? text : `${text} · Music Box`;
}

function show(...nodes) {
  view.replaceChildren(...nodes.filter((n) => n instanceof Node));
  view.scrollTop = 0;
}

// ---------------------------------------------------------------- shared pieces

const iconSpan = (name, cls = 'ico') => h('span', { class: cls, html: icons[name] });

/** Per-track save button, shown only when the user allows downloads. */
function saveButton(track) {
  if (store.savedIds.has(track.id)) {
    return h('span', { class: 'icon-btn saved', title: 'Saved on this device', html: icons.saved });
  }
  if (!store.settings.allowDownloads) return null;
  if (downloads.isQueued(track.id)) {
    return h('span', { class: 'icon-btn pending', title: 'Saving…', html: icons.download });
  }
  return h('button', {
    class: 'icon-btn',
    title: 'Save to this device',
    'aria-label': `Save ${track.name} to this device`,
    html: icons.download,
    onclick: (e) => {
      e.stopPropagation();
      downloads.enqueue([track]);
    },
  });
}

/** Rows rendered on screen, so status changes can update them in place. */
const rows = new Map(); // track id -> { el, track }

function refreshRows() {
  const currentId = player.current?.id;
  for (const { el, track } of rows.values()) {
    if (!el.isConnected) continue;
    el.classList.toggle('current', track.id === currentId);
    el.classList.toggle('unavailable', !navigator.onLine && !store.savedIds.has(track.id));
    const slot = el.querySelector('.row-action');
    slot.replaceChildren(...[saveButton(track)].filter(Boolean));
  }
}

function trackList(tracks, { sub = (t) => t.folder, extra } = {}) {
  return h('ul', { class: 'list' }, tracks.map((track, i) => {
    const el = h('li', { class: 'row track' },
      h('button', { class: 'row-main', onclick: () => player.playList(tracks, i) },
        iconSpan('note'),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, track.name),
          h('span', { class: 'row-sub' }, [sub(track), track.size ? fmtBytes(track.size) : ''].filter(Boolean).join(' · ')))),
      h('span', { class: 'row-action' }),
      extra?.(track));
    rows.set(track.id, { el, track });
    return el;
  }));
}

function folderList(pid, folders) {
  return h('ul', { class: 'list' }, folders.map((f) =>
    h('li', { class: 'row' },
      h('a', { class: 'row-main', href: hashFor.folder(pid, f.id, f.name) },
        iconSpan('folder', 'ico folder'),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, f.name))))));
}

function message(title, body, ...actions) {
  return h('div', { class: 'empty' },
    h('h2', {}, title),
    body && h('p', {}, body),
    actions.length ? h('div', { class: 'actions center' }, actions) : null);
}

function reconnectButton(p, after = render) {
  return h('button', {
    class: 'btn primary',
    onclick: async () => {
      try {
        await p.reconnect();
        after();
      } catch (err) {
        toast(err.message);
      }
    },
  }, `Reconnect ${p.label}`);
}

// ---------------------------------------------------------------- views

function homeView() {
  setTitle('Music Box');
  rows.clear();
  const cards = Object.values(providers).map((p) => {
    const configured = p.isConfigured();
    const connected = configured && p.isConnected();
    let status;
    let actions;
    if (!configured) {
      status = 'Not set up — add your key in config.js (see README).';
    } else if (connected) {
      status = 'Connected · read-only access';
      actions = [
        h('a', { class: 'btn primary', href: hashFor.folder(p.id, p.rootId, p.rootName) }, 'Browse'),
        h('button', { class: 'btn', onclick: () => disconnect(p) }, 'Disconnect'),
      ];
    } else {
      status = 'Not connected';
      actions = [h('button', { class: 'btn primary', onclick: () => connect(p) }, `Connect ${p.label}`)];
    }
    return h('section', { class: `card source ${configured ? '' : 'disabled'}` },
      h('div', { class: 'card-head' }, iconSpan('cloud', `ico badge ${p.id}`),
        h('div', {}, h('h2', {}, p.label), h('p', { class: 'muted' }, status))),
      actions && h('div', { class: 'actions' }, actions));
  });

  const device = store.settings.allowDownloads || store.savedIds.size
    ? h('a', { class: 'card source link-card', href: hashFor.saved() },
      h('div', { class: 'card-head' }, iconSpan('phone', 'ico badge device'),
        h('div', {}, h('h2', {}, 'On this device'),
          h('p', { class: 'muted' }, `${store.savedIds.size} saved track${store.savedIds.size === 1 ? '' : 's'} · plays offline`))))
    : h('section', { class: 'card hint' },
      h('p', {}, h('strong', {}, 'Downloads are off. '),
        'Music streams from your cloud and nothing is stored on this device. ',
        h('a', { href: hashFor.settings() }, 'Change in Settings')));

  show(h('div', { class: 'stack' }, ...cards, device));
}

async function browseView(pid, folderId, name, stale) {
  const p = getProvider(pid);
  rows.clear();
  if (!p) return show(message('Unknown source', null, h('a', { class: 'btn', href: '#/' }, 'Home')));
  folderId ||= p.rootId;
  name ||= p.rootName;
  setTitle(name);
  if (!p.isConfigured()) return show(message(`${p.label} isn't set up`, 'Add your key in config.js — see the README.'));
  if (!p.isConnected()) {
    return show(message(`Connect ${p.label}`, 'Music Box only asks for read-only access.',
      h('button', { class: 'btn primary', onclick: () => connect(p) }, 'Connect')));
  }
  updateTrail(pid, folderId, name);

  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Folder path' }, trail.map((c, i) =>
    i === trail.length - 1
      ? h('span', { 'aria-current': 'page' }, c.name)
      : h('a', { href: hashFor.folder(c.pid, c.id, c.name) }, c.name)));
  show(crumbs, h('p', { class: 'muted pad' }, 'Loading…'));

  const key = `${pid}:${folderId}`;
  let listing;
  let fromCache = false;
  try {
    listing = await p.list(folderId, name);
    store.putListing(key, listing).catch(() => {});
  } catch (err) {
    if (stale()) return;
    const cached = await store.getListing(key);
    if (cached && isNetworkError(err)) {
      listing = cached;
      fromCache = true;
    } else if (err instanceof AuthRequiredError) {
      return show(crumbs, message('Sign-in needed', `${p.label} needs you to sign in again.`, reconnectButton(p)));
    } else {
      return show(crumbs, message("Couldn't load this folder",
        isNetworkError(err) ? "You're offline and this folder isn't saved." : err.message,
        h('button', { class: 'btn', onclick: render }, 'Try again')));
    }
  }
  if (stale()) return;

  const { folders, tracks } = listing;
  const actions = h('div', { class: 'actions' },
    tracks.length > 0 && h('button', { class: 'btn primary', onclick: () => player.playList(tracks, 0, { shuffle: false }) },
      iconSpan('play'), 'Play'),
    tracks.length > 0 && h('button', { class: 'btn', onclick: () => player.playList(tracks, 0, { shuffle: true }) },
      iconSpan('shuffle'), 'Shuffle'),
    folders.length > 0 && !fromCache && h('button', { class: 'btn', onclick: () => playEverything(p, folderId, name) },
      iconSpan('layers'), 'Play all incl. subfolders'),
    tracks.length > 0 && store.settings.allowDownloads && !fromCache && h('button', {
      class: 'btn',
      onclick: () => {
        const n = downloads.enqueue(tracks);
        toast(n ? `Saving ${n} track${n === 1 ? '' : 's'} to this device…` : 'Already saved');
      },
    }, iconSpan('download'), 'Save folder'));

  show(crumbs,
    fromCache && h('p', { class: 'banner inline' }, "Offline — showing this folder as it was last seen."),
    (tracks.length || folders.length) ? actions : null,
    folders.length ? folderList(pid, folders) : null,
    tracks.length ? trackList(tracks, { sub: () => '' }) : null,
    !tracks.length && !folders.length ? message('Nothing here', 'No folders or audio files in this folder.') : null);
  refreshRows();
}

async function playEverything(p, folderId, name) {
  const t = toast('Collecting tracks…', { timeout: 0 });
  try {
    const tracks = await p.listRecursive(folderId, name, {
      onProgress: (n) => { t.firstChild.textContent = `Collecting tracks… ${n}`; },
    });
    t.remove();
    if (!tracks.length) return toast('No audio files found');
    player.playList(tracks, 0);
    toast(`Playing ${tracks.length} tracks`);
  } catch (err) {
    t.remove();
    toast(err.message);
  }
}

async function savedView(stale) {
  setTitle('On this device');
  rows.clear();
  const [list, info] = await Promise.all([store.listSaved().catch(() => []), store.storageInfo()]);
  if (stale()) return;
  list.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = list.reduce((s, t) => s + (t.size || 0), 0);

  const summary = h('p', { class: 'muted pad' },
    `${list.length} track${list.length === 1 ? '' : 's'} · ${fmtBytes(total)}`,
    info.quota ? ` · ${fmtBytes(info.quota - info.usage)} free` : '');

  if (!list.length) {
    return show(message('Nothing saved yet', store.settings.allowDownloads
      ? 'Use the download buttons while browsing, or turn on "Save tracks as they play" in Settings.'
      : 'Downloads are off, so nothing is stored on this device.',
    h('a', { class: 'btn', href: hashFor.settings() }, 'Settings')));
  }

  const del = (track) => h('button', {
    class: 'icon-btn',
    title: 'Delete from this device',
    'aria-label': `Delete ${track.name} from this device`,
    html: icons.trash,
    onclick: async () => {
      await store.deleteTrack(track.id);
      render();
    },
  });

  show(
    !store.settings.allowDownloads && h('p', { class: 'banner inline' }, 'Downloads are off. These were saved earlier and still play offline.'),
    summary,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => player.playList(list, 0, { shuffle: false }) }, iconSpan('play'), 'Play all'),
      h('button', { class: 'btn', onclick: () => player.playList(list, 0, { shuffle: true }) }, iconSpan('shuffle'), 'Shuffle'),
      h('button', { class: 'btn danger', onclick: confirmClearAll }, iconSpan('trash'), 'Delete all')),
    trackList(list, { extra: del }));
  refreshRows();
}

async function confirmClearAll() {
  if (!store.savedIds.size) return;
  if (!confirm(`Delete all ${store.savedIds.size} saved tracks from this device?`)) return;
  downloads.cancelAll();
  await store.clearAll();
  toast('Deleted saved music');
  render();
}

function settingToggle({ label, desc, checked, disabled, onchange }) {
  return h('label', { class: `setting${disabled ? ' disabled' : ''}` },
    h('span', { class: 'setting-text' },
      h('span', { class: 'setting-label' }, label),
      desc && h('span', { class: 'setting-desc' }, desc)),
    h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: Boolean(checked),
      disabled: Boolean(disabled),
      onchange: (e) => onchange(e.target.checked, e.target),
    }));
}

async function settingsView(stale) {
  setTitle('Settings');
  rows.clear();
  const s = store.settings;
  const info = await store.storageInfo();
  if (stale()) return;

  const downloadsSection = h('section', { class: 'card' },
    h('h2', {}, 'Downloads & storage'),
    settingToggle({
      label: 'Allow downloads to this device',
      desc: s.allowDownloads
        ? 'On — you can save tracks and folders to play offline.'
        : 'Off — music only streams. Nothing is saved on this device.',
      checked: s.allowDownloads,
      onchange: async (on, input) => {
        if (on) {
          store.setSetting('allowDownloads', true);
          // Ask the browser to protect saved music from automatic cleanup (may show a prompt).
          const granted = await navigator.storage?.persist?.().catch(() => false);
          toast(granted ? 'Downloads allowed · storage protected' : 'Downloads allowed');
        } else {
          store.setSetting('allowDownloads', false);
          if (store.savedIds.size && confirm(`Also delete the ${store.savedIds.size} tracks already saved on this device?`)) {
            await store.clearAll();
            toast('Downloads off · saved music deleted');
          } else {
            toast('Downloads off');
          }
        }
        input.blur();
        render();
      },
    }),
    settingToggle({
      label: 'Save tracks as they play',
      desc: 'Keep a copy of every song you listen to, so it plays offline next time.',
      checked: s.allowDownloads && s.saveOnPlay,
      disabled: !s.allowDownloads,
      onchange: (on) => store.setSetting('saveOnPlay', on),
    }),
    h('div', { class: 'setting static' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, `${store.savedIds.size} saved tracks`),
        h('span', { class: 'setting-desc' },
          `App storage used: ${fmtBytes(info.usage)}${info.quota ? ` of ${fmtBytes(info.quota)}` : ''}`,
          s.allowDownloads ? ` · Protected from cleanup: ${info.persisted ? 'yes' : 'no'}` : '')),
      h('button', { class: 'btn danger', disabled: !store.savedIds.size, onclick: confirmClearAll }, 'Delete all')));

  const playbackSection = h('section', { class: 'card' },
    h('h2', {}, 'Playback'),
    h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, 'When the list ends'),
        h('span', { class: 'setting-desc' }, 'Music keeps playing track after track. Choose what happens at the end.')),
      h('select', {
        onchange: (e) => store.setSetting('repeat', e.target.value),
      }, [['all', 'Start over'], ['off', 'Stop'], ['one', 'Repeat current track']].map(([v, t]) =>
        h('option', { value: v, selected: s.repeat === v }, t)))),
    h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, 'Visualizer'),
        h('span', { class: 'setting-desc' },
          'Also changes when you tap the display. Can interrupt background playback on some phones, so it starts off.')),
      h('select', { onchange: (e) => setVisMode(e.target.value) },
        [['off', 'Off'], ['bars', 'Spectrum bars'], ['scope', 'Oscilloscope']].map(([v, t]) =>
          h('option', { value: v, selected: s.visMode === v }, t)))));

  const skinSection = h('section', { class: 'card' },
    h('h2', {}, 'Skin'),
    h('div', { class: 'skins' }, allSkins().map((sk) => skinSwatch(sk))),
    h('div', { class: 'actions' },
      h('label', { class: 'btn' }, 'Load skin file…',
        h('input', { type: 'file', accept: '.json,.mbskin,application/json', hidden: true, onchange: loadSkinFile })),
      h('button', { class: 'btn', onclick: downloadSkinTemplate }, 'Download skin template')),
    h('p', { class: 'setting-desc' },
      'Make your own: download the template (it starts from the current skin), change the colors, gradients and fonts, then load it here.'));

  const accounts = h('section', { class: 'card' },
    h('h2', {}, 'Accounts'),
    Object.values(providers).map((p) => h('div', { class: 'setting static' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, p.label),
        h('span', { class: 'setting-desc' },
          !p.isConfigured() ? 'Not set up in config.js' : p.isConnected() ? 'Connected · read-only' : 'Not connected')),
      p.isConfigured() && (p.isConnected()
        ? h('button', { class: 'btn', onclick: () => disconnect(p) }, 'Disconnect')
        : h('button', { class: 'btn primary', onclick: () => connect(p) }, 'Connect')))));

  const about = h('section', { class: 'card' },
    h('h2', {}, 'About'),
    h('p', { class: 'muted' }, 'Music Box plays music straight from your Google Drive and Dropbox. ',
      'It only ever asks for read-only access, and talks directly to those services — there is no server in between.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn danger', onclick: resetApp }, 'Reset app')));

  show(h('div', { class: 'stack' }, skinSection, downloadsSection, playbackSection, accounts, about));
}

// ---------------------------------------------------------------- skins

function allSkins() {
  return store.settings.customSkin ? [...SKINS, store.settings.customSkin] : SKINS;
}

function currentSkin() {
  return allSkins().find((sk) => sk.id === store.settings.skin) || SKINS[0];
}

function useSkin(sk) {
  store.setSetting('skin', sk.id);
  applySkin(sk);
}

/** A tiny preview of the skin, drawn with its own tokens. */
function skinSwatch(sk) {
  const el = h('button', {
    class: `swatch${sk.id === store.settings.skin ? ' active' : ''}`,
    'aria-pressed': String(sk.id === store.settings.skin),
    onclick: () => { useSkin(sk); render(); },
  },
  h('span', { class: 'sw-deck' },
    h('span', { class: 'sw-title' }),
    h('span', { class: 'sw-lcd', html: lcdDigits(' 1:23') })),
  h('span', { class: 'sw-name' }, sk.name));
  for (const [k, v] of Object.entries({ ...TOKENS, ...sk.tokens })) el.style.setProperty(`--${k}`, v);
  return el;
}

async function loadSkinFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 50_000) throw new Error('That file is too big to be a skin');
    const sk = parseSkinFile(await file.text());
    store.setSetting('customSkin', sk);
    useSkin(sk);
    toast(`Skin "${sk.name}" loaded`);
    render();
  } catch (err) {
    toast(err.message);
  }
}

function downloadSkinTemplate() {
  const blob = new Blob([skinTemplate(currentSkin())], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'music-box-skin.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- account actions

async function connect(p) {
  try {
    await p.connect();
    toast(`${p.label} connected`);
    location.hash = hashFor.folder(p.id, p.rootId, p.rootName);
    render();
  } catch (err) {
    toast(err.message || 'Could not connect');
  }
}

async function disconnect(p) {
  if (!confirm(`Disconnect ${p.label}? Music saved on this device stays until you delete it.`)) return;
  await p.disconnect();
  toast(`${p.label} disconnected`);
  render();
}

async function resetApp() {
  if (!confirm('Sign out everywhere, delete all saved music and reset settings?')) return;
  for (const p of Object.values(providers)) await p.disconnect().catch(() => {});
  await store.clearAll().catch(() => {});
  localStorage.clear();
  if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
  for (const r of regs) await r.unregister();
  location.replace(location.pathname);
}

// ---------------------------------------------------------------- the deck (player window + playlist)
//
// One skinnable player for every screen size. Wide screens show the deck and playlist as a column
// next to the library. Phones show a compact bar at the bottom that opens the deck full-screen.

const mini = $('#mini');
const full = $('#full');
const wide = matchMedia('(min-width: 900px)');
let stopViz = null;
let shownQueue = null;
let shownTrackId = null;
const lcdCache = new Map(); // element -> last text drawn, so digits only re-render when they change

const deckVisible = () => wide.matches || document.body.classList.contains('full-open');

function deckButton(name, label, onclick, id) {
  return h('button', { class: 'deck-btn', id, 'aria-label': label, title: label, html: icons[name], onclick });
}

function buildPlayerUi() {
  mini.replaceChildren(
    h('div', { class: 'mini-progress' }, h('span', { id: 'mini-bar' })),
    h('button', { class: 'mini-info', onclick: openFull, 'aria-label': 'Open player' },
      h('span', { class: 'lcd mini-lcd', id: 'mini-time' }),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title', id: 'mini-title' }),
        h('span', { class: 'row-sub', id: 'mini-sub' }))),
    h('button', { class: 'deck-btn', id: 'mini-play', 'aria-label': 'Play', onclick: () => player.toggle() }),
    h('button', { class: 'deck-btn', 'aria-label': 'Next', html: icons.next, onclick: () => player.next() }));

  const seek = h('input', { type: 'range', class: 'slider seek', id: 'seek', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek' });
  seek.addEventListener('input', () => { seek.dataset.dragging = '1'; });
  seek.addEventListener('change', () => { delete seek.dataset.dragging; player.seek(Number(seek.value)); });

  const vol = h('input', {
    type: 'range', class: 'slider vol', min: 0, max: 1, step: 0.01, value: store.settings.volume, 'aria-label': 'Volume',
    oninput: (e) => player.setVolume(Number(e.target.value)),
  });

  full.replaceChildren(
    h('div', { class: 'window deck' },
      h('div', { class: 'titlebar' },
        h('span', { class: 'tb-grip' }), h('span', { class: 'tb-label' }, 'MUSIC BOX'), h('span', { class: 'tb-grip' }),
        h('button', { class: 'tb-btn', id: 'deck-close', 'aria-label': 'Close player', html: icons.down, onclick: closeFull })),
      h('div', { class: 'deck-body' },
        h('div', { class: 'lcd screen' },
          h('div', { class: 'lcd-left' },
            h('span', { class: 'lcd-state', id: 'lcd-state', 'aria-hidden': 'true' }),
            h('button', { class: 'lcd-time', id: 'lcd-time', title: 'Show elapsed / remaining time', onclick: toggleTimeMode }),
            h('canvas', { class: 'vis', id: 'viz', title: 'Tap to change the visualizer', onclick: cycleVisMode })),
          h('div', { class: 'lcd-right' },
            h('div', { class: 'marquee', id: 'marquee' }),
            h('div', { class: 'lcd-info' },
              h('span', { class: 'lcd-box', id: 'lcd-kbps' }), h('span', {}, 'kbps'),
              h('span', { class: 'lcd-box', id: 'lcd-fmt' }),
              h('span', { class: 'lcd-tag', id: 'lcd-src' })),
            h('div', { class: 'lcd-flags' },
              h('span', { id: 'flag-shuf' }, 'SHUF'),
              h('span', { id: 'flag-rep' }, 'REP'),
              h('span', { id: 'flag-vis' }, 'VIS')))),
        seek,
        h('div', { class: 'transport' },
          deckButton('prev', 'Previous', () => player.prev()),
          deckButton('play', 'Play', () => (player.playing ? null : player.toggle()), 'btn-play'),
          deckButton('pause', 'Pause', () => (player.playing ? player.toggle() : null), 'btn-pause'),
          deckButton('stop', 'Stop', () => player.stop()),
          deckButton('next', 'Next', () => player.next()),
          deckButton('eject', 'Open library', () => { closeFull(); location.hash = hashFor.home(); }),
          h('span', { class: 'spacer' }),
          deckButton('shuffle', 'Shuffle', () => player.toggleShuffle(), 'btn-shuffle'),
          deckButton('repeat', 'Repeat', () => player.cycleRepeat(), 'btn-repeat')),
        h('div', { class: 'deck-row' },
          h('span', { class: 'vol-label' }, 'VOL'), vol,
          h('span', { class: 'deck-save', id: 'deck-save' })))),
    h('div', { class: 'window playlist' },
      h('div', { class: 'titlebar' },
        h('span', { class: 'tb-grip' }), h('span', { class: 'tb-label' }, 'PLAYLIST'), h('span', { class: 'tb-grip' })),
      h('ol', { class: 'pl', id: 'pl' }),
      h('div', { class: 'pl-foot', id: 'pl-foot' })));
}

function setLcd(el, text) {
  if (lcdCache.get(el) === text) return;
  lcdCache.set(el, text);
  el.innerHTML = lcdDigits(text);
}

function setMarquee(text) {
  const box = $('#marquee');
  if (box.dataset.text === text) return;
  box.dataset.text = text;
  box.classList.remove('scroll');
  box.replaceChildren(h('span', { class: 'marquee-inner' }, text));
  // Scroll only when the text doesn't fit, Winamp-style, with a separator between loops.
  requestAnimationFrame(() => {
    const inner = box.firstChild;
    if (!inner || inner.scrollWidth <= box.clientWidth) return;
    const loop = `${text}  ***  `;
    inner.textContent = loop + loop;
    inner.style.animationDuration = `${Math.max(6, loop.length * 0.22)}s`;
    box.classList.add('scroll');
  });
}

function updatePlayerUi() {
  const t = player.current;
  document.body.classList.toggle('has-track', Boolean(t));
  mini.hidden = !t;

  const s = store.settings;
  const status = !t ? 'stopped' : player.loading ? 'loading' : player.playing ? 'playing' : 'paused';
  $('#lcd-state').dataset.state = status;
  $('#btn-play').classList.toggle('on', status === 'playing');
  $('#btn-pause').classList.toggle('on', status === 'paused' && player.audio.currentTime > 0);
  $('#mini-play').innerHTML = player.playing ? icons.pause : icons.play;
  $('#mini-play').setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  $('#btn-shuffle').classList.toggle('on', s.shuffle);
  $('#btn-repeat').innerHTML = s.repeat === 'one' ? icons.repeatOne : icons.repeat;
  $('#btn-repeat').classList.toggle('on', s.repeat !== 'off');
  $('#btn-repeat').title = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[s.repeat];
  $('#flag-shuf').classList.toggle('lit', s.shuffle);
  $('#flag-rep').classList.toggle('lit', s.repeat !== 'off');
  $('#flag-rep').textContent = s.repeat === 'one' ? 'REP1' : 'REP';
  $('#flag-vis').classList.toggle('lit', s.visMode !== 'off');

  if (!t) {
    setMarquee('MUSIC BOX  ·  pick a folder and press play');
    $('#lcd-kbps').textContent = '';
    $('#lcd-fmt').textContent = '';
    $('#lcd-src').textContent = '';
    $('#deck-save').replaceChildren();
  } else {
    const qi = player.queueIndex;
    const what = player.loading ? 'Loading…' : player.error ? player.error.message : `${t.name}  —  ${t.folder}`;
    setMarquee(`${qi + 1}. ${what}`);
    $('#mini-title').textContent = t.name;
    $('#mini-sub').textContent = player.loading ? 'Loading…' : player.error ? player.error.message : t.folder;
    $('#mini-sub').classList.toggle('error', Boolean(player.error));
    const dur = player.audio.duration;
    $('#lcd-kbps').textContent = t.size && Number.isFinite(dur) && dur > 0 ? Math.round((t.size * 8) / dur / 1000) : '--';
    $('#lcd-fmt').textContent = extOf(t.fileName).toUpperCase().slice(0, 4);
    $('#lcd-src').textContent = store.savedIds.has(t.id) ? 'SAVED' : 'STREAM';
    $('#deck-save').replaceChildren(...[saveButton(t)].filter(Boolean));
  }
  renderPlaylist();
  updateTime();
}

function renderPlaylist() {
  const pl = $('#pl');
  const tracks = player.queue;
  if (shownQueue !== tracks) {
    shownQueue = tracks;
    shownTrackId = null;
    const shown = tracks.slice(0, 1000);
    pl.replaceChildren(...shown.map((track, i) =>
      h('li', {},
        h('button', { class: 'pl-row', title: track.folder, onclick: () => player.playQueueIndex(i) },
          h('span', { class: 'pl-num' }, `${i + 1}.`),
          h('span', { class: 'pl-name' }, track.name)))));
    if (!tracks.length) pl.append(h('li', { class: 'pl-empty' }, 'Playlist is empty. Open a folder and press Play.'));
  }
  const qi = player.queueIndex;
  const id = player.current?.id ?? null;
  [...pl.children].forEach((li, i) => li.classList.toggle('current', i === qi));
  if (id !== shownTrackId) {
    shownTrackId = id;
    if (deckVisible()) pl.children[qi]?.scrollIntoView({ block: 'nearest' });
  }
  $('#pl-foot').textContent = tracks.length
    ? `${qi + 1} / ${tracks.length}${tracks.length > 1000 ? ' (first 1000 shown)' : ''}${store.settings.shuffle ? ' · shuffled' : ''}`
    : '0 tracks';
}

function updateTime() {
  const a = player.audio;
  const dur = Number.isFinite(a.duration) ? a.duration : 0;
  const cur = player.current ? a.currentTime : 0;
  const remaining = store.settings.timeMode === 'remaining' && dur > 0;
  const text = lcdTime(remaining ? dur - cur : cur, remaining);
  setLcd($('#mini-time'), text);
  $('#mini-bar').style.width = dur ? `${(cur / dur) * 100}%` : '0%';
  if (!deckVisible()) return;
  setLcd($('#lcd-time'), text);
  const seek = $('#seek');
  seek.max = dur || 1;
  if (!seek.dataset.dragging) seek.value = cur;
  seek.style.setProperty('--fill', `${dur ? (cur / dur) * 100 : 0}%`);
}

function toggleTimeMode() {
  store.setSetting('timeMode', store.settings.timeMode === 'remaining' ? 'elapsed' : 'remaining');
  updateTime();
}

function setVisMode(mode) {
  const wasOff = store.settings.visMode === 'off';
  store.setSetting('visMode', mode);
  if (mode !== 'off') {
    visualizer.attach(player.audio);
    if (wasOff) toast('Visualizer on. If music stops in the background on your phone, turn it off.');
  }
  updatePlayerUi();
}

function cycleVisMode() {
  setVisMode({ off: 'bars', bars: 'scope', scope: 'off' }[store.settings.visMode] || 'bars');
}

/** Run the visualizer only while the deck is on screen. */
function syncViz() {
  if (deckVisible() && !stopViz) {
    if (store.settings.visMode !== 'off') visualizer.attach(player.audio);
    stopViz = visualizer.run($('#viz'), () => store.settings.visMode);
  } else if (!deckVisible() && stopViz) {
    stopViz();
    stopViz = null;
  }
}

function openFull() {
  document.body.classList.add('full-open');
  syncViz();
  shownTrackId = null;
  updatePlayerUi();
}

function closeFull() {
  document.body.classList.remove('full-open');
  syncViz();
}

// ---------------------------------------------------------------- wiring

player.addEventListener('change', () => {
  updatePlayerUi();
  refreshRows();
});
wide.addEventListener('change', () => { syncViz(); updatePlayerUi(); });
player.addEventListener('time', updateTime);
player.addEventListener('auth-required', (e) => {
  const p = getProvider(e.detail.providerId);
  toast(`${p.label} needs you to sign in again`, {
    timeout: 0,
    action: { label: 'Reconnect', run: () => p.reconnect().then(() => player.toggle()).catch((err) => toast(err.message)) },
  });
});
player.addEventListener('track-error', (e) => toast(`Skipped "${e.detail.track.name}": ${e.detail.error.message}`));

store.events.addEventListener('saved', () => { refreshRows(); updatePlayerUi(); });
downloads.downloads.addEventListener('change', () => { refreshRows(); updatePlayerUi(); });
downloads.downloads.addEventListener('error', (e) =>
  toast(`Couldn't save "${e.detail.track.name}": ${e.detail.error.message}`));

// Google sign-in tokens only last an hour; refresh during real clicks so long sessions continue.
document.addEventListener('click', () => {
  if (providers.gdrive.isConnected() && (player.current?.provider === 'gdrive' || location.hash.startsWith('#/b/gdrive'))) {
    providers.gdrive.keepAlive();
  }
}, { capture: true });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space' && player.current) { e.preventDefault(); player.toggle(); }
  if (e.key === 'Escape') closeFull();
  // Classic keyboard layout: z x c v b = previous, play, pause, stop, next.
  const keys = {
    z: () => player.prev(),
    x: () => !player.playing && player.toggle(),
    c: () => player.playing && player.toggle(),
    v: () => player.stop(),
    b: () => player.next(),
  };
  keys[e.key.toLowerCase()]?.();
});

function updateOnline() {
  $('#offline').hidden = navigator.onLine;
  refreshRows();
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
window.addEventListener('hashchange', render);

async function start() {
  $('#back').innerHTML = icons.back;
  $('#settings-link').innerHTML = icons.settings;
  applySkin(currentSkin());
  buildPlayerUi();
  await store.init();
  try {
    const { dropbox } = providers;
    if (await dropbox.handleRedirect()) {
      toast('Dropbox connected');
      history.replaceState(null, '', hashFor.folder(dropbox.id, dropbox.rootId, dropbox.rootName));
    }
  } catch (err) {
    toast(err.message);
  }
  updateOnline();
  updatePlayerUi();
  syncViz();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

start();

// Exposed for debugging in the browser console.
window.musicBox = { player, store, providers };
