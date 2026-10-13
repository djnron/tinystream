import * as downloads from './downloads.js';
import { icons } from './icons.js';
import { Player } from './player.js';
import { getProvider, providers } from './providers/index.js';
import * as store from './store.js';
import { AuthRequiredError, fmtBytes, fmtTime, h, hueOf, isNetworkError, toast } from './util.js';
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
    settingToggle({
      label: 'Visualizer',
      desc: 'Animated graphics that react to the music. May interrupt background playback on some phones.',
      checked: s.visualizer,
      onchange: (on) => {
        store.setSetting('visualizer', on);
        if (on) visualizer.attach(player.audio);
        else if (visualizer.isAttached()) toast('Visualizer turns fully off after reloading the app');
      },
    }));

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

  show(h('div', { class: 'stack' }, downloadsSection, playbackSection, accounts, about));
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

// ---------------------------------------------------------------- now playing (mini bar + full screen)

const mini = $('#mini');
const full = $('#full');
let stopViz = null;

function buildPlayerUi() {
  mini.replaceChildren(
    h('div', { class: 'mini-progress' }, h('span', { id: 'mini-bar' })),
    h('button', { class: 'mini-info', onclick: openFull, 'aria-label': 'Open player' },
      h('span', { class: 'art', id: 'mini-art' }),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title', id: 'mini-title' }),
        h('span', { class: 'row-sub', id: 'mini-sub' }))),
    h('button', { class: 'icon-btn', 'aria-label': 'Previous', html: icons.prev, onclick: () => player.prev() }),
    h('button', { class: 'icon-btn big', id: 'mini-play', 'aria-label': 'Play', onclick: () => player.toggle() }),
    h('button', { class: 'icon-btn', 'aria-label': 'Next', html: icons.next, onclick: () => player.next() }));

  const seek = h('input', { type: 'range', id: 'seek', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek' });
  seek.addEventListener('input', () => { seek.dataset.dragging = '1'; $('#t-cur').textContent = fmtTime(Number(seek.value)); });
  seek.addEventListener('change', () => { delete seek.dataset.dragging; player.seek(Number(seek.value)); });

  full.replaceChildren(
    h('header', { class: 'full-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close player', html: icons.down, onclick: closeFull }),
      h('span', {}, 'Now playing'),
      h('span', { class: 'icon-btn', id: 'full-save' })),
    h('canvas', { id: 'viz' }),
    h('div', { class: 'full-meta' },
      h('h2', { id: 'full-title' }),
      h('p', { class: 'muted', id: 'full-sub' })),
    h('div', { class: 'seek' }, seek,
      h('div', { class: 'times' }, h('span', { id: 't-cur' }, '0:00'), h('span', { id: 't-dur' }, '0:00'))),
    h('div', { class: 'controls' },
      h('button', { class: 'icon-btn', id: 'btn-shuffle', 'aria-label': 'Shuffle', html: icons.shuffle, onclick: () => player.toggleShuffle() }),
      h('button', { class: 'icon-btn', 'aria-label': 'Previous', html: icons.prev, onclick: () => player.prev() }),
      h('button', { class: 'icon-btn play-big', id: 'full-play', 'aria-label': 'Play', onclick: () => player.toggle() }),
      h('button', { class: 'icon-btn', 'aria-label': 'Next', html: icons.next, onclick: () => player.next() }),
      h('button', { class: 'icon-btn', id: 'btn-repeat', 'aria-label': 'Repeat', onclick: () => player.cycleRepeat() })),
    h('h3', { class: 'upnext-head' }, 'Up next'),
    h('ol', { class: 'list upnext', id: 'upnext' }));
}

function updatePlayerUi() {
  const t = player.current;
  mini.hidden = !t;
  document.body.classList.toggle('has-mini', Boolean(t));
  if (!t) return;
  const sub = player.loading ? 'Loading…' : player.error ? player.error.message : t.folder;
  const hue = hueOf(t.folder || t.name);
  $('#mini-art').style.setProperty('--hue', hue);
  $('#mini-title').textContent = t.name;
  $('#mini-sub').textContent = sub;
  $('#mini-sub').classList.toggle('error', Boolean(player.error));
  const playIcon = player.playing ? icons.pause : icons.play;
  const playLabel = player.playing ? 'Pause' : 'Play';
  for (const id of ['#mini-play', '#full-play']) {
    $(id).innerHTML = playIcon;
    $(id).setAttribute('aria-label', playLabel);
  }
  $('#full-title').textContent = t.name;
  $('#full-sub').textContent = sub;
  full.style.setProperty('--hue', hue);
  $('#btn-shuffle').classList.toggle('on', store.settings.shuffle);
  const rep = store.settings.repeat;
  $('#btn-repeat').innerHTML = rep === 'one' ? icons.repeatOne : icons.repeat;
  $('#btn-repeat').classList.toggle('on', rep !== 'off');
  $('#btn-repeat').title = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[rep];
  $('#full-save').replaceChildren(...[saveButton(t)].filter(Boolean));

  const upNext = player.upNext.slice(0, 50);
  $('#upnext').replaceChildren(...upNext.map((track, i) =>
    h('li', { class: 'row' },
      h('button', { class: 'row-main', onclick: () => player.jumpAhead(i) },
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, track.name),
          h('span', { class: 'row-sub' }, track.folder))))));
  if (!upNext.length) {
    $('#upnext').append(h('li', { class: 'muted pad' },
      rep === 'all' ? 'The list starts over after this track.' : 'Nothing after this track.'));
  }
  updateTime();
}

function updateTime() {
  const a = player.audio;
  const dur = Number.isFinite(a.duration) ? a.duration : 0;
  $('#mini-bar').style.width = dur ? `${(a.currentTime / dur) * 100}%` : '0%';
  if (full.hidden) return;
  const seek = $('#seek');
  seek.max = dur || 1;
  if (!seek.dataset.dragging) {
    seek.value = a.currentTime;
    $('#t-cur').textContent = fmtTime(a.currentTime);
  }
  $('#t-dur').textContent = fmtTime(dur);
}

function openFull() {
  full.hidden = false;
  document.body.classList.add('full-open');
  if (store.settings.visualizer) visualizer.attach(player.audio);
  stopViz?.();
  stopViz = visualizer.run($('#viz'), hueOf(player.current?.folder || player.current?.name || ''));
  updatePlayerUi();
}

function closeFull() {
  full.hidden = true;
  document.body.classList.remove('full-open');
  stopViz?.();
  stopViz = null;
}

// ---------------------------------------------------------------- wiring

player.addEventListener('change', () => {
  updatePlayerUi();
  refreshRows();
  if (!full.hidden && stopViz) {
    stopViz();
    stopViz = visualizer.run($('#viz'), hueOf(player.current?.folder || player.current?.name || ''));
  }
});
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
  if (e.key === 'Escape' && !full.hidden) closeFull();
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
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

start();

// Exposed for debugging in the browser console.
window.musicBox = { player, store, providers };
