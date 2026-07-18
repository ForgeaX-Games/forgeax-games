// Hellforge SFX — tiny synthesized WebAudio kit (no audio assets).
//
// Half of "打击感" is sound. Every effect here is a short oscillator/noise
// envelope, mixed through one master gain. The AudioContext can only start
// after a user gesture — install() arms a one-time pointer/key listener and
// every play call before that is silently dropped.
//
// Design rules: hits are LOW and SHORT (thud > click), kills add a downward
// pitch sweep (weight), casts are noise whooshes tinted by skill, pickups
// are high dings quiet enough to spam.

type SfxName =
  | 'cast-magma' | 'cast-frost' | 'cast-arc' | 'blink'
  | 'hit' | 'crit' | 'kill' | 'boss-kill'
  | 'player-hurt' | 'player-die'
  | 'pickup' | 'potion' | 'equip' | 'levelup' | 'portal' | 'quest';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastAt = new Map<SfxName, number>();
  /** User-facing 0..1 (F10 「音效」); scales BASE_GAIN. */
  private volume = 1;
  private static readonly BASE_GAIN = 0.42;

  /** Arm the context on the first user gesture (autoplay policy). */
  install(): void {
    const arm = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = Sfx.BASE_GAIN * this.volume;
        this.master.connect(this.ctx.destination);
      } catch { /* no audio — fine */ }
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
  }

  /** 0..1 — applied immediately if AudioContext is already armed. */
  setVolume(v: number): void {
    this.volume = v < 0 ? 0 : v > 1 ? 1 : v;
    if (this.master) this.master.gain.value = Sfx.BASE_GAIN * this.volume;
  }

  /** Rate-limited play (default ≥45 ms between repeats of the same sfx). */
  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const last = this.lastAt.get(name) ?? -1;
    if (now - last < 0.045) return;
    this.lastAt.set(name, now);
    switch (name) {
      case 'cast-magma': this.noise(0.12, 900, 0.5, 0.22); this.tone('sine', 220, 90, 0.10, 0.10); break;
      case 'cast-frost': this.noise(0.10, 2600, 0.7, 0.16); this.tone('sine', 1250, 900, 0.09, 0.07); break;
      case 'cast-arc':   this.buzz(0.10, 0.16); break;
      case 'blink':      this.tone('sine', 800, 180, 0.16, 0.14); this.noise(0.12, 1800, 0.4, 0.10); break;
      case 'hit':        this.tone('triangle', 160, 90, 0.07, 0.30); this.noise(0.04, 700, 0.4, 0.18); break;
      case 'crit':       this.tone('triangle', 210, 70, 0.10, 0.40); this.noise(0.06, 900, 0.5, 0.26); break;
      case 'kill':       this.tone('sawtooth', 180, 40, 0.20, 0.30); this.noise(0.10, 500, 0.6, 0.24); break;
      case 'boss-kill':  this.tone('sawtooth', 130, 28, 0.7, 0.45); this.noise(0.5, 400, 0.8, 0.35); break;
      case 'player-hurt': this.tone('square', 130, 80, 0.09, 0.26); break;
      case 'player-die': this.tone('sawtooth', 220, 40, 0.9, 0.4); break;
      case 'pickup':     this.tone('sine', 1180, 1560, 0.07, 0.10); break;
      case 'potion':     this.tone('sine', 620, 940, 0.12, 0.16); break;
      case 'equip':      this.tone('triangle', 520, 780, 0.10, 0.18); this.tone('triangle', 780, 1170, 0.10, 0.14, 0.06); break;
      case 'levelup':
        this.tone('sine', 523, 523, 0.10, 0.20);
        this.tone('sine', 659, 659, 0.10, 0.20, 0.09);
        this.tone('sine', 784, 784, 0.16, 0.22, 0.18);
        break;
      case 'portal':     this.tone('sine', 300, 900, 0.35, 0.18); this.noise(0.3, 1400, 0.5, 0.10); break;
      case 'quest':
        this.tone('sine', 587, 587, 0.12, 0.2);
        this.tone('sine', 880, 880, 0.22, 0.22, 0.12);
        break;
    }
  }

  /** One oscillator: freq f0 → f1 over dur, exp-decay envelope. */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered white-noise burst (whooshes, crunch layers). */
  private noise(dur: number, cutoff: number, q: number, vol: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, Math.max(1, n), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0);
  }

  /** Crackly arc-lightning buzz: rapid random square retriggers. */
  private buzz(dur: number, vol: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const at = t0 + (i / 5) * dur;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 700 + Math.random() * 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * (0.5 + Math.random() * 0.5), at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      osc.connect(g).connect(this.master!);
      osc.start(at);
      osc.stop(at + 0.04);
    }
  }
}
