import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { MeshRenderer } from '@forgeax/engine-render';
import type { Handle, MaterialAsset } from '@forgeax/engine-runtime';
import {
  GAME_DEFAULT_TARGET_PROFILE_GUID,
  type TargetProfile,
} from './target-profile-asset';

export type TargetProfileSnapshot = {
  readonly available: boolean;
  readonly active: 'original' | 'profile';
  readonly title: string | null;
  readonly scoreMultiplier: number;
  readonly swaps: number;
  readonly guid: string | null;
  readonly baseColor: readonly [number, number, number, number] | null;
};

export type TargetProfileLoop = {
  readonly entity: EntityHandle;
  readonly originalMaterials: readonly Handle<'MaterialAsset', 'shared'>[];
  readonly profileMaterials: readonly Handle<'MaterialAsset', 'shared'>[];
  readonly profile: TargetProfile;
  active: 'original' | 'profile';
  swaps: number;
};

function cloneWithProfile(
  world: World,
  source: Handle<'MaterialAsset', 'shared'>,
  color: readonly [number, number, number, number],
): Handle<'MaterialAsset', 'shared'> | undefined {
  const resolved = world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(source);
  if (!resolved.ok) return undefined;
  return world.allocSharedRef('MaterialAsset', {
    ...resolved.value,
    values: { ...resolved.value.values, baseColor: [...color] },
  });
}

export async function createTargetProfileLoop(
  world: World,
  assets: AssetRegistry | undefined,
  entity: EntityHandle | undefined,
): Promise<TargetProfileLoop | undefined> {
  if (assets === undefined || entity === undefined) return undefined;
  const renderer = world.get(entity, MeshRenderer);
  if (!renderer.ok || renderer.value.materials.length === 0) return undefined;
  const guid = AssetGuid.parse(GAME_DEFAULT_TARGET_PROFILE_GUID);
  if (!guid.ok) return undefined;
  const loaded = await assets.loadByGuid<TargetProfile>(guid.value);
  if (!loaded.ok) {
    console.warn(`[game] target profile unavailable: ${loaded.error.code} — ${loaded.error.hint}`);
    return undefined;
  }
  const profileMaterials: Handle<'MaterialAsset', 'shared'>[] = [];
  for (const material of renderer.value.materials) {
    const clone = cloneWithProfile(world, material, loaded.value.baseColor);
    if (clone === undefined) return undefined;
    profileMaterials.push(clone);
  }
  return {
    entity,
    originalMaterials: [...renderer.value.materials],
    profileMaterials,
    profile: loaded.value,
    active: 'original',
    swaps: 0,
  };
}

export function toggleTargetProfile(world: World, state: TargetProfileLoop): void {
  state.active = state.active === 'original' ? 'profile' : 'original';
  state.swaps += 1;
  world.set(state.entity, MeshRenderer, {
    materials: [...(state.active === 'profile' ? state.profileMaterials : state.originalMaterials)],
  });
}

export function resetTargetProfile(world: World, state: TargetProfileLoop | undefined): void {
  if (state === undefined || state.active === 'original') return;
  state.active = 'original';
  world.set(state.entity, MeshRenderer, { materials: [...state.originalMaterials] });
}

export function targetProfileSnapshot(state: TargetProfileLoop | undefined): TargetProfileSnapshot {
  if (state === undefined) {
    return {
      available: false,
      active: 'original',
      title: null,
      scoreMultiplier: 1,
      swaps: 0,
      guid: null,
      baseColor: null,
    };
  }
  return {
    available: true,
    active: state.active,
    title: state.profile.title,
    scoreMultiplier: state.profile.scoreMultiplier,
    swaps: state.swaps,
    guid: GAME_DEFAULT_TARGET_PROFILE_GUID,
    baseColor: state.profile.baseColor,
  };
}

export function targetProfilePoints(state: TargetProfileLoop | undefined, points: number): number {
  return state?.active === 'profile' ? Math.round(points * state.profile.scoreMultiplier) : points;
}
