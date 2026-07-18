/**
 * 地图预设 — Red Canyon (红色峡谷)
 *
 * 128×128 双人对称 SC2 风格
 *
 * 布局说明：
 *   - P1 左下角高地主矿 (30×24)，P2 右上角高地主矿 (对称)
 *   - 各自然分矿位于主矿侧方低地
 *   - 第三矿位于中场偏各自方向
 *   - 金矿位于对角远端
 *   - 中央高台 (h=2) 控制视野
 *   - 两条对角走廊连接全图
 *
 * 迭代记录：
 *   v1 — 初版
 *   v2 — 扩大基地面积、降低墙高、降低噪声
 *   v3 — 矩形基地、薄墙、8 单位坡道
 */

import type { MapBlueprint } from '../types'
import { TerrainType } from '../types'

const P1 = { x: -38, z: -42 }
const P2 = { x: 38, z: 42 }
const MAIN_H = 4
const MAIN_CL = 2   // cliff level 2 = 高地主矿

export const redCanyonBlueprint: MapBlueprint = {
  name: 'Red Canyon',
  width: 128,
  height: 128,
  resolution: 256,
  maxHeight: 10,
  cliffVisualHeight: 2.0,

  // ── 高地平台 ──
  // 扩大到填满地图边缘（edgeDist=56 即 ±56）
  platforms: [
    // P1 主矿 — 左下角，扩展到地图边缘
    { x1: -56, z1: -56, x2: -22, z2: -28, height: MAIN_H, cliffLevel: MAIN_CL },
    // P2 主矿 — 右上角，扩展到地图边缘
    { x1: 22, z1: 28, x2: 56, z2: 56, height: MAIN_H, cliffLevel: MAIN_CL },
  ],

  // ── 低地/中立区域 ──
  circles: [
    // 分矿
    { x: -12, z: -38, r: 12, height: 0, cliffLevel: 0 },
    { x: 12, z: 38, r: 12, height: 0, cliffLevel: 0 },
    // 第三矿
    { x: -4, z: -14, r: 10, height: 0, cliffLevel: 0 },
    { x: 4, z: 14, r: 10, height: 0, cliffLevel: 0 },
    // 金矿
    { x: -20, z: 16, r: 8, height: 0, cliffLevel: 0 },
    { x: 20, z: -16, r: 8, height: 0, cliffLevel: 0 },
    // 中央圆台
    { x: 0, z: 0, r: 12, height: 2, cliffLevel: 1, terrain: TerrainType.Ice },
  ],

  // ── 悬崖墙壁（已废弃，由 cliffLevel 自动生成） ──
  cliffWalls: [],

  // ── 石柱 ──
  pillars: [],

  // ── 坡道 ──
  ramps: [
    // P1: 主矿 → 低地
    { ax: -28, az: -34, bx: -20, bz: -28, width: 5.5, hA: MAIN_H, hB: 0 },
    // P2: 主矿 → 低地
    { ax: 28, az: 34, bx: 20, bz: 28, width: 5.5, hA: MAIN_H, hB: 0 },
    // 中央圆台坡道 × 2（从圆台边缘向外延伸）
    { ax: -14, az: 14, bx: -8.5, bz: 8.5, width: 4.5, pathWidth: 3.0, hA: 0, hB: 2 },
    { ax: 14, az: -14, bx: 8.5, bz: -8.5, width: 4.5, pathWidth: 3.0, hA: 0, hB: 2 },
  ],

  // ── 出生点 ──
  spawnPoints: [
    { x: P1.x, z: P1.z, playerId: 0, facing: Math.PI / 4 },
    { x: P2.x, z: P2.z, playerId: 1, facing: -Math.PI * 3 / 4 },
  ],

  // ── 基地资源 ──
  // 布局原则：
  //   · 矿线弧心距 CC 约 10 格，弧半径 6 → 最近矿距 CC 约 4 格
  //   · 气矿放在矿线弧两端外侧，而非 CC 正侧方
  //   · 展开角 0.52π → 8矿间距约 1.25 格，矿块 size=1.0 时有合理间隙
  bases: [
    // ─── P1 主矿 ───
    {
      ccX: P1.x, ccZ: P1.z,
      mineralArcX: P1.x, mineralArcZ: P1.z - 6,    // 弧心南移 D=6，矿线在平台内
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [
        { x: P1.x - 7, z: P1.z - 4, amount: 2500 },  // 矿线左端外侧
        { x: P1.x + 7, z: P1.z - 4, amount: 2500 },  // 矿线右端外侧
      ],
    },
    // ─── P1 分矿 ───
    {
      ccX: -12, ccZ: -38,
      mineralArcX: -12, mineralArcZ: -48,            // D=10
      mineralCount: 8, mineralRadius: 6, mineralAmount: 1500,
      geysers: [
        { x: -19, z: -45, amount: 2500 },             // 矿线左端
        { x: -5, z: -45, amount: 2500 },              // 矿线右端
      ],
    },
    // ─── P1 第三矿 ───
    {
      ccX: -4, ccZ: -14,
      mineralArcX: -4, mineralArcZ: -22,             // D=8
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: -10, z: -19, amount: 2500 },
      ],
    },
    // ─── P2 主矿 ───（P1 的对称镜像）
    {
      ccX: P2.x, ccZ: P2.z,
      mineralArcX: P2.x, mineralArcZ: P2.z + 6,     // 弧心北移 D=6，矿线在平台内
      mineralCount: 8, mineralRadius: 5, mineralAmount: 1500,
      geysers: [
        { x: P2.x + 7, z: P2.z + 4, amount: 2500 },
        { x: P2.x - 7, z: P2.z + 4, amount: 2500 },
      ],
    },
    // ─── P2 分矿 ───
    {
      ccX: 12, ccZ: 38,
      mineralArcX: 12, mineralArcZ: 48,
      mineralCount: 8, mineralRadius: 6, mineralAmount: 1500,
      geysers: [
        { x: 19, z: 45, amount: 2500 },
        { x: 5, z: 45, amount: 2500 },
      ],
    },
    // ─── P2 第三矿 ───
    {
      ccX: 4, ccZ: 14,
      mineralArcX: 4, mineralArcZ: 22,
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: 10, z: 19, amount: 2500 },
      ],
    },
    // ─── 金矿 P1 侧 ───
    {
      ccX: -20, ccZ: 16,
      mineralArcX: -20, mineralArcZ: 9,              // D=7
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: -26, z: 12, amount: 2500 },
      ],
    },
    // ─── 金矿 P2 侧 ───
    {
      ccX: 20, ccZ: -16,
      mineralArcX: 20, mineralArcZ: -9,
      mineralCount: 6, mineralRadius: 4.5, mineralAmount: 1500,
      geysers: [
        { x: 26, z: -12, amount: 2500 },
      ],
    },
  ],

  edgeDist: 56,
  noiseAmplitude: 0.04,
}
