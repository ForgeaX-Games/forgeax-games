/**
 * 对称性框架 — 支持 4 种 RTS 地图对称模式
 *
 * 生成时只需在 P1 半区生成点和区域，
 * 然后通过 mirrorPoint 自动镜像到其他半区。
 *
 * rotation_180:    绕中心旋转 180°，对角线分割（星际经典）
 * mirror_vertical: 左右镜像，x=0 为轴
 * mirror_horizontal: 上下镜像，z=0 为轴
 * rotation_90:     绕中心旋转 90°，4 人 FFA（生成 3 份镜像）
 */

export type SymmetryMode =
  | 'rotation_180'
  | 'mirror_vertical'
  | 'mirror_horizontal'
  | 'rotation_90'
  | 'none'

export interface Point2D {
  x: number
  z: number
}

/**
 * 将 P1 半区的点镜像到 P2 半区（rotation_90 返回第一个镜像，即 90° 旋转）
 */
export function mirrorPoint(p: Point2D, mode: SymmetryMode): Point2D {
  switch (mode) {
    case 'rotation_180':      return { x: -p.x, z: -p.z }
    case 'mirror_vertical':   return { x: -p.x, z: p.z }
    case 'mirror_horizontal': return { x: p.x, z: -p.z }
    case 'rotation_90':       return { x: -p.z, z: p.x }
    case 'none':              return { x: -p.x, z: -p.z }
  }
}

/**
 * rotation_90 专用：返回所有镜像点（90°, 180°, 270°）
 * 其他模式返回单个镜像点的数组
 */
export function allMirrors(p: Point2D, mode: SymmetryMode): Point2D[] {
  switch (mode) {
    case 'rotation_180':
      return [{ x: -p.x, z: -p.z }]
    case 'mirror_vertical':
      return [{ x: -p.x, z: p.z }]
    case 'mirror_horizontal':
      return [{ x: p.x, z: -p.z }]
    case 'rotation_90':
      return [
        { x: -p.z, z: p.x },   // 90°
        { x: -p.x, z: -p.z },  // 180°
        { x: p.z, z: -p.x },   // 270°
      ]
    case 'none':
      return [{ x: -p.x, z: -p.z }]
  }
}

/** 该对称模式产生多少个镜像副本（不含原始） */
export function mirrorCount(mode: SymmetryMode): number {
  if (mode === 'none') return 1
  return mode === 'rotation_90' ? 3 : 1
}

/**
 * 判断点是否在 P1（主生成）半区
 */
export function isInPrimaryHalf(p: Point2D, mode: SymmetryMode): boolean {
  switch (mode) {
    case 'rotation_180':      return p.x + p.z < 0
    case 'mirror_vertical':   return p.x < 0
    case 'mirror_horizontal': return p.z < 0
    case 'rotation_90':       return p.x < 0 && p.z < 0
    case 'none':              return true
  }
}

/**
 * 判断点是否在对称轴上
 */
export function isOnSymmetryAxis(p: Point2D, mode: SymmetryMode, threshold = 2): boolean {
  switch (mode) {
    case 'rotation_180':      return Math.abs(p.x + p.z) < threshold
    case 'mirror_vertical':   return Math.abs(p.x) < threshold
    case 'mirror_horizontal': return Math.abs(p.z) < threshold
    case 'rotation_90':       return Math.abs(p.x) < threshold && Math.abs(p.z) < threshold
    case 'none':              return false
  }
}
