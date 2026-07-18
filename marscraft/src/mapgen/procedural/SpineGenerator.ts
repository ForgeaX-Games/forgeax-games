/**
 * 骨架生成器 — 地图的整体结构
 *
 * 路线设计原则：
 *   上路和下路独立随机生成，形状可以完全不同。
 *   对称性保证：上路 mirrorPoint 后 = 下路（逆序），
 *   即 P1 走上路的体验 = P2 走下路的体验。
 *
 *   路线由多种绕行模式（L/C/S/阶梯/对角/Hook）随机选择，
 *   每条路独立选择模式，产生丰富多样的地图结构。
 */

import { SeededRandom } from './SeededRandom'
import type { SymmetryMode } from './SymmetryFramework'
import { mirrorPoint } from './SymmetryFramework'

// ── 类型 ──

export type SpineType = 'two_lane' | 'open' | 'linear' | 'three_lane' | 'ring'

export interface SpineParams {
  type: SpineType
  laneShape?: 'straight' | 's_curve' | 'z_bend'
  laneCrossings?: number
  laneWidthBalance?: number
  curvature?: number
}

export const DEFAULT_SPINE_PARAMS: SpineParams = {
  type: 'two_lane',
  laneShape: 'straight',
  laneCrossings: 1,
  laneWidthBalance: 0,
  curvature: 0.3,
}

export type SpineNodeRole = 'base' | 'waypoint' | 'junction' | 'crossing'

export interface SpineNode {
  id: string
  position: { x: number; z: number }
  role: SpineNodeRole
  lane?: string
}

export interface SpinePath {
  from: string
  to: string
  lane: string
  width: 'wide' | 'medium' | 'narrow'
}

export interface Spine {
  nodes: SpineNode[]
  paths: SpinePath[]
  type: SpineType
}

// ── 主函数 ──

export function generateSpine(
  params: SpineParams,
  symmetry: SymmetryMode,
  seed: number = 42,
): Spine {
  const p = { ...DEFAULT_SPINE_PARAMS, ...params }
  const rng = new SeededRandom(seed)

  switch (p.type) {
    case 'two_lane':   return _twoLane(p, symmetry, rng)
    case 'open':       return _open(p, symmetry, rng)
    case 'linear':     return _linear(p, symmetry, rng)
    case 'three_lane': return _threeLane(p, symmetry, rng)
    case 'ring':       return _ring(p, symmetry, rng)
  }
}

// ════════════════════════════════════════════════════════════════
// 路线生成核心
// ════════════════════════════════════════════════════════════════

type Pt = { x: number; z: number }

const BOUND = 0.78

function _clamp(pt: Pt): Pt {
  return {
    x: Math.max(-BOUND, Math.min(BOUND, pt.x)),
    z: Math.max(-BOUND, Math.min(BOUND, pt.z)),
  }
}

/**
 * 生成一条路线的拐点（从 base 到 baseM）。
 * side: +1/-1 决定偏向哪一侧。
 *
 * 每个路点独立随机：自己的偏转方向、自己的偏移距离。
 * 路点按 base→baseM 方向排序保证路径顺序。
 */
function _generateLane(
  base: Pt, baseM: Pt,
  side: number,
  _curvature: number,
  _shape: string,
  rng: SeededRandom,
  strengthOverride?: number,
): Pt[] {
  const dx = baseM.x - base.x, dz = baseM.z - base.z
  const dist = Math.sqrt(dx * dx + dz * dz)
  const tx = dx / dist, tz = dz / dist
  const perpNx = -tz * side, perpNz = tx * side

  const spread = strengthOverride ?? (0.3 + rng.nextFloat(0, 1.0) + _curvature * 0.1)
  const numPts = 2 + rng.nextInt(3)

  const pts: Pt[] = []
  for (let i = 0; i < numPts; i++) {
    const t = ((i + 0.5) / numPts) + rng.nextFloat(-0.25, 0.25)

    const detour = rng.nextFloat(-Math.PI / 3, Math.PI / 3)
    const cosD = Math.cos(detour), sinD = Math.sin(detour)
    const nx = perpNx * cosD - perpNz * sinD
    const nz = perpNx * sinD + perpNz * cosD

    const offset = spread * (0.3 + rng.nextFloat(0, 1.2))

    pts.push(_clamp({
      x: base.x + dx * t + nx * offset,
      z: base.z + dz * t + nz * offset,
    }))
  }

  pts.sort((a, b) => {
    const pa = (a.x - base.x) * tx + (a.z - base.z) * tz
    const pb = (b.x - base.x) * tx + (b.z - base.z) * tz
    return pa - pb
  })

  return pts
}

function _mirrorLane(points: Pt[], sym: SymmetryMode): Pt[] {
  return points.map(p => mirrorPoint(p, sym)).reverse()
}

// ════════════════════════════════════════════════════════════════
// 双路型
//
// 上路和下路独立随机生成（不同模式、不同参数）。
// 对称保证：下路的路点全部 mirrorPoint → 得到 P2 视角的上路。
// 即 P1 走上路 = P2 走下路（公平）。
//
// 上路偏向 side=+1，下路偏向 side=-1，
// 但由于模式不同，两条路的形状可以截然不同。
// ════════════════════════════════════════════════════════════════

function _twoLane(p: SpineParams, sym: SymmetryMode, rng: SeededRandom): Spine {
  const nodes: SpineNode[] = []
  const paths: SpinePath[] = []
  const curve = p.curvature ?? 0.3
  const shape = p.laneShape ?? 'straight'
  const numCrossings = p.laneCrossings ?? 1
  const balance = p.laneWidthBalance ?? 0

  const base = _p1Base(sym, rng)
  const baseM = mirrorPoint(base, sym)

  nodes.push({ id: 'base_P1', position: base, role: 'base', lane: 'both' })
  nodes.push({ id: 'base_P2', position: baseM, role: 'base', lane: 'both' })

  const totalStr = 0.5 + rng.nextFloat(0, 1.3) + curve * 0.12
  const split = rng.nextFloat(0.3, 0.7)

  let fullUpper: Pt[], fullLower: Pt[]

  if (sym === 'none') {
    fullUpper = _generateLane(base, baseM, +1, curve, shape, rng, totalStr * split)
    fullLower = _generateLane(base, baseM, -1, curve, shape, rng, totalStr * (1 - split))
  } else {
    const midPt: Pt = { x: (base.x + baseM.x) / 2, z: (base.z + baseM.z) / 2 }
    const upperFirstHalf = _generateLane(base, midPt, +1, curve, shape, rng, totalStr * split)
    const lowerFirstHalf = _generateLane(base, midPt, -1, curve, shape, rng, totalStr * (1 - split))

    const upperSecondHalf = lowerFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()
    const lowerSecondHalf = upperFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()

    fullUpper = [...upperFirstHalf, ...upperSecondHalf]
    fullLower = [...lowerFirstHalf, ...lowerSecondHalf]
  }

  for (let i = 0; i < fullUpper.length; i++) {
    nodes.push({ id: `upper_${i + 1}`, position: fullUpper[i], role: 'waypoint', lane: 'upper' })
  }
  for (let i = 0; i < fullLower.length; i++) {
    nodes.push({ id: `lower_${i + 1}`, position: fullLower[i], role: 'waypoint', lane: 'lower' })
  }

  const upperWidth = balance > 0.5 ? 'wide' : 'medium' as const
  const lowerWidth = balance > 0.5 ? 'narrow' : 'medium' as const

  const upperChain = ['base_P1', ...fullUpper.map((_, i) => `upper_${i + 1}`), 'base_P2']
  for (let i = 0; i < upperChain.length - 1; i++) {
    paths.push({ from: upperChain[i], to: upperChain[i + 1], lane: 'upper', width: upperWidth })
  }
  const lowerChain = ['base_P1', ...fullLower.map((_, i) => `lower_${i + 1}`), 'base_P2']
  for (let i = 0; i < lowerChain.length - 1; i++) {
    paths.push({ from: lowerChain[i], to: lowerChain[i + 1], lane: 'lower', width: lowerWidth })
  }

  // Crossing（对称生成）
  // upper_i 的镜像是 lower_(N+1-i)，所以 crossing 也需要镜像
  const numWP = fullUpper.length
  if (numCrossings > 0 && numWP >= 2) {
    const step = Math.max(1, Math.floor(numWP / (numCrossings + 1)))
    for (let c = 0; c < numCrossings; c++) {
      const idx = Math.min(numWP - 1, (c + 1) * step - 1)
      const mirrorIdx = numWP - 1 - idx

      const uNode = nodes.find(n => n.id === `upper_${idx + 1}`)!
      const lNode = nodes.find(n => n.id === `lower_${idx + 1}`)!
      const crossId = `crossing_${c + 1}`
      const crossPos: Pt = { x: (uNode.position.x + lNode.position.x) / 2, z: (uNode.position.z + lNode.position.z) / 2 }
      nodes.push({ id: crossId, position: crossPos, role: 'crossing', lane: 'cross' })
      paths.push({ from: `upper_${idx + 1}`, to: crossId, lane: 'cross', width: 'narrow' })
      paths.push({ from: crossId, to: `lower_${idx + 1}`, lane: 'cross', width: 'narrow' })

      if (mirrorIdx !== idx) {
        const crossMirrorId = `crossing_${c + 1}_m`
        const crossMirrorPos = mirrorPoint(crossPos, sym)
        nodes.push({ id: crossMirrorId, position: crossMirrorPos, role: 'crossing', lane: 'cross' })
        paths.push({ from: `upper_${mirrorIdx + 1}`, to: crossMirrorId, lane: 'cross', width: 'narrow' })
        paths.push({ from: crossMirrorId, to: `lower_${mirrorIdx + 1}`, lane: 'cross', width: 'narrow' })
      }
    }
  }

  return { nodes, paths, type: 'two_lane' }
}

// ════════════════════════════════════════════════════════════════
// 开放型
// ════════════════════════════════════════════════════════════════

function _open(_p: SpineParams, sym: SymmetryMode, rng: SeededRandom): Spine {
  const base = _p1Base(sym, rng)
  const baseM = mirrorPoint(base, sym)
  return {
    nodes: [
      { id: 'base_P1', position: base, role: 'base' },
      { id: 'base_P2', position: baseM, role: 'base' },
    ],
    paths: [],
    type: 'open',
  }
}

// ════════════════════════════════════════════════════════════════
// 直线型 — 单条路，自身对称
// ════════════════════════════════════════════════════════════════

function _linear(p: SpineParams, sym: SymmetryMode, rng: SeededRandom): Spine {
  const nodes: SpineNode[] = []
  const paths: SpinePath[] = []
  const curve = p.curvature ?? 0.3
  const shape = p.laneShape ?? 'straight'

  const base = _p1Base(sym, rng)
  const baseM = mirrorPoint(base, sym)

  nodes.push({ id: 'base_P1', position: base, role: 'base', lane: 'main' })
  nodes.push({ id: 'base_P2', position: baseM, role: 'base', lane: 'main' })

  const midPt: Pt = { x: (base.x + baseM.x) / 2, z: (base.z + baseM.z) / 2 }
  const side = rng.nextFloat(0, 1) > 0.5 ? 1 : -1
  const firstHalf = _generateLane(base, midPt, side, curve, shape, rng)
  const secondHalf = firstHalf.map(pt => mirrorPoint(pt, sym)).reverse()
  const pts = [...firstHalf, ...secondHalf]

  for (let i = 0; i < pts.length; i++) {
    nodes.push({ id: `mid_${i + 1}`, position: pts[i], role: 'waypoint', lane: 'main' })
  }

  const chain = ['base_P1', ...pts.map((_, i) => `mid_${i + 1}`), 'base_P2']
  for (let i = 0; i < chain.length - 1; i++) {
    paths.push({ from: chain[i], to: chain[i + 1], lane: 'main', width: 'wide' })
  }

  return { nodes, paths, type: 'linear' }
}

// ════════════════════════════════════════════════════════════════
// 三通道型 — 中路自身对称，上下路用双路型的交叉对称
// ════════════════════════════════════════════════════════════════

function _threeLane(p: SpineParams, sym: SymmetryMode, rng: SeededRandom): Spine {
  const nodes: SpineNode[] = []
  const paths: SpinePath[] = []
  const curve = p.curvature ?? 0.3
  const shape = p.laneShape ?? 'straight'

  const base = _p1Base(sym, rng)
  const baseM = mirrorPoint(base, sym)

  nodes.push({ id: 'base_P1', position: base, role: 'base', lane: 'all' })
  nodes.push({ id: 'base_P2', position: baseM, role: 'base', lane: 'all' })

  // 中路：自身对称
  const midPt: Pt = { x: (base.x + baseM.x) / 2, z: (base.z + baseM.z) / 2 }
  const midSide = rng.nextFloat(0, 1) > 0.5 ? 1 : -1
  const midFirstHalf = _generateLane(base, midPt, midSide, curve * 0.5, shape, rng)
  const midSecondHalf = midFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()
  const midPts = [...midFirstHalf, ...midSecondHalf]

  for (let i = 0; i < midPts.length; i++) {
    nodes.push({ id: `middle_${i + 1}`, position: midPts[i], role: 'waypoint', lane: 'middle' })
  }
  const midChain = ['base_P1', ...midPts.map((_, i) => `middle_${i + 1}`), 'base_P2']
  for (let i = 0; i < midChain.length - 1; i++) {
    paths.push({ from: midChain[i], to: midChain[i + 1], lane: 'middle', width: 'wide' })
  }

  // 上下路：交叉对称
  const upperFirstHalf = _generateLane(base, midPt, +1, curve, shape, rng)
  const lowerFirstHalf = _generateLane(base, midPt, -1, curve, shape, rng)
  const fullUpper = [...upperFirstHalf, ...lowerFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()]
  const fullLower = [...lowerFirstHalf, ...upperFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()]

  for (let i = 0; i < fullUpper.length; i++) {
    nodes.push({ id: `upper_${i + 1}`, position: fullUpper[i], role: 'waypoint', lane: 'upper' })
  }
  for (let i = 0; i < fullLower.length; i++) {
    nodes.push({ id: `lower_${i + 1}`, position: fullLower[i], role: 'waypoint', lane: 'lower' })
  }

  const upperChain = ['base_P1', ...fullUpper.map((_, i) => `upper_${i + 1}`), 'base_P2']
  for (let i = 0; i < upperChain.length - 1; i++) {
    paths.push({ from: upperChain[i], to: upperChain[i + 1], lane: 'upper', width: 'narrow' })
  }
  const lowerChain = ['base_P1', ...fullLower.map((_, i) => `lower_${i + 1}`), 'base_P2']
  for (let i = 0; i < lowerChain.length - 1; i++) {
    paths.push({ from: lowerChain[i], to: lowerChain[i + 1], lane: 'lower', width: 'narrow' })
  }

  return { nodes, paths, type: 'three_lane' }
}

// ════════════════════════════════════════════════════════════════
// 环形 — 交叉对称
// ════════════════════════════════════════════════════════════════

function _ring(p: SpineParams, sym: SymmetryMode, rng: SeededRandom): Spine {
  const nodes: SpineNode[] = []
  const paths: SpinePath[] = []
  const curve = p.curvature ?? 0.3
  const shape = p.laneShape ?? 'straight'

  const base = _p1Base(sym, rng)
  const baseM = mirrorPoint(base, sym)

  nodes.push({ id: 'base_P1', position: base, role: 'base', lane: 'ring' })
  nodes.push({ id: 'base_P2', position: baseM, role: 'base', lane: 'ring' })

  const midPt: Pt = { x: (base.x + baseM.x) / 2, z: (base.z + baseM.z) / 2 }
  const cwFirstHalf = _generateLane(base, midPt, +1, curve, shape, rng)
  const ccwFirstHalf = _generateLane(base, midPt, -1, curve, shape, rng)
  const fullCW = [...cwFirstHalf, ...ccwFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()]
  const fullCCW = [...ccwFirstHalf, ...cwFirstHalf.map(pt => mirrorPoint(pt, sym)).reverse()]

  for (let i = 0; i < fullCW.length; i++) {
    nodes.push({ id: `cw_${i + 1}`, position: fullCW[i], role: 'waypoint', lane: 'cw' })
  }
  for (let i = 0; i < fullCCW.length; i++) {
    nodes.push({ id: `ccw_${i + 1}`, position: fullCCW[i], role: 'waypoint', lane: 'ccw' })
  }

  const cwChain = ['base_P1', ...fullCW.map((_, i) => `cw_${i + 1}`), 'base_P2']
  for (let i = 0; i < cwChain.length - 1; i++) {
    paths.push({ from: cwChain[i], to: cwChain[i + 1], lane: 'cw', width: 'medium' })
  }
  const ccwChain = ['base_P1', ...fullCCW.map((_, i) => `ccw_${i + 1}`), 'base_P2']
  for (let i = 0; i < ccwChain.length - 1; i++) {
    paths.push({ from: ccwChain[i], to: ccwChain[i + 1], lane: 'ccw', width: 'medium' })
  }

  return { nodes, paths, type: 'ring' }
}

// ── 辅助 ──

function _p1Base(sym: SymmetryMode, rng: SeededRandom): Pt {
  switch (sym) {
    case 'rotation_180': {
      const angle = rng.nextFloat(0.1, Math.PI / 2 - 0.1)
      const edgeDist = 0.7 + rng.nextFloat(0, 0.12)
      return { x: -Math.sin(angle) * edgeDist, z: -Math.cos(angle) * edgeDist }
    }
    case 'mirror_vertical':
      return { x: -(0.65 + rng.nextFloat(0, 0.15)), z: rng.nextFloat(-0.6, 0.6) }
    case 'mirror_horizontal':
      return { x: rng.nextFloat(-0.6, 0.6), z: -(0.65 + rng.nextFloat(0, 0.15)) }
    case 'rotation_90': {
      const angle = rng.nextFloat(0.3, Math.PI / 2 - 0.3)
      const edgeDist = 0.65 + rng.nextFloat(0, 0.1)
      return { x: -Math.sin(angle) * edgeDist, z: -Math.cos(angle) * edgeDist }
    }
    case 'none': {
      const angle = rng.nextFloat(0.1, Math.PI / 2 - 0.1)
      const edgeDist = 0.7 + rng.nextFloat(0, 0.12)
      return { x: -Math.sin(angle) * edgeDist, z: -Math.cos(angle) * edgeDist }
    }
  }
}
