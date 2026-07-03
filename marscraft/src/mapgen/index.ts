export { heatWaveHighwayBlueprint } from './presets/heat-wave-highway'
export { lavaSnowPoolBlueprint } from './presets/lava-snow-pool'
export { crystalWastelandBlueprint } from './presets/crystal-wasteland'
/**
 * 地图生成模块 — 统一出口
 *
 * 使用方式：
 *   import { generateMap, redCanyonBlueprint } from '@shared/mapgen'
 *   const map = generateMap(redCanyonBlueprint)
 *
 * 新增地图预设：
 *   1. 在 presets/ 下新建 ts 文件，export 一个 MapBlueprint
 *   2. 在此文件 re-export
 *
 * 模块结构：
 *   types.ts      — 所有类型定义
 *   geometry.ts   — 纯数学工具
 *   resources.ts  — 资源放置逻辑
 *   terrainGen.ts — 地形高度 + 类型生成
 *   generator.ts  — 组装入口
 *   presets/      — 地图蓝图预设
 */

// 核心
export { generateMap } from './generator'
export { generateTerrain } from './terrainGen'
export { generateResources, mineralArc } from './resources'

// 几何工具
export { dist, segDist, inRect, worldToGrid, gridToWorld, worldSizeToGridCells } from './geometry'

// 类型
export {
  TerrainType,
  isWalkable,
  type MapConfig,
  type MapBlueprint,
  type MineralPatch,
  type VespeneGeyser,
  type SpawnPoint,
  type RectPlatform,
  type CircleZone,
  type CliffWall,
  type CliffEdge,
  type Pillar,
  type RampDef,
  type UnpathableRect,
  type UnpathableCircle,
  type BaseResources,
  type DecorationDef,
  type TrenchDef,
  type BorderZone,
} from './types'

// 程序化地图生成
export {
  generateRTSBlueprint,
  generateProceduralBlueprint,
  type RTSMapConfig,
  type ProceduralMapConfig,
} from './procedural/ProceduralMapGen'

// 预设
export { redCanyonBlueprint } from './presets/red-canyon'
export { nebulaPlateauBlueprint } from './presets/nebula-plateau'