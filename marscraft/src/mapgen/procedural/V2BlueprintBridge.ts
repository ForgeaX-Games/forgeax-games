/**
 * V2 → V1 桥接层
 *
 * 将 V2 管线的输出（ZoneOwnershipGrid + BarrierGrid + PlacedResources）
 * 转换为 V1 的 MapBlueprint，然后调用 terrainGen 7-Pass 管线生成最终 MapConfig。
 *
 * 转换映射：
 *   cellHeights (int cliff level)  → heightGrid (Int8Array)
 *   spineRamps (RampDef[])         → ramps (直接使用骨架路径生成的坡道)
 *   PlacedResources                → BaseResources[] + SpawnPoint[]
 *   PlacedZone(main_base)          → SpawnPoint[]
 */

import type { MapBlueprint, MapConfig, SpawnPoint, BaseResources, DecorationDef, TrenchDef } from '../types'
import type { ZoneOwnershipGrid } from './ZoneShapeAssigner'
import type { BarrierGrid } from './BarrierGenerator'
import type { PlacedResources } from './ResourcePlacer'
import type { PlacedZone } from './ZoneGraph'
import { generateTerrain } from '../terrainGen'

const CLIFF_VISUAL_HEIGHT = 2.0

export interface V2BridgeInput {
  grid: ZoneOwnershipGrid
  barriers: BarrierGrid
  resources: PlacedResources
  /** V2 管线生成的装饰物（位置准确，基于区域/道路/骨架），由 V1 terrainGen 按此渲染 */
  decorations?: DecorationDef[]
  /** V2 管线生成的沟壑（沿 wasteland 边界连贯放置），由 V1 terrainGen 光栅化 */
  trenches?: TrenchDef[]
  mapName?: string
  maxHeight?: number
  /** 地形纹理主题 */
  theme?: string
}

/**
 * 将 V2 管线输出转换为最终 MapConfig
 */
export function buildMapConfigFromV2(input: V2BridgeInput): MapConfig {
  const bp = buildBlueprintFromV2(input)
  const terrain = generateTerrain(bp)

  const minerals = input.resources.minerals
  const geysers = input.resources.geysers

  return {
    name: bp.name,
    width: bp.width,
    height: bp.height,
    gridResolution: bp.resolution,
    heightData: terrain.heightData,
    terrainTypes: terrain.terrainTypes,
    cliffLevels: terrain.cliffLevels,
    pathingGrid: terrain.pathingGrid,
    cliffEdges: terrain.cliffEdges,
    spawnPoints: [...bp.spawnPoints],
    minerals,
    geysers,
    maxHeight: bp.maxHeight,
    decorations: terrain.decorations,
    trenchGrid: terrain.trenchGrid,
    borderGrid: terrain.borderGrid,
    edgeDist: terrain.edgeDist,
    theme: input.theme,
  }
}

/**
 * 将 V2 管线输出转换为 MapBlueprint（可被 terrainGen 7-Pass 消费）
 */
export function buildBlueprintFromV2(input: V2BridgeInput): MapBlueprint {
  const { grid, resources } = input
  const { cellHeights, isRamp, res, mapWidth, mapHeight, zones, ownership } = grid
  const maxHeight = input.maxHeight ?? 2

  // ── 1. heightGrid: cellHeights → Int8Array ──
  const heightGrid = new Int8Array(res * res)
  for (let i = 0; i < res * res; i++) {
    heightGrid[i] = Math.round(cellHeights[i])
  }

  // ── 2. Ramps: 直接使用骨架路径生成的坡道 ──
  const ramps = grid.spineRamps ?? []
  console.log(`[V2Bridge] using ${ramps.length} spine ramps`)
  for (const r of ramps) {
    console.log(`[V2Bridge] ramp A=(${r.ax.toFixed(1)},${r.az.toFixed(1)}) B=(${r.bx.toFixed(1)},${r.bz.toFixed(1)}) w=${r.width.toFixed(1)} hA=${r.hA} hB=${r.hB}`)
  }

  // ── 3. SpawnPoints + BaseResources: 从 zones + resources 提取 ──
  const spawnPoints: SpawnPoint[] = []
  const bases: BaseResources[] = []

  const mainBases = zones.filter(z => z.type === 'main_base')
  for (let pi = 0; pi < mainBases.length; pi++) {
    const mb = mainBases[pi]
    spawnPoints.push({
      x: mb.cx,
      z: mb.cz,
      playerId: pi + 1,
      facing: Math.atan2(-mb.cz, -mb.cx),
    })

    const baseRes = _buildBaseResources(mb, resources, zones)
    bases.push(baseRes)
  }

  // Expansion bases
  const expansions = zones.filter(z => z.type === 'expansion')
  for (const exp of expansions) {
    const baseRes = _buildBaseResources(exp, resources, zones)
    bases.push(baseRes)
  }

  // ── 4. edgeDist ──
  const edgeDist = Math.min(mapWidth, mapHeight) / 2 - 8

  return {
    name: input.mapName ?? 'V2 Generated Map',
    width: mapWidth,
    height: mapHeight,
    resolution: res,
    maxHeight,
    baseCliffLevel: 0,
    cliffVisualHeight: CLIFF_VISUAL_HEIGHT,
    platforms: [],
    circles: [],
    cliffWalls: [],
    ramps,
    spawnPoints,
    bases,
    edgeDist,
    noiseAmplitude: 0.04,
    heightGrid,
    heightGridRes: res,
    precomputedMinerals: resources.minerals,
    precomputedGeysers: resources.geysers,
    decorations: input.decorations,
    trenches: input.trenches,
    theme: input.theme,
  }
}


// ── BaseResources 构建 ──

function _buildBaseResources(
  zone: PlacedZone,
  resources: PlacedResources,
  allZones: PlacedZone[],
): BaseResources {
  const r = zone.radius
  const rSq = (r * 1.5) * (r * 1.5)

  // Find minerals and geysers within this zone's influence area
  const zoneMinerals = resources.minerals.filter(m => {
    const dx = m.x - zone.cx, dz = m.z - zone.cz
    return dx * dx + dz * dz < rSq
  })
  const zoneGeysers = resources.geysers.filter(g => {
    const dx = g.x - zone.cx, dz = g.z - zone.cz
    return dx * dx + dz * dz < rSq
  })

  // Mineral arc center: centroid of zone's minerals, or offset from zone center
  let mineralArcX = zone.cx
  let mineralArcZ = zone.cz
  if (zoneMinerals.length > 0) {
    mineralArcX = zoneMinerals.reduce((s, m) => s + m.x, 0) / zoneMinerals.length
    mineralArcZ = zoneMinerals.reduce((s, m) => s + m.z, 0) / zoneMinerals.length
  } else {
    const outDir = Math.atan2(zone.cz, zone.cx)
    mineralArcX = zone.cx + Math.cos(outDir) * r * 0.65
    mineralArcZ = zone.cz + Math.sin(outDir) * r * 0.65
  }

  return {
    ccX: zone.cx,
    ccZ: zone.cz,
    mineralArcX,
    mineralArcZ,
    mineralCount: zoneMinerals.length || (zone.type === 'main_base' ? 8 : 6),
    mineralRadius: 5.5,
    mineralAmount: 1500,
    geysers: zoneGeysers.length > 0
      ? zoneGeysers.map(g => ({ x: g.x, z: g.z, amount: g.amount }))
      : [{ x: zone.cx + r * 0.5, z: zone.cz + r * 0.3, amount: 2500 }],
  }
}
