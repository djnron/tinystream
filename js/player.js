// Queue + playback. Continuous play works by:
//   1. advancing automatically on 'ended' (with shuffle / repeat-all / repeat-one),
//   2. prefetching the next track while the current one plays, so the switch is near-instant
//      even when the app is in the background,
//   3. skipping tracks that fail to load instead of stopping the whole queue.

import { getProvider } from './providers/index.js';
import * as store from './store.js';
import { AuthRequiredError, isNetworkError } from './util.js';

const MAX_SKIPS = 5; // consecutive failures before giving up

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = store.settings.volume;
    this.queue = []; // tracks in their original order
    this.order = []; // indices into queue, in play order (shuffled or not)
    this.pos = -1; // position in `order`
    this.loading = false;
    this.error = null;
    this.objectUrl = null;
    this.loadSeq = 0;
    this.skips = 0;
    this.prefetched = new Map(); // track id -> { promise, controller }

    const a = this.audio;
    a.addEventListener('ended', () => this.next({ auto: true }));
    a.addEventListener('playing', () => { this.skips = 0; this.error = null; this.#emit(); });
    a.addEventListener('pause', () => this.#emit());
    a.addEventListener('play', () => this.#emit());
    a.addEventListener('durationchange', () => { this.#emit(); this.#updatePosition(); });
    a.addEventListener('timeupdate', () => this.dispatchEvent(new Event('time')));
    a.addEventListener('seeked', () => this.#updatePosition());
    a.addEventListener('error', () => {
      if (a.src) this.#skipAfterError(new Error('This file could not be played'));
    });
    this.#setupMediaSession();
  }

  get current() {
    return this.pos >= 0 ? this.queue[this.order[this.pos]] : null;
  }

  get playing() {
    return !this.audio.paused;
  }

  get upNext() {
    return this.order.slice(this.pos + 1).map((i) => this.queue[i]);
  }

  /** Replace the queue and start playing at `startIndex` (index into `tracks`). */
  playList(tracks, startIndex = 0, { shuffle = store.settings.shuffle } = {}) {
    if (!tracks.length) return;
    if (shuffle !== store.settings.shuffle) store.setSetting('shuffle', shuffle);
    this.queue = tracks.slice();
    this.order = this.#makeOrder(startIndex);
    this.#clearPrefetch();
    this.skips = 0;
    this.#playAt(shuffle ? 0 : startIndex);
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) {
      if (!this.audio.src || this.error) this.#playAt(this.pos);
      else this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  }

  next({ auto = false } = {}) {
    if (!this.current) return;
    if (auto && store.settings.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    if (this.pos + 1 < this.order.length) return this.#playAt(this.pos + 1);
    if (store.settings.repeat === 'all' || !auto) {
      if (store.settings.shuffle) this.order = this.#makeOrder();
      return this.#playAt(0);
    }
    // End of the queue with repeat off.
    this.audio.pause();
    this.audio.currentTime = 0;
    this.#emit();
  }

  prev() {
    if (!this.current) return;
    if (this.audio.currentTime > 3 || this.pos === 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.#playAt(this.pos - 1);
  }

  /** Play a track by its position in the queue's original order (as the playlist shows it). */
  playQueueIndex(queueIndex) {
    const pos = this.order.indexOf(queueIndex);
    if (pos >= 0) this.#playAt(pos);
  }

  stop() {
    this.audio.pause();
    if (this.audio.src) this.audio.currentTime = 0;
    this.#emit();
  }

  /** Index in `queue` of the track that's playing. */
  get queueIndex() {
    return this.pos >= 0 ? this.order[this.pos] : -1;
  }

  seek(seconds) {
    if (Number.isFinite(seconds)) this.audio.currentTime = seconds;
  }

  setVolume(v) {
    this.audio.volume = v;
    store.setSetting('volume', v);
  }

  toggleShuffle() {
    const on = !store.settings.shuffle;
    store.setSetting('shuffle', on);
    if (this.current) {
      const currentIndex = this.order[this.pos];
      this.order = this.#makeOrder(currentIndex);
      this.pos = on ? 0 : currentIndex;
      this.#clearPrefetch(this.current.id);
      this.#prefetchNext();
    }
    this.#emit();
  }

  cycleRepeat() {
    const nextMode = { off: 'all', all: 'one', one: 'off' }[store.settings.repeat] || 'all';
    store.setSetting('repeat', nextMode);
    this.#prefetchNext();
    this.#emit();
  }

  // ---------- internals ----------

  /** Play order over the queue: 0..n-1, or shuffled with queue index `first` (if given) up front. */
  #makeOrder(first = null) {
    const order = Array.from({ length: this.queue.length }, (_, i) => i);
    if (!store.settings.shuffle) return order;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (first != null) {
      const k = order.indexOf(first);
      [order[0], order[k]] = [order[k], order[0]];
    }
    return order;
  }

  async #playAt(pos) {
    if (pos < 0 || pos >= this.order.length) return;
    const seq = ++this.loadSeq;
    this.pos = pos;
    this.error = null;
    this.loading = true;
    this.audio.pause();
    this.#emit();

    const track = this.current;
    let blob;
    try {
      blob = await this.#getBlob(track);
    } catch (err) {
      if (seq !== this.loadSeq || err.name === 'AbortError') return;
      this.loading = false;
      if (err instanceof AuthRequiredError) {
        this.error = err;
        this.#emit();
        this.dispatchEvent(new CustomEvent('auth-required', { detail: err }));
        return;
      }
      return this.#skipAfterError(isNetworkError(err) ? new Error('Offline and not saved on this device') : err);
    }
    if (seq !== this.loadSeq) return;

    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    this.loading = false;
    this.#updateMetadata();
    this.#emit();
    try {
      await this.audio.play();
    } catch (err) {
      // Autoplay blocked (e.g. after a reload): wait for the user to press play.
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') console.warn(err);
      this.#emit();
    }
    this.#prefetchNext();
  }

  #skipAfterError(err) {
    const track = this.current;
    this.error = err;
    this.loading = false;
    this.skips++;
    this.#emit();
    this.dispatchEvent(new CustomEvent('track-error', { detail: { track, error: err } }));
    if (this.skips >= Math.min(MAX_SKIPS, this.queue.length)) return; // give up; user can retry
    const seq = this.loadSeq;
    setTimeout(() => {
      if (seq === this.loadSeq) this.next({ auto: true });
    }, 800);
  }

  async #getBlob(track) {
    const saved = await store.getBlob(track.id).catch(() => null);
    if (saved) return saved;
    const pre = this.prefetched.get(track.id);
    if (pre) {
      try {
        return await pre.promise;
      } catch (err) {
        if (err instanceof AuthRequiredError) throw err;
        this.prefetched.delete(track.id); // retry fresh below
      }
    }
    return this.#fetch(track).promise;
  }

  #fetch(track) {
    const controller = new AbortController();
    const promise = getProvider(track.provider)
      .fetchBlob(track, { signal: controller.signal })
      .then((blob) => {
        const { allowDownloads, saveOnPlay } = store.settings;
        // Local files are already on the device, so there's nothing to save.
        if (allowDownloads && saveOnPlay && track.provider !== 'local' && !store.savedIds.has(track.id)) {
          store.saveTrack(track, blob).catch((e) => console.warn('save failed', e));
        }
        return blob;
      });
    const entry = { promise, controller };
    this.prefetched.set(track.id, entry);
    promise.catch(() => {});
    return entry;
  }

  #nextTrack() {
    if (store.settings.repeat === 'one') return null;
    if (this.pos + 1 < this.order.length) return this.queue[this.order[this.pos + 1]];
    if (store.settings.repeat === 'all' && !store.settings.shuffle) return this.queue[this.order[0]];
    return null;
  }

  #prefetchNext() {
    const cur = this.current;
    const next = this.#nextTrack();
    // Keep at most the current and next downloads in memory.
    this.#clearPrefetch(cur?.id, next?.id);
    if (!next || next.id === cur?.id || store.savedIds.has(next.id) || this.prefetched.has(next.id)) return;
    this.#fetch(next);
  }

  #clearPrefetch(...keep) {
    for (const [id, entry] of this.prefetched) {
      if (keep.includes(id)) continue;
      entry.controller.abort();
      this.prefetched.delete(id);
    }
  }

  #emit() {
    this.dispatchEvent(new Event('change'));
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = this.current ? (this.playing ? 'playing' : 'paused') : 'none';
    }
  }

  #setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => this.toggle(),
      pause: () => this.audio.pause(),
      previoustrack: () => this.prev(),
      nexttrack: () => this.next(),
      seekto: (d) => this.seek(d.seekTime),
      seekbackward: (d) => this.seek(this.audio.currentTime - (d.seekOffset || 10)),
      seekforward: (d) => this.seek(this.audio.currentTime + (d.seekOffset || 10)),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        ms.setActionHandler(action, fn);
      } catch { /* action unsupported on this platform */ }
    }
  }

  #updateMetadata() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const t = this.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.name,
      artist: t.folder,
      album: t.folder,
      artwork: [
        { src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
        { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' },
      ],
    });
  }

  #updatePosition() {
    const a = this.audio;
    if (!('mediaSession' in navigator) || !Number.isFinite(a.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration,
        position: Math.min(a.currentTime, a.duration),
        playbackRate: a.playbackRate,
      });
    } catch { /* ignore */ }
  }
}
