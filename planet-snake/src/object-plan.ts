// 此文件由 `bun tools/emit-object-plan.ts` 从 WorldClaw Stage 3 的求解结果生成，
// 手改会被下次生成覆盖。每一项的 dir 是构图图里该物体接触点的射线与地形的交点。
// 生成自: tools/wc-stage3/grassland/objects.json

export interface PlannedObject {
  prop: string;
  /** 球面方向（单位向量）。 */
  dir: [number, number, number];
  /** 世界单位的最大边长度。 */
  size: number;
}

export const OBJECT_PLAN: PlannedObject[] = [
  { prop: 'wc_dandelion', dir: [0.868767, 0.122576, -0.479812], size: 9.5 },  // grassland: giant glowing dandelion with snake-like roots
  { prop: 'wc_earthPillar', dir: [0.812428, -0.094479, -0.575356], size: 8.13 },  // grassland: leaning stone pillar with grass on top
  { prop: 'wc_dandelion', dir: [0.726722, -0.047552, -0.685284], size: 11.9 },  // grassland: giant glowing dandelion with snake-like roots
  { prop: 'wc_dandelion', dir: [0.766074, 0.161404, -0.622157], size: 9.22 },  // grassland: giant glowing dandelion with snake-like roots
  { prop: 'wc_stoneRing', dir: [0.873609, 0.050113, -0.484041], size: 3.28 },  // grassland: circular stone border
  { prop: 'wc_earthPillar', dir: [0.810054, 0.182278, -0.557303], size: 5.04 },  // grassland: leaning stone pillar with grass on top
  { prop: 'wc_mushroomCap', dir: [0.859142, 0.076308, -0.506016], size: 2.43 },  // grassland: red and white spotted mushroom
  { prop: 'wc_stoneRing', dir: [0.755989, 0.057007, -0.652097], size: 2.17 },  // grassland: circular stone border
  { prop: 'wc_mushroomCap', dir: [0.722567, 0.076643, -0.687039], size: 2.58 },  // grassland: red and white spotted mushroom
];
