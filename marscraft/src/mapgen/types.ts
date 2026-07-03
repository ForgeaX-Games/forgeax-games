/**
 * 地图生成类型定义
 *
 * 所有地图生成模块共享的类型。
 * 修改此文件时注意：MapData.ts 的对外接口也依赖这些类型。
 *
 * 架构（对齐 SC2 分层机制）：
 *   1. Cliff Level — 离散高地层级 (0,1,2,…)，相邻不同层级自动生成悬崖边缘
 *   2. Pathing Grid — 独立通行性位图，与视觉解耦
 *   3. Height Data  — 纯视觉高度，由 cliff level + 坡道 + 噪声推导
 *   4. Terrain Type  — 纯视觉纹理，不影响寻路
 */

// ── 地形类型（纯视觉） ──

export enum TerrainType {
  Regolith = 0,   // 火星风化层
  Sand     = 1,   // 沙地
  Rock     = 2,   // 岩石
  Ice      = 3,   // 冰层
  Crater   = 4,   // 陨石坑
  Cliff    = 5,   // 悬崖边缘
  Ramp     = 6,   // 坡道
  // ── 沟壑填充类型（cliffLevel < 0 的凹陷地形）──
  Lava     = 7,   // 岩浆 — 橙红熔岩
  Water    = 8,   // 水/深渊液体 — 深蓝
  Void     = 9,   // 深渊 — 近黑虚空
  // ── 地图边界 ──
  Border   = 10,  // 地图边界 — 完全不可通行的黑色岩石
}

/**
 * 旧版兼容：根据 TerrainType 判断可通行性。
 * 新系统应使用 MapConfig.pathingGrid，此函数仅作为 fallback。
 */
export function isWalkable(t: TerrainType): boolean {
  return t <= TerrainType.Ice || t === TerrainType.Ramp
}

// ── 资源 ──

export interface MineralPatch {
  x: number
  z: number
  amount: number
}

export interface VespeneGeyser {
  x: number
  z: number
  amount: number
}

// ── 出生点 ──

export interface SpawnPoint {
  x: number
  z: number
  playerId: number
  facing: number   // 弧度
}

// ── 地图配置（最终输出） ──

export interface MapConfig {
  name: string
  width: number
  height: number
  gridResolution: number
  /** 视觉高度（由 cliff level + 坡道 + 噪声推导） */
  heightData: number[]
  /** 视觉地形类型（纯纹理，不影响寻路） */
  terrainTypes: TerrainType[]
  /** 每格的 cliff level（0 = 低地，1 = 一级高地，…） */
  cliffLevels: number[]
  /**
   * 独立通行性网格（0 = 可通行，1 = 不可通行）
   * 由 cliff edge + 坡道 + 石柱 + 手动区域 + 地图边缘 综合生成
   */
  pathingGrid: Uint8Array
  /**
   * 悬崖边缘列表（用于 3D 墙壁生成与小地图渲染）
   * 每条边缘是相邻两格之间的线段
   */
  cliffEdges: CliffEdge[]
  spawnPoints: SpawnPoint[]
  minerals: MineralPatch[]
  geysers: VespeneGeyser[]
  /** 所有矿区的预定义基地位置（来自蓝图 bases[].ccX/ccZ） */
  baseLocations: { x: number; z: number }[]
  maxHeight: number
  decorations?: DecorationDef[]
  environment?: EnvironmentDef
  /**
   * 沟壑深度网格（Int8Array，0=无沟壑，1-3=深度）
   * 由 terrainGen 生成，Terrain.ts 用于渲染发光覆盖层
   */
  trenchGrid?: Int8Array
  /**
   * 边界网格（Uint8Array，0=非边界，1=边界）
   * 由 terrainGen 生成，用于确保边界区域完全不可通行
   */
  borderGrid?: Uint8Array
  /** 地图边界山脉起始距离（从中心到边缘山脉的最大轴距离） */
  edgeDist?: number
  /** 地形纹理主题（默认 volcanic） */
  theme?: string
}

/** 自动生成的悬崖边缘（两个不同 cliff level 的格子之间） */
export interface CliffEdge {
  /** 世界坐标起点 */
  x1: number; z1: number
  /** 世界坐标终点 */
  x2: number; z2: number
  /** 较高侧的 cliff level */
  highLevel: number
  /** 较低侧的 cliff level */
  lowLevel: number
}

// ── 地图蓝图（声明式地图描述，用于驱动生成器） ──

/** 矩形高地平台 */
export interface RectPlatform {
  x1: number; z1: number; x2: number; z2: number
  /** 视觉高度（用于向后兼容） */
  height: number
  /** SC2 风格的 cliff level (0,1,2,…)。若省略，由 height 推导 */
  cliffLevel?: number
  terrain?: TerrainType
}

/** 圆形区域（shape='square' 时 r 为半边长，用轴对齐矩形判定） */
export interface CircleZone {
  x: number; z: number; r: number
  /** 视觉高度（用于向后兼容） */
  height?: number
  /** SC2 风格的 cliff level。若省略，由 height 推导 */
  cliffLevel?: number
  terrain?: TerrainType
  /** 笔刷形状：'circle'（默认）或 'square' */
  shape?: 'circle' | 'square'
}

/** 悬崖墙壁线段（已废弃，保留向后兼容；新地图应使用 cliffLevel 自动生成） */
export interface CliffWall {
  ax: number; az: number   // 起点
  bx: number; bz: number   // 终点
  width: number             // 半宽
}

/** 圆形石柱 */
export interface Pillar {
  x: number; z: number; r: number
}

/** 坡道 */
export interface RampDef {
  ax: number; az: number   // 起点 (高度 hA 侧)
  bx: number; bz: number   // 终点 (高度 hB 侧)
  /** 视觉半宽（用于高度插值和地形渲染） */
  width: number
  hA: number; hB: number
  /**
   * 通行半宽（用于 pathing grid 的可走通道宽度）。
   * 若不指定，默认 = min(width × 0.5, 3.0)。
   * SC2 标准坡道约 2~3 格宽。
   */
  pathWidth?: number
  /** 坡道覆盖纹理（可选，不填则使用默认 TerrainType.Ramp） */
  terrain?: TerrainType
}

/** 矩形不可通行区域（手动 pathing paint） */
export interface UnpathableRect {
  x1: number; z1: number
  x2: number; z2: number
}

/** 圆形不可通行区域（手动 pathing paint） */
export interface UnpathableCircle {
  x: number; z: number; r: number
}

/** 基地资源配置 */
export interface BaseResources {
  /** 基地中心 (CC 位置) */
  ccX: number; ccZ: number
  /** 矿线弧心 (弧形凹面朝向 CC) */
  mineralArcX: number; mineralArcZ: number
  mineralCount: number
  mineralRadius: number
  mineralAmount: number
  /** 气矿位置 */
  geysers: Array<{ x: number; z: number; amount: number }>
}

/**
 * 沟壑定义 — 地面向下凹陷的不可通行地形（岩浆/水/深渊）
 *
 * 数据模型（A+B）：
 *   A. trenchGrid — 标记哪些格子是沟壑及其深度（供渲染/碰撞使用）
 *   B. cliffLevel = baseCL - depth（负值），让悬崖系统自然产生边缘墙壁
 */
export interface TrenchDef {
  x: number; z: number; r: number
  /** 沟壑深度（正整数，1=浅/2=中/3=深，自定义可更大） */
  depth: number
  /** 视觉填充类型（决定渲染颜色与材质） */
  type: 'lava' | 'water' | 'void'
  /** 笔刷形状（默认圆形） */
  shape?: 'circle' | 'square'
}

/**
 * 地图边界定义 — 完全不可通行的永久障碍（玩家无法以任何方式越过）
 *
 * 与沟壑的区别：
 *   - 边界 = 硬封锁（地面+空中单位均不可通过）
 *   - 沟壑 = 地面封锁（cliffLevel 负值，视觉上是凹陷地形）
 */
export interface BorderZone {
  x: number; z: number; r: number
  /** 笔刷形状（默认圆形） */
  shape?: 'circle' | 'square'
}

/** 装饰物定义 (阻挡/视野遮蔽/纯视觉) */
export interface DecorationDef {
  id: string
  type: 'rock' | 'plant' | 'machinery' | 'crystal' | 'ruins' | 'barricade' | string
  x: number
  z: number
  r: number
  rotation: number
  scale: number
  blocksPathing: boolean // 是否阻挡地面寻路
  blocksLOS: boolean     // 是否阻挡视野
}

/** 完整地图蓝图 */
export interface EnvironmentDef {
  ambientLight: { color: number; intensity: number }
  directionalLight: { color: number; intensity: number; position: { x: number; y: number; z: number } }
  fogDensity?: number
  fogColor?: number
  skyColor: number
  groundColor: number
}

export interface MapBlueprint {
  name: string
  width: number
  height: number
  resolution: number
  maxHeight: number
  
  /** 环境配置（可选） */
  environment?: EnvironmentDef

  /** 全图基础 cliff level（默认 0） */
  baseCliffLevel?: number
  /** 每个 cliff level 对应的视觉高度（默认 2.0） */
  cliffVisualHeight?: number

  /** 高地矩形平台（可指定 cliffLevel） */
  platforms: RectPlatform[]
  /** 圆形区域（可指定 cliffLevel） */
  circles: CircleZone[]
  /**
   * 悬崖墙壁（旧版手动方式，已废弃）
   * 新地图请使用 cliffLevel + 自动生成
   * 保留兼容：若存在，仍会作为额外的不可通行线段
   */
  cliffWalls: CliffWall[]
  /**
   * 石柱（不可通行 + 视觉）
   * @deprecated 以后不再生成石柱
   */
  pillars?: Pillar[]
  /** 坡道（连接不同 cliff level） */
  ramps: RampDef[]

  /** 手动标记不可通行矩形区域 */
  unpathableRects?: UnpathableRect[]
  /** 手动标记不可通行圆形区域 */
  unpathableCircles?: UnpathableCircle[]

  /** 装饰物 (Doodads - 岩石、植物、建筑残骸等) */
  decorations?: DecorationDef[]
  /**
   * 已删除的自动生成装饰物 ID 列表（位置确定性 ID，跨重建保持稳定）。
   * 生成器在自动生成装饰物时跳过这些 ID。
   */
  removedDecoIds?: string[]

  /** 沟壑定义（岩浆河、水道、深渊裂缝等） */
  trenches?: TrenchDef[]

  /** 边界定义（完全不可通行区域，玩家无法以任何方式越过） */
  borders?: BorderZone[]

  /** 出生点 */
  spawnPoints: SpawnPoint[]
  /** 各基地资源 */
  bases: BaseResources[]

  /** 地图边界山脉起始距离 (默认 56) */
  edgeDist?: number
  /** 地表噪声振幅 (默认 0.04) */
  noiseAmplitude?: number

  /**
   * 预计算高度网格（可选，由 VoronoiRasterizer 生成）。
   * 当存在时，terrainGen 直接从此网格采样 cliff level，
   * 而非从 platforms/circles 推导，从而保留边界对角化效果。
   */
  heightGrid?: Int8Array
  /** 高度网格分辨率（正方形边长，单位：格子数） */
  heightGridRes?: number

  /**
   * 预计算资源位置（可选，由 V2 ResourcePlacer 生成）。
   * 当存在时，generateMap 直接使用这些位置，跳过 generateResources 重新生成。
   */
  precomputedMinerals?: MineralPatch[]
  precomputedGeysers?: VespeneGeyser[]

  /** 地形纹理主题 */
  theme?: string
}
