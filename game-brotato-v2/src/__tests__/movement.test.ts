import { describe, expect, it } from 'vitest';
import { ARENA } from '../config/arena.ts';
import { MOVEMENT, stepMovement, type MovementState } from '../config/movement.ts';

const stopped: MovementState = {
  posX: 0,
  posZ: 0,
  velocityX: 0,
  velocityZ: 0,
  facing: 0,
};

describe('Brotato v2 M1 movement integrator', () => {
  it('reaches max speed and stops within the 0.11 second release target', () => {
    const moving = stepMovement(stopped, { x: 1, z: 0 }, 0.5);
    expect(moving.velocityX).toBeCloseTo(MOVEMENT.maxSpeed, 6);
    const released = stepMovement(moving, { x: 0, z: 0 }, 0.11);
    expect(released.velocityX).toBe(0);
    expect(released.velocityZ).toBe(0);
  });

  it('normalizes diagonal input so its speed is not faster than cardinal input', () => {
    const diagonal = stepMovement(stopped, { x: 1, z: 1 }, 0.5);
    expect(Math.hypot(diagonal.velocityX, diagonal.velocityZ)).toBeLessThanOrEqual(MOVEMENT.maxSpeed + 1e-6);
  });

  it('clamps an edge collision and removes outward velocity on that axis', () => {
    const edge = stepMovement(
      { ...stopped, posX: ARENA.limit - 0.01, velocityX: MOVEMENT.maxSpeed },
      { x: 1, z: 0 },
      1 / 60,
    );
    expect(edge.posX).toBe(ARENA.limit);
    expect(edge.velocityX).toBe(0);
  });
});
