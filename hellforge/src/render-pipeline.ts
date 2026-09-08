// hellforge::pipeline — URP forward clone with a pre-tonemap atmosphere pass.
//
// Graph order:
//   skybox → main → hellforge-fx → bloom* → atmosphere → tonemap → fxaa
//
// Uses the public typed render-graph helpers (addTypedSkyboxPass / Scene /
// Bloom / Tonemap / Fullscreen). The untyped addSkyboxPass barrel was removed
// from @forgeax/engine-render; website bake failed with MISSING_EXPORT.
//
// Atmosphere sits AFTER bloom / BEFORE addTypedTonemapPass and writes
// `hdrGraded` (rgba16float). Engine tonemap + FXAA stay (unlike cow-survivor).

import type { GraphTextureDescriptor, RenderGraphBuilder } from '@forgeax/engine-render-graph';
import {
  PostProcessParams,
  addTypedBloomPasses,
  addTypedFullscreenPass,
  addTypedScenePass,
  addTypedSkyboxPass,
  addTypedTonemapPass,
  createRenderPipelineTarget,
  importRenderPipelineSurface,
  type RenderPipeline,
  type RenderPipelineFrame,
} from '@forgeax/engine-render';
import { ok, type RenderPipelineAsset } from '@forgeax/engine-types';
import type { EntityHandle, World } from '@forgeax/engine-ecs';

import atmosphereShader from './shaders/atmosphere.wgsl';
import {
  ATMOSPHERE_PARAMS_BYTE_SIZE,
  ATMOSPHERE_PREVIEW_DIM,
  ATMOSPHERE_SHADER_ID,
  PIPELINE_ID,
  packAtmosphereParams,
  type AtmosphereKnobs,
} from './atmosphere-params';
import {
  ATMOSPHERE_PASS_NAME,
  FXAA_PASS_NAME,
  HDR_GRADED,
} from './pipeline-topology';

function target(
  graph: RenderGraphBuilder<RenderPipelineFrame>,
  label: string,
  descriptor: GraphTextureDescriptor,
) {
  return createRenderPipelineTarget(graph, label, descriptor);
}

const hellforgePipeline: RenderPipeline = {
  build(context, topology) {
    const graph = context.graph;
    const surface = importRenderPipelineSurface(graph, topology);
    if (!surface.ok) return surface;

    const msaa = topology.camera.antialias === 'msaa' && topology.lane.multisample;
    const hdr = topology.camera.tonemap !== 'none';
    const fxaa = topology.camera.antialias === 'fxaa';
    const sceneFormat = hdr ? 'rgba16float' : topology.surface.storageFormat;

    const depth = target(graph, 'scene-depth', {
      format: 'depth24plus-stencil8',
      size: 'surface',
      sampleCount: msaa ? 4 : 1,
    });
    if (!depth.ok) return depth;

    const sceneResolved =
      hdr || fxaa || msaa
        ? target(graph, 'scene-color', {
            format: sceneFormat,
            size: 'surface',
            sampleCount: 1,
          })
        : ok(surface.value.display);
    if (!sceneResolved.ok) return sceneResolved;

    const scene = msaa
      ? target(graph, 'scene-color-msaa', {
          format: sceneFormat,
          size: 'surface',
          sampleCount: 4,
        })
      : sceneResolved;
    if (!scene.ok) return scene;

    const skybox = addTypedSkyboxPass(graph, scene.value);
    if (!skybox.ok) return skybox;

    const gpuDriven = context.projectGpuDriven({
      format: scene.value.format,
      sampleCount: scene.value.sampleCount,
    });
    if (!gpuDriven.ok) return gpuDriven;

    const main = addTypedScenePass(graph, {
      name: 'main',
      color: scene.value,
      depth: depth.value,
      ...(msaa ? { resolve: sceneResolved.value } : {}),
      selector: { LightMode: ['Forward'] },
      colorLoadOp: 'load',
      ...(gpuDriven.value === undefined ? {} : { gpuDriven: gpuDriven.value }),
    });
    if (!main.ok) return main;

    // GPU-driven coverage can claim unsupported transparent custom materials,
    // which makes the forward recorder skip them. A selected non-forward scene
    // pass keeps Hellforge FX on the CPU geometry path.
    const effects = addTypedScenePass(graph, {
      name: 'hellforge-fx',
      color: scene.value,
      depth: depth.value,
      ...(msaa ? { resolve: sceneResolved.value } : {}),
      selector: { LightMode: ['HellforgeFx'] },
      colorLoadOp: 'load',
      depthLoadOp: 'load',
      passKind: 'post-process',
    });
    if (!effects.ok) return effects;

    const features = context.contributeFeatures([
      {
        kind: 'scene-color',
        texture: scene.value.texture,
        view: scene.value.view,
        ...(msaa ? { resolveTarget: sceneResolved.value.view } : {}),
        format: scene.value.format,
        sampleCount: scene.value.sampleCount,
      },
      {
        kind: 'scene-depth',
        texture: depth.value.texture,
        view: depth.value.view,
        format: depth.value.format,
        sampleCount: depth.value.sampleCount,
      },
    ]);
    if (!features.ok) return features;

    if (!hdr) {
      if (fxaa) {
        return addTypedFullscreenPass(graph, {
          name: FXAA_PASS_NAME,
          shader: 'fxaa',
          input: sceneResolved.value,
          output: surface.value.storage,
        });
      }
      return ok(undefined);
    }

    const composited = target(graph, 'bloom-composited', {
      format: 'rgba16float',
      size: 'surface',
    });
    if (!composited.ok) return composited;
    const bright = target(graph, 'bloom-bright', {
      format: 'rgba16float',
      size: 'half-surface',
    });
    if (!bright.ok) return bright;
    const blurH = target(graph, 'bloom-blur-h', {
      format: 'rgba16float',
      size: 'half-surface',
    });
    if (!blurH.ok) return blurH;
    const blurV = target(graph, 'bloom-blur-v', {
      format: 'rgba16float',
      size: 'half-surface',
    });
    if (!blurV.ok) return blurV;
    const bloom = addTypedBloomPasses(graph, {
      scene: sceneResolved.value,
      composited: composited.value,
      bright: bright.value,
      blurH: blurH.value,
      blurV: blurV.value,
    });
    if (!bloom.ok) return bloom;

    const bloomSrc = topology.camera.bloom === 'on' ? composited.value : sceneResolved.value;
    const graded = target(graph, HDR_GRADED, {
      format: 'rgba16float',
      size: 'surface',
    });
    if (!graded.ok) return graded;
    const atmosphere = addTypedFullscreenPass(graph, {
      name: ATMOSPHERE_PASS_NAME,
      shader: ATMOSPHERE_SHADER_ID,
      input: bloomSrc,
      output: graded.value,
    });
    if (!atmosphere.ok) return atmosphere;

    if (fxaa) {
      const ldr = target(graph, 'ldr-color', {
        format: topology.surface.storageFormat,
        size: 'surface',
        ...(topology.surface.storageFormat === topology.surface.viewFormat
          ? {}
          : { viewFormats: [topology.surface.viewFormat] }),
      });
      if (!ldr.ok) return ldr;
      const tonemap = addTypedTonemapPass(graph, graded.value, ldr.value);
      if (!tonemap.ok) return tonemap;
      return addTypedFullscreenPass(graph, {
        name: FXAA_PASS_NAME,
        shader: 'fxaa',
        input: ldr.value,
        output: surface.value.storage,
      });
    }

    return addTypedTonemapPass(graph, graded.value, surface.value.display);
  },
};

export type HellforgeAtmosphereApi = {
  ok: true;
  setParams: (knobs: AtmosphereKnobs) => void;
  setPreviewDim: (on: boolean, restore?: AtmosphereKnobs) => void;
  dispose: () => void;
};

type InstallRenderer = {
  postProcess: {
    register: (
      id: string,
      entry: {
        source: string;
        reads?: readonly string[];
        params?: { byteSize: number; defaultValue: Uint8Array };
      },
    ) => void;
  };
  registerPipeline: (id: string, pipeline: RenderPipeline) => void;
  installPipeline: (
    asset: RenderPipelineAsset & { kind: 'render-pipeline' },
  ) => { ok: boolean; error?: { code: string; hint?: string } };
};

/** True when engine registries reject a second register of the same id. */
function isAlreadyRegisteredError(e: unknown): boolean {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  const msg = e instanceof Error ? e.message : String(e);
  return (
    code === 'post-process-already-registered' ||
    code === 'pipeline-already-registered' ||
    msg.includes('post-process-already-registered') ||
    msg.includes('pipeline-already-registered')
  );
}

/**
 * Register atmosphere shader + hellforge URP clone, install as active pipeline,
 * spawn PostProcessParams for F10 knobs. Call after createApp / bootstrap has
 * `app` + `world`.
 *
 * Idempotent across Studio Stop→Play: the shared renderer keeps shader/pipeline
 * IDs after Stop (no public unregister). Re-enter skips duplicate register but
 * always `installPipeline` + spawns a fresh world-local params entity.
 */
export function installHellforgePipeline(
  app: { renderer: InstallRenderer },
  world: World,
  initial: AtmosphereKnobs,
): HellforgeAtmosphereApi | { ok: false; error: string } {
  const renderer = app.renderer;
  const defaults = packAtmosphereParams(initial);

  try {
    renderer.postProcess.register(ATMOSPHERE_SHADER_ID, {
      source: atmosphereShader.wgsl,
      reads: ['hdrComposited'],
      params: { byteSize: ATMOSPHERE_PARAMS_BYTE_SIZE, defaultValue: defaults },
    });
  } catch (e) {
    if (!isAlreadyRegisteredError(e)) {
      return { ok: false, error: `register threw: ${(e as Error).message}` };
    }
  }

  try {
    renderer.registerPipeline(PIPELINE_ID, hellforgePipeline);
  } catch (e) {
    if (!isAlreadyRegisteredError(e)) {
      return { ok: false, error: `registerPipeline threw: ${(e as Error).message}` };
    }
  }

  const installRes = renderer.installPipeline({
    kind: 'render-pipeline',
    pipelineId: PIPELINE_ID,
  } as RenderPipelineAsset & { kind: 'render-pipeline' });
  if (!installRes.ok) {
    return { ok: false, error: `install failed: ${installRes.error?.code ?? 'unknown'}` };
  }

  const paramsEntity = world.spawn({
    component: PostProcessParams,
    data: { shader: ATMOSPHERE_SHADER_ID, data: defaults },
  }).unwrap() as EntityHandle;

  let previewDim = false;

  const setParams = (knobs: AtmosphereKnobs): void => {
    if (previewDim) return;
    world.set(paramsEntity, PostProcessParams, {
      data: packAtmosphereParams(knobs),
    });
  };

  const setPreviewDim = (on: boolean, restore?: AtmosphereKnobs): void => {
    previewDim = on;
    if (on) {
      world.set(paramsEntity, PostProcessParams, {
        data: packAtmosphereParams({
          vignette: ATMOSPHERE_PREVIEW_DIM.vignette,
          haze: ATMOSPHERE_PREVIEW_DIM.haze,
          atmoTemp: restore?.atmoTemp ?? initial.atmoTemp,
        }),
      });
    } else if (restore) {
      world.set(paramsEntity, PostProcessParams, {
        data: packAtmosphereParams(restore),
      });
    }
  };

  return {
    ok: true,
    setParams,
    setPreviewDim,
    dispose: () => {
      try {
        world.despawn(paramsEntity);
      } catch {
        /* world may already be torn down */
      }
    },
  };
}
