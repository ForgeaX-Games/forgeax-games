import type { World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';

import { MOTHER_ICE_CENTER } from '../core/constants';

function staticBox(
  world: World,
  px: number, py: number, pz: number,
  hx: number, hy: number, hz: number,
  friction = 0.92,
): void {
  world.spawn(
    { component: Transform, data: { posX: px, posY: py, posZ: pz } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    {
      component: Collider,
      data: {
        shape: ColliderShapeValue.cuboid,
        halfExtentsX: hx,
        halfExtentsY: hy,
        halfExtentsZ: hz,
        friction,
        restitution: 0.02,
      },
    },
  );
}

/** Invisible collision shells for workshop props (tables, floor, pedestals). */
export function spawnWorkshopColliders(world: World): void {
  staticBox(world, 0, -0.05, 0, 8, 0.08, 7, 0.95);
  staticBox(world, 0, 0.07, 0, 0.82, 0.035, 0.66, 0.95);
  staticBox(world, 1.35, 0.03, 0, 0.47, 0.04, 0.47, 0.92);
  staticBox(world, MOTHER_ICE_CENTER.x, 0.24, MOTHER_ICE_CENTER.z, 0.52, 0.06, 0.52, 0.9);
  staticBox(world, 0.92, 0.58, 0, 0.08, 0.58, 0.52, 0.85);
}
