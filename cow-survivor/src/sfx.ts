// Procedural sound system — zero asset files, all WebAudio synthesis.
//
// Why no audio files: the studio's asset pipeline + manifest didn't ship
// audio support yet, and shipping `.ogg` blobs would still need a content
// pass. WebAudio's OscillatorNode + buffered noise is plenty for arcade-
// style FX (lasers, explosions, pickups, footsteps). It also lets us
// dial in pitch / duration per-event in code, which is exactly what an
// auto-fire roguelike wants.
//
// Lifecycle
// ─────────
// AudioContext can ONLY be created/resumed inside a user gesture (Chrome
// and Safari autoplay policy). We expose `start()` to be called from the
// first canvas mousedown/click handler. Until then every play* call is a
// no-op (it does NOT throw — keeps the gameplay code clean of guards).
//
// Voice budget
// ────────────
// Each play* spawns 1-3 short-lived nodes (Oscillator/BufferSource +
// optional filter + gain), connects them, schedules an envelope with
// .gain.linearRampToValueAtTime, and lets WebAudio garbage-collect them
// after .stop(at). No pooling needed up to ~50 sounds/sec, which we
// won't exceed (the auto-fire cooldowns are >= 0.28s).
//
// Ambient
// ───────
// `ambient.start()` builds a permanent low-volume bed:
//   • Pink-ish noise → low-pass 200Hz → wind drone (volume 0.05)
//   • A periodic distant moo (every 5..14s, volume 0.10)
// Ambient.tick(enemyCount) bumps a "swarm hum" gain when crowded.

export type WeaponSfxKind = 'pistol' | 'fire' | 'ice' | 'chain' | 'shotgun' | 'boomerang' | 'grenade';

interface AmbientNodes {
  windGain: GainNode;
  swarmGain: GainNode;
  mooTimer: number | null;
}

export class SfxSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambient: AmbientNodes | null = null;
  /** Master volume (0..1). Read by master.gain on init. */
  volume = 0.55;

  /** Call ONCE inside a user gesture (e.g. canvas mousedown) to spin up
   *  the AudioContext + pre-build the noise buffer + start ambience.
   *  Idempotent. Returns true on success. */
  start(): boolean {
    if (this.ctx) return true;
    try {
      // Safari prefixes; cast through unknown for type safety.
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(2.0);
      this.startAmbient();
      return true;
    } catch {
      return false;
    }
  }

  /** Set master volume (0..1). */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Periodic ambient tick — call once per game-frame with the current
   *  enemy count. Updates the "swarm hum" volume to feel oppressive when
   *  the screen is full of enemies. */
  tickAmbient(enemyCount: number): void {
    if (!this.ambient) return;
    // Map 0..60 enemies → 0..0.18 gain
    const target = Math.min(0.18, enemyCount * 0.003);
    const cur = this.ambient.swarmGain.gain.value;
    // ease toward target — small smoothstep, not too sudden
    this.ambient.swarmGain.gain.value = cur + (target - cur) * 0.04;
  }

  // ── Ambient bed ──────────────────────────────────────────────────────
  private startAmbient(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const c = this.ctx;
    // Wind drone: noise → LPF → low gain, looping
    const windSrc = c.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    const windFilter = c.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 220;
    windFilter.Q.value = 0.5;
    const windGain = c.createGain();
    windGain.gain.value = 0.045;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    windSrc.start();

    // Swarm hum: low sawtooth + LFO modulation, volume scaled by tickAmbient.
    const swarmOsc = c.createOscillator();
    swarmOsc.type = 'sawtooth';
    swarmOsc.frequency.value = 55;
    const swarmFilter = c.createBiquadFilter();
    swarmFilter.type = 'lowpass';
    swarmFilter.frequency.value = 180;
    const swarmGain = c.createGain();
    swarmGain.gain.value = 0;
    // LFO for slow movement
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.18;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 6;     // ±6 Hz wobble around 55Hz base
    lfo.connect(lfoGain).connect(swarmOsc.frequency);
    swarmOsc.connect(swarmFilter).connect(swarmGain).connect(this.master);
    swarmOsc.start();
    lfo.start();

    this.ambient = { windGain, swarmGain, mooTimer: null };
    this.scheduleMoo();
  }

  /** Schedule the next distant-moo event with a random delay. */
  private scheduleMoo(): void {
    const delay = 5000 + Math.random() * 9000;     // 5..14s
    this.ambient!.mooTimer = window.setTimeout(() => this.distantMoo(), delay);
  }

  private distantMoo(): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const dur = 0.6 + Math.random() * 0.4;
    // Sine sweeps from ~120 to ~80 Hz with vibrato — that "mournful moo".
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(82, t0 + dur);
    const lpf = c.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.10, t0 + 0.12);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(lpf).connect(g).connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    this.scheduleMoo();
  }

  // ── Per-event sounds ────────────────────────────────────────────────
  /** Weapon shot SFX. Per-weapon timbre configured here; one clean call
   *  site from main.ts. */
  playShot(kind: WeaponSfxKind): void {
    if (!this.ctx) return;
    switch (kind) {
      case 'pistol':    return this.shotPistol();
      case 'fire':      return this.shotFire();
      case 'ice':       return this.shotIce();
      case 'chain':     return this.shotChain();
      case 'shotgun':   return this.shotShotgun();
      case 'boomerang': return this.shotBoomerang();
      case 'grenade':   return this.shotGrenade();
    }
  }

  private shotPistol(): void {
    // Short tonal "pew": square wave, fast pitch dive.
    const c = this.ctx!;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.10);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.30, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.13);
  }

  private shotFire(): void {
    // Whooshy "FOOM": filtered noise burst + low sub-thump.
    const c = this.ctx!;
    const t0 = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const lpf = c.createBiquadFilter();
    lpf.type = 'bandpass';
    lpf.frequency.setValueAtTime(800, t0);
    lpf.frequency.exponentialRampToValueAtTime(280, t0 + 0.25);
    lpf.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
    noise.connect(lpf).connect(g).connect(this.master!);
    noise.start(t0); noise.stop(t0 + 0.32);
    // sub thump
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, t0);
    sub.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.45, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.20);
    sub.connect(sg).connect(this.master!);
    sub.start(t0); sub.stop(t0 + 0.22);
  }

  private shotIce(): void {
    // Crystalline "shing": triangle wave with fast slide UP + tiny shimmer.
    const c = this.ctx!;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, t0);
    osc.frequency.exponentialRampToValueAtTime(2400, t0 + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.25, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.20);
  }

  private shotChain(): void {
    // Crackle: very short noise burst + high sawtooth zaps.
    const c = this.ctx!;
    const t0 = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const hpf = c.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 2400;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.30, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    noise.connect(hpf).connect(g).connect(this.master!);
    noise.start(t0); noise.stop(t0 + 0.25);
    // tonal zap
    const z = c.createOscillator();
    z.type = 'sawtooth';
    z.frequency.setValueAtTime(2200, t0);
    z.frequency.exponentialRampToValueAtTime(600, t0 + 0.14);
    const zg = c.createGain();
    zg.gain.setValueAtTime(0.18, t0);
    zg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    z.connect(zg).connect(this.master!);
    z.start(t0); z.stop(t0 + 0.18);
  }

  private shotShotgun(): void {
    // Big "boom": noise burst with sweeping LPF.
    const c = this.ctx!;
    const t0 = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const lpf = c.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(2200, t0);
    lpf.frequency.exponentialRampToValueAtTime(400, t0 + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.40, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    noise.connect(lpf).connect(g).connect(this.master!);
    noise.start(t0); noise.stop(t0 + 0.27);
  }

  private shotBoomerang(): void {
    // Whirring "vrrm": triangle wave with fast vibrato.
    const c = this.ctx!;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, t0);
    const lfo = c.createOscillator();
    lfo.frequency.value = 14;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.20, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.32);
    lfo.start(t0); lfo.stop(t0 + 0.32);
  }

  private shotGrenade(): void {
    // The "tonk" of the launcher (the explosion gets its own sound on impact).
    const c = this.ctx!;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.10);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.40, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.15);
  }

  /** Generic enemy hit — played per damage application. Quick + cheap. */
  playHit(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const bpf = c.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 1800 + Math.random() * 400;
    bpf.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    noise.connect(bpf).connect(g).connect(this.master!);
    noise.start(t0); noise.stop(t0 + 0.08);
  }

  /** Big explosion — used by grenade/aoe impact AND boss/sparkcalf death. */
  playExplosion(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const lpf = c.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(900, t0);
    lpf.frequency.exponentialRampToValueAtTime(150, t0 + 0.45);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.55, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    noise.connect(lpf).connect(g).connect(this.master!);
    noise.start(t0); noise.stop(t0 + 0.6);
    // sub-thump
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t0);
    sub.frequency.exponentialRampToValueAtTime(35, t0 + 0.30);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.55, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    sub.connect(sg).connect(this.master!);
    sub.start(t0); sub.stop(t0 + 0.4);
  }

  /** Enemy death — short organic squelch. */
  playKill(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.16);
  }

  /** Spark / electric death — sharp high zap + crackle tail. Used when an
   *  electric enemy (sparkcalf) self-explodes. */
  playSparkDeath(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    // Fast pitch DROP square zap
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2400, t0);
    osc.frequency.exponentialRampToValueAtTime(400, t0 + 0.20);
    const og = c.createGain();
    og.gain.setValueAtTime(0.30, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(og).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.24);
    // Hi-passed noise tail (crackle)
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer!;
    const hpf = c.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.20, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
    n.connect(hpf).connect(ng).connect(this.master!);
    n.start(t0); n.stop(t0 + 0.32);
  }

  /** Poison hiss — long band-passed noise + tiny pitched bubble. */
  playPoisonDeath(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer!;
    const bpf = c.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(1500, t0);
    bpf.frequency.exponentialRampToValueAtTime(600, t0 + 0.6);
    bpf.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
    n.connect(bpf).connect(g).connect(this.master!);
    n.start(t0); n.stop(t0 + 0.7);
    // Low bubbly pop
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t0 + 0.05);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.20);
    const og = c.createGain();
    og.gain.setValueAtTime(0.20, t0 + 0.05);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(og).connect(this.master!);
    osc.start(t0 + 0.05); osc.stop(t0 + 0.24);
  }

  /** Wisp / soul ascending — high pitched upward sweep + airy noise. */
  playWispDeath(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, t0);
    osc.frequency.exponentialRampToValueAtTime(1600, t0 + 0.45);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.58);
    // soft airy noise on top
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer!;
    const bpf = c.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(1800, t0);
    bpf.frequency.exponentialRampToValueAtTime(3200, t0 + 0.45);
    bpf.Q.value = 4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t0);
    ng.gain.linearRampToValueAtTime(0.10, t0 + 0.08);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    n.connect(bpf).connect(ng).connect(this.master!);
    n.start(t0); n.stop(t0 + 0.58);
  }

  /** Stone shatter — 4 layered low knocks staggered over ~0.4s. */
  playShatterDeath(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * 0.08 + Math.random() * 0.04;
      const osc = c.createOscillator();
      osc.type = 'sine';
      const f0 = 110 + Math.random() * 80;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      const g = c.createGain();
      g.gain.setValueAtTime(0.30, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
      osc.connect(g).connect(this.master!);
      osc.start(t); osc.stop(t + 0.22);
    }
    // dust/crunch tail
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer!;
    const lpf = c.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 800;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.18, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    n.connect(lpf).connect(ng).connect(this.master!);
    n.start(t0); n.stop(t0 + 0.48);
  }

  /** Wet split — low burble + squelch. For bloodcow death. */
  playSplitDeath(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    // Quick fat sub burst
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.18);
    const lpf = c.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.30, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(lpf).connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.24);
    // Squelchy noise on top
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer!;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.20, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
    n.connect(bp).connect(ng).connect(this.master!);
    n.start(t0); n.stop(t0 + 0.32);
  }

  /** XP gem pickup. Pitch rises with tier so a boss drop feels chunky. */
  playPickup(tier: 'T1' | 'T2' | 'T3' | 'BOSS'): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const baseFreq = tier === 'BOSS' ? 1100
                   : tier === 'T3' ? 880
                   : tier === 'T2' ? 660 : 520;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, t0 + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.20);
  }

  /** Player took damage. Low chesty thud. */
  playPlayerHit(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.55, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.24);
    // crunchy noise on top
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer!;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 1.5;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.25, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.10);
    n.connect(bp).connect(ng).connect(this.master!);
    n.start(t0); n.stop(t0 + 0.12);
  }

  /** Level-up arpeggio — major triad up. */
  playLevelUp(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const notes = [523.25, 659.26, 783.99, 1046.50];   // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = c.createGain();
      const start = t0 + i * 0.08;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.20, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.30);
      osc.connect(g).connect(this.master!);
      osc.start(start); osc.stop(start + 0.32);
    });
  }

  /** Boss approach + boss spawn — a long ominous brass-y tone. */
  playBossWarn(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    // Three-note menacing chord
    const freqs = [73.42, 110, 146.83];   // D2 A2 D3
    freqs.forEach((f) => {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const lpf = c.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 600;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.10, t0 + 0.4);
      g.gain.linearRampToValueAtTime(0.10, t0 + 1.6);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.2);
      osc.connect(lpf).connect(g).connect(this.master!);
      osc.start(t0); osc.stop(t0 + 2.3);
    });
  }

  playBossSpawn(): void {
    if (!this.ctx) return;
    this.playExplosion();
    // Layer a low timpani thump
    const c = this.ctx;
    const t0 = c.currentTime + 0.02;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8);
    osc.connect(g).connect(this.master!);
    osc.start(t0); osc.stop(t0 + 0.85);
  }

  /** Game over — long descending sad chord. */
  playGameOver(): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const freqs = [261.63, 329.63, 392.00];   // C major collapsing
    freqs.forEach((f, i) => {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + 1.6);
      const lpf = c.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 800;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0 + i * 0.05);
      g.gain.linearRampToValueAtTime(0.15, t0 + 0.3 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.5);
      osc.connect(lpf).connect(g).connect(this.master!);
      osc.start(t0 + i * 0.05); osc.stop(t0 + 2.6);
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────
  private makeNoise(seconds: number): AudioBuffer {
    const c = this.ctx!;
    const sampleRate = c.sampleRate;
    const length = Math.floor(sampleRate * seconds);
    const buf = c.createBuffer(1, length, sampleRate);
    const data = buf.getChannelData(0);
    // Pinkish noise via simple running average (no need for full Voss-McCartney)
    let last = 0;
    for (let i = 0; i < length; i++) {
      const r = Math.random() * 2 - 1;
      last = (last + r) * 0.5;
      data[i] = last;
    }
    return buf;
  }
}
