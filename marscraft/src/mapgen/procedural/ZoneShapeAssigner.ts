/**
 * 区域形状分配器
 *
 * 加权 Voronoi + 虚拟 wasteland 种子 + 保护区强制归属
 * 完全尊重地图对称性
 *
 * 算法：
 *   1. 收集所有非 anchor 区域 + 对称生成的 wasteland 虚拟种子
 *   2. 带权重的 Voronoi：有效距离 = 实际距离 - radius * k
 *   3. 对称 domain warping 噪声让边界自然不规则
 *   4. 保护区强制：main_base / expansion 半径内强制归属
 *   5. 标记边界 → 道路/骨架打穿
 */

import type { PlacedZoneGraph, PlacedZone } from './ZoneGraph'
import type { RoadNetwork } from './RoadGenerator'
import type { Spine } from './SpineGenerator'
import type { SymmetryMode } from './SymmetryFramework'
import type { RoadHeightMap } from './RoadHeightAssigner'
import type { RampDef } from '../types'
import { mirrorPoint, isInPrimaryHalf } from './SymmetryFramework'
import { SeededRandom } from './SeededRandom'

// ── 输出 ──

export type CellRole = 'interior' | 'border' | 'road' | 'spine'

export interface ZoneOwnershipGrid {
  ownership: Int16Array
  roles: Uint8Array
  /** 每个格子的 cliff level（整数，SC2 式离散高度层级） */
  cellHeights: Float32Array
  /** 坡道标记：1 = 此格子是坡道区域（豁免悬崖边缘检测） */
  isRamp: Uint8Array
  /** 骨架路径上检测到的坡道定义（直接供 V1 terrainGen 使用） */
  spineRamps: RampDef[]
  res: number
  mapWidth: number
  mapHeight: number
  zones: PlacedZone[]
}

export const ROLE_INTERIOR = 0
export const ROLE_BORDER   = 1
export const ROLE_ROAD     = 2
export const ROLE_SPINE    = 3

const RADIUS_WEIGHT = 2.8
const WASTELAND_VIRTUAL_RADIUS = 8
const WARP_FREQ = 0.06
const WARP_AMP_CELLS = 3.5

// ── 主函数 ──

export function assignZoneShapes(
  graph: PlacedZoneGraph,
  roads: RoadNetwork,
  spine: Spine | null,
  res: number = 128,
  symmetry: SymmetryMode = 'rotation_180',
  roadHeightMap: RoadHeightMap | null = null,
): ZoneOwnershipGrid {
  const { zones, mapWidth, mapHeight } = graph
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const cellW = mapWidth / res
  const cellH = mapHeight / res
  const warpAmp = Math.min(cellW, cellH) * WARP_AMP_CELLS

  // ── Phase 1: 构建种子列表（非 anchor + 对称 wasteland） ──

  interface Seed {
    cx: number; cz: number
    radius: number
    zoneIdx: number
  }

  const extZones: PlacedZone[] = [...zones]
  const seeds: Seed[] = []

  for (let i = 0; i < zones.length; i++) {
    if (zones[i].type === 'anchor') continue
    seeds.push({
      cx: zones[i].cx, cz: zones[i].cz,
      radius: zones[i].radius,
      zoneIdx: i,
    })
  }

  // wasteland 种子：只在 P1 半区撒，然后自动镜像到 P2
  const rng = new SeededRandom(73)
  const gridStep = Math.max(mapWidth, mapHeight) / 6
  const margin = 4

  const p1Seeds: { cx: number; cz: number }[] = []

  for (let wy = -halfH + margin; wy < halfH - margin; wy += gridStep) {
    for (let wx = -halfW + margin; wx < halfW - margin; wx += gridStep) {
      const cx = wx + rng.nextFloat(-gridStep * 0.3, gridStep * 0.3)
      const cz = wy + rng.nextFloat(-gridStep * 0.3, gridStep * 0.3)

      // 只保留 P1 半区的候选点（和对称轴附近的共享点）
      if (!isInPrimaryHalf({ x: cx, z: cz }, symmetry)) continue

      let tooClose = false
      for (const s of seeds) {
        const dx = cx - s.cx, dz = cz - s.cz
        const minDist = s.radius + WASTELAND_VIRTUAL_RADIUS * 0.5
        if (dx * dx + dz * dz < minDist * minDist) {
          tooClose = true; break
        }
      }
      if (tooClose) continue

      p1Seeds.push({ cx, cz })
    }
  }

  // 为虚拟 wasteland 计算高度：取最近功能区域高度的加权平均
  function _nearestHeight(cx: number, cz: number): number {
    let bestDist = Infinity
    let bestH = 0
    let secondDist = Infinity
    let secondH = 0
    for (const s of seeds) {
      const z = zones[s.zoneIdx]
      if (!z || z.type === 'anchor') continue
      const dx = cx - s.cx, dz = cz - s.cz
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < bestDist) {
        secondDist = bestDist; secondH = bestH
        bestDist = d; bestH = z.height
      } else if (d < secondDist) {
        secondDist = d; secondH = z.height
      }
    }
    if (secondDist < Infinity && bestDist < Infinity) {
      const total = bestDist + secondDist
      const w1 = 1 - bestDist / total
      const w2 = 1 - secondDist / total
      return Math.round((bestH * w1 + secondH * w2) / (w1 + w2))
    }
    return bestH
  }

  // 注册 P1 侧的 wasteland 种子
  for (const pt of p1Seeds) {
    const vIdx = extZones.length
    const h = _nearestHeight(pt.cx, pt.cz)
    extZones.push({
      id: `wasteland_v${vIdx}`,
      type: 'wasteland',
      cx: pt.cx, cz: pt.cz,
      radius: WASTELAND_VIRTUAL_RADIUS,
      height: h,
    })
    seeds.push({ cx: pt.cx, cz: pt.cz, radius: WASTELAND_VIRTUAL_RADIUS, zoneIdx: vIdx })
  }

  // 对称镜像 P2 侧
  for (const pt of p1Seeds) {
    const m = mirrorPoint({ x: pt.cx, z: pt.cz }, symmetry)

    let tooClose = false
    for (const s of seeds) {
      const dx = m.x - s.cx, dz = m.z - s.cz
      const minDist = s.radius + WASTELAND_VIRTUAL_RADIUS * 0.3
      if (dx * dx + dz * dz < minDist * minDist) {
        tooClose = true; break
      }
    }
    if (tooClose) continue

    const vIdx = extZones.length
    const h = _nearestHeight(m.x, m.z)
    extZones.push({
      id: `wasteland_v${vIdx}`,
      type: 'wasteland',
      cx: m.x, cz: m.z,
      radius: WASTELAND_VIRTUAL_RADIUS,
      height: h,
    })
    seeds.push({ cx: m.x, cz: m.z, radius: WASTELAND_VIRTUAL_RADIUS, zoneIdx: vIdx })
  }

  if (seeds.length === 0) {
    const vIdx = extZones.length
    extZones.push({
      id: 'wasteland_fallback',
      type: 'wasteland',
      cx: 0, cz: 0,
      radius: Math.max(mapWidth, mapHeight),
      height: 0,
    })
    seeds.push({ cx: 0, cz: 0, radius: Math.max(mapWidth, mapHeight), zoneIdx: vIdx })
  }

  // ── Phase 2: 加权 Voronoi + 对称 domain warping ──

  const ownership = new Int16Array(res * res).fill(-1)
  const roles = new Uint8Array(res * res)

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const wx = (col + 0.5) * cellW - halfW
      const wz = (row + 0.5) * cellH - halfH

      // 对称噪声：n(p) = (noise(p) + noise(mirror(p))) / 2
      const raw_nx = _noise2D(wx * WARP_FREQ, wz * WARP_FREQ)
      const raw_nz = _noise2D(wx * WARP_FREQ + 137, wz * WARP_FREQ + 137)
      const mp = mirrorPoint({ x: wx, z: wz }, symmetry)
      const mir_nx = _noise2D(mp.x * WARP_FREQ, mp.z * WARP_FREQ)
      const mir_nz = _noise2D(mp.x * WARP_FREQ + 137, mp.z * WARP_FREQ + 137)

      // 对 rotation_180: mirror noise 取反（因为旋转180°后梯度反向）
      let sym_nx: number, sym_nz: number
      if (symmetry === 'rotation_180') {
        sym_nx = (raw_nx - mir_nx) * 0.5
        sym_nz = (raw_nz - mir_nz) * 0.5
      } else if (symmetry === 'mirror_vertical') {
        sym_nx = (raw_nx - mir_nx) * 0.5  // x 分量反对称
        sym_nz = (raw_nz + mir_nz) * 0.5  // z 分量对称
      } else if (symmetry === 'mirror_horizontal') {
        sym_nx = (raw_nx + mir_nx) * 0.5
        sym_nz = (raw_nz - mir_nz) * 0.5
      } else {
        sym_nx = raw_nx
        sym_nz = raw_nz
      }

      const wwx = wx + sym_nx * warpAmp
      const wwz = wz + sym_nz * warpAmp

      let bestIdx = 0
      let bestDist = Infinity
      for (let s = 0; s < seeds.length; s++) {
        const dx = wwx - seeds[s].cx
        const dz = wwz - seeds[s].cz
        const dist = Math.sqrt(dx * dx + dz * dz) - seeds[s].radius * RADIUS_WEIGHT
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = s
        }
      }
      ownership[row * res + col] = seeds[bestIdx].zoneIdx
    }
  }

  // ── Phase 3: 保护区强制归属 ──
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const wx = (col + 0.5) * cellW - halfW
      const wz = (row + 0.5) * cellH - halfH
      const idx = row * res + col

      let bestZone = -1
      let bestDist = Infinity
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i]
        if (z.type !== 'main_base' && z.type !== 'expansion') continue
        const dx = wx - z.cx, dz = wz - z.cz
        const dist2 = dx * dx + dz * dz
        if (dist2 < z.radius * z.radius && dist2 < bestDist) {
          bestDist = dist2
          bestZone = i
        }
      }
      if (bestZone >= 0) {
        ownership[idx] = bestZone
      }
    }
  }

  // ── Phase 3b: 形态学平滑（消除内凹毛刺） ──
  // 多数投票：如果一个格子的 8 邻居中超过半数属于同一个其他区域，则归入该区域
  // 重复 2 轮使边界更平滑，但保护 main_base/expansion 核心区域不被修改
  {
    const protectedCells = new Uint8Array(res * res)
    for (let row = 0; row < res; row++) {
      for (let col = 0; col < res; col++) {
        const wx = (col + 0.5) * cellW - halfW
        const wz = (row + 0.5) * cellH - halfH
        for (let i = 0; i < zones.length; i++) {
          const z = zones[i]
          if (z.type !== 'main_base' && z.type !== 'expansion') continue
          const dx = wx - z.cx, dz = wz - z.cz
          if (dx * dx + dz * dz < z.radius * z.radius) {
            protectedCells[row * res + col] = 1
            break
          }
        }
      }
    }

    const SMOOTH_ROUNDS = 2
    for (let round = 0; round < SMOOTH_ROUNDS; round++) {
      const prevOwnership = new Int16Array(ownership)
      for (let row = 1; row < res - 1; row++) {
        for (let col = 1; col < res - 1; col++) {
          const idx = row * res + col
          if (protectedCells[idx]) continue

          const self = prevOwnership[idx]
          if (self < 0) continue

          // 统计 8 邻居中各区域的出现次数
          const counts = new Map<number, number>()
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue
              const ni = (row + dr) * res + (col + dc)
              const nz = prevOwnership[ni]
              if (nz >= 0) counts.set(nz, (counts.get(nz) ?? 0) + 1)
            }
          }

          // 如果某个邻居区域出现 >= 5 次（8 邻居中的多数），且不是自身，则归入
          let bestZone = self, bestCount = 0
          for (const [zone, count] of counts) {
            if (count > bestCount) { bestCount = count; bestZone = zone }
          }
          if (bestZone !== self && bestCount >= 5) {
            ownership[idx] = bestZone
          }
        }
      }
    }
  }

  // ── Phase 4: 标记边界格子 ──
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const idx = row * res + col
      const a = ownership[idx]
      if (a < 0) continue

      let isBorder = false
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nr = row + dr, nc = col + dc
        if (nr < 0 || nr >= res || nc < 0 || nc >= res) {
          isBorder = true; break
        }
        const b = ownership[nr * res + nc]
        if (b >= 0 && b !== a) {
          isBorder = true; break
        }
      }
      roles[idx] = isBorder ? ROLE_BORDER : ROLE_INTERIOR
    }
  }

  // ── Phase 5: 保护区集合 ──
  const protectedZones = zones.filter(z => z.type === 'main_base' || z.type === 'expansion')
  function _isProtected(wx: number, wz: number): boolean {
    for (const z of protectedZones) {
      const dx = wx - z.cx, dz = wz - z.cz
      if (dx * dx + dz * dz < z.radius * z.radius) return true
    }
    return false
  }

  // ── Phase 6: 道路覆盖 ──
  for (const road of roads.roads) {
    const wps = road.waypoints
    for (let i = 0; i < wps.length - 1; i++) {
      const w0 = wps[i], w1 = wps[i + 1]
      _rasterizeRoadSeg(
        w0.x, w0.z, Math.max(w0.halfWidth, 1),
        w1.x, w1.z, Math.max(w1.halfWidth, 1),
        roles, res, halfW, halfH, cellW, cellH,
        ROLE_ROAD, _isProtected,
      )
    }
  }

  // ── Phase 7: 骨架路径覆盖（Catmull-Rom 平滑曲线） ──
  if (spine && spine.type !== 'open') {
    const nodeMap = new Map(spine.nodes.map(n => [n.id, n]))
    const usableW = halfW - 8
    const usableH = halfH - 8

    // 按 lane 分组，重建每条 lane 的有序节点链
    const laneChains = _buildLaneChains(spine, nodeMap, usableW, usableH)

    for (const chain of laneChains) {
      if (chain.points.length < 2) continue
      const hw = chain.width === 'wide' ? 12 : chain.width === 'medium' ? 8 : 5
      // 对整条 lane 做 Catmull-Rom 样条插值，然后逐小段光栅化
      const smooth = _catmullRomChain(chain.points, 0.5, Math.min(cellW, cellH) * 0.5)
      for (let i = 0; i < smooth.length - 1; i++) {
        _rasterizeRoadSeg(
          smooth[i].x, smooth[i].z, hw,
          smooth[i + 1].x, smooth[i + 1].z, hw,
          roles, res, halfW, halfH, cellW, cellH,
          ROLE_SPINE, _isProtected,
        )
      }
    }
  }

  // ── Phase 8: 计算每个格子的 cliff level（整数，SC2 式离散高度） ──
  const cellHeights = new Float32Array(res * res)
  const isRamp = new Uint8Array(res * res)

  // 填充区域高度（取整为 cliff level）
  for (let i = 0; i < res * res; i++) {
    const zIdx = ownership[i]
    cellHeights[i] = (zIdx >= 0 && zIdx < extZones.length) ? Math.round(extZones[zIdx].height) : 0
  }

  // 用道路高度覆盖（保护区除外）
  if (roadHeightMap) {
    // 骨架格子：沿 Catmull-Rom 平滑路径应用高度（与 Phase 7 角色标记使用同一几何）
    if (spine && spine.type !== 'open') {
      const nodeMap2 = new Map(spine.nodes.map(n => [n.id, n]))
      const usableW2 = halfW - 8
      const usableH2 = halfH - 8

      const laneChains2 = _buildLaneChainsWithIds(spine, nodeMap2, usableW2, usableH2)

      for (const chain of laneChains2) {
        if (chain.points.length < 2) continue
        const hw2 = chain.width === 'wide' ? 12 : chain.width === 'medium' ? 8 : 5

        // 获取链上每个节点的高度
        const nodeHeights: number[] = chain.nodeIds.map(id => {
          const h = roadHeightMap.spineNodeHeights.get(id)
          return h != null ? Math.round(h) : 0
        })

        // 对链做 Catmull-Rom 平滑（与 Phase 7 一致）
        const smooth = _catmullRomChain(chain.points, 0.5, Math.min(cellW, cellH) * 0.5)

        // 计算原始节点链的累积距离，用于将 smooth 点映射回节点高度
        const nodeDists: number[] = [0]
        for (let i = 1; i < chain.points.length; i++) {
          const dx = chain.points[i].x - chain.points[i - 1].x
          const dz = chain.points[i].z - chain.points[i - 1].z
          nodeDists.push(nodeDists[i - 1] + Math.sqrt(dx * dx + dz * dz))
        }
        const totalNodeDist = nodeDists[nodeDists.length - 1] || 1

        // 计算 smooth 链的累积距离
        const smoothDists: number[] = [0]
        for (let i = 1; i < smooth.length; i++) {
          const dx = smooth[i].x - smooth[i - 1].x
          const dz = smooth[i].z - smooth[i - 1].z
          smoothDists.push(smoothDists[i - 1] + Math.sqrt(dx * dx + dz * dz))
        }
        const totalSmoothDist = smoothDists[smoothDists.length - 1] || 1

        // 先算出每个 smooth 点的高度（阶梯值）
        const smoothHeights: number[] = []
        for (let i = 0; i < smooth.length; i++) {
          const t = smoothDists[i] / totalSmoothDist
          smoothHeights.push(_sampleChainHeight(t * totalNodeDist, nodeDists, nodeHeights))
        }

        // 沿 smooth 路径逐段应用高度
        for (let i = 0; i < smooth.length - 1; i++) {
          let h0 = smoothHeights[i]
          let h1 = smoothHeights[i + 1]

          // 如果这一段内高度相同，但下一段高度不同，
          // 说明分段边界在 smooth[i+1] 处。
          // 把这一段的终点高度设为下一段的高度，让 _applyHeightToRoadSeg 在这一段内产生坡道。
          // 同理，如果上一段和这一段高度不同，让这一段的起点带上上一段的高度。
          // 这样坡道就出现在分段边界附近的那一个 smooth 段上。

          _applyHeightToRoadSeg(
            smooth[i].x, smooth[i].z, h0, smooth[i + 1].x, smooth[i + 1].z, h1, hw2,
            cellHeights, isRamp, roles, ownership, res, halfW, halfH, cellW, cellH,
            extZones, ROLE_SPINE,
          )

          // 在每个连接点画圆形填充，堵住相邻矩形转角处的缝隙
          if (i > 0) {
            _fillJointCircle(
              smooth[i].x, smooth[i].z, h0, hw2,
              cellHeights, isRamp, roles, ownership, res, halfW, halfH, cellW, cellH,
              extZones, ROLE_SPINE,
            )
          }
        }
      }
    }

    // 支路格子：用支路高度
    for (let ri = 0; ri < roads.roads.length; ri++) {
      const road = roads.roads[ri]
      const rh = roadHeightMap.roadHeights[ri]
      if (!rh) continue

      const wps = road.waypoints
      if (wps.length < 2) continue

      const totalLen = _waypointTotalLength(wps)
      if (totalLen < 0.01) continue

      let accLen = 0
      for (let i = 0; i < wps.length - 1; i++) {
        const w0 = wps[i], w1 = wps[i + 1]
        const dx = w1.x - w0.x, dz = w1.z - w0.z
        const segLen = Math.sqrt(dx * dx + dz * dz)

        const t0 = accLen / totalLen
        const t1 = (accLen + segLen) / totalLen
        const h0 = Math.round(_interpolateRoadHeight(rh.startHeight, rh.endHeight, rh.rampT, t0))
        const h1 = Math.round(_interpolateRoadHeight(rh.startHeight, rh.endHeight, rh.rampT, t1))

        const roadHw = Math.max(w0.halfWidth, 1)

        _applyHeightToRoadSeg(
          w0.x, w0.z, h0, w1.x, w1.z, h1,
          roadHw,
          cellHeights, isRamp, roles, ownership, res, halfW, halfH, cellW, cellH,
          extZones, ROLE_ROAD,
        )

        if (i > 0) {
          _fillJointCircle(
            w0.x, w0.z, h0, roadHw,
            cellHeights, isRamp, roles, ownership, res, halfW, halfH, cellW, cellH,
            extZones, ROLE_ROAD,
          )
        }

        accLen += segLen
      }
    }
  }

  // ── Phase 8b: 非基地区域高度服从骨架 ──
  // battlefield/passage/wasteland/anchor 都不应该影响骨架高度。
  // 如果骨架穿过这些区域，把区域内非骨架格子统一到骨架的多数高度。
  {
    const zoneRoadHeightVotes = new Map<number, Map<number, number>>()

    for (let i = 0; i < res * res; i++) {
      if (roles[i] < ROLE_ROAD) continue
      const zIdx = ownership[i]
      if (zIdx < 0 || zIdx >= extZones.length) continue
      const z = extZones[zIdx]
      if (z.type === 'main_base' || z.type === 'expansion') continue

      if (!zoneRoadHeightVotes.has(zIdx)) zoneRoadHeightVotes.set(zIdx, new Map())
      const votes = zoneRoadHeightVotes.get(zIdx)!
      const h = cellHeights[i]
      votes.set(h, (votes.get(h) ?? 0) + 1)
    }

    for (const [zIdx, votes] of zoneRoadHeightVotes) {
      let roadH = 0, maxCount = 0
      for (const [h, count] of votes) {
        if (count > maxCount) { maxCount = count; roadH = h }
      }

      for (let i = 0; i < res * res; i++) {
        if (ownership[i] !== zIdx) continue
        if (roles[i] >= ROLE_ROAD) continue
        cellHeights[i] = roadH
      }
    }
  }

  // ── Phase 8c: 基地边角高度修正 ──
  // main_base/expansion 的 Voronoi 领地可能延伸到远超核心半径的地方。
  // 这些边角格子保持基地的高度(2)，但它们紧邻低地，造成不自然的小凸起。
  // 修复：超出基地核心半径 1.3 倍的格子，如果邻居中多数高度更低，则降低到邻居高度。
  {
    const EXTEND_RATIO = 1.3
    for (let row = 1; row < res - 1; row++) {
      for (let col = 1; col < res - 1; col++) {
        const idx = row * res + col
        const zIdx = ownership[idx]
        if (zIdx < 0 || zIdx >= extZones.length) continue
        const z = extZones[zIdx]
        if (z.type !== 'main_base' && z.type !== 'expansion') continue

        const wx = (col + 0.5) * cellW - halfW
        const wz = (row + 0.5) * cellH - halfH
        const dx = wx - z.cx, dz = wz - z.cz
        const dist2 = dx * dx + dz * dz
        const threshold = z.radius * EXTEND_RATIO
        if (dist2 < threshold * threshold) continue

        const myH = cellHeights[idx]
        let lowerCount = 0, totalNeighbors = 0
        let dominantLowerH = 0, dominantCount = 0
        const hCounts = new Map<number, number>()
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue
            const ni = (row + dr) * res + (col + dc)
            const nh = cellHeights[ni]
            totalNeighbors++
            if (nh < myH) {
              lowerCount++
              hCounts.set(nh, (hCounts.get(nh) ?? 0) + 1)
            }
          }
        }
        if (lowerCount < 3) continue

        for (const [h, c] of hCounts) {
          if (c > dominantCount) { dominantCount = c; dominantLowerH = h }
        }
        cellHeights[idx] = dominantLowerH
      }
    }
  }

  // ── Phase 9: 孤岛消除 ──
  // 道路穿过区域后可能把区域切成碎片，小碎片如果高度和周围不同就会凸起。
  // BFS 找到每个连通的同高度区域，如果面积太小就把高度改成周围最多的高度。
  {
    const MIN_ISLAND_SIZE = 40
    const visitedH = new Uint8Array(res * res)

    for (let row = 0; row < res; row++) {
      for (let col = 0; col < res; col++) {
        const idx = row * res + col
        if (visitedH[idx]) continue
        visitedH[idx] = 1

        const h = cellHeights[idx]
        const cells: number[] = [idx]
        const queue: number[] = [idx]

        // BFS 找同高度连通区域
        while (queue.length > 0) {
          const cur = queue.pop()!
          const cr = Math.floor(cur / res), cc = cur % res
          for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
            const nr = cr + dr, nc = cc + dc
            if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
            const ni = nr * res + nc
            if (visitedH[ni]) continue
            if (cellHeights[ni] !== h) continue
            visitedH[ni] = 1
            cells.push(ni)
            queue.push(ni)
          }
        }

        if (cells.length >= MIN_ISLAND_SIZE) continue

        // 跳过保护区内的小区域
        let isProtectedIsland = false
        for (const ci of cells) {
          const zIdx = ownership[ci]
          if (zIdx >= 0 && zIdx < extZones.length) {
            const z = extZones[zIdx]
            if (z.type === 'main_base' || z.type === 'expansion') {
              isProtectedIsland = true
              break
            }
          }
        }
        if (isProtectedIsland) continue

        // 找边界邻居中出现最多的其他高度
        const neighborHeights = new Map<number, number>()
        for (const ci of cells) {
          const cr = Math.floor(ci / res), cc = ci % res
          for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
            const nr = cr + dr, nc = cc + dc
            if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
            const ni = nr * res + nc
            const nh = cellHeights[ni]
            if (nh !== h) {
              neighborHeights.set(nh, (neighborHeights.get(nh) ?? 0) + 1)
            }
          }
        }

        let bestH = h, bestCount = 0
        for (const [nh, count] of neighborHeights) {
          if (count > bestCount) { bestCount = count; bestH = nh }
        }

        if (bestH !== h) {
          for (const ci of cells) {
            cellHeights[ci] = bestH
          }
        }
      }
    }
  }

  // ── Phase 9b: 小碎片区域高度修正 ──
  // 骨架切割区域后可能留下窄条或小块碎片，如果碎片的宽度或长度小于 4 个建筑格子，
  // 把碎片高度降到周边最低高度，避免不自然的窄高地凸起。
  {
    const MIN_DIMENSION_CELLS = 4
    const visitedFrag = new Uint8Array(res * res)

    for (let row = 0; row < res; row++) {
      for (let col = 0; col < res; col++) {
        const idx = row * res + col
        if (visitedFrag[idx]) continue
        visitedFrag[idx] = 1

        const zIdx = ownership[idx]
        if (zIdx < 0 || zIdx >= extZones.length) continue
        const z = extZones[zIdx]
        if (z.type === 'main_base' || z.type === 'expansion') continue
        if (roles[idx] >= ROLE_ROAD) continue

        const h = cellHeights[idx]

        // BFS 找同区域、同高度、非道路的连通区域（即一个碎片）
        const cells: number[] = [idx]
        const queue: number[] = [idx]
        let minRow = row, maxRow = row, minCol = col, maxCol = col

        while (queue.length > 0) {
          const cur = queue.pop()!
          const cr = Math.floor(cur / res), cc = cur % res
          for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
            const nr = cr + dr, nc = cc + dc
            if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
            const ni = nr * res + nc
            if (visitedFrag[ni]) continue
            if (ownership[ni] !== zIdx) continue
            if (roles[ni] >= ROLE_ROAD) continue
            if (cellHeights[ni] !== h) continue
            visitedFrag[ni] = 1
            cells.push(ni)
            queue.push(ni)
            if (nr < minRow) minRow = nr
            if (nr > maxRow) maxRow = nr
            if (nc < minCol) minCol = nc
            if (nc > maxCol) maxCol = nc
          }
        }

        const fragWidth = maxCol - minCol + 1
        const fragHeight = maxRow - minRow + 1

        if (fragWidth >= MIN_DIMENSION_CELLS && fragHeight >= MIN_DIMENSION_CELLS) continue

        // 碎片太小，找周边最低高度
        let lowestNeighborH = h
        for (const ci of cells) {
          const cr = Math.floor(ci / res), cc = ci % res
          for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
            const nr = cr + dr, nc = cc + dc
            if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
            const ni = nr * res + nc
            const nh = cellHeights[ni]
            if (nh < lowestNeighborH) lowestNeighborH = nh
          }
        }

        if (lowestNeighborH < h) {
          for (const ci of cells) {
            cellHeights[ci] = lowestNeighborH
          }
        }
      }
    }
  }

  // ── Phase 9c: 沿骨架路径生成坡道 ──
  // 沿骨架 smooth 路径读取 cellHeights，在高度变化处：
  //   1. 直接生成 RampDef（方向 = 骨架前进方向，A端=高，B端=低）
  //   2. 标记 isRamp 网格（供 terrainGen 排除悬崖边缘）
  const CLIFF_VISUAL_HEIGHT = 2.0
  const spineRamps: RampDef[] = []

  if (roadHeightMap && spine && spine.type !== 'open') {
    const nodeMap3 = new Map(spine.nodes.map(n => [n.id, n]))
    const usableW3 = halfW - 8
    const usableH3 = halfH - 8
    const laneChains3 = _buildLaneChainsWithIds(spine, nodeMap3, usableW3, usableH3)

    for (let i = 0; i < res * res; i++) isRamp[i] = 0

    for (const chain of laneChains3) {
      if (chain.points.length < 2) continue
      const hw = chain.width === 'wide' ? 12 : chain.width === 'medium' ? 8 : 5
      const smooth = _catmullRomChain(chain.points, 0.5, Math.min(cellW, cellH) * 0.5)
      if (smooth.length < 2) continue

      let prevH: number
      let prevX = smooth[0].x, prevZ = smooth[0].z
      {
        const c0 = Math.max(0, Math.min(res - 1, Math.round((smooth[0].x + halfW) / cellW)))
        const r0 = Math.max(0, Math.min(res - 1, Math.round((smooth[0].z + halfH) / cellH)))
        prevH = Math.round(cellHeights[r0 * res + c0])
      }

      const RAMP_HALF_LEN = Math.max(hw * 0.8, 4)
      const RAMP_WIDTH = Math.max(hw * 0.8, 3)
      const MIN_SKIP = Math.ceil((RAMP_HALF_LEN * 2) / (Math.min(cellW, cellH) * 0.5))
      let skipUntil = 0

      for (let k = 1; k < smooth.length; k++) {
        const px = smooth[k].x, pz = smooth[k].z
        const col = Math.max(0, Math.min(res - 1, Math.round((px + halfW) / cellW)))
        const row = Math.max(0, Math.min(res - 1, Math.round((pz + halfH) / cellH)))
        const curH = Math.round(cellHeights[row * res + col])

        if (curH !== prevH && prevH !== -999 && k >= skipUntil) {
          const cx = (prevX + px) / 2
          const cz = (prevZ + pz) / 2

          // 用前后较远的点来确定方向，避免相邻 smooth 点距离太短导致方向不稳定
          const lookBack = Math.max(0, k - Math.ceil(RAMP_HALF_LEN / (Math.min(cellW, cellH) * 0.5)))
          const lookFwd = Math.min(smooth.length - 1, k + Math.ceil(RAMP_HALF_LEN / (Math.min(cellW, cellH) * 0.5)))
          const dx = smooth[lookFwd].x - smooth[lookBack].x
          const dz = smooth[lookFwd].z - smooth[lookBack].z
          const len = Math.sqrt(dx * dx + dz * dz)
          const ux = len > 0.01 ? dx / len : 1
          const uz = len > 0.01 ? dz / len : 0

          const highH = Math.max(prevH, curH)
          const lowH = Math.min(prevH, curH)

          // A端 = 高处, B端 = 低处
          // 如果 prevH > curH，高端在后方（逆骨架方向），低端在前方
          // 如果 prevH < curH，高端在前方，低端在后方
          let ax: number, az: number, bx: number, bz: number
          if (prevH > curH) {
            ax = cx - ux * RAMP_HALF_LEN
            az = cz - uz * RAMP_HALF_LEN
            bx = cx + ux * RAMP_HALF_LEN
            bz = cz + uz * RAMP_HALF_LEN
          } else {
            ax = cx + ux * RAMP_HALF_LEN
            az = cz + uz * RAMP_HALF_LEN
            bx = cx - ux * RAMP_HALF_LEN
            bz = cz - uz * RAMP_HALF_LEN
          }

          spineRamps.push({
            ax, az, bx, bz,
            width: RAMP_WIDTH,
            hA: highH * CLIFF_VISUAL_HEIGHT,
            hB: lowH * CLIFF_VISUAL_HEIGHT,
            pathWidth: Math.max(RAMP_WIDTH * 0.6, 2),
          })

          // 在坡道区域标记 isRamp（给 terrainGen 用于排除悬崖边缘）
          const vx = -uz, vz2 = ux
          const markHalfLen = RAMP_HALF_LEN + 2
          const markHalfW = RAMP_WIDTH + 2
          const c0 = Math.max(0, Math.floor((cx - markHalfLen - markHalfW + halfW) / cellW))
          const c1 = Math.min(res - 1, Math.ceil((cx + markHalfLen + markHalfW + halfW) / cellW))
          const r0 = Math.max(0, Math.floor((cz - markHalfLen - markHalfW + halfH) / cellH))
          const r1 = Math.min(res - 1, Math.ceil((cz + markHalfLen + markHalfW + halfH) / cellH))

          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const wx = (c + 0.5) * cellW - halfW
              const wz = (r + 0.5) * cellH - halfH
              const lx = (wx - cx) * ux + (wz - cz) * uz
              const ly = (wx - cx) * vx + (wz - cz) * vz2
              if (Math.abs(lx) <= markHalfLen && Math.abs(ly) <= markHalfW) {
                isRamp[r * res + c] = 1
              }
            }
          }

          console.log(`[Phase9c] ramp at (${cx.toFixed(1)},${cz.toFixed(1)}) h=${highH}->${lowH} dir=(${ux.toFixed(2)},${uz.toFixed(2)}) A=(${ax.toFixed(1)},${az.toFixed(1)}) B=(${bx.toFixed(1)},${bz.toFixed(1)})`)

          skipUntil = k + MIN_SKIP
        }

        prevH = curH
        prevX = px; prevZ = pz
      }
    }

    console.log(`[Phase9c] spineRamps=${spineRamps.length}`)
    let totalRamp = 0
    for (let i = 0; i < res * res; i++) if (isRamp[i]) totalRamp++
    console.log(`[Phase9c] totalRampCells=${totalRamp}`)
  }

  return { ownership, roles, cellHeights, isRamp, spineRamps, res, mapWidth, mapHeight, zones: extZones }
}

// ── 光栅化道路段 ──

function _rasterizeRoadSeg(
  ax: number, az: number, ahw: number,
  bx: number, bz: number, bhw: number,
  roles: Uint8Array,
  res: number,
  halfW: number, halfH: number,
  cellW: number, cellH: number,
  roleValue: number,
  isProtected: (wx: number, wz: number) => boolean,
): void {
  const dx = bx - ax, dz = bz - az
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 0.01) return

  const steps = Math.ceil(len / (Math.min(cellW, cellH) * 0.5))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const px = ax + dx * t
    const pz = az + dz * t
    const hw = ahw + (bhw - ahw) * t

    const col0 = Math.floor((px - hw + halfW) / cellW)
    const col1 = Math.ceil((px + hw + halfW) / cellW)
    const row0 = Math.floor((pz - hw + halfH) / cellH)
    const row1 = Math.ceil((pz + hw + halfH) / cellH)

    for (let r = Math.max(0, row0); r < Math.min(res, row1); r++) {
      for (let c = Math.max(0, col0); c < Math.min(res, col1); c++) {
        const wx = (c + 0.5) * cellW - halfW
        const wz = (r + 0.5) * cellH - halfH
        const ddx = wx - px, ddz = wz - pz
        if (ddx * ddx + ddz * ddz <= hw * hw) {
          const idx = r * res + c
          if (isProtected(wx, wz) && roles[idx] === ROLE_INTERIOR) continue
          if (roles[idx] < roleValue) {
            roles[idx] = roleValue
          }
        }
      }
    }
  }
}

// ── 骨架 lane 链构建 ──

interface LaneChain {
  points: { x: number; z: number }[]
  width: 'wide' | 'medium' | 'narrow'
}

interface LaneChainWithIds extends LaneChain {
  nodeIds: string[]
}

/** 与 _buildLaneChains 相同，但额外返回每个节点的 ID（用于高度查找） */
function _buildLaneChainsWithIds(
  spine: Spine,
  nodeMap: Map<string, import('./SpineGenerator').SpineNode>,
  usableW: number, usableH: number,
): LaneChainWithIds[] {
  const laneGroups = new Map<string, import('./SpineGenerator').SpinePath[]>()
  for (const p of spine.paths) {
    if (p.lane === 'cross') continue
    const arr = laneGroups.get(p.lane) ?? []
    arr.push(p)
    laneGroups.set(p.lane, arr)
  }

  const chains: LaneChainWithIds[] = []

  for (const [, paths] of laneGroups) {
    if (paths.length === 0) continue
    const adj = new Map<string, { to: string; width: 'wide' | 'medium' | 'narrow' }>()
    const inDeg = new Map<string, number>()
    for (const p of paths) {
      adj.set(p.from, { to: p.to, width: p.width })
      inDeg.set(p.to, (inDeg.get(p.to) ?? 0) + 1)
      if (!inDeg.has(p.from)) inDeg.set(p.from, 0)
    }

    let start = paths[0].from
    for (const [nodeId, deg] of inDeg) {
      if (deg === 0 && adj.has(nodeId)) { start = nodeId; break }
    }

    const orderedIds: string[] = [start]
    let width: 'wide' | 'medium' | 'narrow' = 'medium'
    let cur = start
    const visited = new Set<string>()
    while (adj.has(cur) && !visited.has(cur)) {
      visited.add(cur)
      const next = adj.get(cur)!
      width = next.width
      orderedIds.push(next.to)
      cur = next.to
    }

    const pts: { x: number; z: number }[] = []
    for (const id of orderedIds) {
      const node = nodeMap.get(id)
      if (!node) continue
      pts.push({ x: node.position.x * usableW, z: node.position.z * usableH })
    }

    if (pts.length >= 2) {
      chains.push({ points: pts, width, nodeIds: orderedIds })
    }
  }

  return chains
}

/** 在节点距离序列上线性插值高度 */
function _sampleChainHeight(
  dist: number,
  nodeDists: number[],
  nodeHeights: number[],
): number {
  if (nodeDists.length <= 1) return nodeHeights[0] ?? 0
  // 不做线性插值——用最近节点的高度（阶梯函数）
  // 在两个节点之间，前半段用前节点高度，后半段用后节点高度
  for (let i = 0; i < nodeDists.length - 1; i++) {
    if (dist <= nodeDists[i + 1]) {
      const segLen = nodeDists[i + 1] - nodeDists[i]
      if (segLen < 0.01) return Math.round(nodeHeights[i])
      const t = (dist - nodeDists[i]) / segLen
      return Math.round(t < 0.5 ? nodeHeights[i] : nodeHeights[i + 1])
    }
  }
  return Math.round(nodeHeights[nodeHeights.length - 1])
}

function _buildLaneChains(
  spine: Spine,
  nodeMap: Map<string, import('./SpineGenerator').SpineNode>,
  usableW: number, usableH: number,
): LaneChain[] {
  // 按 lane 分组 paths，跳过 crossing
  const laneGroups = new Map<string, import('./SpineGenerator').SpinePath[]>()
  for (const p of spine.paths) {
    if (p.lane === 'cross') continue
    const arr = laneGroups.get(p.lane) ?? []
    arr.push(p)
    laneGroups.set(p.lane, arr)
  }

  const chains: LaneChain[] = []

  for (const [, paths] of laneGroups) {
    if (paths.length === 0) continue
    // 重建有序链：从第一个 path 的 from 开始，沿 to 方向走
    const adj = new Map<string, { to: string; width: 'wide' | 'medium' | 'narrow' }>()
    const inDeg = new Map<string, number>()
    for (const p of paths) {
      adj.set(p.from, { to: p.to, width: p.width })
      inDeg.set(p.to, (inDeg.get(p.to) ?? 0) + 1)
      if (!inDeg.has(p.from)) inDeg.set(p.from, 0)
    }

    // 找链头（入度为 0 的节点）
    let start = paths[0].from
    for (const [nodeId, deg] of inDeg) {
      if (deg === 0 && adj.has(nodeId)) { start = nodeId; break }
    }

    const orderedIds: string[] = [start]
    let width: 'wide' | 'medium' | 'narrow' = 'medium'
    let cur = start
    const visited = new Set<string>()
    while (adj.has(cur) && !visited.has(cur)) {
      visited.add(cur)
      const next = adj.get(cur)!
      width = next.width
      orderedIds.push(next.to)
      cur = next.to
    }

    const pts: { x: number; z: number }[] = []
    for (const id of orderedIds) {
      const node = nodeMap.get(id)
      if (!node) continue
      pts.push({ x: node.position.x * usableW, z: node.position.z * usableH })
    }

    if (pts.length >= 2) {
      chains.push({ points: pts, width })
    }
  }

  return chains
}

// ── Catmull-Rom 样条插值 ──

function _catmullRomChain(
  points: { x: number; z: number }[],
  tension: number,
  stepSize: number,
): { x: number; z: number }[] {
  if (points.length < 2) return [...points]
  if (points.length === 2) return [...points]

  const result: { x: number; z: number }[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    const segDx = p2.x - p1.x, segDz = p2.z - p1.z
    const segLen = Math.sqrt(segDx * segDx + segDz * segDz)
    const steps = Math.max(2, Math.ceil(segLen / stepSize))

    for (let s = 0; s < steps; s++) {
      const t = s / steps
      result.push(_catmullRomPoint(p0, p1, p2, p3, t, tension))
    }
  }

  result.push(points[points.length - 1])
  return result
}

function _catmullRomPoint(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
  alpha: number,
): { x: number; z: number } {
  const t2 = t * t
  const t3 = t2 * t

  const m1x = alpha * (p2.x - p0.x)
  const m1z = alpha * (p2.z - p0.z)
  const m2x = alpha * (p3.x - p1.x)
  const m2z = alpha * (p3.z - p1.z)

  const a = 2 * t3 - 3 * t2 + 1
  const b = t3 - 2 * t2 + t
  const c = -2 * t3 + 3 * t2
  const d = t3 - t2

  return {
    x: a * p1.x + b * m1x + c * p2.x + d * m2x,
    z: a * p1.z + b * m1z + c * p2.z + d * m2z,
  }
}

// ── 道路高度覆盖辅助函数 ──

/**
 * 将一段道路的 cliff level 写入 cellHeights 数组。
 * 只覆盖已被标记为指定 role 的格子，且跳过保护区内部。
 * 当起止高度不同时，在过渡区域标记 isRamp。
 */
function _applyHeightToRoadSeg(
  ax: number, az: number, hA: number,
  bx: number, bz: number, hB: number,
  hw: number,
  cellHeights: Float32Array,
  isRamp: Uint8Array,
  roles: Uint8Array,
  ownership: Int16Array,
  res: number,
  halfW: number, halfH: number,
  cellW: number, cellH: number,
  zones: PlacedZone[],
  targetRole: number,
): void {
  const dx = bx - ax, dz = bz - az
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 0.01) return

  const intA = Math.round(hA)
  const intB = Math.round(hB)
  const hasHeightChange = intA !== intB

  // 高度过渡策略：
  //   - t < 0.5 → 全部 hA（高端 cliff level）
  //   - t >= 0.5 → 全部 hB（低端 cliff level）
  //   - 过渡区（0.35~0.65）仅标记 isRamp，不做高度插值
  //     → 实际的高度渐变由 V1 terrainGen 的 RampDef + orientedRectTest 处理
  const RAMP_START = 0.35
  const RAMP_END = 0.65

  const steps = Math.ceil(len / (Math.min(cellW, cellH) * 0.5))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const px = ax + dx * t
    const pz = az + dz * t

    // 整数 cliff level，不做渐变
    const h = t < 0.5 ? intA : intB
    const rampFlag = hasHeightChange && t >= RAMP_START && t <= RAMP_END

    const col0 = Math.floor((px - hw + halfW) / cellW)
    const col1 = Math.ceil((px + hw + halfW) / cellW)
    const row0 = Math.floor((pz - hw + halfH) / cellH)
    const row1 = Math.ceil((pz + hw + halfH) / cellH)

    for (let r = Math.max(0, row0); r < Math.min(res, row1); r++) {
      for (let c = Math.max(0, col0); c < Math.min(res, col1); c++) {
        const idx = r * res + c

        const zIdx = ownership[idx]
        if (zIdx >= 0 && zIdx < zones.length) {
          const z = zones[zIdx]
          if (z.type === 'main_base' || z.type === 'expansion') {
            continue
          }
        }

        const wx = (c + 0.5) * cellW - halfW
        const wz = (r + 0.5) * cellH - halfH
        const ddx = wx - px, ddz = wz - pz
        if (ddx * ddx + ddz * ddz > hw * hw) continue

        cellHeights[idx] = h

        if (roles[idx] < targetRole) {
          roles[idx] = targetRole
        }

        if (rampFlag) {
          isRamp[idx] = 1
        }
      }
    }
  }
}

/**
 * 在路径连接点画圆形填充，堵住相邻矩形段转角处的三角缝隙。
 */
function _fillJointCircle(
  cx: number, cz: number, h: number, hw: number,
  cellHeights: Float32Array,
  isRamp: Uint8Array,
  roles: Uint8Array,
  ownership: Int16Array,
  res: number,
  halfW: number, halfH: number,
  cellW: number, cellH: number,
  zones: PlacedZone[],
  targetRole: number,
): void {
  const col0 = Math.floor((cx - hw + halfW) / cellW)
  const col1 = Math.ceil((cx + hw + halfW) / cellW)
  const row0 = Math.floor((cz - hw + halfH) / cellH)
  const row1 = Math.ceil((cz + hw + halfH) / cellH)
  const intH = Math.round(h)

  for (let r = Math.max(0, row0); r < Math.min(res, row1); r++) {
    for (let c = Math.max(0, col0); c < Math.min(res, col1); c++) {
      const idx = r * res + c

      const zIdx = ownership[idx]
      if (zIdx >= 0 && zIdx < zones.length) {
        const z = zones[zIdx]
        if (z.type === 'main_base' || z.type === 'expansion') continue
      }

      const wx = (c + 0.5) * cellW - halfW
      const wz = (r + 0.5) * cellH - halfH
      const ddx = wx - cx, ddz = wz - cz
      if (ddx * ddx + ddz * ddz > hw * hw) continue

      cellHeights[idx] = intH
      if (roles[idx] < targetRole) {
        roles[idx] = targetRole
      }
    }
  }
}

/** 计算路点序列的总长度 */
function _waypointTotalLength(wps: { x: number; z: number }[]): number {
  let total = 0
  for (let i = 0; i < wps.length - 1; i++) {
    const dx = wps[i + 1].x - wps[i].x, dz = wps[i + 1].z - wps[i].z
    total += Math.sqrt(dx * dx + dz * dz)
  }
  return total
}

/**
 * 根据坡道位置插值道路高度。
 *
 * 道路高度不是线性斜坡，而是固定段 + 局部坡道：
 *   - t < rampT - 0.05: 使用 startHeight
 *   - t > rampT + 0.05: 使用 endHeight
 *   - rampT ± 0.05: 线性过渡（坡道区域）
 *   - rampT < 0: 无坡道，全程使用 startHeight
 */
function _interpolateRoadHeight(
  startH: number, endH: number, rampT: number, t: number,
): number {
  if (rampT < 0 || startH === endH) return startH

  const rampHalfLen = 0.05
  const rampStart = rampT - rampHalfLen
  const rampEnd = rampT + rampHalfLen

  if (t <= rampStart) return startH
  if (t >= rampEnd) return endH

  const localT = (t - rampStart) / (rampEnd - rampStart)
  return startH + (endH - startH) * localT
}

// ── 简单 2D value noise ──

function _noise2D(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)

  const n00 = _hash(ix, iy)
  const n10 = _hash(ix + 1, iy)
  const n01 = _hash(ix, iy + 1)
  const n11 = _hash(ix + 1, iy + 1)

  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) +
         (n01 * (1 - sx) + n11 * sx) * sy
}

function _hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h & 0x7fffffff) / 0x7fffffff - 0.5
}
