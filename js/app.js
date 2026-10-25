import * as downloads from './downloads.js';
import { icons } from './icons.js';
import { Player } from './player.js';
import { getProvider, providers, registerHidden } from './providers/index.js';
import { createRecord, downloadUrl, moveRecordSources, myRecords, openRecord, recordUrl, sharedSource, stopSharing } from './share.js';
import * as store from './store.js';
import { AuthRequiredError, extOf, fmtBytes, h, isNetworkError, toast } from './util.js';
import { lcdDigits, lcdTime } from './lcd.js';
import { paint as paintSkinArt, repaint as repaintSkinArt, setOtherDocument } from './skin-art.js';
import { generateSkin, museumUrl } from './skin-generator.js';
import { makeCover } from './cover.js';
import { adoptPicture, setPictureDoc } from './pictures.js';
import { applySkin, parseSkinFile, SKINS, skinTemplate, TOKENS } from './skins.js';
import { studioView } from './studio.js';
import * as visualizer from './visualizer.js';

const player = new Player();
registerHidden(sharedSource);
// The pop-out player window, when the deck has been popped out of the page (see "stage mode and pop-out").
let popWin = null;
let popDoc = null;
// Looks in the page, then in the pop-out player window if the deck lives there.
const $ = (sel) => document.querySelector(sel) || popDoc?.querySelector(sel);
const view = $('#view');
let renderSeq = 0;

// ---------------------------------------------------------------- routing

const hashFor = {
  home: () => '#/',
  folder: (pid, id, name) => `#/b/${pid}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
  saved: () => '#/saved',
  settings: () => '#/settings',
  studio: () => '#/studio',
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

  restoreOwnSkin(route[0] === 'r');
  if (route[0] === 'r') return recordView(route[1], stale);
  if (route[0] === 'b') return browseView(route[1], route[2], route[3], stale);
  if (route[0] === 'saved') return savedView(stale);
  if (route[0] === 'settings') return settingsView(stale);
  if (route[0] === 'studio') {
    return studioView({
      store, show, setTitle, currentSkin, openPreview: openFull, isWide: () => wide.matches,
      useSkin: (sk) => { store.setSetting('skin', sk.id); applySkin(sk); },
      paintArt: (sk) => paintSkinArt(sk),
      fallbackSkin: () => SKINS[0],
    });
  }
  return homeView();
}

function setTitle(text) {
  // The logo already says Music Box, so the home screen's title shows the sections instead.
  $('#title').textContent = text === 'Music Box' ? 'Library' : text;
  document.title = text === 'Music Box' ? text : `${text} · Music Box`;
}

function show(...nodes) {
  view.replaceChildren(...nodes.filter((n) => n instanceof Node));
  // The page scrolls on its own, except in stage mode where the library drawer scrolls instead.
  window.scrollTo(0, 0);
  view.scrollTop = 0;
}

// ---------------------------------------------------------------- shared pieces

const iconSpan = (name, cls = 'ico') => h('span', { class: cls, html: icons[name] });

/** Per-track save button, shown only when the user allows downloads. */
function saveButton(track) {
  if (track.provider === 'local') return null; // already on this device
  if (track.provider === 'shared') return null; // someone else's record: never saved here
  if (store.savedIds.has(track.id)) {
    return h('span', { class: 'icon-btn saved', title: 'Saved on this device', html: icons.saved });
  }
  if (!store.settings.allowDownloads) return null;
  if (downloads.isQueued(track.id)) {
    return h('span', { class: 'icon-btn pending', title: 'Saving…', html: icons.download });
  }
  return h('button', {
    class: 'icon-btn',
    title: 'Save for offline',
    'aria-label': `Save ${track.name} for offline`,
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
    el.classList.toggle('unavailable', !navigator.onLine && track.provider !== 'local' && !store.savedIds.has(track.id));
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
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, f.name), f.sub && h('span', { class: 'row-sub' }, f.sub))))));
}

function message(title, body, ...actions) {
  return h('div', { class: 'empty' },
    h('h2', {}, title),
    body && h('p', {}, body),
    actions.length ? h('div', { class: 'actions center' }, actions) : null);
}

function reconnectButton(p, after = render, label = `Reconnect ${p.label}`) {
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
  }, label);
}

// ---------------------------------------------------------------- views

function homeView() {
  setTitle('Music Box');
  rows.clear();
  const sources = Object.values(providers).map((p) => {
    const configured = p.isConfigured();
    const connected = configured && p.isConnected();
    const isLocal = p.id === 'local';
    let status;
    let primary = null;
    let extra = [];
    if (!configured) {
      status = 'Not set up yet. Add its key to config.js (the README explains how).';
    } else if (connected) {
      status = isLocal ? `“${p.rootName}” · stays on this device` : 'Connected · read-only';
      primary = h('a', { class: 'btn primary', href: hashFor.folder(p.id, p.rootId, p.rootName) }, 'Browse');
      extra = [
        isLocal && h('button', { class: 'link', onclick: () => connect(p) }, 'Change folder'),
        h('button', { class: 'link', onclick: () => disconnect(p) }, isLocal ? 'Forget folder' : 'Disconnect'),
      ];
    } else {
      status = isLocal ? 'Any folder on this device. No account needed.' : 'Not connected';
      primary = h('button', { class: 'btn', onclick: () => connect(p) }, isLocal ? 'Choose folder' : 'Connect');
    }
    return sourceRow(isLocal ? 'folder' : 'cloud', p.id, p.label, status, primary, extra, !configured);
  });

  const saved = store.settings.allowDownloads || store.savedIds.size
    ? sourceRow('phone', 'device', 'Saved for offline',
      `${store.savedIds.size} song${store.savedIds.size === 1 ? '' : 's'} · play without internet`,
      h('a', { class: 'btn', href: hashFor.saved() }, 'Open'))
    : sourceRow('phone', 'device', 'Offline listening is off',
      'Songs stream from the cloud. Nothing is saved on this device.',
      h('a', { class: 'btn', href: hashFor.settings() }, 'Settings'));

  show(h('div', { class: 'stack home' },
    h('section', {}, sectionTitle('My folders'), pinTiles()),
    h('section', {}, sectionTitle('Sources'), h('div', { class: 'card source-list' }, ...sources, saved))));
}

/** A heading styled like a little window title bar, so the library wears the current skin too. */
const sectionTitle = (text) => h('h2', { class: 'section-title' }, h('span', {}, text));

function sourceRow(icon, id, label, status, primary, extra = [], disabled = false) {
  return h('div', { class: `source-row${disabled ? ' disabled' : ''}` },
    iconSpan(icon, `ico badge ${id}`),
    h('div', { class: 'source-text' },
      h('h3', {}, label),
      h('p', { class: 'muted' }, status),
      extra.some(Boolean) && h('div', { class: 'source-extra' }, extra)),
    primary);
}

// ---------------------------------------------------------------- pinned folders ("My folders")
//
// Pin any folder while browsing; it then shows on the home screen and in the player's folder
// switcher, so changing what's playing is one tap.

const pinKey = (pid, id) => `${pid}:${id}`;
const pins = () => store.settings.pins || [];
const isPinned = (pid, id) => pins().some((f) => pinKey(f.pid, f.id) === pinKey(pid, id));

function togglePin(pid, id, name) {
  const key = pinKey(pid, id);
  const next = isPinned(pid, id) ? pins().filter((f) => pinKey(f.pid, f.id) !== key) : [...pins(), { pid, id, name }].slice(-30);
  store.setSetting('pins', next);
  toast(isPinned(pid, id) ? `Pinned “${name}” to My folders` : `Unpinned “${name}”`);
  updatePlayerUi();
}

/** Pinned folders as record-sleeve tiles: tap to play, with open and unpin beside the name. */
function pinTiles() {
  const list = pins();
  if (!list.length) {
    const first = Object.values(providers).find((p) => p.isConfigured() && p.isConnected());
    return h('div', { class: 'tiles' },
      h('div', { class: 'tile empty' },
        h('p', {}, 'Pin a folder while browsing (☆ Pin) to keep it here. Then tap it to play.'),
        first && h('a', { class: 'btn', href: hashFor.folder(first.id, first.rootId, first.rootName) }, `Browse ${first.label}`)));
  }
  return h('ul', { class: 'tiles' }, list.map((f) => {
    const p = getProvider(f.pid);
    return h('li', { class: 'tile' },
      h('button', { class: 'tile-play', onclick: () => playFolder(f), title: `Play everything in ${f.name}`, 'aria-label': `Play ${f.name}` },
        h('span', { class: 'tile-art' },
          h('span', { class: 'tile-lcd' }, f.name),
          iconSpan('play', 'tile-go'))),
      h('div', { class: 'tile-foot' },
        h('span', { class: 'tile-sub' }, p?.label || f.pid),
        h('a', { class: 'icon-btn', href: hashFor.folder(f.pid, f.id, f.name), title: 'Open folder', 'aria-label': `Open ${f.name}`, html: icons.folder }),
        h('button', { class: 'icon-btn', title: 'Unpin', 'aria-label': `Unpin ${f.name}`, html: icons.close,
          onclick: () => { togglePin(f.pid, f.id, f.name); render(); } })));
  }));
}

/** Plays a whole folder, subfolders included, and remembers it as the current source. */
async function playFolder(f) {
  const p = getProvider(f.pid);
  if (!p?.isConnected()) {
    toast(`Connect ${p?.label || 'that source'} to play this folder`);
    return;
  }
  const t = toast(`Loading “${f.name}”…`, { timeout: 0 });
  try {
    const tracks = await p.listRecursive(f.id, f.name, {
      onProgress: (n) => { t.firstChild.textContent = `Loading “${f.name}”… ${n}`; },
    });
    t.remove();
    if (!tracks.length) return toast(`No songs found in “${f.name}”`);
    currentSource = f;
    player.playList(tracks, 0);
    toast(`Playing ${tracks.length} song${tracks.length === 1 ? '' : 's'} from “${f.name}”`);
  } catch (err) {
    t.remove();
    if (err instanceof AuthRequiredError) {
      toast(err.message, { timeout: 0, action: { label: 'Sign in', run: () => p.reconnect().then(() => playFolder(f)).catch((e) => toast(e.message)) } });
    } else toast(err.message);
  }
}

/** The folder that's playing, for the player's folder switcher. */
let currentSource = null;

async function browseView(pid, folderId, name, stale) {
  const p = getProvider(pid);
  rows.clear();
  if (!p) return show(message('This music source isn’t available', null, h('a', { class: 'btn', href: '#/' }, 'Back to library')));
  folderId ||= p.rootId;
  name ||= p.rootName;
  setTitle(name);
  if (!p.isConfigured()) return show(message(`${p.label} isn’t set up yet`, 'Add its key to config.js. The README explains how.'));
  if (!p.isConnected()) {
    return show(message(`Connect ${p.label}`, 'Music Box only asks to read your files. It never changes them.',
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
      if (p.id === 'local') {
        return show(crumbs, message('Allow access to your music folder', err.message,
          reconnectButton(p, render, 'Allow access'), h('button', { class: 'btn', onclick: () => connect(p) }, 'Choose another folder')));
      }
      return show(crumbs, message(`Sign in to ${p.label} again`, 'Sign-ins expire after a while to keep your account safe.', reconnectButton(p, render, 'Sign in')));
    } else {
      return show(crumbs, message('Couldn’t open this folder',
        isNetworkError(err) ? 'You’re offline, and this folder wasn’t saved for offline listening.' : err.message,
        h('button', { class: 'btn', onclick: render }, 'Try again')));
    }
  }
  if (stale()) return;

  const { folders, tracks } = listing;
  // Opening a folder fills the player's playlist, ready to play, unless music is playing or
  // paused partway through a song (that's left alone).
  if (tracks.length && !player.busy && player.queue[0]?.id !== tracks[0].id) {
    currentSource = { pid, id: folderId, name };
    player.cueList(tracks, 0);
  }
  const pinned = isPinned(pid, folderId);
  // Source-specific buttons, e.g. Google Drive's "Add music" (it only sees songs you pick).
  const extra = (p.actions?.(folderId) || []).map((a) => h('button', {
    class: `btn${a.primary ? ' primary' : ''}`,
    onclick: async () => {
      try {
        const result = await a.run();
        const msg = typeof result === 'string' ? result : result?.message;
        if (msg) toast(msg, { timeout: 7000 });
        if (result?.goUp) location.hash = parentHash(['b']);
        else if (result?.newName) {
          trail = trail.filter((c) => c.id !== folderId); // re-add under the new name
          location.hash = hashFor.folder(pid, folderId, result.newName);
        }
        else if (result) render();
      } catch (err) {
        if (err instanceof AuthRequiredError) toast(err.message || `Sign in to ${p.label} again`);
        else if (err.code === 'dropbox-scope') dropboxPickHelp();
        else toast(err.message);
      }
    },
  }, a.label));
  const canShare = (pid === 'gdrive' || pid === 'dropbox') && (tracks.length > 0 || folders.length > 0) && !fromCache;
  const actions = h('div', { class: 'actions' },
    ...extra,
    canShare && h('button', { class: 'btn', onclick: () => openShareDialog({ pid, folderId, name }) }, '⤴ Share as record'),
    h('button', {
      class: `btn${pinned ? ' on' : ''}`,
      title: pinned ? 'Remove from My folders' : 'Add to My folders on the Library page',
      onclick: () => { togglePin(pid, folderId, name); render(); },
    }, pinned ? '★ Pinned' : '☆ Pin'),
    tracks.length > 0 && h('button', { class: 'btn primary', onclick: () => { currentSource = { pid, id: folderId, name }; player.playList(tracks, 0, { shuffle: false }); } },
      iconSpan('play'), 'Play'),
    tracks.length > 0 && h('button', { class: 'btn', onclick: () => { currentSource = { pid, id: folderId, name }; player.playList(tracks, 0, { shuffle: true }); } },
      iconSpan('shuffle'), 'Shuffle'),
    folders.length > 0 && !fromCache && h('button', { class: 'btn', onclick: () => playFolder({ pid, id: folderId, name }) },
      iconSpan('layers'), 'Play all, with subfolders'),
    tracks.length > 0 && store.settings.allowDownloads && !fromCache && h('button', {
      class: 'btn',
      onclick: () => {
        const n = downloads.enqueue(tracks);
        toast(n ? `Saving ${n} song${n === 1 ? '' : 's'} for offline…` : 'Already saved for offline');
      },
    }, iconSpan('download'), 'Save for offline'));

  show(crumbs,
    fromCache && h('p', { class: 'banner inline' }, 'You’re offline. This is the folder as it was last time.'),
    (tracks.length || folders.length || extra.length) ? actions : null,
    folders.length ? folderList(pid, folders) : null,
    tracks.length ? trackList(tracks, { sub: () => '' }) : null,
    !tracks.length && !folders.length ? message('This folder is empty', p.emptyHint?.(folderId) || 'No music or folders here.') : null);
  refreshRows();
}

async function savedView(stale) {
  setTitle('Saved for offline');
  rows.clear();
  const [list, info] = await Promise.all([store.listSaved().catch(() => []), store.storageInfo()]);
  if (stale()) return;
  list.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = list.reduce((s, t) => s + (t.size || 0), 0);

  const summary = h('p', { class: 'muted pad' },
    `${list.length} song${list.length === 1 ? '' : 's'} · ${fmtBytes(total)}`,
    info.quota ? ` · ${fmtBytes(info.quota - info.usage)} free` : '');

  if (!list.length) {
    return show(message('No songs saved yet', store.settings.allowDownloads
      ? 'Tap the download button next to a song, or turn on “Save songs as they play” in Settings.'
      : 'Offline listening is off, so no songs are saved on this device.',
    h('a', { class: 'btn', href: hashFor.settings() }, 'Open settings')));
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
    !store.settings.allowDownloads && h('p', { class: 'banner inline' }, 'Offline listening is off. These songs were saved earlier and still play offline.'),
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
  if (!confirm(`Delete all ${store.savedIds.size} saved song${store.savedIds.size === 1 ? '' : 's'} from this device?`)) return;
  downloads.cancelAll();
  await store.clearAll();
  toast('Deleted all saved songs');
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
    h('h2', {}, 'Offline listening'),
    settingToggle({
      label: 'Save songs on this device',
      desc: s.allowDownloads
        ? 'On: you can save songs and folders to play without internet.'
        : 'Off: songs stream from the cloud. Nothing is saved on this device.',
      checked: s.allowDownloads,
      onchange: async (on, input) => {
        if (on) {
          store.setSetting('allowDownloads', true);
          // Ask the browser to protect saved music from automatic cleanup (may show a prompt).
          const granted = await navigator.storage?.persist?.().catch(() => false);
          toast(granted ? 'Offline listening on. Your browser will keep saved songs.' : 'Offline listening on');
        } else {
          store.setSetting('allowDownloads', false);
          if (store.savedIds.size && confirm(`Also delete the ${store.savedIds.size} song${store.savedIds.size === 1 ? '' : 's'} already saved on this device?`)) {
            await store.clearAll();
            toast('Offline listening off. Saved songs deleted.');
          } else {
            toast('Offline listening off. Songs you already saved still play.');
          }
        }
        input.blur();
        render();
      },
    }),
    settingToggle({
      label: 'Save songs as they play',
      desc: 'Keeps a copy of each song you play, so it plays offline next time.',
      checked: s.allowDownloads && s.saveOnPlay,
      disabled: !s.allowDownloads,
      onchange: (on) => store.setSetting('saveOnPlay', on),
    }),
    h('div', { class: 'setting static' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, `${store.savedIds.size} saved song${store.savedIds.size === 1 ? '' : 's'}`),
        h('span', { class: 'setting-desc' },
          `Using ${fmtBytes(info.usage)}${info.quota ? ` of ${fmtBytes(info.quota)}` : ''}`,
          s.allowDownloads ? (info.persisted ? ' · Your browser will keep these' : ' · Your browser may clear these if space runs low') : '')),
      h('button', { class: 'btn danger', disabled: !store.savedIds.size, onclick: confirmClearAll }, 'Delete all')));

  const playbackSection = h('section', { class: 'card' },
    h('h2', {}, 'Playback'),
    h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, 'When the list ends'),
        h('span', { class: 'setting-desc' }, 'Music plays song after song. Choose what happens after the last one.')),
      h('select', {
        onchange: (e) => store.setSetting('repeat', e.target.value),
      }, [['all', 'Start over'], ['off', 'Stop'], ['one', 'Repeat the current song']].map(([v, t]) =>
        h('option', { value: v, selected: s.repeat === v }, t)))),
    h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, 'Visualizer'),
        h('span', { class: 'setting-desc' },
          'You can also tap the display to switch. On some phones it can stop music playing in the background, so it starts off.')),
      h('select', { onchange: (e) => setVisMode(e.target.value) },
        [['off', 'Off'], ['bars', 'Spectrum bars'], ['scope', 'Oscilloscope']].map(([v, t]) =>
          h('option', { value: v, selected: s.visMode === v }, t)))));

  const cur = currentSkin();
  const skinSection = h('section', { class: 'card' },
    h('h2', {}, 'Skin'),
    h('div', { class: 'actions gen' },
      h('button', { class: 'btn primary big', onclick: generateAndApply }, iconSpan('dice'), 'Generate a skin'),
      h('a', { class: 'btn big', href: hashFor.studio() }, '✎ Skin Studio')),
    h('p', { class: 'setting-desc' },
      'Each press makes a new design from the colors of classic skins in the ',
      h('a', { href: 'https://skins.webamp.org/', target: '_blank', rel: 'noopener' }, 'Winamp Skin Museum'),
      '.'),
    cur.inspiredBy?.length ? h('p', { class: 'setting-desc inspired' }, `“${cur.name}” is inspired by `,
      cur.inspiredBy.map((src, i) => [i ? ' + ' : '',
        h('a', { href: museumUrl(src.id), target: '_blank', rel: 'noopener' }, src.name)])) : null,
    h('div', { class: 'skins' }, allSkins().map((sk) => skinSwatch(sk))),
    h('div', { class: 'actions' },
      h('label', { class: 'btn' }, 'Load skin file…',
        h('input', { type: 'file', accept: '.json,.mbskin,application/json', hidden: true, onchange: loadSkinFile })),
      h('button', { class: 'btn', onclick: downloadSkinTemplate }, 'Save skin as a file')),
    h('p', { class: 'setting-desc' },
      'Or make your own in the Skin Studio: change the colors, fonts, pictures, shape and effects, starting from your current skin.'));

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
    h('p', { class: 'muted' }, 'Music Box plays music from your Google Drive, your Dropbox or a folder on this device. ',
      'It only asks to read your files, never to change them, and your sign-ins stay in this browser.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn danger', onclick: resetApp }, 'Reset app')));

  show(h('div', { class: 'stack' }, skinSection, recordsSection(), downloadsSection, playbackSection, accounts, about));
}

// ---------------------------------------------------------------- skins

function allSkins() {
  return [...SKINS, ...(store.settings.customSkin ? [store.settings.customSkin] : []), ...(store.settings.mySkins || [])];
}

function currentSkin() {
  return allSkins().find((sk) => sk.id === store.settings.skin) || SKINS[0];
}

function useSkin(sk) {
  store.setSetting('skin', sk.id);
  applySkin(sk);
  // Artwork is drawn at the player's new size, so wait for the new layout to render first.
  requestAnimationFrame(() => paintSkinArt(sk));
}

// The player's title bar shows the skin's name, like the old skinned players did.
window.addEventListener('skinchange', () => {
  const label = $('#deck-label'); // may be in the pop-out window
  if (label) label.textContent = (recordSkin || currentSkin()).name.toUpperCase();
});

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
  h('span', { class: 'sw-name' }, sk.name),
  h('span', { class: 'sw-layout' }, `${sk.layout?.deck || 'classic'} · ${sk.layout?.buttons || 'bevel'}`));
  for (const [k, v] of Object.entries({ ...TOKENS, ...sk.tokens })) el.style.setProperty(`--${k}`, v);
  return el;
}

/** The one-button generator: roll a new skin, apply it, and offer an undo. */
let generating = false;
let genToast = null;
async function generateAndApply() {
  if (generating) return;
  generating = true;
  const before = { skin: store.settings.skin, customSkin: store.settings.customSkin };
  try {
    const sk = await generateSkin({ previous: currentSkin().layout });
    store.setSetting('customSkin', sk);
    useSkin(sk);
    const from = sk.inspiredBy.map((src) => src.name).join(' + ');
    genToast?.remove();
    genToast = toast(`🎲 ${sk.name}, inspired by ${from}`, {
      timeout: 6000,
      action: {
        label: 'Undo',
        run: () => {
          store.setSetting('customSkin', before.customSkin);
          useSkin(allSkins().find((x) => x.id === before.skin) || SKINS[0]);
          if (location.hash === hashFor.settings()) render();
        },
      },
    });
    if (location.hash === hashFor.settings()) render();
  } catch (err) {
    toast('Couldn’t make a new skin. Check your connection and try again.');
  } finally {
    generating = false;
  }
}

async function loadSkinFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 50_000) throw new Error('That file is too big to be a skin file (50 KB at most)');
    const sk = parseSkinFile(await file.text());
    store.setSetting('customSkin', sk);
    useSkin(sk);
    toast(`Now using “${sk.name}”`);
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

// ---------------------------------------------------------------- shared records
//
// "Share as record" turns on link sharing for one folder's songs and makes a link that carries the
// track list and your skin (see share.js). Anyone can open it and listen without an account.

const PENDING_SHARE = 'mb.pendingShare';

function modal(...children) {
  const dlg = h('dialog', { class: 'modal' }, ...children);
  dlg.addEventListener('close', () => dlg.remove());
  // When the player is popped out, show dialogs there (that's where the person is looking).
  (popDoc && popDoc.hasFocus() ? popDoc : document).body.append(dlg);
  dlg.showModal();
  return dlg;
}

async function openShareDialog({ pid, folderId, name, title, noDownload = true, withPictures = true }, { auto = false } = {}) {
  const p = getProvider(pid);
  const t = toast(`Finding songs in “${name}”…`, { timeout: 0 });
  let tracks;
  try {
    tracks = await p.listRecursive(folderId, name);
  } catch (err) {
    t.remove();
    return toast(err.message);
  }
  t.remove();
  if (!tracks.length) return toast('This folder has no songs to share');
  // Songs inside a folder picked with Dropbox's picker have no share link of their own.
  if (tracks.some((x) => /^pick:[^:]+:./.test(x.fileId))) {
    return modal(h('div', { class: 'modal-body' },
      h('h2', {}, 'This folder can’t be shared'),
      h('p', {}, 'You added it with the old Dropbox picker, so Music Box can’t make share links for the songs inside it.'),
      h('p', { class: 'setting-desc' }, 'To share it, open the same folder from Dropbox → Browse instead. Every folder there can be shared.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: (e) => e.target.closest('dialog').close() }, 'OK'))));
  }
  const skin = currentSkin();
  const where = pid === 'gdrive' ? 'Google Drive' : 'Dropbox';
  const titleInput = h('input', { type: 'text', value: title || name, maxlength: 80, 'aria-label': 'Record title' });
  const lock = h('input', { type: 'checkbox', checked: noDownload });
  const pictureCount = skin.pictures?.length || 0;
  const pics = h('input', { type: 'checkbox', checked: withPictures && pictureCount > 0 });
  const status = h('p', { class: 'setting-desc', role: 'status' });
  const go = h('button', { class: 'btn primary' }, 'Create link');
  const body = h('div', { class: 'modal-body' },
    h('h2', {}, '⤴ Share as record'),
    h('label', { class: 'field' }, h('span', {}, 'Title'), titleInput),
    h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, 'Turn off downloads'),
        h('span', { class: 'setting-desc' }, 'Listeners won’t see download buttons. This discourages saving but can’t stop someone determined.')),
      lock),
    pictureCount > 0 && h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, `Include my picture${pictureCount === 1 ? '' : 's'}`),
        h('span', { class: 'setting-desc' }, `Your skin’s ${pictureCount === 1 ? 'picture is' : `${pictureCount} pictures are`} saved to your ${where} `
          + 'and shared along with the songs. Pictures you added from a web link are shared as that link.')),
      pics),
    h('p', { class: 'setting-desc' },
      `${Math.min(tracks.length, 300)} song${tracks.length === 1 ? '' : 's'} from ${where}`,
      tracks.length > 300 ? ' (the first 300)' : '',
      `, in your skin “${skin.name}”. `,
      h('strong', {}, `Anyone with the link can open these songs in your ${where}.`),
      ' Nothing else is shared, and you can stop sharing anytime in Settings → Shared records. '
      + 'Only share music you have the rights to.'),
    status,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel'), go));
  const dlg = modal(body);

  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const { url, truncated } = await createRecord({
        title: titleInput.value.trim() || name,
        tracks,
        skin,
        noDownload: lock.checked,
        withPictures: pics.checked,
        source: { pid, id: folderId },
        makeCover: () => {
          status.textContent = 'Making the link preview…';
          return makeCover({ deck: (popDoc || document).querySelector('.deck'), title: titleInput.value.trim() || name, count: Math.min(tracks.length, 300), skinName: skin.name });
        },
        onProgress: (n, total) => { status.textContent = `Sharing songs… ${n} of ${total}`; },
      });
      showShareResult(body, url, truncated);
    } catch (err) {
      go.disabled = false;
      const pending = () => ({ pid, folderId, name, title: titleInput.value, noDownload: lock.checked, withPictures: pics.checked });
      if (err.code === 'dropbox-picture-scope') {
        status.replaceChildren(h('div', { class: 'callout' },
          h('strong', {}, 'One-time step: let Dropbox save your pictures'),
          h('ol', { class: 'steps' },
            h('li', {}, 'In the ', h('a', { href: DROPBOX_CONSOLE, target: '_blank', rel: 'noopener' }, 'Dropbox App Console'),
              ' (opens in a new tab), open your app → ', h('strong', {}, 'Permissions'), ', tick ',
              h('strong', {}, 'files.content.write'), ', and click ', h('strong', {}, 'Submit'), '.'),
            h('li', {}, 'Come back here and press Continue to Dropbox. After you approve, your link is made.')),
          h('p', { class: 'setting-desc' }, 'Music Box only adds files to a “Music Box” folder in your Dropbox.'),
          h('div', { class: 'actions' },
            h('button', { class: 'btn', onclick: () => { pics.checked = false; go.click(); } }, 'Share without pictures'),
            h('button', {
              class: 'btn primary',
              onclick: () => {
                sessionStorage.setItem(PENDING_SHARE, JSON.stringify(pending()));
                providers.dropbox.connect({ sharing: true, pictures: true, back: location.hash });
              },
            }, 'Continue to Dropbox →'))));
      } else if (err.code === 'dropbox-scope') {
        status.replaceChildren(h('div', { class: 'callout' },
          h('strong', {}, 'One-time step: let Dropbox make share links'),
          h('ol', { class: 'steps' },
            h('li', {}, 'In the ', h('a', { href: DROPBOX_CONSOLE, target: '_blank', rel: 'noopener' }, 'Dropbox App Console'),
              ' (opens in a new tab), open your app → ', h('strong', {}, 'Permissions'), ', tick ',
              h('strong', {}, 'sharing.read'), ' and ', h('strong', {}, 'sharing.write'), ', and click ', h('strong', {}, 'Submit'), '.'),
            h('li', {}, 'Come back here and press Continue to Dropbox. After you approve, Dropbox brings you back and your link is made.')),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              sessionStorage.setItem(PENDING_SHARE, JSON.stringify(pending()));
              providers.dropbox.connect({ sharing: true, pictures: pics.checked && pictureCount > 0, back: location.hash });
            },
          }, 'Continue to Dropbox →')));
        go.hidden = true; // the only way forward is approving in Dropbox
      } else {
        status.textContent = err.message;
      }
    }
  });
  // Back from approving sharing in Dropbox: carry on straight away.
  if (auto) go.click();
}

const DROPBOX_CONSOLE = 'https://www.dropbox.com/developers/apps';

/** One-time setup for picking from anywhere in Dropbox: the sharing permission, and the Chooser domain. */
function dropboxPickHelp() {
  const dlg = modal(h('div', { class: 'modal-body' },
    h('h2', {}, 'One-time step: let Music Box use Dropbox’s picker'),
    h('p', { class: 'setting-desc' }, 'Music Box only sees its own app folder. To play music from anywhere else, you pick it in '
      + 'Dropbox’s own picker, and Music Box plays it through the link Dropbox makes for what you pick.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Open the ', h('a', { href: DROPBOX_CONSOLE, target: '_blank', rel: 'noopener' }, 'Dropbox App Console'), ' and click your app.'),
      h('li', {}, 'On the ', h('strong', {}, 'Permissions'), ' tab, tick ', h('strong', {}, 'sharing.read'), ' and ',
        h('strong', {}, 'sharing.write'), ', then ', h('strong', {}, 'Submit'), '.'),
      h('li', {}, 'On the ', h('strong', {}, 'Settings'), ' tab, under ', h('strong', {}, 'Chooser / Saver / Embedder domains'),
        ', add ', h('code', {}, location.hostname), '.'),
      h('li', {}, 'Come back and press the button below, approve in Dropbox, then press “Add music from Dropbox” again.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Not now'),
      h('button', { class: 'btn primary', onclick: () => providers.dropbox.connect({ sharing: true, back: location.hash }) }, 'Continue to Dropbox →'))));
}

/** Explains the one-time Dropbox setting for sharing, with what Dropbox said if it refused. */
function dropboxSharingHelp(detail, pending) {
  const dlg = modal(h('div', { class: 'modal-body' },
    h('h2', {}, 'Dropbox hasn’t allowed sharing yet'),
    detail && h('p', { class: 'setting-desc' }, 'Dropbox said: ', h('em', {}, detail)),
    h('p', {}, 'Turn on two permissions for your Dropbox app. You only do this once:'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Open the ', h('a', { href: DROPBOX_CONSOLE, target: '_blank', rel: 'noopener' }, 'Dropbox App Console'), ' and click your app.'),
      h('li', {}, 'Go to the ', h('strong', {}, 'Permissions'), ' tab.'),
      h('li', {}, 'Tick ', h('strong', {}, 'sharing.read'), ' and ', h('strong', {}, 'sharing.write'), '.'),
      h('li', {}, 'Click ', h('strong', {}, 'Submit'), ' at the bottom of the page.')),
    h('p', { class: 'setting-desc' }, 'Then press Try again. Dropbox asks you to approve, then brings you back here and makes your link.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close'),
      pending && h('button', {
        class: 'btn primary',
        onclick: () => {
          sessionStorage.setItem(PENDING_SHARE, JSON.stringify(pending));
          providers.dropbox.connect({ sharing: true, back: hashFor.folder(pending.pid, pending.folderId, pending.name) });
        },
      }, 'Try again'))));
}

/**
 * The player's Share button: shares the folder (or record) that's playing. A record already made
 * from that folder is offered again, so its link doesn't change; otherwise this makes one.
 */
function sharePlaying() {
  const src = currentSource;
  if (!src || !player.current) return toast('Play a folder first, then share it from here');
  if (src.pid === 'record') {
    const body = h('div', { class: 'modal-body' });
    modal(body);
    return showShareResult(body, recordUrl(src.id, src.card), false, { title: src.name, forwarding: true });
  }
  if (src.pid !== 'gdrive' && src.pid !== 'dropbox') {
    return toast('Songs from this device can’t be shared by link. Google Drive and Dropbox songs can.');
  }
  const existing = myRecords().find((r) => r.source?.pid === src.pid && r.source?.id === src.id);
  if (existing) {
    const body = h('div', { class: 'modal-body' });
    const dlg = modal(body);
    showShareResult(body, existing.url, false, {
      title: existing.title,
      again: () => { dlg.close(); openShareDialog({ pid: src.pid, folderId: src.id, name: src.name }); },
    });
    return null;
  }
  return openShareDialog({ pid: src.pid, folderId: src.id, name: src.name });
}

function showShareResult(body, url, truncated, { title = '', again = null, forwarding = false } = {}) {
  const field = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Record link', onfocus: (e) => e.target.select() });
  const copy = h('button', {
    class: 'btn primary',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'Copied ✓';
      } catch {
        field.select();
        copy.textContent = 'Press Ctrl+C or ⌘C to copy';
      }
    },
  }, 'Copy link');
  const text = title ? `“${title}”: a record for you on Music Box` : 'A record for you on Music Box';
  const enc = encodeURIComponent;
  body.replaceChildren(
    h('h2', {}, forwarding ? '⤴ Share this record' : again ? `⤴ Share “${title}”` : '✓ Your record is ready'),
    h('p', { class: 'setting-desc' },
      forwarding ? 'Someone shared this with you. Anyone with the link can listen, no account needed.'
        : again ? 'You already made a link for this folder. Anyone with it can listen, no account needed.'
          : 'Anyone with this link can listen, no account needed.',
      truncated ? ' Only the first 300 songs are included.' : ''),
    field,
    h('div', { class: 'actions' },
      copy,
      navigator.share && h('button', { class: 'btn', onclick: () => navigator.share({ title: text, url }).catch(() => {}) }, iconSpan('share'), 'Share…'),
      h('a', { class: 'btn', href: `mailto:?subject=${enc(text)}&body=${enc(`${text}\n\n${url}`)}` }, 'Email'),
      h('a', { class: 'btn', href: `sms:?&body=${enc(`${text} ${url}`)}` }, 'Message'),
      h('a', { class: 'btn', href: `https://wa.me/?text=${enc(`${text} ${url}`)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
      h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Open')),
    h('div', { class: 'actions' },
      again && h('button', { class: 'btn', onclick: again }, 'Make a new link'),
      h('button', { class: 'btn', onclick: () => body.closest('dialog').close() }, 'Done')));
}

function recordsSection() {
  const list = myRecords();
  return h('section', { class: 'card' },
    h('h2', {}, 'Shared records'),
    list.length
      ? h('ul', { class: 'list pin-list' }, list.map((r) => h('li', { class: 'row' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-text' },
            h('span', { class: 'row-title' }, r.title),
            h('span', { class: 'row-sub' },
              `${r.count} songs · ${new Date(r.created).toLocaleDateString()}${r.noDownload ? ' · downloads off' : ''}`))),
        h('button', {
          class: 'btn',
          onclick: async (e) => {
            try { await navigator.clipboard.writeText(r.url); e.target.textContent = 'Copied ✓'; } catch { prompt('Copy this link', r.url); }
          },
        }, 'Copy link'),
        h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (!confirm(`Stop sharing “${r.title}”? The link will stop working, and its songs will no longer be shared.`)) return;
            try { await stopSharing(r.id); toast(`Stopped sharing “${r.title}”`); } catch (err) { toast(err.message, { timeout: 8000 }); }
            render();
          },
        }, 'Stop sharing'))))
      : h('p', { class: 'setting-desc' }, 'To share music, open a Google Drive or Dropbox folder and press “⤴ Share as record”, or press ⤴ on the player while it plays.'));
}

/** While a shared record is open, it's shown in the sender's skin; leaving restores your own. */
let recordSkin = null;
function restoreOwnSkin(stayingOnRecord) {
  if (stayingOnRecord || !recordSkin) return;
  recordSkin = null;
  applySkin(currentSkin());
  requestAnimationFrame(() => paintSkinArt(currentSkin()));
}

async function recordView(payload, stale) {
  rows.clear();
  setTitle('Shared record');
  show(h('p', { class: 'muted pad' }, 'Opening record…'));
  let rec;
  try {
    rec = await openRecord(payload || '');
  } catch {
    return show(message('This record link doesn’t work', 'Part of the link may be missing. Ask the person who sent it to copy it again.'));
  }
  if (stale()) return;
  setTitle(rec.title);
  if (rec.skin) {
    recordSkin = rec.skin;
    applySkin(rec.skin);
    requestAnimationFrame(() => paintSkinArt(rec.skin));
  }
  // The record's songs go straight into the player, ready to play (browsers need one tap to start
  // sound). Music already playing, or paused partway through, is left alone.
  if (rec.tracks.length && !player.busy && player.queue[0]?.id !== rec.tracks[0].id) {
    currentSource = { pid: 'record', id: payload, name: rec.title, card: new URLSearchParams(location.search).get('c') || '' };
    player.cueList(rec.tracks, 0);
  }
  const play = (shuffle) => {
    currentSource = { pid: 'record', id: payload, name: rec.title, card: new URLSearchParams(location.search).get('c') || '' };
    player.playList(rec.tracks, 0, { shuffle });
  };
  const dl = (track) => {
    const href = downloadUrl(track);
    return href && h('a', { class: 'icon-btn', href, target: '_blank', rel: 'noopener', title: 'Download', 'aria-label': `Download ${track.name}`, html: icons.download });
  };
  show(
    h('section', { class: 'card sleeve' },
      h('p', { class: 'sleeve-kicker' }, 'A RECORD FOR YOU'),
      h('h2', { class: 'sleeve-title' }, rec.title),
      h('p', { class: 'muted' }, `${rec.tracks.length} song${rec.tracks.length === 1 ? '' : 's'}`,
        rec.skin ? ` · in the skin “${rec.skin.name}”` : '',
        rec.noDownload ? ' · downloads turned off by the sender' : ''),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => play(false) }, iconSpan('play'), 'Play'),
        h('button', { class: 'btn', onclick: () => play(true) }, iconSpan('shuffle'), 'Shuffle'),
        rec.linkPictures?.length && h('button', {
          class: 'btn',
          title: 'These pictures load from other websites, which will see your visit',
          onclick: (e) => {
            rec.skin.pictures = [...rec.skin.pictures, ...rec.linkPictures].slice(0, 4);
            rec.linkPictures = [];
            applySkin(rec.skin);
            e.currentTarget.remove();
          },
        }, `Show pictures from ${[...new Set(rec.linkPictures.map((p) => new URL(p.src).hostname))].join(', ')}`),
        rec.skin && h('button', {
          class: 'btn',
          onclick: async () => {
            // Keep a copy of the record's pictures on this device, so the skin doesn't depend on the sender.
            const pictures = await Promise.all((rec.skin.pictures || []).map(adoptPicture));
            const keep = { ...rec.skin, id: 'custom', inspiredBy: [], pictures: pictures.filter(Boolean) };
            store.setSetting('customSkin', keep);
            recordSkin = null;
            useSkin(keep);
            toast(`“${rec.skin.name}” is now your skin`);
          },
        }, 'Keep this skin'))),
    rec.tracks.length
      ? trackList(rec.tracks, { sub: () => '', extra: dl })
      : message('No songs to play', 'The songs in this record aren’t available any more.'));
  refreshRows();
}

// ---------------------------------------------------------------- account actions

async function connect(p) {
  sessionStorage.removeItem(PENDING_SHARE); // a plain connect never resumes an old share attempt
  try {
    await p.connect();
    toast(`${p.label} connected`);
    location.hash = hashFor.folder(p.id, p.rootId, p.rootName);
    render();
  } catch (err) {
    toast(err.message || 'Couldn’t connect. Try again.');
  }
}

async function disconnect(p) {
  if (!confirm(`Disconnect ${p.label}? Songs saved on this device stay until you delete them.`)) return;
  await p.disconnect();
  toast(`${p.label} disconnected`);
  render();
}

async function resetApp() {
  if (!confirm('Reset Music Box? This signs you out of every account, deletes saved songs and your own skins, and resets all settings.')) return;
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
// Keep in step with the min-width breakpoints in css/app.css.
const WIDE = '(min-width: 768px)';
const wide = matchMedia(WIDE);
let stopViz = null;
let shownQueue = null;
let shownTrackId = null;
const lcdCache = new Map(); // element -> last text drawn, so digits only re-render when they change

const deckVisible = () => Boolean(popWin) || wide.matches || document.body.classList.contains('full-open');

/** Transport button: an icon, plus a text label that "labels" skins show instead. */
function deckButton(name, label, onclick, id, text) {
  return h('button', { class: 'deck-btn', id, 'aria-label': label, title: label, onclick },
    h('span', { class: 'btn-ico', html: icons[name] }),
    h('span', { class: 'btn-txt' }, text));
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
        h('span', { class: 'tb-grip' }), h('span', { class: 'tb-label', id: 'deck-label' }, 'MUSIC BOX'), h('span', { class: 'tb-grip' }),
        h('span', { class: 'tb-tools' },
          h('button', { class: 'tb-btn', id: 'btn-stage', title: 'Stage mode: make the player fill the page (F)', 'aria-label': 'Stage mode', html: icons.stage, onclick: () => setStage(!store.settings.stage) }),
          h('button', { class: 'tb-btn', id: 'btn-songs', title: 'Show the song list', 'aria-label': 'Show the song list', 'aria-expanded': 'false', onclick: () => toggleSongs() },
            h('span', { class: 'btn-ico', html: icons.library }), h('span', {}, 'SONGS')),
          h('button', { class: 'tb-btn', id: 'btn-share', title: 'Share what’s playing', 'aria-label': 'Share what’s playing', html: icons.share, onclick: sharePlaying }),
          canPopOut() && h('button', { class: 'tb-btn', id: 'btn-popout', title: 'Pop out the player into its own window', 'aria-label': 'Pop out player', html: icons.popout, onclick: () => (popWin ? popIn() : popOut()) }),
          h('button', { class: 'tb-btn', id: 'deck-close', 'aria-label': 'Close player', html: icons.down, onclick: closeFull }))),
      // Every part of the deck is a direct grid item, so skins can arrange them freely (see the
      // [data-deck] rules in css/app.css). Speakers and reels only show in the layouts that use them.
      h('div', { class: 'deck-body' },
        h('span', { class: 'speaker spk-l', 'aria-hidden': 'true' }),
        h('div', { class: 'lcd screen' },
          h('span', { class: 'lcd-state', id: 'lcd-state', 'aria-hidden': 'true' }),
          h('button', { class: 'lcd-time', id: 'lcd-time', title: 'Switch between time played and time left', onclick: toggleTimeMode }),
          h('span', { class: 'reel reel-l', 'aria-hidden': 'true' }),
          h('span', { class: 'reel reel-r', 'aria-hidden': 'true' }),
          h('canvas', { class: 'vis', id: 'viz', title: 'Tap to change the visualizer', onclick: cycleVisMode }),
          h('div', { class: 'marquee', id: 'marquee' }),
          h('div', { class: 'lcd-info' },
            h('span', { class: 'lcd-box', id: 'lcd-kbps' }), h('span', {}, 'kbps'),
            h('span', { class: 'lcd-box', id: 'lcd-fmt' }),
            h('span', { class: 'lcd-tag', id: 'lcd-src' })),
          h('div', { class: 'lcd-flags' },
            h('span', { id: 'flag-shuf' }, 'SHUF'),
            h('span', { id: 'flag-rep' }, 'REP'),
            h('span', { id: 'flag-vis' }, 'VIS'))),
        h('span', { class: 'speaker spk-r', 'aria-hidden': 'true' }),
        seek,
        h('div', { class: 'transport' },
          deckButton('prev', 'Previous', () => player.prev(), null, 'PREV'),
          deckButton('play', 'Play', () => (player.playing ? null : player.toggle()), 'btn-play', 'PLAY'),
          deckButton('pause', 'Pause', () => (player.playing ? player.toggle() : null), 'btn-pause', 'PAUSE'),
          deckButton('stop', 'Stop', () => player.stop(), null, 'STOP'),
          deckButton('next', 'Next', () => player.next(), null, 'NEXT'),
          deckButton('eject', 'Open library', () => { closeFull(); location.hash = hashFor.home(); }, null, 'EJECT'),
          h('span', { class: 'spacer' }),
          deckButton('shuffle', 'Shuffle', () => player.toggleShuffle(), 'btn-shuffle', 'SHUF'),
          deckButton('repeat', 'Repeat', () => player.cycleRepeat(), 'btn-repeat', 'REP')),
        h('div', { class: 'deck-row' },
          h('span', { class: 'vol-label' }, 'VOL'), vol,
          h('span', { class: 'deck-save', id: 'deck-save' }))),
      h('div', { class: 'emblem', 'aria-hidden': 'true' })),
    h('div', { class: 'window playlist' },
      h('div', { class: 'titlebar' },
        h('span', { class: 'tb-grip' }), h('span', { class: 'tb-label' }, 'PLAYLIST'), h('span', { class: 'tb-grip' }),
        h('span', { class: 'tb-tools' },
          h('button', {
            class: 'tb-btn pl-fold', title: 'Hide the song list', 'aria-label': 'Hide the song list', 'aria-expanded': 'true',
            onclick: () => toggleSongs(),
          }, h('span', { class: 'btn-ico', html: icons.down }), h('span', { class: 'fold-txt' }, 'HIDE')))),
      h('label', { class: 'pl-source' },
        h('span', { class: 'pl-source-label' }, 'FOLDER'),
        h('select', { id: 'pl-source', 'aria-label': 'Switch music folder', onchange: onSourcePick })),
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
  // (A timer, not an animation frame: those pause when the page's tab is hidden but the deck is popped out.)
  setTimeout(() => {
    const inner = box.firstChild;
    if (!inner || inner.scrollWidth <= box.clientWidth) return;
    const loop = `${text}  ***  `;
    inner.textContent = loop + loop;
    inner.style.animationDuration = `${Math.max(6, loop.length * 0.22)}s`;
    box.classList.add('scroll');
  }, 0);
}

function updatePlayerUi() {
  const t = player.current;
  // The mini player always shows on phones, so the full player is one tap away even before any music.
  document.body.classList.add('has-track');
  mini.hidden = false;

  const s = store.settings;
  const status = !t ? 'stopped' : player.loading ? 'loading' : player.playing ? 'playing' : 'paused';
  $('#lcd-state').dataset.state = status;
  $('#btn-play').classList.toggle('on', status === 'playing');
  $('#btn-pause').classList.toggle('on', status === 'paused' && player.audio.currentTime > 0);
  $('#mini-play').innerHTML = player.playing ? icons.pause : icons.play;
  $('#mini-play').setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  $('#btn-shuffle').classList.toggle('on', s.shuffle);
  $('#btn-repeat .btn-ico').innerHTML = s.repeat === 'one' ? icons.repeatOne : icons.repeat;
  $('#btn-repeat .btn-txt').textContent = s.repeat === 'one' ? 'REP 1' : 'REP';
  document.documentElement.toggleAttribute('data-playing', player.playing);
  $('#btn-repeat').classList.toggle('on', s.repeat !== 'off');
  $('#btn-repeat').title = { off: 'Repeat: off', all: 'Repeat: all songs', one: 'Repeat: this song' }[s.repeat];
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
    $('#mini-title').textContent = 'Music Box';
    $('#mini-sub').textContent = 'Tap to open the player';
    $('#mini-sub').classList.remove('error');
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

/** Fills the player's folder switcher: what's playing, your pinned folders, and "browse". */
function renderSourcePicker() {
  const sel = $('#pl-source');
  if (!sel || document.activeElement === sel) return; // don't rebuild under an open menu
  const list = pins();
  const cur = currentSource;
  const curPinned = cur ? list.findIndex((f) => pinKey(f.pid, f.id) === pinKey(cur.pid, cur.id)) : -1;
  sel.replaceChildren(...[
    curPinned < 0 && h('option', { value: '', disabled: true, selected: true }, cur ? `▶ ${cur.name}` : 'Choose a folder to play…'),
    ...list.map((f, i) => h('option', { value: String(i), selected: i === curPinned }, `${i === curPinned ? '▶ ' : ''}${f.name}`)),
    h('option', { value: 'browse' }, list.length ? '📂 Browse for more…' : '📂 Browse folders… (pin some with ☆)'),
  ].filter(Boolean));
}

function onSourcePick(e) {
  const v = e.target.value;
  e.target.blur();
  if (v === 'browse') {
    closeFull();
    location.hash = hashFor.home();
  } else if (v !== '') {
    playFolder(pins()[Number(v)]);
  }
  renderSourcePicker();
}

function renderPlaylist() {
  renderSourcePicker();
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
    if (!tracks.length) {
      pl.append(h('li', { class: 'pl-empty' }, 'Nothing to play yet. Choose a folder above',
        wide.matches ? ', or open one in your library.' : ', or tap ⌄ (top right) to browse your music.'));
    }
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
    : '0 songs';
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

// ---------------------------------------------------------------- stage mode and pop-out
//
// Stage: the player fills the page (scaled up with CSS zoom) and the library slides in as a drawer.
// Pop-out: the deck moves into its own small window. In Chrome and Edge that window stays on top of
// everything (Document Picture-in-Picture); elsewhere it's an ordinary pop-up window.

const isStage = () => Boolean(store.settings.stage) && wide.matches && !popWin;

function setStage(on) {
  store.setSetting('stage', on);
  applyStage();
  toast(on ? 'Stage mode on. Press Library (or L) to see your music.' : 'Stage mode off', { timeout: 2500 });
}

function applyStage() {
  const on = isStage();
  document.body.classList.toggle('stage', on);
  if (!on) document.body.classList.remove('drawer-open');
  const btn = $('#btn-stage');
  if (btn) {
    btn.innerHTML = on ? icons.unstage : icons.stage;
    btn.title = on ? 'Leave stage mode (F)' : 'Stage mode: make the player fill the page (F)';
  }
  $('#library-toggle').hidden = !on;
  fitStage();
}

/** Scales the deck and playlist to fill the stage, keeping them crisp (zoom re-lays out, it doesn't blur). */
function fitStage() {
  const deck = full.querySelector('.deck');
  const list = full.querySelector('.playlist');
  const root = document.documentElement;
  if (!isStage() || !deck) {
    document.body.classList.remove('stage-stacked');
    root.style.removeProperty('--stage-zoom');
    if (list) list.style.removeProperty('height');
    requestAnimationFrame(repaintSkinArt);
    return;
  }
  root.style.setProperty('--stage-zoom', '1');
  list.style.removeProperty('height');
  const natural = deck.getBoundingClientRect();
  list.style.height = `${Math.round(natural.height)}px`; // playlist matches the deck's height
  const top = document.querySelector('.topbar').getBoundingClientRect().height;
  root.style.setProperty('--topbar-h', `${Math.round(top)}px`);
  const availW = innerWidth - 96;
  const availH = innerHeight - top - 64;
  // Side by side, or stacked when the screen is taller than wide (tablets held upright), whichever
  // lets them grow bigger. It shrinks below 1 too, so a wide skin still fits a smaller window.
  const across = Math.min(availW / (natural.width * 2 + 24), availH / natural.height);
  const stacked = Math.min(availW / natural.width, availH / (natural.height * 2 + 24));
  document.body.classList.toggle('stage-stacked', stacked > across);
  const zoom = Math.max(0.6, Math.min(2.6, Math.max(across, stacked)));
  root.style.setProperty('--stage-zoom', zoom.toFixed(3));
  requestAnimationFrame(repaintSkinArt);
}

function toggleDrawer(open = !document.body.classList.contains('drawer-open')) {
  document.body.classList.toggle('drawer-open', open && isStage());
}

// ---- pop-out

let rootSync = null;

const canPopOut = () => 'documentPictureInPicture' in window || !matchMedia('(pointer: coarse)').matches;

/** Copies the page's skin (CSS variables and data-* layout attributes) onto the pop-out window. */
function syncPopRoot() {
  if (!popDoc) return;
  const from = document.documentElement;
  const to = popDoc.documentElement;
  for (const { name } of [...to.attributes]) if (!from.hasAttribute(name)) to.removeAttribute(name);
  for (const { name, value } of [...from.attributes]) to.setAttribute(name, value);
}

async function popOut() {
  const deck = full.querySelector('.deck');
  if (!deck || popWin) return;
  const rect = deck.getBoundingClientRect();
  const width = Math.round(Math.max(320, rect.width / (parseFloat(document.documentElement.style.getPropertyValue('--stage-zoom')) || 1)));
  // The pop-out opens as just the player (song list folded) unless the list was open last time.
  const list = full.querySelector('.playlist');
  list?.classList.toggle('folded', !store.settings.popSongs);
  const height = Math.round(popExtra() + popHeightFor(deck, list));
  let win;
  try {
    win = 'documentPictureInPicture' in window
      // Without preferInitialWindowPlacement Chrome reopens the window at whatever size it was last
      // closed at, which can disagree with the song list's saved state.
      ? await window.documentPictureInPicture.requestWindow({ width, height, preferInitialWindowPlacement: true })
      : window.open('', 'music-box-player', `popup,width=${width},height=${height}`);
  } catch (err) {
    toast('Couldn’t pop out the player. Try again, or use stage mode (F).');
    return;
  }
  if (!win) {
    toast('Your browser blocked the pop-out window. Allow pop-ups for this site and try again.');
    return;
  }
  popWin = win;
  popDoc = win.document;
  setPictureDoc(popDoc);
  popDoc.title = 'Music Box';
  // Same styles as the page: copy our stylesheet's rules in (a <link> isn't reliably applied in a
  // picture-in-picture window), plus the skin's variables and layout attributes.
  for (const sheet of document.styleSheets) {
    try {
      const style = popDoc.createElement('style');
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      popDoc.head.append(style);
    } catch {
      if (!sheet.href) continue;
      const link = popDoc.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      popDoc.head.append(link);
    }
  }
  syncPopRoot();
  rootSync = new MutationObserver(syncPopRoot);
  rootSync.observe(document.documentElement, { attributes: true });
  popDoc.body.className = 'popout';
  // The deck and playlist keep all their buttons and listeners when moved.
  popDoc.body.append(deck, ...[list].filter(Boolean));
  if (list) syncSongButtons(list);
  // Chrome's frame takes some of the requested height (its title bar); measure how much once the
  // window settles, so later opens ask for exactly enough. Only a plausible amount is kept, since a
  // browser that ignores the requested size gives a meaningless difference.
  const settle = () => {
    if (popWin !== win) return;
    const loss = height - win.innerHeight;
    if (loss >= 0 && loss <= 150) store.setSetting('popExtra', loss);
  };
  win.addEventListener('resize', settle);
  setTimeout(() => { settle(); win.removeEventListener('resize', settle); }, 1000);
  // Until then (or in a browser that ignores the requested size) the first click in the window, which
  // is what lets a page resize its window, fits it. The song buttons do their own fitting.
  popDoc.addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.('#btn-songs, .pl-fold')) fitPop();
  }, { capture: true });
  setOtherDocument(popDoc);
  full.prepend(h('div', { class: 'popped-note' },
    h('p', {}, 'The player is in its own window.'),
    h('button', { class: 'btn', onclick: popIn }, iconSpan('popin'), 'Bring it back')));
  popWin.addEventListener('pagehide', popIn, { once: true });
  popWin.addEventListener('resize', debounce(() => repaintSkinArt(), 250));
  popDoc.addEventListener('keydown', onKey);
  document.body.classList.add('popped');
  updatePopButton();
  applyStage();
  restartViz();
  updatePlayerUi();
  requestAnimationFrame(repaintSkinArt);
}

function popIn() {
  if (!popWin) return;
  const deck = popDoc.querySelector('.deck');
  const list = popDoc.querySelector('.playlist');
  const win = popWin;
  popWin = null;
  if (popDoc) setPictureDoc(popDoc, false);
  popDoc = null;
  rootSync?.disconnect();
  setOtherDocument(null);
  full.querySelector('.popped-note')?.remove();
  if (list) {
    list.classList.remove('folded'); // in the page the song list is always shown
    full.prepend(list);
  }
  if (deck) full.prepend(deck);
  document.body.classList.remove('popped');
  try { win.close(); } catch { /* already closed */ }
  updatePopButton();
  applyStage();
  restartViz();
  updatePlayerUi();
  requestAnimationFrame(repaintSkinArt);
}

function updatePopButton() {
  const btn = $('#btn-popout');
  if (!btn) return;
  btn.innerHTML = popWin ? icons.popin : icons.popout;
  btn.title = popWin ? 'Put the player back in the page' : 'Pop out the player into its own window';
}

/**
 * Folds or unfolds the song list. In the pop-out window the window itself shrinks or grows to
 * match (browsers allow that from a click), so the player stays compact.
 */
function toggleSongs(open) {
  const pl = $('.playlist');
  if (!pl) return;
  const show = open ?? pl.classList.contains('folded');
  const win = pl.ownerDocument.defaultView;
  if (win !== window && !show && !pl.classList.contains('folded')) {
    // Reopen the list at the height it had, including any resizing done by hand.
    const listH = Math.round(pl.getBoundingClientRect().height);
    if (listH >= POP_LIST_MIN) store.setSetting('popListH', listH);
  }
  pl.classList.toggle('folded', !show);
  syncSongButtons(pl);
  if (win !== window) {
    store.setSetting('popSongs', show); // reopen the pop-out the same way next time
    fitPop();
  }
  if (show) {
    shownTrackId = null; // scroll the playing song into view
    renderPlaylist();
  }
}

const POP_LIST_MIN = 120;

/**
 * How much more height to ask for than the content needs: Chrome counts its picture-in-picture title
 * bar in the requested height. Measured on each open; 56 is what Chrome on macOS takes.
 */
const popExtra = () => store.settings.popExtra ?? ('documentPictureInPicture' in window ? 56 : 0);

/** The pop-out content height that fits the deck plus the song list in its current folded/open state. */
function popHeightFor(deck, list) {
  const deckH = deck.scrollHeight;
  if (!list) return deckH;
  if (!list.classList.contains('folded')) return deckH + (store.settings.popListH || 260);
  // Folded, the list is its title bar plus its own padding (measured directly: in the page it stretches).
  const bar = list.querySelector('.titlebar');
  const cs = getComputedStyle(list);
  return deckH + (bar ? bar.getBoundingClientRect().height : 0) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
}

/**
 * Sizes the pop-out window to fit the player: exactly, with the list folded; with it open, only when
 * the list would be squeezed below a usable height (otherwise a size set by hand is kept).
 * Browsers only allow this from a click inside the window, so it is called from clicks.
 */
function fitPop() {
  if (!popWin) return;
  const deck = popDoc.querySelector('.deck');
  const list = popDoc.querySelector('.playlist');
  if (!deck) return;
  const open = list && !list.classList.contains('folded');
  if (open && list.getBoundingClientRect().height >= POP_LIST_MIN) return;
  const delta = Math.round(popHeightFor(deck, list) - popWin.innerHeight);
  if (Math.abs(delta) > 2) {
    try { popWin.resizeBy(0, delta); } catch { /* needs a click in the window; tried again on the next one */ }
  }
}

function syncSongButtons(pl) {
  const show = !pl.classList.contains('folded');
  const songs = $('#btn-songs');
  songs?.setAttribute('aria-expanded', String(show));
  songs?.classList.toggle('on', show);
  if (songs) songs.title = show ? 'Hide the song list' : 'Show the song list';
  const fold = pl.querySelector('.pl-fold');
  if (fold) {
    fold.setAttribute('aria-expanded', String(show));
    fold.setAttribute('aria-label', show ? 'Hide the song list' : 'Show the song list');
    fold.title = fold.getAttribute('aria-label');
    fold.querySelector('.fold-txt').textContent = show ? 'HIDE' : 'SHOW';
  }
}

/** The visualizer must run on the animation clock of whichever window the deck is in. */
function restartViz() {
  stopViz?.();
  stopViz = null;
  syncViz();
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

wide.addEventListener('change', applyStage);
window.addEventListener('resize', debounce(fitStage, 150));
window.addEventListener('skinchange', () => setTimeout(fitStage, 50));
window.addEventListener('hashchange', () => { if (isStage()) toggleDrawer(true); });

// ---------------------------------------------------------------- wiring

player.addEventListener('change', () => {
  updatePlayerUi();
  refreshRows();
});
wide.addEventListener('change', () => { syncViz(); updatePlayerUi(); });
player.addEventListener('time', updateTime);
player.addEventListener('auth-required', (e) => {
  const p = getProvider(e.detail.providerId);
  toast(`Sign in to ${p.label} again to keep playing`, {
    timeout: 0,
    action: { label: 'Sign in', run: () => p.reconnect().then(() => player.toggle()).catch((err) => toast(err.message)) },
  });
});
player.addEventListener('track-error', (e) => toast(`Skipped “${e.detail.track.name}”: ${e.detail.error.message}`));

store.events.addEventListener('saved', () => { refreshRows(); updatePlayerUi(); });
downloads.downloads.addEventListener('change', () => { refreshRows(); updatePlayerUi(); });
downloads.downloads.addEventListener('error', (e) =>
  toast(`Couldn’t save “${e.detail.track.name}”: ${e.detail.error.message}`));

// Google sign-in tokens only last an hour; refresh during real clicks so long sessions continue.
document.addEventListener('click', () => {
  if (providers.gdrive.isConnected() && (player.current?.provider === 'gdrive' || location.hash.startsWith('#/b/gdrive'))) {
    providers.gdrive.keepAlive();
  }
}, { capture: true });

document.addEventListener('keydown', onKey);
function onKey(e) {
  if (e.target.closest?.('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  // Space and Enter press whatever button or link has focus; only take them over otherwise.
  const onControl = e.target.closest?.('button, a[href], summary, [role=button], [role=switch]');
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setStage(!store.settings.stage); return; }
  if ((e.key === 'l' || e.key === 'L') && isStage()) { e.preventDefault(); toggleDrawer(); return; }
  if (e.code === 'Space' && player.current && !onControl) { e.preventDefault(); player.toggle(); }
  if (e.key === 'Escape') { closeFull(); toggleDrawer(false); }
  // Classic keyboard layout: z x c v b = previous, play, pause, stop, next.
  const keys = {
    z: () => player.prev(),
    x: () => !player.playing && player.toggle(),
    c: () => player.playing && player.toggle(),
    v: () => player.stop(),
    b: () => player.next(),
  };
  keys[e.key.toLowerCase()]?.();
}

function updateOnline() {
  $('#offline').hidden = navigator.onLine;
  refreshRows();
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
window.addEventListener('hashchange', render);

/**
 * Music Box moved to a new Dropbox app (read-only access to the whole Dropbox, instead of one app
 * folder). Sign-ins from the old app don't carry over, so ask for one reconnect; afterwards, point
 * pins and records' folders at where the old app folder's contents now appear (Apps/<old app>/).
 */
async function switchDropboxApp() {
  const { dropbox } = providers;
  if (dropbox.needsReconnect()) {
    toast('Music Box has a new Dropbox connection that can read your whole Dropbox. Reconnect once to keep playing.', {
      timeout: 0,
      action: { label: 'Reconnect', run: () => dropbox.reconnectFromAppFolder() },
    });
    return;
  }
  if (!dropbox.isConnected()) return;
  const old = (id) => !String(id).startsWith('pick:'); // picks keep working as they are
  const pinIds = pins().filter((f) => f.pid === 'dropbox' && old(f.id)).map((f) => f.id);
  const recIds = myRecords().filter((r) => r.source?.pid === 'dropbox' && old(r.source.id)).map((r) => r.source.id);
  try {
    const moved = await dropbox.moveFromAppFolder([...new Set([...pinIds, ...recIds])]);
    if (!moved.size) return;
    store.setSetting('pins', pins().map((f) => (f.pid === 'dropbox' && moved.has(f.id) ? { ...f, id: moved.get(f.id) } : f)));
    moveRecordSources('dropbox', moved);
    toast(moved.size === 1 ? 'Updated 1 pinned Dropbox folder to its new location' : `Updated ${moved.size} pinned Dropbox folders to their new location`);
    updatePlayerUi();
    render();
  } catch (err) {
    console.warn('Dropbox folder move', err);
  }
}

async function start() {
  $('#back').innerHTML = icons.back;
  $('#settings-link').innerHTML = icons.settings;
  $('#fab-skin').innerHTML = icons.dice;
  $('#fab-skin').addEventListener('click', () => {
    const fab = $('#fab-skin');
    fab.classList.remove('roll');
    void fab.offsetWidth; // restart the roll animation
    fab.classList.add('roll');
    generateAndApply();
  });
  buildPlayerUi();
  applySkin(currentSkin());
  requestAnimationFrame(() => paintSkinArt(currentSkin()));
  await store.init();
  if (store.isBlocked()) {
    toast('Music Box is open in another tab or window. Close the others so this tab can save songs and pictures.', { timeout: 9000 });
    store.events.addEventListener('db-ready', () => toast('This tab can save songs and pictures again'), { once: true });
  }
  await providers.local.init().catch(() => {});
  let cameBack = false; // back from a Dropbox sign-in page
  try {
    const { dropbox } = providers;
    const pending = JSON.parse(sessionStorage.getItem(PENDING_SHARE) || 'null');
    let returned = false;
    try {
      returned = await dropbox.handleRedirect();
    } catch (err) {
      // Dropbox sent us back with an error (often: sharing permissions not ticked in the console).
      cameBack = true;
      sessionStorage.removeItem(PENDING_SHARE);
      if (pending) {
        history.replaceState(null, '', hashFor.folder(pending.pid, pending.folderId, pending.name));
        setTimeout(() => dropboxSharingHelp(err.message, pending), 300);
      } else throw err;
    }
    if (returned) {
      cameBack = true;
      sessionStorage.removeItem(PENDING_SHARE);
      if (pending) {
        history.replaceState(null, '', hashFor.folder(pending.pid, pending.folderId, pending.name));
        if (dropbox.canShare()) {
          toast('Dropbox can now make share links. Creating your record…');
          setTimeout(() => openShareDialog(pending, { auto: true }), 300);
        } else {
          setTimeout(() => dropboxSharingHelp('the sharing permission wasn\'t granted', pending), 300);
        }
      } else {
        toast('Dropbox connected');
        history.replaceState(null, '', hashFor.folder(dropbox.id, dropbox.rootId, dropbox.rootName));
      }
    }
  } catch (err) {
    toast(err.message, { timeout: 8000 });
  }
  switchDropboxApp();
  // Phones open on the player itself; the library is one tap away (the arrow at its top right).
  // Not when coming back from signing in, or when a link goes to Settings or the Skin Studio.
  const first = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (!wide.matches && !cameBack && first !== 'settings' && first !== 'studio') openFull();
  updateOnline();
  updatePlayerUi();
  syncViz();
  $('#library-toggle').innerHTML = `${icons.library}<span>Library</span>`;
  $('#library-toggle').addEventListener('click', () => toggleDrawer());
  applyStage();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

start();

// Exposed for debugging in the browser console.
window.musicBox = { player, store, providers };
