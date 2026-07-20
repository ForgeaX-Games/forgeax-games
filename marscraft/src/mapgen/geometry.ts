/**
 * 地图生成 — 几何工具函数
 *
 * 纯数学函数，无副作用。可在客户端和服务端使用。
 */

/** 两点欧几里得距离 */
export function dist(x1: number, z1: number, x2: number, z2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (z1 - z2) ** 2)
}

/** 点到线段的最短距离及投影 t ∈ [0,1] */
export function segDist(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): { d: number; t: number } {
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-4) return { d: dist(px, pz, ax, az), t: 0 }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  return { d: dist(px, pz, ax + t * dx, az + t * dz), t }
}

/** 判断点 (x,z) 是否在矩形 (x1,z1)-(x2,z2) 内 */
export function inRect(
  x: number, z: number,
  x1: number, z1: number,
  x2: number, z2: number,
): boolean {
  return x >= x1 && x <= x2 && z >= z1 && z <= z2
}

/** 世界坐标 → 网格坐标 */
export function worldToGrid(
  wx: number, wz: number,
  mw: number, mh: number, r: number,
) {
  return {
    col: Math.max(0, Math.min(r - 1, Math.floor(((wx + mw / 2) / mw) * r))),
    row: Math.max(0, Math.min(r - 1, Math.floor(((wz + mh / 2) / mh) * r))),
  }
}

/** 网格坐标 → 世界坐标 (格子中心) */
export function gridToWorld(
  col: number, row: number,
  mw: number, mh: number, r: number,
) {
  return {
    x: (col + 0.5) / r * mw - mw / 2,
    z: (row + 0.5) / r * mh - mh / 2,
  }
}

/**
 * 世界尺寸（world units）→ 网格格子数
 * 例如 footprint=5 (世界单位), mapWidth=128, gridRes=256 → 10 格子
 */
export function worldSizeToGridCells(
  worldSize: number, mw: number, r: number,
): number {
  return Math.round(worldSize * r / mw)
}

/**
 * 有向矩形碰撞检测 (OBB Test)
 *
 * 检测点 (px, pz) 是否在以线段 A-B 为中轴、半宽为 halfWidth 的矩形内。
 * 同时返回点在线段上的参数位置 t ∈ [0,1]（0 = A端，1 = B端），用于坡道高度插值。
 *
 * @param px, pz    待检测点
 * @param ax, az    矩形中轴线段起点 A
 * @param bx, bz    矩形中轴线段终点 B
 * @param halfWidth 矩形半宽（垂直于中轴方向）
 * @returns { inside: boolean; t: number }
 */
export function orientedRectTest(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  halfWidth: number,
): { inside: boolean; t: number } {
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-6) return { inside: false, t: 0 }
  const invLen = 1 / Math.sqrt(len2)
  // 单位向量（沿线段方向）
  const ux = dx * invLen, uz = dz * invLen
  const vpx = px - ax, vpz = pz - az
  // 沿线段方向的投影距离
  const along = vpx * ux + vpz * uz
  // 垂直于线段方向的距离（即 perp，不需要取绝对值方向，后面取 Math.abs）
  const perp = vpx * (-uz) + vpz * ux
  const len = Math.sqrt(len2)
  return {
    inside: along >= 0 && along <= len && Math.abs(perp) <= halfWidth,
    t: Math.max(0, Math.min(1, along / len)),
  }
}
