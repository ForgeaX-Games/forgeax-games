import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { MeshAsset } from '@forgeax/engine-types';
import { HANDLE_CUBE, MeshFilter, MeshRenderer, Name, Transform } from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';

import type { IceGrid } from './ice-grid';
import { buildIceMesh } from './mesh-builder';
import { buildIceEdgeMesh, buildIceSilhouetteEdgeMesh } from './mesh-edges';

type MatHandle = ReturnType<World['allocSharedRef']>;

export function gridHalfExtents(grid: IceGrid): { hx: number; hy: number; hz: number } {
  const h = (grid.size * grid.cell) / 2;
  return { hx: h, hy: h, hz: h };
}

function attachIcePhysics(world: World, entity: EntityHandle, grid: IceGrid): void {
  const { hx, hy, hz } = gridHalfExtents(grid);
  world.addComponent(entity, {
    component: RigidBody,
    data: {
      type: RigidBodyTypeValue.dynamic,
      mass: 2.4,
      linearDamping: 0.35,
      angularDamping: 0.55,
      gravityScale: 1,
      ccdEnabled: true,
    },
  });
  world.addComponent(entity, {
    component: Collider,
    data: {
      shape: ColliderShapeValue.cuboid,
      halfExtentsX: hx,
      halfExtentsY: hy,
      halfExtentsZ: hz,
      friction: 0.55,
      restitution: 0.08,
      density: 0.9,
    },
  });
}

export function syncIceCollider(world: World, entity: EntityHandle, grid: IceGrid): void {
  const { hx, hy, hz } = gridHalfExtents(grid);
  const col = world.get(entity, Collider);
  if (!col.ok) return;
  world.set(entity, Collider, {
    ...col.value,
    halfExtentsX: hx,
    halfExtentsY: hy,
    halfExtentsZ: hz,
  });
}

/** Count filled voxels. */
export function countFilled(grid: IceGrid): number {
  const s = grid.subSize;
  let n = 0;
  for (let z = 0; z < s; z++) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (grid.isSubFilled(x, y, z)) n++;
      }
    }
  }
  return n;
}

/** Uniform cube scale from fill ratio (visible fallback using builtin mesh). */
export function iceCubeScale(grid: IceGrid): number {
  const s = grid.subSize;
  const total = s * s * s;
  const filled = countFilled(grid);
  if (filled <= 0) return grid.cell;
  const ratio = filled / total;
  return grid.size * grid.cell * Math.cbrt(ratio);
}

/** Spawn ice as greedy-mesh voxel surface (detailed translucent block). */
export function spawnIceVoxel(
  world: World,
  mat: MatHandle,
  grid: IceGrid,
  center: { x: number; y: number; z: number },
  name: string,
): EntityHandle {
  const meshAsset = buildIceMesh(grid);
  const meshHandle = world.allocSharedRef<'MeshAsset', MeshAsset>('MeshAsset', meshAsset);
  const entity = world.spawn(
    { component: Name, data: { value: name } },
    {
      component: Transform,
      data: {
        posX: center.x,
        posY: center.y,
        posZ: center.z,
        quatX: 0, quatY: 0, quatZ: 0, quatW: 1,
      },
    },
    { component: MeshFilter, data: { assetHandle: meshHandle } },
    { component: MeshRenderer, data: { materials: [mat], frustumCulled: 0, pickable: 1 } },
  ).unwrap();
  attachIcePhysics(world, entity, grid);
  return entity;
}

/** Fallback scaled cube when voxel mesh is empty. */
export function spawnIceCube(
  world: World,
  mat: MatHandle,
  grid: IceGrid,
  center: { x: number; y: number; z: number },
  name: string,
): EntityHandle {
  const scale = iceCubeScale(grid);
  return world.spawn(
    { component: Name, data: { value: name } },
    {
      component: Transform,
      data: {
        posX: center.x,
        posY: center.y,
        posZ: center.z,
        scaleX: scale,
        scaleY: scale,
        scaleZ: scale,
      },
    },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [mat], frustumCulled: 0 } },
  ).unwrap();
}

export function updateIceVoxelMesh(world: World, entity: EntityHandle, grid: IceGrid): void {
  const meshHandle = world.allocSharedRef('MeshAsset', buildIceMesh(grid));
  world.set(entity, MeshFilter, { assetHandle: meshHandle });
  syncIceCollider(world, entity, grid);
}

/** Non-physics overlay mesh (edges / cut preview) sharing workpiece transform. */
export function spawnIceOverlay(
  world: World,
  mat: MatHandle,
  meshAsset: MeshAsset,
  center: { x: number; y: number; z: number },
  name: string,
): EntityHandle {
  const meshHandle = world.allocSharedRef('MeshAsset', meshAsset);
  return world.spawn(
    { component: Name, data: { value: name } },
    {
      component: Transform,
      data: {
        posX: center.x,
        posY: center.y,
        posZ: center.z,
        quatX: 0, quatY: 0, quatZ: 0, quatW: 1,
      },
    },
    { component: MeshFilter, data: { assetHandle: meshHandle } },
    { component: MeshRenderer, data: { materials: [mat], frustumCulled: 0, pickable: 0 } },
  ).unwrap();
}

export function updateOverlayMesh(world: World, entity: EntityHandle, meshAsset: MeshAsset): void {
  const meshHandle = world.allocSharedRef('MeshAsset', meshAsset);
  world.set(entity, MeshFilter, { assetHandle: meshHandle });
}

/** World-space debug / laser overlay (identity transform, verts in world coords). */
export function spawnWorldMeshOverlay(
  world: World,
  mat: MatHandle,
  meshAsset: MeshAsset,
  name: string,
): EntityHandle {
  const meshHandle = world.allocSharedRef('MeshAsset', meshAsset);
  return world.spawn(
    { component: Name, data: { value: name } },
    { component: Transform, data: { quatW: 1 } },
    { component: MeshFilter, data: { assetHandle: meshHandle } },
    { component: MeshRenderer, data: { materials: [mat], frustumCulled: 0, pickable: 0 } },
  ).unwrap();
}

export function buildWorkpieceEdgeMesh(grid: IceGrid): MeshAsset {
  return buildIceEdgeMesh(grid);
}

export function buildWorkpieceSilhouetteMesh(grid: IceGrid): MeshAsset {
  return buildIceSilhouetteEdgeMesh(grid);
}
