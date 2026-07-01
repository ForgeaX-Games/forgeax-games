/** Procedural ice-workshop audio (Stage A fallback). */

let bgmOsc: OscillatorNode | null = null;
let bgmGain: GainNode | null = null;
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

export function bindAudioGesture(): void {
  const unlock = () => {
    void startBgm();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function startBgm(): void {
  const c = getCtx();
  if (!c || bgmOsc) return;
  bgmGain = c.createGain();
  bgmGain.gain.value = 0.04;
  bgmGain.connect(c.destination);
  bgmOsc = c.createOscillator();
  bgmOsc.type = 'sine';
  bgmOsc.frequency.value = 110;
  bgmOsc.connect(bgmGain);
  bgmOsc.start();
}

export function playCutClean(): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.connect(gain);
  gain.connect(c.destination);
  const t = c.currentTime;
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  osc.start(t);
  osc.stop(t + 0.15);
}

export function playBladeThunk(): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(c.destination);
  const t = c.currentTime;
  osc.frequency.setValueAtTime(90, t);
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.start(t);
  osc.stop(t + 0.09);
}
