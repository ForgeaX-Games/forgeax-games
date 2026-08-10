import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import type { MeshAsset, Handle } from '@forgeax/engine-types';

/** Mesh sub-asset emitted by the vendor cube.fbx sidecar. */
export const GAME_DEFAULT_FBX_MESH_GUID = '019ecd87-179a-7435-b383-6846514b9535';

export type FbxMeshSwap = {
  readonly entity: EntityHandle;
  readonly original: Handle<'MeshAsset', 'shared'>;
  readonly originalMaterials: readonly Handle<'MaterialAsset', 'shared'>[];
  readonly fbx: Handle<'MeshAsset', 'shared'>;
  active: 'original' | 'fbx';
  swaps: number;
};

/** Load the FBX mesh payload once; the existing target remains the sole owner. */
export async function createFbxMeshSwap(
  world: World,
  assets: AssetRegistry | undefined,
  entity: EntityHandle | undefined,
): Promise<FbxMeshSwap | undefined> {
  if (assets === undefined || entity === undefined) return undefined;
  const original = world.get(entity, MeshFilter);
  const originalRenderer = world.get(entity, MeshRenderer);
  if (!original.ok || !originalRenderer.ok || originalRenderer.value.materials.length === 0) return undefined;
  const guid = AssetGuid.parse(GAME_DEFAULT_FBX_MESH_GUID);
  if (!guid.ok) {
    console.warn(`[game] FBX mesh GUID invalid: ${guid.error.code}`);
    return undefined;
  }
  const loaded = await assets.loadByGuid<MeshAsset>(guid.value);
  if (!loaded.ok) {
    console.warn(`[game] FBX mesh unavailable: ${loaded.error.code} — ${loaded.error.hint}`);
    return undefined;
  }
  const fbx = world.allocSharedRef('MeshAsset', loaded.value);
  return {
    entity,
    original: original.value.assetHandle,
    originalMaterials: [...originalRenderer.value.materials],
    fbx,
    active: 'original',
    swaps: 0,
  };
}

export function toggleFbxMeshSwap(world: World, state: FbxMeshSwap): void {
  state.active = state.active === 'original' ? 'fbx' : 'original';
  state.swaps += 1;
  world.set(state.entity, MeshFilter, { assetHandle: state.active === 'fbx' ? state.fbx : state.original });
  // cube.fbx has one submesh while RedBox deliberately teaches two material
  // slots. Keep the swap on the same gameplay target without emitting the
  // renderer's material-count-mismatch error; reset restores both owners.
  world.set(state.entity, MeshRenderer, {
    materials: state.active === 'fbx' ? [state.originalMaterials[0]!] : [...state.originalMaterials],
  });
}

export function resetFbxMeshSwap(world: World, state: FbxMeshSwap | undefined): void {
  if (state === undefined || state.active === 'original') return;
  state.active = 'original';
  world.set(state.entity, MeshFilter, { assetHandle: state.original });
  world.set(state.entity, MeshRenderer, { materials: [...state.originalMaterials] });
}
