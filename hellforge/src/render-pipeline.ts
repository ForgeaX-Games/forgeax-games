// SDK 0.1.33 owns the Standard graph and GPU lifetime. No private registries.
import { createFullscreenRenderFeature } from '@forgeax/engine/app';
import { DEFAULT_STANDARD_PROFILE, Fog, PostProcessParams, type Renderer } from '@forgeax/engine/render';
import type { World } from '@forgeax/engine/ecs';
import atmosphereShader from './shaders/atmosphere.wgsl';
import {
  ATMOSPHERE_PARAMS_BYTE_SIZE, ATMOSPHERE_PREVIEW_DIM, ATMOSPHERE_SHADER_ID,
  packAtmosphereParams, type AtmosphereKnobs,
} from './atmosphere-params';

export const hellforgeAtmosphereFeature = createFullscreenRenderFeature({
  identity: ATMOSPHERE_SHADER_ID,
  source: atmosphereShader.wgsl,
  params: { byteSize: ATMOSPHERE_PARAMS_BYTE_SIZE, defaultValue: new Uint8Array(16) },
});

export type HellforgeAtmosphereApi = {
  ok: true;
  setParams(knobs: AtmosphereKnobs): void;
  setPreviewDim(on: boolean, restore?: AtmosphereKnobs): void;
  dispose(): void;
};

export function installHellforgePipeline(
  app: { renderer: Renderer }, world: World, initial: AtmosphereKnobs,
): HellforgeAtmosphereApi {
  app.renderer.setProfile({ ...DEFAULT_STANDARD_PROFILE, lightCount: 32, ssao: true });
  const params = world.spawn({
    component: PostProcessParams,
    data: { shader: ATMOSPHERE_SHADER_ID, data: packAtmosphereParams(initial) },
  }).unwrap();
  const fog = world.spawn({ component: Fog, data: {
    color: [0.075, 0.032, 0.018], density: 0, heightFalloff: 0.12, maxOpacity: 0.38,
  } }).unwrap();
  let previewDim = false;
  let current = initial;
  const apply = (knobs: AtmosphereKnobs) => {
    world.set(params, PostProcessParams, { data: packAtmosphereParams(knobs) });
    const temperature = Math.max(-1, Math.min(1, knobs.atmoTemp));
    world.set(fog, Fog, {
      color: [0.055 + 0.025 * temperature, 0.032, 0.03 - 0.014 * temperature],
      density: Math.max(0, Math.min(1, knobs.haze)) * 0.025,
    });
  };
  apply(initial);
  return {
    ok: true,
    setParams(knobs) { current = knobs; if (!previewDim) apply(knobs); },
    setPreviewDim(on, restore) {
      previewDim = on;
      if (restore) current = restore;
      apply(on ? { ...current, ...ATMOSPHERE_PREVIEW_DIM } : current);
    },
    dispose() { world.despawn(params); world.despawn(fog); },
  };
}
