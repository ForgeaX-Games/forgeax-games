/**
 * 区域图 — V2 地图生成的拓扑定义层
 *
 * V2 新版：骨架优先。
 * - generateZoneGraph() 只生成节点（不生成边）
 * - 边由 EdgeBuilder 在区域放置后根据空间关系计算
 * - positionHint 基于骨架位置
 *
 * 区域类型只描述功能，高度是独立属性。
 */

import { SeededRandom } from './SeededRandom'
import { generateSpine, DEFAULT_SPINE_PARAMS } from './SpineGenerator'
import type { SpineParams, Spine } from './SpineGenerator'

// ── 区域节点类型（纯功能） ──

export type ZoneNodeType =
  | 'main_base'      // 主矿基地
  | 'expansion'      // 扩张矿区
  | 'battlefield'    // 战场（交战区）
  | 'passage'        // 通道（绕后/侧翼路线）
  | 'wasteland'      // 荒地
  | 'anchor'         // 骨架锚点（虚拟，用于支路连接）

export interface ZoneNode {
  id: string
  type: ZoneNodeType
  minRadius: number
  height: number
  onAxis?: boolean
  positionHint: { x: number; z: number }
}

// ── 道路 ──

export type RoadWidth = 'wide' | 'medium' | 'narrow'

export const ROAD_WIDTH_VALUES: Record<RoadWidth, number> = {
  wide:   24,
  medium: 16,
  narrow: 10,
}

export interface ZoneEdge {
  from: string
  to: string
  roadWidth: RoadWidth
  chokeWidth?: number
}

// ── 图模板 ──

import type { SymmetryMode } from './SymmetryFramework'

export type SymmetryType = SymmetryMode

export interface ZoneGraphTemplate {
  name: string
  nodes: ZoneNode[]
  edges: ZoneEdge[]
  symmetry: SymmetryType
  spine: Spine
}

// ── 放置结果 ──

export interface PlacedZone {
  id: string
  type: ZoneNodeType
  cx: number
  cz: number
  radius: number
  height: number
  mirrorOf?: string
}

export interface PlacedEdge {
  fromId: string
  toId: string
  roadWidth: RoadWidth
  chokeWidth: number
}

export interface PlacedZoneGraph {
  zones: PlacedZone[]
  edges: PlacedEdge[]
  mapWidth: number
  mapHeight: number
}

// ================================================================
// 参数化生成
// ================================================================

export interface ZoneGraphParams {
  /** 骨架参数 */
  spine?: SpineParams
  /** 对称方式，默认 rotation_180 */
  symmetry?: SymmetryType
  /** 每个玩家的扩张矿区数量（不含主矿），0~6，默认 2 */
  expansions?: number
  /** 战场数量，0~6，默认 1 */
  battlefields?: number
  /** 通道数量，0~4，默认 1 */
  passages?: number
  /** 高度变化 0=全平 1=标准 2=复杂，默认 1 */
  heightVariance?: number
  /** 随机种子 */
  seed?: number
}

const DEFAULT_PARAMS: Required<ZoneGraphParams> = {
  spine: DEFAULT_SPINE_PARAMS,
  symmetry: 'rotation_180',
  expansions: 2,
  battlefields: 1,
  passages: 1,
  heightVariance: 1,
  seed: 42,
}

/**
 * 动态生成区域图。
 *
 * V2 新版：只生成节点，不生成边。
 * 边由 EdgeBuilder 在区域放置后根据空间关系计算。
 *
 * 区域与骨架的空间关系（参考 SC2）：
 *   - 主基地：地图角落，骨架起点附近但偏离主路
 *   - 第一矿（natural）：紧挨基地，在基地和主路之间
 *   - 远矿：主路侧面的分支末端
 *   - 战场：主路沿线的宽阔区域
 *   - 通道：主路侧翼的小路
 */
export function generateZoneGraph(params: ZoneGraphParams = {}): ZoneGraphTemplate {
  const p = { ...DEFAULT_PARAMS, ...params }
  const rng = new SeededRandom(p.seed)

  const spine = generateSpine(p.spine, p.symmetry, p.seed)

  const nodes: ZoneNode[] = []

  const mainH = p.heightVariance >= 1 ? 2 : 0
  const nearExpH = p.heightVariance >= 1 ? 2 : 0

  const baseNode = spine.nodes.find(n => n.id === 'base_P1')
  const base = baseNode ? baseNode.position : _p1BaseCorner(p.symmetry, rng)

  // P1→P2 全局方向
  const baseP2 = spine.nodes.find(n => n.id === 'base_P2')
  const p2 = baseP2 ? baseP2.position : { x: -base.x, z: -base.z }
  const mainDx = p2.x - base.x, mainDz = p2.z - base.z
  const mainDist = Math.sqrt(mainDx * mainDx + mainDz * mainDz) || 1
  const mainTx = mainDx / mainDist, mainTz = mainDz / mainDist

  // P1→P2 方向的法线（垂直于主轴）
  const perpNx = -mainTz, perpNz = mainTx

  // 构建骨架参考路径：取所有路径段，按 P1→P2 方向排序
  // 对于多 lane，合并所有路点并按沿主轴投影排序
  const spineRefPts: { x: number; z: number }[] = [base]
  for (const n of spine.nodes) {
    if (n.role === 'waypoint' || n.role === 'crossing') {
      spineRefPts.push(n.position)
    }
  }
  spineRefPts.push(p2)
  spineRefPts.sort((a, b) => {
    const ta = (a.x - base.x) * mainTx + (a.z - base.z) * mainTz
    const tb = (b.x - base.x) * mainTx + (b.z - base.z) * mainTz
    return ta - tb
  })

  // 计算参考路径上某个 t (0~1) 处的位置和局部法线
  function spineRefAt(t: number): { x: number; z: number; nx: number; nz: number } {
    const idx = t * (spineRefPts.length - 1)
    const i0 = Math.max(0, Math.min(spineRefPts.length - 2, Math.floor(idx)))
    const frac = idx - i0
    const a = spineRefPts[i0], b = spineRefPts[i0 + 1]
    const x = a.x + (b.x - a.x) * frac
    const z = a.z + (b.z - a.z) * frac
    const dx = b.x - a.x, dz = b.z - a.z
    const d = Math.sqrt(dx * dx + dz * dz) || 1
    return { x, z, nx: -dz / d, nz: dx / d }
  }

  const isCorridor = spine.type !== 'open' && spineRefPts.length > 2

  // ── 1. 主基地 ──
  // 基地在骨架后方：沿 P2→P1 方向大幅后退
  {
    const retreatDist = 0.35 + rng.nextFloat(0, 0.10)
    const lateralOff = rng.nextFloat(-0.08, 0.08)
    nodes.push({
      id: 'main_P1',
      type: 'main_base',
      minRadius: 14,
      height: mainH,
      positionHint: {
        x: base.x - mainTx * retreatDist + perpNx * lateralOff,
        z: base.z - mainTz * retreatDist + perpNz * lateralOff,
      },
    })
  }

  // ── 2. 矿区 ──
  // natural 在基地附近侧方，远矿沿骨架分散到两侧
  const naturalSide = rng.nextFloat(0, 1) > 0.5 ? 1 : -1
  for (let i = 0; i < p.expansions; i++) {
    const id = `exp${i + 1}_P1`
    const radius = i === 0 ? 10 : 8

    let h = 0
    if (i === 0) {
      h = nearExpH
    } else if (p.heightVariance >= 1) {
      h = rng.nextInt(2)  // 远矿 0 或 1
    }

    let hint: { x: number; z: number }

    if (isCorridor) {
      if (i === 0) {
        // Natural：基地附近，沿局部法线侧移
        const ref = spineRefAt(0.05)
        const sideOffset = 0.25 + rng.nextFloat(0, 0.12)
        const fwdOffset = 0.02 + rng.nextFloat(0, 0.06)
        hint = {
          x: base.x + mainTx * fwdOffset + ref.nx * naturalSide * sideOffset,
          z: base.z + mainTz * fwdOffset + ref.nz * naturalSide * sideOffset,
        }
      } else {
        // 远矿分布策略：
        //   第 2 矿（i=1）：基地附近另一侧，tAlong 小
        //   第 3~4 矿（i=2,3）：骨架中段两侧，tAlong 中等
        //   第 5+ 矿（i>=4）：推向地图远端角落，tAlong 大
        const sideSign = (i % 2 === 1) ? -naturalSide : naturalSide

        let tAlong: number
        let sideOffset: number
        if (i <= 1) {
          // 近矿：基地附近
          tAlong = 0.05 + i * 0.10 + rng.nextFloat(0, 0.06)
          sideOffset = 0.40 + rng.nextFloat(0.05, 0.20)
        } else if (i <= 3) {
          // 中距离矿：骨架中段两侧
          tAlong = 0.20 + (i - 2) * 0.18 + rng.nextFloat(0, 0.08)
          sideOffset = 0.45 + rng.nextFloat(0.05, 0.25)
        } else {
          // 远端矿：推向地图角落
          tAlong = 0.45 + (i - 4) * 0.12 + rng.nextFloat(0, 0.08)
          sideOffset = 0.55 + rng.nextFloat(0.10, 0.30)
        }
        tAlong = Math.min(tAlong, 0.85)

        const ref = spineRefAt(tAlong)
        const tangentOffset = rng.nextFloat(-0.05, 0.05)
        hint = {
          x: ref.x + ref.nx * sideSign * sideOffset + mainTx * tangentOffset,
          z: ref.z + ref.nz * sideSign * sideOffset + mainTz * tangentOffset,
        }
      }
    } else {
      const angles = _spreadAngles(p.expansions, Math.PI * 0.25, Math.PI * 0.5, rng)
      const a = angles[i]
      const distStep = 0.15 + i * 0.12
      hint = {
        x: base.x + Math.cos(a) * distStep,
        z: base.z + Math.sin(a) * distStep,
      }
    }

    nodes.push({ id, type: 'expansion', minRadius: radius, height: h, positionHint: hint })
  }

  // ── 3. 战场 ──
  // 战场在骨架路线中段，可以直接在骨架上（交战区域）
  for (let i = 0; i < p.battlefields; i++) {
    const id = `bf_${String.fromCharCode(65 + i)}`

    let h = 0
    if (p.heightVariance >= 1) {
      h = rng.nextFloat(0, 1) < 0.6 ? 1 : 0
    }
    if (p.heightVariance >= 2) h = rng.nextRange(0, 1)

    let hint: { x: number; z: number }
    if (isCorridor) {
      const t = 0.45 + i * 0.10 + rng.nextFloat(-0.05, 0.05)
      const ref = spineRefAt(Math.min(t, 0.85))
      const sideOffset = rng.nextFloat(-0.08, 0.08)
      hint = {
        x: ref.x + ref.nx * sideOffset,
        z: ref.z + ref.nz * sideOffset,
      }
    } else {
      const bfAngles = _spreadAngles(p.battlefields, Math.PI * 0.35, Math.PI * 0.7, rng)
      const a = bfAngles[i]
      const dist = 0.2 + rng.nextFloat(0, 0.25)
      hint = {
        x: base.x * (0.3 + dist * Math.cos(a)),
        z: base.z * (0.3 + dist * Math.sin(a)),
      }
    }

    nodes.push({
      id, type: 'battlefield',
      minRadius: 10 + rng.nextInt(4), height: h,
      positionHint: hint,
    })
  }

  // ── 4. 通道 ──
  // 通道在骨架侧翼（绕后小路），可以贴着骨架也可以稍远
  for (let i = 0; i < p.passages; i++) {
    const id = `pass_${String.fromCharCode(65 + i)}`

    let h = 0
    if (p.heightVariance >= 1) {
      h = rng.nextFloat(0, 1) < 0.5 ? 1 : 0
    }
    if (p.heightVariance >= 2) h = rng.nextRange(0, 1)

    let hint: { x: number; z: number }
    if (isCorridor) {
      const t = 0.15 + i * 0.15 + rng.nextFloat(-0.05, 0.05)
      const ref = spineRefAt(Math.min(t, 0.5))
      const sideSign = (i % 2 === 0) ? 1 : -1
      const sideOffset = 0.45 + rng.nextFloat(0.05, 0.30)
      const tangentOffset = rng.nextFloat(-0.1, 0.1)
      hint = {
        x: ref.x + ref.nx * sideSign * sideOffset + mainTx * tangentOffset,
        z: ref.z + ref.nz * sideSign * sideOffset + mainTz * tangentOffset,
      }
    } else {
      const lateral = 0.05 + i * 0.25 + rng.nextFloat(-0.1, 0.1)
      hint = {
        x: base.x * 0.5 + rng.nextFloat(-0.2, 0.2),
        z: base.z * 0.2 - lateral * Math.sign(base.z || 1),
      }
    }

    nodes.push({ id, type: 'passage', minRadius: 8, height: h, positionHint: hint })
  }

  // ── 5. 边 ──
  // 走廊型：不生成边，由 EdgeBuilder 在放置后根据空间关系计算
  // 开放型：生成边（弹簧力导向布局需要）
  const edges: ZoneEdge[] = []

  if (!isCorridor) {
    // 开放型：恢复旧版连边逻辑
    let lastExpId = 'main_P1'
    for (let i = 0; i < p.expansions; i++) {
      const id = `exp${i + 1}_P1`
      const road: RoadWidth = i === 0 ? 'medium' : 'narrow'
      const connectTo = i <= 1 ? 'main_P1' : lastExpId
      edges.push({ from: connectTo, to: id, roadWidth: road })
      lastExpId = id
    }

    const p1Frontier = p.expansions >= 2 ? 'exp2_P1'
                     : p.expansions >= 1 ? 'exp1_P1'
                     : 'main_P1'

    const battleIds: string[] = []
    for (let i = 0; i < p.battlefields; i++) {
      const id = `bf_${String.fromCharCode(65 + i)}`
      battleIds.push(id)
      edges.push({ from: p1Frontier, to: id, roadWidth: i === 0 ? 'wide' : 'narrow' })
      if (i > 0) edges.push({ from: battleIds[i - 1], to: id, roadWidth: 'narrow' })
    }

    const connectTarget = battleIds.length > 0 ? battleIds[0] : null
    for (let i = 0; i < p.passages; i++) {
      const id = `pass_${String.fromCharCode(65 + i)}`
      const passFrom = p.expansions >= 2 ? 'exp2_P1'
                     : p.expansions >= 1 ? 'exp1_P1'
                     : 'main_P1'
      edges.push({ from: passFrom, to: id, roadWidth: 'narrow' })
      if (connectTarget) edges.push({ from: id, to: connectTarget, roadWidth: 'medium' })
    }
  }

  return {
    name: _templateName(p),
    nodes,
    edges,
    spine,
    symmetry: p.symmetry,
  }
}

// ── 预设 ──

export interface MapPreset {
  id: string
  name: string
  description: string
  params: Omit<ZoneGraphParams, 'seed'> & { spine: SpineParams }
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: 'standard',
    name: '标准对抗',
    description: '双路型，2矿1战场，标准高度',
    params: { spine: { type: 'two_lane' }, expansions: 2, battlefields: 1, passages: 1, heightVariance: 1 },
  },
  {
    id: 'rush',
    name: '速攻',
    description: '直线型，无矿区，全平地',
    params: { spine: { type: 'linear' }, expansions: 0, battlefields: 0, passages: 0, heightVariance: 0 },
  },
  {
    id: 'macro',
    name: '运营大图',
    description: '双路型，4矿2战场2通道，复杂高度',
    params: { spine: { type: 'two_lane' }, expansions: 4, battlefields: 2, passages: 2, heightVariance: 2 },
  },
  {
    id: 'three_way',
    name: '三线作战',
    description: '三通道型，3矿2战场，标准高度',
    params: { spine: { type: 'three_lane' }, expansions: 3, battlefields: 2, passages: 1, heightVariance: 1 },
  },
  {
    id: 'ring_arena',
    name: '环形竞技场',
    description: '环形骨架，2矿2战场，标准高度',
    params: { spine: { type: 'ring' }, expansions: 2, battlefields: 2, passages: 0, heightVariance: 1 },
  },
  {
    id: 'open_field',
    name: '开阔原野',
    description: '开放型，3矿1战场，全平地',
    params: { spine: { type: 'open' }, expansions: 3, battlefields: 1, passages: 1, heightVariance: 0 },
  },
  {
    id: 'fortress',
    name: '高地要塞',
    description: '双路型，2矿1战场1通道，复杂高度',
    params: { spine: { type: 'two_lane', laneShape: 'z_bend' }, expansions: 2, battlefields: 1, passages: 1, heightVariance: 2 },
  },
  {
    id: 'mirror_duel',
    name: '镜像对决',
    description: '双路型，左右镜像对称，2矿1战场',
    params: { spine: { type: 'two_lane' }, symmetry: 'mirror_vertical', expansions: 2, battlefields: 1, passages: 1, heightVariance: 1 },
  },
  {
    id: 'ffa_4p',
    name: '4人混战',
    description: '开放型，90°旋转对称，2矿1战场',
    params: { spine: { type: 'open' }, symmetry: 'rotation_90', expansions: 2, battlefields: 1, passages: 0, heightVariance: 1 },
  },
  {
    id: 'snaking_path',
    name: '蜿蜒小径',
    description: '双路S弯，3矿1战场2通道，标准高度',
    params: { spine: { type: 'two_lane', laneShape: 's_curve', curvature: 0.7 }, expansions: 3, battlefields: 1, passages: 2, heightVariance: 1 },
  },
  {
    id: 'minimal',
    name: '极简对战',
    description: '直线型，1矿1战场，全平',
    params: { spine: { type: 'linear' }, expansions: 1, battlefields: 1, passages: 0, heightVariance: 0 },
  },
]

export function template1v1Standard(seed = 42): ZoneGraphTemplate {
  return generateZoneGraph({ expansions: 2, battlefields: 1, passages: 1, heightVariance: 1, seed })
}

export function template1v1Rush(seed = 42): ZoneGraphTemplate {
  return generateZoneGraph({ expansions: 0, battlefields: 0, passages: 0, heightVariance: 0, seed })
}

export function template1v1Large(seed = 42): ZoneGraphTemplate {
  return generateZoneGraph({ expansions: 3, battlefields: 2, passages: 2, heightVariance: 2, seed })
}

export function template1v1Flat(seed = 42): ZoneGraphTemplate {
  return generateZoneGraph({ expansions: 2, battlefields: 1, passages: 2, heightVariance: 0, seed })
}

export const TEMPLATE_1V1_STANDARD = template1v1Standard()

// ── 辅助 ──

/** P1 主矿角落位置（fallback，正常走骨架） */
function _p1BaseCorner(sym: SymmetryType, rng?: SeededRandom): { x: number; z: number } {
  if (!rng) return { x: -0.75, z: -0.75 }
  switch (sym) {
    case 'rotation_180': {
      const angle = rng.nextFloat(0.1, Math.PI / 2 - 0.1)
      const d = 0.7 + rng.nextFloat(0, 0.12)
      return { x: -Math.sin(angle) * d, z: -Math.cos(angle) * d }
    }
    case 'mirror_vertical':
      return { x: -(0.65 + rng.nextFloat(0, 0.15)), z: rng.nextFloat(-0.6, 0.6) }
    case 'mirror_horizontal':
      return { x: rng.nextFloat(-0.6, 0.6), z: -(0.65 + rng.nextFloat(0, 0.15)) }
    case 'rotation_90': {
      const angle = rng.nextFloat(0.3, Math.PI / 2 - 0.3)
      const d = 0.65 + rng.nextFloat(0, 0.1)
      return { x: -Math.sin(angle) * d, z: -Math.cos(angle) * d }
    }
    case 'none': {
      const angle = rng.nextFloat(0.1, Math.PI / 2 - 0.1)
      const d = 0.7 + rng.nextFloat(0, 0.12)
      return { x: -Math.sin(angle) * d, z: -Math.cos(angle) * d }
    }
  }
}

function _spreadAngles(count: number, baseAngle: number, spread: number, rng: SeededRandom): number[] {
  if (count === 0) return []
  if (count === 1) return [baseAngle + rng.nextFloat(-spread * 0.3, spread * 0.3)]
  const angles: number[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    angles.push(baseAngle - spread / 2 + t * spread + rng.nextFloat(-0.15, 0.15))
  }
  return angles
}

function _templateName(p: Required<ZoneGraphParams>): string {
  const parts: string[] = ['1v1']
  if (p.expansions === 0) parts.push('Rush')
  else if (p.expansions >= 3) parts.push('大图')
  if (p.heightVariance === 0) parts.push('平地')
  else if (p.heightVariance >= 2) parts.push('复杂地形')
  if (p.passages >= 2) parts.push('多路线')
  if (p.battlefields === 0) parts.push('直连')
  return parts.join(' ') || '1v1 标准'
}
