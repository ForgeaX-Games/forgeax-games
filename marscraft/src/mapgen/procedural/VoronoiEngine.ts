/**
 * Voronoi 引擎 — L1 Manhattan 距离 + Pinned Lloyd 松弛
 *
 * 核心特性：
 *   1. L1（曼哈顿）距离 |dx| + |dz|：使区域边界自然呈 45° 对角线方向
 *      （使用欧几里得距离时边界是圆弧，使用 L1 时是菱形，更接近 SC2 风格）
 *   2. Lloyd 松弛：将每个区域中心移到其所有格子的质心，使区域更均匀
 *   3. Pinned seeds：主矿种子点在松弛过程中固定不动，防止漂移到角落
 *
 * alg_starcraft_terrain 建议值：lloydIterations = 1（0 太不规则，3+ 太均匀）
 */

import type { SeededRandom } from './SeededRandom'
import type { Point2D } from './SymmetryFramework'

export interface VoronoiRegion {
  /** 区域编号（与种子顺序一致） */
  id: number
  /** 区域质心世界 X */
  cx: number
  /** 区域质心世界 Z */
  cz: number
  /** cliff level (0=低地, 1=中地, 2=高地/主矿) */
  height: number
  /** 游戏角色分类 */
  type: 'main_base' | 'natural' | 'third' | 'center' | 'flank' | 'wasteland' | 'expansion'
  /** 区域面积（Voronoi 格子数） */
  cells: number
  /** 相邻区域编号列表（至少共享一条格子边界） */
  neighbors: number[]
  /** 到地图中心的归一化距离（0=中心，1=角落） */
  distFromCenter: number
}

export interface VoronoiResult {
  regions: VoronoiRegion[]
  /**
   * 归属网格：每个格子存储其所属区域的编号
   * 大小：voronoiRes × voronoiRes
   * 索引：row * voronoiRes + col
   */
  ownership: Int16Array
  /** 网格分辨率（每轴格子数） */
  voronoiRes: number
}

/**
 * 构建 L1 Voronoi 图，带 Lloyd 松弛和 Pinned seeds
 *
 * @param seeds         种子点世界坐标数组
 * @param mapWidth      地图宽度（世界单位）
 * @param mapHeight     地图高度（世界单位）
 * @param lloydIterations  松弛迭代次数（建议 1）
 * @param pinnedIndices    不参与松弛的种子编号集合（主矿）
 * @param voronoiRes    Voronoi 网格分辨率（通常等于地图宽度）
 */
export function buildVoronoi(
  seeds: Point2D[],
  mapWidth: number,
  mapHeight: number,
  lloydIterations: number,
  pinnedIndices: Set<number>,
  voronoiRes: number = 64,
  warpScale: number = 1.0,
): VoronoiResult {
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const cellW = mapWidth / voronoiRes
  const cellH = mapHeight / voronoiRes
  const n = seeds.length

  // 工作副本（松弛过程中会修改质心位置）
  const centers = seeds.map(s => ({ x: s.x, z: s.z }))
  const ownership = new Int16Array(voronoiRes * voronoiRes).fill(-1)

  for (let iter = 0; iter <= lloydIterations; iter++) {
    // ── Voronoi 分配 ──
    // ★ 使用 L2 欧几里得距离取代 L1 曼哈顿距离
    // L1 会导致极度规则的 45 度对角线（在 3D 方块引擎中表现为完美的阶梯锯齿）
    // 并且加入一些基于正弦波的坐标扭曲 (Domain Warping)，让边界像自然悬崖一样起伏
    for (let row = 0; row < voronoiRes; row++) {
      for (let col = 0; col < voronoiRes; col++) {
        const baseWx = (col + 0.5) * cellW - halfW
        const baseWz = (row + 0.5) * cellH - halfH
        
        // 伪随机扭曲扰动，扭曲幅度约等于 2.5 倍格子宽度
        // 使用 baseWx 和 baseWz 作为参数，且函数为奇函数 (Odd Function)，
        // 以完美保证星际争霸 1v1 地图的 180 度中心点对称性 (中心点为 0,0)
        const warpAmp = cellW * 2.5 * warpScale
        const warpX = Math.sin(baseWx * 0.3) * Math.cos(baseWz * 0.2) * warpAmp
        const warpZ = Math.cos(baseWx * 0.25) * Math.sin(baseWz * 0.35) * warpAmp
        
        const wx = baseWx + warpX
        const wz = baseWz + warpZ

        let bestIdx = 0
        let bestD = Infinity
        for (let i = 0; i < n; i++) {
          // ★ 欧几里得距离（L2）
          const dx = wx - centers[i].x
          const dz = wz - centers[i].z
          const d = dx * dx + dz * dz // 比较平方即可
          if (d < bestD) { bestD = d; bestIdx = i }
        }
        ownership[row * voronoiRes + col] = bestIdx
      }
    }

    // 最后一次迭代后不需要松弛
    if (iter === lloydIterations) break

    // ── Lloyd 质心更新 ──
    const sumX = new Float64Array(n)
    const sumZ = new Float64Array(n)
    const count = new Uint32Array(n)

    for (let row = 0; row < voronoiRes; row++) {
      for (let col = 0; col < voronoiRes; col++) {
        const idx = ownership[row * voronoiRes + col]
        if (idx < 0) continue
        sumX[idx] += (col + 0.5) * cellW - halfW
        sumZ[idx] += (row + 0.5) * cellH - halfH
        count[idx]++
      }
    }

    for (let i = 0; i < n; i++) {
      // ★ Pinned seeds（主矿）固定不动，防止 Lloyd 松弛将其推向角落
      if (count[i] > 0 && !pinnedIndices.has(i)) {
        centers[i].x = sumX[i] / count[i]
        centers[i].z = sumZ[i] / count[i]
      }
    }
  }

  // ── 构建区域元数据 ──
  const regionCells = new Uint32Array(n)
  const neighborSets: Set<number>[] = Array.from({ length: n }, () => new Set())

  for (let row = 0; row < voronoiRes; row++) {
    for (let col = 0; col < voronoiRes; col++) {
      const a = ownership[row * voronoiRes + col]
      if (a < 0) continue
      regionCells[a]++

      // 检测相邻格子，建立邻接关系
      for (const [dr, dc] of [[0, 1], [1, 0]] as [number, number][]) {
        const nr = row + dr, nc = col + dc
        if (nr >= voronoiRes || nc >= voronoiRes) continue
        const b = ownership[nr * voronoiRes + nc]
        if (b >= 0 && b !== a) {
          neighborSets[a].add(b)
          neighborSets[b].add(a)
        }
      }
    }
  }

  // 计算最终质心（使用松弛后的实际格子质心，比种子位置更准确）
  const finalSumX = new Float64Array(n)
  const finalSumZ = new Float64Array(n)
  const finalCount = new Uint32Array(n)
  for (let row = 0; row < voronoiRes; row++) {
    for (let col = 0; col < voronoiRes; col++) {
      const idx = ownership[row * voronoiRes + col]
      if (idx < 0) continue
      finalSumX[idx] += (col + 0.5) * cellW - halfW
      finalSumZ[idx] += (row + 0.5) * cellH - halfH
      finalCount[idx]++
    }
  }

  const maxDist = Math.sqrt(halfW * halfW + halfH * halfH)
  const regions: VoronoiRegion[] = centers.map((c, i) => {
    const cx = finalCount[i] > 0 ? finalSumX[i] / finalCount[i] : c.x
    const cz = finalCount[i] > 0 ? finalSumZ[i] / finalCount[i] : c.z
    return {
      id: i,
      cx,
      cz,
      height: 0,
      type: 'wasteland',
      cells: regionCells[i],
      neighbors: Array.from(neighborSets[i]),
      distFromCenter: Math.sqrt(cx * cx + cz * cz) / maxDist,
    }
  })

  return { regions, ownership, voronoiRes }
}

/**
 * 找到两个相邻区域之间的边界中点（世界坐标）
 * 扫描 ownership 网格，统计两区域交界处所有格子对，取平均位置。
 */
export function findBorderMidpoint(
  regIdA: number,
  regIdB: number,
  ownership: Int16Array,
  voronoiRes: number,
  mapWidth: number,
  mapHeight: number,
): Point2D | null {
  const cellW = mapWidth / voronoiRes
  const cellH = mapHeight / voronoiRes
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2

  let sumX = 0, sumZ = 0, count = 0

  for (let row = 0; row < voronoiRes; row++) {
    for (let col = 0; col < voronoiRes; col++) {
      const a = ownership[row * voronoiRes + col]
      if (a !== regIdA && a !== regIdB) continue
      for (const [dr, dc] of [[0, 1], [1, 0]] as [number, number][]) {
        const nr = row + dr, nc = col + dc
        if (nr >= voronoiRes || nc >= voronoiRes) continue
        const b = ownership[nr * voronoiRes + nc]
        if ((a === regIdA && b === regIdB) || (a === regIdB && b === regIdA)) {
          // 取两格子中心的中点
          sumX += ((col + 0.5) + (nc + 0.5)) * 0.5 * cellW - halfW
          sumZ += ((row + 0.5) + (nr + 0.5)) * 0.5 * cellH - halfH
          count++
        }
      }
    }
  }

  if (count === 0) return null
  return { x: sumX / count, z: sumZ / count }
}
