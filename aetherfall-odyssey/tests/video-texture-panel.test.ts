import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { VIDEO_ELEMENT_PROVIDER_KEY, VideoPlayer, type VideoElementProvider } from '@forgeax/engine-graphics-extras';
import { Transform } from '@forgeax/engine-scene';
import { World } from '@forgeax/engine-ecs';
import {
  createVideoTexturePanel,
  VIDEO_HIT_CONTEXT_PLAYHEAD_SECONDS,
} from '../assets/plugins/video-texture-panel';

describe('game-default guided WebM hit context', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replays the pooled VideoPlayer at the authored playhead and clears it on reset', async () => {
    const video = {
      readyState: 1,
      currentTime: 0,
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });

    let loadCount = 0;
    const assets = {
      catalog: vi.fn(),
      resolveName: vi.fn(() => 'cutscene.webm'),
      loadByGuid: vi.fn(async () => {
        loadCount += 1;
        return {
          ok: true as const,
          value: loadCount === 1
            ? { kind: 'video' as const, url: '/cutscene.webm' }
            : { kind: 'material' as const, passes: [], values: {} },
        };
      }),
    } as unknown as AssetRegistry;
    const world = new World();
    const target = world.spawn({ component: Transform, data: {} }).unwrap();
    const panel = await createVideoTexturePanel(world, assets, target);
    expect(panel).toBeDefined();
    if (panel === undefined) return;

    const provider = world.getResource<VideoElementProvider>(VIDEO_ELEMENT_PROVIDER_KEY);
    expect(provider.getElement(panel.entity, panel.videoHandle)).toBe(video);
    panel.toggle();
    expect(panel.snapshot()).toMatchObject({ active: 'video', hitReactions: 0, lastHitPlayhead: null });

    expect(panel.reactToHit()).toBe(true);
    expect(panel.snapshot()).toMatchObject({ hitReactions: 1, lastHitPlayhead: VIDEO_HIT_CONTEXT_PLAYHEAD_SECONDS });
    expect(world.get(panel.entity, VideoPlayer).unwrap().currentTime).toBeCloseTo(VIDEO_HIT_CONTEXT_PLAYHEAD_SECONDS, 5);
    expect(video.currentTime).toBeCloseTo(VIDEO_HIT_CONTEXT_PLAYHEAD_SECONDS, 5);
    expect(video.play).toHaveBeenCalled();

    panel.reset();
    expect(panel.snapshot()).toMatchObject({ active: 'original', hitReactions: 0, lastHitPlayhead: null });
    expect(world.get(panel.entity, VideoPlayer).unwrap().currentTime).toBeCloseTo(0, 5);
    expect(video.currentTime).toBeCloseTo(0, 5);
    panel.dispose();
    expect(world.hasResource(VIDEO_ELEMENT_PROVIDER_KEY)).toBe(false);
    expect(assets.catalog).toHaveBeenCalledWith(expect.anything(), expect.anything());
    expect(assets.catalog).toHaveBeenCalledTimes(2);
  });
});
