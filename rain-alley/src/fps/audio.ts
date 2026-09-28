import { WEAPONS } from './weapons';
type Cue =
  | 'mag-out'
  | 'mag-in'
  | 'rack'
  | 'shell'
  | 'open'
  | 'close'
  | 'step'
  | 'land'
  | 'hit'
  | 'kill';
/** Original synthesized Foley. Cached layers, bounded voices, no external samples or autoplay. */
export class GunAudio {
  private context?: AudioContext;
  private master?: DynamicsCompressorNode;
  private buffers = new Map<string, AudioBuffer>();
  private voices: AudioBufferSourceNode[] = [];
  private rain?: AudioBufferSourceNode;
  private rainGain?: GainNode;
  private rainFilter?: BiquadFilterNode;
  private enabled = true;
  private stepAt = 0;
  private wasGrounded = true;
  private indoor = false;
  unlock() {
    const ctx = (this.context ??= new AudioContext());
    if (!this.master) {
      this.master = ctx.createDynamicsCompressor();
      this.master.threshold.value = -12;
      this.master.ratio.value = 5;
      this.master.connect(ctx.destination);
      const rain = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate),
        data = rain.getChannelData(0);
      let smoothed = 0;
      for (let i = 0; i < data.length; i++) {
        smoothed = smoothed * 0.72 + (Math.random() * 2 - 1) * 0.28;
        data[i] = smoothed * 0.024;
      }
      this.rain = ctx.createBufferSource();
      this.rain.buffer = rain;
      this.rain.loop = true;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = this.indoor ? 0.35 : 1;
      this.rainFilter = ctx.createBiquadFilter();
      this.rainFilter.type = 'lowpass';
      this.rainFilter.frequency.value = this.indoor ? 1200 : 8500;
      this.rain.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.master);
      this.rain.start();
    }
    void (this.enabled ? ctx.resume() : ctx.suspend());
  }
  enemy(distance: number, pan: number, melee: boolean) {
    const gain = Math.max(0.08, Math.min(0.45, 3 / Math.max(3, distance)));
    this.play(
      melee ? 'enemy-swing' : 'enemy-shot',
      melee ? 0.2 : 0.32,
      (t, n) =>
        melee
          ? n * Math.exp(-t * 23) * 0.22
          : (n * 0.55 + Math.sin(t * 650) * 0.25) * Math.exp(-t * 25),
      gain,
      0,
      Math.max(-1, Math.min(1, pan)),
    );
  }
  hurt() {
    this.play(
      'player-hurt',
      0.22,
      (t, n) => (Math.sin(t * 360) * 0.3 + n * 0.12) * Math.exp(-t * 18),
      0.7,
    );
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.context)
      void (this.enabled ? this.context.resume() : this.context.suspend());
    return this.enabled;
  }
  private play(
    key: string,
    duration: number,
    sample: (t: number, n: number) => number,
    gain = 1,
    delay = 0,
    pan = 0,
  ) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * duration),
        ctx.sampleRate,
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = sample(i / ctx.sampleRate, Math.random() * 2 - 1);
      this.buffers.set(key, buffer);
    }
    const source = ctx.createBufferSource(),
      volume = ctx.createGain(),
      stereo = ctx.createStereoPanner();
    source.buffer = buffer;
    volume.gain.value = gain;
    stereo.pan.value = pan;
    source.connect(volume);
    volume.connect(stereo);
    stereo.connect(this.master);
    if (this.voices.length >= 24) this.voices.shift()?.stop();
    this.voices.push(source);
    source.onended = () => {
      source.disconnect();
      volume.disconnect();
      stereo.disconnect();
      this.voices = this.voices.filter((v) => v !== source);
    };
    source.start(ctx.currentTime + delay);
  }
  shot(index: number) {
    const w = WEAPONS[index],
      heavy = w.family === 'sniper' || w.family === 'shotgun',
      pitch = w.pitch;
    this.play(
      `shot-${index}`,
      heavy ? 0.42 : 0.25,
      (t, n) => {
        const crack = n * Math.exp(-t * (heavy ? 70 : 110));
        const body =
          Math.sin(2 * Math.PI * pitch * t * Math.exp(-t * 1.8)) *
          Math.exp(-t * (heavy ? 15 : 24));
        const grit = n * Math.exp(-t * 24) * (Math.sin(t * 1900) * 0.3 + 0.3);
        return crack * 0.56 + body * 0.24 + grit * 0.16;
      },
      0.72,
    );
    this.play(
      `tail-${index}`,
      0.6,
      (t, n) => n * Math.exp(-t * 10) * 0.16,
      this.indoor ? 0.75 : 0.36,
      this.indoor ? 0.045 : 0.085,
      -0.18,
    );
    this.play(
      'bolt-cycle',
      0.12,
      (t, n) =>
        n * Math.exp(-t * 80) * 0.12 +
        Math.sin(t * 6200) * Math.exp(-t * 95) * 0.08,
      0.7,
      0.065,
      0.15,
    );
    if (w.reloadStyle !== 'revolver')
      this.play(
        'case',
        0.16,
        (t, n) =>
          Math.sin(t * 12500) * Math.exp(-t * 65) * 0.07 +
          n * Math.exp(-t * 100) * 0.07,
        0.5,
        0.23,
        0.55,
      );
  }
  cue(cue: Cue) {
    const settings: Record<Cue, [number, number, number]> = {
      'mag-out': [850, 35, 0.12],
      'mag-in': [1250, 48, 0.22],
      rack: [3100, 24, 0.17],
      shell: [4200, 58, 0.1],
      open: [640, 38, 0.13],
      close: [1900, 55, 0.2],
      step: [95, 22, 0.085],
      land: [70, 15, 0.14],
      hit: [1650, 65, 0.075],
      kill: [900, 35, 0.09],
    };
    const [hz, decay, level] = settings[cue];
    this.play(
      cue,
      0.24,
      (t, n) =>
        (n * 0.64 + Math.sin(t * hz) * 0.36) * Math.exp(-t * decay) * level,
    );
  }
  hit(killed: boolean) {
    this.cue(killed ? 'kill' : 'hit');
  }
  movement(now: number, speed: number, grounded: boolean, indoor: boolean) {
    if (this.indoor !== indoor && this.context) {
      this.rainGain?.gain.setTargetAtTime(
        indoor ? 0.35 : 1,
        this.context.currentTime,
        0.2,
      );
      this.rainFilter?.frequency.setTargetAtTime(
        indoor ? 1200 : 8500,
        this.context.currentTime,
        0.2,
      );
    }
    this.indoor = indoor;
    if (grounded && !this.wasGrounded) this.cue('land');
    this.wasGrounded = grounded;
    if (grounded && speed > 0.6 && now >= this.stepAt) {
      this.cue('step');
      this.stepAt = now + Math.max(0.24, 0.54 - speed * 0.032);
    }
  }
  dispose() {
    this.rain?.stop();
    for (const voice of [...this.voices]) voice.stop();
    void this.context?.close();
  }
}
