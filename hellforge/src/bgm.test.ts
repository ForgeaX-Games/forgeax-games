// PR4a T4 — BGM duck bus helpers (pure; no Audio required).

import { describe, expect, test } from 'bun:test';
import {
  bgmDuckLinearGain,
  CINEMATIC_BGM_DUCK_DB,
  dbToLinearGain,
  duckBgm,
  unduckBgm,
  type BgmDuckBus,
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
