/**
 * 地图生成 — 资源放置
 *
 * 根据基地配置生成矿物线和气矿。
 */

import type { BaseResources, MineralPatch, VespeneGeyser } from './types'

/**
 * 生成弧形矿物线
 *
 * 矿物围绕 (arcX, arcZ) 排列，弧的凸面朝向 (ccX, ccZ)。
 * 即矿弧向外弯曲，基地一侧为凸面（开口朝外），与星际争霸一致。
 *
 * @param ccX    基地中心 X
 * @param ccZ    基地中心 Z
 * @param arcX   弧心 X
 * @param arcZ   弧心 Z
 * @param count  矿数量
 * @param radius 弧半径
 * @param amount 每矿储量
 * @param spread 弧张角 (弧度，默认 0.52π)
 */
export function mineralArc(
  ccX: number, ccZ: number,
  arcX: number, arcZ: number,
  count: number,
  radius: number,
  amount: number,
  spread = Math.PI * 0.52,
): MineralPatch[] {
  const out: MineralPatch[] = []
  // 弧朝向：从弧心到 CC 的反方向（向外），使凸面朝向基地
  const a0 = Math.atan2(arcX - ccX, arcZ - ccZ)
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5
    const a = a0 - spread / 2 + t * spread
    out.push({
      x: arcX + Math.sin(a) * radius,
      z: arcZ + Math.cos(a) * radius,
      amount,
    })
  }
  return out
}

/**
 * 从基地列表批量生成所有矿物和气矿
 */
export function generateResources(bases: BaseResources[]): {
  minerals: MineralPatch[]
  geysers: VespeneGeyser[]
} {
  const minerals: MineralPatch[] = []
  const geysers: VespeneGeyser[] = []

  for (const b of bases) {
    minerals.push(
      ...mineralArc(
        b.ccX, b.ccZ,
        b.mineralArcX, b.mineralArcZ,
        b.mineralCount,
        b.mineralRadius,
        b.mineralAmount,
      ),
    )
    for (const g of b.geysers) {
      geysers.push({ x: g.x, z: g.z, amount: g.amount })
    }
  }

  return { minerals, geysers }
}
