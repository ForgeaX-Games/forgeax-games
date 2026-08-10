import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import type { Handle, MaterialAsset, MeshAsset } from '@forgeax/engine-types';

/** Khronos BoxTextured binary and external-buffer glTF sub-assets. */
export const GAME_DEFAULT_GLB_MESH_GUID = '019ea7c7-4eb7-7b5c-8195-c14c7a0e258c';
export const GAME_DEFAULT_GLB_MATERIAL_GUID = '019ea7c7-4eb7-7b5c-8195-c14d326307ba';
export const GAME_DEFAULT_GLTF_MESH_GUID = '019ea7c7-4ed4-74d6-ba47-2e215e31f6b0';
export const GAME_DEFAULT_GLTF_MATERIAL_GUID = '019ea7c7-4ed5-7780-8fc1-901400a5945f';

export type GltfMeshVariant = {
  readonly mesh: Handle<'MeshAsset', 'shared'>;
  readonly material: Handle<'MaterialAsset', 'shared'>;
};

export type GltfMeshSwap = {
  readonly entity: EntityHandle;
  readonly original: Handle<'MeshAsset', 'shared'>;
  readonly originalMaterials: readonly Handle<'MaterialAsset', 'shared'>[];
  readonly glb?: GltfMeshVariant;
  readonly gltf?: GltfMeshVariant;
  active: 'original' | 'glb' | 'gltf';
  swaps: number;
};

async function loadVariant(
  assets: AssetRegistry,
  label: 'GLB' | 'glTF',
  meshGuidText: string,
  materialGuidText: string,
): Promise<{ mesh: MeshAsset; material: MaterialAsset } | undefined> {
  const meshGuid = AssetGuid.parse(meshGuidText);
  const materialGuid = AssetGuid.parse(materialGuidText);
  if (!meshGuid.ok || !materialGuid.ok) {
    console.warn(`[game] ${label} asset GUID invalid`);
    return undefined;
  }
  const [meshResult, materialResult] = await Promise.all([
    assets.loadByGuid<MeshAsset>(meshGuid.value),
    assets.loadByGuid<MaterialAsset>(materialGuid.value),
  ]);
  if (!meshResult.ok) {
    console.warn(`[game] ${label} mesh unavailable: ${meshResult.error.code} — ${meshResult.error.hint}`);
    return undefined;
  }
  if (!materialResult.ok) {
    console.warn(`[game] ${label} material unavailable: ${materialResult.error.code} — ${materialResult.error.hint}`);
    return undefined;
  }
  return { mesh: meshResult.value, material: materialResult.value };
}

/** Load both Khronos container variants onto the same existing gameplay target. */
export async function createGltfMeshSwap(
  world: World,
  assets: AssetRegistry | undefined,
  entity: EntityHandle | undefined,
): Promise<GltfMeshSwap | undefined> {
  if (assets === undefined || entity === undefined) return undefined;
  const original = world.get(entity, MeshFilter);
  const originalRenderer = world.get(entity, MeshRenderer);
  if (!original.ok || !originalRenderer.ok || originalRenderer.value.materials.length === 0) return undefined;
  const [glb, gltf] = await Promise.all([
    loadVariant(assets, 'GLB', GAME_DEFAULT_GLB_MESH_GUID, GAME_DEFAULT_GLB_MATERIAL_GUID),
    loadVariant(assets, 'glTF', GAME_DEFAULT_GLTF_MESH_GUID, GAME_DEFAULT_GLTF_MATERIAL_GUID),
  ]);
  if (glb === undefined && gltf === undefined) return undefined;
  return {
    entity,
    original: original.value.assetHandle,
    originalMaterials: [...originalRenderer.value.materials],
    ...(glb === undefined ? {} : { glb: { mesh: world.allocSharedRef('MeshAsset', glb.mesh), material: world.allocSharedRef('MaterialAsset', glb.material) } }),
    ...(gltf === undefined ? {} : { gltf: { mesh: world.allocSharedRef('MeshAsset', gltf.mesh), material: world.allocSharedRef('MaterialAsset', gltf.material) } }),
    active: 'original',
    swaps: 0,
  };
}

export function setGltfMeshSwapVariant(world: World, state: GltfMeshSwap, variant: 'original' | 'glb' | 'gltf'): void {
  if (variant !== 'original' && state[variant] === undefined) return;
  state.active = variant;
  state.swaps += 1;
  const imported = variant === 'original' ? undefined : state[variant];
  world.set(state.entity, MeshFilter, { assetHandle: imported?.mesh ?? state.original });
  world.set(state.entity, MeshRenderer, { materials: imported === undefined ? [...state.originalMaterials] : [imported.material] });
}

export function resetGltfMeshSwap(world: World, state: GltfMeshSwap | undefined): void {
  if (state === undefined || state.active === 'original') return;
  state.active = 'original';
  world.set(state.entity, MeshFilter, { assetHandle: state.original });
  world.set(state.entity, MeshRenderer, { materials: [...state.originalMaterials] });
}
