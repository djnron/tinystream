import * as downloads from './downloads.js';
import { icons } from './icons.js';
import { Player } from './player.js';
import { getProvider, providers, registerHidden } from './providers/index.js';
import { createRecord, downloadUrl, myRecords, openRecord, sharedSource, stopSharing } from './share.js';
import * as store from './store.js';
import { AuthRequiredError, extOf, fmtBytes, h, isNetworkError, toast } from './util.js';
import { lcdDigits, lcdTime } from './lcd.js';
import { paint as paintSkinArt, repaint as repaintSkinArt, setOtherDocument } from './skin-art.js';
import { generateSkin, museumUrl } from './skin-generator.js';
import { applySkin, parseSkinFile, SKINS, skinTemplate, TOKENS } from './skins.js';
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
  return homeView();
}

function setTitle(text) {
  // The logo already says Music Box, so the home screen's title shows the sections instead.
  $('#title').textContent = text === 'Music Box' ? 'Home' : text;
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
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, f.name))))));
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
  const cards = Object.values(providers).map((p) => {
    const configured = p.isConfigured();
    const connected = configured && p.isConnected();
    const isLocal = p.id === 'local';
    let status;
    let actions;
    if (!configured) {
      status = 'Not set up — add your key in config.js (see README).';
    } else if (connected) {
      status = isLocal ? `Playing from “${p.rootName}” · files stay on this device` : 'Connected · read-only access';
      actions = [
        h('a', { class: 'btn primary', href: hashFor.folder(p.id, p.rootId, p.rootName) }, 'Browse'),
        isLocal && h('button', { class: 'btn', onclick: () => connect(p) }, 'Change folder'),
        h('button', { class: 'btn', onclick: () => disconnect(p) }, isLocal ? 'Forget' : 'Disconnect'),
      ];
    } else {
      status = isLocal ? 'Play music from a folder on this computer or phone. No account needed.' : 'Not connected';
      actions = [h('button', { class: 'btn primary', onclick: () => connect(p) },
        isLocal ? 'Choose a music folder' : `Connect ${p.label}`)];
    }
    return h('section', { class: `card source ${configured ? '' : 'disabled'}` },
      h('div', { class: 'card-head' }, iconSpan(isLocal ? 'folder' : 'cloud', `ico badge ${p.id}`),
        h('div', {}, h('h2', {}, p.label), h('p', { class: 'muted' }, status))),
      actions && h('div', { class: 'actions' }, actions));
  });

  const device = store.settings.allowDownloads || store.savedIds.size
    ? h('a', { class: 'card source link-card', href: hashFor.saved() },
      h('div', { class: 'card-head' }, iconSpan('phone', 'ico badge device'),
        h('div', {}, h('h2', {}, 'Saved for offline'),
          h('p', { class: 'muted' }, `${store.savedIds.size} saved track${store.savedIds.size === 1 ? '' : 's'} · plays offline`))))
    : h('section', { class: 'card hint' },
      h('p', {}, h('strong', {}, 'Downloads are off. '),
        'Cloud music streams and nothing is stored on this device. ',
        h('a', { href: hashFor.settings() }, 'Change in Settings')));

  show(h('div', { class: 'stack' }, pinsCard(), ...cards, device));
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

function pinsCard() {
  const list = pins();
  return h('section', { class: 'card pins' },
    h('h2', {}, 'My folders'),
    list.length
      ? h('ul', { class: 'list pin-list' }, list.map((f) => {
        const p = getProvider(f.pid);
        return h('li', { class: 'row' },
          h('button', { class: 'row-main', onclick: () => playFolder(f), title: `Play everything in ${f.name}` },
            iconSpan('play', 'ico folder'),
            h('span', { class: 'row-text' },
              h('span', { class: 'row-title' }, f.name),
              h('span', { class: 'row-sub' }, p?.label || f.pid))),
          h('a', { class: 'icon-btn', href: hashFor.folder(f.pid, f.id, f.name), title: 'Open folder', html: icons.folder }),
          h('button', { class: 'icon-btn', title: 'Unpin', 'aria-label': `Unpin ${f.name}`, html: icons.close,
            onclick: () => { togglePin(f.pid, f.id, f.name); render(); } }));
      }))
      : h('p', { class: 'muted' }, 'Pin folders while browsing (☆ Pin) to switch your music here in one tap.'));
}

/** Plays a whole folder, subfolders included, and remembers it as the current source. */
async function playFolder(f) {
  const p = getProvider(f.pid);
  if (!p?.isConnected()) {
    toast(`Connect ${p?.label || 'that source'} first`);
    return;
  }
  const t = toast(`Loading “${f.name}”…`, { timeout: 0 });
  try {
    const tracks = await p.listRecursive(f.id, f.name, {
      onProgress: (n) => { t.firstChild.textContent = `Loading “${f.name}”… ${n}`; },
    });
    t.remove();
    if (!tracks.length) return toast(`No music in “${f.name}”`);
    currentSource = f;
    player.playList(tracks, 0);
    toast(`Playing ${tracks.length} tracks from “${f.name}”`);
  } catch (err) {
    t.remove();
    if (err instanceof AuthRequiredError) {
      toast(err.message, { timeout: 0, action: { label: 'Allow', run: () => p.reconnect().then(() => playFolder(f)).catch((e) => toast(e.message)) } });
    } else toast(err.message);
  }
}

/** The folder that's playing, for the player's folder switcher. */
let currentSource = null;

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
      if (p.id === 'local') {
        return show(crumbs, message('Allow access to your music folder', err.message,
          reconnectButton(p, render, 'Allow access'), h('button', { class: 'btn', onclick: () => connect(p) }, 'Choose another folder')));
      }
      return show(crumbs, message('Sign-in needed', `${p.label} needs you to sign in again.`, reconnectButton(p)));
    } else {
      return show(crumbs, message("Couldn't load this folder",
        isNetworkError(err) ? "You're offline and this folder isn't saved." : err.message,
        h('button', { class: 'btn', onclick: render }, 'Try again')));
    }
  }
  if (stale()) return;

  const { folders, tracks } = listing;
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
      title: pinned ? 'Unpin from My folders' : 'Pin to My folders for one-tap switching',
      onclick: () => { togglePin(pid, folderId, name); render(); },
    }, pinned ? '★ Pinned' : '☆ Pin'),
    tracks.length > 0 && h('button', { class: 'btn primary', onclick: () => { currentSource = { pid, id: folderId, name }; player.playList(tracks, 0, { shuffle: false }); } },
      iconSpan('play'), 'Play'),
    tracks.length > 0 && h('button', { class: 'btn', onclick: () => { currentSource = { pid, id: folderId, name }; player.playList(tracks, 0, { shuffle: true }); } },
      iconSpan('shuffle'), 'Shuffle'),
    folders.length > 0 && !fromCache && h('button', { class: 'btn', onclick: () => playFolder({ pid, id: folderId, name }) },
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
    (tracks.length || folders.length || extra.length) ? actions : null,
    folders.length ? folderList(pid, folders) : null,
    tracks.length ? trackList(tracks, { sub: () => '' }) : null,
    !tracks.length && !folders.length ? message('Nothing here', p.emptyHint?.(folderId) || 'No folders or audio files in this folder.') : null);
  refreshRows();
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

  const cur = currentSkin();
  const skinSection = h('section', { class: 'card' },
    h('h2', {}, 'Skin'),
    h('div', { class: 'actions gen' },
      h('button', { class: 'btn primary big', onclick: generateAndApply }, iconSpan('dice'), 'Generate a skin')),
    h('p', { class: 'setting-desc' },
      'Each press mixes palettes from real classic skins in the ',
      h('a', { href: 'https://skins.webamp.org/', target: '_blank', rel: 'noopener' }, 'Winamp Skin Museum'),
      ' into a new design.'),
    cur.inspiredBy?.length ? h('p', { class: 'setting-desc inspired' }, `“${cur.name}” is inspired by `,
      cur.inspiredBy.map((src, i) => [i ? ' + ' : '',
        h('a', { href: museumUrl(src.id), target: '_blank', rel: 'noopener' }, src.name)])) : null,
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

  show(h('div', { class: 'stack' }, skinSection, recordsSection(), downloadsSection, playbackSection, accounts, about));
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
    genToast = toast(`🎲 ${sk.name} — inspired by ${from}`, {
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
    toast(`Couldn't generate a skin: ${err.message}`);
  } finally {
    generating = false;
  }
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

// ---------------------------------------------------------------- shared records
//
// "Share as record" turns on link sharing for one folder's songs and makes a link that carries the
// track list and your skin (see share.js). Anyone can open it and listen without an account.

const PENDING_SHARE = 'mb.pendingShare';

function modal(...children) {
  const dlg = h('dialog', { class: 'modal' }, ...children);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

async function openShareDialog({ pid, folderId, name, title, noDownload = true }, { auto = false } = {}) {
  const p = getProvider(pid);
  const t = toast(`Collecting songs in “${name}”…`, { timeout: 0 });
  let tracks;
  try {
    tracks = await p.listRecursive(folderId, name);
  } catch (err) {
    t.remove();
    return toast(err.message);
  }
  t.remove();
  if (!tracks.length) return toast('There are no songs here to share');
  const skin = currentSkin();
  const where = pid === 'gdrive' ? 'Google Drive' : 'Dropbox';
  const titleInput = h('input', { type: 'text', value: title || name, maxlength: 80, 'aria-label': 'Record title' });
  const lock = h('input', { type: 'checkbox', checked: noDownload });
  const status = h('p', { class: 'setting-desc', role: 'status' });
  const go = h('button', { class: 'btn primary' }, 'Create link');
  const body = h('div', { class: 'modal-body' },
    h('h2', {}, '⤴ Share as record'),
    h('label', { class: 'field' }, h('span', {}, 'Title'), titleInput),
    h('label', { class: 'setting' },
      h('span', { class: 'setting-text' },
        h('span', { class: 'setting-label' }, 'Disable downloads'),
        h('span', { class: 'setting-desc' }, 'Listeners get no download or save buttons. A deterrent, not a lock: '
          + 'someone technical could still save what their browser plays.')),
      lock),
    h('p', { class: 'setting-desc' },
      `${Math.min(tracks.length, 300)} song${tracks.length === 1 ? '' : 's'} from ${where}`,
      tracks.length > 300 ? ' (the first 300)' : '',
      `, in your skin “${skin.name}”. `,
      h('strong', {}, `These songs become viewable by anyone with the link in your ${where}`),
      '; nothing else is shared. You can stop sharing any time in Settings → Shared records. '
      + 'Only share music you have the right to share.'),
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
        onProgress: (n, total) => { status.textContent = `Sharing songs… ${n} / ${total}`; },
      });
      showShareResult(body, url, truncated);
    } catch (err) {
      go.disabled = false;
      if (err.code === 'dropbox-scope') {
        status.replaceChildren(h('div', { class: 'callout' },
          h('strong', {}, 'One-time step: let Dropbox make share links'),
          h('ol', { class: 'steps' },
            h('li', {}, 'In the ', h('a', { href: DROPBOX_CONSOLE, target: '_blank', rel: 'noopener' }, 'Dropbox App Console'),
              ' (opens in a new tab), open your app → ', h('strong', {}, 'Permissions'), ', tick ',
              h('strong', {}, 'sharing.read'), ' and ', h('strong', {}, 'sharing.write'), ', and click ', h('strong', {}, 'Submit'), '.'),
            h('li', {}, 'Come back to this tab and press the button below. Dropbox asks you to approve, then brings you '
              + 'back here and your link is made automatically.')),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              sessionStorage.setItem(PENDING_SHARE, JSON.stringify({ pid, folderId, name, title: titleInput.value, noDownload: lock.checked }));
              providers.dropbox.connect({ sharing: true, back: location.hash });
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

/** Explains the one-time Dropbox setting for sharing, with what Dropbox said if it refused. */
function dropboxSharingHelp(detail, pending) {
  const dlg = modal(h('div', { class: 'modal-body' },
    h('h2', {}, 'Dropbox didn\'t allow sharing yet'),
    detail && h('p', { class: 'setting-desc' }, 'Dropbox said: ', h('em', {}, detail)),
    h('p', {}, 'Your Dropbox app needs two permissions turned on. This is a one-time step:'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Open the ', h('a', { href: DROPBOX_CONSOLE, target: '_blank', rel: 'noopener' }, 'Dropbox App Console'), ' and click your app.'),
      h('li', {}, 'Go to the ', h('strong', {}, 'Permissions'), ' tab.'),
      h('li', {}, 'Tick ', h('strong', {}, 'sharing.read'), ' and ', h('strong', {}, 'sharing.write'), '.'),
      h('li', {}, 'Click ', h('strong', {}, 'Submit'), ' at the bottom of the page.')),
    h('p', { class: 'setting-desc' }, 'Then come back here and press “Try again”. You\'ll go to Dropbox to approve, '
      + 'and come straight back with your link made.'),
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

function showShareResult(body, url, truncated) {
  const field = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Record link', onfocus: (e) => e.target.select() });
  const copy = h('button', {
    class: 'btn primary',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'Copied ✓';
      } catch {
        field.select();
        copy.textContent = 'Press Ctrl/⌘-C';
      }
    },
  }, 'Copy link');
  body.replaceChildren(
    h('h2', {}, '✓ Your record is ready'),
    h('p', { class: 'setting-desc' }, 'Anyone with this link can listen, no account needed.',
      truncated ? ' Only the first 300 songs are included.' : ''),
    field,
    h('div', { class: 'actions' },
      copy,
      navigator.share && h('button', { class: 'btn', onclick: () => navigator.share({ title: 'A record for you', url }).catch(() => {}) }, 'Share…'),
      h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Open'),
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
            if (!confirm(`Stop sharing “${r.title}”? The link stops working and its songs are no longer shared.`)) return;
            try { await stopSharing(r.id); toast(`Stopped sharing “${r.title}”`); } catch (err) { toast(err.message, { timeout: 8000 }); }
            render();
          },
        }, 'Stop sharing'))))
      : h('p', { class: 'setting-desc' }, 'Open a Google Drive collection or a Dropbox folder and press “⤴ Share as record” to send it to someone.'));
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
    return show(message('This record link is damaged', 'Ask the sender to copy the link again.'));
  }
  if (stale()) return;
  setTitle(rec.title);
  if (rec.skin) {
    recordSkin = rec.skin;
    applySkin(rec.skin);
    requestAnimationFrame(() => paintSkinArt(rec.skin));
  }
  const play = (shuffle) => {
    currentSource = { pid: 'record', id: payload, name: rec.title };
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
        rec.skin && h('button', {
          class: 'btn',
          onclick: () => {
            const keep = { ...rec.skin, id: 'custom', inspiredBy: [] };
            store.setSetting('customSkin', keep);
            recordSkin = null;
            useSkin(keep);
            toast(`“${rec.skin.name}” is now your skin`);
          },
        }, 'Keep this skin'))),
    rec.tracks.length
      ? trackList(rec.tracks, { sub: () => '', extra: dl })
      : message('No songs', 'This record has no playable songs.'));
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
          canPopOut() && h('button', { class: 'tb-btn', id: 'btn-popout', title: 'Pop out: float the player above other windows', 'aria-label': 'Pop out player', html: icons.popout, onclick: () => (popWin ? popIn() : popOut()) }),
          h('button', { class: 'tb-btn', id: 'deck-close', 'aria-label': 'Close player', html: icons.down, onclick: closeFull }))),
      // Every part of the deck is a direct grid item, so skins can arrange them freely (see the
      // [data-deck] rules in css/app.css). Speakers and reels only show in the layouts that use them.
      h('div', { class: 'deck-body' },
        h('span', { class: 'speaker spk-l', 'aria-hidden': 'true' }),
        h('div', { class: 'lcd screen' },
          h('span', { class: 'lcd-state', id: 'lcd-state', 'aria-hidden': 'true' }),
          h('button', { class: 'lcd-time', id: 'lcd-time', title: 'Show elapsed / remaining time', onclick: toggleTimeMode }),
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
            class: 'tb-btn pl-fold', title: 'Fold the playlist away', 'aria-label': 'Fold playlist', 'aria-expanded': 'true', html: icons.down,
            onclick: (e) => {
              const pl = e.currentTarget.closest('.playlist');
              const before = pl.getBoundingClientRect().height;
              const folded = pl.classList.toggle('folded');
              // In the pop-out window, shrink or grow the window to match instead of leaving a gap.
              const win = pl.ownerDocument.defaultView;
              if (win !== window) {
                if (folded) pl.dataset.openHeight = String(Math.round(before));
                const delta = folded ? pl.getBoundingClientRect().height - before : Number(pl.dataset.openHeight || 240) - pl.getBoundingClientRect().height;
                try { win.resizeBy(0, Math.round(delta)); } catch { /* the browser decides */ }
              }
              e.currentTarget.setAttribute('aria-expanded', String(!folded));
              e.currentTarget.title = folded ? 'Show the playlist' : 'Fold the playlist away';
            },
          }))),
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
  $('#btn-repeat .btn-ico').innerHTML = s.repeat === 'one' ? icons.repeatOne : icons.repeat;
  $('#btn-repeat .btn-txt').textContent = s.repeat === 'one' ? 'REP 1' : 'REP';
  document.documentElement.toggleAttribute('data-playing', player.playing);
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

// ---------------------------------------------------------------- stage mode and pop-out
//
// Stage: the player fills the page (scaled up with CSS zoom) and the library slides in as a drawer.
// Pop-out: the deck moves into its own small window. In Chrome and Edge that window stays on top of
// everything (Document Picture-in-Picture); elsewhere it's an ordinary pop-up window.

const stageQuery = matchMedia('(min-width: 900px)');
const isStage = () => Boolean(store.settings.stage) && stageQuery.matches && !popWin;

function setStage(on) {
  store.setSetting('stage', on);
  applyStage();
  toast(on ? 'Stage mode: the library is in the drawer (☰ Library, or press L)' : 'Stage mode off', { timeout: 2500 });
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
  const zoom = Math.max(1, Math.min(2.6, availW / (natural.width * 2 + 24), availH / natural.height));
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
  // Room for the deck plus a scrolling song list underneath.
  const height = Math.round(Math.max(260, deck.scrollHeight) + 240);
  let win;
  try {
    win = 'documentPictureInPicture' in window
      ? await window.documentPictureInPicture.requestWindow({ width, height })
      : window.open('', 'music-box-player', `popup,width=${width},height=${height}`);
  } catch (err) {
    toast(`Couldn't pop out the player: ${err.message}`);
    return;
  }
  if (!win) {
    toast('Your browser blocked the pop-out window. Allow pop-ups for this site and try again.');
    return;
  }
  popWin = win;
  popDoc = win.document;
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
  popDoc.body.append(deck, ...[full.querySelector('.playlist')].filter(Boolean));
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
  popDoc = null;
  rootSync?.disconnect();
  setOtherDocument(null);
  full.querySelector('.popped-note')?.remove();
  if (list) full.prepend(list);
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
  btn.title = popWin ? 'Put the player back in the page' : 'Pop out: float the player above other windows';
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

stageQuery.addEventListener('change', applyStage);
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

document.addEventListener('keydown', onKey);
function onKey(e) {
  if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setStage(!store.settings.stage); return; }
  if ((e.key === 'l' || e.key === 'L') && isStage()) { e.preventDefault(); toggleDrawer(); return; }
  if (e.code === 'Space' && player.current) { e.preventDefault(); player.toggle(); }
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
  await providers.local.init().catch(() => {});
  try {
    const { dropbox } = providers;
    const pending = JSON.parse(sessionStorage.getItem(PENDING_SHARE) || 'null');
    let returned = false;
    try {
      returned = await dropbox.handleRedirect();
    } catch (err) {
      // Dropbox sent us back with an error (often: sharing permissions not ticked in the console).
      sessionStorage.removeItem(PENDING_SHARE);
      if (pending) {
        history.replaceState(null, '', hashFor.folder(pending.pid, pending.folderId, pending.name));
        setTimeout(() => dropboxSharingHelp(err.message, pending), 300);
      } else throw err;
    }
    if (returned) {
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
