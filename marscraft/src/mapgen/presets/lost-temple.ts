/**
 * 地图预设 — Lost Temple (失落的神殿)
 *
 * 改编自 StarCraft 1 最经典地图 "The Lost Temple"
 * 128×128  2人对战  180° 旋转对称
 *
 * ★ 道路设计原理 (参考 alg_starcraft_terrain + skill_road_gen) ★
 *
 * SC 地图的道路不是"画"出来的，而是通过大面积不可通行地形(岩石/太空/水域)
 * 填充剩余空间后，"挤"出来的窄缝走廊。
 *
 * 设计步骤：
 *   1. 确定 4 个角落高地 (CL=2，主矿/扩张)
 *   2. 确定中央神殿 (CL=1)
 *   3. 用大面积 unpathable 填充物"雕刻"道路：
 *      - 4 条放射路 (从角落到中央环路)
 *      - 1 条环形路 (围绕中央区)
 *      - 4 条神殿入口 (从环路到神殿)
 *   4. 走廊宽度 8-12 格，弯角 + 瓶颈处 6 格
 *
 * 俯视结构图：
 *
 *        NW[CL2]─── roadN ───NE(空)
 *            │    ╔═══════╗    │
 *          roadW  ║TEMPLE ║  roadE
 *            │    ║ CL=1  ║    │
 *          roadW  ╚═══════╝  roadE
 *            │                  │
 *        SW(空)─── roadS ───SE[CL2]
 *
 *   ▓▓▓ = 不可通行岩石/陨石坑 (视觉为深色 Crater)
 *   road = 8-12格宽可通行走廊 (视觉为 Regolith/Sand)
 *
 * 关键比例：
 *   - 道路占低地面积 ~35%
 *   - 不可通行填充占低地面积 ~65%
 *   - 这就是为什么有清晰的"路"的感觉
 */

import type { MapBlueprint } from '../types'
import { TerrainType } from '../types'

const MAIN_H = 4
const MAIN_CL = 2

// 出生点坐标
const P1 = { x: -40, z: -42 }  // 7 点钟 (SW)
const P2 = { x: 40, z: 42 }    // 1 点钟 (NE)

export const lostTempleBlueprint: MapBlueprint = {
  name: 'Lost Temple',
  width: 128,
  height: 128,
  resolution: 256,
  maxHeight: 10,
  cliffVisualHeight: 2.0,
  baseCliffLevel: 0,

  // ══════════════════════════════════════════
  //  高地平台 (CL=2) — 四角基地
  // ══════════════════════════════════════════
  platforms: [
    // P1 主矿 — SW 角 (7点)
    { x1: -56, z1: -56, x2: -20, z2: -30, height: MAIN_H, cliffLevel: MAIN_CL },
    // P2 主矿 — NE 角 (1点)  180° 对称
    { x1: 20, z1: 30, x2: 56, z2: 56, height: MAIN_H, cliffLevel: MAIN_CL },
    // 11 点位扩张高地 — NW 角
    { x1: -56, z1: 30, x2: -24, z2: 56, height: MAIN_H, cliffLevel: MAIN_CL },
    // 5 点位扩张高地 — SE 角
    { x1: 24, z1: -56, x2: 56, z2: -30, height: MAIN_H, cliffLevel: MAIN_CL },
  ],

  // ══════════════════════════════════════════
  //  中央神殿 (CL=1) — 地图标志
  // ══════════════════════════════════════════
  circles: [
    { x: 0, z: 0, r: 12, height: 2, cliffLevel: 1, terrain: TerrainType.Ice },
  ],

  // ══════════════════════════════════════════
  //  ★ 不可通行区域 — 道路雕刻的核心 ★
  //
  //  原则：先填满所有低地空间，
  //        再留出 8-12 格宽的走廊作为道路
  // ══════════════════════════════════════════
  unpathableRects: [
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  四大块填充 — 堵住基地之间的直线路径
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 北面大填充 — NW高地与NE高地之间的"太空"
    // 留出走廊: x ∈ [-24,-14] (NW坡道下) 和 x ∈ [10,20] (NE坡道下)
    { x1: -12, z1: 36, x2: 8, z2: 56 },

    // 南面大填充 — SW与SE之间
    { x1: -8, z1: -56, x2: 12, z2: -36 },

    // 西面大填充 — NW与SW之间, 走廊以西
    // 走廊在 x ∈ [-30,-20]
    { x1: -56, z1: -20, x2: -32, z2: 20 },

    // 东面大填充 — NE与SE之间
    { x1: 32, z1: -20, x2: 56, z2: 20 },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  弯角填充 — 环形路转角处的外侧
    //  SC 原版这里通常是岩石/太空
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // SW 弯角外侧 (南路→西路转弯处)
    { x1: -32, z1: -36, x2: -20, z2: -24 },
    // NE 弯角外侧 (180° 对称)
    { x1: 20, z1: 24, x2: 32, z2: 36 },
    // NW 弯角外侧 (北路→西路)
    { x1: -32, z1: 24, x2: -26, z2: 36 },
    // SE 弯角外侧 (南路→东路)
    { x1: 26, z1: -36, x2: 32, z2: -24 },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  中央区域填充 — 环形路与神殿之间
    //  迫使单位只能走 4 条辐射路进入神殿
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // SW象限: 环路→神殿之间的填充
    { x1: -22, z1: -22, x2: -6, z2: -6 },
    // NE象限: 180° 对称
    { x1: 6, z1: 6, x2: 22, z2: 22 },
    // NW象限
    { x1: -22, z1: 6, x2: -6, z2: 22 },
    // SE象限
    { x1: 6, z1: -22, x2: 22, z2: -6 },
  ],

  unpathableCircles: [
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  走廊中段的自然岩石 — 收窄过宽区域
    //  类似 SC 原版路边的碎石/陨石
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 南走廊两侧收窄
    { x: -14, z: -40, r: 3 },
    { x: 18, z: -40, r: 3 },

    // 北走廊两侧收窄
    { x: 14, z: 40, r: 3 },
    { x: -18, z: 40, r: 3 },

    // 西走廊内侧收窄
    { x: -24, z: -8, r: 2.5 },
    { x: -24, z: 10, r: 2.5 },

    // 东走廊内侧收窄
    { x: 24, z: 8, r: 2.5 },
    { x: 24, z: -10, r: 2.5 },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  分矿附近的自然障碍
    //  让分矿区不是完全空旷的平地
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // P1 分矿周围
    { x: -6, z: -30, r: 2 },

    // P2 分矿周围 (对称)
    { x: 6, z: 30, r: 2 },
  ],

  cliffWalls: [],

  // ══════════════════════════════════════════
  //  石柱 (装饰 + 战术掩体)
  // ══════════════════════════════════════════
  pillars: [
    // 神殿上装饰柱
    { x: -3, z: -3, r: 1.2 },
    { x: 3, z: 3, r: 1.2 },
    // 环路中的掩体石柱
    { x: -16, z: 0, r: 1.8 },
    { x: 16, z: 0, r: 1.8 },
    { x: 0, z: -16, r: 1.8 },
    { x: 0, z: 16, r: 1.8 },
  ],

  // ══════════════════════════════════════════
  //  坡道
  // ══════════════════════════════════════════
  ramps: [
    // ── 主矿坡道 (CL=2 → CL=0) ──
    // P1 SW → 低地
    { ax: -22, az: -32, bx: -16, bz: -26, width: 5.5, hA: MAIN_H, hB: 0, pathWidth: 2.5 },
    // P2 NE → 低地
    { ax: 22, az: 32, bx: 16, bz: 26, width: 5.5, hA: MAIN_H, hB: 0, pathWidth: 2.5 },
    // ── 扩张位坡道 (CL=2 → CL=0) ──
    // NW (11点)
    { ax: -26, az: 32, bx: -22, bz: 26, width: 5.0, hA: MAIN_H, hB: 0, pathWidth: 2.0 },
    // SE (5点)
    { ax: 26, az: -32, bx: 22, bz: -26, width: 5.0, hA: MAIN_H, hB: 0, pathWidth: 2.0 },
    // ── 神殿坡道 (CL=0 → CL=1)  4条入口 ──
    // 西入口
    { ax: -14, az: 0, bx: -10, bz: 0, width: 3.5, hA: 0, hB: 2, pathWidth: 1.5 },
    // 东入口
    { ax: 14, az: 0, bx: 10, bz: 0, width: 3.5, hA: 0, hB: 2, pathWidth: 1.5 },
    // 南入口
    { ax: 0, az: -14, bx: 0, bz: -10, width: 3.5, hA: 0, hB: 2, pathWidth: 1.5 },
    // 北入口
    { ax: 0, az: 14, bx: 0, bz: 10, width: 3.5, hA: 0, hB: 2, pathWidth: 1.5 },
  ],

  // ══════════════════════════════════════════
  //  出生点
  // ══════════════════════════════════════════
  spawnPoints: [
    { x: P1.x, z: P1.z, playerId: 0, facing: Math.PI / 4 },
    { x: P2.x, z: P2.z, playerId: 1, facing: -Math.PI * 3 / 4 },
  ],

  // ══════════════════════════════════════════
  //  基地资源
  // ══════════════════════════════════════════
  bases: [
    // ═══ P1 主矿 — SW (8矿+2气) ═══
    {
      ccX: P1.x, ccZ: P1.z,
      mineralArcX: P1.x, mineralArcZ: P1.z - 7,
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [
        { x: P1.x - 7, z: P1.z - 5, amount: 2500 },
        { x: P1.x + 7, z: P1.z - 5, amount: 2500 },
      ],
    },
    // ═══ P1 分矿 — 坡道下方低地 (8矿+1气) ═══
    {
      ccX: -14, ccZ: -28,
      mineralArcX: -10, mineralArcZ: -34,
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [{ x: -18, z: -34, amount: 2500 }],
    },
    // ═══ P1 三矿 — SE扩张位 (6矿+1气) ═══
    {
      ccX: 38, ccZ: -42,
      mineralArcX: 38, mineralArcZ: -49,
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [{ x: 44, z: -47, amount: 2500 }],
    },
    // ═══ 神殿矿 — 中央有矿无气 (Lost Temple 标志) ═══
    {
      ccX: 0, ccZ: 0,
      mineralArcX: 0, mineralArcZ: -5,
      mineralCount: 6, mineralRadius: 3.5, mineralAmount: 1200,
      geysers: [],
    },
    // ═══ P2 主矿 — NE (180° 对称) (8矿+2气) ═══
    {
      ccX: P2.x, ccZ: P2.z,
      mineralArcX: P2.x, mineralArcZ: P2.z + 7,
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [
        { x: P2.x + 7, z: P2.z + 5, amount: 2500 },
        { x: P2.x - 7, z: P2.z + 5, amount: 2500 },
      ],
    },
    // ═══ P2 分矿 ═══
    {
      ccX: 14, ccZ: 28,
      mineralArcX: 10, mineralArcZ: 34,
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [{ x: 18, z: 34, amount: 2500 }],
    },
    // ═══ P2 三矿 — NW扩张位 ═══
    {
      ccX: -38, ccZ: 42,
      mineralArcX: -38, mineralArcZ: 49,
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [{ x: -44, z: 47, amount: 2500 }],
    },
  ],

  edgeDist: 56,
  noiseAmplitude: 0.04,
}
