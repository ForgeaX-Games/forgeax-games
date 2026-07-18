/**
 * 元素分布器
 *
 * 职责：
 *   1. 密度驱动的种子点位置生成（只生成位置，不分配角色和资源）
 *   2. 边界卡口石柱（Border Choke Pillars）
 *
 * Zone-First 流程：
 *   Phase 1: generateP1Points → 只返回位置 + hint
 *   Phase 2: Voronoi + 高度
 *   Phase NEW: classifyZones → 基于地形/位置划分功能分区
 *   Phase NEW2: assignResourcesFromZones → 根据分区回填角色和资源
 */

import type { SeededRandom } from './SeededRandom'
import type { VoronoiRegion, VoronoiResult } from './VoronoiEngine'
import type { ZoneInfo } from './ZoneClassifier'
import type { Pillar, RampDef } from '../types'
import type { Point2D } from './SymmetryFramework'
import { findBorderMidpoint } from './VoronoiEngine'

// ── 种子点 hint（位置偏好提示，不决定最终角色） ──

export type SeedHint = 'base' | 'resource' | 'any'

export interface SeedPoint {
  x: number
  z: number
  hint: SeedHint
}

// ── 游戏点角色（由分区规划阶段决定） ──

export type PointRole = 'main_base' | 'expansion' | 'resource' | 'strategic' | 'road_node'

/** @deprecated 保留旧接口兼容，新代码不应使用 role/resources 字段 */
export interface GameplayPoint {
  x: number
  z: number
  role: PointRole
  hasResources: boolean
  mineralCount?: number
  gasCount?: number
}

export interface SeedRole {
  seed: Point2D
  role: PointRole
  hasResources: boolean
  mineralCount: number
  gasCount: number
}

// ── 密度参数 ──

const AREA_PER_POINT = 200
const MIN_SPACING = 7

/**
 * 固定核心点（P1 半区）
 * hint='base' 表示偏好作为基地位置，hint='resource' 表示偏好作为资源区
 */
const CORE_SEEDS: SeedPoint[] = [
  { x: -32, z: -33, hint: 'base' },
  { x: -24, z: -32, hint: 'resource' },
  { x: -18, z: -27, hint: 'resource' },
]

/** 动态填充的 hint 权重 — 大部分为 'any'，只有少量 'resource' */
const FILL_HINTS: { hint: SeedHint; weight: number }[] = [
  { hint: 'resource', weight: 1 },
  { hint: 'any',      weight: 5 },
]

// ================================================================
// 1. Density-Driven Seed Point Generation
// ================================================================

/**
 * 在 P1 半区生成种子点位置
 *
 * 只返回位置和 hint，不分配角色和资源。
 * 角色和资源由后续的分区规划阶段决定。
 */
export function generateP1Points(
  edgeDist: number,
  rng: SeededRandom,
): SeedPoint[] {
  const safeMax = edgeDist - 15
  const MARGIN = 4

  const points: SeedPoint[] = CORE_SEEDS.map(p => ({
    ...p,
    x: Math.max(-safeMax, Math.min(safeMax, p.x)),
    z: Math.max(-safeMax, Math.min(safeMax, p.z)),
  }))

  const usableArea = edgeDist * edgeDist
  const targetExtra = Math.max(0, Math.round(usableArea / AREA_PER_POINT) - CORE_SEEDS.length)

  const placed: Point2D[] = []
  for (const p of points) {
    placed.push({ x: p.x, z: p.z })
    placed.push({ x: -p.x, z: -p.z })
  }

  const hintPool: SeedHint[] = []
  for (const fh of FILL_HINTS) {
    for (let w = 0; w < fh.weight; w++) hintPool.push(fh.hint)
  }

  const CENTER_REPEL = edgeDist * 0.2

  for (let i = 0; i < targetExtra; i++) {
    const hint = hintPool[i % hintPool.length]

    let bestX = 0, bestZ = 0, bestMinD = 0

    for (let attempt = 0; attempt < 60; attempt++) {
      const px = rng.nextFloat(-edgeDist + MARGIN, edgeDist - MARGIN)
      const pz = rng.nextFloat(-edgeDist + MARGIN, edgeDist - MARGIN)

      if (px + pz >= 0) continue

      let minD = Infinity
      for (const p of placed) {
        const d = Math.sqrt((px - p.x) ** 2 + (pz - p.z) ** 2)
        if (d < minD) minD = d
      }

      const distToCenter = Math.sqrt(px * px + pz * pz)
      if (distToCenter < CENTER_REPEL) {
        minD *= distToCenter / CENTER_REPEL
      }

      if (minD > bestMinD) { bestMinD = minD; bestX = px; bestZ = pz }
    }

    if (bestMinD >= MIN_SPACING) {
      points.push({ x: bestX, z: bestZ, hint })
      placed.push({ x: bestX, z: bestZ })
      placed.push({ x: -bestX, z: -bestZ })
    }
  }

  return points
}

// ================================================================
// 2. Resource Assignment from Zones (Zone-First)
// ================================================================

/**
 * 根据分区类型回填 seedRoles 的角色和资源字段
 *
 * 这是 Zone-First 流程的核心：分区规划完成后，
 * 根据每个区域被划分为什么功能来决定放什么资源。
 */
export function assignResourcesFromZones(
  seedRoles: SeedRole[],
  zones: ZoneInfo[],
): void {
  for (let i = 0; i < seedRoles.length && i < zones.length; i++) {
    const zone = zones[i]
    const sr = seedRoles[i]

    switch (zone.type) {
      case 'spawn_zone':
        sr.role = 'main_base'
        sr.hasResources = true
        sr.mineralCount = 8
        sr.gasCount = 2
        break
      case 'mineral_zone':
        sr.role = 'expansion'
        sr.hasResources = true
        sr.mineralCount = 6
        sr.gasCount = 1
        break
      case 'corridor':
        sr.role = 'road_node'
        sr.hasResources = false
        sr.mineralCount = 0
        sr.gasCount = 0
        break
      case 'dense_battle':
      case 'open_battle':
        sr.role = 'strategic'
        sr.hasResources = false
        sr.mineralCount = 0
        sr.gasCount = 0
        break
      default:
        sr.role = 'strategic'
        sr.hasResources = false
        sr.mineralCount = 0
        sr.gasCount = 0
        break
    }
  }
}

// ================================================================
// 3. Border Choke Pillars
// ================================================================

/**
 * 在同高度 CL1 区域边界处生成石柱对
 *
 * 使用 zones 而非 seedRoles.role 来判断走廊区域。
 */
export function buildBorderChokes(
  regions: VoronoiRegion[],
  voronoi: VoronoiResult,
  zones: ZoneInfo[],
  mapWidth: number,
  mapHeight: number,
  edgeDist: number,
  existingRamps: RampDef[],
): Pillar[] {
  const pillars: Pillar[] = []
  const { ownership, voronoiRes } = voronoi

  const rampCenters = existingRamps.map(r => ({
    x: (r.ax + r.bx) / 2,
    z: (r.az + r.bz) / 2,
    clearR: r.width + 3,
  }))

  for (const reg of regions) {
    for (const nIdx of reg.neighbors) {
      if (nIdx <= reg.id) continue

      const neighbor = regions[nIdx]

      if (reg.height !== neighbor.height) continue
      if (reg.height === 0) continue

      // 跳过走廊区域
      const regZone = zones[reg.id]?.type
      const nZone = zones[nIdx]?.type
      if (regZone === 'corridor' || nZone === 'corridor') continue

      const borderMid = findBorderMidpoint(
        reg.id, nIdx,
        ownership, voronoiRes,
        mapWidth, mapHeight,
      )
      if (!borderMid) continue

      if (Math.max(Math.abs(borderMid.x), Math.abs(borderMid.z)) > edgeDist - 3) continue

      if (rampCenters.some(rc =>
        Math.sqrt((borderMid.x - rc.x) ** 2 + (borderMid.z - rc.z) ** 2) < rc.clearR
      )) continue

      const dx = neighbor.cx - reg.cx
      const dz = neighbor.cz - reg.cz
      const len = Math.sqrt(dx * dx + dz * dz)
      if (len < 2) continue

      const perpX = -dz / len
      const perpZ = dx / len

      for (const side of [-1, 1] as const) {
        pillars.push({
          x: borderMid.x + perpX * 2.0 * side,
          z: borderMid.z + perpZ * 2.0 * side,
          r: 1.0,
        })
        pillars.push({
          x: borderMid.x + perpX * 3.5 * side,
          z: borderMid.z + perpZ * 3.5 * side,
          r: 0.6,
        })
      }
    }
  }

  return pillars
}
