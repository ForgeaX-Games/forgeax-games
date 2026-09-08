export const PS_REGIONS = ['iceCap', 'dry', 'highland', 'beach', 'grassland'] as const;

export type PSRegion = (typeof PS_REGIONS)[number];
export type LandformOp = 'peak' | 'dune' | 'terrace' | 'erosion' | 'ridge' | 'flat';

export interface RegionTerrain {
  baseElevation: number;
  roughness: number;
  landformOps: LandformOp[];
}

export type TerrainPlan = {
  version: 1;
  amplitude: number;
  byRegion: Record<PSRegion, RegionTerrain>;
  provenance: { user_stated: string[]; defaulted: string[] };
};

/**
 * Stage 2's single terrain specification. Both the CPU evaluator and the WGSL
 * emitter consume this object; do not duplicate these numbers in surface.ts.
 */
export const TERRAIN_PLAN: TerrainPlan = {
  version: 1,
  // 世界单位的起伏总幅度由它定。**不是沿用旧的 TERRAIN_AMP=1.6**：旧的 relief()
  // 返回的是 0.96..1.72 的非归一化和，新的 H 是 0.07..0.77，同一个乘数会让星球
  // 平掉 2.5 倍（实测：陆地高度 p99-p1 从 3.104 掉到 1.227）。4.05 = 1.6 × 3.104
  // / 1.227，把总幅度调回改动前的水平。
  //
  // 这个数不能只看归一化的 H 分位去调——那是 Stage 2 首版踩的坑：gate 只断言了
  // 「高地比草原高」这类**相对**关系，靠整体缩水一样能满足，绝对幅度就这么悄悄
  // 没了。tools/terrain-gate.ts 现在对世界单位幅度有硬下限。
  amplitude: 4.05,
  byRegion: {
    grassland: { baseElevation: 0.22, roughness: 0.08, landformOps: ['flat'] },
    highland: { baseElevation: 0.54, roughness: 0.38, landformOps: ['peak', 'ridge'] },
    dry: { baseElevation: 0.30, roughness: 0.24, landformOps: ['dune'] },
    beach: { baseElevation: 0.07, roughness: 0.025, landformOps: ['flat'] },
    iceCap: { baseElevation: 0.24, roughness: 0.07, landformOps: ['dune'] },
  },
  provenance: {
    user_stated: [
      '草原给 `flat`/低 roughness，高地给 `peak`+`ridge`，干旱区给 `dune`，海滩给 `flat`，冰盖给 `dune`+低振幅。',
    ],
    defaulted: [
      'baseElevation、roughness 与 amplitude 是 Stage 2 首版保守手调值；terrain gate 负责量测验证。',
      '区域噪声使用 WorldClaw field.py 的 (2, 5, 9) 三频与 0.5^k 权重。',
    ],
  },
};
