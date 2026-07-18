/**
 * RTS 地图生成器 — 主编排器 (Zone-First)
 *
 * Zone-First 5 阶段管线：
 *
 *   Phase 1: 种子点位置生成（只有位置 + hint，不分配角色/资源）
 *     - 固定核心点 + Poisson 磁盘采样填充
 *     - P1 半区生成，180° 镜像到 P2，加中心点
 *
 *   Phase 2: L1 Voronoi + Pinned Lloyd 松弛 + 高度分配
 *     - 曼哈顿距离 Voronoi
 *     - Lloyd 质心更新（主矿 Pinned 不动）
 *     - 高度分配：hint='base' 最远点 CL2，其余 Fisher-Yates CL0/CL1
 *
 *   Phase 3: 功能分区规划（Zone-First 核心）
 *     - 基于地形、位置、邻接关系划分功能分区
 *     - 不依赖任何角色/资源信息
 *
 *   Phase 4: 资源分配（根据分区回填）
 *     - spawn_zone → main_base + 8矿2气
 *     - mineral_zone → expansion + 6矿1气
 *     - 其余 → 无资源
 *
 *   Phase 5: 坡道 + 高度网格 + 出生点 + 基地资源 + 沟壑
 *
 * 输出：MapBlueprint
 */

import { SeededRandom } from './SeededRandom'
import { mirrorPoint } from './SymmetryFramework'
import type { SymmetryMode, Point2D } from './SymmetryFramework'
import { buildVoronoi } from './VoronoiEngine'
import type { VoronoiRegion, VoronoiResult } from './VoronoiEngine'
import { buildHeightGrid, rasterizeToPlatforms } from './VoronoiRasterizer'
import { generateP1Points, assignResourcesFromZones } from './ElementDistributor'
import type { SeedRole, SeedHint } from './ElementDistributor'
import { generateRamps } from './PassageGenerator'
import { classifyZones, buildZoneGrid, generateAutoTrenches } from './ZoneClassifier'
import type { ZoneInfo } from './ZoneClassifier'
import type {
  MapBlueprint,
  SpawnPoint,
  BaseResources,
} from '../types'

// ================================================================
// RTSMapConfig — 高层配置接口
// ================================================================

export interface RTSMapConfig {
  name?: string
  mapSize?: number
  width?: number
  height?: number
  resolution?: number
  seed?: number
  heightLevels?: number
  playerCount?: number
  symmetryMode?: SymmetryMode
  lloydIterations?: number
  maxRampsPerRegion?: number
  elevatedRatio?: number
  theme?: 'canyon' | 'volcanic' | 'arctic' | 'badlands'
  cliffVisualHeight?: number

  trenchRatio?: number
  trenchTypeWeights?: { lava: number; water: number; void: number }
  denseBattleIntensity?: number
  corridorWidth?: number
  edgeDecoDensity?: number
  densePacking?: boolean
}

// ================================================================
// 主入口
// ================================================================

export function generateRTSBlueprint(cfg: RTSMapConfig = {}): MapBlueprint {
  const mapSize   = cfg.mapSize ?? 128
  const W         = cfg.width  ?? mapSize
  const H         = cfg.height ?? mapSize
  const resolution = cfg.resolution ?? mapSize * 2
  const seed      = cfg.seed ?? (Date.now() & 0x7fffffff)
  const heightLevels = cfg.heightLevels ?? 3
  const maxCL     = heightLevels - 1
  const symmetry  = cfg.symmetryMode ?? 'rotation_180'
  const lloyd     = cfg.lloydIterations ?? 1
  const elevRatio = cfg.elevatedRatio ?? 0.55
  const cliffVisH = cfg.cliffVisualHeight ?? 2.0
  const maxRamps  = cfg.maxRampsPerRegion ?? 2

  const halfW = W / 2
  const halfH = H / 2
  const edgeDist = Math.min(halfW, halfH) - 8

  const rng = new SeededRandom(seed)

  // ================================================================
  // Phase 1: 种子点位置生成（只有位置 + hint）
  // ================================================================

  const p1Seeds = generateP1Points(edgeDist, rng)

  // P1 → 镜像 P2 → 中心点
  // 构建空的 seedRoles（角色/资源字段待分区后填充）
  const seedRoles: SeedRole[] = []
  const hints: SeedHint[] = []

  for (const pt of p1Seeds) {
    seedRoles.push({
      seed: { x: pt.x, z: pt.z },
      role: 'strategic',  // placeholder
      hasResources: false,
      mineralCount: 0,
      gasCount: 0,
    })
    hints.push(pt.hint)

    const m = mirrorPoint({ x: pt.x, z: pt.z }, symmetry)
    seedRoles.push({
      seed: m,
      role: 'strategic',  // placeholder
      hasResources: false,
      mineralCount: 0,
      gasCount: 0,
    })
    hints.push(pt.hint)
  }

  // 中心点
  seedRoles.push({
    seed: { x: 0, z: 0 },
    role: 'strategic',
    hasResources: false,
    mineralCount: 0,
    gasCount: 0,
  })
  hints.push('any')

  const seeds: Point2D[] = seedRoles.map(sr => sr.seed)

  // ================================================================
  // Phase 2: L1 Voronoi + Lloyd 松弛 + 高度分配
  // ================================================================

  // hint='base' 最远点的索引 → 用于 Lloyd Pinned
  // 先找 P1 中 hint='base' 距中心最远的种子
  let spawnP1Idx = -1
  let maxSpawnDist = -1
  for (let i = 0; i < p1Seeds.length; i++) {
    if (p1Seeds[i].hint === 'base') {
      const d = Math.sqrt(p1Seeds[i].x ** 2 + p1Seeds[i].z ** 2)
      if (d > maxSpawnDist) {
        maxSpawnDist = d
        spawnP1Idx = i
      }
    }
  }

  const mainBaseIndices = new Set<number>()
  if (spawnP1Idx >= 0) {
    mainBaseIndices.add(spawnP1Idx * 2)     // P1
    mainBaseIndices.add(spawnP1Idx * 2 + 1) // P2 mirror
  }

  const voronoiRes = resolution
  const voronoi = buildVoronoi(seeds, W, H, lloyd, mainBaseIndices, voronoiRes)
  const { regions } = voronoi

  // ── 高度分配 ──
  const heightRng = new SeededRandom(seed ^ 0xBEEF)
  const pairCount = p1Seeds.length
  const nonMainPairs: number[] = []

  for (let p = 0; p < pairCount; p++) {
    if (mainBaseIndices.has(p * 2)) {
      if (p * 2 < regions.length) regions[p * 2].height = maxCL
      if (p * 2 + 1 < regions.length) regions[p * 2 + 1].height = maxCL
    } else {
      nonMainPairs.push(p)
    }
  }

  const cl1Count = Math.round(nonMainPairs.length * elevRatio)
  const heightSlots: number[] = nonMainPairs.map((_, i) => i < cl1Count ? 1 : 0)
  for (let i = heightSlots.length - 1; i > 0; i--) {
    const j = heightRng.nextInt(i + 1)
    ;[heightSlots[i], heightSlots[j]] = [heightSlots[j], heightSlots[i]]
  }
  for (let k = 0; k < nonMainPairs.length; k++) {
    const p = nonMainPairs[k]
    const cl = heightSlots[k]
    if (p * 2 < regions.length) regions[p * 2].height = cl
    if (p * 2 + 1 < regions.length) regions[p * 2 + 1].height = cl
  }

  const centerIdx = regions.length - 1
  if (centerIdx >= 0) {
    regions[centerIdx].height = heightRng.next() < elevRatio ? 1 : 0
  }

  // ================================================================
  // Phase 3: 功能分区规划 (Zone-First 核心)
  // ================================================================

  const zones = classifyZones(regions, hints)

  // ================================================================
  // Phase 4: 资源分配（根据分区回填 seedRoles）
  // ================================================================

  assignResourcesFromZones(seedRoles, zones)

  // 更新 region.type 以便下游系统（如坡道生成）使用
  for (let i = 0; i < regions.length; i++) {
    const sr = seedRoles[i]
    if (!sr) continue
    const reg = regions[i]
    if (sr.role === 'main_base') reg.type = 'main_base'
    else if (sr.role === 'expansion') reg.type = 'expansion'
    else if (sr.role === 'resource') reg.type = 'natural'
    else if (sr.role === 'strategic') reg.type = 'center'
    else if (sr.role === 'road_node') reg.type = 'flank'
    else reg.type = 'wasteland'
  }

  // ================================================================
  // Phase 5: 坡道 + 高度网格 + 出生点 + 基地资源 + 沟壑
  // ================================================================

  // ── 5a: 坡道生成 ──
  const ramps = generateRamps(voronoi, zones, W, H, cliffVisH, maxRamps)

  // ── 5b: 高度网格 ──
  const heightGrid = buildHeightGrid(voronoi.ownership, regions, voronoiRes)
  const platforms = rasterizeToPlatforms(heightGrid, voronoiRes, W, H, cliffVisH)

  // ── 5c: 出生点 + 基地资源 ──
  const spawnPoints: SpawnPoint[] = []
  const bases: BaseResources[] = []

  // 从 zones 找出生点
  const spawnZoneIndices = zones
    .map((z, i) => z.type === 'spawn_zone' ? i : -1)
    .filter(i => i >= 0)

  for (let si = 0; si < spawnZoneIndices.length; si++) {
    const idx = spawnZoneIndices[si]
    const reg = regions[idx]
    const sr = seedRoles[idx]
    spawnPoints.push({
      x: reg.cx,
      z: reg.cz,
      playerId: si,
      facing: si === 0 ? Math.PI / 4 : -Math.PI * 3 / 4,
    })
    bases.push(_buildBaseResources(reg.cx, reg.cz, sr.mineralCount, sr.gasCount))
  }

  // 矿区基地资源
  for (let i = 0; i < zones.length; i++) {
    if (zones[i].type !== 'mineral_zone') continue
    const sr = seedRoles[i]
    if (!sr || !sr.hasResources) continue
    const reg = regions[i]
    bases.push(_buildBaseResources(reg.cx, reg.cz, sr.mineralCount, sr.gasCount))
  }

  // ── 5d: 分区网格 + 沟壑 ──
  const zoneGrid = buildZoneGrid(voronoi.ownership, zones, voronoiRes, W, H, ramps)

  const tempBp: MapBlueprint = {
    name: '', width: W, height: H, resolution, maxHeight: 0,
    platforms: [], circles: [], cliffWalls: [], ramps,
    spawnPoints, bases, edgeDist,
  }

  const trenchRatio = cfg.trenchRatio ?? 0.08
  const autoTrenches = trenchRatio > 0
    ? generateAutoTrenches(zones, regions, voronoi, tempBp, seed, {
        trenchRatio,
        trenchTypeWeights: cfg.trenchTypeWeights,
      })
    : []

  // ================================================================
  // 组装 MapBlueprint
  // ================================================================

  return {
    name: cfg.name ?? `RTS Map (seed=${seed})`,
    width: W,
    height: H,
    resolution,
    maxHeight: maxCL * cliffVisH + 4,
    cliffVisualHeight: cliffVisH,
    baseCliffLevel: 0,
    platforms: [],
    circles: [],
    cliffWalls: [],
    pillars: [],
    ramps,
    spawnPoints,
    bases,
    edgeDist,
    noiseAmplitude: 0.04,
    trenches: autoTrenches,
    heightGrid,
    heightGridRes: voronoiRes,
    _zoneGrid: zoneGrid,
    _zoneGridRes: voronoiRes,
    _zones: zones,
    _advancedConfig: {
      denseBattleIntensity: cfg.denseBattleIntensity ?? 1.0,
      corridorWidth: cfg.corridorWidth ?? 4,
      edgeDecoDensity: cfg.edgeDecoDensity ?? 1.0,
      densePacking: cfg.densePacking ?? false,
    },
  } as MapBlueprint
}

// ── 辅助：构建基地资源配置 ──

function _buildBaseResources(
  cx: number, cz: number,
  mineralCount: number,
  gasCount: number,
): BaseResources {
  const arcOffset = mineralCount > 6 ? 7 : 6
  const geysers: Array<{ x: number; z: number; amount: number }> = []

  for (let g = 0; g < gasCount; g++) {
    const angle = (g === 0 ? -0.5 : 0.5) * Math.PI / 3 + Math.atan2(-cz, -cx)
    geysers.push({
      x: cx + Math.cos(angle) * 8,
      z: cz + Math.sin(angle) * 8,
      amount: 2500,
    })
  }

  return {
    ccX: cx,
    ccZ: cz,
    mineralArcX: cx - Math.sign(cx || -1) * arcOffset,
    mineralArcZ: cz - Math.sign(cz || -1) * (arcOffset * 0.7),
    mineralCount,
    mineralRadius: mineralCount > 6 ? 5 : 4,
    mineralAmount: 1500,
    geysers,
  }
}

// ── 向后兼容 ──
export { generateRTSBlueprint as generateProceduralBlueprint }

/** @deprecated 请使用 RTSMapConfig */
export type ProceduralMapConfig = RTSMapConfig
