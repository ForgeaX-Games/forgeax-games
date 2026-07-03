/**
 * 高度分配器
 *
 * 输入：ZoneOwnershipGrid + PlacedZone[]（含 height 字段）
 * 输出：HeightGrid — 每个格子的最终高度值
 *
 * 规则：
 *   1. 每个格子继承其所属区域的 cliff level (0/1/2)，映射为世界高度
 *   2. 区域边界处做短坡过渡（2~3 格宽），不是整条路做长坡
 *   3. 道路格子强制平坦（取两端区域中较低的高度）
 *   4. 区域内部叠加微噪声（±0.3 世界单位），让地面不完全平
 */

import type { PlacedZone } from './ZoneGraph'
import type { ZoneOwnershipGrid } from './ZoneShapeAssigner'
import { ROLE_ROAD, ROLE_SPINE, ROLE_BORDER } from './ZoneShapeAssigner'

// ── 输出 ──

export interface HeightGrid {
  /** res × res 的 Float32Array，存储世界高度 */
  data: Float32Array
  res: number
  mapWidth: number
  mapHeight: number
}

const CLIFF_STEP = 1.5
const SLOPE_RADIUS = 2
const MICRO_NOISE_AMP = 0.15

// ── 主函数 ──

export function assignHeights(
  grid: ZoneOwnershipGrid,
  zones: PlacedZone[],
  seed: number = 42,
): HeightGrid {
  const { ownership, roles, res, mapWidth, mapHeight } = grid
  const data = new Float32Array(res * res)

  // Phase 1: 基础高度 — 每格继承区域 cliff level
  for (let i = 0; i < res * res; i++) {
    const zoneIdx = ownership[i]
    if (zoneIdx >= 0 && zoneIdx < zones.length) {
      data[i] = zones[zoneIdx].height * CLIFF_STEP
    }
  }

  // Phase 2: 边界短坡过渡
  // 找到所有边界格子，然后在它们周围 SLOPE_RADIUS 范围内做线性插值
  const borderCells: { row: number; col: number; h: number; neighborH: number }[] = []

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      if (roles[row * res + col] !== ROLE_BORDER) continue
      const a = ownership[row * res + col]
      if (a < 0) continue
      const hA = zones[a].height

      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
        const nr = row + dr, nc = col + dc
        if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
        const b = ownership[nr * res + nc]
        if (b < 0 || b === a) continue
        const hB = zones[b].height
        if (hA !== hB) {
          borderCells.push({ row, col, h: hA * CLIFF_STEP, neighborH: hB * CLIFF_STEP })
        }
      }
    }
  }

  // 对每个高度差边界，在附近格子做短坡
  for (const bc of borderCells) {
    const midH = (bc.h + bc.neighborH) / 2
    for (let dr = -SLOPE_RADIUS; dr <= SLOPE_RADIUS; dr++) {
      for (let dc = -SLOPE_RADIUS; dc <= SLOPE_RADIUS; dc++) {
        const r = bc.row + dr, c = bc.col + dc
        if (r < 0 || r >= res || c < 0 || c >= res) continue
        const idx = r * res + c
        const role = roles[idx]
        if (role === ROLE_ROAD || role === ROLE_SPINE) continue

        const dist = Math.abs(dr) + Math.abs(dc)
        if (dist > SLOPE_RADIUS) continue

        const t = dist / (SLOPE_RADIUS + 1)
        const zoneIdx = ownership[idx]
        if (zoneIdx < 0) continue
        const baseH = zones[zoneIdx].height * CLIFF_STEP
        data[idx] = baseH + (midH - baseH) * (1 - t) * 0.6
      }
    }
  }

  // Phase 3: 道路强制平坦
  // 道路格子取所属区域的高度（不受坡道影响）
  for (let i = 0; i < res * res; i++) {
    const role = roles[i]
    if (role === ROLE_ROAD || role === ROLE_SPINE) {
      const zoneIdx = ownership[i]
      if (zoneIdx >= 0 && zoneIdx < zones.length) {
        data[i] = zones[zoneIdx].height * CLIFF_STEP
      }
    }
  }

  // Phase 4: 区域内部微噪声
  // 简单的确定性噪声，基于格子坐标和 seed
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const idx = row * res + col
      const role = roles[idx]
      if (role === ROLE_ROAD || role === ROLE_SPINE || role === ROLE_BORDER) continue

      const noise = _deterministicNoise(col, row, seed) * MICRO_NOISE_AMP
      data[idx] += noise
    }
  }

  return { data, res, mapWidth, mapHeight }
}

function _deterministicNoise(x: number, z: number, seed: number): number {
  let h = seed ^ (x * 374761393) ^ (z * 668265263)
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return ((h & 0xffff) / 0xffff) * 2 - 1
}
