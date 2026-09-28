import { describe, expect, test } from 'bun:test';
import { clearTerrainFootprint, transformedTerrainFootprint, type TerrainFootprint } from './terrain-clearance';

function clearsFloor(p: readonly number[], f: TerrainFootprint, origin = [300, 300], edge = 64.8): boolean {
  const x = p[0]! - origin[0]!, z = p[1]! - origin[1]!;
  const tolerance = 1e-7;
  return x + f[0] >= edge - tolerance || x + f[2] <= -edge + tolerance
    || z + f[1] >= edge - tolerance || z + f[3] <= -edge + tolerance;
}

describe('background terrain camera clearance', () => {
  test('transforms all corners, including height under lean and nonuniform scale', () => {
    const identity = transformedTerrainFootprint([-2, 0, -1, 3, 5, 2], [0, 0, 0, 1], [2, 4, 3]);
    expect(identity).toEqual([-4, -3, 6, 6]);
    const rotated = transformedTerrainFootprint([-2, 0, -1, 3, 5, 2], [0, 0, Math.SQRT1_2, Math.SQRT1_2], [2, 4, 3]);
    expect(rotated[0]).toBeCloseTo(-20);
    expect(rotated[2]).toBeCloseTo(0);
    expect(rotated[1]).toBeCloseTo(-3);
    expect(rotated[3]).toBeCloseTo(6);
  });

  test('leaves already separated peaks unchanged and does not mutate inputs', () => {
    const p = [420, 300] as const;
    const footprint = [-20, -30, 40, 35] as const;
    expect(clearTerrainFootprint(p, [300, 300], 52.8, footprint)).toEqual(p);
    expect(footprint).toEqual([-20, -30, 40, 35]);
  });

  test('clears every quadrant and axial heading without changing the heading', () => {
    const footprint = [-41, -64, 73, 37] as const;
    for (let i = 0; i < 360; i += 5) {
      const a = i * Math.PI / 180;
      const p = [300 + Math.cos(a) * 75, 300 + Math.sin(a) * 75] as const;
      const moved = clearTerrainFootprint(p, [300, 300], 52.8, footprint);
      expect(clearsFloor(moved, footprint)).toBe(true);
      expect(Math.hypot(moved[0] - 300, moved[1] - 300)).toBeGreaterThanOrEqual(75 - 1e-7);
      expect((moved[0] - 300) * Math.sin(a) - (moved[1] - 300) * Math.cos(a)).toBeCloseTo(0);
    }
  });

  test('a tall tilted peak cannot protrude across the floor or camera arm', () => {
    const bounds = new Float32Array([-0.663, 0, -0.495, 0.727, 1, 0.477]);
    for (let i = 0; i < 36; i++) {
      const angle = i * Math.PI / 18;
      const lean = 0.38;
      const q: [number, number, number, number] = [Math.sin(lean / 2) * Math.cos(angle), 0, Math.sin(lean / 2) * Math.sin(angle), Math.cos(lean / 2)];
      const footprint = transformedTerrainFootprint(bounds, q, [105, 42, 133]);
      const moved = clearTerrainFootprint([300 + Math.cos(angle) * 80, 300 + Math.sin(angle) * 80], [300, 300], 52.8, footprint);
      expect(clearsFloor(moved, footprint)).toBe(true);
    }
  });

  test('handles an accidental peak at the ring centre deterministically', () => {
    expect(clearTerrainFootprint([300, 300], [300, 300], 52.8, [-10, -10, 10, 10])).toEqual([374.8, 300]);
  });
});
