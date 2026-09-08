import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { meshAssetKind } from '@forgeax/engine-geometry';
import type { World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';
import { materialAssetKind } from '@forgeax/engine-types';
import { ASSET_IDS } from './asset-ids.ts';

export type MeshHandle = Handle<'MeshAsset', 'shared'>;
export type MaterialHandle = Handle<'MaterialAsset', 'shared'>;

export interface CombatAssets {
  readonly potatoMesh: MeshHandle;
  readonly spearMesh: MeshHandle;
  readonly axeMesh: MeshHandle;
  readonly spawnMarkerMesh: MeshHandle;
  readonly spearRangeMesh: MeshHandle;
  readonly axeRangeMesh: MeshHandle;
  readonly potatoBodyMaterial: MaterialHandle;
  readonly potatoSproutMaterial: MaterialHandle;
  readonly tomatoEyeMaterial: MaterialHandle;
  readonly weaponWoodMaterial: MaterialHandle;
  readonly weaponSteelMaterial: MaterialHandle;
  readonly hitFlashMaterial: MaterialHandle;
  readonly spawnMarkerMaterial: MaterialHandle;
  readonly attackRangeMaterial: MaterialHandle;
  readonly handles: readonly (MeshHandle | MaterialHandle)[];
}

async function loadMesh(world: World, assets: AssetRegistry, guid: string): Promise<MeshHandle> {
  const loaded = await assets.load(guid, meshAssetKind);
  if (!loaded.ok) throw new Error(`Brotato v2 combat mesh load failed (${guid}): ${loaded.error.hint}`);
  return world.allocSharedRef('MeshAsset', loaded.value);
}

async function loadMaterial(world: World, assets: AssetRegistry, guid: string): Promise<MaterialHandle> {
  const loaded = await assets.load(guid, materialAssetKind);
  if (!loaded.ok) throw new Error(`Brotato v2 combat material load failed (${guid}): ${loaded.error.hint}`);
  return world.allocSharedRef('MaterialAsset', loaded.value);
}

export async function loadCombatAssets(world: World, assets: AssetRegistry): Promise<CombatAssets> {
  const [
    potatoMesh,
    spearMesh,
    axeMesh,
    spawnMarkerMesh,
    spearRangeMesh,
    axeRangeMesh,
    potatoBodyMaterial,
    potatoSproutMaterial,
    tomatoEyeMaterial,
    weaponWoodMaterial,
    weaponSteelMaterial,
    hitFlashMaterial,
    spawnMarkerMaterial,
    attackRangeMaterial,
  ] = await Promise.all([
    loadMesh(world, assets, ASSET_IDS.meshEnemyPotato),
    loadMesh(world, assets, ASSET_IDS.meshWeaponSpear),
    loadMesh(world, assets, ASSET_IDS.meshWeaponAxe),
    loadMesh(world, assets, ASSET_IDS.meshSpawnMarker),
    loadMesh(world, assets, ASSET_IDS.meshRangeSpear),
    loadMesh(world, assets, ASSET_IDS.meshRangeAxe),
    loadMaterial(world, assets, ASSET_IDS.materialPotatoBody),
    loadMaterial(world, assets, ASSET_IDS.materialPotatoSprout),
    loadMaterial(world, assets, ASSET_IDS.materialTomatoEye),
    loadMaterial(world, assets, ASSET_IDS.materialWeaponWood),
    loadMaterial(world, assets, ASSET_IDS.materialWeaponSteel),
    loadMaterial(world, assets, ASSET_IDS.materialHitFlash),
    loadMaterial(world, assets, ASSET_IDS.materialSpawnMarker),
    loadMaterial(world, assets, ASSET_IDS.materialAttackRange),
  ]);
  const handles = [
    potatoMesh,
    spearMesh,
    axeMesh,
    spawnMarkerMesh,
    spearRangeMesh,
    axeRangeMesh,
    potatoBodyMaterial,
    potatoSproutMaterial,
    tomatoEyeMaterial,
    weaponWoodMaterial,
    weaponSteelMaterial,
    hitFlashMaterial,
    spawnMarkerMaterial,
    attackRangeMaterial,
  ] as const;
  return {
    potatoMesh,
    spearMesh,
    axeMesh,
    spawnMarkerMesh,
    spearRangeMesh,
    axeRangeMesh,
    potatoBodyMaterial,
    potatoSproutMaterial,
    tomatoEyeMaterial,
    weaponWoodMaterial,
    weaponSteelMaterial,
    hitFlashMaterial,
    spawnMarkerMaterial,
    attackRangeMaterial,
    handles,
  };
}

export function releaseCombatAssets(world: World, assets: CombatAssets): void {
  for (const handle of assets.handles) {
    const result = world.sharedRefs.release(handle);
    if (!result.ok) throw new Error(`Brotato v2 combat asset release failed: ${result.error.hint}`);
  }
}
