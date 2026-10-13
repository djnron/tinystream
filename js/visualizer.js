// Optional audio-reactive visualizer. Off by default: routing audio through Web Audio can stop
// background playback on some mobile browsers, so the user opts in from Settings.
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
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  ctx.createMediaElementSource(audio).connect(analyser);
  analyser.connect(ctx.destination);
  freq = new Uint8Array(analyser.frequencyBinCount);
  wave = new Uint8Array(analyser.fftSize);
  audio.addEventListener('play', () => ctx.state === 'suspended' && ctx.resume());
}

export const isAttached = () => Boolean(ctx);

/** Draws into `canvas` every frame until the returned stop() is called. */
export function run(canvas, hue = 260) {
  const g = canvas.getContext('2d');
  let raf = 0;
  let energySmoothed = 0;

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const cx = w / 2;
    const cy = hgt / 2;
    const base = Math.min(w, hgt) * 0.28;

    if (!analyser) {
      // Not attached: calm placeholder disc.
      g.fillStyle = `hsl(${hue} 60% 55% / 0.85)`;
      g.beginPath();
      g.arc(cx, cy, base, 0, Math.PI * 2);
      g.fill();
      return;
    }

    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);

    // Low-end energy drives a pulsing core.
    let energy = 0;
    const lowBins = 48;
    for (let i = 0; i < lowBins; i++) energy += freq[i];
    energy /= lowBins * 255;
    energySmoothed += (energy - energySmoothed) * 0.2;

    const core = base * (0.85 + energySmoothed * 0.5);
    const grad = g.createRadialGradient(cx, cy, core * 0.1, cx, cy, core * 1.6);
    grad.addColorStop(0, `hsl(${hue} 80% 65% / 0.95)`);
    grad.addColorStop(1, `hsl(${(hue + 60) % 360} 80% 50% / 0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, core * 1.6, 0, Math.PI * 2);
    g.fill();

    // Radial spectrum bars.
    const bars = 96;
    const usable = Math.floor(freq.length * 0.6);
    g.lineCap = 'round';
    g.lineWidth = Math.max(2, (Math.PI * 2 * core) / bars / 2.2);
    for (let i = 0; i < bars; i++) {
      // Log-ish mapping so bass doesn't hog the circle.
      const idx = Math.floor((Math.pow(i / bars, 1.8)) * usable);
      const v = freq[idx] / 255;
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const r1 = core * 1.05;
      const r2 = r1 + v * base * 0.9 + 2;
      g.strokeStyle = `hsl(${(hue + i * 1.5) % 360} 85% ${55 + v * 20}% / ${0.35 + v * 0.65})`;
      g.beginPath();
      g.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
      g.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
      g.stroke();
    }

    // Waveform ring.
    g.lineWidth = 1.5;
    g.strokeStyle = `hsl(${hue} 30% 95% / 0.7)`;
    g.beginPath();
    for (let i = 0; i <= 256; i++) {
      const sample = (wave[Math.floor((i / 256) * (wave.length - 1))] - 128) / 128;
      const angle = (i / 256) * Math.PI * 2;
      const r = core * 0.7 + sample * core * 0.25;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  frame();
  return () => cancelAnimationFrame(raf);
}
