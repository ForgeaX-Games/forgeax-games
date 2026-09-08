import { describe, expect, it } from 'vitest';
import { AXE_PROFILE } from '../../assets/lib/weapons/axe.ts';
import { SPEAR_PROFILE } from '../../assets/lib/weapons/spear.ts';
import { assignTargets, type TargetingInput } from '../combat/targeting.ts';

function input(overrides: Partial<TargetingInput> = {}): TargetingInput {
  return {
    enemyIds: [11, 22],
    enemyXs: [0, 2],
    enemyZs: [3, 0],
    enemyHealth: [10, 10],
    enemyRadius: 0.1,
    playerX: 0,
    playerZ: 0,
    playerFacing: 0,
    slots: [
      { profile: SPEAR_PROFILE, slotAngle: -Math.PI / 2, ready: true },
      { profile: AXE_PROFILE, slotAngle: Math.PI / 2, ready: true },
    ],
    ringRadius: 0.62,
    ...overrides,
  };
}

describe('M2 three-layer target assignment', () => {
  it('distributes two ready weapons across two targets', () => {
    const assignments = assignTargets(input());
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.hits[0]).not.toBe(assignments[1]?.hits[0]);
  });

  it('predicts a kill and leaves the second weapon without a target', () => {
    const assignments = assignTargets(input({
      enemyIds: [11], enemyXs: [0], enemyZs: [3], enemyHealth: [10],
    }));
    expect(assignments[0]?.hits).toEqual([11]);
    expect(assignments[1]?.hits).toEqual([]);
  });

  it('allows a necessary repeat when the first hit cannot kill', () => {
    const assignments = assignTargets(input({
      enemyIds: [11], enemyXs: [0], enemyZs: [2], enemyHealth: [25],
    }));
    expect(assignments[0]?.hits).toEqual([11]);
    expect(assignments[1]?.hits).toEqual([11]);
  });

  it('uses weapon position separation for left/right enemies', () => {
    const assignments = assignTargets(input({
      enemyIds: [3, 4], enemyXs: [-2, 2], enemyZs: [0, 0],
    }));
    expect(assignments[0]?.hits[0]).toBe(3);
    expect(assignments[1]?.hits[0]).toBe(4);
  });

  it('is deterministic for tied distance and repeated input', () => {
    const tied = input({ enemyIds: [22, 11], enemyXs: [0, 0], enemyZs: [3, 3] });
    expect(assignTargets(tied)).toEqual(assignTargets(tied));
    expect(assignTargets(input({ enemyIds: [7, 2], enemyXs: [0, 0], enemyZs: [3, 3] }))[0]?.hits[0]).toBe(2);
  });

  it('returns every enemy inside one sweep, up to the profile limit', () => {
    const assignments = assignTargets(input({
      enemyIds: [11, 22, 33],
      enemyXs: [0, 0.6, -0.6],
      enemyZs: [2, 2, 2],
      enemyHealth: [10, 10, 10],
      slots: [{ profile: AXE_PROFILE, slotAngle: 0, ready: true }],
    }));
    expect(assignments[0]?.hits).toEqual([11, 22, 33]);
  });
});
