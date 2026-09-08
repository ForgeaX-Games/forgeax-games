// 冻结的难度/密度基准 —— 这是 2026-08-10 引入 WorldClaw Stage 1 生成器之前的
// 手调方案，原样保留一份。tools/plan-biome.ts 拿它当参照，衡量新方案的致命障碍
// 数与视觉密度。
//
// 为什么不直接读 src/biome-plan.ts：那个文件会被生成器覆盖，一旦拿它当基准，
// 每次生成都以上一次的产物为参照，标准会随生成漂移（实测踩过：一次偏保守的生成
// 把基准从 89 拉到 68，下一次就以 68 为准了）。基准必须是固定参照物。

import type { BiomePlan } from './worldgen/core/types';

export const BASELINE_PLAN: BiomePlan = {
  version: 1,
  seed: 7,
  strayBudget: 40,
  minSpacingFactor: 1.1,
  darkFraction: 0.45,
  clusters: [
    {
      kind: 'grove',
      region: 'grassland',
      regionMin: 0.5,
      count: [5, 7],
      radiusWorld: [5, 8],
      perCluster: [5, 8],
      props: {
        tree_cloudPine: 0.25,
        tree_cloudBroad: 0.20,
        tree_pineTallA_detailed: 0.15,
        tree_pineRoundC: 0.15,
        tree_oak: 0.15,
        plant_bushDetailed: 0.10,
      },
    },
    {
      kind: 'rockfield',
      region: 'dry',
      regionMin: 0.5,
      count: [3, 5],
      radiusWorld: [4, 6],
      perCluster: [4, 6],
      props: {
        rock_slabA: 0.20,
        rock_pebbleCluster: 0.25,
        rock_standingA: 0.20,
        rock_cloudMossy: 0.15,
        rock_largeA: 0.10,
        stone_largeC: 0.10,
      },
    },
    {
      kind: 'highlandTor',
      region: 'highland',
      regionMin: 0.5,
      count: [2, 3],
      radiusWorld: [4, 6],
      perCluster: [3, 5],
      props: {
        rock_standingA: 0.30,
        rock_largeD: 0.25,
        rock_slabA: 0.25,
        stone_largeC: 0.20,
      },
    },
    {
      kind: 'shoreScrub',
      region: 'beach',
      regionMin: 0.4,
      count: [4, 5],
      radiusWorld: [4, 6],
      perCluster: [3, 5],
      props: {
        plant_bushDetailed: 0.35,
        plant_bushLargeTriangle: 0.35,
        rock_smallB: 0.30,
      },
    },
  ],
  strayByRegion: {
    grassland: {
      tree_cloudPine: 5,
      plant_bushDetailed: 2,
      rock_slabA: 3,
    },
    dry: {
      rock_slabA: 8,
      plant_bushDetailed: 2,
    },
    highland: {
      rock_standingA: 10,
    },
    beach: {
      plant_bushDetailed: 6,
      rock_smallB: 4,
    },
    iceCap: {},
  },
  provenance: {
    user_stated: [],
    defaulted: ['陡坡树改由 gate 拒绝后簇内重试补其他道具，不再走原来的『改种石头』回退'],
  },
};
