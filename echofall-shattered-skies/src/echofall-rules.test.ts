import { describe, expect, test } from 'bun:test';
import {
  canAttune,
  checkpointLabel,
  explorationObjective,
  normalizedAxes,
  regionForPosition,
  requiredShards,
} from './echofall-rules';

describe('Echofall exploration rules', () => {
  test('gates the three beacons in order with generous shard thresholds', () => {
    expect([0, 1, 2].map(requiredShards)).toEqual([2, 4, 6]);
    expect(canAttune(0, 0, 2)).toBeTrue();
    expect(canAttune(1, 0, 8)).toBeFalse();
    expect(canAttune(1, 1, 4)).toBeTrue();
  });

  test('normalizes diagonal movement without slowing single-axis travel', () => {
    expect(normalizedAxes(1, 0)).toEqual([1, 0]);
    const [forward, strafe] = normalizedAxes(1, 1);
    expect(Math.hypot(forward, strafe)).toBeCloseTo(1);
  });

  test('derives region labels from world position', () => {
    expect(regionForPosition(20)).toBe('FRACTURED SHORE');
    expect(regionForPosition(0)).toBe('WIND-SCAR MONASTERY');
    expect(regionForPosition(-18)).toBe('STARFALL OBSERVATORY');
    expect(regionForPosition(-31)).toBe('AETHER ALTAR');
  });

  test('keeps the next objective actionable and checkpoint recovery legible', () => {
    expect(explorationObjective(0, 0)).toBe('FIND 2 ECHO SHARDS FOR DAWN');
    expect(explorationObjective(0, 2)).toBe('FOLLOW THE LIGHT · ATTUNE DAWN');
    expect(explorationObjective(3, 8)).toBe('THE REACH IS RESTORED');
    expect(checkpointLabel('arrival')).toBe('ARRIVAL');
    expect(checkpointLabel('gale')).toBe('GALE BEACON');
  });
});
