import { describe, expect, test } from 'bun:test';
import { DUNGEON_ORIGIN, denMountainRingOrigin } from './dungeon-origin';
import { CELL, CELLS } from './dungeon-layout';

describe('denMountainRingOrigin', () => {
  test('centres the ring on DUNGEON_ORIGIN, not the +x/+z corner', () => {
    const origin = denMountainRingOrigin();
    expect(origin).toEqual(DUNGEON_ORIGIN);
    const denHalf = (CELLS * CELL) / 2;
    expect(origin.x).not.toBe(DUNGEON_ORIGIN.x + denHalf);
    expect(origin.z).not.toBe(DUNGEON_ORIGIN.z + denHalf);
  });
});
