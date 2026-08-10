import { PostProcessParams, type Renderer } from '@forgeax/engine-render';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import chromaticShader from '../shaders/chromatic-aberration.wgsl';

export const CHROMATIC_ABERRATION_ID = 'game-default::chromatic-aberration';
export const CHROMATIC_ABERRATION_PARAM_BYTES = 16;
const MAX_INTENSITY = 0.08;

export interface ChromaticAberrationSnapshot {
  readonly active: boolean;
  readonly intensity: number;
  readonly effect: string;
}

export interface ChromaticAberrationHandle {
  readonly paramsEntity: EntityHandle;
  readonly installed: boolean;
  readonly error?: string;
  setIntensity(intensity: number): void;
  reset(): void;
  snapshot(): ChromaticAberrationSnapshot;
}

function packParams(intensity: number): Uint8Array {
  const bytes = new ArrayBuffer(CHROMATIC_ABERRATION_PARAM_BYTES);
  new Float32Array(bytes)[0] = Math.max(0, Math.min(MAX_INTENSITY, intensity));
  return new Uint8Array(bytes);
}

export function installChromaticAberration(
  world: World,
  renderer: Renderer | undefined,
  postEffects: readonly string[],
): ChromaticAberrationHandle {
  let intensity = 0;
  const paramsEntity = world.spawn({
    component: PostProcessParams,
    data: { shader: CHROMATIC_ABERRATION_ID, data: packParams(0) },
  }).unwrap();
  if (!renderer) {
    return {
      paramsEntity,
      installed: false,
      error: 'Renderer is unavailable; chromatic aberration remains disabled.',
      setIntensity: () => {},
      reset: () => {},
      snapshot: () => ({ active: false, intensity: 0, effect: CHROMATIC_ABERRATION_ID }),
    };
  }
  renderer.postProcess.register(CHROMATIC_ABERRATION_ID, {
    source: chromaticShader.wgsl,
    reads: ['sceneColor'],
    params: { byteSize: CHROMATIC_ABERRATION_PARAM_BYTES, defaultValue: packParams(0) },
  });
  const installed = renderer.installPipeline({
    kind: 'render-pipeline',
    pipelineId: 'forgeax::urp',
    config: { postEffects },
  });
  const write = (): void => {
    world.set(paramsEntity, PostProcessParams, { data: packParams(intensity) });
  };
  return {
    paramsEntity,
    installed: installed.ok,
    ...(installed.ok ? {} : { error: `${installed.error.code}: ${installed.error.hint}` }),
    setIntensity(next: number): void {
      intensity = Math.max(0, Math.min(MAX_INTENSITY, next));
      write();
    },
    reset(): void {
      intensity = 0;
      write();
    },
    snapshot(): ChromaticAberrationSnapshot {
      return { active: installed.ok && intensity > 0, intensity, effect: CHROMATIC_ABERRATION_ID };
    },
  };
}
