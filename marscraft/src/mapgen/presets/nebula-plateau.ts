/**
 * 地图预设 — Nebula Plateau (星云遗迹) v2
 *
 * ★ 程序化 Voronoi 地图 + 沟壑路网设计 ★
 *
 * 路网策略（P1 左上 ↔ P2 右下，点对称）：
 *
 *    P1 ●
 *       |
 *    ≈≈≈≈≈≈  ← 岩浆河 L（封堵西北侧绕行）
 *       |
 *   ░░  |     ← 深渊 A（收窄北侧入口）
 *       │─── 中央走廊 ───│
 *     ░░|     ← 深渊 B（收窄南侧出口，对称）
 *       |
 *    ≈≈≈≈≈≈  ← 岩浆河 R（封堵东南侧绕行，对称）
 *       |
 *       ● P2
 *
 * 结果：三条主要通道（主道 + 两翼高地坡道），其余地带被岩浆/深渊封堵。
 */

import { generateRTSBlueprint } from '../procedural/ProceduralMapGen'
import type { DecorationDef, TrenchDef } from '../types'

// ── 确定性哈希，不依赖 Math.random ──
function h(x: number, z: number, s: number): number {
  const v = Math.sin(x * 137.508 + z * 97.654 + s * 31.41) * 43758.5453
  return v - Math.floor(v)
}

// ── 在指定位置生成一小簇装饰物 ──
function cluster(
  cx: number, cz: number,
  type: string, count: number,
  scatter: number, saltBase: number,
  blocksLOS = false
): DecorationDef[] {
  const out: DecorationDef[] = []
  for (let i = 0; i < count; i++) {
    const a = h(cx + i * 1.7, cz, saltBase)
    const b = h(cx, cz + i * 2.3, saltBase + 1)
    const c = h(cx + i, cz + i, saltBase + 2)
    out.push({
      id: `np_${type}_${saltBase}_${i}`,
      type,
      x: cx + (a - 0.5) * scatter * 2,
      z: cz + (b - 0.5) * scatter * 2,
      r: type === 'machinery' ? 1.5 : type === 'ruins' ? 1.0 : 1.2,
      rotation: c * Math.PI * 2,
      scale: 0.85 + a * 0.3,
      blocksPathing: true,
      blocksLOS,
    })
  }
  return out
}

// ── 沿折线生成重叠圆形沟壑序列（模拟岩浆河/裂缝） ──
function trenchRiver(
  pts: [number, number][],
  r: number,
  depth: number,
  type: TrenchDef['type'],
  idBase: string,
): TrenchDef[] {
  return pts.map(([x, z], i) => ({ id: `${idBase}_${i}`, x, z, r, depth, type }))
}

// ── 生成 Voronoi 蓝图底座 ──
const _base = generateRTSBlueprint({
  name: '星云遗迹 (Nebula Plateau)',
  width: 128,
  height: 128,
  resolution: 256,
  seed: 17,
  heightLevels: 3,
  playerCount: 2,
  theme: 'volcanic',
  elevatedRatio: 0.42,
  lloydIterations: 2,
  maxRampsPerRegion: 2,
})

// =====================================================================
// 沟壑设计
// =====================================================================

// ── 岩浆河 L：西北侧，从 P1 推进路上封堵西侧弯道 ──
// 4 个重叠圆弧成条状，半径 5.5（约 11 单位宽），深度 2
const trenchLavaL = trenchRiver(
  [[-34, -10], [-29, -4], [-24,  2], [-20, 8]],
  5.5, 2, 'lava', 'np_lL',
)

// ── 岩浆河 R：东南侧，点对称 ──
const trenchLavaR = trenchLavaL.map((t, i) => ({
  ...t, id: `np_lR_${i}`, x: -t.x, z: -t.z,
}))

// ── 深渊 A：中场偏北，收窄走廊入口，制造抢点压力 ──
const trenchVoidA = trenchRiver(
  [[-6, -26], [-2, -32]],
  4.5, 1, 'void', 'np_vA',
)

// ── 深渊 B：点对称 ──
const trenchVoidB = trenchVoidA.map((t, i) => ({
  ...t, id: `np_vB_${i}`, x: -t.x, z: -t.z,
}))

// ── 中场小型岩浆坑：两翼高地与主道之间的第二层阻断 ──
const trenchLavaMidL = trenchRiver(
  [[-14, -16], [-10, -12]],
  3.5, 1, 'lava', 'np_mL',
)
const trenchLavaMidR = trenchLavaMidL.map((t, i) => ({
  ...t, id: `np_mR_${i}`, x: -t.x, z: -t.z,
}))

const trenches: TrenchDef[] = [
  ...trenchLavaL, ...trenchLavaR,
  ...trenchVoidA, ...trenchVoidB,
  ...trenchLavaMidL, ...trenchLavaMidR,
]

// =====================================================================
// 手动装饰物（遗迹氛围，点对称布置）
// =====================================================================
const manualDecos: DecorationDef[] = [
  // 中央遗迹机械残骸（视觉焦点）
  ...cluster(  0,   0, 'machinery', 3, 4.0, 10, true),

  // 中场两翼遗迹（视野遮蔽）
  ...cluster( -6, -13, 'ruins', 2, 3.0, 20, true),
  ...cluster(  6,  13, 'ruins', 2, 3.0, 21, true),

  // 岩浆河旁散落石块（强调危险地带边缘）
  ...cluster(-20,  12, 'rock',  2, 2.0, 30, false),
  ...cluster( 20, -12, 'rock',  2, 2.0, 31, false),
]

export const nebulaPlateauBlueprint: typeof _base = {
  ..._base,
  decorations: manualDecos,
  trenches,
}
