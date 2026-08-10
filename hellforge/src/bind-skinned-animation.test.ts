import { describe, expect, test } from 'bun:test';

describe('SceneInstance mapping filter (AnimationTargetId collect)', () => {
  test('skips only ENTITY_NULL_RAW sentinel, not entity index 0', () => {
    // Contract mirror of collectSkinnedAnimTargets: empty slots are 0xffffffff;
    // a live entity may legitimately be raw 0 on a fresh World.
    const ENTITY_NULL_RAW = 0xffffffff;
    const seen: number[] = [];
    const mapping = [0, ENTITY_NULL_RAW, 7, undefined] as unknown as readonly number[];
    for (const entRaw of mapping) {
      if (entRaw === undefined || entRaw === ENTITY_NULL_RAW) continue;
      seen.push(entRaw as number);
    }
    expect(seen).toEqual([0, 7]);
  });
});
