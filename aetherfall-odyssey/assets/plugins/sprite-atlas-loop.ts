import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { SpriteAnimation } from '@forgeax/engine-render/authoring';
import { spriteAnimationTickSystem } from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { Handle, MaterialAsset, TextureAsset } from '@forgeax/engine-runtime';

/** GUID emitted by the hello/sprite-atlas PNG sidecar. */
export const GAME_DEFAULT_SPRITE_ATLAS_GUID = '0e8657b1-c0ab-4940-a4f6-27fcd976823c';

/** The companion walk.atlas.json text channel, projected into the ECS POD. */
export const GAME_DEFAULT_SPRITE_ATLAS_REGIONS = new Float32Array([
  0, 0, 0.5, 0.5,
  0.5, 0, 0.5, 0.5,
  0, 0.5, 0.5, 0.5,
  0.5, 0.5, 0.5, 0.5,
]);

const FRAME_COUNT = 4;
const FRAME_DURATION = 0.12;

export type SpriteAtlasSnapshot = {
  readonly available: boolean;
  readonly active: boolean;
  readonly frame: number;
  readonly frameCount: number;
  readonly frameDuration: number;
  readonly trackedEntities: number;
  readonly animatedShots: number;
  readonly animatedHits: number;
  readonly swaps: number;
  readonly guid: string | null;
  readonly name: string | null;
  readonly kind: 'texture' | null;
  readonly width: number;
  readonly height: number;
  readonly format: string | null;
  readonly colorSpace: string | null;
  readonly errorCode: string | null;
};

export type SpriteAtlasLoop = {
  readonly available: true;
  readonly spriteMaterialHandle: Handle<'MaterialAsset', 'shared'>;
  readonly spriteLitMaterialHandle: Handle<'MaterialAsset', 'shared'>;
  readonly frameCount: number;
  readonly frameDuration: number;
  readonly regions: Float32Array;
  readonly snapshot: () => SpriteAtlasSnapshot;
  readonly toggle: () => boolean;
  readonly recordHit: (entity: EntityHandle) => boolean;
  readonly reset: () => void;
  readonly track: (entity: EntityHandle) => void;
  readonly untrack: (entity: EntityHandle) => void;
  readonly active: boolean;
};

function unavailable(errorCode: string | null = null): SpriteAtlasSnapshot {
  return {
    available: false,
    active: false,
    frame: 0,
    frameCount: FRAME_COUNT,
    frameDuration: FRAME_DURATION,
    trackedEntities: 0,
    animatedShots: 0,
    animatedHits: 0,
    swaps: 0,
    guid: null,
    name: null,
    kind: null,
    width: 0,
    height: 0,
    format: null,
    colorSpace: null,
    errorCode,
  };
}

function cloneWithTexture(
  world: World,
  source: Handle<'MaterialAsset', 'shared'>,
  texture: Handle<'TextureAsset', 'shared'>,
): Handle<'MaterialAsset', 'shared'> | undefined {
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

/**
 * Load the licensed atlas through the host Pack/GUID surface and expose the
 * smallest gameplay seam needed to put SpriteAnimation on existing bullets.
 * The image importer remains the producer; this module only projects its
 * TextureAsset into a consumer-owned material and ECS animation loop.
 */
export async function createSpriteAtlasLoop(
  world: World,
  assets: AssetRegistry | undefined,
  spriteMaterial: Handle<'MaterialAsset', 'shared'> | undefined,
  spriteLitMaterial: Handle<'MaterialAsset', 'shared'> | undefined,
): Promise<SpriteAtlasLoop | undefined> {
  if (assets === undefined || spriteMaterial === undefined || spriteLitMaterial === undefined) return undefined;
  const guid = AssetGuid.parse(GAME_DEFAULT_SPRITE_ATLAS_GUID);
  if (!guid.ok) {
    console.warn(`[game] sprite atlas GUID invalid: ${guid.error.code}`);
    return undefined;
  }
  const loaded = await assets.loadByGuid<TextureAsset>(guid.value);
  if (!loaded.ok) {
    console.warn(`[game] sprite atlas unavailable: ${loaded.error.code} — ${loaded.error.hint}`);
    return undefined;
  }
  const texture = world.allocSharedRef('TextureAsset', loaded.value);
  const spriteMaterialHandle = cloneWithTexture(world, spriteMaterial, texture);
  const spriteLitMaterialHandle = cloneWithTexture(world, spriteLitMaterial, texture);
  if (spriteMaterialHandle === undefined || spriteLitMaterialHandle === undefined) {
    console.warn('[game] sprite atlas material clone failed; retaining the original projectile materials');
    return undefined;
  }

  let active = false;
  let swaps = 0;
  let errorCode: string | null = null;
  const tracked = new Set<EntityHandle>();
  const hitEntities = new Set<EntityHandle>();
  let animatedShots = 0;
  let animatedHits = 0;
  world.addSystem(Update, {
    name: 'game-default-sprite-animation',
    queries: [],
    fn: () => {
      const result = spriteAnimationTickSystem(world);
      if (!result.ok) errorCode = result.error.code;
    },
  }).unwrap();

  const snapshot = (): SpriteAtlasSnapshot => {
    let frame = 0;
    for (const entity of tracked) {
      const animation = world.get(entity, SpriteAnimation);
      if (animation.ok) {
        frame = animation.value.currentFrame;
        break;
      }
      tracked.delete(entity);
    }
    return {
      available: true,
      active,
      frame,
      frameCount: FRAME_COUNT,
      frameDuration: FRAME_DURATION,
      trackedEntities: tracked.size,
      animatedShots,
      animatedHits,
      swaps,
      guid: GAME_DEFAULT_SPRITE_ATLAS_GUID,
      name: assets.resolveName(GAME_DEFAULT_SPRITE_ATLAS_GUID),
      kind: loaded.value.kind,
      width: loaded.value.width,
      height: loaded.value.height,
      format: loaded.value.format,
      colorSpace: loaded.value.colorSpace,
      errorCode,
    };
  };

  return {
    available: true,
    spriteMaterialHandle,
    spriteLitMaterialHandle,
    frameCount: FRAME_COUNT,
    frameDuration: FRAME_DURATION,
    regions: new Float32Array(GAME_DEFAULT_SPRITE_ATLAS_REGIONS),
    snapshot,
    toggle: () => {
      active = !active;
      swaps += 1;
      return active;
    },
    recordHit: (entity) => {
      if (!tracked.has(entity) || hitEntities.has(entity)) return false;
      hitEntities.add(entity);
      animatedHits += 1;
      return true;
    },
    reset: () => {
      active = false;
      swaps = 0;
      errorCode = null;
      tracked.clear();
      hitEntities.clear();
      animatedShots = 0;
      animatedHits = 0;
    },
    track: (entity) => {
      if (tracked.has(entity)) return;
      tracked.add(entity);
      animatedShots += 1;
    },
    untrack: (entity) => { tracked.delete(entity); },
    get active() { return active; },
  };
}

export function spriteAtlasSnapshot(state: SpriteAtlasLoop | undefined): SpriteAtlasSnapshot {
  return state?.snapshot() ?? unavailable();
}

/** Keep the initial POD shape discoverable in hosts that cannot load Pack. */
export const EMPTY_SPRITE_ATLAS_SNAPSHOT = unavailable();
