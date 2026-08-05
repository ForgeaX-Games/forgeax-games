import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { HANDLE_QUAD } from '@forgeax/engine-assets-runtime';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { VideoPlayer, VIDEO_ELEMENT_PROVIDER_KEY } from '@forgeax/engine-graphics-extras';
import type { VideoElementProvider } from '@forgeax/engine-graphics-extras';
import type { Handle, MaterialAsset, VideoAsset } from '@forgeax/engine-types';
import { Transform } from '@forgeax/engine-scene';

/** Runtime-only asset descriptor for the licensed WebM in the assets submodule. */
export const GAME_DEFAULT_VIDEO_GUID = '019f5d11-0e1f-7c21-a4d2-7e4f6e8f2001';
export const GAME_DEFAULT_VIDEO_MATERIAL_GUID = '019f5d11-0e1f-7c21-a4d2-7e4f6e8f2002';
export const GAME_DEFAULT_VIDEO_URL = '/cutscene.webm';

const PANEL_SCALE: readonly [number, number, number] = [1.8, 1.05, 1];

export type VideoTexturePanelSnapshot = {
  readonly available: boolean;
  readonly active: 'original' | 'video';
  readonly swaps: number;
  readonly guid: string | null;
  readonly name: string | null;
  readonly kind: 'video' | null;
  readonly url: string | null;
};

export type VideoTexturePanel = {
  readonly entity: EntityHandle;
  readonly target: EntityHandle;
  readonly videoHandle: Handle<'VideoAsset', 'shared'>;
  readonly materialHandle: Handle<'MaterialAsset', 'shared'>;
  active: 'original' | 'video';
  swaps: number;
  toggle: () => void;
  step: (camera: EntityHandle) => void;
  reset: () => void;
  snapshot: () => VideoTexturePanelSnapshot;
  dispose: () => void;
};

type VideoHost = VideoElementProvider & {
  setPlaying: (entity: EntityHandle, playing: boolean) => void;
  dispose: () => void;
};

function createVideoHost(): VideoHost {
  const elements = new Map<EntityHandle, HTMLVideoElement>();
  const playing = new Map<EntityHandle, boolean>();

  const ensureElement = (entity: EntityHandle): HTMLVideoElement => {
    const existing = elements.get(entity);
    if (existing !== undefined) return existing;
    const video = document.createElement('video');
    video.src = GAME_DEFAULT_VIDEO_URL;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.load();
    elements.set(entity, video);
    return video;
  };

  const syncPlayback = (entity: EntityHandle): void => {
    const video = elements.get(entity);
    if (video === undefined) return;
    if (playing.get(entity) === true) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  };

  return {
    getElement: (entity, _clipHandle) => {
      const video = ensureElement(entity);
      syncPlayback(entity);
      return video;
    },
    setPlaying: (entity, value) => {
      playing.set(entity, value);
      syncPlayback(entity);
    },
    dispose: () => {
      for (const video of elements.values()) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      elements.clear();
      playing.clear();
    },
  };
}

function snapshotFrom(state: VideoTexturePanel | undefined, assets: AssetRegistry | undefined): VideoTexturePanelSnapshot {
  if (state === undefined) {
    return { available: false, active: 'original', swaps: 0, guid: null, name: null, kind: null, url: null };
  }
  return {
    available: true,
    active: state.active,
    swaps: state.swaps,
    guid: GAME_DEFAULT_VIDEO_GUID,
    name: assets?.resolveName(GAME_DEFAULT_VIDEO_GUID) ?? null,
    kind: 'video',
    url: GAME_DEFAULT_VIDEO_URL,
  };
}

/**
 * Compose the existing scored target with the public VideoAsset/VideoPlayer
 * path. The panel is one pooled quad that follows the target and faces the
 * current camera; it is hidden until the reversible M/inspection toggle.
 */
export async function createVideoTexturePanel(
  world: World,
  assets: AssetRegistry | undefined,
  target: EntityHandle | undefined,
): Promise<VideoTexturePanel | undefined> {
  if (assets === undefined || target === undefined) return undefined;
  const videoGuid = AssetGuid.parse(GAME_DEFAULT_VIDEO_GUID);
  const materialGuid = AssetGuid.parse(GAME_DEFAULT_VIDEO_MATERIAL_GUID);
  if (!videoGuid.ok || !materialGuid.ok) return undefined;

  assets.catalog<VideoAsset>(videoGuid.value, { kind: 'video', url: GAME_DEFAULT_VIDEO_URL });
  const video = await assets.loadByGuid<VideoAsset>(videoGuid.value);
  if (!video.ok) {
    console.warn(`[game] WebM video unavailable (${video.error.code}): ${video.error.hint}`);
    return undefined;
  }
  // The runtime material resolver intentionally accepts a GUID string in a
  // texture slot (the same wire shape emitted by Pack). MaterialAsset's
  // authoring type also models the post-cook AssetGuid object, so keep this
  // runtime-only catalog entry at the boundary rather than minting a second
  // texture handle or inventing a WebM importer.
  assets.catalog<MaterialAsset>(materialGuid.value, {
    kind: 'material',
    passes: [{
      name: 'Forward',
      program: { module: 'forgeax::default-unlit' },
      renderState: { tags: { LightMode: 'Forward' }, queue: 2000 },
    }],
    values: { baseColor: [1, 1, 1], baseColorTexture: GAME_DEFAULT_VIDEO_GUID },
  } as unknown as MaterialAsset);
  const material = await assets.loadByGuid<MaterialAsset>(materialGuid.value);
  if (!material.ok) {
    console.warn(`[game] WebM material unavailable (${material.error.code}): ${material.error.hint}`);
    return undefined;
  }

  const videoHandle = world.allocSharedRef('VideoAsset', video.value);
  const materialHandle = world.allocSharedRef('MaterialAsset', material.value);
  const panel = world.spawn(
    { component: Transform, data: { pos: [0, -100, 0], quat: [0, 0, 0, 1], scale: [0, 0, 0] } },
    { component: MeshFilter, data: { assetHandle: HANDLE_QUAD } },
    { component: MeshRenderer, data: { materials: [materialHandle] } },
    { component: VideoPlayer, data: { clip: videoHandle, playing: false, loop: true, currentTime: 0 } },
  ).unwrap();
  const host = createVideoHost();
  const previousProvider = world.hasResource(VIDEO_ELEMENT_PROVIDER_KEY)
    ? world.getResource<VideoElementProvider>(VIDEO_ELEMENT_PROVIDER_KEY)
    : undefined;
  world.insertResource(VIDEO_ELEMENT_PROVIDER_KEY, host);

  const state: VideoTexturePanel = {
    entity: panel,
    target,
    videoHandle,
    materialHandle,
    active: 'original',
    swaps: 0,
    toggle: () => {
      state.active = state.active === 'original' ? 'video' : 'original';
      state.swaps += 1;
      world.set(panel, VideoPlayer, { playing: state.active === 'video', currentTime: 0 });
      host.setPlaying(panel, state.active === 'video');
      world.set(panel, Transform, state.active === 'video'
        ? { scale: [...PANEL_SCALE] }
        : { pos: [0, -100, 0], scale: [0, 0, 0] });
    },
    step: (camera) => {
      if (state.active !== 'video') return;
      const targetTransform = world.get(target, Transform);
      const cameraTransform = world.get(camera, Transform);
      if (!targetTransform.ok || !cameraTransform.ok) return;
      world.set(panel, Transform, {
        pos: [
          targetTransform.value.pos[0] ?? 0,
          (targetTransform.value.pos[1] ?? 0) + 1.7,
          targetTransform.value.pos[2] ?? 0,
        ],
        quat: [
          cameraTransform.value.quat[0] ?? 0,
          cameraTransform.value.quat[1] ?? 0,
          cameraTransform.value.quat[2] ?? 0,
          cameraTransform.value.quat[3] ?? 1,
        ],
      });
    },
    reset: () => {
      state.active = 'original';
      world.set(panel, VideoPlayer, { playing: false, currentTime: 0 });
      host.setPlaying(panel, false);
      world.set(panel, Transform, { pos: [0, -100, 0], scale: [0, 0, 0] });
    },
    snapshot: () => snapshotFrom(state, assets),
    dispose: () => {
      world.removeResource(VIDEO_ELEMENT_PROVIDER_KEY);
      if (previousProvider !== undefined) world.insertResource(VIDEO_ELEMENT_PROVIDER_KEY, previousProvider);
      host.dispose();
      world.despawn(panel);
      world.sharedRefs.release(videoHandle);
      world.sharedRefs.release(materialHandle);
    },
  };
  return state;
}
