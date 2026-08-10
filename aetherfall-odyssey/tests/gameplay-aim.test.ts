import type { EntityHandle } from '@forgeax/engine-ecs';
import { describe, expect, it } from 'vitest';
import { resolveShotDirection } from '../assets/plugins/gameplay-aim';

const playerEntity = 1 as EntityHandle;

describe('gameplay aim', () => {
  it('uses the world-space pick point instead of the picked entity origin', () => {
    const direction = resolveShotDirection({
      player: { x: 2, z: 3 },
      playerEntity,
      hit: {
        entity: 2 as EntityHandle,
        point: [6, 0, 3],
        distance: 1,
      },
      ray: undefined,
    });

    expect(direction?.x).toBeCloseTo(1);
    expect(direction?.z).toBeCloseTo(0);
  });

  it('projects a miss or self-hit ray onto the gameplay ground plane', () => {
    const direction = resolveShotDirection({
      player: { x: 0, z: 0 },
      playerEntity,
      hit: undefined,
      ray: [4, 10, 6, 0.3, -0.8, -0.2],
    });

    expect(direction?.x).toBeCloseTo(0.91137, 4);
    expect(direction?.z).toBeCloseTo(0.41159, 4);
  });

  it('projects a rendered player body-part hit instead of aiming at the avatar mesh', () => {
    const direction = resolveShotDirection({
      player: { x: 0, z: 0 },
      playerEntity,
      hit: {
        entity: 2 as EntityHandle,
        point: [0, 0.75, -1],
        distance: 1,
      },
      hitIsPlayerBodyPart: true,
      ray: [0, 10, 0, 0.2, -0.8, -0.5],
    });

    expect(direction?.x).toBeCloseTo(0.37139, 4);
    expect(direction?.z).toBeCloseTo(-0.92848, 4);
  });

  it('does not use a ray parallel to the ground as a fake target', () => {
    const direction = resolveShotDirection({
      player: { x: 0, z: 0 },
      playerEntity,
      hit: undefined,
      ray: [0, 10, 0, 1, 0, 0],
    });

    expect(direction).toBeUndefined();
  });
});
