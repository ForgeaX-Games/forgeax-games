import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { MaterialAsset } from '@forgeax/engine-types';
import {
  BLADE_WORLD_X,
  BLADE_Y_TOP,
  CUT_PLANE_Y0,
  CUT_PLANE_Y1,
  CUT_PLANE_Z0,
  CUT_PLANE_Z1,
} from '../core/constants';
import { HANDLE_CUBE, MeshFilter, MeshRenderer, Transform } from '@forgeax/engine-runtime';

type MatHandle = ReturnType<World['allocSharedRef']>;

export interface InfraredCutMarker {
  /** Pulse laser plane brightness (call each frame). */
  setPulse(phase01: number): void;
}

/** Fixed-world infrared sheet + emitter housings at the guillotine blade plane. */
export function spawnInfraredCutMarker(
  world: World,
  planeMat: MatHandle,
  emitterMat: MatHandle,
): InfraredCutMarker {
  const planeH = CUT_PLANE_Y1 - CUT_PLANE_Y0;
  const planeZ = CUT_PLANE_Z1 - CUT_PLANE_Z0;
  const planeY = (CUT_PLANE_Y0 + CUT_PLANE_Y1) * 0.5;
  const planeZc = (CUT_PLANE_Z0 + CUT_PLANE_Z1) * 0.5;

  const plane = world.spawn(
    { component: Transform, data: {
      posX: BLADE_WORLD_X, posY: planeY, posZ: planeZc,
      scaleX: 0.006, scaleY: planeH, scaleZ: planeZ,
    } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [planeMat], pickable: 0, frustumCulled: 0 } },
  ).unwrap();

  const emitters: EntityHandle[] = [];
  for (const [y, z] of [[BLADE_Y_TOP - 0.05, 0.48], [BLADE_Y_TOP - 0.05, -0.48]] as const) {
    const e = world.spawn(
      { component: Transform, data: {
        posX: BLADE_WORLD_X - 0.06, posY: y, posZ: z,
        scaleX: 0.05, scaleY: 0.05, scaleZ: 0.05,
      } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [emitterMat], pickable: 0, frustumCulled: 0 } },
    ).unwrap();
    emitters.push(e);
  }

  // Vertical scan lines on the plane.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const z = CUT_PLANE_Z0 + planeZ * t;
    world.spawn(
      { component: Transform, data: {
        posX: BLADE_WORLD_X + 0.002, posY: planeY, posZ: z,
        scaleX: 0.003, scaleY: planeH * 0.98, scaleZ: 0.008,
      } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [emitterMat], pickable: 0, frustumCulled: 0 } },
    );
  }

  return {
    setPulse(phase01: number): void {
      const pulse = 0.82 + 0.18 * Math.sin(phase01 * Math.PI * 2);
      const sx = 0.006 * pulse;
      world.set(plane, Transform, {
        posX: BLADE_WORLD_X, posY: planeY, posZ: planeZc,
        scaleX: sx, scaleY: planeH, scaleZ: planeZ,
      });
      for (const e of emitters) {
        const t = world.get(e, Transform);
        if (!t.ok) continue;
        const s = 0.05 * pulse;
        world.set(e, Transform, {
          ...t.value,
          scaleX: s, scaleY: s, scaleZ: s,
        });
      }
    },
  };
}
