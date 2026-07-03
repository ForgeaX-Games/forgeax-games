/**
 * 道路网络生成器 — M2 核心
 *
 * 输入：PlacedZoneGraph（区域位置 + 连接关系）
 * 输出：RoadNetwork（道路路径 + 宽度 + 卡口）
 *
 * 每条道路是一系列路点（waypoint），从 zone A 边缘到 zone B 边缘。
 * 道路中段可以收窄形成卡口（choke point）。
 *
 * 算法：
 *   1. 计算两区域边缘的连接点
 *   2. 在连接点之间插入中间路点（微弯曲 + 噪声）
 *   3. 标记卡口位置（道路中段最窄处）
 *   4. 生成道路占用网格（用于后续地形填充）
 */

import { SeededRandom } from './SeededRandom'
import type { PlacedZoneGraph, PlacedZone, PlacedEdge, RoadWidth } from './ZoneGraph'
import { ROAD_WIDTH_VALUES } from './ZoneGraph'

// ── 配置 ──

/** 卡口宽度 = 道路宽度 × 此比例 */
const CHOKE_WIDTH_RATIO = 0.5
/** 卡口长度（世界单位） */
const CHOKE_LENGTH = 14
/** 道路路点间距（世界单位） */
const WAYPOINT_SPACING = 5
/** 道路弯曲的最大横向偏移（占道路长度的比例） */
const CURVE_RATIO = 0.06
/** 道路长度低于此值时不做弯曲（短支路走直线） */
const MIN_CURVE_LENGTH = 30

// ── 输出数据结构 ──

export interface RoadWaypoint {
  x: number
  z: number
  /** 此处道路半宽（世界单位） */
  halfWidth: number
  /** 是否处于卡口区域 */
  isChoke: boolean
}

export interface RoadSegment {
  fromZoneId: string
  toZoneId: string
  roadWidth: RoadWidth
  waypoints: RoadWaypoint[]
  choke: ChokePoint | null
  /** 连接的两区域是否有高度差（坡道位置在 M3 高度网格确定后再计算） */
  heightDiff: boolean
}

export interface ChokePoint {
  x: number
  z: number
  /** 卡口半宽 */
  halfWidth: number
  /** 卡口朝向角度（弧度） */
  angle: number
}

export interface RoadNetwork {
  roads: RoadSegment[]
  mapWidth: number
  mapHeight: number
}

/** 道路占用网格（用于地形填充时避让道路区域） */
export interface RoadGrid {
  /** res × res 的 Uint8Array，0=无道路，1=道路，2=卡口 */
  data: Uint8Array
  res: number
  mapWidth: number
  mapHeight: number
}

// ── 主函数 ──

export function generateRoadNetwork(
  graph: PlacedZoneGraph,
  seed: number = 42,
): RoadNetwork {
  const rng = new SeededRandom(seed)
  const zoneMap = new Map<string, PlacedZone>()
  for (const z of graph.zones) zoneMap.set(z.id, z)

  const rawRoads: RoadSegment[] = []

  for (const edge of graph.edges) {
    const a = zoneMap.get(edge.fromId)
    const b = zoneMap.get(edge.toId)
    if (!a || !b) continue

    const obstacles = graph.zones.filter(z => z.id !== a.id && z.id !== b.id)

    const road = _buildRoad(a, b, edge, obstacles, rng)
    rawRoads.push(road)
  }

  // 合并近距离平行道路：如果两条道路的中点距离 < 阈值且方向接近，保留较宽的
  const roads = _mergeParallelRoads(rawRoads)

  return { roads, mapWidth: graph.mapWidth, mapHeight: graph.mapHeight }
}

/**
 * 生成道路占用网格
 */
export function rasterizeRoadGrid(
  network: RoadNetwork,
  res: number,
): RoadGrid {
  const data = new Uint8Array(res * res)
  const halfW = network.mapWidth / 2
  const halfH = network.mapHeight / 2

  for (const road of network.roads) {
    const wps = road.waypoints
    for (let i = 0; i < wps.length - 1; i++) {
      _rasterizeSegment(
        wps[i], wps[i + 1],
        data, res, halfW, halfH,
      )
    }
  }

  return { data, res, mapWidth: network.mapWidth, mapHeight: network.mapHeight }
}

// ── 内部函数 ──

/** 检查点 (px,pz) 是否在某个障碍区域内（含道路半宽余量） */
function _insideAnyZone(px: number, pz: number, margin: number, zones: PlacedZone[]): PlacedZone | null {
  for (const z of zones) {
    const dx = px - z.cx, dz = pz - z.cz
    if (dx * dx + dz * dz < (z.radius + margin) * (z.radius + margin)) return z
  }
  return null
}

/**
 * 后处理：确保所有路点都在障碍区域外。
 *
 * 对线段 closest-point 做精确检测。如果线段穿过障碍，在障碍附近插入绕行路点并推出。
 * 然后对所有路点做合力推出。
 */
function _pushWaypointsOutOfZones(
  waypoints: RoadWaypoint[],
  fromZone: PlacedZone,
  toZone: PlacedZone,
  obstacles: PlacedZone[],
  margin: number,
): void {
  const skipIds = new Set([fromZone.id, toZone.id])
  const obst = obstacles.filter(z => !skipIds.has(z.id))
  if (obst.length === 0) return

  // Phase 1: 插入绕行路点（限制数量避免路线混乱）
  let insertions = 0
  const MAX_INSERTS = 8

  for (let round = 0; round < 4 && insertions < MAX_INSERTS; round++) {
    let anyInsert = false

    for (let i = 0; i < waypoints.length - 1 && insertions < MAX_INSERTS; i++) {
      const p = waypoints[i], q = waypoints[i + 1]

      for (const z of obst) {
        // 线段 closest point to zone center
        const segDx = q.x - p.x, segDz = q.z - p.z
        const segLen2 = segDx * segDx + segDz * segDz
        if (segLen2 < 0.01) continue
        let t = ((z.cx - p.x) * segDx + (z.cz - p.z) * segDz) / segLen2
        t = Math.max(0.05, Math.min(0.95, t))
        const cpx = p.x + segDx * t, cpz = p.z + segDz * t
        const dx = cpx - z.cx, dz = cpz - z.cz
        const dist = Math.sqrt(dx * dx + dz * dz)

        if (dist < z.radius + margin) {
          // 需要绕行：在障碍圆外放一个点
          const safeDist = z.radius + margin + 4
          let wx: number, wz: number
          if (dist > 0.01) {
            wx = z.cx + (dx / dist) * safeDist
            wz = z.cz + (dz / dist) * safeDist
          } else {
            // closest point 正好在圆心，用线段法线方向
            const perpX = -segDz / Math.sqrt(segLen2)
            const perpZ = segDx / Math.sqrt(segLen2)
            wx = z.cx + perpX * safeDist
            wz = z.cz + perpZ * safeDist
          }
          const hw = (p.halfWidth + q.halfWidth) / 2
          waypoints.splice(i + 1, 0, { x: wx, z: wz, halfWidth: hw, isChoke: false })
          insertions++
          anyInsert = true
          i++ // skip the newly inserted point
          break
        }
      }
    }

    if (!anyInsert) break
  }

  // Phase 2: 合力推出所有路点（温和推力，限制单步位移）
  for (let iter = 0; iter < 10; iter++) {
    let maxOverlap = 0
    for (const wp of waypoints) {
      let fx = 0, fz = 0
      for (const z of obst) {
        const dx = wp.x - z.cx, dz = wp.z - z.cz
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = z.radius + margin
        if (dist < minDist) {
          const overlap = minDist - dist + 1
          if (overlap > maxOverlap) maxOverlap = overlap
          if (dist > 0.01) {
            fx += (dx / dist) * overlap
            fz += (dz / dist) * overlap
          } else { fx += overlap }
        }
      }
      const fMag = Math.sqrt(fx * fx + fz * fz)
      const maxStep = 6
      if (fMag > maxStep) { fx = fx / fMag * maxStep; fz = fz / fMag * maxStep }
      wp.x += fx
      wp.z += fz
    }
    if (maxOverlap < 0.5) break
  }

  // Phase 3: 最终清理 — 对仍在区域内的路点，尝试 8 个方向找到最近的安全位置
  for (const wp of waypoints) {
    // 检查是否在某个障碍内
    let inside = false
    for (const z of obst) {
      const dx = wp.x - z.cx, dz = wp.z - z.cz
      if (dx * dx + dz * dz < (z.radius + margin) * (z.radius + margin)) {
        inside = true; break
      }
    }
    if (!inside) continue

    // 尝试 16 个方向，找距原点最近的安全位置
    let bestX = wp.x, bestZ = wp.z, bestDist2 = Infinity
    const maxR = 20
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2
      const dirX = Math.cos(angle), dirZ = Math.sin(angle)
      for (let step = 1; step <= maxR; step++) {
        const tx = wp.x + dirX * step
        const tz = wp.z + dirZ * step
        let safe = true
        for (const z of obst) {
          const dx = tx - z.cx, dz = tz - z.cz
          if (dx * dx + dz * dz < (z.radius + margin) * (z.radius + margin)) {
            safe = false; break
          }
        }
        if (safe) {
          const d2 = step * step
          if (d2 < bestDist2) {
            bestDist2 = d2; bestX = tx; bestZ = tz
          }
          break
        }
      }
    }
    wp.x = bestX
    wp.z = bestZ
  }
}

function _buildRoad(
  a: PlacedZone,
  b: PlacedZone,
  edge: PlacedEdge,
  obstacles: PlacedZone[],
  rng: SeededRandom,
): RoadSegment {
  const fullWidth = ROAD_WIDTH_VALUES[edge.roadWidth]
  const halfWidth = fullWidth / 2
  const chokeHalf = fullWidth * CHOKE_WIDTH_RATIO / 2

  const dx = b.cx - a.cx
  const dz = b.cz - a.cz
  const dist = Math.sqrt(dx * dx + dz * dz)
  const nx = dx / dist
  const nz = dz / dist

  const startX = a.cx + nx * a.radius
  const startZ = a.cz + nz * a.radius
  const endX = b.cx - nx * b.radius
  const endZ = b.cz - nz * b.radius

  const heightDiff = a.height !== b.height

  const roadDx = endX - startX
  const roadDz = endZ - startZ
  const roadLen = Math.sqrt(roadDx * roadDx + roadDz * roadDz)

  if (roadLen < 2) {
    return {
      fromZoneId: edge.fromId, toZoneId: edge.toId,
      roadWidth: edge.roadWidth,
      waypoints: [
        { x: startX, z: startZ, halfWidth, isChoke: false },
        { x: endX, z: endZ, halfWidth, isChoke: false },
      ],
      choke: null, heightDiff,
    }
  }

  const perpX = -nz
  const perpZ = nx

  const numWaypoints = Math.max(3, Math.ceil(roadLen / WAYPOINT_SPACING))
  const waypoints: RoadWaypoint[] = []

  const chokeT = 0.4 + rng.nextFloat(0, 0.2)
  const hasChoke = roadLen > CHOKE_LENGTH * 3

  // Step 1: 生成直线路点
  for (let i = 0; i <= numWaypoints; i++) {
    const t = i / numWaypoints
    waypoints.push({
      x: startX + roadDx * t,
      z: startZ + roadDz * t,
      halfWidth, isChoke: false,
    })
  }

  // Step 2: 轻微弯曲（短道路走直线）
  if (roadLen >= MIN_CURVE_LENGTH) {
    const curveOffset = rng.nextFloat(-CURVE_RATIO, CURVE_RATIO) * roadLen
    for (let i = 1; i < waypoints.length - 1; i++) {
      const t = i / numWaypoints
      const curveFactor = 4 * t * (1 - t)
      waypoints[i].x += perpX * curveOffset * curveFactor
      waypoints[i].z += perpZ * curveOffset * curveFactor
    }
  }

  // Step 3: 卡口收窄（不在区域内部设卡口）
  if (hasChoke) {
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i]
      if (_insideAnyZone(wp.x, wp.z, 0, [a, b])) continue

      const t = i / (waypoints.length - 1)
      const distToChoke = Math.abs(t - chokeT) * roadLen
      if (distToChoke < CHOKE_LENGTH / 2) {
        const chokeBlend = 1 - (distToChoke / (CHOKE_LENGTH / 2))
        wp.halfWidth = halfWidth + (chokeHalf - halfWidth) * chokeBlend
        wp.isChoke = true
      } else if (distToChoke < CHOKE_LENGTH) {
        const transBlend = 1 - ((distToChoke - CHOKE_LENGTH / 2) / (CHOKE_LENGTH / 2))
        wp.halfWidth = halfWidth + (chokeHalf - halfWidth) * transBlend * 0.3
      }
    }
  }

  // 构建卡口信息（只有在区域外部才标记）
  let choke: ChokePoint | null = null
  if (hasChoke) {
    // 找到实际卡口路点
    const chokeWp = waypoints.find(wp => wp.isChoke)
    if (chokeWp) {
      choke = {
        x: chokeWp.x,
        z: chokeWp.z,
        halfWidth: chokeHalf,
        angle: Math.atan2(nz, nx),
      }
    }
  }

  return {
    fromZoneId: edge.fromId, toZoneId: edge.toId,
    roadWidth: edge.roadWidth,
    waypoints, choke, heightDiff,
  }
}

/**
 * 光栅化一段道路到网格
 */
function _rasterizeSegment(
  wp0: RoadWaypoint,
  wp1: RoadWaypoint,
  grid: Uint8Array,
  res: number,
  halfW: number,
  halfH: number,
): void {
  const dx = wp1.x - wp0.x
  const dz = wp1.z - wp0.z
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 0.01) return

  const steps = Math.ceil(len * 2)
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = wp0.x + dx * t
    const z = wp0.z + dz * t
    const hw = wp0.halfWidth + (wp1.halfWidth - wp0.halfWidth) * t
    const isChoke = wp0.isChoke || wp1.isChoke

    // 在此点周围填充宽度范围内的格子
    const col0 = Math.max(0, Math.floor(((x - hw) + halfW) / (halfW * 2) * res))
    const col1 = Math.min(res - 1, Math.ceil(((x + hw) + halfW) / (halfW * 2) * res))
    const row0 = Math.max(0, Math.floor(((z - hw) + halfH) / (halfH * 2) * res))
    const row1 = Math.min(res - 1, Math.ceil(((z + hw) + halfH) / (halfH * 2) * res))

    const val = isChoke ? 2 : 1
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        // 精确检查点是否在道路宽度内
        const px = (col / res) * halfW * 2 - halfW
        const pz = (row / res) * halfH * 2 - halfH
        const pdx = px - x
        const pdz = pz - z

        // 投影到道路法线方向
        const nx = -dz / len
        const nz = dx / len
        const perpDist = Math.abs(pdx * nx + pdz * nz)

        if (perpDist <= hw) {
          const idx = row * res + col
          if (grid[idx] < val) grid[idx] = val
        }
      }
    }
  }
}

// ── 道路合并 ──

const ROAD_WIDTH_ORDER: Record<RoadWidth, number> = { wide: 3, medium: 2, narrow: 1 }

/**
 * 合并冗余道路。
 *
 * 检测条件（满足任一即合并）：
 *   A. 平行重叠：路点平均距离 < 半宽之和 且 方向角差 < 35°
 *   B. 共享端点 + 路径贴近：两条路共享一个端点区域，
 *      且非共享端的路点到另一条路的距离 < 半宽之和 × 1.5
 *
 * 合并策略：保留较宽的道路。
 */
function _mergeParallelRoads(roads: RoadSegment[]): RoadSegment[] {
  const removed = new Set<number>()

  for (let i = 0; i < roads.length; i++) {
    if (removed.has(i)) continue
    for (let j = i + 1; j < roads.length; j++) {
      if (removed.has(j)) continue

      const ri = roads[i], rj = roads[j]
      const mergeThreshold = _roadMaxHalfWidth(ri) + _roadMaxHalfWidth(rj)

      let shouldMerge = false

      // Case A: parallel overlap
      const avgDist = _roadAvgDistance(ri, rj)
      if (avgDist <= mergeThreshold) {
        const dirI = _roadDirection(ri)
        const dirJ = _roadDirection(rj)
        const dot = dirI.dx * dirJ.dx + dirI.dz * dirJ.dz
        if (Math.abs(dot) >= 0.82) shouldMerge = true  // ~35°
      }

      // Case B: shared endpoint + close paths
      if (!shouldMerge) {
        const shareFrom = ri.fromZoneId === rj.fromZoneId || ri.fromZoneId === rj.toZoneId
        const shareTo = ri.toZoneId === rj.fromZoneId || ri.toZoneId === rj.toZoneId
        if (shareFrom || shareTo) {
          if (avgDist <= mergeThreshold * 1.5) {
            shouldMerge = true
          }
        }
      }

      if (!shouldMerge) continue

      const widthI = ROAD_WIDTH_ORDER[ri.roadWidth] ?? 0
      const widthJ = ROAD_WIDTH_ORDER[rj.roadWidth] ?? 0
      if (widthI >= widthJ) {
        removed.add(j)
      } else {
        removed.add(i)
        break
      }
    }
  }

  return roads.filter((_, idx) => !removed.has(idx))
}

function _roadAvgDistance(a: RoadSegment, b: RoadSegment): number {
  const wpsA = a.waypoints, wpsB = b.waypoints
  if (wpsA.length === 0 || wpsB.length === 0) return Infinity

  let totalDist = 0
  let count = 0

  // Sample points along road A, find min distance to road B
  const sampleCount = Math.min(5, wpsA.length)
  for (let s = 0; s < sampleCount; s++) {
    const idx = Math.floor(s * (wpsA.length - 1) / Math.max(1, sampleCount - 1))
    const p = wpsA[idx]
    let minD = Infinity
    for (const q of wpsB) {
      const dx = p.x - q.x, dz = p.z - q.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < minD) minD = d
    }
    totalDist += minD
    count++
  }

  return count > 0 ? totalDist / count : Infinity
}

function _roadMaxHalfWidth(road: RoadSegment): number {
  let maxHW = 0
  for (const wp of road.waypoints) {
    if (wp.halfWidth > maxHW) maxHW = wp.halfWidth
  }
  return maxHW
}

function _roadDirection(road: RoadSegment): { dx: number; dz: number } {
  const wps = road.waypoints
  if (wps.length < 2) return { dx: 1, dz: 0 }
  const first = wps[0], last = wps[wps.length - 1]
  const dx = last.x - first.x, dz = last.z - first.z
  const len = Math.sqrt(dx * dx + dz * dz) || 1
  return { dx: dx / len, dz: dz / len }
}
