// Manual "save to device" queue. Runs one download at a time and refuses to run at all
// unless the user has turned on "Allow downloads" in Settings.

import { getProvider } from './providers/index.js';
import * as store from './store.js';

export const downloads = new EventTarget();
let queue = [];
let active = null; // { track, controller }

const emit = () => downloads.dispatchEvent(new Event('change'));

export function status() {
  return { active: active?.track ?? null, pending: queue.length };
}

export function isQueued(id) {
  return active?.track.id === id || queue.some((t) => t.id === id);
}

export function enqueue(tracks) {
  if (!store.settings.allowDownloads) throw new Error('Turn on "Allow downloads" in Settings first');
  const fresh = tracks.filter((t) => !store.savedIds.has(t.id) && !isQueued(t.id));
  queue.push(...fresh);
  emit();
  pump();
  return fresh.length;
}

export function cancelAll() {
  queue = [];
  active?.controller.abort();
  emit();
}

async function pump() {
  if (active || !queue.length) return;
  const track = queue.shift();
  active = { track, controller: new AbortController() };
  emit();
  try {
    const blob = await getProvider(track.provider).fetchBlob(track, { signal: active.controller.signal });
    if (store.settings.allowDownloads) await store.saveTrack(track, blob);
  } catch (err) {
    if (err.name !== 'AbortError') {
      downloads.dispatchEvent(new CustomEvent('error', { detail: { track, error: err } }));
      if (err.name === 'AuthRequiredError') queue = queue.filter((t) => t.provider !== track.provider);
    }
  } finally {
    active = null;
    emit();
    pump();
  }
}

// Turning downloads off stops anything in flight immediately.
store.events.addEventListener('settings', (e) => {
  if (e.detail.key === 'allowDownloads' && !e.detail.value) cancelAll();
});
