import { describe, expect, it } from 'vitest';
import { SPAWN } from '../config/spawn.ts';
import { samplePlacement } from '../spawn/placement.ts';
import { createRng } from '../spawn/rng.ts';

const view = { minX: -12.5, maxX: 12.5, minZ: -12.5, maxZ: 12.5 };

function context(overrides: Partial<{
  playerX: number;
  playerZ: number;
  playerFacing: number;
}> = {}) {
  return {
    playerX: overrides.playerX ?? 0,
    playerZ: overrides.playerZ ?? 0,
    playerFacing: overrides.playerFacing ?? 0,
    view,
    markerXs: [] as number[],
    markerZs: [] as number[],
    enemyXs: [] as number[],
    enemyZs: [] as number[],
  };
}

describe('M2 enemy placement', () => {
  it('keeps strict scattered points in the visible ring', () => {
    const rng = createRng(0x1234);
    for (let index = 0; index < 500; index += 1) {
      const result = samplePlacement(rng, context(), 'scattered', null);
      const distance = Math.hypot(result.x, result.z);
      expect(result.relaxLevel).toBe(0);
      expect(distance).toBeGreaterThanOrEqual(SPAWN.placement.minRadius);
      expect(distance).toBeLessThanOrEqual(SPAWN.placement.maxRadius);
      expect(Math.abs(result.x)).toBeLessThanOrEqual(SPAWN.placement.arenaHalfExtent - SPAWN.placement.arenaInset);
      expect(Math.abs(result.z)).toBeLessThanOrEqual(SPAWN.placement.arenaHalfExtent - SPAWN.placement.arenaInset);
      expect(result.x).toBeGreaterThanOrEqual(view.minX + SPAWN.placement.viewInset);
      expect(result.x).toBeLessThanOrEqual(view.maxX - SPAWN.placement.viewInset);
      expect(result.z).toBeGreaterThanOrEqual(view.minZ + SPAWN.placement.viewInset);
      expect(result.z).toBeLessThanOrEqual(view.maxZ - SPAWN.placement.viewInset);
    }
  });

  it('keeps a group inside groupRadius of its anchor', () => {
    const rng = createRng(7);
    const anchor = { x: 8, z: 0 };
    for (let index = 0; index < 4; index += 1) {
      const result = samplePlacement(rng, context(), 'group', anchor);
      expect(Math.hypot(result.x - anchor.x, result.z - anchor.z)).toBeLessThanOrEqual(SPAWN.placement.groupRadius + 1e-6);
    }
  });

  it('places edge points on the inner view rectangle and remains deterministic', () => {
    const first = createRng(99);
    const second = createRng(99);
    for (let index = 0; index < 50; index += 1) {
      const left = samplePlacement(first, context(), 'edge', null);
      const right = samplePlacement(second, context(), 'edge', null);
      expect(left).toEqual(right);
      const minX = view.minX + SPAWN.placement.viewInset;
      const maxX = view.maxX - SPAWN.placement.viewInset;
      const minZ = view.minZ + SPAWN.placement.viewInset;
      const maxZ = view.maxZ - SPAWN.placement.viewInset;
      const onEdge = Math.min(Math.abs(left.x - minX), Math.abs(left.x - maxX), Math.abs(left.z - minZ), Math.abs(left.z - maxZ));
      expect(onEdge).toBeLessThanOrEqual(1e-6);
      expect(Math.hypot(left.x, left.z)).toBeGreaterThanOrEqual(SPAWN.placement.minRadius);
    }
  });

  it('always returns finite in-bounds coordinates for a pathological full ring', () => {
    const markers = Array.from({ length: 40 }, (_, index) => Math.cos(index) * 8);
    const markerZs = Array.from({ length: 40 }, (_, index) => Math.sin(index) * 8);
    const result = samplePlacement(
      createRng(123),
      { ...context(), markerXs: markers, markerZs },
      'scattered',
      null,
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.z)).toBe(true);
    expect(Math.abs(result.x)).toBeLessThanOrEqual(13);
    expect(Math.abs(result.z)).toBeLessThanOrEqual(13);
    expect(result.relaxLevel).toBeGreaterThanOrEqual(0);
    expect(result.relaxLevel).toBeLessThanOrEqual(4);
  });

  it('keeps wall-side players inside the deployment rectangle', () => {
    const rng = createRng(321);
    for (let index = 0; index < 200; index += 1) {
      const result = samplePlacement(rng, context({ playerX: 13, playerZ: 13 }), 'scattered', null);
      expect(Math.abs(result.x)).toBeLessThanOrEqual(13);
      expect(Math.abs(result.z)).toBeLessThanOrEqual(13);
    }
  });
});
