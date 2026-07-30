// Hellforge scene BGM — HTMLAudioElement + phase crossfade (no engine AudioClip).
//
// ── Contract (SSOT) ──────────────────────────────────────────────────────────
// Assets:     assets/music/bgm-<phase>.mp3
// Phases:     camp | den   (wild / title / charSelect / charList → camp track)
// Bus:        separate from sfx.ts (synth WebAudio). master * bgm * duck gain.
// Unlock:     first pointerdown/keydown on the game uiRoot (browser autoplay).
//             Pre-gesture setPhase is remembered and starts on arm.
// Switch:     ~0.35s linear crossfade; faded-out tracks pause + rewind.
// Duck:       optional relative dB (PR4a L2 cinematic −6 dB); restores on unduck.
// URL:        new URL('../assets/music/<file>', import.meta.url) (Vite preview).
// SFX files:  NOT in scope — keep synthesized sfx.ts until a real sfx/ tree exists.
//
// Track map (current):
//   camp → bgm-camp.mp3  (Desecrated Cathedral)
//   den  → bgm-den.mp3   (Priestess of the Temple)
// ─────────────────────────────────────────────────────────────────────────────

export type BgmPhase = 'camp' | 'den';

/** PR4a L2 — cinematic owner ducks BGM by this relative amount. */
export const CINEMATIC_BGM_DUCK_DB = -6;

/** Convert a relative dB gain to a linear multiplier (`10^(dB/20)`). */
export function dbToLinearGain(db: number): number {
  return 10 ** (db / 20);
}

/** Pure duck bus — unit-testable; installBgm mirrors this on the live handle. */
export type BgmDuckBus = {
  /** Active duck in dB, or null when unducked. */
  readonly duckDb: number | null;
};

/** Apply (or replace) a duck. Idempotent for the same dB. */
export function duckBgm(bus: BgmDuckBus, db: number): BgmDuckBus {
  return { duckDb: db };
}

/** Clear duck. Idempotent when already unducked. */
export function unduckBgm(_bus: BgmDuckBus): BgmDuckBus {
  return { duckDb: null };
}

/** Linear gain from duck state (1 when unducked). */
export function bgmDuckLinearGain(bus: BgmDuckBus): number {
  return bus.duckDb == null ? 1 : dbToLinearGain(bus.duckDb);
}

/** Map AreaDef.music → BGM phase (Task 4.2). */
export function bgmPhaseForMusic(music: BgmPhase): BgmPhase {
  return music;
}

export type BgmHandle = {
  /** Switch looping track for the phase (no-op if already active). */
  setPhase(phase: BgmPhase): void;
  /** Advance crossfade ramps — call every frame while the game runs. */
  tick(dt: number): void;
  setVolume(master: number, bgm: number): void;
  /** Duck bus by relative dB (negative). Replaces any prior duck. */
  duck(db: number): void;
  /** Restore bus to unducked. Idempotent. */
  unduck(): void;
  dispose(): void;
  readonly phase: BgmPhase;
  /** Active duck in dB, or null when unducked. */
  readonly duckDb: number | null;
};

// 0.35s — long enough to soften the swap, short enough that two tracks are
// not both audible for a full second on camp⇄den portal crossings.
const CROSSFADE_SEC = 0.35;

const BGM_FILES: Record<BgmPhase, string> = {
  camp: 'bgm-camp.mp3',
  den: 'bgm-den.mp3',
};

type Track = {
  phase: BgmPhase;
  el: HTMLAudioElement;
  targetVolume: number;
  playRequested: boolean;
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function audioAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof (globalThis as { Audio?: unknown }).Audio !== 'undefined';
}

function resolveUrl(phase: BgmPhase): string | null {
  const file = BGM_FILES[phase];
  if (!file) return null;
  try {
    return new URL(`../assets/music/${file}`, import.meta.url).href;
  } catch {
    return null;
  }
}

/**
 * Install gesture unlock + phase player. Call once per boot; dispose on cleanup.
 * `uiRoot` receives the unlock listeners (local element — not document/window).
 */
export function installBgm(uiRoot: HTMLElement): BgmHandle {
  let phase: BgmPhase = 'camp';
  let active: BgmPhase | null = null;
  // Defaults stay under SFX so music beds don't drown hit feedback.
  // F10 「音乐」slider writes these via setVolume(1, bgmVolume).
  let masterVolume = 1;
  let bgmVolume = 0.22;
  let duckBus: BgmDuckBus = { duckDb: null };
  let armed = false;
  const tracks = new Map<BgmPhase, Track>();
  let unlock: (() => void) | null = null;

  const effective = (): number =>
    clamp01(masterVolume * bgmVolume * bgmDuckLinearGain(duckBus));

  const startTrack = (track: Track): void => {
    if (track.playRequested && !track.el.paused) return;
    track.playRequested = true;
    try {
      const p = track.el.play();
      if (p && typeof p.then === 'function') p.catch(() => { /* autoplay blocked */ });
    } catch { /* never throw */ }
  };

  const getOrCreate = (p: BgmPhase): Track | null => {
    let track = tracks.get(p);
    if (track) return track;
    if (!audioAvailable()) return null;
    const url = resolveUrl(p);
    if (!url) return null;
    let el: HTMLAudioElement;
    try {
      el = new Audio(url);
    } catch {
      return null;
    }
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    track = { phase: p, el, targetVolume: 0, playRequested: false };
    tracks.set(p, track);
    return track;
  };

  const play = (next: BgmPhase): void => {
    if (next === active) return;
    if (active) {
      const old = tracks.get(active);
      if (old) old.targetVolume = 0;
    }
    active = next;
    const track = getOrCreate(next);
    if (!track) return;
    track.targetVolume = 1;
    if (armed) startTrack(track);
  };

  const doArm = (): void => {
    if (armed) return;
    armed = true;
    if (unlock) {
      uiRoot.removeEventListener('pointerdown', unlock, true);
      uiRoot.removeEventListener('keydown', unlock, true);
      unlock = null;
    }
    if (active) {
      const track = getOrCreate(active);
      if (track) {
        track.targetVolume = 1;
        startTrack(track);
      }
    }
  };

  unlock = () => doArm();
  uiRoot.addEventListener('pointerdown', unlock, { capture: true });
  uiRoot.addEventListener('keydown', unlock, { capture: true });

  // Desired default before title / first enterArea.
  play('camp');

  return {
    get phase() { return phase; },
    get duckDb() { return duckBus.duckDb; },
    setPhase(next: BgmPhase): void {
      phase = next;
      play(next);
    },
    setVolume(master: number, bgm: number): void {
      masterVolume = clamp01(master);
      bgmVolume = clamp01(bgm);
    },
    duck(db: number): void {
      duckBus = duckBgm(duckBus, db);
    },
    unduck(): void {
      duckBus = unduckBgm(duckBus);
    },
    tick(dt: number): void {
      if (!audioAvailable() || dt <= 0) return;
      const ev = effective();
      const step = dt / CROSSFADE_SEC;
      for (const track of tracks.values()) {
        const target = track.targetVolume * ev;
        const cur = track.el.volume;
        if (Math.abs(cur - target) <= 0.01) {
          track.el.volume = clamp01(target);
          if (target === 0 && track.playRequested && !track.el.paused) {
            try { track.el.pause(); track.el.currentTime = 0; } catch { /* */ }
            track.playRequested = false;
          }
          continue;
        }
        track.el.volume = clamp01(cur < target ? cur + step : cur - step);
      }
    },
    dispose(): void {
      if (unlock) {
        uiRoot.removeEventListener('pointerdown', unlock, true);
        uiRoot.removeEventListener('keydown', unlock, true);
        unlock = null;
      }
      for (const t of tracks.values()) {
        try { t.el.pause(); } catch { /* */ }
        t.el.src = '';
      }
      tracks.clear();
      active = null;
    },
  };
}
