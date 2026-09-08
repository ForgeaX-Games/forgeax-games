// 此文件由 tools/plan-biome.ts 生成，手改会被下次生成覆盖。
// 世界观 prompt: "一颗温带海洋星球。草原上散布着成片的松树林和阔叶林，干旱区是裸露的岩石和石阵，高地上立着孤零零的巨石，海岸线一带长着齐膝的灌木。除了这些成片的林子和石阵，整颗星球的地面都零星点缀着低矮的灌木丛和小碎石，走到哪儿脚边都有东西，没有一块地方是完全空荡的。"
// 模型: claude-opus-4-8
// 生成日期: 2026-08-10T08:45:38.142Z

import type { BiomePlan } from './worldgen/core/types';

export const BIOME_PLAN: BiomePlan = {
  "version": 1,
  "seed": 7,
  "strayBudget": 90,
  "clusters": [
    {
      "kind": "grassland_forest",
      "region": "grassland",
      "regionMin": 0.12,
      "count": [
        4,
        6
      ],
      "radiusWorld": [
        9,
        14
      ],
      "perCluster": [
        6,
        9
      ],
      "props": {
        "tree_cloudPine": 3,
        "tree_pineTallA_detailed": 2,
        "tree_pineRoundC": 2,
        "tree_cloudBroad": 3,
        "tree_oak": 2
      }
    },
    {
      "kind": "dry_stones",
      "region": "dry",
      "regionMin": 0.1,
      "count": [
        3,
        5
      ],
      "radiusWorld": [
        7,
        11
      ],
      "perCluster": [
        7,
        10
      ],
      "props": {
        "rock_slabA": 3,
        "rock_standingA": 2,
        "rock_largeA": 2,
        "rock_largeD": 2,
        "stone_largeC": 2
      }
    },
    {
      "kind": "highland_megalith",
      "region": "highland",
      "regionMin": 0.08,
      "count": [
        5,
        7
      ],
      "radiusWorld": [
        4,
        6
      ],
      "perCluster": [
        4,
        5
      ],
      "props": {
        "rock_standingA": 3,
        "rock_cloudMossy": 2,
        "rock_largeA": 1
      }
    },
    {
      "kind": "beach_bushes",
      "region": "beach",
      "regionMin": 0.06,
      "count": [
        3,
        5
      ],
      "radiusWorld": [
        6,
        9
      ],
      "perCluster": [
        8,
        11
      ],
      "props": {
        "plant_bushDetailed": 3,
        "plant_bushLargeTriangle": 2
      }
    }
  ],
  "strayByRegion": {
    "grassland": {
      "plant_bushDetailed": 4,
      "plant_bushLargeTriangle": 3,
      "rock_smallB": 3
    },
    "dry": {
      "rock_smallB": 4,
      "plant_bushDetailed": 1
    },
    "highland": {
      "plant_bushDetailed": 2,
      "rock_smallB": 3
    },
    "beach": {
      "plant_bushDetailed": 3,
      "plant_bushLargeTriangle": 2,
      "rock_smallB": 2
    }
  },
  "minSpacingFactor": 1.1,
  "darkFraction": 0.45,
  "provenance": {
    "user_stated": [
      "草原上散布着成片的松树林和阔叶林",
      "干旱区是裸露的岩石和石阵",
      "高地上立着孤零零的巨石",
      "海岸线一带长着齐膝的灌木",
      "一颗温带海洋星球",
      "整颗星球的地面都零星点缀着低矮的灌木丛和小碎石",
      "没有一块地方是完全空荡的"
    ],
    "defaulted": [
      "region 词表映射: 草原->grassland, 干旱区->dry, 高地->highland, 海岸线->beach; iceCap 未被用户提及, 不放任何 prop 且不建 stray 权重表(冰盖不该长植被)。",
      "草原成片林选用松树类(tree_cloudPine, tree_pineTallA_detailed, tree_pineRoundC)代表松树林, tree_cloudBroad 与 tree_oak 代表阔叶林; 未选 tree_cloudDead(枯树无语义依据)。",
      "grassland_forest: count[4,6], perCluster[6,9], radiusWorld[9,14], 保守预算 4*6=24>=20。",
      "干旱区石阵与裸岩用大石板/立石/大石(rock_slabA, rock_standingA, rock_largeA, rock_largeD, stone_largeC); dry_stones count[3,5], perCluster[7,10], 保守 3*7=21>=20。",
      "高地孤立巨石: 每簇 4-5 立石模拟孤零零分布, count[5,7], perCluster[4,5], radiusWorld[4,6] 小半径, 保守 5*4=20>=20。",
      "海岸齐膝灌木用矮灌木 plant_bushDetailed/plant_bushLargeTriangle(size~0.7-1.2, 齐膝高度); beach 稀有定向区域故建 cluster 而非只靠 stray; count[3,5], perCluster[8,11], 保守 3*8=24>=20。",
      "全星球零星点缀用 stray, 主用非致命道具 plant_bushDetailed/plant_bushLargeTriangle(低矮灌木丛)与 rock_smallB(小碎石), strayBudget=90(>=22)以确保各 kind 实测 n>=15 且填满非致命密度下限65。",
      "为满足致命障碍落在76..107内(上次108超限), 减少 cluster 树/大石数量与簇数, 保守 lethal 预算控制在区间内; 视觉密度改用 lethal=false 的灌木与小碎石堆满, 不加树和大石头。",
      "regionMin 阈值(grassland 0.12, dry 0.1, highland 0.08, beach 0.06)为下游 gate 补齐的默认最小陆地占比。",
      "minSpacingFactor=1.1 沿用既有表现参数。",
      "darkFraction=0.45 沿用既有表现参数。",
      "iceCap 无权重表会按其陆地占比损失 stray 预算槽, 已调高 strayBudget 补偿。"
    ]
  }
};
