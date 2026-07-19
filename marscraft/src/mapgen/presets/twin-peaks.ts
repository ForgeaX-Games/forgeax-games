/**
 * 地图预设 — Twin Peaks (双子峰)
 *
 * 128×128 双人 180° 旋转对称 — **水平轴向**
 *
 * 布局概念：
 *   - P1 左侧高地 (CL=2)，P2 右侧高地 (CL=2)
 *   - 中央有南北两座 CL=1 高峰（"双子峰"），控制视野
 *   - 两峰之间是主要交战的中央谷地
 *   - 分矿在主矿坡道前方 (朝中央)
 *   - 三矿在主矿后方远端 (需要绕路到达)
 *   - 金矿在敌方半场 (极高暴露)
 *   - 主路: 中央谷地 (穿两峰之间)
 *   - 侧路: 绕峰背后的南北弧形走廊
 *
 *              z=-56 (North)
 *    ┌─────────────────────────────────┐
 *    │  [3rd-P1]              [3rd-P2] │
 *    │               ╔═════╗           │
 *    │  ┌────────┐   ║PeakN║  ┌────────┐
 *    │  │P1 Main │   ║CL=1 ║  │P2 Main │
 *    │  │ CL=2   │→  ╚═════╝ ←│ CL=2   │
 *    │  │        │   (valley)  │        │
 *    │  └────────┘   ╔═════╗  └────────┘
 *    │               ║PeakS║           │
 *    │               ║CL=1 ║           │
 *    │               ╚═════╝           │
 *    │  [Gold-P2]              [Gold-P1]│
 *    └─────────────────────────────────┘
 *              z=56 (South)
 */

import type { MapBlueprint } from '../types'
import { TerrainType } from '../types'

// ── 出生点 (水平对称) ──
const P1 = { x: -38, z: 0 }
const P2 = { x: 38, z: 0 }   // 180° 旋转: (-P1.x, -P1.z)

// ── 高度常量 ──
const MAIN_H = 4     // CL=2 视觉高度
const MAIN_CL = 2

export const twinPeaksBlueprint: MapBlueprint = {
  name: 'Twin Peaks',
  width: 128,
  height: 128,
  resolution: 256,
  maxHeight: 10,
  cliffVisualHeight: 2.0,

  // ══════════════════════════════════════════
  // 高地平台 (CL=2 主矿)
  // ══════════════════════════════════════════
  platforms: [
    // P1 主矿 — 左侧大块高地
    { x1: -56, z1: -20, x2: -22, z2: 20, height: MAIN_H, cliffLevel: MAIN_CL },
    // P2 主矿 — 右侧 (180° 对称)
    { x1: 22, z1: -20, x2: 56, z2: 20, height: MAIN_H, cliffLevel: MAIN_CL },
  ],

  // ══════════════════════════════════════════
  // 圆形区域
  // ══════════════════════════════════════════
  circles: [
    // ── 双子峰 (CL=1) ──
    { x: 0, z: -20, r: 9, height: 2, cliffLevel: 1, terrain: TerrainType.Ice },  // 北峰
    { x: 0, z: 20, r: 9, height: 2, cliffLevel: 1, terrain: TerrainType.Ice },   // 南峰 (对称)

    // ── 分矿 (CL=0, 坡道前方) ──
    { x: -14, z: 6, r: 10, height: 0, cliffLevel: 0 },    // P1 分矿
    { x: 14, z: -6, r: 10, height: 0, cliffLevel: 0 },    // P2 分矿 (对称)

    // ── 三矿 (CL=0, 主矿后方远端) ──
    { x: -30, z: -42, r: 10, height: 0, cliffLevel: 0 },  // P1 三矿
    { x: 30, z: 42, r: 10, height: 0, cliffLevel: 0 },    // P2 三矿 (对称)

    // ── 金矿 (CL=0, 敌方半场，极度暴露) ──
    { x: -30, z: 38, r: 9, height: 0, cliffLevel: 0 },    // P1 侧金矿 (位于P2方向)
    { x: 30, z: -38, r: 9, height: 0, cliffLevel: 0 },    // P2 侧金矿 (对称)

    // ── 中央谷地 (CL=0, 两峰之间) ──
    { x: 0, z: 0, r: 9, height: 0, cliffLevel: 0 },

    // ── 走廊连通补丁 (CL=0) ──
    // P1 坡道出口→分矿
    { x: -16, z: 2, r: 5, height: 0, cliffLevel: 0 },
    { x: 16, z: -2, r: 5, height: 0, cliffLevel: 0 },    // 对称

    // 分矿→中央谷地
    { x: -8, z: 4, r: 5, height: 0, cliffLevel: 0 },
    { x: 8, z: -4, r: 5, height: 0, cliffLevel: 0 },     // 对称

    // 中央谷地→两侧 (绕峰路线)
    { x: -8, z: -10, r: 5, height: 0, cliffLevel: 0 },   // 北峰西侧
    { x: 8, z: 10, r: 5, height: 0, cliffLevel: 0 },     // 对称
    { x: -8, z: 10, r: 5, height: 0, cliffLevel: 0 },    // 南峰西侧
    { x: 8, z: -10, r: 5, height: 0, cliffLevel: 0 },    // 对称

    // 北路 (P1三矿方向, 绕北峰背后)
    { x: -18, z: -10, r: 6, height: 0, cliffLevel: 0 },
    { x: 18, z: 10, r: 6, height: 0, cliffLevel: 0 },    // 对称
    { x: -22, z: -24, r: 7, height: 0, cliffLevel: 0 },
    { x: 22, z: 24, r: 7, height: 0, cliffLevel: 0 },    // 对称
    { x: -26, z: -34, r: 7, height: 0, cliffLevel: 0 },
    { x: 26, z: 34, r: 7, height: 0, cliffLevel: 0 },    // 对称

    // 北峰背面通路 (z<-28 区域)
    { x: 8, z: -30, r: 5, height: 0, cliffLevel: 0 },
    { x: -8, z: 30, r: 5, height: 0, cliffLevel: 0 },    // 对称
    { x: 16, z: -34, r: 6, height: 0, cliffLevel: 0 },
    { x: -16, z: 34, r: 6, height: 0, cliffLevel: 0 },   // 对称

    // 南路 (金矿方向, 绕南峰背后)
    { x: -16, z: 20, r: 6, height: 0, cliffLevel: 0 },
    { x: 16, z: -20, r: 6, height: 0, cliffLevel: 0 },   // 对称
    { x: -22, z: 30, r: 6, height: 0, cliffLevel: 0 },
    { x: 22, z: -30, r: 6, height: 0, cliffLevel: 0 },   // 对称

    // 南峰背面通路 (z>28 区域)
    { x: 8, z: 30, r: 5, height: 0, cliffLevel: 0 },
    { x: -8, z: -30, r: 5, height: 0, cliffLevel: 0 },   // 对称
    { x: 16, z: 34, r: 6, height: 0, cliffLevel: 0 },
    { x: -16, z: -34, r: 6, height: 0, cliffLevel: 0 },  // 对称
  ],

  // ── 已废弃 ──
  cliffWalls: [],

  // ══════════════════════════════════════════
  // 石柱 (战术掩体)
  // ══════════════════════════════════════════
  pillars: [
    // 中央谷地两侧——迫使集群拆散
    { x: -4, z: -6, r: 2.0 },
    { x: 4, z: 6, r: 2.0 },    // 对称

    // 绕后路弯道掩体
    { x: -14, z: -28, r: 2.5 },
    { x: 14, z: 28, r: 2.5 },  // 对称
  ],

  // ══════════════════════════════════════════
  // 坡道
  // ══════════════════════════════════════════
  ramps: [
    // P1 主矿坡道: CL=2 → CL=0 (朝东南，指向分矿)
    { ax: -26, az: 4, bx: -18, bz: 6, width: 5.5, hA: MAIN_H, hB: 0, pathWidth: 2.5 },
    // P2 主矿坡道: 180° 对称
    { ax: 26, az: -4, bx: 18, bz: -6, width: 5.5, hA: MAIN_H, hB: 0, pathWidth: 2.5 },

    // 北峰南面坡道 (CL=0 → CL=1), 2条入口
    { ax: -3, az: -14, bx: -5, bz: -10, width: 3.5, hA: 2, hB: 0, pathWidth: 1.5 },  // 西入口
    { ax: 3, az: -14, bx: 5, bz: -10, width: 3.5, hA: 2, hB: 0, pathWidth: 1.5 },   // 东入口

    // 南峰北面坡道 (CL=0 → CL=1), 2条入口 — 对称
    { ax: 3, az: 14, bx: 5, bz: 10, width: 3.5, hA: 2, hB: 0, pathWidth: 1.5 },
    { ax: -3, az: 14, bx: -5, bz: 10, width: 3.5, hA: 2, hB: 0, pathWidth: 1.5 },
  ],

  // ══════════════════════════════════════════
  // 出生点
  // ══════════════════════════════════════════
  spawnPoints: [
    { x: P1.x, z: P1.z, playerId: 0, facing: 0 },                // 朝右 (东)
    { x: P2.x, z: P2.z, playerId: 1, facing: Math.PI },          // 朝左 (西)
  ],

  // ══════════════════════════════════════════
  // 基地资源
  // ══════════════════════════════════════════
  bases: [
    // ═══ P1 主矿 (8矿+2气) ═══
    // 矿线在西侧 (背对敌方)
    {
      ccX: P1.x, ccZ: P1.z,
      mineralArcX: P1.x - 8, mineralArcZ: P1.z,  // D=8 向西
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [
        { x: P1.x - 6, z: P1.z - 7, amount: 2500 },  // 矿线北端外
        { x: P1.x - 6, z: P1.z + 7, amount: 2500 },   // 矿线南端外
      ],
    },
    // ═══ P1 分矿 (8矿+2气) ═══
    // 矿线在南侧 (垂直于主攻轴)
    {
      ccX: -14, ccZ: 6,
      mineralArcX: -14, mineralArcZ: 14,  // D=8 向南
      mineralCount: 8, mineralRadius: 5.5, mineralAmount: 1500,
      geysers: [
        { x: -21, z: 12, amount: 2500 },
        { x: -7, z: 12, amount: 2500 },
      ],
    },
    // ═══ P1 三矿 (6矿+1气) ═══
    // 在主矿后方远端，矿线在西北 (远离中央)
    {
      ccX: -30, ccZ: -42,
      mineralArcX: -30, mineralArcZ: -50,  // D=8 向北
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: -36, z: -48, amount: 2500 },
      ],
    },
    // ═══ P1 侧金矿 (6矿+1气) ═══
    // 在敌方半场，极度暴露
    {
      ccX: -30, ccZ: 38,
      mineralArcX: -30, mineralArcZ: 46,  // D=8 向南 (远离中央)
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: -36, z: 42, amount: 2500 },
      ],
    },

    // ═══ P2 主矿 — P1 的 180° 对称 ═══
    {
      ccX: P2.x, ccZ: P2.z,
      mineralArcX: P2.x + 8, mineralArcZ: P2.z,
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [
        { x: P2.x + 6, z: P2.z + 7, amount: 2500 },
        { x: P2.x + 6, z: P2.z - 7, amount: 2500 },
      ],
    },
    // ═══ P2 分矿 ═══
    {
      ccX: 14, ccZ: -6,
      mineralArcX: 14, mineralArcZ: -14,
      mineralCount: 8, mineralRadius: 5.5, mineralAmount: 1500,
      geysers: [
        { x: 21, z: -12, amount: 2500 },
        { x: 7, z: -12, amount: 2500 },
      ],
    },
    // ═══ P2 三矿 ═══
    {
      ccX: 30, ccZ: 42,
      mineralArcX: 30, mineralArcZ: 50,
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: 36, z: 48, amount: 2500 },
      ],
    },
    // ═══ P2 侧金矿 ═══
    {
      ccX: 30, ccZ: -38,
      mineralArcX: 30, mineralArcZ: -46,
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: 36, z: -42, amount: 2500 },
      ],
    },
  ],

  edgeDist: 56,
  noiseAmplitude: 0.04,
}
