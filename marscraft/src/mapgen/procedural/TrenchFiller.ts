/**
 * 沟壑填充器 — V2 管线
 *
 * 在 wasteland 区域边界和地图边缘生成连贯的带状裂缝/沟壑。
 *
 * 算法：
 *   1. 扫描 ZoneOwnershipGrid，收集 wasteland 与其他区域的边界格子
 *   2. BFS 提取连通分量（边界链）
 *   3. 链排序：nearest-neighbor 使格子沿空间路径有序
 *   4. 概率选择：部分链被选中放置沟壑
 *   5. Catmull-Rom 平滑 → 世界坐标路径
 *   6. 沿路径密集采样，每点生成 TrenchDef（小半径，重叠形成连贯带）
 *   7. 安全检查：避开基地、坡道、道路
 *
 * 输出 TrenchDef[] 直接交给 V2BlueprintBridge → V1 terrainGen 渲染。
 */

import type { ZoneOwnershipGrid } from './ZoneShapeAssigner'
import { ROLE_ROAD, ROLE_SPINE } from './ZoneShapeAssigner'
import type { BarrierGrid } from './BarrierGenerator'
import type { TrenchDef } from '../types'
import { SeededRandom } from './SeededRandom'

// ── 配置 ──

interface TrenchFillConfig {
  /** wasteland 与非 wasteland 边界链的选中概率 */
  crossTypeProb: number
  /** wasteland 与 wasteland 边界链的选中概率（低得多） */
  sameTypeProb: number
  /** 地图边缘边界链的选中概率 */
  mapEdgeProb: number
  /** 最短链长度（格子数），短于此的直接跳过 */
  minChainLen: number
  /** 沿路径采样步长（世界单位） */
  stepSize: number
  /** 每个 TrenchDef 的半径 */
  trenchRadius: number
  /** 沟壑深度 */
  depth: 1 | 2 | 3
  /** 视觉类型 */
  type: 'lava' | 'water' | 'void'
  /** 避开基地中心的距离 */
  baseClearance: number
  /** 避开坡道的距离 */
  rampClearance: number
}

const DEFAULT_CONFIG: TrenchFillConfig = {
  crossTypeProb: 0.45,
  sameTypeProb: 0.12,
  mapEdgeProb: 0.5,
  minChainLen: 12,
  stepSize: 2.5,
  trenchRadius: 1.8,
  depth: 1,
  type: 'lava',
  baseClearance: 14,
  rampClearance: 6,
}

const BORDER_CROSS_TYPE = 1
const BORDER_SAME_TYPE = 2
const BORDER_MAP_EDGE = 3

// ── 主函数 ──

export function fillTrenches(
  grid: ZoneOwnershipGrid,
  barriers: BarrierGrid,
  seed: number,
  config: Partial<TrenchFillConfig> = {},
): TrenchDef[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const rng = new SeededRandom(seed ^ 0xBEEF)

  // 每张地图只用一种沟壑类型（随机选择，除非 config 显式指定）
  const TRENCH_TYPES: Array<'lava' | 'water' | 'void'> = ['lava', 'water', 'void']
  const trenchType = config.type ?? TRENCH_TYPES[rng.nextInt(TRENCH_TYPES.length)]

  const { ownership, roles, isRamp, cellHeights, res, mapWidth, mapHeight, zones } = grid
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const cellW = mapWidth / res
  const cellH = mapHeight / res

  // ── Step 1: 收集 wasteland 边界格子，区分边界类型 ──
  // 值: 0=非边界, BORDER_CROSS_TYPE=跨类型, BORDER_SAME_TYPE=wasteland间, BORDER_MAP_EDGE=地图边缘
  const borderCells = new Uint8Array(res * res)
  for (let row = 1; row < res - 1; row++) {
    for (let col = 1; col < res - 1; col++) {
      const idx = row * res + col
      const zIdx = ownership[idx]
      if (zIdx < 0 || zIdx >= zones.length) continue
      if (zones[zIdx].type !== 'wasteland') continue
      if (roles[idx] === ROLE_ROAD || roles[idx] === ROLE_SPINE) continue
      if (isRamp[idx]) continue

      // 地图边缘（距边界 2 格以内）
      if (row <= 2 || row >= res - 3 || col <= 2 || col >= res - 3) {
        borderCells[idx] = BORDER_MAP_EDGE
        continue
      }

      // 四邻中有不同区域的格子
      let borderType = 0
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nr = row + dr, nc = col + dc
        const ni = nr * res + nc
        const nz = ownership[ni]
        if (nz !== zIdx) {
          const nZone = nz >= 0 && nz < zones.length ? zones[nz] : null
          if (nZone && nZone.type === 'wasteland') {
            if (borderType === 0) borderType = BORDER_SAME_TYPE
          } else {
            borderType = BORDER_CROSS_TYPE
            break
          }
        }
      }

      if (borderType > 0) borderCells[idx] = borderType
    }
  }

  // ── Step 2: BFS 提取连通分量 ──
  const visited = new Uint8Array(res * res)
  const chains: { cells: number[]; dominantType: number }[] = []

  for (let row = 1; row < res - 1; row++) {
    for (let col = 1; col < res - 1; col++) {
      const start = row * res + col
      if (!borderCells[start] || visited[start]) continue

      const chain: number[] = []
      const typeCounts = [0, 0, 0, 0] // [unused, cross, same, edge]
      const queue = [start]
      visited[start] = 1
      while (queue.length > 0) {
        const cur = queue.shift()!
        chain.push(cur)
        typeCounts[borderCells[cur]]++
        const cr = (cur / res) | 0, cc = cur % res
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nr = cr + dr, nc = cc + dc
          if (nr < 1 || nr >= res - 1 || nc < 1 || nc >= res - 1) continue
          const ni = nr * res + nc
          if (borderCells[ni] && !visited[ni]) {
            visited[ni] = 1
            queue.push(ni)
          }
        }
      }

      if (chain.length >= cfg.minChainLen) {
        // 链的主要类型：有任何 cross-type 格子就算 cross，否则按多数决定
        const dominantType = typeCounts[BORDER_CROSS_TYPE] > 0
          ? BORDER_CROSS_TYPE
          : typeCounts[BORDER_MAP_EDGE] >= typeCounts[BORDER_SAME_TYPE]
            ? BORDER_MAP_EDGE
            : BORDER_SAME_TYPE
        chains.push({ cells: chain, dominantType })
      }
    }
  }

  // ── Step 3: nearest-neighbor 排序（使链成为空间路径） ──
  const safeZones = new Set(['main_base', 'expansion'])
  const baseCenters = zones.filter(z => safeZones.has(z.type)).map(z => ({ x: z.cx, z: z.cz }))

  const trenches: TrenchDef[] = []

  for (const { cells: chain, dominantType } of chains) {
    // Step 4: 根据边界类型使用不同选中概率
    const prob = dominantType === BORDER_CROSS_TYPE ? cfg.crossTypeProb
               : dominantType === BORDER_MAP_EDGE   ? cfg.mapEdgeProb
               :                                      cfg.sameTypeProb
    const chainHash = _hash(chain[0] % res, (chain[0] / res) | 0, seed + 99)
    if (chainHash >= prob) continue

    // nearest-neighbor ordering
    const ordered = _orderChain(chain, res)

    // Step 5: 转世界坐标 + Catmull-Rom 平滑
    const rawPts: { x: number; z: number }[] = ordered.map(idx => ({
      x: (idx % res + 0.5) * cellW - halfW,
      z: (((idx / res) | 0) + 0.5) * cellH - halfH,
    }))

    // 每 3 个原始点取 1 个控制点，减少噪声
    const controlPts = _subsample(rawPts, 3)
    if (controlPts.length < 3) continue

    const smoothPts = _catmullRomChain(controlPts, cfg.stepSize)
    if (smoothPts.length < 2) continue

    // Step 6: 沿平滑路径采样生成 TrenchDef
    for (const pt of smoothPts) {
      // Step 7: 安全检查
      if (_nearBase(pt.x, pt.z, baseCenters, cfg.baseClearance)) continue
      if (_nearRamp(pt.x, pt.z, grid, cfg.rampClearance, cellW, cellH, halfW, halfH)) continue

      trenches.push({
        x: pt.x,
        z: pt.z,
        r: cfg.trenchRadius,
        depth: cfg.depth,
        type: trenchType,
      })
    }
  }

  return trenches
}

// ── nearest-neighbor 链排序 ──

function _orderChain(cells: number[], res: number): number[] {
  if (cells.length <= 2) return cells

  const used = new Set<number>()
  const result: number[] = []

  // 从端点开始：选择四邻中 border 邻居最少的格子作为起点（大概率是链端点）
  let startIdx = 0
  let minNeighbors = Infinity
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const cr = (c / res) | 0, cc = c % res
    let nbCount = 0
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = (cr + dr) * res + (cc + dc)
      if (cells.includes(ni)) nbCount++
    }
    if (nbCount < minNeighbors) {
      minNeighbors = nbCount
      startIdx = i
    }
    if (nbCount <= 1) break
  }

  // 使用 Set 加速 includes 查找
  const cellSet = new Set(cells)

  let cur = cells[startIdx]
  result.push(cur)
  used.add(cur)

  while (result.length < cells.length) {
    const cr = (cur / res) | 0, cc = cur % res
    let best = -1
    let bestDist = Infinity

    // 优先找 8-邻中未使用的 border 格子
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = (cr + dr) * res + (cc + dc)
      if (cellSet.has(ni) && !used.has(ni)) {
        const d = Math.abs(dr) + Math.abs(dc)
        if (d < bestDist) {
          bestDist = d
          best = ni
        }
      }
    }

    if (best < 0) {
      // 跳跃到最近的未使用格子
      let closestDist = Infinity
      for (const c of cells) {
        if (used.has(c)) continue
        const r1 = (cur / res) | 0, c1 = cur % res
        const r2 = (c / res) | 0, c2 = c % res
        const d = (r1 - r2) ** 2 + (c1 - c2) ** 2
        if (d < closestDist) {
          closestDist = d
          best = c
        }
      }
      if (best < 0) break
    }

    cur = best
    result.push(cur)
    used.add(cur)
  }

  return result
}

// ── 子采样 ──

function _subsample(pts: { x: number; z: number }[], step: number): { x: number; z: number }[] {
  if (pts.length <= step) return pts
  const result: { x: number; z: number }[] = []
  for (let i = 0; i < pts.length; i += step) {
    result.push(pts[i])
  }
  if (result[result.length - 1] !== pts[pts.length - 1]) {
    result.push(pts[pts.length - 1])
  }
  return result
}

// ── Catmull-Rom 插值 ──

function _catmullRomChain(
  controlPts: { x: number; z: number }[],
  stepSize: number,
): { x: number; z: number }[] {
  if (controlPts.length < 2) return controlPts
  const result: { x: number; z: number }[] = []

  for (let i = 0; i < controlPts.length - 1; i++) {
    const p0 = controlPts[Math.max(0, i - 1)]
    const p1 = controlPts[i]
    const p2 = controlPts[i + 1]
    const p3 = controlPts[Math.min(controlPts.length - 1, i + 2)]

    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z)
    const steps = Math.max(1, Math.ceil(segLen / stepSize))

    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      )
      const z = 0.5 * (
        (2 * p1.z) +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
      )

      result.push({ x, z })
    }
  }

  result.push(controlPts[controlPts.length - 1])
  return result
}

// ── 安全检查 ──

function _nearBase(x: number, z: number, bases: { x: number; z: number }[], clearance: number): boolean {
  const clSq = clearance * clearance
  for (const b of bases) {
    if ((x - b.x) ** 2 + (z - b.z) ** 2 < clSq) return true
  }
  return false
}

function _nearRamp(
  wx: number, wz: number,
  grid: ZoneOwnershipGrid,
  clearance: number,
  cellW: number, cellH: number,
  halfW: number, halfH: number,
): boolean {
  const col = Math.floor((wx + halfW) / cellW)
  const row = Math.floor((wz + halfH) / cellH)
  const { res, isRamp } = grid
  const radius = Math.ceil(clearance / Math.min(cellW, cellH))

  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const nr = row + dr, nc = col + dc
      if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
      if (isRamp[nr * res + nc]) return true
    }
  }
  return false
}

// ── hash ──

function _hash(x: number, z: number, seed: number): number {
  let h = seed ^ (x * 374761393) ^ (z * 668265263)
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return (h & 0xffff) / 0xffff
}
