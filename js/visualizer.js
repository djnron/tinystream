// Retro LCD visualizer: chunky spectrum bars with falling peak caps, or an oscilloscope line.
// It needs the audio routed through Web Audio, which can stop background playback on some
// phones, so it starts switched off and the user turns it on (tap the display or use Settings).
// Once attached, the audio element stays routed through the AudioContext until reload.

let ctx;
let analyser;
let freq;
let wave;

export function attach(audio) {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  ctx.createMediaElementSource(audio).connect(analyser);
  analyser.connect(ctx.destination);
  freq = new Uint8Array(analyser.frequencyBinCount);
  wave = new Uint8Array(analyser.fftSize);
  audio.addEventListener('play', () => ctx.state === 'suspended' && ctx.resume());
  if (!audio.paused) ctx.resume();
}

export const isAttached = () => Boolean(ctx);

const PIXEL = 3; // CSS pixels per "LCD pixel"

let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  colors = { low: v('--vis-low'), high: v('--vis-high'), peak: v('--vis-peak'), dim: v('--lcd-dim') };
}
window.addEventListener('skinchange', readColors);

/**
 * Draws into `canvas` every frame until the returned stop() is called.
 * `getMode` returns 'bars' | 'scope' | 'off' and is read each frame.
 */
export function run(canvas, getMode) {
  const g = canvas.getContext('2d');
  let raf = 0;
  let peaks = [];
  let levels = [];
  if (!colors.low) readColors();

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const w = Math.max(8, Math.floor(canvas.clientWidth / PIXEL));
    const h = Math.max(6, Math.floor(canvas.clientHeight / PIXEL));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      peaks = [];
      levels = [];
    }
    g.clearRect(0, 0, w, h);
    const mode = getMode();
    const live = Boolean(analyser) && mode !== 'off';

    if (mode === 'scope') {
      if (live) analyser.getByteTimeDomainData(wave);
      g.fillStyle = colors.high;
      for (let x = 0; x < w; x++) {
        const sample = live ? (wave[Math.floor((x / w) * wave.length)] - 128) / 128 : 0;
        const y = Math.round(h / 2 - sample * (h / 2 - 1));
        g.fillRect(x, Math.min(h - 1, Math.max(0, y)), 1, 1);
      }
      return;
    }

    // Bars: 3-pixel-wide columns with a 1-pixel gap, log-spaced over the spectrum.
    const bars = Math.max(4, Math.floor((w + 1) / 4));
    if (live) analyser.getByteFrequencyData(freq);
    const usable = freq ? Math.floor(freq.length * 0.7) : 0;
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, colors.low);
    grad.addColorStop(1, colors.high);
    for (let i = 0; i < bars; i++) {
      let v = 0;
      if (live) {
        const lo = Math.floor(Math.pow(i / bars, 2) * usable);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 2) * usable));
        for (let j = lo; j < hi; j++) v = Math.max(v, freq[j]);
        v /= 255;
      }
      // Smooth fall-off so bars drop like the old analyzers.
      levels[i] = Math.max(v, (levels[i] || 0) - 0.04);
      const barH = Math.round(levels[i] * h);
      const x = i * 4;
      g.fillStyle = colors.dim;
      g.fillRect(x, h - 1, 3, 1);
      if (barH > 0) {
        g.fillStyle = grad;
        g.fillRect(x, h - barH, 3, barH);
      }
      peaks[i] = Math.max(barH, (peaks[i] || 0) - 0.25);
      if (peaks[i] >= 1) {
        g.fillStyle = colors.peak;
        g.fillRect(x, h - Math.ceil(peaks[i]) - 1, 3, 1);
      }
    }
  };
  frame();
  return () => cancelAnimationFrame(raf);
}
