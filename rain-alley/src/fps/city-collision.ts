import type { World } from '@forgeax/engine-ecs';
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from '@forgeax/engine-physics';
import { Name, Transform } from '@forgeax/engine-scene';
import { STREET_COLLISION_PROXIES } from '../street-layout';
import { CITY_LAYOUT } from './city-layout';
export const CITY_COLLIDERS = STREET_COLLISION_PROXIES.map((p) => {
  const key = p.name.match(/^COL_GB_Block_(\d+)$/)?.[1];
  const height = key
    ? (CITY_LAYOUT.heightOverrides as Record<string, number>)[key]
    : undefined;
  return height === undefined
    ? p
    : {
        ...p,
        center: [p.center[0], height / 2, p.center[2]],
        size: [p.size[0], height, p.size[2]],
      };
}).concat(CITY_LAYOUT.colliders as unknown as typeof STREET_COLLISION_PROXIES);
export function installCityCollision(world: World) {
  for (const p of CITY_COLLIDERS)
    world
      .spawn(
        { component: Name, data: { value: p.name } },
        {
          component: Transform,
          data: {
            pos: [...p.center],
            scale: [...p.size],
            ...('rotation' in p && p.rotation ? { quat: [...p.rotation] } : {}),
          },
        },
        { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
        {
          component: Collider,
          data: {
            shape: ColliderShapeValue.cuboid,
            halfExtents: [0.5, 0.5, 0.5],
            friction: 0.9,
            restitution: 0,
          },
        },
      )
      .unwrap();
}
