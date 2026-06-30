// cow-survivor::pipeline — clones the engine's URP forward chain (shadow /
// skybox / main / 4 bloom / tonemap / fxaa) and tacks one extra fullscreen
// pass `cinema-post` onto the end. The cinema pass wraps three subtle
// effects (vignette + chromatic aberration + micro radial blur) in a single
// fragment, run on the post-FXAA swap-chain.
//
// Why a custom pipeline (and not "just enable a flag"): the engine's
// addFullscreenPass dispatcher accepts any registered shader id, but the
// built-in URP pipeline has a fixed pass list — the only way for a game to
// inject its own post pass is to register its OWN pipeline and call
// renderer.installPipeline(handle) at boot. The graph below is byte-for-byte
// the same as `forgeax::urp` (urp-pipeline.ts) up to the FXAA pass; the only
// addition is the trailing fullscreen pass.

import { RenderGraph } from '@forgeax/engine-render-graph';
import {
  addFullscreenPass,
  addScenePass,
  addShadowPass,
  addSkyboxPass,
  type RenderPipeline,
  type RenderPipelineContext,
  type RenderPipelineData,
} from '@forgeax/engine-runtime';
import type { MaterialAsset, RenderPipelineAsset } from '@forgeax/engine-types';
import type { GameEntry } from '@forgeax/engine-app';

import cinemaPostShader from './shaders/cinema-post.wgsl';

const PIPELINE_ID = 'cow-survivor::pipeline';
const CINEMA_POST_SHADER_ID = 'cow-survivor::cinema-post';

const cowSurvivorPipeline: RenderPipeline = {
  buildGraph(
    ctx: RenderPipelineContext,
    data: RenderPipelineData,
  ): RenderGraph<RenderPipelineContext> | null {
    const runtime = ctx.runtime;
    const graph = new RenderGraph<RenderPipelineContext>();

    // ── targets (mirrors urp-pipeline.ts) ────────────────────────────────
    graph.addColorTarget('depth', { format: 'depth24plus-stencil8', size: 'swapchain', sample: 1, usage: 0x10 });
    // Shadow map size picked up from DirectionalLight.mapSize on the
    // level's Sun entity (engine projects it onto data.shadowMapSize before
    // calling buildGraph — same path urp-pipeline.ts uses at line 97-98).
    // Falls back to 1024 when no caster is wired. Previously this was
    // hardcoded to 2048 which silently overrode mapSize=4096 in level packs;
    // thin steles / branches blurred into round blobs at the lower texel
    // density.
    const shadowMapSize =
      (data as { shadowMapSize?: number }).shadowMapSize !== undefined &&
      (data as { shadowMapSize?: number }).shadowMapSize! > 0
        ? (data as { shadowMapSize: number }).shadowMapSize
        : 1024;
    // feat-20260613-csm: the engine's view UBO now carries per-cascade
    // lightViewProj matrices (240 -> 592 B); the PBR pass binds the FULL CSM
    // view UBO. A custom pipeline MUST mirror urp-pipeline.ts's cascaded shadow
    // setup (N viewport-tiled shadow passes, each with cascadeIndex) — without
    // this the scene pass binds a 240-B buffer that the shader expects to be
    // >=512 B ("pbr-view-ubo too small"). The atlas is tilesPerSide^2 tiles.
    const cascadeCount =
      (data as { cascadeCount?: number }).cascadeCount !== undefined &&
      (data as { cascadeCount: number }).cascadeCount >= 1 &&
      (data as { cascadeCount: number }).cascadeCount <= 4
        ? (data as { cascadeCount: number }).cascadeCount
        : 1;
    const tilesPerSide = Math.ceil(Math.sqrt(cascadeCount));
    const atlasSize = tilesPerSide * shadowMapSize;
    graph.addColorTarget('shadowDepth', {
      format: 'depth32float',
      size: { w: atlasSize, h: atlasSize },
      sample: 1,
      usage: 0x10 | 0x04 | 0x01,
    });
    graph.addColorTarget('hdrColor', {
      format: 'rgba16float', size: 'swapchain', sample: 1, usage: 0x10 | 0x04,
    });
    graph.addColorTarget('hdrColorMsaa', { format: 'rgba16float', size: 'swapchain', sample: 4, usage: 0x10 });
    graph.addColorTarget('hdrDepth',     { format: 'depth24plus-stencil8', size: 'swapchain', sample: 1, usage: 0x10 });
    graph.addColorTarget('hdrDepthMsaa', { format: 'depth24plus-stencil8', size: 'swapchain', sample: 4, usage: 0x10 });
    const supportsViewFormats = runtime.device.caps.storageBuffer;
    graph.addColorTarget('msaaColor', {
      format: 'rgba8unorm', size: 'swapchain', sample: 4, usage: 0x10,
      ...(supportsViewFormats ? { viewFormats: ['rgba8unorm-srgb'] } : {}),
    });
    graph.addColorTarget('msaaDepth', { format: 'depth24plus-stencil8', size: 'swapchain', sample: 4, usage: 0x10 });

    // ── pass chain ───────────────────────────────────────────────────────
    // shadow / skybox / main / cinema-post. NO BLOOM.
    //
    // Bloom was removed deliberately: it samples every bright HDR pixel in the
    // frame, blurs it, and ADDS it back to the composite. With the red fire
    // bullets + cyan ice bullets + purple environment + pink combo billboards
    // all bright at once, the blur MIXED their colours — the red fireball
    // picked up blue from nearby effects and read as PINK/MAGENTA, and as the
    // kill count climbed more bright pixels fed the bloom so the whole screen
    // got progressively brighter and washed toward white. The user explicitly
    // did not want that "gradually brightening / colour-shifting" look, so the
    // bloom pass chain (and its 3 half-res targets) are gone. `hdrComposited`
    // still aliases `hdrColor` (the raw scene), so cinema-post reads the scene
    // directly. Geometric AA still comes from MSAA on the scene pass.
    // Cascaded directional shadows: N viewport-tiled passes into the atlas,
    // each tagged with its cascadeIndex (selects view.lightViewProj_X in
    // shadow_caster.wgsl). Mirrors urp-pipeline.ts exactly — required so the
    // engine populates the full CSM view UBO the PBR scene pass binds.
    const shadowSelector = { LightMode: ['ShadowCaster'] };
    for (let i = 0; i < cascadeCount; i++) {
      const col = i % tilesPerSide;
      const row = Math.floor(i / tilesPerSide);
      addShadowPass(graph, `shadowCascade${i}`, {
        depth: 'shadowDepth',
        selector: shadowSelector,
        viewport: { x: col * shadowMapSize, y: row * shadowMapSize, w: shadowMapSize, h: shadowMapSize },
        cascadeIndex: i,
      });
    }
    addSkyboxPass(graph, 'skybox', { color: 'hdrColor' });
    addScenePass(graph, 'main', {
      color: 'hdrColor', depth: 'depth',
      reads: ['shadowDepth', 'hdrColor'],
      selector: { LightMode: ['Forward'] },
    });
    addFullscreenPass(graph, 'cinema-post', {
      shader: CINEMA_POST_SHADER_ID,
      color: 'swapchain',
      reads: ['hdrColor'],
    });

    const compileResult = graph.compile({
      backendKind: runtime.device.caps.backendKind,
      caps: runtime.device.caps,
      device: runtime.device,
    });
    if (!compileResult.ok) {
      console.error('[cow-survivor pipeline] graph.compile failed:',
        compileResult.error.code, compileResult.error.expected);
      return null;
    }
    return graph;
  },
  execute(ctx: RenderPipelineContext): void {
    ctx.frameState.perFrameGraph?.execute(ctx);
  },
};

/** Register the cinema-post shader + the cow-survivor pipeline, then install
 *  it as the active per-frame pipeline. Call ONCE at game boot, after
 *  createApp resolves. The renderer accepts the FXAA antialias mode set on
 *  the Camera component the same way the URP does. */
export function installCowSurvivorPipeline(
  ctx: Parameters<GameEntry>[0],
): { ok: true } | { ok: false; error: string } {
  const renderer = (ctx.app as unknown as {
    renderer: {
      shader: never;
      postProcess: { register: (id: string, entry: { source: string; reads?: readonly string[] }) => void };
      registerPipeline: (id: string, pipeline: RenderPipeline) => void;
      // engine e53f4616 (D-19): installPipeline takes the RenderPipelineAsset
      // PAYLOAD directly — no AssetRegistry.register round-trip, no handle.
      installPipeline: (asset: RenderPipelineAsset & { kind: 'render-pipeline' }) => { ok: boolean; error?: { code: string; hint?: string } };
    };
  }).renderer;
  try {
    renderer.postProcess.register(CINEMA_POST_SHADER_ID, {
      source: cinemaPostShader.wgsl,
      // Cinema-post samples the raw HDR scene frame (`hdrColor`) and writes LDR
      // to the swap-chain. Tonemap + FXAA are folded into the shader itself.
      // (Was 'hdrComposited' = the bloom output; bloom has been removed, so we
      // read the scene target directly.)
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
