import { PostProcessParams, type Renderer } from '@forgeax/engine-render';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import fogShader from '../shaders/atmospheric-fog.wgsl';
import {
  AETHERFALL_FOG_CONFIG,
  ATMOSPHERIC_FOG_PARAM_BYTES,
  packAtmosphericFogParams,
} from './atmospheric-fog-params';

export const ATMOSPHERIC_FOG_ID = 'aetherfall::atmospheric-depth-fog';

export type AtmosphericFogHandle = {
  readonly paramsEntity: EntityHandle;
  readonly installed: boolean;
  readonly error?: string;
};

/** Install one LDR distance-fog pass. This is air perspective, not volumetric lighting. */
export function installAtmosphericFog(
  world: World,
  renderer: Renderer | undefined,
  postEffects: readonly string[],
): AtmosphericFogHandle {
  const params = packAtmosphericFogParams(AETHERFALL_FOG_CONFIG);
  const paramsEntity = world.spawn({
    component: PostProcessParams,
    data: { shader: ATMOSPHERIC_FOG_ID, data: params },
  }).unwrap();
  if (renderer === undefined) {
    return {
      paramsEntity,
      installed: false,
      error: 'Renderer is unavailable; atmospheric depth fog remains disabled.',
    };
  }
  renderer.postProcess.register(ATMOSPHERIC_FOG_ID, {
    source: fogShader.wgsl,
    reads: [{ key: 'sceneColor' }, { key: 'depth', sampleType: 'depth' }],
    params: { byteSize: ATMOSPHERIC_FOG_PARAM_BYTES, defaultValue: params },
  });
  const installed = renderer.installPipeline({
    kind: 'render-pipeline',
    pipelineId: 'forgeax::urp',
    config: { postEffects },
  });
  return {
    paramsEntity,
    installed: installed.ok,
    ...(installed.ok ? {} : { error: `${installed.error.code}: ${installed.error.hint}` }),
  };
}
