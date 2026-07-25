/**
 * Pure Hellforge pipeline topology contract (no WebGPU / WGSL).
 *
 * Used by `render-pipeline.ts` for pass names + tonemap wiring + main-pass
 * reads, and by unit tests so atmosphere→tonemap / `hdrGraded` / dangling-read
 * cannot silently regress without engine install.
 */

export const ATMOSPHERE_PASS_NAME = 'atmosphere';
export const TONEMAP_PASS_NAME = 'tonemap';
export const FXAA_PASS_NAME = 'fxaa';

/** Graded HDR target written by atmosphere; tonemap samples this. */
export const HDR_GRADED = 'hdrGraded';

/** Bloom-composited HDR (atmosphere source when bloom on). */
export const HDR_COMPOSITED = 'hdrComposited';

/** Main HDR (atmosphere source when bloom off). */
export const HDR_COLOR = 'hdrColor';

/**
 * Main forward pass graph reads — SSOT shared with `render-pipeline.ts`.
 *
 * No `spotShadowDepth` / point-shadow atlas: hellforge::pipeline omits those
 * caster passes (barrel gap). Reading an unwritten key → graph dangling-read
 * → buildGraph returns null → no frames.
 */
export const HELLFORGE_MAIN_PASS_READS = ['shadowDepth', HDR_COLOR] as const;

/**
 * Named order of the grade chain after bloom composite.
 * Full graph also has shadow cascades, skybox, main, bloom before this,
 * after FXAA.
 */
export const HELLFORGE_GRADE_CHAIN_PASSES = [
  ATMOSPHERE_PASS_NAME,
  TONEMAP_PASS_NAME,
  FXAA_PASS_NAME,
] as const;

export type HellforgeTonemapHdrSources = {
  readonly hdrComposited: typeof HDR_GRADED;
  readonly hdrColorWhenBloomOff: typeof HDR_GRADED;
};

/** Both bloom branches read graded HDR — never ungraded hdrComposited/hdrColor. */
export function hellforgeTonemapHdrSources(): HellforgeTonemapHdrSources {
  return {
    hdrComposited: HDR_GRADED,
    hdrColorWhenBloomOff: HDR_GRADED,
  };
}

export type HellforgePipelineTopology = {
  readonly atmospherePass: typeof ATMOSPHERE_PASS_NAME;
  readonly tonemapPass: typeof TONEMAP_PASS_NAME;
  readonly atmosphereWrites: typeof HDR_GRADED;
  readonly atmosphereReads: readonly [typeof HDR_COMPOSITED, typeof HDR_COLOR];
  readonly tonemapReads: HellforgeTonemapHdrSources;
  readonly mainPassReads: typeof HELLFORGE_MAIN_PASS_READS;
  readonly gradeChainOrder: typeof HELLFORGE_GRADE_CHAIN_PASSES;
};

export function hellforgePipelineTopology(): HellforgePipelineTopology {
  return {
    atmospherePass: ATMOSPHERE_PASS_NAME,
    tonemapPass: TONEMAP_PASS_NAME,
    atmosphereWrites: HDR_GRADED,
    atmosphereReads: [HDR_COMPOSITED, HDR_COLOR],
    tonemapReads: hellforgeTonemapHdrSources(),
    mainPassReads: HELLFORGE_MAIN_PASS_READS,
    gradeChainOrder: HELLFORGE_GRADE_CHAIN_PASSES,
  };
}

/** Warm-up / missing PSO: copy HDR source into hdrGraded instead of grading. */
export type AtmosphereDispatchMode = 'grade' | 'copy-through';

export function atmosphereDispatchMode(
  pipeline: unknown | null | undefined,
): AtmosphereDispatchMode {
  return pipeline == null ? 'copy-through' : 'grade';
}

/** One pass's declared graph edges (mirrors engine add*Pass read/write lists). */
export type HellforgeGraphPassDecl = {
  readonly name: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
};

/**
 * Pass read/write contract for hellforge::pipeline (cascadeCount default 1).
 * Must stay aligned with `render-pipeline.ts` buildGraph composition order.
 * Pure stand-in for graph.compile dangling-read when engine is not linked
 * in the games leaf test runner.
 */
export function hellforgeGraphPassContract(cascadeCount = 1): readonly HellforgeGraphPassDecl[] {
  const cascades: HellforgeGraphPassDecl[] = [];
  for (let i = 0; i < cascadeCount; i++) {
    cascades.push({ name: `shadowCascade${i}`, reads: [], writes: ['shadowDepth'] });
  }
  const tonemapSrc = hellforgeTonemapHdrSources();
  const tonemapReads =
    tonemapSrc.hdrColorWhenBloomOff === tonemapSrc.hdrComposited
      ? ([tonemapSrc.hdrComposited] as const)
      : ([tonemapSrc.hdrComposited, tonemapSrc.hdrColorWhenBloomOff] as const);
  return [
    ...cascades,
    { name: 'skybox', reads: [], writes: [HDR_COLOR] },
    {
      name: 'main',
      reads: HELLFORGE_MAIN_PASS_READS,
      writes: [HDR_COLOR, 'depth'],
    },
    { name: 'bloom-bright', reads: [HDR_COLOR], writes: ['bloomBright'] },
    { name: 'bloom-blur-h', reads: ['bloomBright'], writes: ['bloomBlurH'] },
    { name: 'bloom-blur-v', reads: ['bloomBlurH'], writes: ['bloomBlurV'] },
    {
      name: 'bloom-composite',
      reads: [HDR_COLOR, 'bloomBlurV'],
      writes: [HDR_COMPOSITED],
    },
    {
      name: ATMOSPHERE_PASS_NAME,
      reads: [HDR_COMPOSITED, HDR_COLOR],
      writes: [HDR_GRADED],
    },
    { name: TONEMAP_PASS_NAME, reads: tonemapReads, writes: [] },
    { name: FXAA_PASS_NAME, reads: [], writes: ['fxaaIntermediate'] },
  ];
}

export type HellforgeGraphContractValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'dangling-read'; readonly expected: string };

/** Same rule as engine RenderGraph.validateNoDanglingRead (writers vs readers). */
export function validateHellforgeGraphNoDanglingReads(
  passes: readonly HellforgeGraphPassDecl[] = hellforgeGraphPassContract(),
): HellforgeGraphContractValidation {
  const writers = new Set<string>();
  for (const pass of passes) {
    for (const key of pass.writes) writers.add(key);
  }
  for (const pass of passes) {
    for (const key of pass.reads) {
      if (!writers.has(key)) {
        return {
          ok: false,
          code: 'dangling-read',
          expected: `pass '${pass.name}' reads key '${key}' but no pass writes it`,
        };
      }
    }
  }
  return { ok: true };
}
