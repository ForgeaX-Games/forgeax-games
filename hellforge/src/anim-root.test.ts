import { describe, expect, test } from 'bun:test';
import { normalizeClipRoot } from './anim-root';

// Channels address joints by opaque targetId, so the fixture hashes the joint
// name the way the scene lookup would resolve it.
const idOf = (joint: string) => `id:${joint}`;
const ROOT_IDS = new Set([idOf('Hips')]);

function clip(channels: { joint: string; property: string; out: number[] }[]) {
  return {
    channels: channels.map((c) => ({
      targetId: idOf(c.joint),
      property: c.property,
      sampler: { output: new Float32Array(c.out) },
    })),
  };
}

describe('normalizeClipRoot', () => {
  test('pins root X/Z to the first key and keeps Y (Roll_Dodge root motion)', () => {
    // Float32-exact values so the assertion compares the pinning, not rounding.
    const c = clip([
      { joint: 'Hips', property: 'translation', out: [-0.5, 109, -2, 20, 104, 200, 44.5, 100, 403.5] },
    ]);
    normalizeClipRoot(c, ROOT_IDS);
    expect(Array.from(c.channels[0]!.sampler.output)).toEqual([
      -0.5, 109, -2,
      -0.5, 104, -2,
      -0.5, 100, -2,
    ]);
  });

  test('un-bakes a constant uniform root scale (Walking_Woman 1.1765)', () => {
    const s = 1.1765;
    const c = clip([
      { joint: 'Hips', property: 'scale', out: [s, s, s, s, s, s] },
      { joint: 'Hips', property: 'translation', out: [1.49, 119.49, 1.97, 1.49, 119.49, 1.97] },
    ]);
    normalizeClipRoot(c, ROOT_IDS);
    expect(Array.from(c.channels[0]!.sampler.output)).toEqual([1, 1, 1, 1, 1, 1]);
    const t = c.channels[1]!.sampler.output;
    expect(t[1]).toBeCloseTo(101.56, 2);
    expect(t[0]).toBeCloseTo(1.2665, 3);
  });

  test('leaves non-root joints and non-uniform/animated root scale untouched', () => {
    const c = clip([
      { joint: 'Spine', property: 'translation', out: [0, 1, 2, 9, 8, 7] },
      { joint: 'Hips', property: 'scale', out: [1, 1, 1, 2, 2, 2] },
    ]);
    normalizeClipRoot(c, ROOT_IDS);
    expect(Array.from(c.channels[0]!.sampler.output)).toEqual([0, 1, 2, 9, 8, 7]);
    expect(Array.from(c.channels[1]!.sampler.output)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  test('is idempotent on a cached shared payload', () => {
    const s = 1.5;
    const c = clip([
      { joint: 'Hips', property: 'scale', out: [s, s, s] },
      { joint: 'Hips', property: 'translation', out: [3, 150, 6, 30, 300, 60] },
    ]);
    normalizeClipRoot(c, ROOT_IDS);
    const once = Array.from(c.channels[1]!.sampler.output);
    normalizeClipRoot(c, ROOT_IDS);
    expect(Array.from(c.channels[1]!.sampler.output)).toEqual(once);
    expect(Array.from(c.channels[0]!.sampler.output)).toEqual([1, 1, 1]);
  });
});
