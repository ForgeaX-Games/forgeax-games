import { describe, expect, test } from 'bun:test';
import {
  countLivePreviewLights,
  previewLightsReleased,
  releasePreviewLightSlots,
  type PreviewLightSlots,
} from './preview-light-ownership';

describe('preview light ownership (PR2c T5-fix / C2+I3)', () => {
  test('hide-equivalent release despawns all preview lights', () => {
    const despawned: number[] = [];
    const live: PreviewLightSlots = {
      keyLight: 10,
      fillLight: 11,
      rimLight: 12,
      footLight: 13,
    };
    expect(countLivePreviewLights(live)).toBe(4);
    expect(previewLightsReleased(live)).toBe(false);

    const after = releasePreviewLightSlots((e) => {
      despawned.push(e);
    }, live);

    expect(despawned.sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
    expect(previewLightsReleased(after)).toBe(true);
    expect(countLivePreviewLights(after)).toBe(0);
    expect(after).toEqual({
      keyLight: null,
      fillLight: null,
      rimLight: null,
      footLight: null,
    });
  });

  test('release tolerates despawn throw and still clears slots', () => {
    const after = releasePreviewLightSlots(
      () => {
        throw new Error('already gone');
      },
      { keyLight: 1, fillLight: 2, rimLight: null, footLight: 3 },
    );
    expect(previewLightsReleased(after)).toBe(true);
  });
});
