import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { MeshAsset } from '@forgeax/engine-types';
import {
  BLADE_WORLD_X,
  BLADE_Y_TOP,
  MOTHER_ICE_CENTER,
} from '../core/constants';
import {
  createBoxGeometry,
  createCylinderGeometry,
  HANDLE_CUBE,
  MeshFilter,
  MeshRenderer,
  Transform,
} from '@forgeax/engine-runtime';

type MatHandle = ReturnType<World['allocSharedRef']>;

function meshHandle(world: World, geo: { ok: boolean; value?: MeshAsset }): ReturnType<World['allocSharedRef']> {
  if (!geo.ok || !geo.value) return HANDLE_CUBE;
  return world.allocSharedRef('MeshAsset', geo.value);
}

function spawnPart(
  world: World,
  mesh: unknown,
  mat: MatHandle,
  px: number, py: number, pz: number,
  sx: number, sy: number, sz: number,
): EntityHandle {
  return world.spawn(
    { component: Transform, data: { posX: px, posY: py, posZ: pz, scaleX: sx, scaleY: sy, scaleZ: sz } },
    { component: MeshFilter, data: { assetHandle: mesh as never } },
    { component: MeshRenderer, data: { materials: [mat], pickable: 0 } },
  ).unwrap();
}

/** Carving workbench: thick top, apron, shelf, turned legs, metal brackets. */
export function spawnCarveTable(world: World, wood: MatHandle, metal: MatHandle): void {
  const cyl = meshHandle(world, createCylinderGeometry(0.5, 0.5, 1, 16));
  spawnPart(world, HANDLE_CUBE, wood, 0, 0.035, 0, 1.65, 0.07, 1.32);
  spawnPart(world, HANDLE_CUBE, wood, 0, -0.055, 0, 1.45, 0.05, 1.1);
  spawnPart(world, HANDLE_CUBE, wood, 0, -0.19, 0, 1.15, 0.04, 0.82);
  spawnPart(world, HANDLE_CUBE, wood, 0, 0.01, 0.62, 1.62, 0.09, 0.04);
  spawnPart(world, HANDLE_CUBE, wood, 0, 0.01, -0.62, 1.62, 0.09, 0.04);
  const legY = -0.11;
  const legH = 0.22;
  for (const [lx, lz] of [[0.68, 0.52], [-0.68, 0.52], [0.68, -0.52], [-0.68, -0.52]] as const) {
    spawnPart(world, cyl, wood, lx, legY, lz, 0.09, legH, 0.09);
  }
  for (const [lx, lz] of [[0.74, 0.58], [-0.74, 0.58], [0.74, -0.58], [-0.74, -0.58]] as const) {
    spawnPart(world, HANDLE_CUBE, metal, lx, 0.04, lz, 0.06, 0.05, 0.06);
  }
}

/** Fixed guillotine frame + animated blade entity. */
export function spawnGuillotine(world: World, wood: MatHandle, metal: MatHandle): { blade: EntityHandle } {
  const bx = BLADE_WORLD_X + 0.2;
  const z0 = -0.42;
  const z1 = 0.42;
  spawnPart(world, HANDLE_CUBE, wood, bx, 0.58, z0, 0.11, 1.16, 0.11);
  spawnPart(world, HANDLE_CUBE, wood, bx, 0.58, z1, 0.11, 1.16, 0.11);
  spawnPart(world, HANDLE_CUBE, wood, bx, 1.18, 0, 0.62, 0.1, 0.96);
  spawnPart(world, HANDLE_CUBE, wood, bx, 0.92, 0, 0.14, 0.55, 0.14);
  spawnPart(world, HANDLE_CUBE, metal, bx - 0.04, 0.55, 0, 0.025, 1.05, 0.52);
  spawnPart(world, HANDLE_CUBE, metal, bx + 0.02, 1.05, 0, 0.58, 0.06, 0.08);
  const bladeMesh = meshHandle(world, createBoxGeometry(0.04, 0.38, 0.58, 1, 1, 1));
  const blade = spawnPart(world, bladeMesh, metal, BLADE_WORLD_X, BLADE_Y_TOP, 0, 1, 1, 1);
  return { blade };
}

/** Raised wooden stand for the mother-ice block. */
export function spawnMotherPedestal(world: World, wood: MatHandle, metal: MatHandle): void {
  const { x, y, z } = MOTHER_ICE_CENTER;
  const baseY = y - 0.52;
  spawnPart(world, HANDLE_CUBE, wood, x, baseY, z, 1.05, 0.14, 1.05);
  spawnPart(world, HANDLE_CUBE, wood, x, baseY + 0.1, z, 0.92, 0.06, 0.92);
  for (const [ox, oz] of [[0.44, 0.44], [-0.44, 0.44], [0.44, -0.44], [-0.44, -0.44]] as const) {
    spawnPart(world, HANDLE_CUBE, wood, x + ox, baseY + 0.16, z + oz, 0.06, 0.1, 0.06);
  }
  spawnPart(world, HANDLE_CUBE, metal, x, baseY + 0.08, z + 0.48, 0.5, 0.03, 0.04);
}

/** Side delivery / staging platform. */
export function spawnDeliveryPlatform(world: World, wood: MatHandle): void {
  spawnPart(world, HANDLE_CUBE, wood, 1.35, -0.02, 0, 0.95, 0.1, 0.95);
  spawnPart(world, HANDLE_CUBE, wood, 1.35, -0.1, 0, 0.75, 0.06, 0.75);
  const cyl = meshHandle(world, createCylinderGeometry(0.5, 0.5, 1, 12));
  for (const [lx, lz] of [[1.05, 0.32], [1.65, 0.32], [1.05, -0.32], [1.65, -0.32]] as const) {
    spawnPart(world, cyl, wood, lx, -0.15, lz, 0.07, 0.12, 0.07);
  }
}
