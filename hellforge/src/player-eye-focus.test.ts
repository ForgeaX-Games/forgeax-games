import { describe, expect, test } from 'bun:test';
import {
  eyeBiasForBone,
  eyeFocusFromHeadWorld,
  pickBestEyeFocusBone,
  PLAYER_EYE_FOCUS_BONE_CANDIDATES,
  translationFromWorldMat4,
} from './player-eye-focus';

describe('translationFromWorldMat4', () => {
  test('reads column-major translation', () => {
    const m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    m[12] = 3; m[13] = 1.9; m[14] = -2;
    const t = translationFromWorldMat4(m);
    expect(t[0]).toBeCloseTo(3, 5);
    expect(t[1]).toBeCloseTo(1.9, 5);
    expect(t[2]).toBeCloseTo(-2, 5);
  });
});

describe('pickBestEyeFocusBone', () => {
  test('prefers headfront over Head', () => {
    const pick = pickBestEyeFocusBone([
      { ent: 1, name: 'neck' },
      { ent: 2, name: 'Head' },
      { ent: 3, name: 'headfront' },
    ]);
    expect(pick).toEqual({ ent: 3, name: 'headfront' });
  });

  test('falls back along candidate order', () => {
    const pick = pickBestEyeFocusBone([
      { ent: 9, name: 'mixamorig:Head' },
      { ent: 8, name: 'Spine' },
    ]);
    expect(pick?.name).toBe('mixamorig:Head');
    expect(PLAYER_EYE_FOCUS_BONE_CANDIDATES[0]).toBe('headfront');
  });
});

describe('eyeFocusFromHeadWorld', () => {
  test('nudges along faceXZ and up by scale', () => {
    const bias = eyeBiasForBone('Head');
    const eye = eyeFocusFromHeadWorld([0, 2, 0], [0, -1], 1.3, bias);
    expect(eye[0]).toBeCloseTo(0, 5);
    expect(eye[1]).toBeCloseTo(2 + bias.up * 1.3, 5);
    expect(eye[2]).toBeCloseTo(-bias.forward * 1.3, 5);
  });

  test('headfront bias is smaller forward push', () => {
    expect(eyeBiasForBone('headfront').forward).toBeLessThan(eyeBiasForBone('Head').forward);
  });
});
