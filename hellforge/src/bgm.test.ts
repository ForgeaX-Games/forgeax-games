// PR4a T4 — BGM duck bus helpers (pure; no Audio required).

import { describe, expect, test } from 'bun:test';
import {
  bgmDuckLinearGain,
  CINEMATIC_BGM_DUCK_DB,
  dbToLinearGain,
  duckBgm,
  installBgm,
  unduckBgm,
  type BgmDuckBus,
  type BgmHandle,
} from './bgm';

describe('BGM duck helpers (PR4a T4 / L2)', () => {
  test('cinematic duck is −6 dB ≈ 0.501 linear', () => {
    expect(CINEMATIC_BGM_DUCK_DB).toBe(-6);
    expect(dbToLinearGain(CINEMATIC_BGM_DUCK_DB)).toBeCloseTo(10 ** (-6 / 20), 5);
    expect(dbToLinearGain(0)).toBe(1);
  });

  test('duck / unduck are idempotent', () => {
    let bus: BgmDuckBus = { duckDb: null };
    expect(bgmDuckLinearGain(bus)).toBe(1);

    bus = duckBgm(bus, CINEMATIC_BGM_DUCK_DB);
    expect(bus.duckDb).toBe(CINEMATIC_BGM_DUCK_DB);
    expect(bgmDuckLinearGain(bus)).toBeCloseTo(dbToLinearGain(-6), 5);

    // Re-duck same amount — still ducked once (replace, not stack).
    bus = duckBgm(bus, CINEMATIC_BGM_DUCK_DB);
    expect(bus.duckDb).toBe(CINEMATIC_BGM_DUCK_DB);

    bus = unduckBgm(bus);
    expect(bus.duckDb).toBe(null);
    expect(bgmDuckLinearGain(bus)).toBe(1);

    // Second unduck is a no-op.
    bus = unduckBgm(bus);
    expect(bus.duckDb).toBe(null);
    expect(bgmDuckLinearGain(bus)).toBe(1);
  });
});

// ── Crossfade timing (CROSSFADE_SEC = 0.35) ────────────────────────────────
// Fake HTMLAudioElement + window/Audio globals so tick() ramps run headless.

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  loop = false;
  preload = '';
  volume = 0;
  paused = true;
  currentTime = 0;
  constructor(src?: string) {
    this.src = src ?? '';
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

type FakeRoot = {
  addEventListener: (type: string, fn: EventListener) => void;
  removeEventListener: (type: string, fn: EventListener) => void;
};

function installFakeBgm(): {
  handle: BgmHandle;
  audios: FakeAudio[];
  /** Simulate the first pointerdown gesture (autoplay unlock). */
  arm: () => void;
  restore: () => void;
} {
  FakeAudio.instances = [];
  const listeners = new Map<string, EventListener>();
  const uiRoot: FakeRoot = {
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    removeEventListener: (type) => { listeners.delete(type); },
  };
  const g = globalThis as { window?: unknown; Audio?: unknown };
  const prevWindow = g.window;
  const prevAudio = g.Audio;
  g.window = {};
  g.Audio = FakeAudio;
  const handle = installBgm(uiRoot as unknown as HTMLElement);
  return {
    handle,
    audios: FakeAudio.instances,
    arm: () => { listeners.get('pointerdown')?.(new Event('pointerdown')); },
    restore: () => {
      handle.dispose();
      if (prevWindow === undefined) delete g.window;
      else g.window = prevWindow;
      if (prevAudio === undefined) delete g.Audio;
      else g.Audio = prevAudio;
    },
  };
}

describe('BGM crossfade timing (0.35s window)', () => {
  test('fade-up ramps to full within 0.35s, not 1s', () => {
    const { handle, audios, restore } = installFakeBgm();
    try {
      handle.setVolume(1, 1); // effective gain 1 so the ramp slope is dt/CROSSFADE_SEC
      handle.setPhase('den');
      const den = audios[1]!; // [0] is the install-time camp track
      handle.tick(0.175); // half the crossfade window
      expect(den.volume).toBeCloseTo(0.5, 5);
      handle.tick(0.175); // full window elapsed
      expect(den.volume).toBeCloseTo(1, 5);
    } finally {
      restore();
    }
  });

  test('faded-out track pauses + rewinds right after the 0.35s swap', () => {
    const { handle, audios, arm, restore } = installFakeBgm();
    try {
      handle.setVolume(1, 1);
      arm(); // gesture unlock → camp starts playing
      handle.tick(0.35); // camp fades to full
      const camp = audios[0]!;
      expect(camp.volume).toBeCloseTo(1, 5);
      expect(camp.paused).toBe(false);

      camp.currentTime = 42; // mid-song playback position
      handle.setPhase('den');
      handle.tick(0.35); // camp ramps to 0 within the window
      expect(camp.volume).toBe(0);
      expect(audios[1]!.volume).toBeCloseTo(1, 5);

      handle.tick(0.001); // settle tick → pause + rewind the silent track
      expect(camp.paused).toBe(true);
      expect(camp.currentTime).toBe(0);
    } finally {
      restore();
    }
  });
});
