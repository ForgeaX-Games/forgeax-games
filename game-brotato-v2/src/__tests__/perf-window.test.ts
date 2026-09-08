import { describe, expect, it } from 'vitest';
import { createPerfWindow, pushFrame } from '../stress/perf-window.ts';

function pushFrames(count: number, delta: number) {
  const state = createPerfWindow();
  let verdict = pushFrame(state, delta);
  for (let index = 1; index < count; index += 1) verdict = pushFrame(state, delta);
  return { state, verdict };
}

describe('Brotato v2 stress performance window', () => {
  it('averages a one-second 60fps window', () => {
    expect(pushFrames(60, 1 / 60).verdict.fps).toBeCloseTo(60, 0.5);
  });

  it('rolls old samples out of the one-second window', () => {
    const state = createPerfWindow();
    for (let index = 0; index < 60; index += 1) pushFrame(state, 1 / 60);
    let verdict = pushFrame(state, 1 / 20);
    for (let index = 1; index < 20; index += 1) verdict = pushFrame(state, 1 / 20);
    expect(verdict.fps).toBeCloseTo(20, 0.5);
  });

  it('keeps the session minimum after recovery', () => {
    const state = createPerfWindow();
    pushFrame(state, 0.5);
    for (let index = 0; index < 60; index += 1) pushFrame(state, 1 / 60);
    expect(state.minFps).toBeCloseTo(2, 0.5);
  });

  it('warns only after one continuous second below 30fps', () => {
    const state = createPerfWindow();
    let verdict = pushFrame(state, 0.04);
    for (let index = 1; index < 24; index += 1) verdict = pushFrame(state, 0.04);
    expect(verdict.warn).toBe(false);
    verdict = pushFrame(state, 0.04);
    expect(verdict.warn).toBe(true);
  });

  it('freezes only after two continuous seconds below 15fps', () => {
    const state = createPerfWindow();
    let verdict = pushFrame(state, 1 / 12);
    for (let index = 1; index < 23; index += 1) verdict = pushFrame(state, 1 / 12);
    expect(verdict.freeze).toBe(false);
    verdict = pushFrame(state, 1 / 12);
    expect(verdict.freeze).toBe(true);
  });

  it('resets a hold timer when the frame rate recovers', () => {
    const state = createPerfWindow();
    for (let index = 0; index < 20; index += 1) pushFrame(state, 0.04);
    for (let index = 0; index < 30; index += 1) pushFrame(state, 1 / 60);
    let verdict = pushFrame(state, 0.04);
    for (let index = 1; index < 20; index += 1) verdict = pushFrame(state, 0.04);
    expect(verdict.warn).toBe(false);
    for (let index = 0; index < 30; index += 1) verdict = pushFrame(state, 0.04);
    expect(verdict.warn).toBe(true);
  });

  it('produces identical verdicts for an identical delta sequence', () => {
    const deltas = [1 / 60, 1 / 60, 0.04, 0.04, 1 / 30, 1 / 60];
    const first = createPerfWindow();
    const second = createPerfWindow();
    const firstVerdicts = deltas.map((delta) => pushFrame(first, delta));
    const secondVerdicts = deltas.map((delta) => pushFrame(second, delta));
    expect(secondVerdicts).toEqual(firstVerdicts);
  });
});
