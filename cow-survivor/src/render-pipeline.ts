// cow-survivor::pipeline — clones the engine URP forward chain far enough to
// draw the scene, then tacks one fullscreen pass `cinema-post` onto the end.
// The cinema pass wraps vignette + chromatic aberration + micro radial blur
// in a single fragment, run on the post-scene swap-chain.
//
// Uses the public typed render-graph helpers. The untyped addSkyboxPass barrel
// was removed from @forgeax/engine-render; website bake failed with MISSING_EXPORT.

import {
  addTypedFullscreenPass,
  addTypedScenePass,
  addTypedSkyboxPass,
  createRenderPipelineTarget,
  importRenderPipelineSurface,
  type RenderPipeline,
} from '@forgeax/engine-render';
import type { MaterialAsset, RenderPipelineAsset } from '@forgeax/engine-types';
import type { GameEntry } from '@forgeax/engine-app';

import cinemaPostShader from './shaders/cinema-post.wgsl';

const PIPELINE_ID = 'cow-survivor::pipeline';
const CINEMA_POST_SHADER_ID = 'cow-survivor::cinema-post';

const cowSurvivorPipeline: RenderPipeline = {
  build(context, topology) {
    const graph = context.graph;
    const surface = importRenderPipelineSurface(graph, topology);
    if (!surface.ok) return surface;

    const depth = createRenderPipelineTarget(graph, 'scene-depth', {
      format: 'depth24plus-stencil8',
      size: 'surface',
    });
    if (!depth.ok) return depth;

    const scene = createRenderPipelineTarget(graph, 'scene-color', {
      format: 'rgba16float',
      size: 'surface',
    });
    if (!scene.ok) return scene;

    const skybox = addTypedSkyboxPass(graph, scene.value);
    if (!skybox.ok) return skybox;

    const main = addTypedScenePass(graph, {
      name: 'main',
      color: scene.value,
      depth: depth.value,
      selector: { LightMode: ['Forward'] },
      colorLoadOp: 'load',
    });
    if (!main.ok) return main;

    const features = context.contributeFeatures([
      {
        kind: 'scene-color',
        texture: scene.value.texture,
        view: scene.value.view,
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

    return addTypedFullscreenPass(graph, {
      name: 'cinema-post',
      shader: CINEMA_POST_SHADER_ID,
      input: scene.value,
      output: surface.value.display,
    });
  },
};

/** Register the cinema-post shader + the cow-survivor pipeline, then install
 *  it as the active per-frame pipeline. Call ONCE at game boot, after
 *  createApp resolves. */
export function installCowSurvivorPipeline(
  ctx: Parameters<GameEntry>[0],
): { ok: true } | { ok: false; error: string } {
  const renderer = (ctx.app as unknown as {
    renderer: {
      shader: never;
      postProcess: { register: (id: string, entry: { source: string; reads?: readonly string[] }) => void };
      registerPipeline: (id: string, pipeline: RenderPipeline) => void;
      installPipeline: (asset: RenderPipelineAsset & { kind: 'render-pipeline' }) => { ok: boolean; error?: { code: string; hint?: string } };
    };
  }).renderer;
  try {
    renderer.postProcess.register(CINEMA_POST_SHADER_ID, {
      source: cinemaPostShader.wgsl,
      reads: ['hdrColor'],
    });
    renderer.registerPipeline(PIPELINE_ID, cowSurvivorPipeline);
  } catch (e) {
    return { ok: false, error: `register threw: ${(e as Error).message}` };
  }
  const installRes = renderer.installPipeline({
    kind: 'render-pipeline', pipelineId: PIPELINE_ID,
  } as RenderPipelineAsset & { kind: 'render-pipeline' });
  if (!installRes.ok) return { ok: false, error: `install failed: ${installRes.error?.code ?? 'unknown'}` };
  return { ok: true };
}

// MaterialAsset re-exported only to silence an unused-import lint when this
// module grows additional materials in T3. Remove if the file stays material-
// less.
export type { MaterialAsset };
