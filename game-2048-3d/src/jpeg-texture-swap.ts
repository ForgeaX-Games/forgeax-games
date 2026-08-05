import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { MeshRenderer } from '@forgeax/engine-render';
import type { Handle, MaterialAsset, TextureAsset } from '@forgeax/engine-runtime';

/** Sub-asset emitted by the licensed wood-container JPEG sidecar. */
export const GAME_DEFAULT_JPEG_TEXTURE_GUID = '019e2cc6-0c86-79da-aa76-b0984c86d45c';

export type JpegTextureSnapshot = {
  readonly available: boolean;
  readonly active: 'original' | 'jpeg';
  readonly swaps: number;
  readonly guid: string | null;
  readonly name: string | null;
  readonly kind: 'texture' | null;
  readonly width: number;
  readonly height: number;
  readonly format: string | null;
  readonly colorSpace: string | null;
};

export type JpegTextureSwap = {
  readonly entity: EntityHandle;
  readonly originalMaterials: readonly Handle<'MaterialAsset', 'shared'>[];
  readonly jpegMaterials: readonly Handle<'MaterialAsset', 'shared'>[];
  readonly texture: Handle<'TextureAsset', 'shared'>;
  readonly texturePayload: TextureAsset;
  readonly guid: string;
  readonly name: string;
  active: 'original' | 'jpeg';
  swaps: number;
};

function snapshotFrom(state: JpegTextureSwap | undefined): JpegTextureSnapshot {
  if (state === undefined) {
    return {
      available: false,
      active: 'original',
      swaps: 0,
      guid: null,
      name: null,
      kind: null,
      width: 0,
      height: 0,
      format: null,
      colorSpace: null,
    };
  }
  return {
    available: true,
    active: state.active,
    swaps: state.swaps,
    guid: state.guid,
    name: state.name,
    kind: state.texturePayload.kind,
    width: state.texturePayload.width,
    height: state.texturePayload.height,
    format: state.texturePayload.format,
    colorSpace: state.texturePayload.colorSpace,
  };
}

function cloneWithTexture(world: World, source: Handle<'MaterialAsset', 'shared'>, texture: Handle<'TextureAsset', 'shared'>): Handle<'MaterialAsset', 'shared'> | undefined {
  const resolved = world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(source);
  if (!resolved.ok) return undefined;
  return world.allocSharedRef('MaterialAsset', {
    ...resolved.value,
    values: {
      ...resolved.value.values,
      baseColorTexture: texture,
    },
  });
}

/** Load one authored JPEG and clone the existing target materials around it. */
export async function createJpegTextureSwap(
  world: World,
  assets: AssetRegistry | undefined,
  entity: EntityHandle | undefined,
): Promise<JpegTextureSwap | undefined> {
  if (assets === undefined || entity === undefined) return undefined;
  const renderer = world.get(entity, MeshRenderer);
  if (!renderer.ok || renderer.value.materials.length === 0) return undefined;
  const guid = AssetGuid.parse(GAME_DEFAULT_JPEG_TEXTURE_GUID);
  if (!guid.ok) {
    console.warn(`[game] JPEG texture GUID invalid: ${guid.error.code}`);
    return undefined;
  }
  const loaded = await assets.loadByGuid<TextureAsset>(guid.value);
  if (!loaded.ok) {
    console.warn(`[game] JPEG texture unavailable: ${loaded.error.code} — ${loaded.error.hint}`);
    return undefined;
  }
  const texture = world.allocSharedRef('TextureAsset', loaded.value);
  const jpegMaterials: Handle<'MaterialAsset', 'shared'>[] = [];
  for (const material of renderer.value.materials) {
    const clone = cloneWithTexture(world, material, texture);
    if (clone === undefined) {
      console.warn('[game] JPEG texture material clone failed; retaining authored materials');
      return undefined;
    }
    jpegMaterials.push(clone);
  }
  return {
    entity,
    originalMaterials: [...renderer.value.materials],
    jpegMaterials,
    texture,
    texturePayload: loaded.value,
    guid: GAME_DEFAULT_JPEG_TEXTURE_GUID,
    name: assets.resolveName(GAME_DEFAULT_JPEG_TEXTURE_GUID),
    active: 'original',
    swaps: 0,
  };
}

export function toggleJpegTextureSwap(world: World, state: JpegTextureSwap): void {
  state.active = state.active === 'original' ? 'jpeg' : 'original';
  state.swaps += 1;
  world.set(state.entity, MeshRenderer, {
    materials: [...(state.active === 'jpeg' ? state.jpegMaterials : state.originalMaterials)],
  });
}

export function resetJpegTextureSwap(world: World, state: JpegTextureSwap | undefined): void {
  if (state === undefined || state.active === 'original') return;
  state.active = 'original';
  world.set(state.entity, MeshRenderer, { materials: [...state.originalMaterials] });
}

export function jpegTextureSnapshot(state: JpegTextureSwap | undefined): JpegTextureSnapshot {
  return snapshotFrom(state);
}
