/**
 * 通道生成器 — 标准化 45° 坡道
 *
 * 关键约束（来自 alg_starcraft_terrain）：
 *   1. 只允许 4 个方向：NE / NW / SE / SW（各 45°）
 *   2. 只有 2 种规格：NARROW (3wu) 和 WIDE (5wu)
 *      - 每个主矿区恰好 1 条 WIDE 坡道（主出口）
 *      - 其余全部 NARROW
 *   3. MIN_RAMP_SPACING = 10wu（任意两条坡道中心点之间最小距离）
 *   4. maxRampsPerRegion = 2（每个高地区域最多 2 个出口）
 *   5. 连通性验证：若区域不连通，自动补充连接坡道
 *
 * 坡道定义（RampDef）：
 *   ax, az → 坡道 A 端（hA 高度侧）
 *   bx, bz → 坡道 B 端（hB 高度侧）
 *   方向向量从 A 指向 B，角度 snap 到最近的 45° 方向
 */

import type { VoronoiRegion, VoronoiResult } from './VoronoiEngine'
import type { RampDef } from '../types'
import type { ZoneInfo } from './ZoneClassifier'
import { findBorderMidpoint } from './VoronoiEngine'

// ── 常量 ──

const INV_SQRT2 = 1 / Math.sqrt(2)

/** 唯一允许的 4 个坡道方向 */
const DIAG_DIRS = [
  { dx:  INV_SQRT2, dz: -INV_SQRT2, name: 'NE' },
  { dx: -INV_SQRT2, dz: -INV_SQRT2, name: 'NW' },
  { dx:  INV_SQRT2, dz:  INV_SQRT2, name: 'SE' },
  { dx: -INV_SQRT2, dz:  INV_SQRT2, name: 'SW' },
] as const

interface RampSpec {
  /** 视觉半宽（世界单位） */
  width: number
  /** 通行半宽（世界单位） */
  pathWidth: number
  /** 从边界中点到 A/B 端的半长 */
  halfLen: number
}

/** 标准窄坡道 — 普通坡道 */
const NARROW_RAMP: RampSpec = { width: 3, pathWidth: 2, halfLen: 3 }
/** 标准宽坡道 — 主矿主出口（每个主矿仅 1 条） */
const WIDE_RAMP: RampSpec   = { width: 5, pathWidth: 3, halfLen: 4 }

/** 任意两条坡道中心点之间的最小距离 */
const MIN_RAMP_SPACING = 10

/** 每个高地区域最多 2 个坡道出口 */
const MAX_RAMPS_PER_REGION = 2

// ── 工具函数 ──

/** 将任意方向向量 snap 到最近的 45° 对角方向 */
function snapToDiagonal(dx: number, dz: number): { dx: number; dz: number } {
  let bestDot = -Infinity
  let best: typeof DIAG_DIRS[number] = DIAG_DIRS[0]
  for (const d of DIAG_DIRS) {
    const dot = dx * d.dx + dz * d.dz
    if (dot > bestDot) { bestDot = dot; best = d }
  }
  return { dx: best.dx, dz: best.dz }
}

// ================================================================
// Main: Generate Ramps
// ================================================================

/**
 * 生成标准化坡道列表
 *
 * @param voronoi       Voronoi 结果（regions + ownership）
 * @param zones         功能分区信息（Zone-First）
 * @param mapWidth      地图宽度
 * @param mapHeight     地图高度
 * @param cliffVisH     每个 cliff level 的视觉高度
 * @param maxRampsPerRegion  每区域最大坡道数（默认 2）
 */
export function generateRamps(
  voronoi: VoronoiResult,
  zones: ZoneInfo[],
  mapWidth: number,
  mapHeight: number,
  cliffVisH: number = 2.0,
  maxRampsPerRegion: number = MAX_RAMPS_PER_REGION,
): RampDef[] {
  const { regions, ownership, voronoiRes } = voronoi
  const ramps: RampDef[] = []
  const placedCenters: { x: number; z: number }[] = []
  const regionRampCount = new Map<number, number>()
  const mainBaseWideUsed = new Set<number>()

  interface RampCandidate {
    reg: VoronoiRegion
    neighbor: VoronoiRegion
    borderMid: { x: number; z: number }
    priority: number
  }

  const candidates: RampCandidate[] = []

  for (const reg of regions) {
    if (reg.height === 0) continue
    for (const nIdx of reg.neighbors) {
      const neighbor = regions[nIdx]
      if (neighbor.height >= reg.height) continue

      const borderMid = findBorderMidpoint(
        reg.id, nIdx,
        ownership, voronoiRes,
        mapWidth, mapHeight,
      )
      if (!borderMid) continue

      // Priority from zone type: spawn_zone > mineral_zone > others
      const zoneType = zones[reg.id]?.type ?? 'none'
      const priority = zoneType === 'spawn_zone' ? 0
        : zoneType === 'mineral_zone' ? 1
        : 2

      candidates.push({ reg, neighbor, borderMid, priority })
    }
  }

  candidates.sort((a, b) => a.priority - b.priority)

  for (const cand of candidates) {
    const { reg, neighbor, borderMid } = cand

    const regCount = regionRampCount.get(reg.id) ?? 0
    const neiCount = regionRampCount.get(neighbor.id) ?? 0
    if (regCount >= maxRampsPerRegion && neiCount >= maxRampsPerRegion) continue

    const tooClose = placedCenters.some(c =>
      Math.sqrt((borderMid.x - c.x) ** 2 + (borderMid.z - c.z) ** 2) < MIN_RAMP_SPACING
    )
    if (tooClose) continue

    const rawDx = neighbor.cx - reg.cx
    const rawDz = neighbor.cz - reg.cz
    const rawLen = Math.sqrt(rawDx * rawDx + rawDz * rawDz)
    if (rawLen < 2) continue
    const snapped = snapToDiagonal(rawDx / rawLen, rawDz / rawLen)

    // Wide ramp for spawn_zone regions
    const regZone = zones[reg.id]?.type
    const neiZone = zones[neighbor.id]?.type
    const mainId = regZone === 'spawn_zone' ? reg.id
      : neiZone === 'spawn_zone' ? neighbor.id
      : -1
    const canWide = mainId >= 0 && !mainBaseWideUsed.has(mainId)
    const spec = canWide ? WIDE_RAMP : NARROW_RAMP
    if (canWide) mainBaseWideUsed.add(mainId)

    ramps.push({
      ax: borderMid.x - snapped.dx * spec.halfLen,
      az: borderMid.z - snapped.dz * spec.halfLen,
      bx: borderMid.x + snapped.dx * spec.halfLen,
      bz: borderMid.z + snapped.dz * spec.halfLen,
      width: spec.width,
      hA: reg.height * cliffVisH,
      hB: neighbor.height * cliffVisH,
      pathWidth: spec.pathWidth,
    })

    placedCenters.push({ x: borderMid.x, z: borderMid.z })
    regionRampCount.set(reg.id, regCount + 1)
    regionRampCount.set(neighbor.id, neiCount + 1)
  }

  _ensureConnectivity(regions, ramps, voronoi, zones, mapWidth, mapHeight, cliffVisH, placedCenters, regionRampCount, mainBaseWideUsed)

  return ramps
}

/**
 * 连通性验证：对无法从任何坡道到达的高地区域，强制补充 1 条坡道
 */
function _ensureConnectivity(
  regions: VoronoiRegion[],
  ramps: RampDef[],
  voronoi: VoronoiResult,
  zones: ZoneInfo[],
  mapWidth: number,
  mapHeight: number,
  cliffVisH: number,
  placedCenters: { x: number; z: number }[],
  regionRampCount: Map<number, number>,
  mainBaseWideUsed: Set<number>,
): void {
  for (const reg of regions) {
    if (reg.height === 0) continue
    const hasRamp = ramps.some(r => {
      const cx = (r.ax + r.bx) / 2
      const cz = (r.az + r.bz) / 2
      const d = Math.sqrt((cx - reg.cx) ** 2 + (cz - reg.cz) ** 2)
      return d < 25
    })
    if (hasRamp) continue

    for (const nIdx of reg.neighbors) {
      const neighbor = regions[nIdx]
      if (neighbor.height >= reg.height) continue

      const borderMid = findBorderMidpoint(
        reg.id, nIdx,
        voronoi.ownership, voronoi.voronoiRes,
        mapWidth, mapHeight,
      )
      if (!borderMid) continue

      const rawDx = neighbor.cx - reg.cx
      const rawDz = neighbor.cz - reg.cz
      const rawLen = Math.sqrt(rawDx * rawDx + rawDz * rawDz)
      if (rawLen < 2) continue

      const snapped = _snapToDiagonal(rawDx / rawLen, rawDz / rawLen)

      const mainId = zones[reg.id]?.type === 'spawn_zone' ? reg.id : -1
      const canWide = mainId >= 0 && !mainBaseWideUsed.has(mainId)
      const spec = canWide ? WIDE_RAMP : NARROW_RAMP
      if (canWide) mainBaseWideUsed.add(mainId)

      ramps.push({
        ax: borderMid.x - snapped.dx * spec.halfLen,
        az: borderMid.z - snapped.dz * spec.halfLen,
        bx: borderMid.x + snapped.dx * spec.halfLen,
        bz: borderMid.z + snapped.dz * spec.halfLen,
        width: spec.width,
        hA: reg.height * cliffVisH,
        hB: neighbor.height * cliffVisH,
        pathWidth: spec.pathWidth,
      })
      placedCenters.push({ x: borderMid.x, z: borderMid.z })
      break
    }
  }
}

// 局部辅助（避免与模块外导出的 snapToDiagonal 混淆）
function _snapToDiagonal(dx: number, dz: number): { dx: number; dz: number } {
  return snapToDiagonal(dx, dz)
}

