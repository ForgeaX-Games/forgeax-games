import { describe, expect, it } from 'vitest';
import { resolveCircleOverlaps, type CollisionCircle } from '../combat/collision.ts';
import { isCooldownReady, tickCooldown } from '../combat/timing.ts';

function distance(left: CollisionCircle, right: CollisionCircle): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

describe('Brotato v2 combat stability', () => {
  it('advances a weapon cooldown until it can fire again', () => {
    expect(tickCooldown(0.5, 0.25)).toBeCloseTo(0.25);
    expect(tickCooldown(0.25, 0.25)).toBe(0);
    expect(tickCooldown(0.5, -1)).toBe(0.5);
    expect(isCooldownReady(0.001)).toBe(false);
    expect(isCooldownReady(0)).toBe(true);
  });

  it('does not allow a second attack during the cooldown buffer', () => {
    let cooldown = 0;
    const attackTicks: number[] = [];
    const fixedDelta = 1 / 60;
    const attackInterval = 2;
    for (let tick = 0; tick < 241; tick += 1) {
      cooldown = tickCooldown(cooldown, fixedDelta);
      if (!isCooldownReady(cooldown)) continue;
      attackTicks.push(tick);
      cooldown = attackInterval;
    }
    expect(attackTicks).toEqual([0, 120, 240]);
  });

  it('keeps player and active enemies from overlapping', () => {
    const player: CollisionCircle = { x: 0, z: 0, radius: 0.58 };
    const enemies: CollisionCircle[] = [
      { x: 0, z: 0.9, radius: 0.52 },
      { x: 0, z: 1.4, radius: 0.52 },
      { x: 0.8, z: 1.1, radius: 0.52 },
    ];

    resolveCircleOverlaps(enemies, player, 32);

    for (const enemy of enemies) {
      expect(distance(enemy, player)).toBeGreaterThanOrEqual(1.1 - 1e-6);
    }
    for (let left = 0; left < enemies.length; left += 1) {
      for (let right = left + 1; right < enemies.length; right += 1) {
        const first = enemies[left];
        const second = enemies[right];
        if (first === undefined || second === undefined) continue;
        expect(distance(first, second)).toBeGreaterThanOrEqual(1.04 - 1e-6);
      }
    }
  });
});
