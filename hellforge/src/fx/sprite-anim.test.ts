import { describe, expect, test } from 'bun:test';
import { erosionAt, frameAt } from './sprite-anim';

describe('frameAt (PR8 T1 flipbook timing)', () => {
  test('static sheet: frames <= 1 or fps <= 0 → frame 0', () => {
    expect(frameAt(0.5, 12, 1, true)).toBe(0);
    expect(frameAt(0.5, 12, 0, true)).toBe(0);
    expect(frameAt(0.5, 0, 16, true)).toBe(0);
    expect(frameAt(0.5, -3, 16, true)).toBe(0);
  });

  test('negative age clamps to frame 0', () => {
    expect(frameAt(-1, 12, 16, false)).toBe(0);
    expect(frameAt(-1, 12, 16, true)).toBe(0);
  });

  test('non-looping clamps at the last frame past the clip end', () => {
    expect(frameAt(0.5, 24, 16, false)).toBe(12);
    expect(frameAt(99, 24, 16, false)).toBe(15);
  });

  test('looping wraps modulo frames', () => {
    expect(frameAt(1, 16, 16, true)).toBe(0);
    expect(frameAt(1.25, 16, 16, true)).toBe(4);
    expect(frameAt(2.5, 8, 16, true)).toBe(4);
  });

  test('fractional frames feed the blendFrames lerp', () => {
    expect(frameAt(0.05, 30, 16, true)).toBeCloseTo(1.5);
    expect(frameAt(0.05, 30, 16, false)).toBeCloseTo(1.5);
  });
});

describe('erosionAt (PR8 T1 fade-out)', () => {
  test('zero before the fade start fraction', () => {
    expect(erosionAt(0, 1, 0.6)).toBe(0);
    expect(erosionAt(0.59, 1, 0.6)).toBe(0);
  });

  test('ramps linearly between fade start and end of life', () => {
    expect(erosionAt(0.8, 1, 0.6)).toBeCloseTo(0.5);
    expect(erosionAt(1.6, 2, 0.6)).toBeCloseTo(0.5);
  });

  test('saturates at 1 at / past end of life', () => {
    expect(erosionAt(1, 1, 0.6)).toBe(1);
    expect(erosionAt(5, 1, 0.6)).toBe(1);
  });

  test('negative age stays 0', () => {
    expect(erosionAt(-0.5, 1, 0.6)).toBe(0);
  });

  test('fade never starts when fadeStartFrac >= 1', () => {
    expect(erosionAt(0.9, 1, 1)).toBe(0);
    expect(erosionAt(2, 1, 1.5)).toBe(0);
  });

  test('zero / negative life is fully eroded', () => {
    expect(erosionAt(0, 0, 0.6)).toBe(1);
    expect(erosionAt(0.1, -1, 0.6)).toBe(1);
  });

  test('fadeStartFrac clamps into [0,1]', () => {
    expect(erosionAt(0.4, 1, -0.5)).toBeCloseTo(0.4);
  });
});
