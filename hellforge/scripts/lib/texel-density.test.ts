import { describe, expect, test } from 'bun:test';
import {
  triangleTexelDensityPxPerM,
  weightedMeanDensity,
} from './texel-density.ts';

describe('triangleTexelDensityPxPerM', () => {
  test('2m×2m quad UV 0–1 with 128² texture → 64 px/m', () => {
    // Two triangles covering a 2×2 floor top, UV unit square, 128² albedo.
    const d0 = triangleTexelDensityPxPerM(
      [-1, 0, -1], [1, 0, -1], [1, 0, 1],
      [0, 0], [1, 0], [1, 1],
      128, 128,
    );
    const d1 = triangleTexelDensityPxPerM(
      [-1, 0, -1], [1, 0, 1], [-1, 0, 1],
      [0, 0], [1, 1], [0, 1],
      128, 128,
    );
    expect(d0).toBeCloseTo(64, 5);
    expect(d1).toBeCloseTo(64, 5);
  });

  test('returns null for degenerate world area', () => {
    expect(triangleTexelDensityPxPerM(
      [0, 0, 0], [1, 0, 0], [2, 0, 0],
      [0, 0], [1, 0], [0, 1],
      128, 128,
    )).toBeNull();
  });
});

describe('weightedMeanDensity', () => {
  test('area-weights triangle densities', () => {
    // One 1 m² face at 128 px/m, one 3 m² face at 64 px/m → mean 80.
    const mean = weightedMeanDensity([
      { densityPxPerM: 128, worldAreaM2: 1 },
      { densityPxPerM: 64, worldAreaM2: 3 },
    ]);
    expect(mean).toBeCloseTo(80, 5);
  });

  test('returns null when no area', () => {
    expect(weightedMeanDensity([])).toBeNull();
  });
});
