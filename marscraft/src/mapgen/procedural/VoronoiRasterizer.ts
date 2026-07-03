/**
 * Voronoi 光栅化器
 *
 * 职责：
 *   1. buildHeightGrid  — 将 VoronoiResult 的归属网格转为 Int8Array 高度网格
 *   2. diagonalizeBoundaries — 将垂直/水平悬崖边界强制转为 45° 阶梯
 *   3. rasterizeToPlatforms  — RLE + 垂直合并，将高度网格转为 RectPlatform[] 列表
 *
 * 关于边界对角化（alg_starcraft_terrain Phase 4b）：
 *   L1 Voronoi 已经倾向产生 45° 边界，但水平/垂直的边界段仍会出现
 *   （当两个种子在同一行或列时）。对角化通过检测连续的垂直/水平边界段
 *   （≥3 格），将其中每隔一格转为"阶梯"来消除直线边界。
 */

import type { VoronoiRegion, VoronoiResult } from './VoronoiEngine'
import type { RectPlatform } from '../types'

// ================================================================
// 1. Height Grid Construction
// ================================================================

/**
 * 从 Voronoi 归属网格构建每格 cliff level 的高度网格
 * 大小：voronoiRes × voronoiRes
 */
export function buildHeightGrid(
  ownership: Int16Array,
  regions: VoronoiRegion[],
  voronoiRes: number,
): Int8Array {
  const grid = new Int8Array(voronoiRes * voronoiRes)
  for (let i = 0; i < voronoiRes * voronoiRes; i++) {
    const regIdx = ownership[i]
    grid[i] = (regIdx >= 0 && regIdx < regions.length)
      ? regions[regIdx].height
      : 0
  }
  return grid
}

// ================================================================
// 2. Boundary Diagonalization
// ================================================================

/**
 * 边界对角化 — 将垂直/水平悬崖边界转为 45° 阶梯
 *
 * 扫描两遍：
 *   Phase 1: 消除垂直边界（grid[r][c] ≠ grid[r][c+1] 连续 ≥3 行）
 *   Phase 2: 消除水平边界（grid[r][c] ≠ grid[r+1][c] 连续 ≥3 列）
 *
 * 每次检测到连续 ≥3 格的直线边界，就把其中奇数偏移行的格子"阶梯化"
 * （将低侧的某些格子提升为高侧，或将高侧的某些格子降低为低侧）。
 */
export function diagonalizeBoundaries(grid: Int8Array, res: number): void {
  // Phase 1: 消除垂直边界（col 与 col+1 之间的高度差）
  for (let c = 0; c < res - 1; c++) {
    let runStart = -1
    let runH0 = 0  // 左侧高度
    let runH1 = 0  // 右侧高度

    for (let r = 0; r <= res; r++) {
      const inBounds = r < res
      const leftH  = inBounds ? grid[r * res + c]     : -1
      const rightH = inBounds ? grid[r * res + c + 1] : -1
      const isBoundary = inBounds && leftH !== rightH

      if (isBoundary && (runStart < 0 || (leftH === runH0 && rightH === runH1))) {
        if (runStart < 0) { runStart = r; runH0 = leftH; runH1 = rightH }
      } else {
        if (runStart >= 0) {
          const runLen = r - runStart
          if (runLen >= 3) {
            _staircaseVertical(grid, res, c, runStart, runLen, runH0, runH1)
          }
          runStart = -1
        }
        if (isBoundary) { runStart = r; runH0 = leftH; runH1 = rightH }
      }
    }
  }

  // Phase 2: 消除水平边界（row 与 row+1 之间的高度差）
  for (let r = 0; r < res - 1; r++) {
    let runStart = -1
    let runH0 = 0  // 上侧高度
    let runH1 = 0  // 下侧高度

    for (let c = 0; c <= res; c++) {
      const inBounds = c < res
      const topH    = inBounds ? grid[r * res + c]       : -1
      const bottomH = inBounds ? grid[(r + 1) * res + c] : -1
      const isBoundary = inBounds && topH !== bottomH

      if (isBoundary && (runStart < 0 || (topH === runH0 && bottomH === runH1))) {
        if (runStart < 0) { runStart = c; runH0 = topH; runH1 = bottomH }
      } else {
        if (runStart >= 0) {
          const runLen = c - runStart
          if (runLen >= 3) {
            _staircaseHorizontal(grid, res, r, runStart, runLen, runH0, runH1)
          }
          runStart = -1
        }
        if (isBoundary) { runStart = c; runH0 = topH; runH1 = bottomH }
      }
    }
  }
}

/** 对垂直边界段（col 与 col+1 之间）进行阶梯化处理 */
function _staircaseVertical(
  grid: Int8Array, res: number,
  col: number, startRow: number, runLen: number,
  hLeft: number, hRight: number,
): void {
  const highIsLeft = hLeft > hRight
  // 每隔一行，将低侧的格子"提升"为高侧高度，形成阶梯
  for (let i = 1; i < runLen; i += 2) {
    const r = startRow + i
    if (r >= res) break
    if (highIsLeft) {
      grid[r * res + col + 1] = hLeft   // 右侧（低侧）拉平到左侧（高侧）
    } else {
      grid[r * res + col] = hRight       // 左侧（低侧）拉平到右侧（高侧）
    }
  }
}

/** 对水平边界段（row 与 row+1 之间）进行阶梯化处理 */
function _staircaseHorizontal(
  grid: Int8Array, res: number,
  row: number, startCol: number, runLen: number,
  hTop: number, hBottom: number,
): void {
  const highIsTop = hTop > hBottom
  for (let i = 1; i < runLen; i += 2) {
    const c = startCol + i
    if (c >= res) break
    if (highIsTop) {
      grid[(row + 1) * res + c] = hTop   // 下侧拉平到上侧
    } else {
      grid[row * res + c] = hBottom      // 上侧拉平到下侧
    }
  }
}

// ================================================================
// 3. Rasterize to RectPlatforms (RLE + vertical merge)
// ================================================================

/**
 * 将高度网格（heightGrid）转换为 RectPlatform[] 列表
 *
 * 算法：
 *   1. RLE（行程编码）：对每行扫描，将连续相同高度的段合并为区间 [colStart, colEnd, height]
 *   2. 垂直合并：若相邻行有完全相同的 [colStart, colEnd, height] 区间，则合并为更高的矩形
 *   3. 只输出高度 > 0 的平台（高度为 0 的是低地，不需要声明）
 *
 * @param heightGrid  Int8Array，大小 res*res
 * @param res         网格分辨率
 * @param mapWidth    地图宽度（世界单位）
 * @param mapHeight   地图高度（世界单位）
 * @param cliffVisH   每个 cliff level 的视觉高度（默认 2.0）
 */
export function rasterizeToPlatforms(
  heightGrid: Int8Array,
  res: number,
  mapWidth: number,
  mapHeight: number,
  cliffVisH: number = 2.0,
): RectPlatform[] {
  const cellW = mapWidth / res
  const cellH = mapHeight / res
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2

  // 当前行的活跃区间：key = `colStart:colEnd:height` → rowStart
  const activeSegs = new Map<string, number>()
  const platforms: RectPlatform[] = []

  const flushSeg = (colStart: number, colEnd: number, h: number, rowStart: number, rowEnd: number) => {
    if (h <= 0) return // 不输出低地
    // 转世界坐标（格子左边缘 → 格子右边缘）
    const x1 = colStart * cellW - halfW
    const x2 = (colEnd + 1) * cellW - halfW
    const z1 = rowStart * cellH - halfH
    const z2 = (rowEnd + 1) * cellH - halfH
    platforms.push({ x1, z1, x2, z2, height: h * cliffVisH, cliffLevel: h })
  }

  for (let row = 0; row < res; row++) {
    // 对当前行做 RLE
    const rowSegs: { colStart: number; colEnd: number; h: number }[] = []
    let segStart = 0
    let segH = heightGrid[row * res + 0]

    for (let col = 1; col <= res; col++) {
      const curH = col < res ? heightGrid[row * res + col] : -1
      if (curH !== segH) {
        rowSegs.push({ colStart: segStart, colEnd: col - 1, h: segH })
        segStart = col
        segH = curH
      }
    }

    // 与上一行的活跃区间对比，尝试垂直合并
    const nextActive = new Map<string, number>()
    const usedThisRow = new Set<string>()

    for (const seg of rowSegs) {
      const key = `${seg.colStart}:${seg.colEnd}:${seg.h}`
      if (activeSegs.has(key)) {
        // 可以垂直合并（维持活跃状态）
        nextActive.set(key, activeSegs.get(key)!)
        usedThisRow.add(key)
      } else {
        // 新区间，作为新的活跃段开始
        nextActive.set(key, row)
        usedThisRow.add(key)
      }
    }

    // 上一行中未被当前行继续的活跃区间 → 关闭并输出
    for (const [key, rowStart] of activeSegs) {
      if (!usedThisRow.has(key)) {
        const [colStart, colEnd, h] = key.split(':').map(Number)
        flushSeg(colStart, colEnd, h, rowStart, row - 1)
      }
    }

    activeSegs.clear()
    for (const [k, v] of nextActive) activeSegs.set(k, v)
  }

  // 最后一行的活跃区间
  for (const [key, rowStart] of activeSegs) {
    const [colStart, colEnd, h] = key.split(':').map(Number)
    flushSeg(colStart, colEnd, h, rowStart, res - 1)
  }

  return platforms
}

