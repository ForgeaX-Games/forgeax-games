import { describe, expect, test } from 'bun:test';
import {
  ATMOSPHERE_PASS_NAME,
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

describe('hellforge pipeline topology (PR2c T1b)', () => {
  test('atmosphere precedes tonemap in the grade chain', () => {
    const topo = hellforgePipelineTopology();
    const atmoIdx = topo.gradeChainOrder.indexOf(ATMOSPHERE_PASS_NAME);
    const tonemapIdx = topo.gradeChainOrder.indexOf(TONEMAP_PASS_NAME);
    expect(atmoIdx).toBeGreaterThanOrEqual(0);
    expect(tonemapIdx).toBeGreaterThan(atmoIdx);
    expect(HELLFORGE_GRADE_CHAIN_PASSES[0]).toBe('atmosphere');
    expect(HELLFORGE_GRADE_CHAIN_PASSES[1]).toBe('tonemap');
  });

  test('tonemap reads hdrGraded on both bloom branches', () => {
    const sources = hellforgeTonemapHdrSources();
    expect(sources.hdrComposited).toBe(HDR_GRADED);
    expect(sources.hdrColorWhenBloomOff).toBe(HDR_GRADED);
    expect(sources.hdrComposited).not.toBe(HDR_COMPOSITED);
    expect(sources.hdrColorWhenBloomOff).not.toBe(HDR_COLOR);

    const topo = hellforgePipelineTopology();
    expect(topo.tonemapReads).toEqual(sources);
    expect(topo.atmosphereWrites).toBe(HDR_GRADED);
    expect(topo.atmosphereReads).toEqual([HDR_COMPOSITED, HDR_COLOR]);
  });

  test('null / undefined atmosphere PSO selects copy-through warm-up', () => {
    expect(atmosphereDispatchMode(null)).toBe('copy-through');
    expect(atmosphereDispatchMode(undefined)).toBe('copy-through');
    expect(atmosphereDispatchMode({})).toBe('grade');
  });
});

describe('hellforge graph-build smoke (PR2c T5-fix / C1+I3)', () => {
  test('pass contract has no dangling-read (main omits spotShadowDepth)', () => {
    const passes = hellforgeGraphPassContract(1);
    const main = passes.find((p) => p.name === 'main');
    expect(main).toBeDefined();
    expect(main!.reads).toEqual([...HELLFORGE_MAIN_PASS_READS]);
    expect(main!.reads).not.toContain('spotShadowDepth');
    expect(HELLFORGE_MAIN_PASS_READS).not.toContain('spotShadowDepth');

    const result = validateHellforgeGraphNoDanglingReads(passes);
    expect(result.ok).toBe(true);

    // Regression shape: reading spot atlas without a writer must fail.
    const broken = passes.map((p) =>
      p.name === 'main'
        ? { ...p, reads: [...p.reads, 'spotShadowDepth'] }
        : p,
    );
    const brokenResult = validateHellforgeGraphNoDanglingReads(broken);
    expect(brokenResult.ok).toBe(false);
    if (!brokenResult.ok) {
      expect(brokenResult.code).toBe('dangling-read');
      expect(brokenResult.expected).toContain('spotShadowDepth');
    }
  });

  test('topology SSOT exposes mainPassReads without spot atlas', () => {
    const topo = hellforgePipelineTopology();
    expect(topo.mainPassReads).toEqual(HELLFORGE_MAIN_PASS_READS);
    expect(topo.mainPassReads).toContain('shadowDepth');
    expect(topo.mainPassReads).toContain(HDR_COLOR);
  });
});
