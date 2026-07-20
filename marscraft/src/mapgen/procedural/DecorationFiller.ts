/**
 * 装饰物填充器 — V2 管线
 *
 * 根据 ZoneOwnershipGrid 和 BarrierGrid，在地图上放置装饰物。
 *
 * 填充策略：
 *   1. 障碍物格子（BARRIER_WALL / BARRIER_CLIFF）→ 密集放置岩石/废墟
 *   2. 区域边界（ROLE_BORDER）→ 中等密度岩石
 *   3. wasteland 内部 → 密集填充（岩石/废墟/机械残骸）
 *   4. battlefield 内部 → 稀疏 LOS blocker（岩石/晶体）
 *   5. passage 内部 → 少量路障
 *   6. main_base / expansion 内部 → 极少或无装饰
 *   7. 道路/骨架格子 → 不放装饰
 */

import type { ZoneOwnershipGrid } from './ZoneShapeAssigner'
import { ROLE_INTERIOR, ROLE_BORDER, ROLE_ROAD, ROLE_SPINE } from './ZoneShapeAssigner'
import type { BarrierGrid } from './BarrierGenerator'
import { BARRIER_WALL, BARRIER_CLIFF } from './BarrierGenerator'
import type { DecorationDef } from '../types'
import { SeededRandom } from './SeededRandom'

// ── 配置 ──

type DecoType = 'rock' | 'plant' | 'machinery' | 'crystal' | 'ruins' | 'barricade'

interface ZoneDecoProfile {
  types: DecoType[]
  /** 障碍物格子上的放置概率 */
  barrierDensity: number
  /** 边界格子上的放置概率 */
  borderDensity: number
  /** 内部格子上的放置概率 */
  interiorDensity: number
}

const ZONE_DECO_PROFILES: Record<string, ZoneDecoProfile> = {
  main_base: {
    types: [],
    barrierDensity: 0,
    borderDensity: 0,
    interiorDensity: 0,
  },
  expansion: {
    types: ['rock'],
    barrierDensity: 0,
    borderDensity: 0.05,
    interiorDensity: 0,
  },
  battlefield: {
    types: ['rock', 'crystal', 'ruins'],
    barrierDensity: 0.15,
    borderDensity: 0.08,
    interiorDensity: 0,
  },
  passage: {
    types: ['rock', 'barricade'],
    barrierDensity: 0.12,
    borderDensity: 0.06,
    interiorDensity: 0,
  },
  wasteland: {
    types: ['rock', 'ruins', 'machinery', 'plant'],
    barrierDensity: 0.7,
    borderDensity: 0.5,
    interiorDensity: 0.12,
  },
  anchor: {
    types: ['rock'],
    barrierDensity: 0.3,
    borderDensity: 0.2,
    interiorDensity: 0.02,
  },
}

const DEFAULT_PROFILE: ZoneDecoProfile = {
  types: ['rock'],
  barrierDensity: 0.4,
  borderDensity: 0.25,
  interiorDensity: 0.05,
}

/** 装饰物之间的最小间距（世界单位） */
const MIN_DECO_SPACING = 3.0
/** 每个格子最多检查多少已有装饰物来做间距检查 */
const MAX_PROXIMITY_CHECK = 50

// ── 输出 ──

export interface PlacedDecorations {
  decorations: DecorationDef[]
}

// ── 主函数 ──

export function fillDecorations(
  grid: ZoneOwnershipGrid,
  barriers: BarrierGrid,
  seed: number = 42,
  maxDecoTypes: number = 2,
): PlacedDecorations {
  const rng = new SeededRandom(seed + 555)
  const decorations: DecorationDef[] = []

  const { ownership, roles, cellHeights, res, mapWidth, mapHeight, zones } = grid
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const cellW = mapWidth / res
  const cellH = mapHeight / res

  // 全局限制：从所有区域可用类型中随机选 maxDecoTypes 种，整张地图只用这些
  const allTypes = new Set<DecoType>()
  for (const z of zones) {
    const p = ZONE_DECO_PROFILES[z.type] ?? DEFAULT_PROFILE
    for (const t of p.types) allTypes.add(t)
  }
  const typePool = Array.from(allTypes)
  const globalRng = new SeededRandom(seed + 333)
  // Fisher-Yates shuffle then take first N
  for (let i = typePool.length - 1; i > 0; i--) {
    const j = globalRng.nextInt(i + 1)
    ;[typePool[i], typePool[j]] = [typePool[j], typePool[i]]
  }
  const allowedTypes = typePool.slice(0, Math.max(1, Math.min(maxDecoTypes, typePool.length)))
  const allowedSet = new Set(allowedTypes)

  // 每个区域实例固定选一种主装饰类型（从全局允许列表中选）
  const zoneDecoType = new Map<number, DecoType>()
  for (let i = 0; i < zones.length; i++) {
    const profile = ZONE_DECO_PROFILES[zones[i].type] ?? DEFAULT_PROFILE
    if (profile.types.length === 0) continue
    const filtered = profile.types.filter(t => allowedSet.has(t))
    if (filtered.length === 0) {
      zoneDecoType.set(i, allowedTypes[0])
      continue
    }
    const pick = Math.floor(_hash(i * 7 + 3, i * 13 + 5, seed + 77) * filtered.length)
    zoneDecoType.set(i, filtered[Math.min(pick, filtered.length - 1)])
  }

  let decoId = 0

  for (let row = 1; row < res - 1; row++) {
    for (let col = 1; col < res - 1; col++) {
      const idx = row * res + col
      const role = roles[idx]
      const barrierVal = barriers.data[idx]

      if (role === ROLE_ROAD || role === ROLE_SPINE) continue

      const zoneIdx = ownership[idx]
      if (zoneIdx < 0 || zoneIdx >= zones.length) continue

      const zone = zones[zoneIdx]
      const profile = ZONE_DECO_PROFILES[zone.type] ?? DEFAULT_PROFILE
      if (profile.types.length === 0) continue

      let density = 0
      if (barrierVal === BARRIER_WALL || barrierVal === BARRIER_CLIFF) {
        density = profile.barrierDensity
      } else if (role === ROLE_BORDER) {
        density = profile.borderDensity
      } else if (role === ROLE_INTERIOR) {
        density = profile.interiorDensity
      }

      if (density <= 0) continue

      const roll = _hash(col, row, seed + 7)
      if (roll >= density) continue

      const wx = (col + 0.5) * cellW - halfW
      const wz = (row + 0.5) * cellH - halfH

      let tooClose = false
      const checkStart = Math.max(0, decorations.length - MAX_PROXIMITY_CHECK)
      for (let d = decorations.length - 1; d >= checkStart; d--) {
        const dd = decorations[d]
        const dx = wx - dd.x, dz = wz - dd.z
        if (dx * dx + dz * dz < MIN_DECO_SPACING * MIN_DECO_SPACING) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      const type = zoneDecoType.get(zoneIdx) ?? 'rock'

      const rotation = _hash(col, row, seed + 19) * Math.PI * 2
      const scale = 0.6 + _hash(col + 2, row + 2, seed + 23) * 0.8

      const blocksPathing = true
      const blocksLOS = type === 'rock' || type === 'ruins' || type === 'barricade'

      const r = type === 'rock' ? 1.0 + _hash(col, row, seed + 29) * 0.8
            : type === 'ruins' ? 1.2 + _hash(col, row, seed + 31) * 0.6
            : type === 'barricade' ? 0.8 + _hash(col, row, seed + 37) * 0.4
            : 0.6 + _hash(col, row, seed + 41) * 0.6

      decorations.push({
        id: `deco_${decoId++}`,
        type,
        x: wx + rng.nextFloat(-cellW * 0.3, cellW * 0.3),
        z: wz + rng.nextFloat(-cellH * 0.3, cellH * 0.3),
        r,
        rotation,
        scale,
        blocksPathing,
        blocksLOS,
      })
    }
  }

  // ── 悬崖脚下装饰物：在高低落差的低地侧适当放置岩石 ──
  const CLIFF_FOOT_PROB = 0.25
  const isRamp = grid.isRamp
  for (let row = 2; row < res - 2; row++) {
    for (let col = 2; col < res - 2; col++) {
      const idx = row * res + col
      if (isRamp[idx]) continue
      if (roles[idx] === ROLE_ROAD || roles[idx] === ROLE_SPINE) continue

      const myH = Math.round(cellHeights[idx])
      // 检查四邻是否有更高的格子
      let hasCliffAbove = false
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const ni = (row + dr) * res + (col + dc)
        if (Math.round(cellHeights[ni]) > myH && !isRamp[ni]) {
          hasCliffAbove = true
          break
        }
      }
      if (!hasCliffAbove) continue

      if (_hash(col + 5, row + 5, seed + 61) >= CLIFF_FOOT_PROB) continue

      const wx = (col + 0.5) * cellW - halfW
      const wz = (row + 0.5) * cellH - halfH

      let tooClose = false
      const checkStart = Math.max(0, decorations.length - MAX_PROXIMITY_CHECK)
      for (let d = decorations.length - 1; d >= checkStart; d--) {
        const dd = decorations[d]
        const dx = wx - dd.x, dz = wz - dd.z
        if (dx * dx + dz * dz < MIN_DECO_SPACING * MIN_DECO_SPACING) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      decorations.push({
        id: `deco_${decoId++}`,
        type: 'rock',
        x: wx + rng.nextFloat(-cellW * 0.2, cellW * 0.2),
        z: wz + rng.nextFloat(-cellH * 0.2, cellH * 0.2),
        r: 0.8 + _hash(col, row, seed + 63) * 0.6,
        rotation: _hash(col, row, seed + 65) * Math.PI * 2,
        scale: 0.5 + _hash(col + 1, row + 1, seed + 67) * 0.5,
        blocksPathing: true,
        blocksLOS: true,
      })
    }
  }

  return { decorations }
}

function _hash(x: number, z: number, seed: number): number {
  let h = seed ^ (x * 374761393) ^ (z * 668265263)
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return (h & 0xffff) / 0xffff
}
