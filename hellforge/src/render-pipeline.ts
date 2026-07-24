// hellforge::pipeline — URP forward clone with a pre-tonemap atmosphere pass.
//
// Graph order (named for PR / T1 report):
//   shadowCascade* → skybox → main → bloom-bright → bloom-blur-h →
//   bloom-blur-v → bloom-composite → atmosphere → tonemap → fxaa → debugOverlay
//
// Point + spot shadow casters omitted (addPointShadowPass / addSpotShadowPass
// not barrel-exported). Honest gap: no spot/point atlas targets and main does
// NOT read them — a dangling-read would make graph.compile fail and return null.
//
// Atmosphere sits AFTER bloom / BEFORE addTonemapPass and writes `hdrGraded`
// (rgba16float). Engine tonemap + FXAA are kept (unlike cow-survivor, which
// folds tonemap into cinema-post and drops bloom).
//
// Depth sampling: NO under URP — screen-space radial + vertical gradient only.

import { mat4 } from '@forgeax/engine-math';
import { RenderGraph, type ResolveContext } from '@forgeax/engine-render-graph';
import {
  PostProcessParams,
  addBloomPasses,
  addFullscreenPass,
  addScenePass,
  addShadowPass,
  addSkyboxPass,
  addTonemapPass,
  attachDebugOverlayPass,
  type RenderPipeline,
  type RenderPipelineContext,
  type RenderPipelineData,
} from '@forgeax/engine-runtime';
import type { RenderPipelineAsset } from '@forgeax/engine-types';
import type { EntityHandle, World } from '@forgeax/engine-ecs';

import atmosphereShader from './shaders/atmosphere.wgsl';
import {
  ATMOSPHERE_PARAMS_BYTE_SIZE,
  ATMOSPHERE_PASS_ENABLED,
  ATMOSPHERE_PREVIEW_DIM,
  ATMOSPHERE_SHADER_ID,
  PIPELINE_ID,
  packAtmosphereParams,
  type AtmosphereKnobs,
} from './atmosphere-params';
import {
  ATMOSPHERE_PASS_NAME,
  FXAA_PASS_NAME,
  HDR_COLOR,
  HDR_COMPOSITED,
  HDR_GRADED,
  HELLFORGE_MAIN_PASS_READS,
  TONEMAP_PASS_NAME,
  atmosphereDispatchMode,
  hellforgeTonemapHdrSources,
} from './pipeline-topology';

export {
  ATMOSPHERE_CSS_DISPOSITION,
  ATMOSPHERE_PARAMS_BYTE_SIZE,
  ATMOSPHERE_PASS_ENABLED,
  ATMOSPHERE_PREVIEW_DIM,
  ATMOSPHERE_SHADER_ID,
  PIPELINE_ID,
  packAtmosphereParams,
  type AtmosphereKnobs,
} from './atmosphere-params';

export {
  ATMOSPHERE_PASS_NAME,
  FXAA_PASS_NAME,
  HDR_COLOR,
  HDR_COMPOSITED,
  HDR_GRADED,
  HELLFORGE_GRADE_CHAIN_PASSES,
  HELLFORGE_MAIN_PASS_READS,
  TONEMAP_PASS_NAME,
  atmosphereDispatchMode,
  hellforgeGraphPassContract,
  hellforgePipelineTopology,
  hellforgeTonemapHdrSources,
  validateHellforgeGraphNoDanglingReads,
} from './pipeline-topology';

// ── HDR dispatch (public addFullscreenPass hardcodes LDR swap-chain PSO) ──

type AtmosphereGpuCache = {
  bgl: unknown;
  sampler: unknown;
};

let atmosphereGpuCache: AtmosphereGpuCache | null = null;

/**
 * When atmosphere PSO is still warming (getPostProcessPipeline → null), blit the
 * HDR source into `hdrGraded` so tonemap always samples a written target.
 * Uses graph `${key}::tex` handles (same idiom as FXAA / composite-over-swapchain).
 */
function copyHdrThrough(
  ctx: RenderPipelineContext,
  passName: string,
  readsKey: string,
  colorKey: string,
  resolveCtx?: ResolveContext,
): void {
  const srcTex = resolveCtx?.resolve(`${readsKey}::tex`);
  const dstTex = resolveCtx?.resolve(`${colorKey}::tex`);
  if (srcTex === undefined || dstTex === undefined) {
    console.error(`[hellforge pipeline] ${passName}: copy-through missing tex`, {
      readsKey,
      colorKey,
    });
    return;
  }
  ctx.encoder.copyTextureToTexture(
    { texture: srcTex as never, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
    { texture: dstTex as never, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
    { width: ctx.targetW, height: ctx.targetH, depthOrArrayLayers: 1 },
  );
}

function dispatchAtmosphereHdr(
  ctx: RenderPipelineContext,
  passName: string,
  shader: string,
  colorKey: string,
  readsKey: string,
  resolveCtx?: ResolveContext,
): void {
  const lookup = ctx.runtime.lookupPostProcess;
  const entry = lookup?.(shader);
  if (entry === undefined) {
    console.error(`[hellforge pipeline] ${passName}: post-process not registered:`, shader);
    return;
  }

  const inputView = resolveCtx?.resolve(readsKey);
  const writeView = resolveCtx?.resolve(colorKey);
  if (inputView === undefined || writeView === undefined) {
    console.error(`[hellforge pipeline] ${passName}: missing RT`, { readsKey, colorKey });
    return;
  }

  const device = ctx.runtime.device;
  if (atmosphereGpuCache === null) {
    const bglRes = device.createBindGroupLayout({
      label: 'hellforge-atmosphere-bgl',
      entries: [
        { binding: 0, visibility: 0x2, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
        { binding: 1, visibility: 0x2, sampler: { type: 'filtering' } },
        { binding: 2, visibility: 0x2, buffer: { type: 'uniform' } },
      ],
    } as never);
    if (!bglRes.ok) return;
    const samplerRes = device.createSampler({
      label: 'hellforge-atmosphere-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    } as never);
    if (!samplerRes.ok) return;
    atmosphereGpuCache = { bgl: bglRes.value, sampler: samplerRes.value };
  }

  const getPipeline = ctx.runtime.getPostProcessPipeline;
  // PSO must match hdrGraded (rgba16float) — not the swap-chain srgb format
  // that addFullscreenPass would pick. Null while shader compile is pending:
  // copy-through so tonemap does not sample an unwritten hdrGraded.
  const pipeline =
    getPipeline === undefined
      ? null
      : getPipeline(shader, atmosphereGpuCache.bgl as never, 'rgba16float' as never);
  if (atmosphereDispatchMode(pipeline) === 'copy-through') {
    copyHdrThrough(ctx, passName, readsKey, colorKey, resolveCtx);
    return;
  }

  const paramsBuffer = ctx.runtime.getPostProcessParamsBuffer?.(shader) ?? null;
  if (paramsBuffer !== null && entry.params !== undefined) {
    const data = ctx.postProcessParams.get(shader);
    if (data !== undefined) {
      if (data.byteLength !== entry.params.byteSize) {
        console.error('[hellforge pipeline] atmosphere params size mismatch');
        return;
      }
      const writeRes = device.queue.writeBuffer(paramsBuffer as never, 0, data);
      if (!writeRes.ok) return;
    }
  }

  const bgRes = device.createBindGroup({
    label: 'hellforge-atmosphere-bg',
    layout: atmosphereGpuCache.bgl as never,
    entries: [
      { binding: 0, resource: { kind: 'textureView', value: inputView } },
      { binding: 1, resource: { kind: 'sampler', value: atmosphereGpuCache.sampler } },
      ...(paramsBuffer !== null
        ? [{ binding: 2, resource: { kind: 'buffer' as const, value: { buffer: paramsBuffer } } }]
        : []),
    ],
  } as never);
  if (!bgRes.ok) return;

  const pass = ctx.encoder.beginRenderPass({
    label: passName,
    colorAttachments: [
      {
        view: writeView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      },
    ],
  } as never);
  pass.setPipeline(pipeline as never);
  pass.setBindGroup(1, bgRes.value as never);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function addAtmospherePass(
  graph: RenderGraph<RenderPipelineContext>,
  name: string,
  opts: {
    hdrComposited: string;
    hdrColorWhenBloomOff: string;
    hdrGraded: string;
    shader: string;
  },
): void {
  // Declare both bloom sources so topo keeps atmosphere after composite + main
  // (mirrors addTonemapPass). Per-frame pick follows camera.bloom.
  graph.addPass(name, {
    reads: [opts.hdrComposited, opts.hdrColorWhenBloomOff],
    writes: [opts.hdrGraded],
    execute: (ctx: RenderPipelineContext, resolveCtx?: ResolveContext) => {
      if (!ATMOSPHERE_PASS_ENABLED) {
        // Passthrough would need a copy; keep enabled for T1.
        return;
      }
      const src = ctx.camera.bloom === 'on' ? opts.hdrComposited : opts.hdrColorWhenBloomOff;
      dispatchAtmosphereHdr(ctx, name, opts.shader, opts.hdrGraded, src, resolveCtx);
    },
  });
}

const hellforgePipeline: RenderPipeline = {
  buildGraph(
    ctx: RenderPipelineContext,
    data: RenderPipelineData,
  ): RenderGraph<RenderPipelineContext> | null {
    const runtime = ctx.runtime;
    const graph = new RenderGraph<RenderPipelineContext>();

    const swapChainStorageFormat = ctx.pipelineState.format;
    const swapChainViewFormat = ctx.pipelineState.colorAttachmentFormat;

    graph.addColorTarget('depth', {
      format: 'depth24plus-stencil8',
      size: 'swapchain',
      sample: 1,
      usage: 0x10 | 0x04,
    });

    const shadowMapSize =
      data.shadowMapSize !== undefined && data.shadowMapSize > 0 ? data.shadowMapSize : 1024;
    const cascadeCount =
      data.cascadeCount !== undefined && data.cascadeCount >= 1 && data.cascadeCount <= 4
        ? data.cascadeCount
        : 1;
    const tilesPerSide = Math.ceil(Math.sqrt(cascadeCount));
    const atlasSize = tilesPerSide * shadowMapSize;
    graph.addColorTarget('shadowDepth', {
      format: 'depth32float',
      size: { w: atlasSize, h: atlasSize },
      sample: 1,
      usage: 0x10 | 0x04 | 0x01,
    });

    graph.addColorTarget('fxaaIntermediate', {
      format: swapChainStorageFormat,
      size: 'swapchain',
      sample: 1,
      usage: 0x04 | 0x02,
    });

    // COPY_SRC: atmosphere warm-up copy-through (PSO null) blits into hdrGraded.
    graph.addColorTarget(HDR_COLOR, {
      format: 'rgba16float',
      size: 'swapchain',
      sample: 1,
      usage: 0x10 | 0x04 | 0x01, // RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC
    });
    graph.addColorTarget(HDR_COMPOSITED, {
      format: 'rgba16float',
      size: 'swapchain',
      sample: 1,
      usage: 0x10 | 0x04 | 0x01, // RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC
    });
    // Graded HDR after atmosphere — tonemap reads this instead of hdrComposited.
    // COPY_DST: warm-up blit destination when atmosphere PSO is still pending.
    graph.addColorTarget(HDR_GRADED, {
      format: 'rgba16float',
      size: 'swapchain',
      sample: 1,
      usage: 0x10 | 0x04 | 0x02, // RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_DST
    });

    graph.addColorTarget('bloomBright', {
      format: 'rgba16float',
      size: 'half-swapchain',
      sample: 1,
      usage: 0x10 | 0x04,
    });
    graph.addColorTarget('bloomBlurH', {
      format: 'rgba16float',
      size: 'half-swapchain',
      sample: 1,
      usage: 0x10 | 0x04,
    });
    graph.addColorTarget('bloomBlurV', {
      format: 'rgba16float',
      size: 'half-swapchain',
      sample: 1,
      usage: 0x10 | 0x04,
    });

    const msaaSupported = runtime.device.caps.backendKind !== 'wgpu-webgl2';
    if (msaaSupported) {
      graph.addColorTarget('hdrColorMsaa', {
        format: 'rgba16float',
        size: 'swapchain',
        sample: 4,
        usage: 0x10,
      });
    }
    graph.addColorTarget('hdrDepth', {
      format: 'depth24plus-stencil8',
      size: 'swapchain',
      sample: 1,
      usage: 0x10,
    });
    if (msaaSupported) {
      graph.addColorTarget('hdrDepthMsaa', {
        format: 'depth24plus-stencil8',
        size: 'swapchain',
        sample: 4,
        usage: 0x10,
      });
      const supportsViewFormats = runtime.device.caps.storageBuffer;
      graph.addColorTarget('msaaColor', {
        format: swapChainStorageFormat,
        size: 'swapchain',
        sample: 4,
        usage: 0x10,
        ...(supportsViewFormats ? { viewFormats: [swapChainViewFormat] } : {}),
      });
      graph.addColorTarget('msaaDepth', {
        format: 'depth24plus-stencil8',
        size: 'swapchain',
        sample: 4,
        usage: 0x10,
      });
    }

    const shadowSelector = { LightMode: ['ShadowCaster'] };
    for (let i = 0; i < cascadeCount; i++) {
      const col = i % tilesPerSide;
      const row = Math.floor(i / tilesPerSide);
      addShadowPass(graph, `shadowCascade${i}`, {
        depth: 'shadowDepth',
        selector: shadowSelector,
        viewport: {
          x: col * shadowMapSize,
          y: row * shadowMapSize,
          w: shadowMapSize,
          h: shadowMapSize,
        },
        cascadeIndex: i,
      });
    }

    addSkyboxPass(graph, 'skybox', { color: HDR_COLOR });
    addScenePass(graph, 'main', {
      color: HDR_COLOR,
      depth: 'depth',
      // SSOT: HELLFORGE_MAIN_PASS_READS — no spot/point atlas (casters omitted).
      reads: [...HELLFORGE_MAIN_PASS_READS],
      selector: { LightMode: ['Forward'] },
    });

    addBloomPasses(graph, {
      hdrColor: HDR_COLOR,
      hdrComposited: HDR_COMPOSITED,
      bright: 'bloomBright',
      blurH: 'bloomBlurH',
      blurV: 'bloomBlurV',
    });

    // PRE-TONEMAP atmosphere (HDR chain). Forbidden alternative: config.postEffects
    // (post-FXAA LDR).
    addAtmospherePass(graph, ATMOSPHERE_PASS_NAME, {
      hdrComposited: HDR_COMPOSITED,
      hdrColorWhenBloomOff: HDR_COLOR,
      hdrGraded: HDR_GRADED,
      shader: ATMOSPHERE_SHADER_ID,
    });

    // Tonemap reads graded HDR (bloom on → atmosphere wrote from hdrComposited;
    // bloom off → from hdrColor). Keep engine tonemap — do not fold into atmosphere.
    addTonemapPass(graph, TONEMAP_PASS_NAME, hellforgeTonemapHdrSources());

    addFullscreenPass(graph, FXAA_PASS_NAME, { shader: 'fxaa', color: 'fxaaIntermediate' });

    // Intentionally omit config.postEffects (LDR pretend-done path).

    attachDebugOverlayPass(graph, (c: RenderPipelineContext) => {
      const proj = mat4.create();
      if (c.camera.projection === 'orthographic') {
        mat4.orthographic(
          proj,
          c.camera.orthoLeft,
          c.camera.orthoRight,
          c.camera.orthoBottom,
          c.camera.orthoTop,
          c.camera.near,
          c.camera.far,
        );
      } else {
        mat4.perspective(proj, c.camera.fov, c.camera.aspect, c.camera.near, c.camera.far);
      }
      const view = mat4.invert(mat4.create(), c.camera.world);
      return mat4.multiply(mat4.create(), proj, view);
    });

    const compileResult = graph.compile({
      backendKind: runtime.device.caps.backendKind,
      caps: runtime.device.caps,
      device: runtime.device,
    });
    if (!compileResult.ok) {
      console.error(
        '[hellforge pipeline] graph.compile failed:',
        compileResult.error.code,
        compileResult.error.expected,
      );
      return null;
    }
    return graph;
  },
  execute(ctx: RenderPipelineContext): void {
    ctx.frameState.perFrameGraph?.execute(ctx);
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
      atmosphereGpuCache = null;
      try {
        world.despawn(paramsEntity);
      } catch {
        /* world may already be torn down */
      }
    },
  };
}
