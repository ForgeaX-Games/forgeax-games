/**
 * 道路高度分配器
 *
 * 为骨架主路和支路分配高度段，生成坡道标记。
 *
 * 设计原则：
 *   1. 骨架主路按大段落分配高度（0 ~ maxHeight-1），段落不能太碎
 *   2. 基地 = maxHeight（最高），道路从基地边缘坡道下来后才开始
 *   3. 支路高度：从所连区域边缘高度（坡道底部）到骨架连接点高度
 *   4. 坡道只存在于两个不同高度之间的过渡点，是局部短坡道
 *   5. 不可侵犯区域（main_base / expansion）的高度不受道路影响
 *   6. 对称地图中骨架高度也对称
 */

import type { Spine, SpineNode } from './SpineGenerator'
import type { PlacedZoneGraph, PlacedZone } from './ZoneGraph'
import type { RoadNetwork, RoadSegment } from './RoadGenerator'
import type { SymmetryMode } from './SymmetryFramework'
import { mirrorPoint } from './SymmetryFramework'
import { SeededRandom } from './SeededRandom'

// ── 输出 ──

export interface RoadHeightMap {
  /** 骨架节点 id → 该节点处的高度（cliff level） */
  spineNodeHeights: Map<string, number>
  /** 每条支路的高度信息（与 RoadNetwork.roads 索引对应） */
  roadHeights: RoadHeightInfo[]
}

export interface RoadHeightInfo {
  startHeight: number
  endHeight: number
  /** 坡道位置（0~1 的 t 值），-1 表示无坡道（高度相同） */
  rampT: number
}

// ── 配置 ──

// ── 主函数 ──

export function assignRoadHeights(
  spine: Spine,
  graph: PlacedZoneGraph,
  roads: RoadNetwork,
  symmetry: SymmetryMode,
  maxHeight: number,
  seed: number = 42,
): RoadHeightMap {
  const rng = new SeededRandom(seed + 777)

  const spineNodeHeights = new Map<string, number>()

  if (spine.type === 'open' || spine.nodes.length === 0) {
    return { spineNodeHeights, roadHeights: _assignBranchHeightsSimple(roads, graph, spineNodeHeights) }
  }

  // ── Step 1: 为骨架节点分配高度 ──
  _assignSpineHeights(spine, symmetry, maxHeight, rng, spineNodeHeights)

  // ── Step 2: 为支路分配高度 ──
  const roadHeights = _assignBranchHeights(roads, graph, spineNodeHeights, spine)

  return { spineNodeHeights, roadHeights }
}

// ── 骨架高度分配 ──

function _assignSpineHeights(
  spine: Spine,
  symmetry: SymmetryMode,
  maxHeight: number,
  rng: SeededRandom,
  out: Map<string, number>,
): void {
  const roadMaxH = Math.max(0, maxHeight - 1)

  const laneGroups = new Map<string, typeof spine.paths>()
  for (const p of spine.paths) {
    if (p.lane === 'cross') continue
    const arr = laneGroups.get(p.lane) ?? []
    arr.push(p)
    laneGroups.set(p.lane, arr)
  }

  const baseNodes = spine.nodes.filter(n => n.role === 'base')
  for (const bn of baseNodes) {
    out.set(bn.id, roadMaxH)
  }

  const nodeMap = new Map(spine.nodes.map(n => [n.id, n]))

  // 骨架节点坐标是归一化的（范围约 -1~1，对应地图的 -halfEdge~halfEdge）。
  // "每段最短距离 = 地图边长的 1/3" 换算到归一化空间：
  //   地图边长对应归一化范围 2.0，其 1/3 = 2/3 ≈ 0.667
  const minSegLen = 2.0 / 3

  // 所有 lane 共享同一套段落高度
  // 用全程距离来决定段数（全程对称镜像，但段数按全程算）
  const allChains: { chain: string[]; cumLen: number[]; halfCount: number; totalLen: number }[] = []
  let longestTotalLen = 0

  for (const [, paths] of laneGroups) {
    if (paths.length === 0) continue
    const chain = _buildOrderedChain(paths, spine.nodes)
    if (chain.length < 2) continue
    const cumLen = _computeCumulativeLength(chain, nodeMap)
    const totalLen = cumLen[cumLen.length - 1] || 0
    if (totalLen < 0.01) continue
    const halfCount = Math.ceil(chain.length / 2)
    if (totalLen > longestTotalLen) longestTotalLen = totalLen
    allChains.push({ chain, cumLen, halfCount, totalLen })
  }

  // 按全程距离决定段数：全程距离 / minSegLen，向下取整，至少 1 段
  console.log(`[SpineHeight] longestTotalLen=${longestTotalLen.toFixed(3)}, minSegLen=${minSegLen.toFixed(3)}, ratio=${(longestTotalLen/minSegLen).toFixed(3)}`)
  const maxSegs = Math.max(1, Math.floor(longestTotalLen / minSegLen))
  console.log(`[SpineHeight] maxSegs=${maxSegs}, roadMaxH=${roadMaxH}`)
  // 对称地图中段数必须是奇数才能产生高度变化（偶数段对称后首尾相同）
  // 可选段数：1, 3, 5...  用 maxSegs 限制上限
  let sharedSegCount: number
  const maxOddSegs = maxSegs % 2 === 0 ? maxSegs - 1 : maxSegs
  if (maxOddSegs <= 1 || roadMaxH <= 0) {
    sharedSegCount = 1
  } else {
    // 只要距离够分 3 段，就分 3 段（保证有高度变化）
    sharedSegCount = 3
    if (maxOddSegs >= 5 && rng.nextFloat(0, 1) < 0.3) sharedSegCount = 5
    if (sharedSegCount > maxOddSegs) sharedSegCount = maxOddSegs
  }

  // 直接生成全部段落高度，然后强制首尾对称
  const fullSegHeights = _decideSegmentHeights(sharedSegCount, roadMaxH, rng)
  // 强制对称：后半段镜像前半段
  for (let i = 0; i < Math.floor(sharedSegCount / 2); i++) {
    fullSegHeights[sharedSegCount - 1 - i] = fullSegHeights[i]
  }
  console.log(`[SpineHeight] sharedSegCount=${sharedSegCount}, fullSegHeights=[${fullSegHeights}]`)

  for (const { chain, cumLen, totalLen } of allChains) {
    // 按全程距离均匀分段
    const segBoundaries = _computeSegBoundaries(sharedSegCount, totalLen, rng)

    for (let i = 0; i < chain.length; i++) {
      const nodeId = chain[i]
      if (out.has(nodeId)) continue

      const d = cumLen[i]
      let segIdx = 0
      for (let s = 0; s < segBoundaries.length; s++) {
        if (d >= segBoundaries[s]) segIdx = s + 1
      }
      segIdx = Math.min(segIdx, fullSegHeights.length - 1)
      out.set(nodeId, fullSegHeights[segIdx])
    }
  }

  // Crossing 节点：取两端 lane 节点高度的较低值
  for (const p of spine.paths) {
    if (p.lane !== 'cross') continue
    // 通常 crossing 路径直接连两个 lane 节点，没有中间节点
  }

  // 确保所有骨架节点都有高度
  for (const node of spine.nodes) {
    if (!out.has(node.id)) {
      out.set(node.id, 0)
    }
  }
}

function _buildOrderedChain(
  paths: { from: string; to: string }[],
  nodes: SpineNode[],
): string[] {
  const adj = new Map<string, string>()
  const inDeg = new Map<string, number>()
  for (const p of paths) {
    adj.set(p.from, p.to)
    inDeg.set(p.to, (inDeg.get(p.to) ?? 0) + 1)
    if (!inDeg.has(p.from)) inDeg.set(p.from, 0)
  }

  let start = paths[0].from
  for (const [nodeId, deg] of inDeg) {
    if (deg === 0 && adj.has(nodeId)) { start = nodeId; break }
  }

  const chain: string[] = [start]
  let cur = start
  const visited = new Set<string>()
  while (adj.has(cur) && !visited.has(cur)) {
    visited.add(cur)
    const next = adj.get(cur)!
    chain.push(next)
    cur = next
  }

  return chain
}

function _computeCumulativeLength(
  chain: string[],
  nodeMap: Map<string, SpineNode>,
): number[] {
  const cumLen: number[] = [0]
  for (let i = 1; i < chain.length; i++) {
    const prev = nodeMap.get(chain[i - 1])
    const curr = nodeMap.get(chain[i])
    if (!prev || !curr) {
      cumLen.push(cumLen[i - 1])
      continue
    }
    const dx = curr.position.x - prev.position.x
    const dz = curr.position.z - prev.position.z
    cumLen.push(cumLen[i - 1] + Math.sqrt(dx * dx + dz * dz))
  }
  return cumLen
}

function _decideSegmentHeights(count: number, maxH: number, rng: SeededRandom): number[] {
  if (maxH <= 0) return new Array(count).fill(0)

  const heights: number[] = []
  let lastH = -1

  for (let i = 0; i < count; i++) {
    let h: number
    if (maxH === 1) {
      // 只有 0 和 1 两个选择，交替或随机
      h = rng.nextFloat(0, 1) < 0.5 ? 0 : 1
      if (h === lastH && count > 1) h = h === 0 ? 1 : 0
    } else {
      h = rng.nextInt(maxH + 1)
      // 避免连续相同
      if (h === lastH && count > 1) {
        h = (h + 1 + rng.nextInt(maxH)) % (maxH + 1)
      }
    }
    heights.push(h)
    lastH = h
  }

  return heights
}

function _computeSegBoundaries(
  count: number,
  totalLen: number,
  rng: SeededRandom,
): number[] {
  if (count <= 1) return []

  const boundaries: number[] = []
  const baseStep = totalLen / count

  for (let i = 1; i < count; i++) {
    const base = baseStep * i
    const jitter = baseStep * 0.15 * (rng.nextFloat(0, 1) * 2 - 1)
    boundaries.push(Math.max(totalLen * 0.1, Math.min(totalLen * 0.9, base + jitter)))
  }

  return boundaries.sort((a, b) => a - b)
}

// ── 支路高度分配 ──

function _assignBranchHeights(
  roads: RoadNetwork,
  graph: PlacedZoneGraph,
  spineNodeHeights: Map<string, number>,
  spine: Spine,
): RoadHeightInfo[] {
  const zoneMap = new Map<string, PlacedZone>()
  for (const z of graph.zones) zoneMap.set(z.id, z)

  // 构建骨架节点位置索引（用于查找最近的骨架节点）
  const nodeMap = new Map(spine.nodes.map(n => [n.id, n]))
  const halfW = graph.mapWidth / 2 - 8
  const halfH = graph.mapHeight / 2 - 8

  const result: RoadHeightInfo[] = []

  for (const road of roads.roads) {
    const fromZone = zoneMap.get(road.fromZoneId)
    const toZone = zoneMap.get(road.toZoneId)

    if (!fromZone || !toZone) {
      result.push({ startHeight: 0, endHeight: 0, rampT: -1 })
      continue
    }

    // 确定起点高度
    const startH = _getZoneEdgeHeight(fromZone, spineNodeHeights, spine, halfW, halfH)
    // 确定终点高度
    const endH = _getZoneEdgeHeight(toZone, spineNodeHeights, spine, halfW, halfH)

    // 坡道位置：如果高度不同，坡道在中间偏向较低端
    let rampT = -1
    if (startH !== endH) {
      rampT = 0.5
    }

    result.push({ startHeight: startH, endHeight: endH, rampT })
  }

  return result
}

function _assignBranchHeightsSimple(
  roads: RoadNetwork,
  graph: PlacedZoneGraph,
  _spineNodeHeights: Map<string, number>,
): RoadHeightInfo[] {
  const zoneMap = new Map<string, PlacedZone>()
  for (const z of graph.zones) zoneMap.set(z.id, z)

  return roads.roads.map(road => {
    const fromZone = zoneMap.get(road.fromZoneId)
    const toZone = zoneMap.get(road.toZoneId)
    const startH = fromZone?.height ?? 0
    const endH = toZone?.height ?? 0
    return {
      startHeight: startH,
      endHeight: endH,
      rampT: startH !== endH ? 0.5 : -1,
    }
  })
}

/**
 * 获取区域边缘的道路高度。
 *
 * 规则：
 *   - main_base / expansion：这些是不可侵犯区，道路从坡道底部开始。
 *     如果区域高度 = 2，道路起点高度 = 1（下一级）
 *     如果区域高度 = 1，道路起点高度 = 0
 *   - anchor：取最近骨架节点的高度
 *   - 其他区域：直接使用区域高度
 */
function _getZoneEdgeHeight(
  zone: PlacedZone,
  spineNodeHeights: Map<string, number>,
  spine: Spine,
  halfW: number,
  halfH: number,
): number {
  if (zone.type === 'main_base' || zone.type === 'expansion') {
    return Math.max(0, zone.height - 1)
  }

  if (zone.type === 'anchor') {
    // 找最近的骨架节点
    let bestH = 0
    let bestDist = Infinity
    for (const node of spine.nodes) {
      const nx = node.position.x * halfW
      const nz = node.position.z * halfH
      const dx = zone.cx - nx, dz = zone.cz - nz
      const dist = dx * dx + dz * dz
      if (dist < bestDist) {
        bestDist = dist
        bestH = spineNodeHeights.get(node.id) ?? 0
      }
    }
    return bestH
  }

  return zone.height
}
