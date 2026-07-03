/**
 * 区域放置器 — 力导向布局算法
 *
 * V2 新版：支持两种放置模式
 *   - 走廊型（corridor）：区域受骨架路径约束，沿路径分布
 *   - 开放型（open）：纯力导向自由散布
 *
 * 算法：Fruchterman-Reingold 变体 + 对称约束
 *   1. 随机初始化：positionHint 作为参考方向
 *   2. 镜像展开：P1 节点 → 自动生成 P2 镜像节点
 *   3. 力导向迭代：排斥力 + 骨架吸引力(走廊型) + 边界力 + 随机扰动
 *   4. 输出：PlacedZoneGraph（edges 为空，由 EdgeBuilder 填充）
 */

import { SeededRandom } from './SeededRandom'
import { mirrorPoint, allMirrors, isInPrimaryHalf } from './SymmetryFramework'
import type { SymmetryMode } from './SymmetryFramework'
import type {
  ZoneGraphTemplate,
  ZoneNode,
  ZoneEdge,
  PlacedZone,
  PlacedEdge,
  PlacedZoneGraph,
  RoadWidth,
} from './ZoneGraph'
import { ROAD_WIDTH_VALUES } from './ZoneGraph'

// ── 配置 ──

const ITERATIONS = 150
const INITIAL_TEMP = 0.2
const COOLING_RATE = 0.97
const BOUNDARY_MARGIN = 8

/** 出生点之间的最小距离占地图对角线的比例 */
const MIN_SPAWN_DISTANCE_RATIO = 0.4

/** 初始放置时角度随机范围（弧度） */
const ANGLE_JITTER = Math.PI * 0.35  // ±63°
/** 初始放置时径向距离随机比例 */
const RADIAL_JITTER = 0.3  // ±30%
/** 每轮迭代中的随机扰动力强度（相对于温度） */
const NOISE_STRENGTH = 0.15

// ── 内部工作节点 ──

interface WorkNode {
  id: string
  type: ZoneNode['type']
  cx: number
  cz: number
  radius: number
  height: number
  mirrorOf?: string
  onAxis: boolean
  fx: number
  fz: number
}

interface WorkEdge {
  fromIdx: number
  toIdx: number
  roadWidth: RoadWidth
  chokeWidth: number
  idealDist: number
}

// ================================================================
// Main: Place Zones
// ================================================================

export function placeZones(
  template: ZoneGraphTemplate,
  mapWidth: number,
  mapHeight: number,
  seed: number = 42,
): PlacedZoneGraph {
  const spine = template.spine
  const isCorridor = spine && spine.type !== 'open'

  if (isCorridor) {
    return _placeCorridorZones(template, mapWidth, mapHeight, seed)
  }
  return _placeOpenZones(template, mapWidth, mapHeight, seed)
}

// ================================================================
// 走廊型放置：直接用 positionHint，不跑力导向
// ================================================================

function _placeCorridorZones(
  template: ZoneGraphTemplate,
  mapWidth: number,
  mapHeight: number,
  seed: number,
): PlacedZoneGraph {
  const rng = new SeededRandom(seed)
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const usableW = halfW - BOUNDARY_MARGIN
  const usableH = halfH - BOUNDARY_MARGIN
  const sym = template.symmetry as SymmetryMode

  // 骨架路径段（世界坐标），用于防止区域落在骨架上
  const spine = template.spine
  const spineSegs: { ax: number; az: number; bx: number; bz: number }[] = []
  if (spine) {
    const nodeMap = new Map(spine.nodes.map(n => [n.id, n]))
    for (const p of spine.paths) {
      const fn = nodeMap.get(p.from), tn = nodeMap.get(p.to)
      if (!fn || !tn) continue
      spineSegs.push({
        ax: fn.position.x * usableW, az: fn.position.z * usableH,
        bx: tn.position.x * usableW, bz: tn.position.z * usableH,
      })
    }
  }

  function distToSpine(cx: number, cz: number): { dist: number; nx: number; nz: number } {
    let best = Infinity, bnx = 0, bnz = 0
    for (const s of spineSegs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az
      const len2 = dx * dx + dz * dz
      if (len2 < 0.01) continue
      let t = ((cx - s.ax) * dx + (cz - s.az) * dz) / len2
      t = Math.max(0, Math.min(1, t))
      const px = s.ax + dx * t, pz = s.az + dz * t
      const ex = cx - px, ez = cz - pz
      const d = Math.sqrt(ex * ex + ez * ez)
      if (d < best) {
        best = d
        if (d > 0.1) { bnx = ex / d; bnz = ez / d }
        else { bnx = -dz / Math.sqrt(len2); bnz = dx / Math.sqrt(len2) }
      }
    }
    return { dist: best, nx: bnx, nz: bnz }
  }

  const placedZones: PlacedZone[] = []

  // 只有主基地和矿区需要远离骨架
  const SPINE_REPEL_TYPES = new Set(['main_base', 'expansion'])
  const MIN_SPINE_GAP = 6

  for (const n of template.nodes) {
    let cx = n.positionHint.x * usableW
    let cz = n.positionHint.z * usableH

    if (!n.onAxis) {
      cx += rng.nextFloat(-2, 2)
      cz += rng.nextFloat(-2, 2)
    }

    const bxLim = usableW - n.minRadius, bzLim = usableH - n.minRadius
    cx = Math.max(-bxLim, Math.min(bxLim, cx))
    cz = Math.max(-bzLim, Math.min(bzLim, cz))

    // 只对主基地和矿区推离骨架：沿法线方向直推，不允许穿越骨架
    if (SPINE_REPEL_TYPES.has(n.type)) {
      const clearance = n.minRadius + MIN_SPINE_GAP
      const { dist: d0, nx: n0x, nz: n0z } = distToSpine(cx, cz)
      if (d0 < clearance) {
        const pushDist = clearance - d0 + 4
        cx += n0x * pushDist
        cz += n0z * pushDist
        cx = Math.max(-bxLim, Math.min(bxLim, cx))
        cz = Math.max(-bzLim, Math.min(bzLim, cz))
      }
    }

    placedZones.push({
      id: n.id, type: n.type,
      cx, cz, radius: n.minRadius,
      height: n.height,
    })

    if (!n.onAxis) {
      const mirrors = allMirrors({ x: cx, z: cz }, sym)
      for (let mi = 0; mi < mirrors.length; mi++) {
        const m = mirrors[mi]
        placedZones.push({
          id: _mirrorId(n.id, mi), type: n.type,
          cx: m.x, cz: m.z, radius: n.minRadius,
          height: n.height, mirrorOf: n.id,
        })
      }
    }
  }

  // 防重叠迭代（优先级：防重叠 > 骨架排斥 > 边界）
  for (let iter = 0; iter < 120; iter++) {
    let moved = false

    // 1. 防重叠（最高优先级）
    for (let i = 0; i < placedZones.length; i++) {
      for (let j = i + 1; j < placedZones.length; j++) {
        const a = placedZones[i], b = placedZones[j]
        let dx = b.cx - a.cx, dz = b.cz - a.cz
        let dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < 0.1) { dx = 1; dz = 0; dist = 0.1 }
        const minDist = a.radius + b.radius + 4
        if (dist < minDist) {
          const push = (minDist - dist) * 0.6 + 1
          const nx = dx / dist, nz = dz / dist
          if (!a.mirrorOf) { a.cx -= nx * push; a.cz -= nz * push; moved = true }
          if (!b.mirrorOf) { b.cx += nx * push; b.cz += nz * push; moved = true }
        }
      }
    }

    // 2. 骨架排斥（只对主基地和矿区，强推力确保不在骨架上）
    for (const z of placedZones) {
      if (z.mirrorOf) continue
      if (!SPINE_REPEL_TYPES.has(z.type)) continue
      const { dist, nx, nz } = distToSpine(z.cx, z.cz)
      const cl = z.radius + MIN_SPINE_GAP
      if (dist < cl) {
        const push = (cl - dist) * 0.8 + 2
        z.cx += nx * push
        z.cz += nz * push
        moved = true
      }
    }

    // 3. 边界约束
    for (const z of placedZones) {
      if (z.mirrorOf) continue
      const bx = usableW - z.radius, bz = usableH - z.radius
      z.cx = Math.max(-bx, Math.min(bx, z.cx))
      z.cz = Math.max(-bz, Math.min(bz, z.cz))
    }

    // 4. 同步镜像
    for (const z of placedZones) {
      if (!z.mirrorOf) continue
      const src = placedZones.find(s => s.id === z.mirrorOf)
      if (!src) continue
      const ms = allMirrors({ x: src.cx, z: src.cz }, sym)
      const mi = _mirrorIndex(z.id, z.mirrorOf)
      if (mi < ms.length) { z.cx = ms[mi].x; z.cz = ms[mi].z }
    }

    if (!moved) break
  }

  // 出生点最小距离硬约束
  const mapDiag = Math.sqrt(mapWidth * mapWidth + mapHeight * mapHeight)
  const minSpawnDist = mapDiag * MIN_SPAWN_DISTANCE_RATIO
  const bases = placedZones.filter(z => z.type === 'main_base' && !z.mirrorOf)
  for (const b of bases) {
    const ms = allMirrors({ x: b.cx, z: b.cz }, sym)
    for (const mp of ms) {
      const dx = mp.x - b.cx, dz = mp.z - b.cz
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist >= minSpawnDist || dist < 0.1) continue
      const deficit = (minSpawnDist - dist) / 2
      const nx = dx / dist, nz = dz / dist
      b.cx -= nx * deficit; b.cz -= nz * deficit
      const bx = usableW - b.radius, bz = usableH - b.radius
      b.cx = Math.max(-bx, Math.min(bx, b.cx))
      b.cz = Math.max(-bz, Math.min(bz, b.cz))
    }
  }
  // 同步镜像
  for (const z of placedZones) {
    if (!z.mirrorOf) continue
    const src = placedZones.find(s => s.id === z.mirrorOf)
    if (!src) continue
    const ms = allMirrors({ x: src.cx, z: src.cz }, sym)
    const mi = _mirrorIndex(z.id, z.mirrorOf)
    if (mi < ms.length) { z.cx = ms[mi].x; z.cz = ms[mi].z }
  }

  // 最终硬性防重叠：缩小重叠区域的半径（最后手段）
  for (let i = 0; i < placedZones.length; i++) {
    for (let j = i + 1; j < placedZones.length; j++) {
      const a = placedZones[i], b = placedZones[j]
      const dx = b.cx - a.cx, dz = b.cz - a.cz
      const dist = Math.sqrt(dx * dx + dz * dz)
      const overlap = a.radius + b.radius - dist
      if (overlap > 0 && dist > 0.1) {
        const shrink = overlap / 2 + 1
        a.radius = Math.max(4, a.radius - shrink)
        b.radius = Math.max(4, b.radius - shrink)
      }
    }
  }

  return {
    zones: placedZones,
    edges: [],
    mapWidth, mapHeight,
  }
}

// ================================================================
// 开放型放置：力导向布局（保留旧版完整逻辑）
// ================================================================

function _placeOpenZones(
  template: ZoneGraphTemplate,
  mapWidth: number,
  mapHeight: number,
  seed: number,
): PlacedZoneGraph {
  const rng = new SeededRandom(seed)
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2
  const usableW = halfW - BOUNDARY_MARGIN
  const usableH = halfH - BOUNDARY_MARGIN

  // ── Step 1: 随机初始化节点位置 ──

  const nodes: WorkNode[] = []
  const idToIdx = new Map<string, number>()

  const sym = template.symmetry as SymmetryMode

  for (const n of template.nodes) {
    let cx: number, cz: number

    if (n.onAxis) {
      cx = n.positionHint.x * usableW + rng.nextFloat(-3, 3)
      cz = n.positionHint.z * usableH + rng.nextFloat(-3, 3)
    } else {
      const hx = n.positionHint.x * usableW
      const hz = n.positionHint.z * usableH
      const baseAngle = Math.atan2(hz, hx)
      const baseDist = Math.sqrt(hx * hx + hz * hz)

      const angle = baseAngle + rng.nextFloat(-ANGLE_JITTER, ANGLE_JITTER)
      const dist = baseDist * (1 + rng.nextFloat(-RADIAL_JITTER, RADIAL_JITTER))

      cx = Math.cos(angle) * dist
      cz = Math.sin(angle) * dist

      // 保证在 P1 半区
      if (!isInPrimaryHalf({ x: cx, z: cz }, sym)) {
        // 翻转到 P1 半区
        switch (sym) {
          case 'rotation_180':      cx = -Math.abs(cx) - 2; cz = -Math.abs(cz) - 2; break
          case 'mirror_vertical':   cx = -Math.abs(cx) - 2; break
          case 'mirror_horizontal': cz = -Math.abs(cz) - 2; break
          case 'rotation_90':       cx = -Math.abs(cx) - 2; cz = -Math.abs(cz) - 2; break
        }
      }
    }

    cx = Math.max(-usableW + n.minRadius, Math.min(usableW - n.minRadius, cx))
    cz = Math.max(-usableH + n.minRadius, Math.min(usableH - n.minRadius, cz))

    const idx = nodes.length
    idToIdx.set(n.id, idx)
    nodes.push({
      id: n.id,
      type: n.type,
      cx, cz,
      radius: n.minRadius,
      height: n.height,
      onAxis: !!n.onAxis,
      fx: 0, fz: 0,
    })

    // 生成镜像节点（rotation_90 产生 3 个镜像）
    if (!n.onAxis) {
      const mirrors = allMirrors({ x: cx, z: cz }, sym)
      for (let mi = 0; mi < mirrors.length; mi++) {
        const m = mirrors[mi]
        const mirrorId = _mirrorId(n.id, mi)
        const mIdx = nodes.length
        idToIdx.set(mirrorId, mIdx)
        nodes.push({
          id: mirrorId,
          type: n.type,
          cx: m.x, cz: m.z,
          radius: n.minRadius,
          height: n.height,
          mirrorOf: n.id,
          onAxis: false,
          fx: 0, fz: 0,
        })
      }
    }
  }

  // ── Step 2: 创建工作边（开放型有弹簧力） ──

  const edges: WorkEdge[] = []
  const numMirrors = sym === 'rotation_90' ? 3 : 1

  for (const e of template.edges) {
    _addEdge(e.from, e.to, e, nodes, idToIdx, edges)

    const fromNode = template.nodes.find(n => n.id === e.from)
    const toNode = template.nodes.find(n => n.id === e.to)

    for (let mi = 0; mi < numMirrors; mi++) {
      const mFrom = _mirrorId(e.from, mi)
      const mTo = _mirrorId(e.to, mi)
      const hasFrom = idToIdx.has(mFrom)
      const hasTo = idToIdx.has(mTo)

      if (hasFrom && hasTo && mFrom !== e.from) {
        _addEdge(mFrom, mTo, e, nodes, idToIdx, edges)
      }
      if (fromNode && !fromNode.onAxis && toNode && toNode.onAxis) {
        if (hasFrom) _addEdge(mFrom, e.to, e, nodes, idToIdx, edges)
      }
      if (toNode && !toNode.onAxis && fromNode && fromNode.onAxis) {
        if (hasTo) _addEdge(e.from, mTo, e, nodes, idToIdx, edges)
      }
    }
  }

  // 连通性保证
  for (let safety = 0; safety < 10; safety++) {
    const components = _connectedComponents(nodes, edges)
    if (components.length <= 1) break

    let bestDist = Infinity, bestI = 0, bestJ = 0
    for (const ni of components[0]) {
      for (let ci = 1; ci < components.length; ci++) {
        for (const nj of components[ci]) {
          const dx = nodes[ni].cx - nodes[nj].cx
          const dz = nodes[ni].cz - nodes[nj].cz
          const d = dx * dx + dz * dz
          if (d < bestDist) { bestDist = d; bestI = ni; bestJ = nj }
        }
      }
    }
    const a = nodes[bestI], b = nodes[bestJ]
    edges.push({
      fromIdx: bestI, toIdx: bestJ,
      roadWidth: 'wide',
      chokeWidth: ROAD_WIDTH_VALUES.wide,
      idealDist: a.radius + b.radius + ROAD_WIDTH_VALUES.wide + 6,
    })
  }

  // ── Step 3: 力导向迭代 ──

  let temp = INITIAL_TEMP * Math.max(mapWidth, mapHeight)

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const n of nodes) { n.fx = 0; n.fz = 0 }

    // Repulsion: all pairs
    const mapDiag = Math.sqrt(mapWidth * mapWidth + mapHeight * mapHeight)
    const minSpawnDist = mapDiag * MIN_SPAWN_DISTANCE_RATIO

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        let dx = b.cx - a.cx
        let dz = b.cz - a.cz
        let dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < 0.1) { dx = rng.nextFloat(-1, 1); dz = rng.nextFloat(-1, 1); dist = 1 }

        const minDist = a.radius + b.radius + 4
        if (dist < minDist * 1.5) {
          const overlap = minDist - dist
          const force = overlap > 0 ? overlap * 2.5 : overlap * 0.3
          const fx = (dx / dist) * force
          const fz = (dz / dist) * force
          a.fx -= fx; a.fz -= fz
          b.fx += fx; b.fz += fz
        }

        // 出生点之间的强排斥力：保证最小距离
        if (a.type === 'main_base' && b.type === 'main_base' && dist < minSpawnDist) {
          const spawnForce = (minSpawnDist - dist) * 3.0
          const sfx = (dx / dist) * spawnForce
          const sfz = (dz / dist) * spawnForce
          a.fx -= sfx; a.fz -= sfz
          b.fx += sfx; b.fz += sfz
        }
      }
    }

    // Attraction: connected edges (legacy, when edges exist)
    for (const e of edges) {
      const a = nodes[e.fromIdx], b = nodes[e.toIdx]
      const dx = b.cx - a.cx
      const dz = b.cz - a.cz
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < 0.1) continue

      const diff = dist - e.idealDist
      if (Math.abs(diff) > 1) {
        const force = diff * 0.25
        const fx = (dx / dist) * force
        const fz = (dz / dist) * force
        a.fx += fx; a.fz += fz
        b.fx -= fx; b.fz -= fz
      }
    }

    // Boundary force
    for (const n of nodes) {
      const bx = usableW - n.radius
      const bz = usableH - n.radius
      if (n.cx < -bx) n.fx += (-bx - n.cx) * 2.0
      if (n.cx > bx)  n.fx += (bx - n.cx) * 2.0
      if (n.cz < -bz) n.fz += (-bz - n.cz) * 2.0
      if (n.cz > bz)  n.fz += (bz - n.cz) * 2.0
    }

    // Random noise force (decays with temperature)
    for (const n of nodes) {
      if (n.mirrorOf) continue
      n.fx += rng.nextFloat(-1, 1) * temp * NOISE_STRENGTH
      n.fz += rng.nextFloat(-1, 1) * temp * NOISE_STRENGTH
    }

    // Apply forces
    for (const n of nodes) {
      if (n.onAxis) {
        const mag = Math.sqrt(n.fx * n.fx + n.fz * n.fz)
        if (mag > temp * 0.3) {
          n.fx = (n.fx / mag) * temp * 0.3
          n.fz = (n.fz / mag) * temp * 0.3
        }
        n.cx += n.fx
        n.cz += n.fz
        continue
      }

      if (n.mirrorOf) continue

      const mag = Math.sqrt(n.fx * n.fx + n.fz * n.fz)
      if (mag > temp) {
        n.fx = (n.fx / mag) * temp
        n.fz = (n.fz / mag) * temp
      }
      n.cx += n.fx
      n.cz += n.fz
    }

    // Enforce symmetry: update all mirror nodes from their source
    for (const n of nodes) {
      if (n.mirrorOf) {
        const srcIdx = idToIdx.get(n.mirrorOf)
        if (srcIdx === undefined) continue
        const src = nodes[srcIdx]
        // Determine which mirror index this node is
        const mirrors = allMirrors({ x: src.cx, z: src.cz }, sym)
        // Find which mirror this node corresponds to by ID suffix
        const mi = _mirrorIndex(n.id, n.mirrorOf)
        if (mi < mirrors.length) {
          n.cx = mirrors[mi].x
          n.cz = mirrors[mi].z
        }
      }
    }

    temp *= COOLING_RATE
  }

  // ── Step 3.5: 出生点最小距离硬约束 ──
  // 如果力导向未能将出生点推到足够远，直接沿连线方向强制拉开
  {
    const mapDiag = Math.sqrt(mapWidth * mapWidth + mapHeight * mapHeight)
    const minSpawnDist = mapDiag * MIN_SPAWN_DISTANCE_RATIO
    const bases = nodes.filter(n => n.type === 'main_base' && !n.mirrorOf)
    const bW = mapWidth / 2 - BOUNDARY_MARGIN
    const bH = mapHeight / 2 - BOUNDARY_MARGIN

    for (const base of bases) {
      const mirrors = allMirrors({ x: base.cx, z: base.cz }, sym)
      for (const mp of mirrors) {
        const dx = mp.x - base.cx
        const dz = mp.z - base.cz
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist >= minSpawnDist || dist < 0.1) continue

        const deficit = (minSpawnDist - dist) / 2
        const nx = dx / dist, nz = dz / dist
        base.cx -= nx * deficit
        base.cz -= nz * deficit
        base.cx = Math.max(-bW, Math.min(bW, base.cx))
        base.cz = Math.max(-bH, Math.min(bH, base.cz))
      }
    }

    // Re-enforce symmetry after adjustment
    for (const n of nodes) {
      if (n.mirrorOf) {
        const srcIdx = idToIdx.get(n.mirrorOf)
        if (srcIdx === undefined) continue
        const src = nodes[srcIdx]
        const ms = allMirrors({ x: src.cx, z: src.cz }, sym)
        const mi = _mirrorIndex(n.id, n.mirrorOf)
        if (mi < ms.length) { n.cx = ms[mi].x; n.cz = ms[mi].z }
      }
    }
  }

  // ── Step 4: 构建输出 ──

  const placedZones: PlacedZone[] = nodes.map(n => ({
    id: n.id,
    type: n.type,
    cx: n.cx,
    cz: n.cz,
    radius: n.radius,
    height: n.height,
    mirrorOf: n.mirrorOf,
  }))

  const placedEdges: PlacedEdge[] = edges.map(e => ({
    fromId: nodes[e.fromIdx].id,
    toId: nodes[e.toIdx].id,
    roadWidth: e.roadWidth,
    chokeWidth: e.chokeWidth,
  }))

  const edgeSet = new Set<string>()
  const uniqueEdges: PlacedEdge[] = []
  for (const e of placedEdges) {
    const key = [e.fromId, e.toId].sort().join('|')
    if (!edgeSet.has(key)) {
      edgeSet.add(key)
      uniqueEdges.push(e)
    }
  }

  return {
    zones: placedZones,
    edges: uniqueEdges,
    mapWidth,
    mapHeight,
  }
}

// ── 辅助函数 ──

/**
 * 生成镜像节点 ID。
 * mirrorIdx: 0 = 第一个镜像（所有模式都有），1/2 = rotation_90 的第二/三个镜像
 */
function _mirrorId(id: string, mirrorIdx = 0): string {
  if (mirrorIdx === 0) {
    if (id.endsWith('_P1')) return id.replace(/_P1$/, '_P2')
    if (id.endsWith('_P2')) return id.replace(/_P2$/, '_P1')
    if (id.endsWith('_m')) return id.slice(0, -2)
    return id + '_m'
  }
  // rotation_90: P3, P4
  return id + `_r${mirrorIdx + 1}`
}

/** Determine which mirror index a mirror node is (0, 1, or 2) */
function _mirrorIndex(mirrorId: string, sourceId: string): number {
  if (mirrorId.endsWith('_r3')) return 2
  if (mirrorId.endsWith('_r2')) return 1
  return 0
}

function _addEdge(
  fromId: string,
  toId: string,
  e: ZoneEdge,
  nodes: WorkNode[],
  idToIdx: Map<string, number>,
  edges: WorkEdge[],
): void {
  const fi = idToIdx.get(fromId)
  const ti = idToIdx.get(toId)
  if (fi === undefined || ti === undefined) return
  if (fi === ti) return

  const a = nodes[fi], b = nodes[ti]
  const roadW = ROAD_WIDTH_VALUES[e.roadWidth]
  const idealDist = a.radius + b.radius + roadW + 6

  edges.push({
    fromIdx: fi,
    toIdx: ti,
    roadWidth: e.roadWidth,
    chokeWidth: e.chokeWidth ?? roadW,
    idealDist,
  })
}

/** BFS 返回所有连通分量（每个分量是节点索引数组） */
function _connectedComponents(nodes: WorkNode[], edges: WorkEdge[]): number[][] {
  const adj = new Map<number, number[]>()
  for (let i = 0; i < nodes.length; i++) adj.set(i, [])
  for (const e of edges) {
    adj.get(e.fromIdx)!.push(e.toIdx)
    adj.get(e.toIdx)!.push(e.fromIdx)
  }
  const visited = new Set<number>()
  const components: number[][] = []
  for (let i = 0; i < nodes.length; i++) {
    if (visited.has(i)) continue
    const comp: number[] = []
    const queue = [i]
    visited.add(i)
    while (queue.length > 0) {
      const cur = queue.shift()!
      comp.push(cur)
      for (const nb of adj.get(cur)!) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
      }
    }
    components.push(comp)
  }
  return components
}
