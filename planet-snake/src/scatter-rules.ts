import { PROP_DATA } from './props-data';
import type { PropName } from './props';
import type { PSRegion } from './regions';
import { latticeHeight, warpedField, type HeightLattice, type V3 } from './surface';

export const PLANET_R = 52;
export const SURF_WS = 314;
export const SURF_HS = 206;

export const REGION_IDS = [
  'iceCap',
  'dry',
  'highland',
  'beach',
  'grassland',
] as const satisfies readonly PSRegion[];

/** Below this world size a prop is scenery, not an obstacle — see spawnProp. */
export const MIN_HIT_SIZE = 1.2;
/** Absolute world-space floor for a registered obstacle's kill radius.
 *
 * Kept below the head padding (HEAD_RADIUS * 0.6 = 0.51), so ordinary props
 * follow their measured footprint instead of being inflated by a planet-scale
 * angular constant. */
export const MIN_HIT_WORLD = 0.35;
/** Hitbox radius as a multiple of the reachable horizontal half-extent.
 *
 *  1.0 = the snake-height silhouette. It was 1.3 to make a graze count, and
 *  that read as dying to thin air — the player steers past the visible edge
 *  of a rock and still dies. When the hitbox and the reachable picture
 *  disagree the picture wins, because that is what the player steers by. */
export const HIT_SCALE = 1.0;
/** Padding the snake's own head contributes to a hit test. */
export const HEAD_RADIUS = 0.85;

export type ScatterPropCategory = 'tree' | 'rock' | 'bush';
export interface ScatterPropSpec {
  lo: number;
  hi: number;
  bed: number;
  wide: number;
  cat: ScatterPropCategory;
}

// [model, min size, max size]. Sizes are world units on a radius-26 planet,
// set against the grass (blades stand about 0.5 tall). Scaled up ~1.5x on
// 2026-08-03: at the previous sizes the props read as a scattering of trinkets
// on a big ball rather than as terrain the snake has to navigate.
export const PROP_TABLE = {
  tree_cloudPine: { lo: 5.2, hi: 8.2, bed: 0.03, wide: 1.0, cat: 'tree' },
  tree_cloudBroad: { lo: 4.8, hi: 7.2, bed: 0.03, wide: 1.0, cat: 'tree' },
  tree_cloudDead: { lo: 4.4, hi: 6.8, bed: 0.03, wide: 1.0, cat: 'tree' },
  tree_pineTallA_detailed: { lo: 6.2, hi: 9.4, bed: 0.03, wide: 1.55, cat: 'tree' },
  tree_pineRoundC: { lo: 5.4, hi: 8.0, bed: 0.03, wide: 1.25, cat: 'tree' },
  tree_oak: { lo: 4.6, hi: 7.0, bed: 0.03, wide: 1.0, cat: 'tree' },
  plant_bushDetailed: { lo: 0.72, hi: 1.15, bed: 0.14, wide: 1, cat: 'bush' },
  plant_bushLargeTriangle: { lo: 0.78, hi: 1.18, bed: 0.14, wide: 1, cat: 'bush' },
  rock_slabA: { lo: 3.4, hi: 5.8, bed: 0.25, wide: 1, cat: 'rock' },
  rock_pebbleCluster: { lo: 3.8, hi: 6.4, bed: 0.25, wide: 1, cat: 'rock' },
  rock_standingA: { lo: 3.4, hi: 5.6, bed: 0.25, wide: 1, cat: 'rock' },
  rock_cloudMossy: { lo: 3.2, hi: 5.4, bed: 0.25, wide: 1, cat: 'rock' },
  rock_largeA: { lo: 2.80, hi: 4.60, bed: 0.25, wide: 1, cat: 'rock' },
  rock_largeD: { lo: 2.60, hi: 4.30, bed: 0.25, wide: 1, cat: 'rock' },
  rock_smallB: { lo: 0.62, hi: 1.10, bed: 0.25, wide: 1, cat: 'rock' },
  stone_largeC: { lo: 2.50, hi: 4.10, bed: 0.25, wide: 1, cat: 'rock' },
  // WorldClaw Stage 3 产出的地标。尺寸区间取自 Stage 3 自己反解出来的世界尺度
  // （见 src/object-plan.ts 每项的 size），不是另拍的。它们由 OBJECT_PLAN 定点
  // 摆放，不参与随机散布，但仍要在这张表里——gate 和 footRadiusWorld 是全体道具
  // 共用的规则，缺一项就会在 spawn 时抛 unknown scatter prop。
  wc_dandelion: { lo: 7.0, hi: 12.0, bed: 0.10, wide: 1, cat: 'tree' },
  wc_earthPillar: { lo: 4.5, hi: 8.5, bed: 0.12, wide: 1, cat: 'rock' },
  wc_mushroomCap: { lo: 2.0, hi: 3.6, bed: 0.05, wide: 1, cat: 'bush' },
  wc_stoneRing: { lo: 2.6, hi: 5.0, bed: 0.10, wide: 1, cat: 'rock' },
} as const satisfies Partial<Record<PropName, ScatterPropSpec>>;

export type ScatterPropName = keyof typeof PROP_TABLE;

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

export function makeSlopeAt(
  lattice: HeightLattice,
  deformAt: (d: V3) => number,
): (d: V3) => number {
  const groundRadius = (d: V3): number => PLANET_R + 0.05 + latticeHeight(lattice, d) + deformAt(d);
  return (d: V3): number => {
    const e = 0.02;
    const up: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t = norm(cross(d, up));
    const b = cross(d, t);
    const g0 = groundRadius(d);
    let worst = 0;
    // Eight compass points, not four: with four, a slope aligned to the
    // diagonal read as up to 30% flatter than it is, and six trees leaked
    // past the 0.45 gate onto 0.46-0.57 ground.
    for (let k = 0; k < 8; k++) {
      const c = Math.cos((k / 8) * Math.PI * 2);
      const sn = Math.sin((k / 8) * Math.PI * 2);
      const q = norm([
        d[0] + (t[0] * c + b[0] * sn) * e,
        d[1] + (t[1] * c + b[1] * sn) * e,
        d[2] + (t[2] * c + b[2] * sn) * e,
      ]);
      worst = Math.max(worst, Math.abs(groundRadius(q) - g0) / (e * PLANET_R));
    }
    return worst;
  };
}

/** 固定光源方向。住在这里是因为出生点要挑"有光的那一面"，而出生点决定 gate 的
 *  无障碍区，所以它已经是散布规则的输入之一了。main.ts 的光照配置也从这里取。 */
export const SUN_DIR: V3 = (() => {
  const l = Math.hypot(0.5, 0.7, 0.4);
  return [0.5 / l, 0.7 / l, 0.4 / l];
})();

/** 出生点太阳高度角的下限。0.15 ≈ 高于地平线 9°：晨昏线那一圈光很斜、地面很暗，
 *  不算"有光亮"。 */
const SPAWN_MIN_LIT = 0.15;
/** 出生点允许的最大坡度，免得开局站在悬崖边。海面为 0，天然通过。 */
const SPAWN_MAX_SLOPE = 0.35;

/**
 * 挑出生点。海里可以出生，但要尽量落在**有光的那一面**。
 *
 * 判据是"接受任何日照充足的点"，不是"取样里挑最亮的那个"。后者听起来更满足
 * "尽可能"，实际会退化：几百个样本里的最亮点必然贴着直射点，每局都开在同一处，
 * 等于把随机出生又抹掉了。要的是"在亮的那半边随机"。日面占半球，随机抽两三次
 * 就中。兜底留最亮的候选，万一门槛没人满足也不会静默变成定点。
 *
 * 这个函数必须是共享的：出生点决定 gate 的无障碍区，也就决定了散布结果，
 * 所以 headless 的 dry-run 要复现游戏就得用同一套挑法。抄第二份 = 工具算出来的
 * 分布和游戏实际跑的分家，而且不会报错。
 */
export function pickSpawn(slopeAt: (p: V3) => number, rng: () => number): V3 {
  let best: V3 = SUN_DIR;
  let bestLit = -2;
  for (let i = 0; i < 400; i++) {
    const z = 2 * rng() - 1;
    const phi = 2 * Math.PI * rng();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const d = norm([r * Math.cos(phi), z, r * Math.sin(phi)]);
    if (slopeAt(d) > SPAWN_MAX_SLOPE) continue;
    // 太阳高度角：1 = 正当头，0 = 地平线，负 = 夜面。
    const lit = dot(d, SUN_DIR);
    if (lit >= SPAWN_MIN_LIT) return d;
    if (lit > bestLit) { bestLit = lit; best = d; }
  }
  return best;
}

/**
 * `spawnDir` 是玩家出生的球面方向；它周围 dot > 0.88 的那块（约 28° 锥角）不放
 * 道具，否则开局就可能站在石头里。以前这里写死 [0,0,1]，出生地一随机就会失配——
 * 安全区是**出生点的属性**，所以必须由出生点导出，不能各写各的。
 */
export function makeGate(
  slopeAt: (p: V3) => number,
  spawnDir: V3,
): (p: V3, prop: string) => boolean {
  return (p: V3, prop: string): boolean => {
    const onAllowedGround = warpedField(p) > 0 && dot(p, spawnDir) <= 0.88;
    if (prop === '__seed__') return onAllowedGround;
    const spec = PROP_TABLE[prop as ScatterPropName];
    return onAllowedGround && spec !== undefined && (spec.cat !== 'tree' || slopeAt(p) <= 0.45);
  };
}

export function footRadiusWorld(prop: string, sizeU: number): number {
  const name = prop as ScatterPropName;
  const spec = PROP_TABLE[name];
  if (spec === undefined) throw new Error(`[planet-snake] unknown scatter prop: ${prop}`);
  return PROP_DATA[name].footLow * (spec.lo + sizeU * (spec.hi - spec.lo)) * spec.wide;
}
