import {
  createPrimitiveMesh,
  type PrimitiveMeshKind,
} from '@forgeax/engine/geometry';
import type { World } from '@forgeax/engine/ecs';
import type { Handle } from '@forgeax/engine/types';

type MeshHandle = Handle<'MeshAsset', 'shared'>;

// Primitive geometry is an Engine-owned resource. Keep one handle per kind
// and World so all Hellforge systems share the same canonical mesh asset.
const cache = new WeakMap<World, Map<PrimitiveMeshKind, MeshHandle>>();

export function primitiveMesh(world: World, kind: PrimitiveMeshKind): MeshHandle {
  let byKind = cache.get(world);
  if (byKind === undefined) {
    byKind = new Map();
    cache.set(world, byKind);
  }
  const existing = byKind.get(kind);
  if (existing !== undefined) return existing;
  const handle = world.internSharedRef('MeshAsset', createPrimitiveMesh(kind).unwrap());
  byKind.set(kind, handle);
  return handle;
}
