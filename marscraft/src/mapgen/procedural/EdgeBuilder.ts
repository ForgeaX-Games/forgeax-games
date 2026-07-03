/**
 * 空间连边器 — 根据区域放置结果计算连接关系
 *
 * 走廊型：
 *   1. 为每个 off-spine 区域（主基地、矿区）在骨架上创建锚点
 *   2. off-spine 区域 → 自己的锚点（支路）
 *   3. 锚点沿骨架串联（主干道）
 *   4. 主基地 ↔ natural 矿区（直连，同玩家同侧）
 *   5. 骨架上的区域（战场/通道）连接到最近的锚点
 *
 * 开放型：最近邻 + 规则筛选
 */

import type { PlacedZone, PlacedEdge, RoadWidth, ZoneNodeType } from './ZoneGraph'
import type { Spine } from './SpineGenerator'

// ── 返回类型 ──

export interface EdgeBuildResult {
  edges: PlacedEdge[]
  anchors: PlacedZone[]
}

// ── 骨架线段 ──

interface SpineSeg {
  ax: number; az: number
  bx: number; bz: number
  lane: string
}

// ── 主函数 ──

export function buildEdges(
  zones: PlacedZone[],
  spine: Spine,
  mapSize: { width: number; height: number },
): EdgeBuildResult {
  if (spine.type === 'open') {
    return { edges: _buildOpenEdges(zones, mapSize.width, mapSize.height), anchors: [] }
  }
  return _buildCorridorEdges(zones, spine, mapSize)
}

// ── 走廊型连边 ──

function _buildCorridorEdges(
  zones: PlacedZone[],
  spine: Spine,
  mapSize: { width: number; height: number },
): EdgeBuildResult {
  const edges: PlacedEdge[] = []
  const edgeSet = new Set<string>()

  const addEdge = (a: string, b: string, width: RoadWidth) => {
    const key = [a, b].sort().join('|')
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push({ fromId: a, toId: b, roadWidth: width, chokeWidth: 0 })
  }

  const halfW = mapSize.width / 2 - 8
  const halfH = mapSize.height / 2 - 8

  // 骨架线段（每段独立，保留 lane 信息）
  const spineSegs = _buildSpineSegments(spine, halfW, halfH)

  // 找最近骨架点
  function closestOnSpine(px: number, pz: number): { x: number; z: number; dist: number } {
    let bestDist = Infinity, bx = 0, bz = 0
    for (const s of spineSegs) {
      const { x, z, dist } = _closestOnSeg(px, pz, s.ax, s.az, s.bx, s.bz)
      if (dist < bestDist) { bestDist = dist; bx = x; bz = z }
    }
    return { x: bx, z: bz, dist: bestDist }
  }

  // 计算点到骨架的距离
  function distToSpine(px: number, pz: number): number {
    return closestOnSpine(px, pz).dist
  }

  // 沿骨架的参数 t（用于排序锚点）
  function spineT(px: number, pz: number): number {
    // 用到所有 base 节点的加权距离来估算沿骨架的位置
    const nodeMap = new Map(spine.nodes.map(n => [n.id, n]))
    const bases = spine.nodes.filter(n => n.role === 'base')
    if (bases.length < 2) return 0
    const b0 = bases[0], b1 = bases[1]
    const b0x = b0.position.x * halfW, b0z = b0.position.z * halfH
    const b1x = b1.position.x * halfW, b1z = b1.position.z * halfH
    const d0 = Math.sqrt((px - b0x) ** 2 + (pz - b0z) ** 2)
    const d1 = Math.sqrt((px - b1x) ** 2 + (pz - b1z) ** 2)
    return d0 / (d0 + d1 + 0.01)
  }

  // ── 1. 为 off-spine 区域创建骨架锚点 ──
  const OFF_SPINE_TYPES = new Set<ZoneNodeType>(['main_base', 'expansion'])
  const offSpineZones = zones.filter(z => OFF_SPINE_TYPES.has(z.type))
  const onSpineZones = zones.filter(z => !OFF_SPINE_TYPES.has(z.type))

  const anchors: PlacedZone[] = []
  const anchorMap = new Map<string, string>()

  // 去重：如果两个区域投影到骨架上的同一个点（距离 < 15），共享锚点
  let anchorIdx = 0
  for (const z of offSpineZones) {
    const proj = closestOnSpine(z.cx, z.cz)

    let existingAnchor: PlacedZone | null = null
    for (const a of anchors) {
      if (_ptDist(a.cx, a.cz, proj.x, proj.z) < 15) {
        existingAnchor = a
        break
      }
    }

    if (existingAnchor) {
      anchorMap.set(z.id, existingAnchor.id)
    } else {
      const anchorId = `anchor_${anchorIdx++}`
      anchors.push({
        id: anchorId,
        type: 'anchor',
        cx: proj.x,
        cz: proj.z,
        radius: 3,
        height: 0,
      })
      anchorMap.set(z.id, anchorId)
    }
  }

  // ── 2. 主基地 → 同玩家 natural 矿区（直连，优先于支路） ──
  const directConnected = new Set<string>()
  for (const z of zones) {
    if (z.type !== 'main_base') continue
    const myNatural = zones
      .filter(o => o.type === 'expansion' && _samePlayer(z.id, o.id))
      .sort((a, b) => _zoneDist(z, a) - _zoneDist(z, b))
    if (myNatural.length > 0) {
      addEdge(z.id, myNatural[0].id, 'wide')
      directConnected.add(myNatural[0].id)
    }
  }

  // ── 3. off-spine 区域 → 自己的锚点（支路） ──
  // 跳过已经通过直连到达 main_base 的 natural（它共享 main_base 的 anchor 连接）
  for (const z of offSpineZones) {
    // 如果这个区域已经直连到 main_base，且和 main_base 共享同一个 anchor，
    // 则不需要自己再连 anchor（通过 main_base 中转即可到达骨架）
    if (directConnected.has(z.id)) {
      const myAnchor = anchorMap.get(z.id)
      const myMain = zones.find(m => m.type === 'main_base' && _samePlayer(z.id, m.id))
      if (myMain) {
        const mainAnchor = anchorMap.get(myMain.id)
        if (myAnchor === mainAnchor) continue
      }
    }
    const anchorId = anchorMap.get(z.id)!
    const w: RoadWidth = z.type === 'main_base' ? 'wide' : 'medium'
    addEdge(z.id, anchorId, w)
  }

  // ── 4. 锚点沿骨架排序后串联（主干道） ──
  const anchorWithT = anchors.map(a => ({ anchor: a, t: spineT(a.cx, a.cz) }))
  anchorWithT.sort((a, b) => a.t - b.t)

  for (let i = 0; i < anchorWithT.length - 1; i++) {
    const a = anchorWithT[i].anchor
    const b = anchorWithT[i + 1].anchor
    addEdge(a.id, b.id, 'wide')
  }

  // ── 5. 骨架上的区域（战场/通道）连接到最近的锚点 ──
  for (const z of onSpineZones) {
    const sorted = anchors
      .map(a => ({ zone: a, dist: _ptDist(z.cx, z.cz, a.cx, a.cz) }))
      .sort((a, b) => a.dist - b.dist)
    if (sorted.length > 0 && sorted[0].dist < 60) {
      addEdge(z.id, sorted[0].zone.id, _roadWidthForPair(z, sorted[0].zone))
    }
    if (sorted.length > 1 && sorted[1].dist < 40) {
      addEdge(z.id, sorted[1].zone.id, _roadWidthForPair(z, sorted[1].zone))
    }
  }

  // ── 6. 极近区域直连（边缘间距 < 8，且不跨越骨架） ──
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i], b = zones[j]
      const gap = _ptDist(a.cx, a.cz, b.cx, b.cz) - a.radius - b.radius
      if (gap < 8) {
        // 检查连线是否穿过骨架
        if (!_crossesSpine(a.cx, a.cz, b.cx, b.cz, spineSegs)) {
          addEdge(a.id, b.id, _roadWidthForPair(a, b))
        }
      }
    }
  }

  // ── 7. 连通性保证 ──
  const allZones = [...zones, ...anchors]
  _ensureConnected(allZones, edges, edgeSet, addEdge)

  return { edges, anchors }
}

// ── 骨架线段构建 ──

function _buildSpineSegments(
  spine: Spine,
  halfW: number,
  halfH: number,
): SpineSeg[] {
  const nodeMap = new Map(spine.nodes.map(n => [n.id, n]))
  const segs: SpineSeg[] = []

  for (const p of spine.paths) {
    const fn = nodeMap.get(p.from), tn = nodeMap.get(p.to)
    if (!fn || !tn) continue
    segs.push({
      ax: fn.position.x * halfW, az: fn.position.z * halfH,
      bx: tn.position.x * halfW, bz: tn.position.z * halfH,
      lane: p.lane,
    })
  }

  return segs
}

// ── 线段上最近点 ──

function _closestOnSeg(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): { x: number; z: number; dist: number } {
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 0.01) {
    const d = Math.sqrt((px - ax) ** 2 + (pz - az) ** 2)
    return { x: ax, z: az, dist: d }
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + dx * t, cz = az + dz * t
  const d = Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2)
  return { x: cx, z: cz, dist: d }
}

// ── 检查线段 AB 是否穿过骨架 ──

function _crossesSpine(
  ax: number, az: number,
  bx: number, bz: number,
  spineSegs: SpineSeg[],
): boolean {
  for (const s of spineSegs) {
    if (_segmentsIntersect(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) {
      return true
    }
  }
  return false
}

function _segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const d1 = _cross(cx, cz, dx, dz, ax, az)
  const d2 = _cross(cx, cz, dx, dz, bx, bz)
  const d3 = _cross(ax, az, bx, bz, cx, cz)
  const d4 = _cross(ax, az, bx, bz, dx, dz)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

function _cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

// ── 开放型连边 ──

function _buildOpenEdges(zones: PlacedZone[], mapWidth: number, mapHeight: number): PlacedEdge[] {
  const edges: PlacedEdge[] = []
  const edgeSet = new Set<string>()

  const addEdge = (a: string, b: string, width: RoadWidth) => {
    const key = [a, b].sort().join('|')
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push({ fromId: a, toId: b, roadWidth: width, chokeWidth: 0 })
  }

  for (const z of zones) {
    const others = zones
      .filter(o => o.id !== z.id)
      .map(o => ({ zone: o, dist: _ptDist(z.cx, z.cz, o.cx, o.cz) }))
      .sort((a, b) => a.dist - b.dist)

    const maxNeighbors = z.type === 'main_base' ? 3 : z.type === 'expansion' ? 3 : 4

    for (let i = 0; i < Math.min(maxNeighbors, others.length); i++) {
      const o = others[i]
      const diag = Math.sqrt(mapWidth * mapWidth + mapHeight * mapHeight)
      if (o.dist > diag * 0.4) continue
      const w = _roadWidthForPair(z, o.zone)
      addEdge(z.id, o.zone.id, w)
    }
  }

  for (const z of zones) {
    if (z.type !== 'main_base') continue
    const hasExpEdge = edges.some(e =>
      (e.fromId === z.id || e.toId === z.id) &&
      zones.some(oz => oz.id === (e.fromId === z.id ? e.toId : e.fromId) && oz.type === 'expansion')
    )
    if (!hasExpEdge) {
      const nearest = _nearestOfType(z, zones, 'expansion')
      if (nearest) addEdge(z.id, nearest.id, 'wide')
    }
  }

  _ensureConnected(zones, edges, edgeSet, addEdge)
  return edges
}

// ── 辅助 ──

function _samePlayer(idA: string, idB: string): boolean {
  const pA = idA.includes('_P1') ? 'P1' : idA.includes('_P2') ? 'P2' : idA.endsWith('_m') ? 'P2' : 'P1'
  const pB = idB.includes('_P1') ? 'P1' : idB.includes('_P2') ? 'P2' : idB.endsWith('_m') ? 'P2' : 'P1'
  return pA === pB
}

function _roadWidthForPair(a: PlacedZone, b: PlacedZone): RoadWidth {
  const types = new Set([a.type, b.type])
  if (types.has('main_base') && types.has('expansion')) return 'wide'
  if (types.has('main_base')) return 'medium'
  if (types.has('expansion')) return 'medium'
  if (types.has('passage')) return 'narrow'
  return 'medium'
}

function _ptDist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz
  return Math.sqrt(dx * dx + dz * dz)
}

function _zoneDist(a: PlacedZone, b: PlacedZone): number {
  return _ptDist(a.cx, a.cz, b.cx, b.cz)
}

function _nearestOfType(z: PlacedZone, zones: PlacedZone[], type: string): PlacedZone | null {
  let best: PlacedZone | null = null
  let bestDist = Infinity
  for (const o of zones) {
    if (o.id === z.id || o.type !== type) continue
    const d = _zoneDist(z, o)
    if (d < bestDist) { bestDist = d; best = o }
  }
  return best
}

function _ensureConnected(
  zones: PlacedZone[],
  edges: PlacedEdge[],
  edgeSet: Set<string>,
  addEdge: (a: string, b: string, w: RoadWidth) => void,
): void {
  const adj = new Map<string, Set<string>>()
  for (const z of zones) adj.set(z.id, new Set())
  for (const e of edges) {
    adj.get(e.fromId)?.add(e.toId)
    adj.get(e.toId)?.add(e.fromId)
  }

  const visited = new Set<string>()
  const components: string[][] = []

  for (const z of zones) {
    if (visited.has(z.id)) continue
    const comp: string[] = []
    const queue = [z.id]
    visited.add(z.id)
    while (queue.length > 0) {
      const cur = queue.shift()!
      comp.push(cur)
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb)
          queue.push(nb)
        }
      }
    }
    components.push(comp)
  }

  const zoneMap = new Map(zones.map(z => [z.id, z]))
  while (components.length > 1) {
    let bestDist = Infinity
    let bestA = '', bestB = ''
    for (let i = 0; i < components.length; i++) {
      for (let j = i + 1; j < components.length; j++) {
        for (const ai of components[i]) {
          for (const bj of components[j]) {
            const za = zoneMap.get(ai), zb = zoneMap.get(bj)
            if (!za || !zb) continue
            const d = _zoneDist(za, zb)
            if (d < bestDist) { bestDist = d; bestA = ai; bestB = bj }
          }
        }
      }
    }
    addEdge(bestA, bestB, 'medium')
    const compA = components.findIndex(c => c.includes(bestA))
    const compB = components.findIndex(c => c.includes(bestB))
    components[compA] = [...components[compA], ...components[compB]]
    components.splice(compB, 1)
  }
}
