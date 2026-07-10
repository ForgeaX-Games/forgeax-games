/**
 * 资源放置器 — V2 管线
 *
 * 根据 PlacedZone 的类型和位置，为 main_base 和 expansion 区域
 * 生成矿石弧线和气矿位置。
 *
 * 矿线布局参考 SC2：
 *   - 矿石围绕弧心排列，弧的凸面朝向基地中心
 *   - 气矿在矿线两端外侧
 *   - main_base: 8 矿 + 2 气
 *   - expansion:  6 矿 + 2 气
 */

import type { PlacedZone } from './ZoneGraph'
import type { ZoneOwnershipGrid } from './ZoneShapeAssigner'
import type { BarrierGrid } from './BarrierGenerator'
import type { MineralPatch, VespeneGeyser } from '../types'
import { SeededRandom } from './SeededRandom'

// ── 配置 ──

const MAIN_BASE_MINERALS = 8
const MAIN_BASE_GEYSERS = 2
const EXPANSION_MINERALS = 6
const EXPANSION_GEYSERS = 2

const MINERAL_ARC_RADIUS = 5.5
const MINERAL_ARC_SPREAD = Math.PI * 0.52
const MINERAL_AMOUNT = 1500
const GEYSER_AMOUNT = 2500
const GEYSER_OFFSET = 7.0

// ── 输出 ──

export interface PlacedResources {
  minerals: MineralPatch[]
  geysers: VespeneGeyser[]
}

// ── 主函数 ──

export function placeResources(
  grid: ZoneOwnershipGrid,
  barriers: BarrierGrid,
  seed: number = 42,
): PlacedResources {
  const rng = new SeededRandom(seed + 333)
  const minerals: MineralPatch[] = []
  const geysers: VespeneGeyser[] = []

  const { zones, mapWidth, mapHeight } = grid
  const halfW = mapWidth / 2
  const halfH = mapHeight / 2

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]
    if (zone.type !== 'main_base' && zone.type !== 'expansion') continue

    const mineralCount = zone.type === 'main_base' ? MAIN_BASE_MINERALS : EXPANSION_MINERALS
    const geyserCount: number = zone.type === 'main_base' ? MAIN_BASE_GEYSERS : EXPANSION_GEYSERS

    // 矿线弧心方向：朝向地图中心的反方向（矿在基地外侧）
    const distToCenter = Math.sqrt(zone.cx * zone.cx + zone.cz * zone.cz)
    let dirX: number, dirZ: number
    if (distToCenter > 1) {
      dirX = zone.cx / distToCenter
      dirZ = zone.cz / distToCenter
    } else {
      dirX = rng.nextFloat(-1, 1)
      dirZ = rng.nextFloat(-1, 1)
      const d = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1
      dirX /= d; dirZ /= d
    }

    // 弧心在基地中心外侧，距离按区域半径比例
    const arcDist = zone.radius * 0.6
    const arcX = zone.cx + dirX * arcDist
    const arcZ = zone.cz + dirZ * arcDist

    // 矿弧半径按区域大小缩放（小矿区用更紧凑的弧）
    const effectiveArcRadius = zone.type === 'main_base' ? MINERAL_ARC_RADIUS : MINERAL_ARC_RADIUS * 0.85

    // 生成矿石弧线
    const arcAngle = Math.atan2(arcX - zone.cx, arcZ - zone.cz)
    for (let m = 0; m < mineralCount; m++) {
      const t = mineralCount > 1 ? m / (mineralCount - 1) : 0.5
      const a = arcAngle - MINERAL_ARC_SPREAD / 2 + t * MINERAL_ARC_SPREAD
      let mx = arcX + Math.sin(a) * effectiveArcRadius
      let mz = arcZ + Math.cos(a) * effectiveArcRadius

      // 确保矿石在区域半径内
      const dx = mx - zone.cx, dz = mz - zone.cz
      const dist = Math.sqrt(dx * dx + dz * dz)
      const maxDist = zone.radius - 1.5
      if (dist > maxDist) {
        mx = zone.cx + (dx / dist) * maxDist
        mz = zone.cz + (dz / dist) * maxDist
      }

      // 边界裁剪
      mx = Math.max(-halfW + 2, Math.min(halfW - 2, mx))
      mz = Math.max(-halfH + 2, Math.min(halfH - 2, mz))

      minerals.push({ x: mx, z: mz, amount: MINERAL_AMOUNT })
    }

    // 生成气矿（在矿线两端外侧）
    const perpX = -dirZ
    const perpZ = dirX
    const effectiveGeyserOffset = zone.type === 'main_base' ? GEYSER_OFFSET : GEYSER_OFFSET * 0.75
    for (let g = 0; g < geyserCount; g++) {
      const side = geyserCount === 1 ? (rng.nextFloat(0, 1) > 0.5 ? 1 : -1) : (g === 0 ? 1 : -1)
      let gx = zone.cx + dirX * (arcDist * 0.7) + perpX * effectiveGeyserOffset * side
      let gz = zone.cz + dirZ * (arcDist * 0.7) + perpZ * effectiveGeyserOffset * side

      // 轻微随机偏移
      gx += rng.nextFloat(-1.0, 1.0)
      gz += rng.nextFloat(-1.0, 1.0)

      // 确保气矿在区域半径内
      const gdx = gx - zone.cx, gdz = gz - zone.cz
      const gDist = Math.sqrt(gdx * gdx + gdz * gdz)
      const gMaxDist = zone.radius - 1.5
      if (gDist > gMaxDist) {
        gx = zone.cx + (gdx / gDist) * gMaxDist
        gz = zone.cz + (gdz / gDist) * gMaxDist
      }

      gx = Math.max(-halfW + 2, Math.min(halfW - 2, gx))
      gz = Math.max(-halfH + 2, Math.min(halfH - 2, gz))

      geysers.push({ x: gx, z: gz, amount: GEYSER_AMOUNT })
    }
  }

  return { minerals, geysers }
}
