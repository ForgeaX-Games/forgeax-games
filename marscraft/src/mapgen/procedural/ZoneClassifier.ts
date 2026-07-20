/**
 * 分区分类器 — 将 Voronoi 区域映射为游戏功能分区
 *
 * 分区类型决定了装饰物布局策略和沟壑填充策略：
 *
 *   mineral_zone   — 矿区（资源基地周围），装饰物稀疏，留出采矿空间
 *   spawn_zone     — 出生点区域，几乎无装饰，最大操作空间
 *   open_battle    — 开阔战斗区域（低地平原），少量 LOS blocker
 *   dense_battle   — 密林战斗区域（高地/中地），边缘密集装饰+内部散布
 *   corridor       — 纯通行区域（road_node），两侧紧密装饰形成走廊
 *   wasteland      — 地图边缘荒地，密集装饰填充
 *
 * 每个分区的装饰物布局原则：
 *   - 装饰物紧密布局在分区边缘（形成自然边界感）
 *   - 留出固定宽度的通道（CORRIDOR_WIDTH）保证单位通行
 *   - 分区内部根据类型决定装饰密度
 */

import type { VoronoiRegion, VoronoiResult } from './VoronoiEngine'
import type { SeedHint } from './ElementDistributor'
import type { MapBlueprint, TrenchDef } from '../types'
import { SeededRandom } from './SeededRandom'

// ── 分区类型 ──

export type ZoneType =
  | 'mineral_zone'
  | 'spawn_zone'
  | 'open_battle'
  | 'dense_battle'
  | 'corridor'
  | 'wasteland'
  | 'none'

export interface ZoneInfo {
  regionId: number
  type: ZoneType
  cx: number
  cz: number
  height: number
}

// ── 分区装饰配置 ──

export interface ZoneDecoConfig {
  /** 分区边缘装饰物密度 (0-1)，1=最密 */
  edgeDensity: number
  /** 分区内部装饰物密度 (0-1) */
  interiorDensity: number
  /** 通道宽度（世界单位），装饰物不会侵入此宽度的通行带 */
  corridorWidth: number
  /** 允许的装饰物类型 */
  decoTypes: string[]
  /** 是否阻挡寻路 */
  blocksPathing: boolean
}

const ZONE_DECO_CONFIGS: Record<ZoneType, ZoneDecoConfig> = {
  mineral_zone: {
    edgeDensity: 0.55,
    interiorDensity: 0.08,
    corridorWidth: 8,
    decoTypes: ['rock', 'crystal'],
    blocksPathing: false,
  },
  spawn_zone: {
    edgeDensity: 0.35,
    interiorDensity: 0.03,
    corridorWidth: 12,
    decoTypes: ['rock'],
    blocksPathing: false,
  },
  open_battle: {
    edgeDensity: 0.75,
    interiorDensity: 0.18,
    corridorWidth: 6,
    decoTypes: ['rock', 'plant'],
    blocksPathing: false,
  },
  dense_battle: {
    edgeDensity: 0.95,
    interiorDensity: 0.45,
    corridorWidth: 4,
    decoTypes: ['rock', 'plant', 'ruins', 'machinery'],
    blocksPathing: true,
  },
  corridor: {
    edgeDensity: 0.95,
    interiorDensity: 0.15,
    corridorWidth: 4,
    decoTypes: ['rock', 'barricade'],
    blocksPathing: true,
  },
  wasteland: {
    edgeDensity: 0.9,
    interiorDensity: 0.55,
    corridorWidth: 5,
    decoTypes: ['rock', 'ruins', 'machinery'],
    blocksPathing: true,
  },
  none: {
    edgeDensity: 0.4,
    interiorDensity: 0.1,
    corridorWidth: 6,
    decoTypes: ['rock', 'plant'],
    blocksPathing: false,
  },
}

export function getZoneDecoConfig(type: ZoneType): ZoneDecoConfig {
  return ZONE_DECO_CONFIGS[type]
}

// ── 分区分类 (Zone-First) ──

/**
 * 基于地形、位置、邻接关系划分功能分区
 *
 * 不依赖 seedRoles 的角色/资源信息，只使用：
 *   - 区域位置（distFromCenter、坐标）
 *   - 区域高度（CL0/CL1/CL2）
 *   - 邻接关系（neighbors）
 *   - 种子 hint（位置偏好提示，仅辅助参考）
 *
 * 分区规则（严格控制矿区数量）：
 *   1. 距中心最远的 hint='base' 对称区域对 → spawn_zone
 *   2. 每个出生点最多 1 个相邻区域 → mineral_zone（分矿）
 *   3. 最多 1 对散矿（hint='resource' + 中等距离）→ mineral_zone
 *   4. 地图边缘 (distFromCenter > 0.85) → wasteland
 *   5. 高地 (height >= 1) → dense_battle
 *   6. 中心低地 (distFromCenter < 0.4, height === 0) → open_battle
 *   7. 其余 → none（不着色）
 */
export function classifyZones(
  regions: VoronoiRegion[],
  hints: SeedHint[],
): ZoneInfo[] {
  const n = regions.length
  const types: ZoneType[] = new Array(n).fill('none')

  // ── Step 1: 找出生点（距中心最远的 hint='base' 区域） ──
  let spawnIdx1 = -1
  let spawnIdx2 = -1

  let maxDist = -1
  for (let i = 0; i < n; i++) {
    if (hints[i] === 'base' && regions[i].distFromCenter > maxDist) {
      maxDist = regions[i].distFromCenter
      spawnIdx1 = i
    }
  }

  if (spawnIdx1 >= 0) {
    types[spawnIdx1] = 'spawn_zone'
    if (spawnIdx1 % 2 === 0 && spawnIdx1 + 1 < n) {
      spawnIdx2 = spawnIdx1 + 1
    } else if (spawnIdx1 % 2 === 1 && spawnIdx1 - 1 >= 0) {
      spawnIdx2 = spawnIdx1 - 1
    }
    if (spawnIdx2 >= 0) types[spawnIdx2] = 'spawn_zone'
  }

  const spawnSet = new Set<number>()
  if (spawnIdx1 >= 0) spawnSet.add(spawnIdx1)
  if (spawnIdx2 >= 0) spawnSet.add(spawnIdx2)

  // ── Step 2: 每个出生点最多 1 个相邻分矿（必须同高度） ──
  for (const si of spawnSet) {
    let bestNeighbor = -1
    let bestScore = -1
    const spawnHeight = regions[si].height
    for (const nIdx of regions[si].neighbors) {
      if (spawnSet.has(nIdx) || types[nIdx] !== 'none') continue
      if (regions[nIdx].height !== spawnHeight) continue // 必须同高度
      let score = 0
      if (hints[nIdx] === 'resource') score += 10
      score += (1 - regions[nIdx].distFromCenter) * 3
      if (score > bestScore) { bestScore = score; bestNeighbor = nIdx }
    }
    if (bestNeighbor >= 0) {
      types[bestNeighbor] = 'mineral_zone'
    }
  }

  // ── Step 3: 最多 1 对散矿（中等距离，CL0 低地） ──
  const MAX_SCATTERED_MINERALS = 1
  let scatteredCount = 0
  for (let i = 0; i < n - 1 && scatteredCount < MAX_SCATTERED_MINERALS; i += 2) {
    if (types[i] !== 'none' || types[i + 1] !== 'none') continue
    if (hints[i] !== 'resource') continue
    if (regions[i].height !== 0) continue // 散矿只放在低地
    const d = regions[i].distFromCenter
    if (d < 0.3 || d > 0.7) continue
    types[i] = 'mineral_zone'
    if (i + 1 < n) types[i + 1] = 'mineral_zone'
    scatteredCount++
  }

  // ── Step 4-7: 按地形和位置分类剩余区域 ──
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'none') continue

    if (regions[i].distFromCenter > 0.85) {
      types[i] = 'wasteland'
    } else if (regions[i].height >= 1) {
      types[i] = 'dense_battle'
    } else if (regions[i].distFromCenter < 0.4 && regions[i].height === 0) {
      types[i] = 'open_battle'
    }
    // else remains 'none'
  }

  return regions.map((reg, i) => ({
    regionId: reg.id,
    type: types[i],
    cx: reg.cx,
    cz: reg.cz,
    height: reg.height,
  }))
}

// ── 分区网格 ──

/**
 * 将分区信息光栅化为与 Voronoi ownership 同分辨率的网格
 * 每个格子存储其所属分区的 ZoneType 索引
 */
export type ZoneGrid = Uint8Array

const ZONE_TYPE_INDEX: Record<ZoneType, number> = {
  mineral_zone: 0,
  spawn_zone:   1,
  open_battle:  2,
  dense_battle: 3,
  corridor:     4,
  wasteland:    5,
  none:         6,
}

const INDEX_TO_ZONE: ZoneType[] = [
  'mineral_zone', 'spawn_zone', 'open_battle',
  'dense_battle', 'corridor', 'wasteland', 'none',
]

export function buildZoneGrid(
  ownership: Int16Array,
  zones: ZoneInfo[],
  voronoiRes: number,
  mapWidth?: number,
  mapHeight?: number,
  ramps?: { ax: number; az: number; bx: number; bz: number; width: number }[],
): ZoneGrid {
  const grid = new Uint8Array(voronoiRes * voronoiRes)
  for (let i = 0; i < voronoiRes * voronoiRes; i++) {
    const regIdx = ownership[i]
    if (regIdx >= 0 && regIdx < zones.length) {
      grid[i] = ZONE_TYPE_INDEX[zones[regIdx].type]
    } else {
      grid[i] = ZONE_TYPE_INDEX['wasteland']
    }
  }

  // 将坡道及其延伸通道覆盖为 corridor
  if (ramps && mapWidth && mapHeight) {
    const corridorIdx = ZONE_TYPE_INDEX['corridor']
    const halfW = mapWidth / 2
    const halfH = mapHeight / 2
    for (const ramp of ramps) {
      const dx = ramp.bx - ramp.ax
      const dz = ramp.bz - ramp.az
      const len = Math.sqrt(dx * dx + dz * dz)
      if (len < 0.01) continue
      const ux = dx / len
      const uz = dz / len
      const nx = -uz
      const nz = ux

      // 通道半宽：仅比坡道本身稍宽
      const hw = ramp.width * 0.5 + 1
      // 沿坡道方向前后各延伸少量
      const EXT = 2
      const ax = ramp.ax - ux * EXT
      const az = ramp.az - uz * EXT
      const bx = ramp.bx + ux * EXT
      const bz = ramp.bz + uz * EXT
      const edx = bx - ax
      const edz = bz - az
      const elen = Math.sqrt(edx * edx + edz * edz)

      const xs = [ax - nx * hw, ax + nx * hw, bx - nx * hw, bx + nx * hw]
      const zs = [az - nz * hw, az + nz * hw, bz - nz * hw, bz + nz * hw]
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minZ = Math.min(...zs), maxZ = Math.max(...zs)

      const colMin = Math.max(0, Math.floor(((minX + halfW) / mapWidth) * voronoiRes))
      const colMax = Math.min(voronoiRes - 1, Math.ceil(((maxX + halfW) / mapWidth) * voronoiRes))
      const rowMin = Math.max(0, Math.floor(((minZ + halfH) / mapHeight) * voronoiRes))
      const rowMax = Math.min(voronoiRes - 1, Math.ceil(((maxZ + halfH) / mapHeight) * voronoiRes))

      for (let row = rowMin; row <= rowMax; row++) {
        for (let col = colMin; col <= colMax; col++) {
          const wx = (col / voronoiRes) * mapWidth - halfW
          const wz = (row / voronoiRes) * mapHeight - halfH
          const rx = wx - ax
          const rz = wz - az
          const along = (rx * edx + rz * edz) / (elen * elen)
          if (along < 0 || along > 1) continue
          const perp = Math.abs(rx * nx + rz * nz)
          if (perp <= hw) {
            grid[row * voronoiRes + col] = corridorIdx
          }
        }
      }
    }
  }

  return grid
}

export function getZoneAt(grid: ZoneGrid, idx: number): ZoneType {
  return INDEX_TO_ZONE[grid[idx]] ?? 'wasteland'
}

// ── 沟壑自动填充 ──

export interface TrenchFillConfig {
  /** 沟壑填充区域占比 (0-1)，默认 0.08 */
  trenchRatio: number
  /** 沟壑类型权重 */
  trenchTypeWeights: { lava: number; water: number; void: number }
  /** 沟壑最小半径 */
  minRadius: number
  /** 沟壑最大半径 */
  maxRadius: number
}

const DEFAULT_TRENCH_CONFIG: TrenchFillConfig = {
  trenchRatio: 0.08,
  trenchTypeWeights: { lava: 5, water: 3, void: 2 },
  minRadius: 4,
  maxRadius: 10,
}

/**
 * 在合适的区域自动生成沟壑
 *
 * 放置规则：
 *   - 只在 open_battle / dense_battle / wasteland 分区放置
 *   - 不在 mineral_zone / spawn_zone / corridor 放置
 *   - 沟壑中心放在分区边界附近（增加战术分隔感）
 *   - 避开坡道、资源点、出生点
 */
export function generateAutoTrenches(
  zones: ZoneInfo[],
  regions: VoronoiRegion[],
  voronoi: VoronoiResult,
  bp: MapBlueprint,
  seed: number,
  config: Partial<TrenchFillConfig> = {},
): TrenchDef[] {
  // Filter out undefined values so defaults aren't overwritten
  const defined: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) { if (v !== undefined) defined[k] = v }
  const cfg = { ...DEFAULT_TRENCH_CONFIG, ...defined } as TrenchFillConfig
  const rng = new SeededRandom(seed ^ 0xDEAD)
  const trenches: TrenchDef[] = []

  const halfW = bp.width / 2
  const halfH = bp.height / 2
  const edgeDist = bp.edgeDist ?? Math.min(halfW, halfH) - 8

  const allowedZones = new Set<ZoneType>(['open_battle', 'dense_battle', 'wasteland', 'mineral_zone', 'corridor'])

  // Only spawn points need large clearance; base CCs get minimal clearance
  const safePoints: { x: number; z: number; clearR: number }[] = []
  if (bp.spawnPoints) for (const s of bp.spawnPoints) {
    safePoints.push({ x: s.x, z: s.z, clearR: 10 })
  }
  if (bp.bases) for (const b of bp.bases) {
    safePoints.push({ x: b.ccX, z: b.ccZ, clearR: 3 })
  }

  const rampCenters = (bp.ramps ?? []).map(r => ({
    x: (r.ax + r.bx) / 2,
    z: (r.az + r.bz) / 2,
    clearR: r.width,
  }))

  // 按面积计算目标沟壑数
  const mapArea = bp.width * bp.height
  const targetTrenchArea = mapArea * cfg.trenchRatio
  let placedArea = 0

  // 类型轮盘
  const typePool: ('lava' | 'water' | 'void')[] = []
  for (let i = 0; i < cfg.trenchTypeWeights.lava; i++) typePool.push('lava')
  for (let i = 0; i < cfg.trenchTypeWeights.water; i++) typePool.push('water')
  for (let i = 0; i < cfg.trenchTypeWeights.void; i++) typePool.push('void')

  // 候选位置：允许分区内的任何区域边界，以及不同高度的边界
  const candidates: { x: number; z: number; zone: ZoneType }[] = []
  const seenPairs = new Set<string>()
  for (const zone of zones) {
    if (!allowedZones.has(zone.type)) continue
    const reg = regions[zone.regionId]
    for (const nIdx of reg.neighbors) {
      // 去重：每对邻居只处理一次
      const pairKey = Math.min(reg.id, nIdx) + ':' + Math.max(reg.id, nIdx)
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)

      const neighbor = regions[nIdx]
      const nZone = zones[nIdx]
      if (!nZone) continue
      // spawn_zone 内部不放沟壑
      if (zone.type === 'spawn_zone' || nZone.type === 'spawn_zone') continue

      const midX = (reg.cx + neighbor.cx) / 2
      const midZ = (reg.cz + neighbor.cz) / 2

      if (Math.abs(midX) > edgeDist - 5 || Math.abs(midZ) > edgeDist - 5) continue
      candidates.push({ x: midX, z: midZ, zone: zone.type })
    }
  }

  // 洗牌候选
  rng.shuffle(candidates)

  const placedCenters: { x: number; z: number }[] = []
  const MIN_TRENCH_SPACING = 12

  for (const cand of candidates) {
    if (placedArea >= targetTrenchArea) break

    const r = cfg.minRadius + rng.next() * (cfg.maxRadius - cfg.minRadius)

    if (safePoints.some(p => Math.hypot(p.x - cand.x, p.z - cand.z) < p.clearR + r)) continue
    if (rampCenters.some(rc => Math.hypot(rc.x - cand.x, rc.z - cand.z) < rc.clearR + r)) continue
    if (placedCenters.some(p => Math.hypot(p.x - cand.x, p.z - cand.z) < MIN_TRENCH_SPACING)) continue

    const trenchType = typePool[rng.nextInt(typePool.length)]
    const depth = 1 + rng.nextInt(2) as 1 | 2 | 3

    trenches.push({
      x: cand.x,
      z: cand.z,
      r,
      type: trenchType,
      depth,
    })

    placedCenters.push({ x: cand.x, z: cand.z })
    placedArea += Math.PI * r * r

    const mx = -cand.x, mz = -cand.z
    if (Math.abs(mx) < edgeDist - 5 && Math.abs(mz) < edgeDist - 5) {
      if (!safePoints.some(p => Math.hypot(p.x - mx, p.z - mz) < p.clearR + r) &&
          !rampCenters.some(rc => Math.hypot(rc.x - mx, rc.z - mz) < rc.clearR + r) &&
          !placedCenters.some(p => Math.hypot(p.x - mx, p.z - mz) < MIN_TRENCH_SPACING)) {
        trenches.push({ x: mx, z: mz, r, type: trenchType, depth })
        placedCenters.push({ x: mx, z: mz })
        placedArea += Math.PI * r * r
      }
    }
  }

  return trenches
}
