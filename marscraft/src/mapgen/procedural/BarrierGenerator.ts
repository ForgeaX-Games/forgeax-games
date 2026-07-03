/**
 * 障碍物生成器 — SC2 式高度隔断
 *
 * 核心机制（对齐 V1 terrainGen 的 7-Pass 架构）：
 *   1. 相邻格子 cliff level 不同 → 悬崖边缘（不可通行）
 *   2. isRamp=1 的格子豁免悬崖检测（坡道是唯一的跨高度通道）
 *   3. 悬崖边缘缓冲膨胀 1 格（但不侵入坡道格子）
 *   4. 坡道走廊内强制可通行（carve ramp）
 *   5. 区域内部可选随机障碍物（碎石装饰）
 *   6. 地图边缘围墙
 *
 * 输出：
 *   - BarrierGrid.data: 0=可通行, 1=障碍物, 2=悬崖边缘
 *   - BarrierGrid.cliffEdges: 悬崖线段列表（用于 3D 墙壁渲染）
 *   - BarrierGrid.pathingGrid: 独立通行性网格（0=walkable, 1=blocked）
 */

import type { ZoneOwnershipGrid } from './ZoneShapeAssigner'
import { ROLE_INTERIOR, ROLE_BORDER, ROLE_ROAD, ROLE_SPINE } from './ZoneShapeAssigner'

// ── 输出 ──

export interface CliffEdgeSeg {
  x1: number; z1: number
  x2: number; z2: number
  highLevel: number
  lowLevel: number
}

export interface BarrierGrid {
  /** res × res: 0=可通行, 1=障碍物, 2=悬崖边缘 */
  data: Uint8Array
  /** 独立通行性网格: 0=walkable, 1=blocked */
  pathingGrid: Uint8Array
  /** 悬崖线段（用于 3D 墙壁渲染） */
  cliffEdges: CliffEdgeSeg[]
  res: number
  mapWidth: number
  mapHeight: number
}

export const BARRIER_NONE  = 0
export const BARRIER_WALL  = 1
export const BARRIER_CLIFF = 2

const INTERIOR_OBSTACLE_CHANCE = 0.03

// ── 主函数 ──

export function generateBarriers(
  grid: ZoneOwnershipGrid,
  seed: number = 42,
): BarrierGrid {
  const { ownership, roles, cellHeights, isRamp, res, zones } = grid
  const { mapWidth, mapHeight } = grid
  const total = res * res
  const data = new Uint8Array(total)
  const pathingGrid = new Uint8Array(total)

  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const cellW = mapWidth / res
  const cellH = mapHeight / res

  // ================================================================
  // Pass 1: 区域边界格子 → 基础墙壁
  // ================================================================
  for (let i = 0; i < total; i++) {
    if (roles[i] === ROLE_BORDER) {
      data[i] = BARRIER_WALL
    }
  }

  // ================================================================
  // Pass 2: 悬崖边缘检测（SC2 核心机制）
  //   相邻格子 cliff level 不同 → 悬崖边缘（不可通行）
  //   ★ isRamp=1 的格子自身不产生悬崖边缘
  //   ★ 邻居是 isRamp=1 时也跳过（防止坡道边缘产生碎片墙壁）
  // ================================================================
  const isCliffEdge = new Uint8Array(total)

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const idx = row * res + col
      if (isRamp[idx]) continue

      const cl = cellHeights[idx]
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
        const nr = row + dr, nc = col + dc
        if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
        const nIdx = nr * res + nc
        if (isRamp[nIdx]) continue
        if (cellHeights[nIdx] !== cl) {
          isCliffEdge[idx] = 1
          break
        }
      }
    }
  }

  // Mark cliff edges in data array
  for (let i = 0; i < total; i++) {
    if (isCliffEdge[i]) {
      data[i] = BARRIER_CLIFF
    }
  }

  // ================================================================
  // Pass 3: 构建 pathing grid（悬崖边缘 + 边界墙 → blocked）
  // ================================================================
  for (let i = 0; i < total; i++) {
    if (isCliffEdge[i] || data[i] === BARRIER_WALL) {
      pathingGrid[i] = 1
    }
  }

  // ================================================================
  // Pass 4: 缓冲膨胀 — 在阻挡格子周围扩 1 格
  //   ★ 坡道格子绝对不参与膨胀（保护坡道通道）
  // ================================================================
  const buffered = new Uint8Array(total)
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const idx = row * res + col
      if (pathingGrid[idx]) {
        buffered[idx] = 1
        continue
      }
      if (isRamp[idx]) continue

      let hasBlockedNeighbor = false
      for (let dr = -1; dr <= 1 && !hasBlockedNeighbor; dr++) {
        for (let dc = -1; dc <= 1 && !hasBlockedNeighbor; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = row + dr, nc = col + dc
          if (nr >= 0 && nr < res && nc >= 0 && nc < res) {
            if (pathingGrid[nr * res + nc]) hasBlockedNeighbor = true
          }
        }
      }
      if (hasBlockedNeighbor) buffered[idx] = 1
    }
  }
  for (let i = 0; i < total; i++) pathingGrid[i] = buffered[i]

  // ================================================================
  // Pass 5: Carve ramp corridors — 坡道区域强制可通行
  // ================================================================
  for (let i = 0; i < total; i++) {
    if (isRamp[i]) {
      pathingGrid[i] = 0
      if (data[i] === BARRIER_CLIFF || data[i] === BARRIER_WALL) {
        data[i] = BARRIER_NONE
      }
    }
  }

  // ================================================================
  // Pass 6: 道路/骨架强制打通（非坡道的道路格子也需要通行）
  // ================================================================
  for (let i = 0; i < total; i++) {
    if (roles[i] === ROLE_ROAD || roles[i] === ROLE_SPINE) {
      if (!isCliffEdge[i]) {
        pathingGrid[i] = 0
        if (data[i] !== BARRIER_NONE) data[i] = BARRIER_NONE
      }
    }
  }

  // ================================================================
  // Pass 7: 区域内部随机障碍物（密度按区域类型差异化）
  // ================================================================
  const ZONE_OBSTACLE_CHANCE: Record<string, number> = {
    main_base: 0,
    expansion: 0,
    anchor: 0,
    battlefield: 0.02,
    passage: 0.02,
    wasteland: 0.06,
  }
  for (let row = 1; row < res - 1; row++) {
    for (let col = 1; col < res - 1; col++) {
      const idx = row * res + col
      if (roles[idx] !== ROLE_INTERIOR) continue
      if (data[idx] !== BARRIER_NONE) continue
      if (pathingGrid[idx]) continue

      const zoneIdx = ownership[idx]
      if (zoneIdx < 0) continue
      const z = zones[zoneIdx]
      const chance = ZONE_OBSTACLE_CHANCE[z.type] ?? INTERIOR_OBSTACLE_CHANCE
      if (chance <= 0) continue

      const rnd = _hash(col, row, seed)
      if (rnd < chance) {
        data[idx] = BARRIER_WALL
        pathingGrid[idx] = 1
      }
    }
  }

  // ================================================================
  // Pass 8: 地图边缘围墙
  // ================================================================
  for (let col = 0; col < res; col++) {
    data[col] = BARRIER_WALL
    data[(res - 1) * res + col] = BARRIER_WALL
    pathingGrid[col] = 1
    pathingGrid[(res - 1) * res + col] = 1
  }
  for (let row = 0; row < res; row++) {
    data[row * res] = BARRIER_WALL
    data[row * res + (res - 1)] = BARRIER_WALL
    pathingGrid[row * res] = 1
    pathingGrid[row * res + (res - 1)] = 1
  }

  // ================================================================
  // Pass 9: 生成悬崖线段（用于 3D 墙壁渲染）
  //   使用 Marching Squares 提取平滑轮廓线
  // ================================================================
  const cliffEdges = _buildCliffEdges(cellHeights, isRamp, res, mapWidth, mapHeight)

  return { data, pathingGrid, cliffEdges, res, mapWidth, mapHeight }
}

// ── 悬崖线段生成（Marching Squares） ──

function _buildCliffEdges(
  cellHeights: Float32Array,
  isRamp: Uint8Array,
  res: number,
  mapWidth: number,
  mapHeight: number,
): CliffEdgeSeg[] {
  const edges: CliffEdgeSeg[] = []
  const cellW = mapWidth / res
  const cellH = mapHeight / res
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2

  let minLevel = 999, maxLevel = -999
  for (let i = 0; i < res * res; i++) {
    const cl = cellHeights[i]
    if (cl < minLevel) minLevel = cl
    if (cl > maxLevel) maxLevel = cl
  }
  if (minLevel >= maxLevel) return []

  const getMidWorld = (col: number, row: number, edgeIdx: number) => {
    switch (edgeIdx) {
      case 0: return { x: (col + 0.5) * cellW - halfW, z: row * cellH - halfH }
      case 1: return { x: (col + 1) * cellW - halfW, z: (row + 0.5) * cellH - halfH }
      case 2: return { x: (col + 0.5) * cellW - halfW, z: (row + 1) * cellH - halfH }
      case 3: return { x: col * cellW - halfW, z: (row + 0.5) * cellH - halfH }
      default: return { x: 0, z: 0 }
    }
  }

  const cases: number[][][] = [
    [], [[3, 2]], [[2, 1]], [[3, 1]],
    [[1, 0]], [[3, 2], [1, 0]], [[2, 0]], [[3, 0]],
    [[0, 3]], [[0, 2]], [[0, 3], [2, 1]], [[0, 1]],
    [[1, 3]], [[1, 2]], [[2, 3]], [],
  ]

  for (let level = Math.floor(minLevel); level < Math.ceil(maxLevel); level++) {
    if (level < 0) continue
    const threshold = level + 0.5

    for (let row = 0; row < res - 1; row++) {
      for (let col = 0; col < res - 1; col++) {
        const tlIdx = row * res + col
        const trIdx = row * res + col + 1
        const blIdx = (row + 1) * res + col
        const brIdx = (row + 1) * res + col + 1

        // Skip if any corner is a ramp cell
        if (isRamp[tlIdx] || isRamp[trIdx] || isRamp[blIdx] || isRamp[brIdx]) continue

        let state = 0
        if (cellHeights[tlIdx] > threshold) state |= 8
        if (cellHeights[trIdx] > threshold) state |= 4
        if (cellHeights[brIdx] > threshold) state |= 2
        if (cellHeights[blIdx] > threshold) state |= 1

        for (const seg of cases[state]) {
          const p1 = getMidWorld(col, row, seg[0])
          const p2 = getMidWorld(col, row, seg[1])
          edges.push({
            x1: p1.x, z1: p1.z,
            x2: p2.x, z2: p2.z,
            highLevel: level + 1,
            lowLevel: level,
          })
        }
      }
    }
  }

  return _mergeCollinearEdges(edges)
}

function _mergeCollinearEdges(edges: CliffEdgeSeg[]): CliffEdgeSeg[] {
  if (edges.length <= 1) return edges
  const EPSILON = 0.001
  let currentEdges = [...edges]
  let merged = true

  while (merged) {
    merged = false
    const nextEdges: CliffEdgeSeg[] = []
    const used = new Uint8Array(currentEdges.length)

    for (let i = 0; i < currentEdges.length; i++) {
      if (used[i]) continue
      let e1 = currentEdges[i]

      for (let j = i + 1; j < currentEdges.length; j++) {
        if (used[j]) continue
        const e2 = currentEdges[j]
        if (e1.highLevel !== e2.highLevel || e1.lowLevel !== e2.lowLevel) continue

        const share1 = Math.abs(e1.x2 - e2.x1) < EPSILON && Math.abs(e1.z2 - e2.z1) < EPSILON
        const share2 = Math.abs(e1.x1 - e2.x2) < EPSILON && Math.abs(e1.z1 - e2.z2) < EPSILON
        const share3 = Math.abs(e1.x2 - e2.x2) < EPSILON && Math.abs(e1.z2 - e2.z2) < EPSILON
        const share4 = Math.abs(e1.x1 - e2.x1) < EPSILON && Math.abs(e1.z1 - e2.z1) < EPSILON

        if (share1 || share2 || share3 || share4) {
          const dir1x = e1.x2 - e1.x1, dir1z = e1.z2 - e1.z1
          const dir2x = e2.x2 - e2.x1, dir2z = e2.z2 - e2.z1
          const cross = dir1x * dir2z - dir1z * dir2x

          if (Math.abs(cross) < EPSILON) {
            let nx1: number, nz1: number, nx2: number, nz2: number
            if (share1) { nx1 = e1.x1; nz1 = e1.z1; nx2 = e2.x2; nz2 = e2.z2 }
            else if (share2) { nx1 = e2.x1; nz1 = e2.z1; nx2 = e1.x2; nz2 = e1.z2 }
            else if (share3) { nx1 = e1.x1; nz1 = e1.z1; nx2 = e2.x1; nz2 = e2.z1 }
            else { nx1 = e1.x2; nz1 = e1.z2; nx2 = e2.x2; nz2 = e2.z2 }

            e1 = { x1: nx1!, z1: nz1!, x2: nx2!, z2: nz2!, highLevel: e1.highLevel, lowLevel: e1.lowLevel }
            used[j] = 1
            merged = true
          }
        }
      }
      nextEdges.push(e1)
    }
    currentEdges = nextEdges
  }
  return currentEdges
}

function _hash(x: number, z: number, seed: number): number {
  let h = seed ^ (x * 374761393) ^ (z * 668265263)
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return (h & 0xffff) / 0xffff
}
