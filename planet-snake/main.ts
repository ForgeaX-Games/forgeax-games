// 星球贪吃蛇 (Planet Snake)
// Persistence check: this comment intentionally has no runtime effect.
// Persistence recheck: comment-only edit with no gameplay side effects.
// Persistence probe: side-effect-free comment added to confirm edit survival.
// Persistence confirmation marker: comment-only change, no runtime side effects.
// ---------------------------------------------------------------------------
// A snake that crawls along the SURFACE of a planet (a sphere). It always
// moves forward along a great-circle geodesic; A/D (or ←/→) steer left/right,
// and holding Shift spends a stamina meter for a speed burst.
// Glowing pellets are scattered over the surface — eat one to grow + score.
// Bite your own tail, ram a rival robot snake, OR crash into the surface
// terrain (rocks / trees / bushes) and it's game over (R / button restarts).
// The rival snakes play by the SAME rules you do: they seek + eat pellets to
// grow, speed up and slow down as they go, dodge hazards, and DIE if they crash
// into the terrain, another snake, their own tail — or your body (a reverse-kill
// that scores + drops edible pellets). The tail is a weapon, not just a risk.
//
// SCENE SPLIT (per authoring convention):
//   • STATIC content in assets/scene.pack.json is Sun + Skylight only.
//   • The Planet is programmatic: buildSurfaceMesh + world.spawn build it from
//     the current seed at runtime, so Edit is not expected to show the Play
//     planet. The snake, pellets, bots, props and camera behaviour are runtime
//     content for the same reason.

// Engine API drift (found 2026-07-31): this file imported everything from the
// `@forgeax/engine-runtime` barrel, which no longer re-exports the scene/render
// symbols. The stale import threw `does not provide an export named
// 'ANTIALIAS_FXAA'` (and then 'Camera'), which failed the whole module — the
// engine caught it, logged `loadGame failed`, and silently swapped in its
// fallback scene, so the game rendered as a black screen. `verify` still
// reported ok:true, so nothing flagged it. Symbols now resolve as:
//   engine-scene  → Transform
//   engine-render → Camera, perspective, Materials, MeshFilter, MeshRenderer,
//                   TONEMAP_*, ANTIALIAS_*
//   engine-types  → MaterialAsset, MeshAsset (types)
import { Transform } from '@forgeax/engine-scene';
import {
  Camera, perspective, Materials, MeshFilter, MeshRenderer, Instances, PointLight,
  TONEMAP_NEUTRAL, ANTIALIAS_FXAA, Visibility, VisibilityStateValue,
} from '@forgeax/engine-render';
import type { MaterialAsset, MeshAsset } from '@forgeax/engine-types';
import type { InputSnapshot } from '@forgeax/engine-input';
import { createSphereGeometry, createCapsuleGeometry } from '@forgeax/engine-geometry';
import { Time, Update, type EntityHandle, type Handle, type World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import { installHud } from './src/hud';
import { installSpaceBackground, updateSpaceParams, WAKE_SAMPLES } from './src/space';
import { createRibbon, type Ribbon, type RibbonSpineSample } from './src/ribbon';
import { createWaterPatch, DENT_FLOATS, PATCH_HALF, WATER_LIFT, type WaterPatch } from './src/water-patch';
import { installSkillLights } from './src/skill-lights';
import { createSlough, type Slough } from './src/slough';
import { createWaterRibbon, type WaterRibbon } from './src/waterribbon';
import { BLOOM_R, createBloom, type Bloom } from './src/bloom';
import { createDeformSkin, createDeformStore, type DeformSkin, type DeformStore } from './src/deform';
import { createSweep, type Sweep } from './src/sweep';
import { createStrikeWake, type StrikeWake } from './src/strikewake';
import { installGrass } from './src/grass';
import { installBursts } from './src/particles';
import { loadProps, type PropName, type PropRole } from './src/props';
import { installGrafts, withShader } from './src/terrain-material';
import { findMaterialArtifact, updateMesh, verifyEngineBridge } from './src/engine-bridge';
import { createExodus, EXODUS_MIN_LEN, EXODUS_SLOW_MAX as EXODUS_SLOW_MAX_LOCAL } from './src/exodus';
import { warpedField, buildHeightLattice, latticeHeight, buildSurfaceMesh } from './src/surface';
import {
  HIT_SCALE, MIN_HIT_SIZE, MIN_HIT_WORLD, PLANET_R, PROP_TABLE, SURF_HS, SURF_WS,
  SUN_DIR, footRadiusWorld, makeGate, makeSlopeAt, pickSpawn,
} from './src/scatter-rules';
import { meshFromInterleaved as buildMeshFromInterleaved } from '@forgeax/engine-geometry';

const meshFromInterleaved = (
  ...args: Parameters<typeof buildMeshFromInterleaved>
): MeshAsset => {
  const result = buildMeshFromInterleaved(...args);
  if (!result.ok) throw result.error;
  return result.value;
};

// Low-poly snake-head model (Poly/wb-3d-lowpoly build, imported via Content
// Browser): assets/snake_head.glb.meta.json subAssets[] kind:"scene" guid.
// 2026-07-17 refinement pass: horn embed depth 0.24m->0.131m, eye sockets
// recentered toward front (3/4 view visible), mouth groove thickness +140%.

// The authored planet scene GUID (assets/scene.pack.json assets[0].guid; also
// forge.json.defaultScene).

// ── tiny vec3 math (plain [x,y,z] arrays) ───────────────────────────────────
type V3 = [number, number, number];
type Quat = [number, number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smoothstep01 = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Spherical-linear interpolation between two UNIT vectors (great-circle path).
function slerp(a: V3, b: V3, t: number): V3 {
  let d = dot(a, b);
  d = Math.max(-1, Math.min(1, d));
  const omega = Math.acos(d);
  if (omega < 1e-4) return norm(add(scl(a, 1 - t), scl(b, t)));
  const so = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / so;
  const wb = Math.sin(t * omega) / so;
  return norm(add(scl(a, wa), scl(b, wb)));
}

// Camera orientation quaternion [x,y,z,w] that looks along `forward` with `upRef`
// roughly up. Camera's local -Z is the view direction (engine convention).
// ROBUST: when `forward` is (nearly) parallel to `upRef` the cross product
// collapses to ~0 and naive normalization would emit NaN — which poisons the
// Transform and trips the engine's render error. We detect that and fall back
// to an arbitrary orthogonal up so the quaternion is always finite.
function lookQuat(forward: V3, upRef: V3): Quat {
  const back = norm(scl(forward, -1));          // camera local +Z
  let right = cross(upRef, back);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-4) {
    const alt: V3 = Math.abs(back[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    right = cross(alt, back);
  }
  right = norm(right);                           // camera local +X
  const up = cross(back, right);                 // camera local +Y (already unit)
  const m00 = right[0], m10 = right[1], m20 = right[2];
  const m01 = up[0], m11 = up[1], m21 = up[2];
  const m02 = back[0], m12 = back[1], m22 = back[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

// Shortest-arc quaternion rotating local +Y onto unit `dir` (used to stand
// surface decoration up along the planet normal).
function quatFromY(dir: V3): Quat {
  const b = norm(dir);
  const d = b[1];                       // dot([0,1,0], b)
  if (d > 0.99999) return [0, 0, 0, 1];
  if (d < -0.99999) return [1, 0, 0, 0]; // 180° about X
  const c = cross([0, 1, 0], b);         // rotation axis * sin
  const w = 1 + d;
  const l = Math.hypot(c[0], c[1], c[2], w) || 1;
  return [c[0] / l, c[1] / l, c[2] / l, w / l];
}

// quatFromY, then a roll about the model's OWN +Y. Scattered props all facing
// the same way read as a repeated stamp; a random azimuth is what makes twelve
// models cover a hundred placements.
function quatFromYSpin(dir: V3, angle: number): Quat {
  const [x, y, z, w] = quatFromY(dir);
  const s = Math.sin(angle * 0.5), c = Math.cos(angle * 0.5);
  // a * (0, s, 0, c) — the spin is on the RIGHT, so it applies in model space
  // and turns the prop about its own trunk rather than about world Y.
  return [x * c - z * s, w * s + y * c, x * s + z * c, w * c - y * s];
}

// Uniform-random point on the unit sphere.
function randomSpherePoint(): V3 {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return [r * Math.cos(th), u, r * Math.sin(th)];
}

// ── constants ────────────────────────────────────────────────────────────
// PLANET_R (18 -> 26 -> 36 -> 52) lives with the scatter rules so the game and
// headless planner cannot silently use different sphere sizes.
// The snake, its speed and the pickup/hit ranges are all authored in ANGULAR
// units, so a raw radius bump would make the snake feel slower and eat/collide
// from further away. R_SCALE (= old radius / new radius) shrinks every angular
// quantity by the same factor, keeping the snake's world-space SIZE, SPEED and
// pickup feel identical — only the planet visibly grows.
const R_SCALE = 18 / PLANET_R;
// Ribbon lattice. Module scope because the BOTS build their tubes long before
// the player's section of bootstrap runs, and a const declared down there is in
// its temporal dead zone up here.
/** How hard the body's rings pack toward the head. 1 is even. Above 1 the head
 *  keeps its shape at any length; the cost is a coarser tail, which is a taper
 *  and survives it. */
const HEAD_BIAS = 2.2;
const RIBBON_COLS = 160;   // rings along the body; the lattice is static, so a
                           // long snake and a short one cost the same buffer
const RIBBON_RING = 28;    // samples around the cross-section. 12 left visible
                           // facets on the silhouette at this camera distance —
                           // the reference body has no readable flat sides.
const HEAD_R = 0.85;            // head sphere radius — 1.7x the body, as the reference bulb is
const BODY_R = 0.62;            // body radius (tapers toward the tail)
// 0.5 -> 0.62 from a MATCHED-LENGTH measurement: at the reference's own length
// (f01's HUD reads 5.5) our thickness/length was 0.218 against its 0.280. The
// naive comparison against a grown snake said 3.6x and was meaningless — the
// reference clip is of a short snake.
const FOOD_R = 0.5;             // pellet radius
const SEG_SPACING = 0.04 * R_SCALE; // arc-length (radians) between segment centers
const BASE_SPEED = 0.32 * R_SCALE;  // angular speed (rad/s) at start — world linear speed kept constant

// ── 地形接入手感 ─────────────────────────────────────────────────────────────
// Stage 2 把地形做成了区域感知的（高地陡、草原平），但在此之前那套东西玩家只能
// 看见、感觉不到：坡度和区域对移动毫无影响，唯一起作用的是水面转向变钝。
//
// 系数是**量出来的**，不是拍的。沿行进方向的有符号坡度（不是 terrain-gate 里那个
// 八方向取最陡的 |梯度|，那个大一个数量级，抓的是局部粗糙度）实测分布：
//   p25/p75 = ∓0.042   p05/p95 = ∓0.262   |grade| p99 = 0.625
//   各区中位 |grade|：grassland 0.02 · iceCap 0.043 · beach 0.048 · dry 0.094 · highland 0.123
//
// GRADE_GAIN 0.8 配上这个分布：草原 ±1.6%（察觉不到，草原就该是中性的），
// 高地中位 ±10%，p95 的陡坡 ±21%，最陡的百分之几撞上钳位。
const GRADE_GAIN = 0.8;
const GRADE_SLOW_MAX = 0.72;    // 最陡上坡的速度下限
const GRADE_FAST_MAX = 1.28;    // 最陡下坡的速度上限
/** 坡度低通的时间常数（秒的倒数）。地形格点约 1 世界单位，原始坡度逐帧会抖，
 *  直接乘进速度会读作引擎在卡。 */
const GRADE_SMOOTH = 6;
/** 沙地拖慢。dry 区中位坡度只有 0.094，光靠坡度它和草原区分不开，得给它自己的性格。 */
const DRY_DRAG = 0.10;
/** 冰面打滑：转向按 iceCap 权重衰减，和水面用的是同一种做法。 */
const ICE_SLIP = 0.45;
const SPEED_GAIN = 0.008 * R_SCALE; // extra rad/s per pellet eaten
const MAX_SPEED = 0.6 * R_SCALE;
const TURN_SPEED = 1.8;         // steering rate (rad/s) — radius-independent, keeps the same turn circle
/** Steering multiplier over open water. A body swimming has nothing to push
 *  against sideways; carving the same turn circle on water as on sand is most
 *  of what made the sea read as ICE with a snake sliding over it. */
const WATER_TURN = 0.58;
/** How deep a full-radius body section rides when afloat, in world units.
 *  Scaled by the section's own radius so the waterline cuts every part at the
 *  same FRACTION of its thickness — a buoyant body displaces by volume — which
 *  also keeps the thin tail from vanishing under the surface entirely.
 *
 *  The ratio is CLAMPED AT 1: the head bulb runs 1.7x the base radius, and
 *  unclamped it sank 0.58 instead of 0.34 — the head went under to the eyes.
 *
 *  0.34 -> 0.22 after that, because the sink does not act alone: the wake's bow
 *  wave lifts the water right beside the head by as much again, and the two
 *  together drowned it. This is the figure that leaves the body about half in
 *  with the head clear. */
const WATER_SINK = 0.22;

// ── Coilstrike (七寸) ────────────────────────────────────────────────────────
// Hold to gather, release to detonate down one line.
//
// THE ONE DECISION: the wind-up is NOT an animation played over the body — it is
// the path generator changing gear. This game's one sacred invariant is that the
// body only ever flows through the track the head laid down, so the coil is made
// by COMPRESSING THAT TRACK and the strike by spending it. Geometry that was
// really stored is really released: on release the body whip-cracks out through
// the bunched track segment by segment for free, because the body does not know
// the skill exists — it is following the trail, as it always has.
//
// Animate the coil as a pose layered on the spine instead and the wake, the
// furrow, the collision samples and the water trough all keep describing the
// UNCOILED body underneath. The player may not name the lie; they will feel that
// the wind-up weighs nothing.
/** Seconds of hold for a full charge. */
const COIL_FULL = 1.0;
/** Minimum hold that still fires — a tap is a pounce, not a misfire. */
const COIL_MIN = 0.22;
/** Wavelength and amplitude at full charge. The same arc of body now stacks into
 *  half the ground distance, so the snake genuinely bunches. */
/** Wavelength and amplitude at full charge.
 *
 *  Bounded by the body's own width, not by taste. At 0.28 the wavelength was
 *  2.24 world units while the tube is 1.24 across, so adjacent crests sat 1.12
 *  apart and the body OVERLAPPED ITSELF — it read as a squashed accordion, not
 *  as a coiled snake. 0.42 puts the crests 1.68 apart: still plainly wound, with
 *  daylight between the turns. */
const COIL_LAMBDA = 0.42;
const COIL_AMP = 1.9;
/** Forward speed while gathering.
 *
 *  0.4 -> 0.82, and this is the fix for "the wind-up is invisible". The coil
 *  compresses the track the head is LAYING, and the body only shows it once it
 *  has flowed through — so at 0.4x cruise a one-second gather laid 2.3 units of
 *  compressed track under a 15-unit body and 85% of the snake was still lying in
 *  the old, uncompressed line. Nothing to see.
 *
 *  Near cruise speed the same second lays 4.7 units at a 2.2-unit wavelength —
 *  two full waves stacked right behind the head, which is what bunching looks
 *  like. It is also the truer picture: a snake about to strike does not freeze,
 *  it draws itself into an S while still creeping forward. */
const COIL_SLOW = 0.82;
/** Seconds of strike at MINIMUM charge, and the speed multiple it runs at.
 *
 *  The charge multiplies the DURATION, not the speed — a snake strikes at the
 *  speed a snake strikes at; what a longer gather buys is a longer reach. At
 *  0.35 x (0.55..1.0) a tap and a full charge landed within a body length of
 *  each other and the wind-up was not worth holding. */
const STRIKE_TIME = 0.26;
const STRIKE_SPEED = 3.0;
/** Duration multiplier at full charge. 0.26 -> 0.86 s, which at 3x cruise is a
 *  reach of about 15 world units against a tap's 4.5 — the difference between
 *  "a pounce" and "crossing the gap". */
const STRIKE_STRETCH = 3.3;
/** Fraction of the boost bar a strike costs. One bar, two spends: boost leases
 *  speed, the strike buys a moment — and every strike is escape fuel gone. */
const STRIKE_COST = 0.45;

// ── Bloom (涌泉) ─────────────────────────────────────────────────────────────
// The only skill here that refuses on land, and the refusal IS the design: it
// erupts the sea, so there has to be sea. See src/bloom.ts.
/** How far ahead of the head it lands, world units.
 *
 *  BOUNDED BY THE WATER SHEET, not by taste. The live sheet is a patch centred
 *  on the snake with a half-extent of 7.9 units (HALF 0.22 rad), so at the
 *  first value of 9 the crater was being written into a mesh that did not reach
 *  the target and could never have shown — the third time this exact shape of
 *  bug has appeared here (the Maelstrom's reach was smaller than its own
 *  footprint; the Ribbon's thrown body drained before it could land). Reach
 *  plus the crater's rim has to fit inside the patch: 4.5 + 3.25 = 7.75. */
const BLOOM_REACH = 4.5;
/** Seconds between casts. It costs no length and no boost — the cost is that
 *  you have to be over water and you have to wait. */
const BLOOM_COOLDOWN = 4.0;
/** Seconds between Sweep casts. */
const SWEEP_COOLDOWN = 3.0;
/** Extra reach 蛇灵 has beyond its own section, world units. Small on purpose:
 *  the skill's harvesting area is meant to be the SHAPE it draws, not a bubble
 *  around it, so a near miss reads as a near miss. */
const RIBBON_EAT = 1.1;
/** Radius of the thrown body's burst, world units. Wider than the stream is
 *  long is wrong — it has to read as the water that was in flight landing, not
 *  as a bomb — but it must clear more than one body width or throwing is
 *  strictly worse than sweeping. */
const RIBBON_BURST = 4.2;
// ── Ribbon (水鞭) ────────────────────────────────────────────────────────────
// Replaced the Maelstrom on E. Everything that skill needed — an orbit
// accumulator, a vortex centre read off the trail, a reach, a drag calibrated
// against the bots' turn rate — is gone with it, because the Ribbon needs none
// of it: it is driven from the head and the camera, and its constants live with
// it in src/waterribbon.ts.
const EAT_ANGLE = 0.09 * R_SCALE;   // angular distance to eat a pellet (rad)
const HIT_ANGLE = 0.05 * R_SCALE;   // angular distance to self-collide (rad)
const SELF_SKIP = 8;            // skip this many segments behind the head for self-hit
const START_LENGTH = 9;         // total segments (head + body) at start
// 4 gave a stub with barely any body to look at — the slither had nothing to
// run along and the creature read as a head on a nub.
const FOOD_COUNT = 6;           // pellets scattered on the planet at once

// — boost (Shift) —
const BOOST_MULT = 1.85;        // speed multiplier while boosting
/** Largest arc between two recorded trail points, held at a fixed WORLD length
 *  (0.09 units — a seventh of the body radius) so the slerped path reads as a
 *  curve rather than a chain of segments however fast the snake goes AND
 *  whatever the planet's radius is. Written as an angle because that is what
 *  the trail stores. */
const TRAIL_STEP = 0.09 / PLANET_R;
const BOOST_DURATION = 4;       // seconds of boost from a full bar (~10x the old 0.4s bar)
const BOOST_REFILL = 5;         // seconds to refill the bar from empty
const BOOST_COOLDOWN = 2.5;     // lockout seconds after the bar is fully drained

// — rival robot snakes —
// Each bot gets its OWN length so the planet feels populated by snakes of
// different sizes rather than clones. BOT_COUNT is derived from this list.
const BOT_LENS = [5, 7, 9, 6, 11];
const BOT_COUNT = BOT_LENS.length;
const BOT_MAX_LEN = Math.max(...BOT_LENS);
const BOT_SPEED = 0.46 * R_SCALE;         // bot angular speed (rad/s) at difficulty 0 — world linear speed kept constant
const BOT_TURN = 1.1;           // bot steering rate (rad/s) at difficulty 0 — radius-independent
const BOT_HIT_ANGLE = 0.06 * R_SCALE;     // angular distance for head-vs-body collision
const BOT_RESPAWN = 2.6;        // seconds a killed bot stays gone (at difficulty 0)
const BOT_KILL_SCORE = 50;      // points for reverse-killing a bot with your tail
const BOT_MAX_LEN_CAP = 24;     // bots keep growing when they eat, but stop here (perf + fairness)
const BOT_SELF_SKIP = 6;        // segments behind a bot's head ignored for its own-body collision
const BOT_EAT_ANGLE = 0.09 * R_SCALE;     // a bot eats a pellet within this angular distance (matches the player)
const BOT_AVOID_PAD = 0.10 * R_SCALE;     // extra angular berth a bot keeps around every hazard (steers EARLY, not at the last frame)
const BOT_LOOK_STEPS = 5;       // sub-steps simulated along each candidate heading during look-ahead path scan

// — dynamic difficulty (keeps the late game tense so growth never trivializes it) —
// A single 0..1 ramp derived from the score. It leaves the growth loop (bot
// drops feeding the player) fully intact but makes the WORLD meaner in step, so
// the stronger you get the harder the bots push back — an attack/defend tug of
// war instead of a runaway snowball.
const DIFFICULTY_FULL = 820;    // score at which difficulty hits its ceiling (Lv.5)
const BOT_SPEED_RAMP = 0.62;    // bot speed multiplier grows up to 1 + this (0.46 → ~0.75, above player cruise)
const BOT_TURN_RAMP = 0.55;     // bot steering grows up to 1 + this (more agile chasing)
const BOT_AGGRO_MAX = 0.9;      // at full difficulty, up to 90% of a bot's wander cycles become active hunts
const BOT_RESPAWN_CUT = 0.55;   // respawn delay shrinks up to this fraction (2.6s → ~1.17s)

// — pellets dropped by a slain bot (so killing a bot feeds the player) —
const DROP_R = 0.3;            // dropped-pellet radius (smaller than a normal pellet)
const DROP_SCORE = 5;          // points per dropped pellet eaten
const DROP_EVERY = 2;          // one drop per this many segments of the dead bot

// — surface terrain collision —
const TERRAIN_DEATH = '🪨 撞到地形啦~';

// A trail sample: unit position on the sphere + the cumulative arc length the
// head had travelled when it was recorded.
interface TrailPt { p: V3; s: number }

// Sample a trail (newest sample at index 0) at a target arc length, interpolating
// along the great circle between the two bracketing samples. `fallback` is
// returned when the trail is empty. Shared by the player snake and the bots.
function sampleTrailArr(tr: TrailPt[], fallback: V3, targetS: number): V3 {
  if (tr.length === 0) return fallback;
  if (targetS >= tr[0]!.s) return tr[0]!.p;
  for (let j = 0; j < tr.length - 1; j++) {
    const a = tr[j]!, b = tr[j + 1]!;
    if (a.s >= targetS && targetS >= b.s) {
      const span = a.s - b.s;
      const t = span > 1e-6 ? (targetS - b.s) / span : 0;
      return slerp(b.p, a.p, t);
    }
  }
  return tr[tr.length - 1]!.p;
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const query = new URLSearchParams(location.search);
  const debugEnabled = import.meta.env.DEV || query.get('debug') === '1';

  // ── render scale ─────────────────────────────────────────────────────────
  //
  // ForgeaX sizes the drawing buffer as `clientWidth * devicePixelRatio` every
  // frame (create-app.ts `syncCanvasDrawingBuffer`, wired as an Update system)
  // and caps nothing, so a retina window asks for 3840x1984 = 7.6 megapixels.
  // THIS GAME CANNOT AFFORD THAT. The terrain fragment shader runs a 4-octave
  // fbm -- 32 hash calls -- and blends five regions, so its cost tracks pixel
  // count almost exactly. Measured in Chrome at native DPR: 45.7 ms a frame, of
  // which the game's own update loop is 1.7 ms. The other 96% is this shader.
  //
  // Capping `devicePixelRatio` is the whole lever, and the override is
  // deliberate rather than a canvas resize. Writing a size onto the canvas is
  // pointless -- the engine re-derives it from layout on the very next frame --
  // and CSS-shrinking the element plus scaling it back up drags the HUD and the
  // pointer mapping along with it. Overriding the ratio changes ONE input to a
  // calculation the engine already owns, and leaves layout, input and the HUD
  // exactly where they were.
  //
  // This is what makes the game run on a STOCK engine: it replaces the fork's
  // `?rs=` edit to create-app.ts, which upstream does not carry. Same spelling,
  // same meaning (a cap, not a multiplier), so `?rs=1` still does what it did.
  // `?rs=2` (or whatever the display reports) opts back into native resolution.
  const rsRequested = Number(query.get('rs'));
  const renderScaleCap = Number.isFinite(rsRequested) && rsRequested > 0 ? rsRequested : 1;
  const nativeDpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const cappedDpr = Math.min(nativeDpr, renderScaleCap);
  if (cappedDpr < nativeDpr) {
    const previousDprDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
    const cappedDprGetter = () => cappedDpr;
    try {
      Object.defineProperty(globalThis, 'devicePixelRatio', {
        configurable: true,
        get: cappedDprGetter,
      });
      ctx?.registerCleanup?.(() => {
        const current = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
        if (current?.get !== cappedDprGetter) return;
        if (previousDprDescriptor !== undefined) {
          Object.defineProperty(globalThis, 'devicePixelRatio', previousDprDescriptor);
        } else {
          Reflect.deleteProperty(globalThis, 'devicePixelRatio');
        }
      });
      console.info(
        `[planet-snake] render scale capped at ${cappedDpr}x (display reports ${nativeDpr}x); `
        + `?rs=${nativeDpr} renders at native resolution`,
      );
    } catch (error) {
      console.warn(
        '[planet-snake] devicePixelRatio is not overridable here — rendering at native resolution',
        error,
      );
    }
  }

  // ── deterministic mode ───────────────────────────────────────────────────
  // Every before/after comparison in this project has to hold the world still,
  // and freezing the camera is not enough: the PCG decoration, the pellet
  // placement and the bot spawns all draw from Math.random, so two reloads of
  // the SAME build measured frame means of 95.2 and 48.3. Any A/B run without
  // this is measuring world variation, not the change under test.
  //
  // `?seed=N` swaps Math.random for a seeded PRNG (mulberry32) for the whole
  // page. It has to be installed before any scatter runs, hence the position at
  // the very top of bootstrap.
  const seedParam = query.get('seed');
  if (seedParam !== null) {
    const previousRandom = Math.random;
    let t = (Number(seedParam) >>> 0) || 1;
    const seededRandom = () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    Math.random = seededRandom;
    ctx?.registerCleanup?.(() => {
      if (Math.random === seededRandom) Math.random = previousRandom;
    });
    console.log(`[planet-snake] deterministic mode, seed ${seedParam}`);
  }

  // Grafted shaders must exist before ANY material is built — every
  // Materials.standard call below is routed through withShader.
  const ATMOS_R = PLANET_R + 2.6;    // 7.4 scale heights at H_R = 0.35
  const SUN_INTENSITY = 7;
  const bridgeVerification = verifyEngineBridge(ctx?.renderer);
  console.info('[planet-snake] ForgeaX engine bridge:', bridgeVerification);
  // `?nograft=1` 跳过全部着色器嫁接，材质回落引擎原版 PBR（withShader 传
  // undefined 就是原样返回）。用于隔离"画面坏是嫁接的着色器还是更底层"。
  //
  // 这个开关原先照常调用 installGrafts，只是把返回的句柄丢掉——于是它作为隔离
  // 手段是**无效的**：11 个嫁接变体（每个 72–94 KB WGSL）照样被创建和编译，所以
  // 任何发生在**编译**阶段的故障都能穿过这个开关，看起来像是别处的问题。
  // 2026-08-20 实测代价：Safari 上开着这个开关渲染出原版 PBR 的白色星球、却依旧
  // 丢 GPU 设备，被读成"跟我们的着色器无关"，而事实是它们的编译从未被跳过。
  // 现在是真跳过 —— 不安装、不编译。
  const noGraft = new URLSearchParams(location.search).has('nograft');
  if (noGraft) {
    console.warn('[planet-snake] ?nograft — 跳过全部着色器嫁接（不安装、不编译），材质走引擎原版 PBR');
  }
  const grafts = noGraft
    ? ({} as ReturnType<typeof installGrafts>)
    : installGrafts(ctx?.renderer, {
      sunDir: SUN_DIR, planetRadius: PLANET_R, atmosRadius: ATMOS_R, sunIntensity: SUN_INTENSITY,
    });
  const terrainShader = grafts.terrain;
  const propShader = grafts.prop;
  const fleshShader = grafts.flesh;
  const surfaceShader = grafts.surface;
  const bodyShader = grafts.body;
  const waterShader = grafts.water;
  const sprayShader = grafts.spray;

  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  /** Live view aspect, read at every use rather than captured once.
   *
   *  ForgeaX owns the backing size and `?rs=` policy. The game only consumes
   *  the host's current result so the space pass reconstructs rays with the
   *  same aspect as the camera. */
  const viewAspect = () => canvas.width / canvas.height || 1;

  // Built at the SPHERE'S OWN resolution, then used by both the displacement
  // and every placement query — see the note in surface.ts. 257x169 floats.
  const heightLattice = buildHeightLattice(SURF_WS, SURF_HS);
  /** What the skills have dug. See src/deform.ts. */
  const deformStore: DeformStore = createDeformStore(PLANET_R, SURF_WS, SURF_HS);
  /** Terrain height as the MESH renders it. Never call terrainHeight directly
   *  for placement: the analytic field sits above the drawn triangles. */
  // The dug delta IS the ground. Everything that stands on the terrain reads
  // this — the body's ride height, the props, the water's coastline — so a
  // snake crossing a channel dips INTO it rather than gliding over a hole in
  // its own render.
  const terrainHeight = (d: V3): number => latticeHeight(heightLattice, d) + deformStore.at(d);

  /** Planet radius at a direction, including the displaced terrain. Every
   *  placement goes through this: the surface is real geometry now. */
  // +0.05 matches the displaced sphere's base radius — without it everything
  // placed by gr() sat one coat of paint below the actual ground.
  const gr = (d: V3, above: number): number => PLANET_R + 0.05 + terrainHeight(d) + above;

  /** Ground slope at a direction: world units of height per unit of run,
   *  worst of eight compass directions. What prop placement gates on. */
  const slopeAt = makeSlopeAt(heightLattice, (d) => deformStore.at(d));

  // small shared-ref helpers
  const mat = (m: MaterialAsset) => world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', m);
  const sphereMesh = (r: number, ws = 18, hs = 14) => {
    const res = createSphereGeometry(r, ws, hs);
    return res.ok ? world.allocSharedRef('MeshAsset', res.value) : 0;
  };

  // defaultScene is instantiated by Play. Loading it again at runtime is what
  // caused asset-not-imported in the shipped preview.
  // The land field lives in src/surface.ts because the FRAGMENT SHADER needs it
  // too, and the WGSL is emitted from those same constants. Importing it here
  // rather than keeping a second copy is what guarantees the snake can never
  // swim through something the shader painted as land.
  // Gate on the WARPED field — the one the shader paints the coast with.
  // Raw landField put props on painted water near every wandering shoreline.
  const isLand = (p: V3) => warpedField(p) > 0;
  /** 1 over open water, 0 inland, blended across the shoreline so nothing
   *  snaps as the snake crosses a beach. */
  const wetness = (p: V3): number => {
    const t = Math.min(1, Math.max(0, (warpedField(p) + 0.02) / 0.04));
    return 1 - t * t * (3 - 2 * t);
  };
  // Night-side floor. The Skylight is a world-space IBL built for a ground
  // observer: on a planet seen from outside, half the surface normals point at
  // the environment map's lower hemisphere and collect almost nothing, so the
  // dark side crushes to pure black. Measured, our night side was 24.4% pure
  // black with P5 = 0 while the reference (f02) is 0.5% and P5 = 11. Raising
  // Skylight 13x moved the LIT side only and left P5 at 0 — proof the ambient
  // never reaches there. A small emissive tinted by the albedo restores the
  // floor while keeping each surface's own hue instead of washing it grey.
  // the reference's subsurface shading, grafted onto the engine's composed standard
  // PBR source. See src/terrain-material.ts for why it is a runtime graft and
  // not a .wgsl file.

  // ONE sphere. Biome, water depth, beach, foam, ice and relief are all decided
  // per pixel by the grafted surface shader, so the shoreline is exact at pixel
  // resolution instead of being a polygon edge — which is what the five stacked
  // masked shells this replaces could never be. Tessellation now only has to
  // serve the SILHOUETTE, not the coastline.
  const surfaceMat = mat(withShader(Materials.standard({
    baseColor: [1, 1, 1, 1], metallic: 0, roughness: .8,
  }), surfaceShader));
  // Built HERE, not by the engine factory. The factory's parameterisation is
  // unknown to this game, so a height query could only ever approximate the
  // triangles it drew — measured, props hovered up to 0.27 world units over
  // land while sitting perfectly on water (where the field is identically zero
  // and interpolation is exact). Owning the mesh makes latticeHeight() return
  // the drawn surface, so geometry and placement cannot disagree.
  const surf = buildSurfaceMesh(heightLattice, PLANET_R + 0.05);
  const surfaceMeshAsset = meshFromInterleaved(surf.verts, surf.indices);
  const surfaceMeshHandle = world.allocSharedRef('MeshAsset', surfaceMeshAsset) as number;
  {
    // Cull bound: the mesh's own AABB, grown by the tallest displacement.
    const R = PLANET_R + 0.05 + 1.4;
    (surfaceMeshAsset as { aabb?: Float32Array }).aabb = new Float32Array([-R, -R, -R, R, R, R]);
  }
  world.spawn(
    { component: Transform, data: {} },
    { component: MeshFilter, data: { assetHandle: surfaceMeshHandle } },
    { component: MeshRenderer, data: { materials: [surfaceMat] } },
  );

  // ── ocean ────────────────────────────────────────────────────────────────
  // The ocean is the scene pack's planet sphere. Its material is authored in
  // scene.pack.json and uploaded before bootstrap runs, so it cannot be routed
  // through withShader at construction like the code-built shells.
  //
  // Swapping the entity's MeshRenderer was tried and does not work: SceneInstance
  // `mapping` holds localIds ([0,1,2,3] here), not entity handles.
  //
  // What does work is that a material pass carries the module as a plain STRING
  // and the pipeline is built lazily at first draw — which happens after
  // bootstrap. So the pack can name the grafted shader directly and the
  // registration performed above resolves it in time. See assets/scene.pack.json.

  // ── surface decoration (PCG — Play only, not in ✎ Edit) ──────────────────
  // Scatter rocks, trees, bushes and mushrooms over the planet so it
  // reads as a MODELLED world rather than a bare ball. Every decoration also
  // records a COLLISION VOLUME (a unit direction + a cos-threshold): the player
  // dies on ramming any of them, so the terrain is a real obstacle course.
  //
  // The shapes are modelled now, not procedural. What used to stand here was a
  // hash-displaced sphere for a rock and three stacked cones for a tree, and
  // stacked cones read as a traffic marker however they are tuned — a conifer's
  // silhouette is its branch notches, which a cone has none of. See src/props.ts.
  // Every prop material runs on the PROP graft, not the terrain one. See the
  // note beside it in terrain-material.ts: the terrain variant's additive terms
  // push a small object into the tonemap's compressed region and everything
  // came out pastel. Authored saturation only survives on the quieter variant.
  // The moving water sheet under and around the snake — real geometry, real
  // normals, so the sun's reflection finally happens in HDR before the tonemap.
  // Base radius matches the painted water exactly (the displaced sphere's base,
  // PLANET_R + 0.05); the patch floats HOVER above it. See src/water-patch.ts.
  // castShadow FALSE, and it is not an optimisation. Left on, the sheet renders
  // into the shadow map through the STOCK module — which knows nothing about
  // the water variant's land discard — and then shadows the painted water 3cm
  // beneath it. That showed up as flat grey POLYGONS drifting over the sea, at
  // the shadow map's resolution over the patch's own triangles; isolated by
  // capturing ?nofx=1 against ?nofx=1&nospace=1&nowater=1, where they vanished.
  // A water surface should not cast a shadow onto itself.
  const waterMat = mat(withShader(Materials.standard({
    baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.8, castShadow: false,
  }), waterShader));
  // Dynamic lights for the skills. Every material here is a graft of the stock
  // PBR shader, so the engine's own point-light loop lights all of them at once
  // — see src/skill-lights.ts for why this is host-side bookkeeping only.
  // Dynamic lights for the skills. Every material here is a graft of the stock
  // PBR shader, so the engine's own point-light loop lights all of them at once
  // — measured: one declared light lifts the frame mean by 30 and visibly pools
  // on the water, the body and the wake foam together. See src/skill-lights.ts.
  const skillLights = installSkillLights(world, { Transform, PointLight });

  const waterPatch: WaterPatch | undefined = createWaterPatch(
    world, ctx?.renderer, waterMat, PLANET_R + 0.05,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved);

  const rockMat = mat(withShader(Materials.standard({ baseColor: [0.62, 0.53, 0.38, 1], metallic: 0.05, roughness: 0.95 }), propShader));
  const rockDarkMat = mat(withShader(Materials.standard({ baseColor: [0.46, 0.39, 0.28, 1], metallic: 0.05, roughness: 1 }), propShader));
  const trunkMat = mat(withShader(Materials.standard({ baseColor: [0.30, 0.22, 0.15, 1], metallic: 0, roughness: 0.9 }), propShader));
  const leafMat = mat(withShader(Materials.standard({ baseColor: [0.16, 0.28, 0.12, 1], metallic: 0, roughness: 0.7 }), propShader));
  const leafDarkMat = mat(withShader(Materials.standard({ baseColor: [0.11, 0.20, 0.085, 1], metallic: 0, roughness: 0.75 }), propShader));
  // Kenney's rocks carry a grass cap and a few pale chips as their own
  // primitives; both get their own material rather than being flattened into
  // the boulder colour, because that separation is most of what makes the model
  // read as more than a grey lump.
  const capMat = mat(withShader(Materials.standard({ baseColor: [0.20, 0.30, 0.12, 1], metallic: 0, roughness: 0.85 }), propShader));
  const paleMat = mat(withShader(Materials.standard({ baseColor: [0.68, 0.62, 0.50, 1], metallic: 0.05, roughness: 0.85 }), propShader));
  const stoneMat = mat(withShader(Materials.standard({ baseColor: [0.60, 0.545, 0.44, 1], metallic: 0.05, roughness: 0.9 }), propShader));
  const capRedMat = mat(withShader(Materials.standard({ baseColor: [0.60, 0.09, 0.08, 1], metallic: 0, roughness: 0.6 }), propShader));


  interface SeatedProp { ents: number[]; n: V3; above: number; delta: number }
  // Collision volumes for the terrain (unit dir + cos of the kill half-angle).
  interface Obstacle { dir: V3; hitCos: number; seated: SeatedProp }
  const obstacles: Obstacle[] = [];
  const clearedGateObstacles = new Set<Obstacle>();
  const pushObstacle = (dir: V3, worldRadius: number, seated: SeatedProp) => {
    // convert a world-space footprint radius (+ the head radius) into an angular
    // threshold on the unit sphere. The floor stays in world units so changing
    // the planet radius cannot silently inflate every small obstacle.
    const ang = Math.max(MIN_HIT_WORLD, worldRadius + HEAD_R * 0.6) / PLANET_R;
    obstacles.push({ dir: norm(dir), hitCos: Math.cos(ang), seated });
  };

  const spawnOnSurface = (dir: V3, distAbove: number, meshHandle: number, matHandle: number, sc: V3, upright: boolean) => {
    if (!meshHandle) return;
    const n = norm(dir);
    world.spawn(
      { component: Transform, data: { pos: scl(n, gr(n, distAbove)), quat: upright ? quatFromY(n) : [0, 0, 0, 1], scale: sc } },
      { component: MeshFilter, data: { assetHandle: meshHandle } },
      { component: MeshRenderer, data: { materials: [matHandle] } },
    );
  };

  // ── modelled props ───────────────────────────────────────────────────────
  // Declared here rather than beside the rest of the gate code because the
  // MESH has to be built bent, and that happens at load.
  const GATE_SIZE = 15;
  /** Lateral spread. The model is a tall slab; the doorway has to be something
   *  a snake aims at, not a slot. */
  const GATE_WIDE = 1.45;
  /** Sunk as a fraction of the model's height, like every other prop's `bed`. */
  const GATE_BED = 0.055;
  /** Angular radius of the doorway, derived from the model so the pass test
   *  and the picture stay in step when the gate is resized. */
  const GATE_ENTER_ANG = (GATE_SIZE * GATE_WIDE * 0.22) / PLANET_R;

  const props = loadProps(world, meshFromInterleaved, {
    // The gate is 22 world units across — a quarter of a radian of arc. Built
    // flat it stood on its middle with its outer feet in the air; bent, it
    // sits on the planet the way a real arch on a small world would.
    gate_dark: { R: PLANET_R, sx: GATE_SIZE * GATE_WIDE, sy: GATE_SIZE },
  });

  // Role -> material. The roles come from the kit's own material names, so
  // `dirt` (a boulder's body) and `bark` (a trunk) are already separated —
  // which colour could not do, since the kit paints both the identical brown.
  const PROP_MATS: Record<PropRole, number> = {
    dirt: rockMat, stone: stoneMat, grass: capMat,
    leaf: leafMat, bark: trunkMat, red: capRedMat, pale: paleMat,
  };
  // A second table so a scattering of props does not come out all one shade.
  const PROP_MATS_DARK: Record<PropRole, number> = {
    ...PROP_MATS, dirt: rockDarkMat, leaf: leafDarkMat,
  };

  // `?noprops=1` scatters but plants nothing — same isolation trick as
  // `?nograss=1`, and it keeps the RNG stream identical so everything else in
  // the deterministic scene stays put.
  const propsOff = new URLSearchParams(location.search).has('noprops');


  /** What was planted where, so a capture can be aimed at a category instead of
   *  hunting for one in a wide shot. Same reason __ps.bots() exists. */
  const planted: { name: string; dir: V3; size: number }[] = [];

  /**
   * Plant a model. `size` is its LARGEST world dimension — height for a tree,
   * width for a flat boulder — because the bake normalises on the largest
   * extent, so one number reads the same way for every shape.
   *
   * The entity origin is the model's footing (base at y=0), so placement is
   * just the ground radius; `bed` then sinks it by a fraction of its own
   * HEIGHT. Boulders need a real fraction of it, not a token: the kit's rocks
   * carry a bevelled skirt at the base whose facets face down and away from the
   * sun, so a rock set exactly tangent to the ground shows a dark rim right
   * round its lower edge and reads as a sticker laid on the surface. (The rim
   * is NOT a see-through underside — the meshes are watertight, 0 border edges;
   * it is honest shading of a real bevel, and bedding is what hides it.)
   */
  /** Props whose feet must track the ground: entity handles + the numbers to
   *  recompute their position when the deform store changes under them. */
  const seated: SeatedProp[] = [];

  const spawnProp = (name: PropName, dir: V3, size: number, dark: boolean, bed: number, wide = 1) => {
    const n = norm(dir);
    planted.push({ name, dir: n, size });
    if (propsOff) return;
    const model = props[name];
    // SLOPE-AWARE BED. A fixed fraction of the model's height is right on flat
    // ground and wrong on a hillside: the terrain drops by footprint * slope
    // across the model's own base, so the downhill edge hangs in the air —
    // and the steepest planted pine sat on a 0.95 slope with its whole base
    // exposed. Sink by enough of that drop to keep the downhill edge grounded,
    // capped so the uphill side does not eat the trunk.
    const extra = Math.min(slopeAt(n) * model.footprint * size * 0.55, size * 0.20);
    const above = -(model.top * size * bed) - extra;
    const pos = scl(n, gr(n, above));
    const quat = quatFromYSpin(n, Math.random() * Math.PI * 2);
    const scale: V3 = [size * wide, size, size * wide];
    const mats = dark ? PROP_MATS_DARK : PROP_MATS;
    const ents: number[] = [];
    for (const prim of model.prims) {
      // .unwrap(), and this was a real defect: world.spawn returns a Result,
      // so the cast was a lie and every world.set on these handles below was a
      // silent no-op. The "props follow dug ground" feature never moved a
      // single prop — the check that passed it only counted bookkeeping.
      ents.push(world.spawn(
        { component: Transform, data: { pos, quat, scale } },
        { component: MeshFilter, data: { assetHandle: prim.mesh } },
        { component: MeshRenderer, data: { materials: [mats[prim.role]] } },
        { component: Visibility, data: { state: VisibilityStateValue.inherited } },
      ).unwrap() as unknown as number);
    }
    const seat: SeatedProp = { ents, n, above, delta: 0 };
    seated.push(seat);
    // Only things big enough to read as an OBSTACLE get a collision volume.
    // A mushroom cluster or a knee-high bush that kills on contact is a bug the
    // player experiences as an invisible wall, because at that size the thing
    // you hit is not visually distinguishable from ground cover. The test is on
    // the model's own size rather than its footprint: a tall pine is thin, and
    // a footprint threshold would wave the player straight through it.
    if (size < MIN_HIT_SIZE) return;
    // Use the horizontal extent at snake height, not the whole silhouette. A
    // rock is widest near the ground so this remains close to its visible
    // boundary; a tree crown is overhead and must not kill a snake that is
    // still visibly clear of the trunk. The head padding lives in
    // pushObstacle, so footLow describes the prop itself rather than baking the
    // snake radius into every model.
    pushObstacle(n, model.footLow * size * wide * HIT_SCALE, seat);
  };

  const clearGateLanding = (gateDir: V3) => {
    const gateHalfWidth = GATE_SIZE * GATE_WIDE * 0.5;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obstacle = obstacles[i]!;
      const obstacleRadius = Math.acos(Math.max(-1, Math.min(1, obstacle.hitCos))) * PLANET_R;
      const clearAngle = Math.min(Math.PI, (gateHalfWidth + obstacleRadius) / PLANET_R);
      if (dot(gateDir, obstacle.dir) <= Math.cos(clearAngle)) continue;
      obstacles.splice(i, 1);
      clearedGateObstacles.add(obstacle);
      for (const e of obstacle.seated.ents) {
        world.set(e, Visibility, { state: VisibilityStateValue.hidden }).unwrap();
      }
    }
  };

  const restoreGateLanding = () => {
    for (const obstacle of clearedGateObstacles) {
      obstacles.push(obstacle);
      for (const e of obstacle.seated.ents) {
        world.set(e, Visibility, { state: VisibilityStateValue.inherited }).unwrap();
      }
    }
    clearedGateObstacles.clear();
  };

  // `?plan=baseline` 加载 WorldClaw 生成器上线前那份手调方案。存在的理由很实际：
  // 两份方案的区别是"空地上有没有东西"，不摆在一起看基本看不出来，而截图对比又
  // 换不了视角。同一个 URL 加一个参数就能来回切，是唯一能自己判断的办法。
  // 地形、seed、其余一切都不变，变的只有 BiomePlan。
  const usingBaselinePlan = new URLSearchParams(location.search).get('plan') === 'baseline';
  const [
    { scatterClusters },
    { auditPlacements, auditRegions },
    { mulberry32 },
    { sphereDomain },
    planModule,
    { regionAt, argmaxRegionOrOcean },
    { OBJECT_PLAN },
  ] = await Promise.all([
    import('./src/worldgen/core/scatter'),
    import('./src/worldgen/core/audit'),
    import('./src/worldgen/core/rng'),
    import('./src/worldgen/domains/sphere'),
    usingBaselinePlan ? import('./src/biome-plan.baseline') : import('./src/biome-plan'),
    import('./src/regions'),
    import('./src/object-plan'),
  ]);
  const plan = 'BIOME_PLAN' in planModule ? planModule.BIOME_PLAN : planModule.BASELINE_PLAN;

  const effectiveSeed = seedParam !== null
    ? ((Number(seedParam) >>> 0) ^ plan.seed)
    : ((Math.random() * 2 ** 32) >>> 0);

  // 出生地。以前写死在 +Z，而且这一个事实在仓库里有三份拷贝：resetGame 的 pos、
  // 道具 gate 的无障碍区、以及 bot 重生时"离玩家远点"的判据。三份都写着 [0,0,1]，
  // 改一处不改另两处，开局就会站在石头里或者被 bot 贴脸。所以这里选一次，另外
  // 两处都从它导出。
  //
  // 出生点的挑法住在 src/scatter-rules.ts —— 它决定 gate 的无障碍区，也就决定散布
  // 结果，headless dry-run 要复现游戏必须用同一份。
  const spawnDir = pickSpawn(slopeAt, mulberry32(effectiveSeed ^ 0x5aed));
  // 出生朝向：切平面上任取一个方向即可，蛇一开始就在动。
  const spawnTan = norm(cross(spawnDir, Math.abs(spawnDir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));

  const gate = makeGate(slopeAt, spawnDir);

  const domain = sphereDomain(PLANET_R);
  const placements = scatterClusters(
    domain, regionAt, plan, gate, footRadiusWorld, mulberry32(effectiveSeed),
  );
  // spawnProp uses Math.random only for visual spin. Keep that randomness local
  // too, so an unseeded scatter consumes the shared scene stream exactly once.
  const sceneRandom = Math.random;
  Math.random = mulberry32(effectiveSeed ^ 0x51a7e);
  try {
    for (const placement of placements) {
      const name = placement.prop as PropName;
      const spec = PROP_TABLE[name as keyof typeof PROP_TABLE];
      if (spec === undefined) throw new Error(`[planet-snake] unknown scatter prop: ${placement.prop}`);
      spawnProp(
        name,
        placement.p,
        spec.lo + placement.sizeU * (spec.hi - spec.lo),
        placement.dark,
        spec.bed,
        spec.wide,
      );
    }
    // WorldClaw Stage 3 的地标：照解出来的位置摆，不走散布。这些坐标是构图图里
    // 每个物体接触点的射线与地形的交点，重新散布等于把这一级的信息全丢掉。
    // 用 size 的绝对值而不是 sizeU 插值，同理——尺度也是解出来的。
    for (const planned of OBJECT_PLAN) {
      const name = planned.prop as PropName;
      const spec = PROP_TABLE[name as keyof typeof PROP_TABLE];
      if (spec === undefined) throw new Error(`[planet-snake] unknown landmark prop: ${planned.prop}`);
      spawnProp(name, norm(planned.dir), planned.size, false, spec.bed, spec.wide);
    }
  } finally {
    Math.random = sceneRandom;
  }

  // `auditRegions` owns generic weighted-field accounting. The game classifier
  // remains the sole authority for ocean/biome assignment: convert its answer to
  // one-hot weights rather than copying its ocean and tie-breaking rules here.
  const auditedRegionAt = (p: V3): Record<string, number> => {
    const selected = argmaxRegionOrOcean(p);
    return {
      ocean: selected === 'ocean' ? 1 : 0,
      grassland: selected === 'grassland' ? 1 : 0,
      dry: selected === 'dry' ? 1 : 0,
      highland: selected === 'highland' ? 1 : 0,
      beach: selected === 'beach' ? 1 : 0,
      iceCap: selected === 'iceCap' ? 1 : 0,
    };
  };
  const regionAudit = auditRegions(
    domain, auditedRegionAt, 200_000, mulberry32(effectiveSeed ^ 0xa11d17),
  );
  const placementAudit = auditPlacements(domain, placements, footRadiusWorld);
  const countKind = (kind: string): number => placements.reduce(
    (count, placement) => count + (placement.kind === kind ? 1 : 0), 0,
  );
  const ce = (kind: string): string => {
    const value = placementAudit.clarkEvans[kind];
    return typeof value === 'number' ? value.toFixed(3) : (value ?? 'n/a');
  };
  const pct = (region: string): string => (100 * (regionAudit.areaFraction[region] ?? 0)).toFixed(3);

  {
    // How much of the sphere the hitboxes actually claim. Printed rather than
    // asserted because it is a DESIGN number: too low and the planet is an
    // empty ball, too high and the snake cannot get anywhere. Having it on the
    // console is what makes MIN_HIT_SIZE / HIT_SCALE tunable instead of guessed.
    const sr = obstacles.reduce((a, o) => a + 2 * Math.PI * (1 - o.hitCos), 0);
    console.log(
      `[planet-snake] props: ${planted.length} placed, ${obstacles.length} solid, ` +
      `hitboxes cover ${(100 * sr / (4 * Math.PI)).toFixed(1)}% of the sphere` +
      (usingBaselinePlan ? '  [plan=baseline 旧方案]' : ''),
    );
    console.log(
      `[planet-snake] regions: ocean ${pct('ocean')}%  grassland ${pct('grassland')}%  ` +
      `dry ${pct('dry')}%  highland ${pct('highland')}%  beach ${pct('beach')}%  ` +
      `iceCap ${pct('iceCap')}%  (n=${regionAudit.n}, argmax)`,
    );
    const kinds = Object.keys(placementAudit.clarkEvans).sort();
    const clusterStats = kinds.map(
      (kind) => `${kind} CE=${ce(kind)} (n=${countKind(kind)})`,
    ).join('  ');
    console.log(
      `[planet-snake] clusters: ${clusterStats}  ` +
      `spacingViolations=${placementAudit.spacingViolations}`,
    );
  }
  queueMicrotask(() => {
    if (!debugEnabled) return;
    const ps = (window as unknown as Record<string, unknown>).__ps;
    if (ps && typeof ps === 'object') {
      (ps as Record<string, unknown>).regions = () => regionAudit;
    }
  });

  // ── grass fringe ─────────────────────────────────────────────────────────
  // The single most-present element in the reference: all 10 frames have blades
  // breaking the silhouette. Instanced through the default PBR shader, which
  // already consumes per-instance transforms (default-standard-pbr.wgsl:268-277),
  // so this needs no custom material.
  //
  // Colour comes from the measurement, not from taste: lit blades sample
  // (161,177,103) against ground (77,84,49) — 2.2x brighter and markedly
  // yellower. Reusing the ground green would make the fringe vanish.
  // Colour: the first pass used a muted olive and the blades disappeared into
  // the ground. Side-by-side, the reference fringe is a vivid chartreuse that
  // reads as a distinctly different material from the turf under it — the
  // contrast is the point, not the hue on its own.
  // RE-TINTED WITH THE GROUND (2026-08-06). [0.66, 0.61, 0.31] was matched to
  // the old khaki terrain; this session moved the land's hue from 51 to 72
  // degrees and the blades stayed yellow — measured after: blades hue 54 /
  // sat 0.28 / lum 177 against land 66 / 0.49 / 104, i.e. pale needles again,
  // the exact "亮光点点" complaint. The reference's own fringe relation is:
  // SAME hue and saturation as the ground, ~2.1x its brightness (lit blades
  // 161,177,103 vs ground 77,84,49 — both sat 0.42). So the blade albedo now
  // carries the grass biome's G/R (1.30) at roughly double the value.
  // Pulled TOWARD the sand it stands in. Measured, the grass was 19% of the
  // whole frame's high-frequency energy (hi-freq 1.83 with it, 1.48 without) —
  // thousands of thin blades each carrying full contrast against the ground is
  // a large part of "too much noise, tiring to look at". Lowering the contrast
  // rather than deleting blades keeps the fringe on the silhouette, which is
  // what it is there for, and stops it peppering every flat sand surface.
  const grassMat = mat(withShader(Materials.standard({
    // Roughness 1: no specular lobe at all. On a quad this thin every pixel is
    // a grazing pixel, so any specular at all is a white edge on every blade.
    // Lifted toward the sand it stands in — again, and this time far enough.
    // At 0.40/0.375/0.155 the blades sat well under the ground's value in every
    // frame and read as grey shards rather than as a fringe; a blade is a small
    // thing on a big surface and value difference is the only thing the eye has
    // to go on at this distance.
    baseColor: [0.53, 0.61, 0.20, 1], metallic: 0, roughness: 1.0,
    emissive: [0.28 * 0.012, 0.40 * 0.012, 0.09 * 0.012], emissiveIntensity: 1,
  }), grafts.grass ?? terrainShader));
  // Sparser than the first attempt. 16k read as a dense fur mat; the reference
  // has readable gaps between individual blades, and the silhouette spikes are
  // separated rather than continuous.
  const grassPatches = installGrass(world, grassMat, {
    planetRadius: PLANET_R + 0.06,
    // DENSITY IS PER AREA, and this number is not. It was tuned at PLANET_R 36;
    // the planet is now 52, which is 2.1x the surface, so the same 6400 blades
    // halved the density and the fringe came apart into isolated shards. 13300
    // restores what 6400 was.
    count: 13300,
    keep: isLand,
    // Blades follow the displaced terrain. The lift was suspected of causing the
    // intermittent saturated limb speckle and was measured both ways; see the
    // note in STATE.md — it is NOT the cause (the artefact reproduces with the
    // lift off, and with the grass on the stock material), so the lift stays
    // because without it the blades float over every hill.
    heightAt: (d) => terrainHeight(d),
    // `?nograss=1` gives the grass-free half of the A/B. See GrassOptions.spawn.
    spawn: !new URLSearchParams(location.search).has('nograss'),
  }, { Transform, MeshFilter, MeshRenderer, Instances }, meshFromInterleaved);

  // ── camera ──────────────────────────────────────────────────────────────
  /** Vertical FOV at cruise. */
  const CAM_FOV_BASE = Math.PI / 3;
  /** Peak camera bank, radians. the reference measured ~6.5 deg at full carve. */
  const CAM_ROLL_MAX = 0.113;
  const camera = world.spawn(
    { component: Transform, data: { pos: [0, 0, PLANET_R + 8] } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: CAM_FOV_BASE, aspect: viewAspect(), near: 0.1, far: 400 }),
        // Khronos PBR Neutral at 1.0, NOT AgX at 0.13.
        //
        // AgX was chosen on the arithmetic — sunlit terrain reads 1.2-1.6 HDR,
        // so 0.13 lands the midtones on the curve's 0.18 working grey — and the
        // arithmetic was right. The picture was not: AgX desaturates by design,
        // and a planet whose whole palette is pale grass, sand and shallow water
        // has nothing left to give up. It came out milky. That was the standing
        // complaint ("this version is too white"), and no exposure fixes it,
        // because the flatness is the curve's character, not its level.
        //
        // Neutral keeps the chroma and only rolls off the highlights, so the
        // grass stays green and the sea stays teal while the sun glint still
        // stops short of clipping. Measured against the alternatives on one
        // frozen frame: ACES and Neutral at 0.20 both crush the shadows into a
        // dusk shot; untonemapped at 1.0 looks right but hard-clips the water
        // glint AND takes the engine's zero-overhead path, which would silently
        // drop the film grain and vignette with it.
        tonemap: TONEMAP_NEUTRAL, exposure: 1.0, antialias: ANTIALIAS_FXAA,
        // Bloom RE-ENABLED 2026-08-02. It had been off since 2026-07-17 on the
        // theory that it caused blocky RGB corruption across the skybox. That
        // theory is dead twice over: the corruption reproduces with bloom off on
        // every tonemap, and the skybox it was supposedly fighting no longer
        // exists — the far field is now a fullscreen post pass, so there is no
        // bloom x skybox render-pass interaction left to have.
        //
        // The reference needs it. Its water glint is the largest bright shape in
        // 6 of 10 frames and reads as a soft bloomed lobe, not a hard specular
        // dot, and the emissive pellets and rim lights all carry a wide halo.
        // Threshold sits above the lit-terrain level so only the glint, the
        // pellets and the limb reach it.
        bloom: 1, bloomThreshold: 1.15, bloomIntensity: 0.9, bloomBlurRadius: 5.5,
        clearColor: [0.02, 0.03, 0.07, 1],   // deep-space background
      },
    },
  ).unwrap();

  // ── lighting ──────────────────────────────────────────────────────────────
  //    The day/night ("天黑") system was removed at the user's request — it kept
  //    reading badly. Lighting now comes entirely from the static pack
  //    (assets/scene.pack.json): the warm "Sun" directional + flat Skylight
  //    ambient. No code-side moon light and no visible sun/moon discs.

  // ── snake materials + meshes (baked at final radius; Transform.scale used
  //    only for body taper + pellet pulse) ─────────────────────────────────
  // Teal-green, from the reference frames rather than from the old fit.
  //
  // The previous colour was a warm cream chasing a measured "B/R 0.77", and that
  // measurement was taken off the wrong thing — reference/frames/snake f01, f04
  // and f09 all show the PLAYER snake as a saturated teal: (64,116,104),
  // (84,138,121), (134,162,153), i.e. G/R 1.2-1.8 and B/R 1.15-1.6. Cream was
  // never in the footage; it also made the snake vanish against the wake foam.
  // 亮奶玉青，不是暗哑深绿。上一版的 [0.064,0.214,0.158] 拟合的是"暖白 B/R 0.77"
  // 那份测量，但那份测量和参考录屏对不上：逐帧看，蛇在陆上中段是 ~(160,220,200)
  // 的亮玉色，水里变深、夜里自发光。"晶莹"三件套 = 亮底色（这里）+ 通长脊背
  // 高光 + 夜光 ps_selfGlow（都在 terrain-material.ts 的 snake 分支）。
  // 注意 emissive 对这个材质是**死参数**：graft 把整个 return 换掉了，标准
  // 着色器的 emissive 项到不了屏幕。别调它，调了没用——夜光走 ps_selfGlow。
  const bodyMatA = mat(withShader(Materials.standard({ baseColor: [0.135, 0.36, 0.30, 1], metallic: 0.0, roughness: 0.18 }), bodyShader));
  const pupilMat = mat(Materials.unlit([0.05, 0.06, 0.09, 1]));
  const foodMat = mat(withShader(Materials.standard({ baseColor: [1, 0.55, 0.18, 1], metallic: 0.1, roughness: 0.3, emissive: [1, 0.45, 0.12], emissiveIntensity: 3.2 }), fleshShader));
  const dropMat = mat(withShader(Materials.standard({ baseColor: [1, 0.88, 0.32, 1], metallic: 0.2, roughness: 0.25, emissive: [1, 0.8, 0.22], emissiveIntensity: 2.6 }), fleshShader));
  // Sparks. Heavily emissive so bloom catches them — that halo is most of what
  // makes a burst read as light rather than as confetti.
  // Same disc treatment as the speed spray, for the same reason: on the old
  // opaque path these were hard bright SQUARES, which is exactly the crudeness
  // the spray was rebuilt to remove — the two just fire at different moments.
  // Kept hot and heavily emissive so bloom still catches them; that halo is
  // most of what makes a burst read as light rather than as confetti.
  const sparkMat = mat(withShader(Materials.standard({
    baseColor: [1, 0.74, 0.34, 1], metallic: 0, roughness: 0.6,
    emissive: [1, 0.62, 0.24], emissiveIntensity: 5.5,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      depthWriteEnabled: false,
      cullMode: 'none',
    },
  }), sprayShader));
  // `?nofx=1` leaves the burst entity unspawned — the isolation switch that
  // `?nograss=1` / `?nowake=1` give the other two instanced systems.
  const bursts = new URLSearchParams(location.search).has('nofx') ? undefined : installBursts(
    world, sparkMat, PLANET_R + 4,
    { Transform, MeshFilter, MeshRenderer, Instances }, meshFromInterleaved,
    { crossed: false, size: [0.10, 0.28] },
  );

  // ── speed spray ──────────────────────────────────────────────────────────
  // The grains the reference throws up at speed (reference frame f09):
  // soft, out-of-focus specks scattered behind the runner, not a tight jet. Its
  // own system because the pickup burst is a hot orange spark and this is pale
  // debris — same instanced machinery, different material.
  // ALPHA-BLENDED, which is what makes these grains rather than stamps. The
  // extract stage derives `material.transparent` from
  // `passes[0].renderState.blend !== undefined` (pipeline-spec.ts:1422), so the
  // blend state below is also what routes this into the transparent pass.
  // Premultiplied, matching what the spray graft's tail returns.
  //
  // depthWrite off: grains must not occlude each other or the water behind
  // them. cullMode none: a billboard can be seen from either side.
  // castShadow false: the shadow pass runs the STOCK module, which knows
  // nothing about the disc mask — every grain was stamping a hard SQUARE into
  // the shadow map.
  //
  // Near-white and cool, not the old (0.66,0.63,0.55) khaki. That colour was
  // fitted when this was sand thrown off a dune; the snake spends most of its
  // time on water, where what it throws up is foam.
  // EMISSIVE, and this is the term that decides whether the effect exists at
  // all. A grain is thrown against the wake, and the wake is already near-white
  // foam — a white translucent disc over white foam is invisible by
  // construction, which is exactly how the first alpha-blended pass measured.
  // Airborne water IS brighter than the foam it came from: it is lit directly
  // with no depth of water absorbing anything. the reference buys the same
  // separation from an HDR sun at radiance ~17; ours is a display-space
  // pipeline, so it has to be stated.
  const sprayMat = mat(withShader(Materials.standard({
    baseColor: [0.88, 0.93, 0.97, 1], metallic: 0, roughness: 0.9,
    emissive: [0.40, 0.46, 0.52], emissiveIntensity: 0.72,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      depthWriteEnabled: false,
      cullMode: 'none',
    },
  }), sprayShader));
  // Smaller and far more numerous than the old opaque stamps: a translucent
  // grain only reads as spray once many of them overlap (see the alpha note in
  // the graft's tail), and at the old 0.13-0.33 each one was a 30px object.
  // LAND gets its own system, because it is not throwing the same stuff. Water
  // spray is airborne foam — near-white, lit from inside, hanging. Dry ground
  // throws DUST: sandy, matte, no forward-scatter glow, and it settles rather
  // than drifts. Running one material for both is what made the two read
  // identically once the water version was tuned.
  const dustMat = mat(withShader(Materials.standard({
    baseColor: [0.70, 0.60, 0.42, 1], metallic: 0, roughness: 1,
    emissive: [0.10, 0.085, 0.060], emissiveIntensity: 0.7,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      depthWriteEnabled: false,
      cullMode: 'none',
    },
  }), sprayShader));
  const dust = new URLSearchParams(location.search).has('nofx') ? undefined : installBursts(
    world, dustMat, PLANET_R + 4,
    { Transform, MeshFilter, MeshRenderer, Instances }, meshFromInterleaved,
    // Coarser and shorter-lived than foam: grit falls back, it does not hang.
    { crossed: false, size: [0.09, 0.24], life: [0.6, 1.1] },
  );
  const spray = new URLSearchParams(location.search).has('nofx') ? undefined : installBursts(
    world, sprayMat, PLANET_R + 4,
    { Transform, MeshFilter, MeshRenderer, Instances }, meshFromInterleaved,
    // Calibrated against reference frame f09, which is the frame the
    // effect was specified from. Its spray is a CLOUD: hundreds of small, faint,
    // out-of-focus specks trailing a long way behind the rider — not a handful
    // of bright pearls. Three passes to land on it: 0.13-0.33 opaque read as
    // crude stamps, 0.055-0.155 translucent vanished entirely (dye pass: 0.068%
    // of frame), 0.10-0.26 with emissive 1.5 came back as saturated white
    // bubbles. Small + long-lived + many is the reference's shape.
    { crossed: false, size: [0.07, 0.19], life: [0.9, 1.8] },
  );
  // DISSOLUTION MOTES — their own system, because the burst grains are 0.10 to
  // 0.28 units and at the game's camera distance that is a few pixels. Three
  // hundred of them on the body still read as nothing; the effect was never
  // sparse, it was INVISIBLE. These are two to three times the size, live twice
  // as long, and are violet-gold rather than spark-orange so the body coming
  // apart reads as being refined rather than as being on fire.
  const moteMat = mat(withShader(Materials.standard({
    baseColor: [0.95, 0.78, 1.0, 1], metallic: 0, roughness: 0.7,
    emissive: [0.80, 0.52, 1.0], emissiveIntensity: 3.4,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      depthWriteEnabled: false,
      cullMode: 'none',
    },
  }), sprayShader));
  const motes = new URLSearchParams(location.search).has('nofx') ? undefined : installBursts(
    world, moteMat, PLANET_R + 6,
    { Transform, MeshFilter, MeshRenderer, Instances }, meshFromInterleaved,
    { crossed: false, size: [0.26, 0.62], life: [1.3, 2.4] },
  );

  /** Fractional particles carried between frames, so a low rate still emits. */
  let sprayDebt = 0;

  const bodyCapsule = createCapsuleGeometry(BODY_R, 0.48, 5, 14);
  const bodyMesh = bodyCapsule.ok ? world.allocSharedRef('MeshAsset', bodyCapsule.value) : sphereMesh(BODY_R, 16, 12);
  const pupilMesh = sphereMesh(0.09, 10, 8);
  const foodMesh = sphereMesh(FOOD_R, 20, 16);
  const dropMesh = sphereMesh(DROP_R, 16, 12);

  // ── entities: head + eyes, body pool, pellets ────────────────────────────
  const headE = world.spawn(
    { component: Transform, data: { pos: [0, 0, PLANET_R + HEAD_R] } },
  ).unwrap();
  // The head is drawn by the swept ribbon (see snakeProfile's nose+bulb).
  // headE is a TRANSFORM-ONLY anchor for the camera, the eyes and collision.
  //
  // A low-poly GLB head (head + 2 horns) used to be mounted here as a child of
  // headE. It survived the ribbon conversion and kept riding on the snake —
  // that model IS the "ugly hard-modelled head" in every capture since: its
  // horns read as ears, its material never matched the body, and its ride
  // height ignored the bulb. Removed outright rather than gated off.

  const spawnEyePart = (m: number, mm: number): EntityHandle => world.spawn(
    { component: Transform, data: { pos: [0, -200, 0] } },
    { component: MeshFilter, data: { assetHandle: m } },
    { component: MeshRenderer, data: { materials: [mm] } },
  ).unwrap();
  const pupilL = spawnEyePart(pupilMesh, pupilMat);
  const pupilR = spawnEyePart(pupilMesh, pupilMat);

  // Capsule pool, kept only as the fallback when the host gives us no renderer
  // (headless / editor probe) and the swept tube cannot be built. When the
  // ribbon is live these are never spawned, so nothing overlaps it.
  const bodyEntities: EntityHandle[] = [];
  const spawnBody = (): EntityHandle => {
    const idx = bodyEntities.length;
    return world.spawn(
      { component: Transform, data: { pos: [0, -100, 0] } },   // parked off-planet until placed
      { component: MeshFilter, data: { assetHandle: bodyMesh } },
      { component: MeshRenderer, data: { materials: [bodyMatA] } },
    ).unwrap();
  };

  // Multiple pellets scattered on the surface at once.
  const foodEs: EntityHandle[] = [];
  for (let i = 0; i < FOOD_COUNT; i++) {
    foodEs.push(world.spawn(
      { component: Transform, data: { pos: [0, PLANET_R + FOOD_R, 0] } },
      { component: MeshFilter, data: { assetHandle: foodMesh } },
      { component: MeshRenderer, data: { materials: [foodMat] } },
    ).unwrap());
  }

  const placeAt = (e: EntityHandle, dir: V3, centerDist: number, s = 1, tangent?: V3) => {
    const n = norm(dir);
    const fallback = Math.abs(n[1]) < .9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]);
    world.set(e, Transform, { pos: [n[0] * centerDist, n[1] * centerDist, n[2] * centerDist], quat: quatFromY(norm(tangent ?? fallback)), scale: [s, s, s] });
  };

  // ── bot-drop pellets (PCG) ───────────────────────────────────────────────
  // When the player reverse-kills a bot, edible pellets are scattered along the
  // dead bot's body. They're smaller + worth less than normal pellets but still
  // grow the snake, so hunting bots becomes a way to feed and grow. Managed as a
  // reused pool (parked off-planet while inactive) so kills don't leak entities.
  interface Drop { pos: V3; e: EntityHandle; active: boolean }
  const drops: Drop[] = [];
  const acquireDrop = (): Drop => {
    const free = drops.find((d) => !d.active);
    if (free) return free;
    const e = world.spawn(
      { component: Transform, data: { pos: [0, -400, 0] } },
      { component: MeshFilter, data: { assetHandle: dropMesh } },
      { component: MeshRenderer, data: { materials: [dropMat] } },
    ).unwrap();
    const d: Drop = { pos: [0, 0, 1], e, active: false };
    drops.push(d);
    return d;
  };
  const spawnDrop = (dir: V3) => {
    const d = acquireDrop();
    d.pos = norm(dir);
    d.active = true;
    placeAt(d.e, d.pos, gr(d.pos, DROP_R));
  };
  const clearDrops = () => {
    for (const d of drops) { d.active = false; world.set(d.e, Transform, { pos: [0, -400, 0] }); }
  };


  // Orient the head to face forward + position the two eyes on its front.
  const placeHead = () => {
    const center = scl(headP, gr(headP, BODY_R - WATER_SINK * wetness(headP)));   // the ribbon's head ring, not a sphere
    world.set(headE, Transform, { pos: center, quat: lookQuat(headF, headP) });
    const up = pos;                       // surface normal
    const fwd = tan;                      // forward
    const right = norm(cross(fwd, up));   // sideways
    // On the BULB, not ahead of the nose. These offsets predate the ribbon
    // head: they were fitted to a sphere centred on the head anchor, but the
    // tube closes to radius ~0 at the anchor and the bulb sits HEAD_LEN behind
    // it — so the pupils hung in the air in front of the snout and read as two
    // floating holes. Anchor them to the bulb's own centre and radius instead.
    const bodyWorld = Math.max((length - 1) * SEG_SPACING * PLANET_R, 0.5);
    const thB = HEAD_LEN / PLANET_R;
    const cB = Math.cos(thB), sB = Math.sin(thB);
    let bd = norm([headP[0] * cB - headF[0] * sB, headP[1] * cB - headF[1] * sB, headP[2] * cB - headF[2] * sB]);
    // No offset to re-apply: the bulb sits on the TRAIL now, and the trail is
    // already the serpentine track. (It used to need the body-space offset
    // added back or the pupils hung beside the head every time the wave pushed
    // the body sideways.)
    const rB = snakeProfile(HEAD_LEN, bodyWorld, BODY_R);
    // The bulb's centre is where the RIBBON puts it — `radius * 0.55` above the
    // ground, not `radius` (see the lift in buildSpine). Using the wrong base
    // left the pupils a third of a radius clear of the crown, and widening the
    // body scaled that gap up with it.
    const bc = scl(bd, gr(bd, rB * 0.55));
    const place = (pupil: EntityHandle, side: number) => {
      // CROWN placement, seen from the game's only camera (behind the snake).
      // Front-top offsets put the contact point on the far side of the bulb, so
      // from behind the pupils peeked over the silhouette as detached dots —
      // "hollow eyes". On the crown, slightly aft, their bases are visibly on
      // the surface from the play view, like snail eyes.
      // Distance from the bulb CENTRE must be about one radius — the pupils sit
      // ON the crown. sqrt(0.10^2 + 1.0^2 + 0.30^2) = 1.05, so they clear the
      // surface by a hair. At 0.80 they were inside the head and vanished.
      const pc = add(add(add(bc, scl(fwd, rB * 0.10)), scl(bd, rB * 1.00)), scl(right, rB * 0.30 * side));
      world.set(pupil, Transform, { pos: pc });
    };
    place(pupilL, 1);
    place(pupilR, -1);
  };

  // ── rival robot snakes (PCG — Play only) ────────────────────────────────
  // A few AI snakes roam the planet on their own geodesics, wandering with
  // gentle random turns. Each has its OWN length (see BOT_LENS). Classic snake
  // collision rules apply BOTH ways: if the PLAYER head hits a bot the player
  // dies; if a BOT head hits the PLAYER's body that bot dies and the player
  // scores (then it respawns elsewhere after a short delay). They reuse the
  // shared head / body meshes (only the material differs) to stay light on GPU.
  interface Bot {
    pos: V3; tan: V3; trail: TrailPt[]; totalArc: number;
    speed: number; wander: number; turnDir: number;
    speedMul: number; speedTarget: number; speedTimer: number; hunt: boolean;
    len: number; baseLen: number; themeIdx: number; alive: boolean; respawn: number;
    head: EntityHandle; bodies: EntityHandle[];
  }
  // Pastel, not primary. At full saturation the bots read as coloured specks
  // stuck on the horizon — three of them were the most out-of-place thing in a
  // frame otherwise made of olive, teal and cream. The reference's rival snakes
  // are the same pale luminous material as the player's, distinguished by a
  // TINT rather than by hue at full chroma.
  const botThemes: { head: V3; body: V3; glow: V3 }[] = [
    { head: [0.95, 0.72, 0.70], body: [0.82, 0.55, 0.55], glow: [0.12, 0.05, 0.05] },
    { head: [0.82, 0.76, 0.96], body: [0.66, 0.60, 0.86], glow: [0.07, 0.05, 0.14] },
    { head: [0.95, 0.72, 0.86], body: [0.84, 0.58, 0.74], glow: [0.12, 0.04, 0.08] },
  ];
  // Bots take the TERRAIN graft — see the isolation note in STATE.md.
  const botBodyMats = botThemes.map((t) => mat(withShader(Materials.standard({ baseColor: [t.body[0], t.body[1], t.body[2], 1], metallic: 0, roughness: 0.55, emissive: t.glow, emissiveIntensity: 0.7 }), terrainShader)));

  const botTaper = (i: number, len: number): number => 1 - 0.4 * ((i - 1) / Math.max(1, len - 1));

  // Spawn one bot body segment (parked off-planet until placed). Extracted so a
  // growing bot can add segments on the fly, exactly like the player's spawnBody.
  const spawnBotBody = (themeIdx: number): EntityHandle => world.spawn(
    { component: Transform, data: { pos: [0, -300, 0] } },
    { component: MeshFilter, data: { assetHandle: bodyMesh } },
    { component: MeshRenderer, data: { materials: [botBodyMats[themeIdx]!] } },
  ).unwrap();

  const createBot = (themeIdx: number, len: number): Bot => {
    // Transform-only: the swept ribbon draws the whole bot, head included.
    const head = world.spawn(
      { component: Transform, data: { pos: [0, -300, 0] } },
    ).unwrap();
    const bodies: EntityHandle[] = [];
    for (let i = 0; i < len - 1; i++) bodies.push(spawnBotBody(themeIdx));
    return { pos: [0, 0, 1], tan: [1, 0, 0], trail: [], totalArc: 0, speed: BOT_SPEED, wander: 0, turnDir: 0, speedMul: 1, speedTarget: 1, speedTimer: 0, hunt: false, len, baseLen: len, themeIdx, alive: true, respawn: 0, head, bodies };
  };
  const bots: Bot[] = [];
  for (let i = 0; i < BOT_COUNT; i++) bots.push(createBot(i % botThemes.length, BOT_LENS[i]!));

  // Bots get the SAME swept tube the player has. They used to be chains of
  // spheres, which is exactly the "segmented capsules" the reference explicitly
  // is not: its rival snakes read as one continuous body with a smooth
  // silhouette, same as the player's. Fewer rings than the player because they
  // are usually farther away and there are three of them.
  const BOT_COLS = 96;
  const botRibbons = bots.map((b) =>
    new URLSearchParams(location.search).has('nobots') ? undefined : createRibbon(world, ctx?.renderer, botBodyMats[b.themeIdx]!, BOT_COLS, RIBBON_RING,
      PLANET_R + BODY_R * 2, { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved));
  const botSpines = bots.map(() => Array.from({ length: BOT_COLS }, () => ({
    dir: [0, 0, 1] as [number, number, number],
    fwd: [1, 0, 0] as [number, number, number],
    radius: BODY_R,
    lift: 0,
  })));

  /**
   * One shared width profile so the player and the bots are the same creature.
   *
   * The HEAD is shaped in WORLD UNITS and the BODY in normalised position, and
   * that split is the whole point. Defining the bulb on the normalised parameter
   * made the head grow with the snake: at length 4 it was a bulb, at length 20 it
   * was a gentle swelling spread over several units and the animal read as a pipe
   * with a cap. A head is a fixed size; a taper is a proportion.
   */
  const HEAD_TINT = 1.35;   // world units of cyan at the head, matched to the bulb
  const HEAD_NOSE = 0.30;   // world units over which the tip closes
  const HEAD_LEN = 0.62;    // world units from tip to the widest point
  const snakeProfile = (arcWorld: number, bodyWorld: number, bodyR: number): number => {
    const nose = arcWorld < HEAD_NOSE
      ? Math.sqrt(Math.max(0, 1 - ((HEAD_NOSE - arcWorld) / HEAD_NOSE) ** 2))
      : 1;
    const bulb = 1 + 0.70 * Math.exp(-(((arcWorld - HEAD_LEN) / 0.46) ** 2));
    const t = bodyWorld > 1e-4 ? Math.min(1, arcWorld / bodyWorld) : 0;
    const thin = 1 - 0.26 * t;
    const tailStart = 0.78;
    const close = t < tailStart
      ? 1
      : Math.sqrt(Math.max(0, 1 - ((t - tailStart) / (1 - tailStart)) ** 2));
    return bodyR * nose * bulb * thin * close;
  };

  // Park every segment of a bot off-planet (used while it's dead).
  const hideBot = (bot: Bot) => {
    world.set(bot.head, Transform, { pos: [0, -300, 0] });
    for (const b of bot.bodies) world.set(b, Transform, { pos: [0, -300, 0] });
    const i = bots.indexOf(bot);
    if (i >= 0) botRibbons[i]?.hide();
  };

  // Place a bot's body: one swept tube resampled from its trail, exactly the
  // player's construction. The pooled sphere entities stay parked — they are
  // kept only so a respawn does not have to reallocate.
  const placeBotSegments = (bot: Bot) => {
    world.set(bot.head, Transform, { pos: [0, -300, 0] });
    for (const b of bot.bodies) world.set(b, Transform, { pos: [0, -300, 0] });

    const bi = bots.indexOf(bot);
    const ribbon = botRibbons[bi];
    const spine = botSpines[bi];
    if (!ribbon || !spine) return;
    const arc = (bot.len - 1) * SEG_SPACING;
    if (arc < 0.02) { ribbon.hide(); return; }
    const rings = Math.max(2, Math.min(BOT_COLS, Math.ceil(arc / 0.008) + 2));
    for (let c = 0; c < rings; c++) {
      const t = c / (rings - 1);
      const sArc = bot.totalArc - t * arc;
      const p = sampleTrailArr(bot.trail, bot.pos, sArc);
      const ahead = sampleTrailArr(bot.trail, bot.pos, Math.min(bot.totalArc, sArc + 0.004));
      const behind = sampleTrailArr(bot.trail, bot.pos, sArc - 0.004);
      let f = norm([ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]]);
      const d = dot(f, p);
      f = norm([f[0] - p[0] * d, f[1] - p[1] * d, f[2] - p[2] * d]);
      const e = spine[c]!;
      e.dir = p; e.fwd = f;
      e.radius = snakeProfile(t * arc * PLANET_R, arc * PLANET_R, BODY_R * 0.92);
      // BEDDED IN, not balanced on top. Geometrically "resting" means the tube's
      // belly touches the ground and its centre sits a full radius above — and
      // measured that way it looked detached, because a real snake presses into
      // soil and grass and, more importantly, we have no contact shadow to sell
      // the touch. Diagnostic: pinning the centre TO the ground (half-sunk) read
      // correctly, resting-on-top read as floating. 0.55 is between them.
      const BED = 0.55;
      e.lift = terrainHeight(p) + 0.05 + e.radius * BED - BODY_R
        - WATER_SINK * wetness(p) * Math.min(1, e.radius / BODY_R);
      // uv.y carries a HEAD MASK (1 at the tip, 0 past HEAD_TINT), not the
      // normalised position — so the cyan and the bulb are the same object.
      e.u = Math.max(0, 1 - (t * arc * PLANET_R) / HEAD_TINT);
    }
    ribbon.update(spine, rings, PLANET_R + BODY_R);
  };

  // (Re)start a bot on a fresh point + heading, prefilling its trail so the body
  // starts stretched out behind it rather than piled on the head.
  const placeBot = (bot: Bot, dir: V3) => {
    bot.pos = norm(dir);
    const ref: V3 = Math.abs(bot.pos[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    bot.tan = norm(cross(ref, bot.pos));
    bot.totalArc = 0;
    bot.wander = 0.6 + Math.random() * 1.5;
    bot.turnDir = 0;
    bot.len = bot.baseLen;                 // a respawned bot starts back at its base size
    bot.speedMul = 1;
    bot.speedTarget = 0.8 + Math.random() * 0.7;
    bot.speedTimer = 0.6 + Math.random() * 1.6;
    bot.hunt = false;
    bot.alive = true;
    bot.respawn = 0;
    bot.trail = [];
    const prefill = SEG_SPACING * (bot.len + 2);
    for (let a = 0; a <= prefill; a += 0.02) {
      const c = Math.cos(a), s = Math.sin(a);
      bot.trail.push({ p: norm([bot.pos[0] * c - bot.tan[0] * s, bot.pos[1] * c - bot.tan[1] * s, bot.pos[2] * c - bot.tan[2] * s]), s: -a });
    }
    placeBotSegments(bot);
  };

  // Kill a bot (reverse-killed by the player's tail): hide it and start the
  // respawn countdown.
  // A bot dies (by ANY cause — same rules as the player). It scatters edible
  // pellets along its body; if the player caused it (reverse-kill) they score.
  const botDies = (bot: Bot, byPlayer: boolean) => {
    bot.alive = false;
    bot.respawn = BOT_RESPAWN * (1 - BOT_RESPAWN_CUT * difficultyOf());
    // scatter edible pellets along the dead bot's body (head + every Nth segment)
    spawnDrop(bot.pos);
    for (let i = DROP_EVERY; i < bot.len; i += DROP_EVERY) {
      spawnDrop(sampleTrailArr(bot.trail, bot.pos, bot.totalArc - i * SEG_SPACING));
    }
    if (byPlayer) { score += BOT_KILL_SCORE; hud.setScore(score); }
    hideBot(bot);
  };

  // Respawn a killed bot somewhere away from the player's current head.
  const respawnBot = (bot: Bot) => {
    let dir = randomSpherePoint();
    for (let t = 0; t < 12 && dot(dir, pos) > 0.2; t++) dir = randomSpherePoint();
    placeBot(bot, dir);
  };

  // Grow a bot by one segment (it just ate a pellet), capped for perf + fairness.
  const botGrow = (bot: Bot) => {
    if (bot.len >= BOT_MAX_LEN_CAP) return;
    bot.len += 1;
    if (bot.bodies.length < bot.len - 1) bot.bodies.push(spawnBotBody(bot.themeIdx));
  };

  const updateBot = (bot: Bot, dt: number) => {
    if (!bot.alive) {
      bot.respawn -= dt;
      if (bot.respawn <= 0) respawnBot(bot);
      return;
    }
    const diff = difficultyOf();

    // — pace variation ("时快时慢"): drift the speed multiplier toward a target
    //   that re-rolls between slow cruise / normal / fast burst every ~1-2s —
    bot.speedTimer -= dt;
    if (bot.speedTimer <= 0) {
      const r = Math.random();
      bot.speedTarget = r < 0.3 ? 0.5 + Math.random() * 0.2       // slow cruise
        : r < 0.75 ? 0.85 + Math.random() * 0.3                   // normal
        : 1.4 + Math.random() * 0.5;                              // fast burst
      bot.speedTimer = 0.7 + Math.random() * 1.7;
    }
    bot.speedMul += (bot.speedTarget - bot.speedMul) * Math.min(1, dt * 3);
    // bot 也吃同一套坡度惩罚/奖励。只给玩家加会同时坏掉两件事：追逐战里上坡
    // 单方面吃亏，而下坡变成稳赢的逃跑手段——地形一旦只对一方生效就成了漏洞。
    // bot 不做低通（它们没有玩家那种逐帧手感要求），也不吃沙地拖慢和冰面打滑，
    // 那两条是给玩家的"区域有性格"，不是物理定律。
    const botAhead = norm([
      bot.pos[0] + bot.tan[0] * 0.02, bot.pos[1] + bot.tan[1] * 0.02, bot.pos[2] + bot.tan[2] * 0.02,
    ]);
    const botGrade = (gr(botAhead, 0) - gr(bot.pos, 0)) / (0.02 * PLANET_R);
    const botTerrain = Math.max(GRADE_SLOW_MAX, Math.min(GRADE_FAST_MAX, 1 - GRADE_GAIN * botGrade));
    const curSpeed = BOT_SPEED * bot.speedMul * (1 + BOT_SPEED_RAMP * diff) * botTerrain;
    const turnRate = BOT_TURN * (1 + BOT_TURN_RAMP * diff);

    // — occasionally re-decide idle wander + whether to actively hunt the player
    //   (hunt chance scales with difficulty via BOT_AGGRO_MAX) —
    if (exodus.state === 'active' && exodus.gateDir) {
      const gd = exodus.gateDir as V3;
      const [bd] = exodus.fieldAt(bot.pos);
      bot.len -= bd * dt;
      if (Math.random() < dt * 3) {
        const bt = sampleTrailArr(
          bot.trail,
          bot.pos,
          bot.totalArc - Math.random() * Math.max(1, bot.len - 1) * SEG_SPACING,
        );
        motes?.emit(bt, gr(bt, 0.34), 5, clock, 1, undefined, 0.42);
      }
      if (bot.len <= 3) {
        motes?.emit(bot.pos, gr(bot.pos, 0.4), 34, clock, 1, undefined, 0.6);
        botDies(bot, false);
      } else if (
        Math.acos(Math.max(-1, Math.min(1, dot(bot.pos, gd)))) < GATE_ENTER_ANG * 1.2
      ) {
        motes?.emit(bot.pos, gr(bot.pos, 0.5), 44, clock, 1, undefined, 0.7);
        bot.alive = false;
        bot.respawn = 9999;
      }
    }

    bot.wander -= dt;
    if (bot.wander <= 0) {
      const r = Math.random();
      bot.turnDir = r < 0.45 ? 0 : r < 0.72 ? 1 : -1;
      bot.hunt = Math.random() < BOT_AGGRO_MAX * diff;
      bot.wander = 0.8 + Math.random() * 2;
    }

    // — LOOK-AHEAD PATH SCAN (the "smart" driver) —
    //   Instead of reacting to one point straight ahead (which arrives too late to
    //   turn away at speed), a bot SIMULATES where a fan of steering choices would
    //   take its head over the next ~1s and picks the heading that stays clearest
    //   of every hazard while pointing at its goal. This is what stops bots from
    //   driving into walls: they see the wall far enough ahead to curve around it.

    // Build the hazard field once per tick: {dir, cos} — keep the predicted head
    // OUTSIDE each cone. BOT_AVOID_PAD widens every cone so bots veer EARLY.
    const hazards: { d: V3; c: number }[] = [];
    for (const o of obstacles) hazards.push({ d: o.dir, c: Math.cos(Math.acos(Math.min(1, o.hitCos)) + BOT_AVOID_PAD) });
    const snakeCos = Math.cos(BOT_HIT_ANGLE + BOT_AVOID_PAD);
    if (alive) {
      hazards.push({ d: pos, c: snakeCos });
      // The skin is a hazard like any body, and the bot has to see ALL of it —
      // the same stride the player's own body is sampled at. One point at the
      // head meant a bot dodged a metre of husk and then drove into the rest.
      slough?.forEachRing(4, (d) => hazards.push({ d, c: snakeCos }));
      for (let i = 2; i < length; i += 2) hazards.push({ d: sampleTrail(totalArc - i * SEG_SPACING), c: snakeCos });
    }
    for (const other of bots) {
      if (other === bot || !other.alive) continue;
      hazards.push({ d: other.pos, c: snakeCos });
      for (let i = 2; i < other.len; i += 2) hazards.push({ d: sampleTrailArr(other.trail, other.pos, other.totalArc - i * SEG_SPACING), c: snakeCos });
    }
    if (bot.len > BOT_SELF_SKIP) {
      for (let i = BOT_SELF_SKIP; i < bot.len; i += 2) hazards.push({ d: sampleTrailArr(bot.trail, bot.pos, bot.totalArc - i * SEG_SPACING), c: snakeCos });
    }
    // penetration of a point vs the hazard field: >0 = inside an avoid cone (deeper worse)
    const worstPen = (P: V3): number => {
      let m = -2;
      for (let i = 0; i < hazards.length; i++) {
        const pen = dot(P, hazards[i].d) - hazards[i].c;
        if (pen > m) m = pen;
      }
      return m;
    };

    // goal to bias toward when the way is clear: hunt the player, else nearest food/drop
    let goal: V3 | null = null;
    if (exodus.state === 'active' && exodus.gateDir) {
      // Everyone runs for the same door.
      goal = exodus.gateDir as V3;
    } else if (bot.hunt && alive) {
      goal = pos;
    } else {
      let best = -2;
      const consider = (f: V3) => { const near = dot(bot.pos, f); if (near > best) { best = near; goal = f; } };
      for (let i = 0; i < FOOD_COUNT; i++) { const f = foods[i]; if (f) consider(f); }
      for (const d of drops) if (d.active) consider(d.pos);
    }

    // Foresight window: enough time to turn ~90° away (+ margin), so a faster bot
    // automatically scans further down its path.
    const horizon = 1.2 / turnRate + 0.4;
    const dtSim = horizon / BOT_LOOK_STEPS;
    const CANDS = [0, -0.4, 0.4, -0.72, 0.72, -1, 1];
    let bestCost = Infinity;
    let steer = 0;
    for (let ci = 0; ci < CANDS.length; ci++) {
      const cand = CANDS[ci];
      let sp = bot.pos, st = bot.tan;
      let pen = -2;
      for (let k = 0; k < BOT_LOOK_STEPS; k++) {
        // hold this steering choice for one sub-step
        const a = cand * turnRate * dtSim;
        const ca = Math.cos(a), sa = Math.sin(a);
        const kk = cross(sp, st);
        st = norm([st[0] * ca + kk[0] * sa, st[1] * ca + kk[1] * sa, st[2] * ca + kk[2] * sa]);
        const dth = curSpeed * dtSim;
        const cc = Math.cos(dth), ss = Math.sin(dth);
        sp = norm([sp[0] * cc + st[0] * ss, sp[1] * cc + st[1] * ss, sp[2] * cc + st[2] * ss]);
        const w = 1 - (k / BOT_LOOK_STEPS) * 0.4;   // nearer danger weighs more
        const wp = worstPen(sp) * w;
        if (wp > pen) pen = wp;
      }
      // lower cost = better: danger dominates; among safe paths prefer aiming at
      // the goal and turning as little as possible (avoids nervous wobble).
      let cost = Math.max(0, pen) * 100;
      if (goal) cost -= dot(sp, goal) * 2;
      cost += Math.abs(cand) * 0.12;
      if (cost < bestCost) { bestCost = cost; steer = cand; }
    }
    // no goal and the straight path is wide open → drift with the gentle idle wander
    if (!goal && steer === 0 && bestCost < 0.5) steer = bot.turnDir * 0.5;
    if (steer !== 0) {
      const a = Math.max(-1, Math.min(1, steer)) * turnRate * dt;
      const c = Math.cos(a), s = Math.sin(a);
      const k = cross(bot.pos, bot.tan);
      bot.tan = norm([bot.tan[0] * c + k[0] * s, bot.tan[1] * c + k[1] * s, bot.tan[2] * c + k[2] * s]);
    }

    // — advance along the geodesic —
    const dTheta = curSpeed * dt;
    const c = Math.cos(dTheta), s = Math.sin(dTheta);
    const np = norm([bot.pos[0] * c + bot.tan[0] * s, bot.pos[1] * c + bot.tan[1] * s, bot.pos[2] * c + bot.tan[2] * s]);
    const nt = norm([-bot.pos[0] * s + bot.tan[0] * c, -bot.pos[1] * s + bot.tan[1] * c, -bot.pos[2] * s + bot.tan[2] * c]);
    bot.pos = np; bot.tan = nt;
    bot.totalArc += dTheta;
    bot.trail.unshift({ p: bot.pos, s: bot.totalArc });
    const keepArc = bot.len * SEG_SPACING + 0.4;
    while (bot.trail.length > 2 && bot.trail[bot.trail.length - 1]!.s < bot.totalArc - keepArc) bot.trail.pop();

    // — eat pellets → grow (bots compete with the player for food) —
    const eatCos = Math.cos(BOT_EAT_ANGLE);
    for (let i = 0; i < FOOD_COUNT; i++) {
      const f = foods[i];
      if (f && dot(bot.pos, f) > eatCos) { botGrow(bot); spawnFoodAt(i); }
    }

    placeBotSegments(bot);
  };

  const resetBots = () => {
    for (let i = 0; i < bots.length; i++) {
      // spread bots around the planet, away from wherever the player starts
      let dir = randomSpherePoint();
      for (let t = 0; t < 12 && dot(dir, spawnDir) > 0.2; t++) dir = randomSpherePoint();
      placeBot(bots[i]!, dir);
    }
  };

  // ── HUD ──────────────────────────────────────────────────────────────────
  const hudHost = ctx?.uiRoot ?? canvas.parentElement ?? undefined;
  const hud = installHud(hudHost ? { host: hudHost } : {});
  ctx?.registerCleanup?.(() => hud.dispose());

  // ── snake state ────────────────────────────────────────────────────────
  // pos/tan are the steered COURSE — smooth, no undulation. The camera follows
  // them, which is the whole reason they stay separate: with the wave in the
  // head, a camera locked to the head would weave a full body-width at about a
  // hertz.
  let pos: V3;              // course position (unit vector on sphere)
  let tan: V3;              // course forward direction (unit tangent, ⟂ pos)
  // ...and headP/headF are where the head ACTUALLY is: the course displaced by
  // the serpentine wave. The trail, the body, the eyes and every collision use
  // these. See headPose().
  let headP: V3 = [0, 0, 1];
  let headF: V3 = [1, 0, 0];
  let totalArc: number;     // cumulative arc length travelled by the head
  let trail: TrailPt[];     // newest sample at index 0, arc decreasing
  let length: number;       // total segments (head + body)
  let score: number;
  let best = 0;
  let speed: number;
  let boost = 1;            // shift-boost stamina, 0..1
  let boostCooldown = 0;    // lockout timer (s) after the bar is fully drained
  /** Last frame's actual angular speed, boost included. */
  let curSpeedNow = BASE_SPEED;
  // 地形对手感的三个量，每帧算一次、转向和速度共用。放在这里而不是 update 内部
  // 的局部变量，是因为坡度要跨帧低通（GRADE_SMOOTH）。
  let terrainGrade = 0;
  let terrainIceW = 0;
  let terrainSpeedMul = 1;
  /** The slither reads THIS, not the raw speed.
   *
   *  The raw value steps from 1x to 1.85x in a single frame when Shift goes
   *  down, and the whole body snaps sideways with it — which reads as a jolt,
   *  not as acceleration. Worse, `boosting` also requires stamina left, so at
   *  the moment the bar empties it flickers on and off frame to frame and the
   *  body shakes. Following it with a time constant removes both. */
  let slitherUrge = 1;
  let foods: V3[] = [];     // pellet positions (unit vectors), one per foodEs slot
  let alive: boolean;
  let clock = 0;            // seconds elapsed (drives pellet pulse)
  let upMs = 0;
  let upPeak = 0;
  let showPerf = false;
  /** Smoothed wall-clock frame time, which is what the player actually gets. */
  let frameMs = 16.7;
  let lastFrameAt = 0;
  let restartArmed = false; // debounce the R key across the death frame

  // Pick a fresh pellet position for slot `i`, away from the head, the other
  // live pellets, AND the terrain obstacles so pellets stay reachable.
  const spawnFoodAt = (i: number) => {
    let c = randomSpherePoint();
    for (let t = 0; t < 24; t++) {
      const cand = randomSpherePoint();
      const farFromHead = dot(cand, pos) < 0.6;
      const farFromOthers = foods.every((f, j) => j === i || !f || dot(cand, f) < 0.9);
      const farFromTerrain = obstacles.every((o) => dot(cand, o.dir) < o.hitCos - 0.01);
      c = cand;
      if (farFromHead && farFromOthers && farFromTerrain) break;
    }
    foods[i] = c;
    placeAt(foodEs[i]!, c, gr(c, FOOD_R));
  };
  const spawnAllFood = () => { for (let i = 0; i < FOOD_COUNT; i++) spawnFoodAt(i); };

  /** Take pellet `i`. Extracted so the head and 蛇灵 eat by exactly the same
   *  rules — two copies of "what eating does" would drift the moment one of
   *  them grew a burst or a score change. */
  const takeFood = (i: number) => {
    const f = foods[i];
    if (!f) return;
    // 被炼化到只剩残光的食物咬不到了。
    if (exodus.foodFade < 0.15) return;
    score += 10;
    length += 1;
    speed = Math.min(MAX_SPEED, speed + SPEED_GAIN);
    if (!playerRibbon) {
      bodyEntities.push(spawnBody());
      placeAt(bodyEntities[bodyEntities.length - 1]!, sampleTrail(totalArc - (length - 1) * SEG_SPACING), PLANET_R + BODY_R, bodyScaleFor(length - 1));
    }
    hud.setScore(score);
    hud.setLength(length);
    bursts?.emit(f, gr(f, FOOD_R), 26, clock, 1);
    spawnFoodAt(i);
  };
  /** Take a pellet dropped by a slain bot. Smaller reward, still grows. */
  const takeDrop = (d: { active: boolean; pos: V3; e: EntityHandle }) => {
    if (!d.active) return;
    score += DROP_SCORE;
    length += 1;
    bursts?.emit(d.pos, gr(d.pos, DROP_R), 18, clock, 0.7);
    if (!playerRibbon) {
      bodyEntities.push(spawnBody());
      placeAt(bodyEntities[bodyEntities.length - 1]!, sampleTrail(totalArc - (length - 1) * SEG_SPACING), PLANET_R + BODY_R, bodyScaleFor(length - 1));
    }
    hud.setScore(score);
    hud.setLength(length);
    d.active = false;
    world.set(d.e, Transform, { pos: [0, -400, 0] });
  };

  // Sample the player's trail at a target arc length.
  const sampleTrail = (targetS: number): V3 => sampleTrailArr(trail, pos, targetS);

  // Dynamic difficulty 0..1 derived from the score. Everything scary (bot speed,
  // turn agility, hunting probability, respawn speed) scales off this, so the
  // late game keeps pushing back as the player grows.
  const difficultyOf = (): number => Math.min(1, score / DIFFICULTY_FULL);

  // Body radius taper: full near the head, thinner toward the tail tip.
  const bodyScaleFor = (i: number): number => {
    const t = length > 1 ? (i - 1) / (length - 1) : 0;   // 0 at neck → 1 at tail
    return 1 - 0.5 * t;
  };

  // ── body: one swept tube, not a chain of capsules ────────────────────────
  // Reference frame f08 measures a near-constant body width (32/37/35/41/36 px
  // down the length) with a smooth silhouette and a single highlight running
  // along it. Capsules cannot give that — each one carries its own highlight
  // and its own silhouette bulge, which is what the old build looked like.
  const ribbonSpine: RibbonSpineSample[] = Array.from({ length: RIBBON_COLS }, () => ({
    dir: [0, 0, 1] as [number, number, number],
    fwd: [1, 0, 0] as [number, number, number],
    radius: BODY_R,
  }));
  // ── Slough (蛇蜕) ─────────────────────────────────────────────────────────
  // The shed skin gets the body's own base colour: it WAS the body, and the
  // draining toward parchment happens in the shader off the life channel rather
  // than by authoring a second palette here. Alpha-blended, no shadow — a
  // translucent husk should not stamp an opaque silhouette into the shadow map.
  const skinMat = mat(withShader(Materials.standard({
    baseColor: [0.064, 0.214, 0.158, 1], metallic: 0, roughness: 0.55,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      depthWriteEnabled: false,
      // BACK-FACE CULLED, unlike the spray. A double-sided translucent tube
      // draws its far wall through its near one, and on a swept lattice the far
      // wall's ring seams line up into a regular dashed stripe running the whole
      // length — it read as a zipper, not as a husk. Culling leaves the outer
      // shell, which is what a shed skin actually is.
      cullMode: 'back',
    },
  }), grafts.skin));
  // Water thrown off the surface — the Ribbon's body and the strike's sheets.
  // Lifted water is almost all rim light, so the base colour barely matters;
  // see the spout variant in terrain-material.ts.
  const spoutMat = mat(withShader(Materials.standard({
    baseColor: [0.30, 0.62, 0.78, 1], metallic: 0, roughness: 0.12,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      depthWriteEnabled: false,
      cullMode: 'none',
    },
  }), grafts.spout));
  const ribbonMat = mat(withShader(Materials.standard({
    // Nearly black ON PURPOSE. Every graft in this game sums ps_lit on top of
    // its own term, so a mid-blue albedo under this sun arrives at white before
    // the water colour is even added — measured by substituting a flat red into
    // ps_ribbon, which came out plainly red, proving the graft was live and the
    // albedo was the problem. Kill the albedo and ps_ribbon carries the lot.
    baseColor: [0.03, 0.07, 0.09, 1], metallic: 0, roughness: 0.08,
    castShadow: false,
    renderState: {
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      // WRITES DEPTH, unlike every other transparent in this game, and it has to.
      // The space pass decides sky-versus-geometry by reading the depth texture
      // ("a depth of ~1.0 means nothing was drawn" — src/space.wgsl). A
      // transparent that never writes depth is therefore INVISIBLE wherever it
      // extends past the planet's silhouette: the pass sees empty sky and paints
      // over it. Against the terrain it survives only because the ground behind
      // it wrote the depth. Reported as "the column disappears once it is taller
      // than the planet's edge", which is exactly where that boundary is.
      //
      // Back-face culling comes with it. Depth-writing transparency self-sorts
      // badly with cullMode 'none' — the far wall of the tube can win the depth
      // test and occlude the near one — and these are closed tubes, so culling
      // the back faces is correct anyway.
      depthWriteEnabled: true,
      cullMode: 'back',
    },
  }), grafts.ribbon));
  // The planet's own mesh is what gets dug — see the note at the top of
  // src/deform.ts for why a patch laid over it cannot work.
const deformSkin: DeformSkin = createDeformSkin(
    ctx?.renderer, surfaceMeshHandle, surf.indices, SURF_WS, SURF_HS,
    (i, j, out) => {
      const u = (i / SURF_WS) * Math.PI * 2;
      const v = (j / SURF_HS) * Math.PI;
      const sv = Math.sin(v);
      out[0] = sv * Math.cos(u); out[1] = Math.cos(v); out[2] = sv * Math.sin(u);
    },
    (i, j) => heightLattice.data[j * (SURF_WS + 1) + i] ?? 0,
    PLANET_R + 0.05,
    deformStore,
  );
  // Pay the full-buffer build at boot, not inside the first frame a skill fires.
  deformSkin.prime();
  const sweep: Sweep | undefined = createSweep(
    world, ctx?.renderer, ribbonMat, 14, PLANET_R + 0.05, PLANET_R,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved);
  // TRUE BLACK, and it has to be stated: 0.055 albedo rendered as MID GREY on
  // the green ground. The prop graft is additive-heavy (wrap 2.2, sss 1.4,
  // ambient 0.42) and the sun runs at intensity 7, so a "dark" albedo lands
  // well up the display range. A gate meant to read as a hole cut in the world
  // has to start near zero, and it is tinted violet rather than neutral so the
  // black itself carries a colour.
  const obsidianMat = mat(withShader(Materials.standard({
    baseColor: [0.018, 0.012, 0.030, 1], metallic: 0.1, roughness: 0.8,
  }), propShader));
  // INVERTED HULL. The same mesh a hair larger with FRONT faces culled: its
  // back faces sit behind the solid gate everywhere except the silhouette,
  // where they spill out as a gold rim. That rim is what makes the gate read
  // from across the planet — a black object on dark ground has no edge
  // otherwise.
  // OPAQUE, deliberately. The first version was additively blended, which puts
  // it in the transparent pass and made it vanish; an inverted hull does not
  // need blending — it is a solid shell whose back faces are occluded by the
  // gate everywhere except the silhouette, which is precisely the rim.
  const auraMat = mat(withShader(Materials.standard({
    baseColor: [1, 0.70, 0.22, 1], metallic: 0, roughness: 1,
    emissive: [0.85, 0.48, 0.10], emissiveIntensity: 2.2,
    castShadow: false,
    renderState: { cullMode: 'front' },
  }), propShader));
  // The doorway is not a hole in the render — it is a violet deep. A pure
  // black plate reads as a missing polygon; a faint self-lit tint reads as
  // somewhere.
  const voidMat = mat(withShader(Materials.standard({
    // LIGHT ENOUGH TO SEE. At 0.012 albedo this was a black blob with nothing
    // legible in it. The doorway is the thing the whole event points at, so it
    // has to hold an image: a lit violet depth, dark enough to still read as a
    // hole in the world but bright enough to have a shape.
    baseColor: [0.20, 0.115, 0.34, 1], metallic: 0, roughness: 1,
    emissive: [0.30, 0.13, 0.52], emissiveIntensity: 0.85,
    castShadow: false,
  }), propShader));
  const pillarMat = mat(withShader(Materials.standard({
    baseColor: [1, 0.78, 0.3, 1], metallic: 0, roughness: 0.6,
    emissive: [1, 0.7, 0.22], emissiveIntensity: 4,
    castShadow: false,
  }), propShader));

  // The slow-field's visible edge: an additive gold glow disc laid on the
  // ground around the gate. Same blend recipe as sparkMat — additive-ish
  // premultiplied, no depth write — so it reads as light on the ground, not
  // as paint.
  // (A ground stain used to live here. Opaque geometry cannot be a glow, and
  // every value from gold plate down to soil read as a patch of wrong-coloured
  // dirt under the gate — the "exposed footing" in the player's screenshot.
  // The field is carried by the motes drawn inward along the ground and by the
  // gate's own light instead.)

  const exodus = createExodus(PLANET_R);
  /** null follows the live 13-second event; a number is the screenshot probe. */
  let eclipseOverride: number | null = null;
  const EXODUS_LEN = 100;
  // 11 -> 19. At 11 the gate stood about two snake-lengths tall and read as a
  // roadside shrine; it is the only way off a dying world and has to dominate
  // the horizon it appears on.
  let gateEnts: EntityHandle[] = [];
  let exodusDebt = 0;
  let exodusMoteT = 0;
  /** Cadence for the field's inward-drifting motes. */
  let exodusDriftT = 0;

  const spawnGateVisual = (dir: V3) => {
    const model = props['gate_dark'];
    // BEDDED, and WIDER than it is tall. Two separate things were wrong:
    //  - the props all take a `bed` fraction (spawnProp sinks them by part of
    //    their own height); this one was placed at gr(dir, 0) with no bed at
    //    all, so its feet sat exactly on the analytic ground while the drawn
    //    terrain rolls under a 15-unit footprint — it read as hovering.
    //  - one uniform scale made a tall narrow doorway; a gate you are meant to
    //    aim a snake at wants a broad opening.
    const base = scl(dir, gr(dir, -GATE_SIZE * GATE_BED));
    const gs: V3 = [GATE_SIZE * GATE_WIDE, GATE_SIZE, GATE_SIZE * GATE_WIDE];
    let toward = add(pos, scl(dir, -dot(dir, pos)));
    if (dot(toward, toward) < 1e-8) toward = cross(dir, [0, 1, 0]);
    if (dot(toward, toward) < 1e-8) toward = cross(dir, [1, 0, 0]);
    const t = norm(toward);
    const axis: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a = norm(cross(dir, axis));
    const b = cross(dir, a);
    const yaw = Math.atan2(dot(b, t), dot(a, t));
    const quat = quatFromYSpin(dir, yaw);

    for (const prim of model.prims) {
      gateEnts.push(world.spawn(
        { component: Transform, data: { pos: base, quat, scale: gs } },
        { component: MeshFilter, data: { assetHandle: prim.mesh } },
        { component: MeshRenderer, data: { materials: [obsidianMat] } },
      ).unwrap());
      // 1.035 invisible, 1.10 gold-plated, 1.04 fine until the gate was
      // widened — the stepped plinths are the thickest part of any inflated
      // hull and once they filled more of the frame the rim read as a coating
      // again. 1.018 keeps an edge on a 22-unit-wide gate.
      const A = GATE_SIZE * 1.018;
      gateEnts.push(world.spawn(
        { component: Transform, data: { pos: base, quat, scale: [A * GATE_WIDE, A, A * GATE_WIDE] } },
        { component: MeshFilter, data: { assetHandle: prim.mesh } },
        { component: MeshRenderer, data: { materials: [auraMat] } },
      ).unwrap());
    }

    gateEnts.push(world.spawn(
      {
        component: Transform,
        data: {
          pos: scl(dir, gr(dir, GATE_SIZE * 0.42)),
          quat,
          scale: [GATE_SIZE * 0.30 * GATE_WIDE, GATE_SIZE * 0.40, GATE_SIZE * 0.06],
        },
      },
      { component: MeshFilter, data: { assetHandle: sphereMesh(1) } },
      { component: MeshRenderer, data: { materials: [voidMat] } },
    ).unwrap());

    // The beacon. SEED THE MESH AT REAL SIZE and scale DOWN: the cull reads
    // the AABB the seed mesh carries, not the Transform scale, so a unit
    // sphere stretched into a 30-unit rod is culled the moment its 1-unit box
    // leaves the frustum — the pillar existed and never rendered once.
    // (Same lesson as the ribbon in STATE.md #10.)
    gateEnts.push(world.spawn(
      {
        component: Transform,
        data: {
          pos: scl(dir, gr(dir, GATE_SIZE * 1.55)),
          quat,
          scale: [0.014, 1, 0.014],
        },
      },
      { component: MeshFilter, data: { assetHandle: sphereMesh(GATE_SIZE * 1.45) } },
      { component: MeshRenderer, data: { materials: [pillarMat] } },
    ).unwrap());
  };

  const despawnGateVisual = () => {
    // DESPAWN, not park. Parking left the entity alive forever, and every run
    // added another; worse, the handles being parked were Results rather than
    // EntityHandles (see the unwrap above), so the park was a silent no-op and
    // the previous gate simply stayed standing.
    for (const e of gateEnts) world.despawn(e);
    gateEnts = [];
  };

  const pickGateSpot = (): V3 => {
    const sun: V3 = [SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]];
    if (isLand(sun)) return sun;

    // Walk concentric geodesic rings out from the subsolar point. The first
    // ring that touches land is, to the sampling resolution, the nearest land
    // to SUN_DIR; random far points made the door contradict the eclipse.
    const axis: V3 = Math.abs(sun[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const east = norm(cross(axis, sun));
    const north = cross(sun, east);
    const rings = 256;
    const step = Math.PI / rings;
    for (let ring = 1; ring <= rings; ring++) {
      const ang = ring * step;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const samples = Math.max(12, Math.ceil((Math.PI * 2 * Math.max(sa, 0.02)) / step));
      for (let i = 0; i < samples; i++) {
        const phi = (i / samples) * Math.PI * 2;
        const tangent = add(scl(east, Math.cos(phi)), scl(north, Math.sin(phi)));
        const d = norm(add(scl(sun, ca), scl(tangent, sa)));
        if (isLand(d)) return d;
      }
    }
    // A planet without land is outside this game's terrain contract. Keeping a
    // deterministic fallback still makes the event debuggable if that changes.
    return sun;
  };

  let tapSweep = false;
  let sweepCool = 0;
  const bloom: Bloom | undefined = createBloom(
    world, ctx?.renderer, ribbonMat, 16, PLANET_R + 16,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved);
  const waterRibbon: WaterRibbon | undefined = createWaterRibbon(
    world, ctx?.renderer, ribbonMat, 14, PLANET_R + 24,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved, PLANET_R + 0.05);
  /** Held last frame, so the release edge can be detected. */
  let ribbonHeldPrev = false;

  // ── the sea's dents ──────────────────────────────────────────────────────
  // Rebuilt every frame and handed to BOTH the water sheet (which moves its
  // vertices) and the post pass (which has to know where they went — see the
  // waterDent note in src/space.wgsl). One description, two consumers: two
  // descriptions is how the sea and the shading of the sea drift apart.
  const dents = new Float32Array(DENT_FLOATS);
  const dentAt: V3 = [0, 0, 1];
  /** Bloom's crater. Wide and DEEP — this is a body of water being thrown out
   *  of the sea, and the first version's 0.13 was a tenth of a snake. */
  const BLOOM_DENT_R = 5.0;
  const BLOOM_DENT_D = 1.9;
  const BLOOM_DENT_RIM = 1.05;
  /** The trough under Sweep's crest. Three of them along the arc, because the
   *  crest is seventeen units across and one under its middle would leave the
   *  horns ploughing nothing. */
  const SWEEP_DENT_R = 3.4;
  const SWEEP_DENT_D = 1.35;
  const SWEEP_DENT_RIM = 0.72;
  /** Debug only: a dent that just stays there, so the sea's response can be
   *  A/B'd against a frozen camera instead of chased across a live cast. */
  let testDent: { at: V3; r: number; d: number; rim: number } | undefined;
  const buildDents = (): Float32Array => {
    dents.fill(0);
    if (testDent) {
      dents[0] = testDent.at[0]; dents[1] = testDent.at[1]; dents[2] = testDent.at[2];
      dents[3] = testDent.r; dents[4] = testDent.d; dents[5] = testDent.rim; dents[6] = 1;
    }
    if (bloom?.active) {
      const c = bloom.crater;
      if (c > 0.002) {
        dents[0] = bloom.at[0]; dents[1] = bloom.at[1]; dents[2] = bloom.at[2];
        dents[3] = BLOOM_DENT_R;
        dents[4] = BLOOM_DENT_D; dents[5] = BLOOM_DENT_RIM; dents[6] = c;
      }
    }
    if (sweep?.active && sweep.env > 0.02) {
      for (let q = 0; q < 3; q++) {
        const u = 0.3 + q * 0.2;
        sweep.troughAt(u, dentAt);
        // Only where there IS sea to trough. On sand the crest still throws
        // dust and still kills; what it must not do is dent water that is not
        // there.
        const w = wetness(dentAt);
        if (w < 0.35) continue;
        const o = (q + 1) * 8;
        dents[o] = dentAt[0]; dents[o + 1] = dentAt[1]; dents[o + 2] = dentAt[2];
        dents[o + 3] = SWEEP_DENT_R;
        dents[o + 4] = SWEEP_DENT_D; dents[o + 5] = SWEEP_DENT_RIM;
        dents[o + 6] = sweep.env * w;
      }
    }
    return dents;
  };

  const strikeWake: StrikeWake | undefined = createStrikeWake(
    world, ctx?.renderer, spoutMat, 12, PLANET_R + 0.05,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved);
  /** Seconds since the last release, so the sheets can outlive the strike. */
  let strikeAge = 99;

  const slough: Slough | undefined = createSlough(
    world, ctx?.renderer, skinMat, RIBBON_COLS, RIBBON_RING, PLANET_R + BODY_R * 2,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved,
  );
  /** Body must be at least this long to shed — below it there is not enough
   *  snake to leave a skin worth standing, and the 25% cost would be a rounding
   *  error rather than a decision. */
  const SHED_MIN = 16;
  /** Free burst the shed itself buys: the tearing-out IS the acceleration. */
  let shedBurst = 0;
  /** Fractional flakes carried between frames while the seam runs. */
  let shedDebt = 0;
  const shedFlake = { at: [0, 0, 1] as V3, vel: [0, 0, 0] as V3 };
  /** Seconds the coil has been gathering, 0 when not holding. */
  let coilHold = 0;
  /** Seconds of strike left. Steering is locked while this runs. */
  let striking = 0;
  /** How long THIS strike was bought for, so the follow-through can be
   *  normalised against it. */
  let strikeFor = STRIKE_TIME;
  /** Decaying accumulator of signed turn. Positive is one way round. */
  /** 0..1 engagement, eased. */
  /** Stronger when it stands on a real orbit than when it is dragged along. */

  /**
   * Everything the skills light, declared in ONE place.
   *
   * It has to be one place because there are two paths that reach it — the live
   * update and photo mode's early return — and a second copy is a guarantee
   * that a skill added later gets a light in one of them and not the other.
   * That is precisely how the light pool's first bug survived two rounds of
   * measurement: the frozen path never called commit() at all.
   */
  const declareSkillLights = (): void => {
    skillLights.begin();
    // Slough's one light, and it lasts under a second. A shed skin is a dull
    // object by definition; the peel is the single moment it is allowed to be
    // bright, so that is the only moment it lights the world.
    const sp = slough?.seamPoint();
    if (sp) skillLights.add([sp[0], sp[1], sp[2]], 9, [0.45, 1.0, 0.78], 26);
    if (photo.probeLight) {
      skillLights.add(scl(headP, gr(headP, 1.2)), 16, [0.55, 0.85, 1.0], 40);
    }
    // The dark gate's beacon. Declared HERE and not where the exodus state
    // ticks: begin() wipes the pool every frame, so a light added before this
    // function runs simply never exists by commit time.
    if (exodus.state === 'active' && exodus.gateDir) {
      const gd = exodus.gateDir as V3;
      const gatePos = scl(gd, gr(gd, 3));
      skillLights.add(gatePos, 16, [1.0, 0.72, 0.25], 9 + 3 * Math.sin(clock * 2.2));
    }
    skillLights.commit();
  };

  const playerRibbon: Ribbon | undefined = createRibbon(
    world, ctx?.renderer, bodyMatA, RIBBON_COLS, RIBBON_RING, PLANET_R + BODY_R * 2,
    { Transform, MeshFilter, MeshRenderer }, meshFromInterleaved,
  );

  // ── land trail ───────────────────────────────────────────────────────────
  // NOT geometry any more. This used to be two swept ribbons — a dark groove
  // plus brighter berms — and it read as a painted stripe with hard edges for
  // the same reason the water wake did: a mesh has a silhouette. The reference
  // (reference/frames/snake/f03) shows a soft dark smudge following the body,
  // no trench and no shoulders at all.
  //
  // So land and water now share ONE field, evaluated per pixel in the space post
  // pass off the same trail samples, and differ only in how they read it: foam
  // on water, a darkening on land. See `landTrail` in src/space.wgsl.
  const TRACK_ARC = 30 / PLANET_R;           // ~30 world units of trail kept

  // ── water wake ───────────────────────────────────────────────────────────
  // NOT geometry. It used to be three swept ribbons — a churn band and two
  // diverging arms — and no amount of tuning made them read as water: a mesh has
  // a silhouette, and the reference (reference/frames/snake/f06, f09) is one
  // broad soft-edged white mass many body-widths across with no straight edge
  // anywhere, trailed by a fine combed texture.
  //
  // So the wake is now a FIELD, evaluated per pixel in the space post pass. All
  // that lives here is the trail it is drawn from: WAKE_SAMPLES world-space
  // ground points spread over the recent arc, each carrying a normalised age.
  // Keeping the radius is what prevents a low trail from painting through a
  // neighbouring ridge. See SpaceCamera.wake.
  //
  // Doing it in the post pass is also what makes it possible at all: the forward
  // pass has no time uniform and no spare texture binding, and the post pass has
  // both a clock and a params UBO this game packs itself.
  const WAKE_ARC = 26 / PLANET_R;        // ~26 world units of trail
  const wakeSamples = new Float32Array(WAKE_SAMPLES * 4);
  const buildWakeSamples = (): Float32Array => {
    // totalArc is assigned in resetGame(); spaceCam() is also called during
    // bootstrap, before that has run. Math.min(x, undefined) is NaN and every
    // comparison against NaN is false, so an unguarded version sails past the
    // "too short" test and feeds NaN into the trail sampler.
    const arc = Number.isFinite(totalArc) ? Math.min(WAKE_ARC, totalArc) : 0;
    for (let i = 0; i < WAKE_SAMPLES; i++) {
      const o = i * 4;
      if (arc < 0.02) { wakeSamples[o + 3] = 2; continue; }   // 2 = unused slot
      // NOT evenly spaced. The wake has to represent two different scales at
      // once: the whole 26-unit path, and the body's own wave — which
      // Coilstrike compresses to 3.36 units. Spacing fine enough for the wave
      // everywhere would need ~30 samples, and this array is walked per pixel
      // in a full-screen pass.
      //
      // So spend them where they are looked at. The eye compares the body
      // against the furrow just behind the head, where the track is fresh and
      // the compressed wave actually is; twenty units back the furrow has
      // spread and faded and nobody is checking it against anything. This puts
      // the nearest samples 0.4 units apart (eight per coiled wavelength) and
      // lets the tail end run to 2.2.
      const t = (i / (WAKE_SAMPLES - 1)) ** 1.5;
      // Start BEHIND the head. Centred on the body the foam simply swallows it —
      // the reference snake is a saturated teal that reads against white, ours
      // is pale cream and vanishes into it. Opening a gap the length of the head
      // keeps the snake legible and is also what a real wake does: the water
      // closes over behind the swimmer, not under it.
      const p = sampleTrail(totalArc - (0.10 + 0.90 * t) * arc);
      const trailRadius = PLANET_R + 0.05 + terrainHeight(p);
      wakeSamples[o] = p[0] * trailRadius;
      wakeSamples[o + 1] = p[1] * trailRadius;
      wakeSamples[o + 2] = p[2] * trailRadius;
      wakeSamples[o + 3] = t;
    }
    return wakeSamples;
  };

  /**
   * Resample the trail into evenly-spaced rings. Even spacing matters: sampling
   * at the per-segment spacing instead would make the tube's tessellation vary
   * with body length and pinch visibly on tight turns.
   */
  // ── slither ──────────────────────────────────────────────────────────────
  // The reference body CURVES even when the creature is travelling straight
  // (reference/frames/snake f01, f08 both show a pronounced S). A tube swept
  // exactly along the path cannot do that — going straight, it is a straight
  // pipe, which is most of why ours reads as a hose on rails next to theirs.
  //
  // So the spine is offset ACROSS its own path by a travelling wave. This is
  // purely visual: collision, eating and the trail all still use `sampleTrail`,
  // so nothing about the game changes.
  // ── serpentine locomotion ───────────────────────────────────────────────
  //
  // HOW A SNAKE ACTUALLY MOVES, and why the previous model could not look like
  // it. In lateral undulation the wave is STATIONARY IN THE GROUND FRAME: the
  // body flows through a fixed sinuous track, and every point of it passes
  // through the same points the head passed through. Powder the ground and a
  // snake leaves ONE sinuous line, not a swept swath. The belly scales give low
  // forward and high lateral friction, so pushing sideways against the track
  // resolves into forward travel — that is the "gripping" part. The wave only
  // APPEARS to travel backwards along the body, because the body is sliding
  // forward through a curve that is not moving.
  //
  // What this replaces: a lateral offset applied to the body as a function of
  // BODY PARAMETER and time. That makes the wave slide along the body and
  // therefore across the ground, which is the kinematics of a shaken rope — or
  // of an eel, where a travelling wave IS right because water yields. On ground
  // it reads exactly as the complaint put it: a designed curve being forced to
  // move rather than an animal pushing off.
  //
  // The fix is structural and it makes the body code SIMPLER: bake the wave into
  // where the HEAD goes, and let the body sample the trail with no offset at
  // all. Everything then follows for free — the wave sits still on the ground,
  // the body traces the head's exact track, a turn deforms the whole track as
  // the body reaches it.
  //
  // The phase is a pure function of TOTAL ARC. That is what pins the wave to the
  // ground: at any fixed point on the track the phase is fixed, whatever the
  // speed. It also gives the right speed behaviour without a second term —
  // travelling faster flows the body through the same curve faster, so the
  // apparent body-wave frequency rises with speed by itself.
  /** Ground wavelength in world units. A short body holds well under one wave;
   *  a grown one holds three, which is the range real lateral undulation runs
   *  in. Fixed in WORLD units, so it converts through the radius. */
  const SLITHER_LAMBDA = 8.0 / PLANET_R;
  /** Peak lateral excursion of the head off its steered course, world units.
   *  With the wavelength above this puts the body up to 26 degrees off the
   *  direction of travel, which is what makes the S read at all. Real lateral
   *  undulation runs steeper still (30-50 degrees), but this body is only nine
   *  diameters long where a real snake is thirty to a hundred — a short thick
   *  body at 45 degrees reads as a zigzag, not as a snake. */
  const SLITHER_LAT = 0.62 / PLANET_R;
  /** Forward thrust pulses TWICE per wavelength — a snake pushes hardest when
   *  its body is most angled to the track. Small; it is a cue, not a lurch. */
  const SLITHER_THRUST = 0.05;

  /** Where the head actually is, and which way it actually points, given the
   *  smooth steered course in `pos`/`tan`.
   *
   *  Keeping the course separate is what lets the CAMERA stay still: it follows
   *  pos/tan, so it does not weave with the head. The head, the trail, the body
   *  and every collision use this. */
  /** Accumulated undulation phase.
   *
   *  NOT `totalArc * k`, and the difference is load-bearing the moment a skill
   *  changes the wavelength: k doubles, and `totalArc * k` jumps by whatever
   *  totalArc happens to be times the delta — mid-round that is a hundred
   *  radians, i.e. an arbitrary new phase, and the whole body snaps. Integrating
   *  `dPhase = dArc * k` keeps the wave continuous across a gear change while
   *  preserving exactly the property the phase exists for: it is a function of
   *  DISTANCE TRAVELLED, so the wave stays pinned to the ground.
   *
   *  (With a constant wavelength the two forms are identical, which is why the
   *  original was correct until Coilstrike needed to compress the track.) */
  let slitherPhase = 0;
  /** Wavelength multiplier — 1 normally, compressed while Coilstrike winds up. */
  let coilLambda = 1;
  /** Lateral amplitude multiplier — grows with the same wind-up. */
  let coilAmp = 1;
  const slitherK = (): number => (2 * Math.PI) / (SLITHER_LAMBDA * coilLambda);

  const headPose = (): { p: V3; f: V3 } => {
    const k = slitherK();
    // Amplitude grows with speed: a sprinting animal throws its body harder.
    const urge = Math.min(1.55, Math.max(0.85, slitherUrge));
    const amp = SLITHER_LAT * urge * coilAmp;
    const lat = amp * Math.sin(slitherPhase);
    // d(lateral)/d(arc) is the tangent of the angle the path makes with the
    // course — this is what tilts the head and the whole body off the direction
    // of travel, and it is the visible half of the effect.
    const slope = amp * k * Math.cos(slitherPhase);

    const side = norm(cross(pos, tan));            // left of travel
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const p = norm([
      pos[0] * cl + side[0] * sl, pos[1] * cl + side[1] * sl, pos[2] * cl + side[2] * sl,
    ]);
    const ang = Math.atan(slope);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const sideP = norm(cross(p, tan));
    let f = norm([
      tan[0] * ca + sideP[0] * sa, tan[1] * ca + sideP[1] * sa, tan[2] * ca + sideP[2] * sa,
    ]);
    const d = dot(f, p);
    f = norm([f[0] - p[0] * d, f[1] - p[1] * d, f[2] - p[2] * d]);
    return { p, f };
  };
  /** Speed multiplier from the thrust pulse — peaks where the body is most
   *  angled, which is twice per wavelength. */
  const thrustPulse = (): number => 1 + SLITHER_THRUST * -Math.cos(2 * slitherPhase);

  /** Scratch for the offset ring centres — differenced afterwards for tangents,
   *  because an offset spine's own direction is NOT the trail's. */
  const spinePts: V3[] = Array.from({ length: RIBBON_COLS }, () => [0, 0, 1] as V3);

  /** Rings the last buildSpine wrote, so a probe can read the spine it built. */
  let lastRings = 0;
  const buildSpine = (): number => {
    const bodyArc = (length - 1) * SEG_SPACING;
    const rings = Math.max(2, Math.min(RIBBON_COLS, Math.ceil(bodyArc / 0.006) + 2));
    for (let c = 0; c < rings; c++) {
      // NOT evenly spaced along the body, and this is why the head vanished on
      // a long snake. The ring budget is fixed at RIBBON_COLS; spread evenly, a
      // 287-segment body is 412 world units and each ring covers 2.6 of them —
      // so the head bulb, which is about two units long in WORLD units and does
      // not grow with the snake, got a single ring and stopped existing. The
      // player reported it as "the head is gone".
      //
      // Same fix as the wake's sampling: spend the budget where it is looked at.
      // The exponent packs rings toward the head (t=0) and lets the far tail run
      // coarse, where the body is a smooth taper nobody is checking. At length
      // 287 the first ring now covers 0.05 units instead of 2.6.
      const t = (c / (rings - 1)) ** HEAD_BIAS;
      const s = totalArc - t * bodyArc;
      const p = sampleTrail(s);
      // Forward from a short finite difference along the trail rather than from
      // the stored tangent: the stored one is only correct at the head.
      const ahead = sampleTrail(Math.min(totalArc, s + 0.004));
      const behind = sampleTrail(s - 0.004);
      let f = norm([ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]]);
      // Project onto the tangent plane so the ring never shears into the surface.
      const d = dot(f, p);
      f = norm([f[0] - p[0] * d, f[1] - p[1] * d, f[2] - p[2] * d]);
      // NO lateral offset. The trail is already the serpentine track the head
      // laid down, and a snake's body passes through exactly the points its
      // head passed through — that is the whole of lateral undulation. Adding
      // an offset here is what used to slide the wave across the ground.
      spinePts[c] = p;
      const e = ribbonSpine[c]!;
      e.dir = spinePts[c]!;
      e.fwd = f;
      // Width profile. The 32/37/35/41/36 px "essentially constant" measurement
      // was taken off the RED BOT in f08; the player's snake in f03 plainly
      // thins from neck to tail and finishes in a fine point, which is most of
      // what makes it read as a creature rather than as a pipe. So: a slight
      // swell behind the head, a gentle thinning through the body, and a
      // circular close over the last quarter that ends near zero.
      // Shared with the bots — see snakeProfile. The HEAD IS PART OF THE TUBE
      // now, not a sphere parked on its end: the separate sphere was a hard
      // model that never matched the body's material or its ride height and read
      // as a prop stuck on the front. In the reference the head is plainly
      // continuous with the body — a bulb closing into a rounded nose.
      e.radius = snakeProfile(t * bodyArc * PLANET_R, bodyArc * PLANET_R, BODY_R);
      // lift carries the RADIUS as well as the terrain: the tube's radius runs
      // from a head bulb down to nearly nothing at the tail, so one constant
      // centre height floats the tail and buries the head. The 0.55 factor beds
      // the body INTO the ground rather than balancing it on top — see the note
      // in placeBotSegments.
      e.lift = terrainHeight(spinePts[c]!) + 0.05 + e.radius * 0.55 - BODY_R
        - WATER_SINK * wetness(spinePts[c]!) * Math.min(1, e.radius / BODY_R);
      // uv.y carries a HEAD MASK (1 at the tip, 0 past HEAD_TINT), not the
      // normalised position — so the cyan and the bulb are the same object.
      e.u = Math.max(0, 1 - (t * bodyArc * PLANET_R) / HEAD_TINT);
    }
    // Second pass: the offset spine's own tangent. Reusing the trail's would
    // shear every ring — the same mistake the wake arms started with.
    for (let c = 0; c < rings; c++) {
      const q = spinePts[c]!;
      const a = spinePts[Math.max(0, c - 1)]!;
      const b = spinePts[Math.min(rings - 1, c + 1)]!;
      let f = norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
      const d = dot(f, q);
      f = norm([f[0] - q[0] * d, f[1] - q[1] * d, f[2] - q[2] * d]);
      if (Number.isFinite(f[0] + f[1] + f[2]) && f[0] * f[0] + f[1] * f[1] + f[2] * f[2] > 0.5) {
        ribbonSpine[c]!.fwd = f;
      }
    }
    lastRings = rings;
    return rings;
  };

  const placeBodySegments = () => {
    if (playerRibbon) {
      const rings = buildSpine();
      playerRibbon.update(ribbonSpine, rings, PLANET_R + BODY_R);
      // Park the pooled capsules. The ribbon draws the whole body, but the
      // eat/grow paths still place bodyEntities[last], and nothing ever put them
      // away again — so one or two stale spheres sat wherever they were last
      // dropped and read as lumps growing out of the snake's neck.
      for (const e of bodyEntities) world.set(e, Transform, { pos: [0, -300, 0] });
      return;
    }
    for (let i = 1; i < length; i++) {
      const pseg = sampleTrail(totalArc - i * SEG_SPACING);
      placeAt(bodyEntities[i - 1]!, pseg, gr(pseg, BODY_R), bodyScaleFor(i));
    }
  };

  const resetGame = () => {
    pos = spawnDir;
    tan = spawnTan;
    headP = pos; headF = tan;
    slitherPhase = 0; coilLambda = 1; coilAmp = 1;
    totalArc = 0;
    length = START_LENGTH;
    score = 0;
    speed = BASE_SPEED;
    alive = true;
    bursts?.clear();
    motes?.clear();
    spray?.clear();
    dust?.clear();
    // A restart gives a fresh planet. The dug store is the WORLD'S memory —
    // right that a channel survives you swimming away from it, wrong that it
    // survives the run that cut it. Carrying scars into a new game is not
    // memory, it is a leak.
    deformStore.clear();
    deformSkin.prime();
    restoreGateLanding();
    exodus.reset();
    eclipseOverride = null;
    // photo.god is cleared by the caller, not here: `photo` is declared BELOW
    // resetGame and the boot calls resetGame() before that line runs, so
    // touching it here is a temporal-dead-zone throw that kills bootstrap
    // silently. Fifth time this file has done exactly this.
    despawnGateVisual();
    exodusDebt = 0;
    exodusMoteT = 0;
    slough?.clear();
    shedBurst = 0;
    coilHold = 0; striking = 0; strikeFor = STRIKE_TIME; strikeAge = 99; coilLambda = 1; coilAmp = 1;
    strikeWake?.hide();
    sprayDebt = 0;

    // Pre-fill the trail behind the head (along -tan) so body segments start
    // stretched out instead of piled on the head.
    trail = [];
    const prefill = SEG_SPACING * (length + 2);
    const stepBack = 0.02;
    for (let a = 0; a <= prefill; a += stepBack) {
      const c = Math.cos(a), s = Math.sin(a);
      const p = norm([pos[0] * c - tan[0] * s, pos[1] * c - tan[1] * s, pos[2] * c - tan[2] * s]);
      trail.push({ p, s: -a });
    }

    // Body entity pool sized to length-1 — fallback path only; the swept tube
    // draws the whole body in one mesh and needs no per-segment entities.
    if (!playerRibbon) {
      while (bodyEntities.length < length - 1) bodyEntities.push(spawnBody());
      for (let i = bodyEntities.length - 1; i >= length - 1; i--) {
        world.despawn(bodyEntities[i]!);
        bodyEntities.splice(i, 1);
      }
    }

    placeHead();
    placeBodySegments();

    foods = [];
    spawnAllFood();
    clearDrops();
    resetBots();
    boost = 1;
    boostCooldown = 0;
    slitherUrge = 1;
    hud.setScore(0);
    hud.setLength(length);
    hud.setBoost(1, false);
    hud.hideGameOver();
  };

  const gameOver = (reason: string) => {
    alive = false;
    // The update returns early once this is false, so anything still mid-flight
    // would hold its last pose forever — three helices standing motionless in
    // the air behind the score panel. The transient effects are retired here;
    // the shed SKIN is not, because it is a thing that was left in the world
    // and it should still be lying there while the player reads the score.
    waterRibbon?.cancel();
    bloom?.cancel();
    sweep?.cancel();
    strikeWake?.hide();
    coilHold = 0; striking = 0;
    skillLights.begin();
    skillLights.commit();
    if (score > best) best = score;
    hud.setBest(best);
    hud.showGameOver(score, best, () => { if (!alive) { photo.god = false; resetGame(); } }, reason);
  };

  resetGame();

  // ── input (ForgeaX frame snapshot) ────────────────────────────────────────
  // The engine backend owns browser listeners and clears held state on blur or
  // hidden documents. This game consumes one immutable InputSnapshot per frame
  // instead of maintaining a second keyboard state beside the engine.
  let frameInput: InputSnapshot | undefined;
  /** Edge-triggered skill taps, drained by the update loop. A skill must not
   *  fire once per frame while its key is down. */
  let tapShed = false;
  let tapBloom = false;
  let bloomCool = 0;
  /** Where a cast would land right now, and whether it would be allowed. Held
   *  outside the update so the HUD can show the refusal BEFORE the player
   *  presses, which is the only way a condition teaches anything. */
  let bloomTarget: V3 = [0, 0, 1];
  let bloomOk = false;
  const codeDown = (code: string): boolean => frameInput?.keyboard.downCode(code) ?? false;
  const codePressed = (code: string): boolean =>
    frameInput?.keyboard.justPressedCode(code) ?? false;
  const sampleInputEdges = (): void => {
    if (codePressed('KeyQ')) tapShed = true;
    if (codePressed('KeyF')) tapBloom = true;
    if (codePressed('KeyP')) showPerf = !showPerf;
    if (codePressed('KeyC')) tapSweep = true;
  };
  const keyLeft = () => codeDown('KeyA') || codeDown('ArrowLeft');
  const keyRight = () => codeDown('KeyD') || codeDown('ArrowRight');
  const keyRestart = () => codeDown('KeyR');
  const keyBoost = () => codeDown('ShiftLeft') || codeDown('ShiftRight') || photo.boost;
  const keyCoil = () => codeDown('Space') || photo.coil;
  const keyRibbon = () => codeDown('KeyE') || photo.swirl;

  // Camera framing (behind + above the head, looking slightly ahead). As the
  // snake grows the rig pulls back → the planet visually shrinks.
  // Framing. The reference is shot from much further out than a close chase cam:
  // a whole hemisphere is in frame — ocean, ice, landmasses, the grass fringe on
  // the limb and the atmosphere halo all at once. At height 6.5 on a radius-26
  // planet only a sliver of surface is visible and none of that composition can
  // land, which turned out to matter more than any of the colour work.
  // RESCALED FOR THE RADIUS-52 PLANET. These were fitted at radius 36 and rode
  // the growth unchanged, which pushed the camera far enough back that 23-29% of
  // every frame was empty nebula and the snake had become a stick in the middle.
  // The wide hemisphere composition — ocean, coast, land, limb and halo in one
  // frame — is the thing being preserved; only the distance moved.
  // MEASURED, not guessed, and the levers do not do what they sound like. On a
  // sphere LOWERING the camera shrinks the visible cap and shows MORE sky, and
  // RAISING the lookahead aims further toward the horizon, which also shows more
  // sky. A first retune to 13 / 10.5 / 8 therefore made both worse: empty sky
  // 27.4% -> 30.6% with the subject no bigger.
  //
  // Swept six triples against two numbers, empty-sky share and snake pixels:
  //   17/13/6  (old) 28.1%  3.25      13/10.5/8   29.7%  3.27
  //   17/11/3        22.8%  7.29      19/9/2      18.1%  1.75
  //   20/12/2        19.9%  1.57      22/13/0     19.3%  1.24
  // The last three score BEST on sky and are all wrong: aiming that far down
  // pins the horizon to the top edge and the frame collapses to a dome of sand,
  // losing the ocean-coast-land-limb composition this game is built around. The
  // metric alone would have picked one of them.
  let BASE_CAM_HEIGHT = 17;
  let BASE_CAM_BACK = 11;
  // Raised with the rest: aiming further ahead lifts the horizon in frame, which
  // is what actually spends the reclaimed sky on ground.
  let BASE_LOOKAHEAD = 3;
  const updateCamera = () => {
    const growth = Math.max(0, length - START_LENGTH);
    // Growth zoom. This multiplies the base distance, so when the base moved
    // 6.5 -> 17 for reference framing the old 2.4x ceiling put the camera 41
    // units out and shrank the planet to a dot. The range has to shrink as the
    // base grows — the pull-back should still be felt, not dominate.
    // Cap and rate both cut, for the same reason the base did: at 1.42 a long
    // snake put the camera back where the retune just took it from.
    const zoom = Math.min(1.30, 1 + growth * 0.012);
    const camHeight = BASE_CAM_HEIGHT * zoom;
    const camBack = BASE_CAM_BACK * zoom;
    const camPos: V3 = [
      pos[0] * (gr(pos, camHeight)) - tan[0] * camBack,
      pos[1] * (gr(pos, camHeight)) - tan[1] * camBack,
      pos[2] * (gr(pos, camHeight)) - tan[2] * camBack,
    ];
    const target: V3 = [
      pos[0] * gr(pos, 0) + tan[0] * BASE_LOOKAHEAD,
      pos[1] * gr(pos, 0) + tan[1] * BASE_LOOKAHEAD,
      pos[2] * gr(pos, 0) + tan[2] * BASE_LOOKAHEAD,
    ];
    const fwd: V3 = [target[0] - camPos[0], target[1] - camPos[1], target[2] - camPos[2]];
    // Roll the UP HINT about the view axis, and hand the same vector to the
    // space pass's basis below. Rolling only the quaternion would bank the
    // scene while the starfield stayed level.
    const fN = norm(fwd);
    const rollA = -carve * CAM_ROLL_MAX;
    const cr = Math.cos(rollA), sr = Math.sin(rollA);
    const dp = fN[0] * pos[0] + fN[1] * pos[1] + fN[2] * pos[2];
    const camUpHint: V3 = [
      pos[0] * cr + (fN[1] * pos[2] - fN[2] * pos[1]) * sr + fN[0] * dp * (1 - cr),
      pos[1] * cr + (fN[2] * pos[0] - fN[0] * pos[2]) * sr + fN[1] * dp * (1 - cr),
      pos[2] * cr + (fN[0] * pos[1] - fN[1] * pos[0]) * sr + fN[2] * dp * (1 - cr),
    ];
    const q = lookQuat(fwd, camUpHint);
    world.set(camera, Transform, { pos: camPos, quat: q });

    // +9 deg at the dash's measured 2.98x. Written every frame because the
    // space pass reads fovNow too, and a projection that leads or lags it by
    // one frame shows as the horizon shearing against the stars.
    const want = fovForce > 0
      ? (fovForce * Math.PI) / 180
      : CAM_FOV_BASE * (1 + 0.15 * Math.min(1, Math.max(0, (camSpeed - 1) / 2)));
    if (Math.abs(want - fovNow) > 1e-5) {
      fovNow = want;
      // ONLY the field that changed. `perspective()` is a spawn-time factory:
      // it returns a COMPLETE Camera POD, filling every field it was not asked
      // about from the schema defaults — tonemap 'none', exposure 1, antialias
      // 'none', bloom off. `world.set` writes whatever it is handed, so passing
      // it here reset the entire colour pipeline the moment the FOV first
      // moved, which is the first time the player presses Shift. The picture
      // jumped from AgX at 0.13 to untonemapped at 1.0 and never came back —
      // reported as "the brightness right after entering and after one Shift
      // are wildly different". A projection tweak must not carry a grade.
      world.set(camera, Camera, { fov: fovNow });
    }

    // The space background is a fullscreen post pass, so it has no view matrix
    // of its own — it reconstructs the per-pixel ray from this basis. Derived
    // from the same vectors the camera quaternion is built from, so the stars
    // cannot drift out of sync with the view.
    camForward = norm(fwd);
    camRight = norm(cross(camForward, camUpHint));
    camUp = cross(camRight, camForward);
    camWorld = camPos;
  };
  // Camera basis + position, mirrored out of updateCamera for the space and
  // atmosphere pass. Declared before updateCamera runs — `let` is in its
  // temporal dead zone until then, and updateCamera is called immediately below.
  /** Speed multiple the CAMERA is showing — trails the real one (see the
   *  asymmetric follow where curSpeedNow is set). */
  let camSpeed = 1;
  /** Signed bank, -1..1. the reference's `carve` in all but name: driven by the turn
   *  input, scaled by speed, and what the camera rolls with. */
  let carve = 0;
  /** Live vertical FOV, radians. Both the projection matrix and the space
   *  pass's ray reconstruction read this; they must never disagree or the
   *  starfield and the atmosphere limb slide against the scene. */
  let fovNow = CAM_FOV_BASE;
  /** Debug override in degrees, or 0 for "follow speed". */
  let fovForce = 0;
  let camWorld: V3 = [0, 0, PLANET_R + 8];
  let camForward: V3 = [0, 0, -1];
  let camRight: V3 = [1, 0, 0];
  let camUp: V3 = [0, 1, 0];
  updateCamera();

  // ── space background ─────────────────────────────────────────────────────
  // Replaces the photographic HDRI skybox. The reference footage is a near-black
  // navy field with a nebula band and multi-scale stars; an HDRI's average
  // luminance flattens exactly the contrast the rim glow and bloom need.
  const eclipseProgress = () => eclipseOverride ?? exodus.eclipse;
  const eclipseElevation = (): number => Math.asin(Math.max(-1, Math.min(1, dot(pos, SUN_DIR))));
  // 这两个数是**手实际所在的仰角**，不是太阳点的仰角。
  //
  // 旧的 SDF 版本把手画在 anchor 下方约 37°（`handUv = uv + tan(handHang)`），所以
  // 当时标定出来的 40°-46° 说的是"太阳点在 40-46°、手挂在它下面"。换成真几何体
  // 之后手就摆在 anchor 上，同一组数字直接把手顶到了画面上方——实测 45° 时手和
  // 日冕一起看不见，把带宽临时压到 6° 才重新出现。所以按新的摆法重新标定。
  const ECLIPSE_ELEVATION_MIN = 0.034907; // 2 度
  const ECLIPSE_ELEVATION_MAX = 0.122173; // 7 度
  let eclipseAnchor: V3 = [0, 1, 0];

  /** 日冕方向的唯一权威。post pass 原样消费它。曾经还要喂给手的 mesh，手删掉
   *  之后只剩日冕一个消费者，但仍然放在 TS 这边算 —— 它依赖钳位带宽，和着色器
   *  各算一份必然漂移。 */
  const eclipseAnchorBasis = (): { anchor: V3 } => {
    const observerUp = norm(camWorld);
    const playerUp = norm(pos);
    let bearingRaw = add([SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]], scl(playerUp, -dot(SUN_DIR, playerUp)));
    if (dot(bearingRaw, bearingRaw) < 1e-6) {
      bearingRaw = add(camForward, scl(playerUp, -dot(camForward, playerUp)));
    }
    if (dot(bearingRaw, bearingRaw) < 1e-6) bearingRaw = camRight;
    const bearing = norm(bearingRaw);
    let cameraBearingRaw = add(bearing, scl(observerUp, -dot(bearing, observerUp)));
    if (dot(cameraBearingRaw, cameraBearingRaw) < 1e-6) cameraBearingRaw = camRight;
    const cameraBearing = norm(cameraBearingRaw);
    const radiusRatio = Math.max(0, Math.min(0.9999, PLANET_R / Math.hypot(...camWorld)));
    const horizonOut = Math.sqrt(Math.max(0, 1 - radiusRatio * radiusRatio));
    const horizonRay = norm(add(scl(observerUp, -horizonOut), scl(cameraBearing, radiusRatio)));
    const horizonUp = norm(add(scl(observerUp, radiusRatio), scl(cameraBearing, horizonOut)));
    const elevation = Math.max(ECLIPSE_ELEVATION_MIN, Math.min(ECLIPSE_ELEVATION_MAX, eclipseElevation()));
    const anchor = norm(add(scl(horizonRay, Math.cos(elevation)), scl(horizonUp, Math.sin(elevation))));
    return { anchor };
  };

  // 天上那只手已经删掉：真几何体的爪影和日冕摆在一起反而互相拖累，光晕本身
  // 更好看。留下的只有 anchor —— 日冕仍然绕着它画，所以每帧还是要更新。
  const syncEclipseAnchor = () => {
    eclipseAnchor = eclipseAnchorBasis().anchor;
  };
  syncEclipseAnchor();

  const spaceCam = () => {
    const eclipse = eclipseProgress();
    return {
      right: camRight, up: camUp, forward: camForward,
      tanHalfFov: Math.tan(fovNow * 0.5), aspect: viewAspect(),
      time: clock,
      waterLift: WATER_LIFT,
      patch: [pos[0], pos[1], pos[2], Math.cos(PATCH_HALF)] as const,
      sheetFade: [Math.cos(PATCH_HALF * 0.94), Math.cos(PATCH_HALF * 0.66)] as const,
      eclipse,
      eclipseElevation: eclipseElevation(),
      eclipseAnchor,
      dents,
      sun: SUN_DIR,
      // Only the post-pass atmosphere reads this live value; forward SH remains
      // baked. The full-frame grade below is the authority for terrain darkness.
      sunIntensity: SUN_INTENSITY * (1 - 0.82 * eclipse),
      camPos: camWorld as readonly [number, number, number],
      planetRadius: PLANET_R,
      atmosRadius: ATMOS_R,
      near: 0.1, far: 400,
      wake: buildWakeSamples(),
    };
  };
  const spaceEntity = new URLSearchParams(location.search).has('nospace')
    ? undefined
    : installSpaceBackground(ctx?.renderer, world, spaceCam());

  // ── main loop ────────────────────────────────────────────────────────────
  // Engine API drift (found 2026-08-01): this used to be `registerUpdate(cb)`,
  // but `registerUpdate` was deleted from App/GameContext/BootstrapContext
  // (packages/app/src/__tests__/callback-deletion.unit.test.ts asserts its
  // absence). The old code read it as `ctx?.registerUpdate ?? (() => {})`, so
  // the entire loop below was silently bound to a no-op and never ran once —
  // the game rendered a single static frame with a clean console, and `verify`
  // still reported ok. Per-frame work is now an ECS Update system; dt comes
  // from the Time resource instead of a callback argument.
  // ── photo mode ───────────────────────────────────────────────────────────
  // Calibrating colour against the reference needs the SAME view twice, and a
  // snake that keeps swimming does not give you that. Three separate
  // measurements were invalidated by comparing frames shot at different camera
  // and sun angles before this existed. `__ps.freeze([x,y,z])` parks the head at
  // a chosen point on the sphere and stops the simulation while still rendering,
  // so before/after captures differ only by the change under test.
  // `boost` forces the Shift input on. CDP cannot deliver a modifier keydown to
  // the page, so without this the speed spray — the one effect that only exists
  // while boosting — could never be captured or measured, and it shipped
  // unverified for the whole of its first life.
  const photo = { frozen: false, god: false, boost: false, probeLight: false, coil: false, swirl: false };
  if (debugEnabled) {
    const debugWindow = window as unknown as Record<string, unknown>;
    // `?debug=1` is intentionally usable in a production build for capture
    // automation, but raw engine/game objects stay dev-only. The production
    // debug surface below returns diagnostics and named actions, never the
    // Renderer, World, component tokens or dynamic-mesh object themselves.
    if (import.meta.env.DEV) {
      debugWindow.__ribbon = playerRibbon;
      debugWindow.__world = world;
      debugWindow.__comp = { Transform, MeshFilter, MeshRenderer, Instances };
    }
    debugWindow.__ps = {
    /** `heading` is the travel direction, which the CAMERA depends on — it sits
     *  behind the head along -tan. Without it a capture can pin WHERE the snake
     *  is but not which way the camera looks, and view-dependent effects (the
     *  water sun glint above all) cannot be reproduced at all. Any vector works;
     *  it is projected into the tangent plane. */
    freeze(dir?: [number, number, number], heading?: [number, number, number]) {
      if (dir) {
        pos = norm(dir);
        const hv = heading ? norm(heading as V3) : cross(pos, [0, 1, 0]);
        const h = add(hv, scl(pos, -dot(pos, hv)));   // project into the tangent plane
        tan = norm(h[0] * h[0] + h[1] * h[1] + h[2] * h[2] > 1e-8 ? h : cross(pos, [1, 0, 0]));
        // Prefill a great-circle arc BEHIND the head. With a single-point
        // trail every finite difference in buildSpine is zero, the ring frames
        // degenerate, and the frozen body collapses into the head — which is
        // why frozen captures kept showing a lone bulb. (codex 5.6 finding #9)
        const back = length * SEG_SPACING + TRACK_ARC + 0.3;
        trail = [];
        for (let a = 0; a <= back + 1e-6; a += 0.02) {
          const c = Math.cos(a), sn = Math.sin(a);
          trail.push({ p: norm([pos[0] * c - tan[0] * sn, pos[1] * c - tan[1] * sn, pos[2] * c - tan[2] * sn]), s: back - a });
        }
        totalArc = back;
      }
      photo.frozen = true;
      placeHead(); placeBodySegments(); updateCamera(); syncEclipseAnchor();
      // The far field has to be re-packed here. updateSpaceParams is the LAST
      // statement of the update system, and photo mode returns from the top of
      // it — so without this the stars, the nebula, the atmosphere limb and the
      // sun all keep the camera from BEFORE the teleport. Every frozen capture
      // was rendering its background for a viewpoint the scene no longer had.
      if (spaceEntity !== undefined) updateSpaceParams(world, spaceEntity, spaceCam());
      return 'frozen';
    },
    thaw() { photo.frozen = false; return 'running'; },
    /** Turn collisions off. Capturing the body needs it long AND curved, which
     *  means letting the sim run — and a long snake in a field of bots dies
     *  before the shot lands. Several comparison frames were lost to that
     *  before this existed; the death overlay dims the whole scene, so the
     *  measurement is silently wrong rather than obviously wrong. */
    god(on = true) { photo.god = on; return photo.god; },
    /** Hold Shift from script. Also refills the bar each call so a capture is
     *  not cut short by the stamina lockout. */
    boost(on = true) { photo.boost = on; if (on) { boost = 1; boostCooldown = 0; } return photo.boost; },
    /** Fire Slough from script. The keyboard path is edge-triggered on Q; this
     *  exists because a capture harness cannot reliably deliver one. */
    shed() { tapShed = true; return 'queued'; },
    /** Hold/release Coilstrike from script — the capture harness cannot deliver
     *  a held Space. */
    ribbon() { return waterRibbon?.debug() ?? 'none'; },
    /** Isolation switch for the deform patch: dig a crater right here, with
     *  nothing else running. If this does not show, the patch is the problem
     *  and the skills are not. */
    dig(depth = 2.5, radius = 5) {
      deformStore.brush([headP[0], headP[1], headP[2]], radius, depth, depth * 0.6);
      return { dug: +deformStore.at(headP).toFixed(2), dirty: deformStore.dirty };
    },
    patch() { return deformSkin.debug(); },
    mute(on = true) { return deformSkin.mute(on); },
    exodus(force = true) {
      if (force && exodus.state === 'idle') {
        exodus.trigger(pickGateSpot, pos);
        hud.announce('有莫大恐怖接近！速速逃离！', 3.4);
      }
      return exodus.state;
    },
    exodusInfo() {
      return {
        state: exodus.state,
        gate: exodus.gateDir,
        foodFade: +exodus.foodFade.toFixed(2),
        since: +exodus.sinceActive.toFixed(1),
        startAngle: +exodus.startAngle.toFixed(3),
        drainScale: +exodus.drainScale.toFixed(3),
        len: length,
        debt: +exodusDebt.toFixed(2),
      };
    },
    /** Force 0..1 for capture; pass null to resume the live event timeline. */
    eclipse(t: number | null = 1) {
      eclipseOverride = t === null ? null : Math.max(0, Math.min(1, t));
      syncEclipseAnchor();
      if (spaceEntity !== undefined) updateSpaceParams(world, spaceEntity, spaceCam());
      return +eclipseProgress().toFixed(3);
    },
    eclipseInfo() {
      return {
        progress: +eclipseProgress().toFixed(3),
        natural: +exodus.eclipse.toFixed(3),
        forced: eclipseOverride,
        seconds: +exodus.sinceTrigger.toFixed(2),
        elevation: +eclipseElevation().toFixed(3),
        anchor: eclipseAnchor.map((v) => +v.toFixed(4)),
        gate: exodus.gateDir,
      };
    },
    /** How many props have been re-seated onto dug ground, and how far the
     *  furthest one moved. The direct check on props-follow-terrain. */
    seatedInfo() {
      let n2 = 0, mx = 0;
      for (const sp of seated) { if (Math.abs(sp.delta) >= 0.02) { n2++; mx = Math.max(mx, Math.abs(sp.delta)); } }
      return { moved: n2, maxDelta: +mx.toFixed(2), total: seated.length };
    },
    /** Force the FOV in degrees (0 = follow speed). The only way to check the
     *  engine even accepts a runtime projection change. */
    /** Live grain counts, the three systems separately. */
    grains() { return { bursts: bursts?.live() ?? 0, motes: motes?.live() ?? 0, dust: dust?.live() ?? 0, spray: spray?.live() ?? 0 }; },
    bank() { return { carve: +carve.toFixed(3), deg: +((-carve * CAM_ROLL_MAX * 180) / Math.PI).toFixed(2), camSpeed: +camSpeed.toFixed(2) }; },
    fov(deg = 0) { fovForce = deg; return { forced: deg, now: +((fovNow * 180) / Math.PI).toFixed(1), camSpeed: +camSpeed.toFixed(2) }; },
    /** Live colour grade, so the curve can be judged on the MOVING picture.
     *  Every still I compared the candidates on was shot in a different biome,
     *  and dry highland flatters a crushed curve that looks like dusk over
     *  grassland. mode: 0 none · 1 reinhard · 2 linear · 3 cineon · 4 ACES ·
     *  5 AgX · 6 neutral. */
    grade(mode = TONEMAP_NEUTRAL, exposure = 1.0) {
      world.set(camera, Camera, { tonemap: mode, exposure });
      return { tonemap: mode, exposure };
    },
    /** Ground radius and wetness at a direction — the two numbers every skill
     *  places itself with. */
    radial(d: [number, number, number]) {
      const u = norm(d);
      return { gr: +gr(u, 0).toFixed(3), wet: +wetness(u).toFixed(3),
               sea: +(PLANET_R + 0.05 + WATER_LIFT).toFixed(3) };
    },
    seam(on = true) { return waterPatch?.seamTest(on) ?? 'no patch'; },
    /** Ground truth that a graft edit actually reached the compiled shader.
     *  Every earlier "did it land" question was answered by reading a file on
     *  disk, which describes a different copy than the one the GPU is running. */
    shaderHas(id: string, needle: string) {
      const got = findMaterialArtifact(ctx?.renderer, id);
      const src = got?.ok ? got.value.source : undefined;
      return src === undefined ? 'no artifact' : { chars: src.length, has: src.includes(needle) };
    },
    /** Our update's own CPU cost, smoothed and peak, in milliseconds. */
    cpu() { return { updateMs: +upMs.toFixed(2), peakMs: +upPeak.toFixed(2) }; },
    /** One printable view of every engine seam this game depends on. */
    engineBridge() { return verifyEngineBridge(ctx?.renderer); },
    /** Sweep the framing empirically instead of guessing it. On a sphere the
     *  levers do not do what they sound like: LOWERING the camera shrinks the
     *  visible cap and shows MORE sky, and raising the lookahead aims further
     *  toward the horizon, which also shows more sky. */
    cam(h, back, look) {
      if (h !== undefined) BASE_CAM_HEIGHT = h;
      if (back !== undefined) BASE_CAM_BACK = back;
      if (look !== undefined) BASE_LOOKAHEAD = look;
      return { h: BASE_CAM_HEIGHT, back: BASE_CAM_BACK, look: BASE_LOOKAHEAD };
    },
    dent(on = true, d = 1.9, r = 5.0, rim = 1.05) {
      testDent = on ? { at: [headP[0], headP[1], headP[2]], r, d, rim } : undefined;
      return on ? { at: testDent!.at, d, r, rim } : 'cleared';
    },
    reskin() { deformSkin.rebuildAll(); return deformSkin.debug(); },
    /** Diff MY hand-built terrain buffer against the ENGINE's own expansion of
     *  the same source. The transport is now proven clean (a byte-identical
     *  re-upload changes 0.36% of the screen), so any remaining corruption is in
     *  the buffer, and this says exactly which field. */
    skinDiff() {
      const ref = (meshFromInterleaved(surf.verts, surf.indices) as { vertices: Float32Array }).vertices;
      const mine = deformSkin.peek();
      if (!mine) return 'no buffer yet — call __ps.reskin() first';
      const n = Math.min(ref.length, mine.length);
      const worst = [0, 0, 0, 0]; // pos, nrm, uv, tan
      let firstBad = -1;
      for (let k = 0; k < n; k++) {
        const f = k % 12;
        const d = Math.abs(ref[k]! - mine[k]!);
        const slot = f < 3 ? 0 : f < 6 ? 1 : f < 8 ? 2 : 3;
        if (d > worst[slot]!) worst[slot] = d;
        if (slot === 0 && d > 0.01 && firstBad < 0) firstBad = k;
      }
      return {
        lengths: [ref.length, mine.length],
        maxDiff: { pos: +worst[0]!.toFixed(4), nrm: +worst[1]!.toFixed(4), uv: +worst[2]!.toFixed(4), tan: +worst[3]!.toFixed(4) },
        firstBadPosFloat: firstBad,
        firstBadVertex: firstBad < 0 ? -1 : Math.floor(firstBad / 12),
      };
    },
    /** THE decisive isolation for the terrain write-back. Re-expands the SAME
     *  8-float source buildSurfaceMesh produced, through the SAME helper the
     *  mesh was created with, and pushes that. If the planet is unchanged the
     *  transport is fine and my hand-built buffer was wrong; if it mangles, the
     *  transport is. Nothing else distinguishes the two. */
    reskinExact() {
      const again = meshFromInterleaved(surf.verts, surf.indices) as { vertices: Float32Array };
      if (!updateMesh(ctx?.renderer, surfaceMeshHandle, again.vertices, surf.indices)) return 'no updateMesh';
      return { floats: again.vertices.length, perVertex: again.vertices.length / ((SURF_WS + 1) * (SURF_HS + 1)) };
    },
    sweep() { if (!sweep) return 'none'; const a = 2.4 / PLANET_R;
      const c4 = Math.cos(a), s4 = Math.sin(a);
      sweep.trigger([headP[0]*c4+headF[0]*s4, headP[1]*c4+headF[1]*s4, headP[2]*c4+headF[2]*s4], headF);
      return 'cast'; },
    /** Dug depth right under a direction, world units — the direct read on
     *  whether the ground actually moved. */
    dug(aheadUnits = 6) {
      const a = aheadUnits / PLANET_R, c4 = Math.cos(a), s4 = Math.sin(a);
      const d: V3 = norm([headP[0]*c4+headF[0]*s4, headP[1]*c4+headF[1]*s4, headP[2]*c4+headF[2]*s4]);
      return { at: +deformStore.at(d).toFixed(3), dirty: deformStore.dirty,
        sweepOn: sweep?.active ?? false, crest: +(sweep?.height ?? 0).toFixed(2) };
    },
    /** Fire Bloom from script, ignoring the tap edge but NOT the water gate —
     *  a debug hook that skips the one condition the skill is about would be
     *  testing a different skill. Returns why it refused. */
    bloom(force = false) {
      if (!bloom) return 'no bloom';
      if (!force && !bloomOk) return bloomCool > 0 ? 'cooling ' + bloomCool.toFixed(1) : 'not over water';
      bloom.trigger(bloomTarget, PLANET_R + 0.05 + WATER_LIFT);
      bloomCool = BLOOM_COOLDOWN;
      return 'cast';
    },
    bloomState() {
      return {
        ok: bloomOk, cool: +bloomCool.toFixed(2),
        wet: +wetness(bloomTarget).toFixed(2),
        active: bloom?.active ?? false,
        top: +(bloom?.top ?? 0).toFixed(2),
        crater: +(bloom?.crater ?? 0).toFixed(2),
      };
    },
    /** Hold/release the Ribbon from script. */
    swirl(on = true) { photo.swirl = on; return photo.swirl; },
    coil(on = true) { photo.coil = on; if (on) boost = 1; return photo.coil; },
    /** The body's NOMINAL length (the course arc it is drawn over) against its
     *  TRUE length along the ground (the wiggly track it is actually drawn on),
     *  both world units. They differ by however much the undulation is
     *  throwing the body sideways, and the ratio is the thing to watch when a
     *  skill changes the wave. */
    /** How far the body strays from the polyline the wake is actually drawn
     *  from — the same segment distance wakeField() computes, in world units.
     *  This is the direct read on "the body does not lie in its own trail". */
    wakeGap() {
      const w = buildWakeSamples();
      const pts: V3[] = [];
      for (let i = 0; i < WAKE_SAMPLES; i++) {
        if (w[i * 4 + 3]! > 1.5) continue;
        pts.push(norm([w[i * 4]!, w[i * 4 + 1]!, w[i * 4 + 2]!]));
      }
      if (pts.length < 2) return { gap: -1, spacing: -1 };
      // Per-ring, reported as a profile down the body. A single max is useless
      // here: the wake deliberately starts 10% of its arc BEHIND the head, so
      // the head is always far from the polyline by design and a max just
      // reports that gap forever. (It did — 2.6 units at cruise and coiling
      // alike, which is the head gap, not a defect.)
      const prof: number[] = [];
      let worst = 0;
      for (let c = 0; c < lastRings; c++) {
        const n = spinePts[c]!;
        let best = 9;
        for (let j = 0; j < pts.length - 1; j++) {
          const a = pts[j]!, b = pts[j + 1]!;
          const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const den = Math.max(ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, 1e-8);
          const u = Math.min(1, Math.max(0, ((n[0] - a[0]) * ab[0] + (n[1] - a[1]) * ab[1] + (n[2] - a[2]) * ab[2]) / den));
          const q = norm([a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u]);
          const d = Math.hypot(n[0] - q[0], n[1] - q[1], n[2] - q[2]);
          if (d < best) best = d;
        }
        prof.push(+(best * PLANET_R).toFixed(2));
        // Skip the head gap: only rings past 20% of the body can be expected to
        // lie in the wake at all.
        if (c > lastRings * 0.2 && best > worst) worst = best;
      }
      let sp = 0;
      for (let j = 0; j < pts.length - 1; j++) {
        sp += Math.acos(Math.min(1, Math.max(-1, dot(pts[j]!, pts[j + 1]!))));
      }
      const at = (f: number) => prof[Math.min(prof.length - 1, Math.round(f * (prof.length - 1)))];
      return {
        gap: +(worst * PLANET_R).toFixed(2),
        spacing: +((sp / (pts.length - 1)) * PLANET_R).toFixed(2),
        // Down the body: head, quarter, mid, three-quarter, tail.
        prof: [at(0), at(0.25), at(0.5), at(0.75), at(1)],
      };
    },
    bodyLen() {
      let L = 0;
      for (let c = 1; c < lastRings; c++) {
        const a = spinePts[c - 1]!, b = spinePts[c]!;
        L += Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * PLANET_R;
      }
      const nominal = (length - 1) * SEG_SPACING * PLANET_R;
      return { nominal: +nominal.toFixed(2), track: +L.toFixed(2), ratio: +(L / Math.max(1e-6, nominal)).toFixed(3) };
    },
    /** Drop a pellet a given number of world units from the vortex centre, so
     *  the gathering can be measured instead of waited for — there are only six
     *  pellets on the whole planet and the odds one is in reach are poor. */
    /** Fire a strike at an EXACT charge fraction. The keyboard path measures
     *  the hold in real time, which a capture harness whose cheapest action
     *  costs half a second cannot produce short enough to test. */
    strike(charge = 1) {
      coilHold = Math.min(COIL_FULL, Math.max(0, charge)) * COIL_FULL;
      photo.coil = false;
      return { charge, willLast: +(STRIKE_TIME * (1 + (STRIKE_STRETCH - 1) * charge * charge)).toFixed(3) };
    },
    /** Temporary probe: declare a bright point light at the head, so the
     *  "engine point lights reach a grafted material" claim can be MEASURED
     *  rather than assumed. */
    probeLight(on = true) { photo.probeLight = on; return photo.probeLight; },
    /** No-op, kept so existing capture scripts keep working. The wake puffs it
     *  used to switch off are gone: they were the early white-dot effect and
     *  read as debris trailing the snake. */
    nowake() { return 'wake removed'; },
    /** Identifies THIS page load. `location.href = ...` returns before the old
     *  document is torn down, so a poll for `typeof __ps !== 'undefined'` can
     *  succeed against the OUTGOING page — god mode then gets set on a context
     *  that is about to be discarded, and the fresh snake dies unprotected. A
     *  nonce lets the caller prove it is talking to the page it just asked for. */
    nonce() { return new URLSearchParams(location.search).get('nonce') ?? ''; },
    /** Fire a burst just ahead of the head. Bursts are event-driven, so without
     *  this a capture has to wait for the snake to happen to eat something —
     *  which is why the first verification sequence caught nothing but the
     *  pellets' own glow. */
    spark(n = 40) {
      const ahead = norm(add(pos, scl(tan, 0.05)));
      bursts?.emit(ahead, gr(ahead, 0.15), n, clock, 1);
      return n;
    },
    /** Where the bots are, so a capture can be AIMED at one.
     *
     *  Every grounding check until now was a shot of the player from directly
     *  behind — the one angle where a floating body is invisible, because the
     *  camera looks along the tube. The bots are the honest test: they are seen
     *  side-on at a distance, and that is where a gap under the body shows. */
    bots() { return bots.filter((b) => b.alive).map((b) => ({ pos: b.pos, tan: b.tan, len: b.len })); },
    // Put a bot `units` from the vortex, moving ACROSS it rather than at it, so
    // any inward bend that follows is the drag and nothing else. Waiting for a
    // wandering bot to drift into range is not a test, it is a coincidence.
    // Each live bot's distance to the vortex in world units, and how far its
    // heading is off a straight line to it — the direct read on whether the
    // drag is bending anyone.
    /** Park the player far away and aim the camera at a point, so a bot can be
     *  framed side-on without the player's own body filling the shot. */
    look(target: [number, number, number], back = 0.10) {
      const t = norm(target);
      const ref: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const side = norm(cross(t, ref));
      const from = norm([t[0] - side[0] * back, t[1] - side[1] * back, t[2] - side[2] * back]);
      const head = norm([t[0] - from[0], t[1] - from[1], t[2] - from[2]]);
      return this.freeze(from as [number, number, number], head as [number, number, number]);
    },
    /** Grow the body without having to actually feed it — the swept tube reads
     *  differently at length 4 and at length 20, and the reference snakes are
     *  long. The trail needs a moment of simulation to fill out behind the head,
     *  so thaw, wait, then freeze. */
    grow(n: number) { length += n; return length; },
    ring(_which = 'player', ci = 0) {
      const rb = playerRibbon;
      if (!rb) return 'absent';
      const p3 = rb.debugRing(ci);
      const rad: number[] = [];
      for (let i = 0; i + 2 < p3.length; i += 3) rad.push(Math.hypot(p3[i]!, p3[i + 1]!, p3[i + 2]!));
      const bad = rad.filter((r) => !Number.isFinite(r)).length;
      return { ci, n: rad.length, minR: Math.min(...rad), maxR: Math.max(...rad), nonFinite: bad };
    },
    /** Loop health: frames entered vs frames that reached the body update. */
    ticks() {
      return {
        frames: frameTicks, body: bodyTicks,
        speed: +(curSpeedNow / BASE_SPEED).toFixed(2), urge: +slitherUrge.toFixed(2),
        grade: +terrainGrade.toFixed(3), terrainMul: +terrainSpeedMul.toFixed(3),
        iceW: +terrainIceW.toFixed(3),
        arc: +totalArc.toFixed(2),
        // Heading and wetness, so a capture script can VERIFY the water
        // steering penalty rather than trust the multiplier: hold a turn key
        // for a fixed time on each surface and compare the swept angle.
        tan: tan.map((v) => +v.toFixed(4)),
        wet: +wetness(pos).toFixed(3),
        len: length, alive, god: photo.god,
        skin: slough ? { made: !!slough.alive, age: +slough.age.toFixed(2) } : 'no-slough',
        coil: +coilHold.toFixed(2), strikeFor: +strikeFor.toFixed(2), striking: +striking.toFixed(2),
      };
    },
    /** Sample the land field so a capture can be aimed at water or at land. */
    isLandAt(dir: [number, number, number]) { return isLand(norm(dir)); },
    /** Every prop that was planted, biggest first. Aiming a shot needs to know
     *  where a ROCK is — hunting for one in wide shots is how two rounds of
     *  "the rocks look fine" got signed off on frames that contained none. */
    props(match = '') {
      return planted
        .filter((p) => p.name.includes(match))
        .sort((a, b) => b.size - a.size)
        .map((p) => ({ name: p.name, dir: p.dir, size: +p.size.toFixed(2) }));
    },
    };
    ctx?.registerCleanup?.(() => {
      delete debugWindow.__ps;
      delete debugWindow.__ribbon;
      delete debugWindow.__world;
      delete debugWindow.__comp;
    });
  }

  let frameTicks = 0;
  /** deformSkin push count last time props were re-seated. */
  let propSeatPushes = 0;
  let bodyTicks = 0;
  world.addSystem(Update, {
    name: 'planet-snake-update',
    queries: [],
    fn: () => {
      frameTicks++;
      frameInput = ctx?.renderer?.input.snapshot(world);
      sampleInputEdges();
      // PROPS FOLLOW THE GROUND. The deform store moves terrainHeight, and
      // everything placed at boot was seated against the ORIGINAL ground — so
      // a Sweep channel or a crater cut beside a pine left it standing on air
      // at its old height (photographed: trunk hanging over the pit). Cheap by
      // construction: at() is a lattice read, the scan only runs on frames
      // where an upload actually happened, and a Transform is written only for
      // props whose ground truly moved.
      if (deformSkin.debug().pushes !== propSeatPushes) {
        propSeatPushes = deformSkin.debug().pushes;
        for (const sp of seated) {
          const d = deformStore.at(sp.n);
          if (Math.abs(d - sp.delta) < 0.02) continue;
          sp.delta = d;
          const p2 = scl(sp.n, gr(sp.n, sp.above));
          for (const e of sp.ents) world.set(e, Transform, { pos: p2 });
        }
      }
      // DECLARED BEFORE THE FROZEN BRANCH USES IT. The branch calls
      // waterRibbon/bloom/sweep with dt, and with the declaration after the
      // branch every frozen frame died on the TDZ at its first dt reference —
      // silently, because the engine swallows system errors. Nothing after
      // that line ran while frozen: no skill ticks, no deformSkin.flush(), so
      // a dig in photo mode sat in the store and never reached the GPU.
      // Fourth TDZ in this file; the pattern is always "const declared after
      // an early-exit branch that reads it".
      const dt = Math.min(world.getResource(Time).delta, 0.05);
      if (photo.frozen) {
        // Photo mode freezes the SIMULATION, not the CLOCK. The ocean's motion
        // lives in the post pass and is driven by the params' time field, which
        // only this call pushes — so returning here outright made a frozen frame
        // the one place the water was provably static, which is precisely where
        // its motion has to be checked. Keeping the clock running also means a
        // held frame shows the sea alive rather than as a still.
        clock += Math.min(world.getResource(Time).delta, 0.05);
        // The sheet is CPU geometry: photo mode must keep rebuilding it or a
        // frozen frame shows the one thing this patch exists to remove — a
        // static sea.
        waterPatch?.update(pos, clock, buildWakeSamples(), slitherUrge, buildDents());
        // Photo mode still ticks it: a held ribbon that stops moving while the
        // world is frozen is the one thing a freeze must not change about it.
        waterRibbon?.update(dt, clock,
          [headP[0] * gr(headP, 0.35), headP[1] * gr(headP, 0.35), headP[2] * gr(headP, 0.35)],
          headF, camRight, camUp, (d) => gr(d, 0), undefined);
        bloom?.update(dt, (d) => gr(d, 0), undefined,
          (at, radius, col, inten) => { skillLights?.add(at, radius, col, inten); });
        deformSkin.flush();
        sweep?.update(dt, (d) => gr(d, 0), wetness, deformStore, undefined,
          (at, radius, col, inten) => { skillLights?.add(at, radius, col, inten); });
          // Skills tick in photo mode too. Same reason the water patch does: a
        // held frame is exactly where an effect gets inspected, and a frozen
        // frame that silently drops a skill is the one frame where the thing
        // under test is guaranteed absent. The shed skin in particular has its
        // own 16-second clock that must keep running, or photo mode freezes it
        // mid-peel and the capture shows a state the game never reaches.
        slough?.update(Math.min(world.getResource(Time).delta, 0.05));
        declareSkillLights();
        syncEclipseAnchor();
        if (spaceEntity !== undefined) updateSpaceParams(world, spaceEntity, spaceCam());
        return;
      }
    clock += dt;

    // Pellet idle animation: gentle pulse + slow spin (runs even while dead).
    const pulse = (1 + 0.14 * Math.sin(clock * 4)) * (0.15 + 0.85 * exodus.foodFade);
    for (let i = 0; i < FOOD_COUNT; i++) {
      const f = foods[i];
      if (!f) continue;
      world.set(foodEs[i]!, Transform, {
        pos: scl(norm(f), gr(norm(f), FOOD_R)),   // the pulse used to RESET height to the smooth sphere — pellets on hills sank every frame (codex #2)
        quat: lookQuat(tan, f),
        scale: [pulse, pulse, pulse],
      });
    }

    // Dropped-pellet idle animation: faster, slightly bouncier pulse.
    const dropPulse = 1 + 0.2 * Math.sin(clock * 5 + 1);
    for (const d of drops) {
      if (!d.active) continue;
      world.set(d.e, Transform, { pos: scl(d.pos, gr(d.pos, DROP_R)), quat: lookQuat(tan, d.pos), scale: [dropPulse, dropPulse, dropPulse] });
    }


    // Restart via R (works whether alive or on the game-over screen).
    const restartPressed = keyRestart();
    if (restartPressed && !restartArmed && !alive) { photo.god = false; resetGame(); restartArmed = true; }
    if (!restartPressed) restartArmed = false;

    if (!alive) return;

    // — steer: rotate the forward tangent around the head's up axis (pos) —
    let steer = 0;
    // Locked mid-strike. Ballistic is the whole risk profile that separates this
    // from the boost: boost is steerable and disengageable, a strike is neither.
    if (striking <= 0) {
      if (keyLeft()) steer += 1;
      if (keyRight()) steer -= 1;
    }
    // BANK. the reference's rig rolls with `carve` — measured there at about
    // -0.11 rad per unit carve, roughly 6.5 deg at full lock — and it is a big
    // part of why a turn there reads as leaning into it rather than as the
    // scenery rotating. Ours had no roll at all. Speed-scaled the same way
    // (their carve is 0 at walking pace), but not gated to zero at cruise:
    // cruise IS our normal, and a turn that only banks while boosting would
    // spend most of the game flat. `steer` is already locked to 0 mid-strike,
    // so a dash stays ballistic and level, which is the read we want.
    // ── 地形对手感的影响 ─────────────────────────────────────────────────
    // 每帧采一次，转向和速度共用。放在转向之前是因为两者都要读它。
    //
    // 用 regionAt 的**软权重**混合而不是 argmax 硬切：区域边界上硬切会读作
    // 撞了一堵看不见的墙，而权重本来就是连续的（Stage 2 的软化就是为这个）。
    {
      // 沿当前朝向的有符号坡度：上坡为正。terrain-gate 里那个 slopeAt 是八方向
      // 取最陡的无符号量，用在这里会让平地也一直减速。
      const stepAhead = 0.02;
      const ahead = norm([
        pos[0] + tan[0] * stepAhead, pos[1] + tan[1] * stepAhead, pos[2] + tan[2] * stepAhead,
      ]);
      const grade = (gr(ahead, 0) - gr(pos, 0)) / (stepAhead * PLANET_R);
      terrainGrade += (grade - terrainGrade) * Math.min(1, dt * GRADE_SMOOTH);
      const w = regionAt(pos);
      terrainIceW = w.iceCap;
      terrainSpeedMul = Math.max(GRADE_SLOW_MAX, Math.min(GRADE_FAST_MAX,
        1 - GRADE_GAIN * terrainGrade)) * (1 - DRY_DRAG * w.dry);
    }
    {
      const target = steer * (0.55 + 0.45 * Math.min(1, Math.max(0, (camSpeed - 1) / 1.5)));
      carve += (target - carve) * Math.min(1, 1 - Math.exp(-dt / 0.22));
    }
    if (steer !== 0) {
      // 冰面打滑和水面钝转向叠乘：两者都是"抓地力变差"，冰盖上再入水应该更滑。
      const a = steer * TURN_SPEED * (1 - (1 - WATER_TURN) * wetness(pos))
        * (1 - ICE_SLIP * terrainIceW) * dt;
      const c = Math.cos(a), s = Math.sin(a);
      const k = cross(pos, tan);   // ⟂ to both, lies in the tangent plane
      tan = norm([
        tan[0] * c + k[0] * s,
        tan[1] * c + k[1] * s,
        tan[2] * c + k[2] * s,
      ]);

    }

    // — boost (Shift): hold to spend the stamina bar for a burst; draining it
    //   fully triggers a cooldown lockout before it can be used again —
    if (boostCooldown > 0) boostCooldown = Math.max(0, boostCooldown - dt);
    const boosting = keyBoost() && boost > 0 && boostCooldown <= 0;
    if (boosting) {
      boost = Math.max(0, boost - dt / BOOST_DURATION);
      if (boost <= 0) boostCooldown = BOOST_COOLDOWN;   // fully drained → lock out
    } else {
      boost = Math.min(1, boost + dt / BOOST_REFILL);
    }
    hud.setBoost(boost, boostCooldown > 0);
    hud.setPerf(showPerf, 1000 / Math.max(1e-3, frameMs), frameMs, upMs);
    hud.setSkills({
      bloom: bloomOk,
      sweep: alive && sweepCool <= 0,
      shed: !!slough && !slough.alive && length >= SHED_MIN,
      coil: striking > 0 ? 1 : coilHold / COIL_FULL,
      swirl: true,
    });

    // — advance along the geodesic —
    // ── Coilstrike ──────────────────────────────────────────────────────────
    // Gathering compresses the TRACK: the wavelength halves and the amplitude
    // grows, so the same arc of body stacks into half the ground distance and
    // the snake bunches into a tight S. Because the phase is integrated rather
    // than derived from totalArc, the gear change is continuous — computing it
    // from totalArc would teleport the wave the instant lambda moved.
    let coilSpeed = 1;
    if (striking > 0) {
      striking = Math.max(0, striking - dt);
      // The strike is STRAIGHT. A snake gathers in an S and lands in a line;
      // easing the amplitude back in over the follow-through is the whip-crack.
      // Normalised against THIS strike's length, not the constant: a long
      // strike must whip out over its whole flight, not snap straight in the
      // first quarter of it and then coast.
      const k = 1 - striking / Math.max(strikeFor, 1e-3);
      coilAmp = k * k;
      coilLambda = 1;
      coilSpeed = STRIKE_SPEED * (1 - 0.45 * k);
    } else if (alive && keyCoil() && boost >= STRIKE_COST) {
      coilHold = Math.min(COIL_FULL, coilHold + dt);
      const t = coilHold / COIL_FULL;
      coilLambda = 1 - (1 - COIL_LAMBDA) * t;
      coilAmp = 1 + (COIL_AMP - 1) * t;
      coilSpeed = 1 - (1 - COIL_SLOW) * t;
    } else {
      if (coilHold >= COIL_MIN && alive) {
        // Release. The charge sets the reach; the cost is the same bar boost
        // spends, so a strike is always escape fuel you no longer have.
        const charge = coilHold / COIL_FULL;
        striking = STRIKE_TIME * (1 + (STRIKE_STRETCH - 1) * charge * charge);
        strikeFor = striking;
        strikeAge = 0;
        boost = Math.max(0, boost - STRIKE_COST);
        (isLand(headP) ? dust : spray)?.emit(
          headP, gr(headP, 0.12), 34, clock, isLand(headP) ? 0.8 : 1.0,
          [headF[0] * 0.9, headF[1] * 0.9, headF[2] * 0.9], 1.6);
      }
      coilHold = 0;
      // Ease back rather than snap: a spring that returns instantly reads as a
      // parameter change, which is exactly what it must not read as.
      coilLambda += (1 - coilLambda) * Math.min(1, dt * 9);
      coilAmp += (1 - coilAmp) * Math.min(1, dt * 9);
    }

    // The gate's field slows the final approach — folded into the declaration
    // because curSpeed is const; the first wiring reassigned it and the
    // TypeError killed every statement after it, silently, each frame.
    const exodusField = exodus.state === 'active' && exodus.gateDir && alive
      ? exodus.fieldAt(pos) : ([0, 1] as [number, number]);
    const curSpeed = speed * (boosting ? BOOST_MULT : 1) * (shedBurst > 0 ? 1.5 : 1)
      * coilSpeed * exodusField[1] * terrainSpeedMul;

    // ── Ribbon (水鞭) ───────────────────────────────────────────────────────
    // Held on E. The tip is driven; the body is the record of where the tip has
    // been. Releasing THROWS it — see src/waterribbon.ts for why that is a
    // different thing from dropping it.
    const ribbonWant = alive && keyRibbon();
    if (waterRibbon) {
      if (ribbonWant && !ribbonHeldPrev) {
        const hr = gr(headP, 0.35);
        waterRibbon.trigger([headP[0] * hr, headP[1] * hr, headP[2] * hr]);
      } else if (!ribbonWant && ribbonHeldPrev) {
        // LOBBED, not fired flat. the reference tilts its aim up by 0.18 because a
        // thrown body has to arc; ours needs far more than that for a reason
        // that is about the camera rather than the water. Their view is
        // horizontal, so a flat throw crosses the screen. Ours trails the snake,
        // so a throw along the heading goes straight into the depth of the
        // frame and foreshortens to nothing — the same failure their own note
        // warns about ("a nine metre ribbon seen end-on is nine metres of
        // nothing"). Sending it UP puts the whole arc broadside.
        const up = headP;
        waterRibbon.release(norm([
          headF[0] + up[0] * 0.50, headF[1] + up[1] * 0.50, headF[2] + up[2] * 0.50,
        ]));
      }
      ribbonHeldPrev = ribbonWant;
    }

    // ── Sweep (裂地) ────────────────────────────────────────────────────────
    // Tap C. Launched ahead of the head and left to run — it is thrown, not
    // driven, so where it ends up is decided at the moment you fire it.
    sweepCool = Math.max(0, sweepCool - dt);
    if (tapSweep) {
      tapSweep = false;
      if (alive && sweepCool <= 0 && sweep) {
        const a = 2.4 / PLANET_R;
        const ca4 = Math.cos(a), sa4 = Math.sin(a);
        sweep.trigger([
          headP[0] * ca4 + headF[0] * sa4,
          headP[1] * ca4 + headF[1] * sa4,
          headP[2] * ca4 + headF[2] * sa4,
        ], headF);
        sweepCool = SWEEP_COOLDOWN;
      }
    }

    // ── Bloom (涌泉) ────────────────────────────────────────────────────────
    // Tap F. Lands ahead of the head, and REFUSES ON LAND — the one skill with
    // a terrain condition, because it erupts the sea and there has to be sea to
    // erupt. The target is tested, not the snake: standing on the beach and
    // firing out over the water is exactly the shot this should allow, and
    // gating on where the SNAKE is would forbid it for no reason a player could
    // guess.
    bloomCool = Math.max(0, bloomCool - dt);
    {
      const ang = BLOOM_REACH / PLANET_R;
      const ca3 = Math.cos(ang), sa3 = Math.sin(ang);
      bloomTarget = norm([
        headP[0] * ca3 + headF[0] * sa3,
        headP[1] * ca3 + headF[1] * sa3,
        headP[2] * ca3 + headF[2] * sa3,
      ]);
      bloomOk = alive && bloomCool <= 0 && wetness(bloomTarget) > 0.55;
      if (tapBloom) {
        tapBloom = false;
        if (bloomOk && bloom) {
          bloom.trigger(bloomTarget, PLANET_R + 0.05 + WATER_LIFT);
          bloomCool = BLOOM_COOLDOWN;
        }
      }
    }

    // ── exodus: 有莫大恐怖接近 ──
    // Earned, not triggered: the event fires when the snake is long enough.
    // A `B` shortcut used to start it early for demos, and it granted the run
    // a free jump to length 30 so the burn would read on a short snake --
    // fine while the only audience was us, wrong in a public build.
    if (exodus.state === 'idle' && alive && length >= EXODUS_LEN) {
      exodus.trigger(pickGateSpot, pos);
      hud.announce('有莫大恐怖接近！速速逃离！', 3.4);
    }
    if (exodus.update(dt) === 'spawned' && exodus.gateDir) {
      clearGateLanding(exodus.gateDir as V3);
      spawnGateVisual(exodus.gateDir as V3);
    }
    if (exodus.state === 'active' && exodus.gateDir && alive) {
      const gd = exodus.gateDir as V3;
      // God mode still burns: photo.god is only a debug collision/death hook,
      // not an exemption from the event's body-cost mechanic.
      exodusDebt += exodusField[0] * dt;
      // DISSOLUTION READS ON THE WHOLE BODY, not the tail. The camera centres
      // on the head; a tail-only effect happens entirely off the player's
      // fovea and the burn felt like a silent number. A steady sprinkle of
      // motes at RANDOM arcs along the body keeps the loss on screen wherever
      // they are looking. Rate scales with the local field so the door's tax
      // is visibly heavier.
      // STRATIFIED ALONG THE WHOLE BODY, and dense. The first pass picked 2-4
      // random arcs every 0.14 s — about 40 grains a second spread over a body
      // that can be a hundred units long, which is a grain every few metres
      // every few seconds. Random sampling also clumps, so the sparse budget
      // was wasted twice over.
      //
      // Now: one slot per ~2.2 units of body, each slot emitting on its own
      // schedule, with the sample jittered INSIDE its slot rather than drawn
      // over the whole length. Even coverage, no clumping, and the count
      // scales with the snake so a long one shears everywhere at once.
      exodusMoteT += dt;
      if (exodusMoteT > 0.05) {
        exodusMoteT = 0;
        // Clamped to the trail we ACTUALLY have. `length` can outrun the
        // recorded path (a fresh grow, or the event firing early in a run), and
        // sampleTrail clamps past its end — so every over-long slot collapsed
        // onto the same tail point and the sprinkle became one blinking dot.
        const bodyArc = Math.max(1e-4, Math.min((length - 1) * SEG_SPACING, totalArc));
        const bodyWorld = bodyArc * PLANET_R;
        const slots = Math.max(3, Math.min(56, Math.round(bodyWorld / 2.2)));
        // The gate's tax shows as a heavier shed, not just a faster number.
        const heat = 1 + 1.6 * ((1 - exodusField[1]) / EXODUS_SLOW_MAX_LOCAL);
        for (let m = 0; m < slots; m++) {
          if (Math.random() > 0.42 * heat) continue;
          const u = (m + Math.random()) / slots;
          const at = sampleTrail(totalArc - u * bodyArc);
          motes?.emit(at, gr(at, 0.34), 2, clock, 1, undefined, 0.42);
        }
      }
      // The field made visible: gold motes drawn INWARD toward the gate along
      // the ground, and the ground disc breathing.
      exodusDriftT += dt;
      if (exodusDriftT > 0.18) {
        exodusDriftT = 0;
        for (let m = 0; m < 2; m++) {
          const a2 = Math.random() * Math.PI * 2;
          const r2 = (4 + Math.random() * 6) / PLANET_R;
          const ax = Math.abs(gd[1]) > 0.9 ? [1, 0, 0] as V3 : [0, 1, 0] as V3;
          const t1 = norm(cross(gd, ax));
          const t2 = cross(gd, t1);
          const c2 = Math.cos(r2), s2 = Math.sin(r2);
          const off: V3 = [
            gd[0] * c2 + (t1[0] * Math.cos(a2) + t2[0] * Math.sin(a2)) * s2,
            gd[1] * c2 + (t1[1] * Math.cos(a2) + t2[1] * Math.sin(a2)) * s2,
            gd[2] * c2 + (t1[2] * Math.cos(a2) + t2[2] * Math.sin(a2)) * s2,
          ];
          const on = norm(off);
          const gp = scl(gd, gr(gd, 1.2));
          const op = scl(on, gr(on, 0.5));
          const v: V3 = [
            (gp[0] - op[0]) * 0.35, (gp[1] - op[1]) * 0.35, (gp[2] - op[2]) * 0.35,
          ];
          bursts?.emitAt(on, gr(on, 0.5), v, clock, 1);
        }
      }
      while (exodusDebt >= 1 && length > EXODUS_MIN_LEN) {
        exodusDebt -= 1;
        length -= 1;
        const tail = sampleTrail(totalArc - (length - 1) * SEG_SPACING);
        motes?.emit(tail, gr(tail, 0.34), 14, clock, 1, undefined, 0.5);
        hud.setLength(length);
      }
      // Running dry KILLS, demo or not. Waiving it left the snake parked at
      // three segments forever with the debt climbing without bound — no death,
      // no end, and no reason to hurry.
      if (length <= EXODUS_MIN_LEN && exodusDebt >= 1 && !photo.god) {
        gameOver('⚰️ 身死道消……');
      }
      // Nothing consumes debt once the body is at the floor; without this it
      // grows for as long as the run lasts.
      if (length <= EXODUS_MIN_LEN) exodusDebt = Math.min(exodusDebt, 1.5);
      if (
        alive &&
        Math.acos(Math.max(-1, Math.min(1, dot(pos, gd)))) < GATE_ENTER_ANG
      ) {
        exodus.markPassed();
        score += length * 50;
        hud.setScore(score);
        gameOver('🌌 残躯得渡，穿过了黑暗之门');
      }
    }

    curSpeedNow = curSpeed;
    // SPEED -> CAMERA, smoothed asymmetrically.
    //
    // the reference pulls its FOV from 1.02 rad to 1.21 rad (58.4 -> 69.4 deg) as the
    // surf accelerates, and that widening is most of why 19 m/s reads as fast
    // rather than as the same shot with faster scenery. Ours was a fixed 60 deg.
    // Our speed range is narrower (cruise 1.00, boost 1.85, dash peak 2.98,
    // measured) so the swing is smaller, but the attack has to be much quicker:
    // a dash lasts under a second, and a symmetric follow would still be opening
    // as the dash ended. Fast in, slow out — the frame punches open and settles.
    {
      const target = curSpeed / BASE_SPEED;
      const tau = target > camSpeed ? 0.09 : 0.40;
      camSpeed += (target - camSpeed) * Math.min(1, 1 - Math.exp(-dt / tau));
    }
    // ~0.25 s to catch up. Fast enough that a boost still feels immediate, slow
    // enough that the body eases into the wider swing instead of jumping.
    slitherUrge += (curSpeed / BASE_SPEED - slitherUrge) * Math.min(1, dt * 4.5);
    // Advance in SUB-STEPS, recording a trail point at each.
    //
    // sampleTrailArr slerps between adjacent trail points, so the path is only
    // C0: the direction turns a corner at every recorded point. One point per
    // frame makes the spacing proportional to speed — under boost it nearly
    // doubles, the corners get correspondingly blunter, and the body visibly
    // hitches as each ring slides past one. Capping the step decouples trail
    // resolution from both speed and frame rate, so a boosting snake is exactly
    // as smooth as a cruising one. It costs one or two extra points a frame.
    //
    // The body, the water wake and the land trail all read this trail, so they
    // all get the smoother path.
    // Thrust pulses TWICE per wavelength — a snake pushes hardest when its body
    // is most angled to the track, and that periodic surge is a large part of
    // what separates pushing off the ground from gliding. Small on purpose.
    const dTheta = curSpeed * dt * thrustPulse();
    const sub = Math.max(1, Math.ceil(dTheta / TRAIL_STEP));
    const step = dTheta / sub;
    const c = Math.cos(step), s = Math.sin(step);
    for (let k = 0; k < sub; k++) {
      const np = norm([pos[0] * c + tan[0] * s, pos[1] * c + tan[1] * s, pos[2] * c + tan[2] * s]);
      const nt = norm([-pos[0] * s + tan[0] * c, -pos[1] * s + tan[1] * c, -pos[2] * s + tan[2] * c]);
      pos = np; tan = nt;
      totalArc += step;
      slitherPhase += step * slitherK();
      // Recomputed per SUB-STEP, not once per frame: the wave is a function of
      // arc, and at boost speed a frame covers a good fraction of a wavelength.
      const hp = headPose();
      headP = hp.p; headF = hp.f;
      trail.unshift({ p: headP, s: totalArc });
    }

    // — trim the tail we no longer need —
    const keepArc = length * SEG_SPACING + 0.4 + TRACK_ARC;
    while (trail.length > 2 && trail[trail.length - 1]!.s < totalArc - keepArc) trail.pop();


    // — speed spray —
    // Rate is zero at cruise and ramps with speed, so it reads as an effect OF
    // going fast rather than as permanent exhaust. Thrown backward along the
    // travel tangent and up: a rooster tail, not a puff.
    if (spray || dust) {
      const over = Math.max(0, curSpeed / BASE_SPEED - 1.02);
      sprayDebt += over * 700 * dt;
      const n = Math.floor(sprayDebt);
      if (n > 0) {
        sprayDebt -= n;
        // Just behind the head, where the body is actually ploughing.
        const a = 0.6 / PLANET_R;
        const ca = Math.cos(a), sa = Math.sin(a);
        const at = norm([headP[0] * ca - headF[0] * sa, headP[1] * ca - headF[1] * sa, headP[2] * ca - headF[2] * sa]);
        const back: V3 = [-headF[0] * 0.85, -headF[1] * 0.85, -headF[2] * 0.85];
        // Launch speed nearly doubled (was 0.55 + over*0.5). Grains have to get
        // UP off the surface: down in the foam they are white on white and read
        // as nothing, and it is the arc over darker water either side of the
        // wake that makes a rooster tail legible at all.
        const onLand = isLand(at);
        (onLand ? dust : spray)?.emit(
          at, gr(at, onLand ? 0.10 : 0.14), n, clock, onLand ? 0.8 : 1.0, back,
          (onLand ? 0.75 : 1.0) + over * 0.8);
      }
    }

    // — Slough: freeze the body we are drawing THIS frame ————————————————
    //
    // Ordering is load-bearing. The skin is the spine buffer buildSpine just
    // filled, so the tap has to be consumed AFTER the body has been rebuilt for
    // this frame and BEFORE anything overwrites it — take it a frame early and
    // the skin is the previous pose, which on a turn is visibly off the furrow.
    if (tapShed) {
      tapShed = false;
      // `!slough.alive` is load-bearing and was missing: the HUD chip already
      // dimmed while a skin was out, but the trigger did not check it, so a
      // second shed SILENTLY OVERWROTE the first — a quarter of your length
      // spent on a wall that then vanished the moment you shed again. The rule
      // and the thing the player is looking at have to be the same rule.
      if (slough && !slough.alive && alive && length >= SHED_MIN) {
        const rings = buildSpine();
        slough.shed(ribbonSpine, rings, PLANET_R + BODY_R);
        // The 25% that stayed in the skin. Length is the currency this skill
        // spends; the burst is what you bought with it.
        length = Math.max(START_LENGTH, Math.round(length * 0.75));
        shedBurst = 0.8;
        spray?.emit(headP, gr(headP, 0.12), 26, clock, 1.0,
          [-headF[0] * 0.6, -headF[1] * 0.6, -headF[2] * 0.6], 1.3);
      }
    }
    if (shedBurst > 0) shedBurst = Math.max(0, shedBurst - dt);
    slough?.update(dt);
    // Flakes off the TEAR, not off a point. The seam is a ring travelling
    // head-to-tail, so the shreds have to leave from wherever it is this frame —
    // a single burst at the head would have every flake in the wrong place a
    // tenth of a second later. the reference's Bloom makes the same argument about
    // its fallout being the part the player actually watches.
    if (slough?.alive && slough.age < 0.9) {
      shedDebt += 190 * dt;
      const nf = Math.floor(shedDebt);
      if (nf > 0) {
        shedDebt -= nf;
        const onLand = isLand(headP);
        for (let i = 0; i < nf; i++) {
          if (!slough.seamFlake(shedFlake, clock * 61 + i * 3.7)) break;
          (onLand ? dust : spray)?.emitAt(shedFlake.at, gr(shedFlake.at, 0.1),
            shedFlake.vel, clock, onLand ? 0.8 : 1);
        }
      }
    } else {
      shedDebt = 0;
    }

    // — place head + eyes + body —
    placeHead();
    bodyTicks++;
    placeBodySegments();

    // — eat a pellet? (angular proximity) — check every pellet slot —
    const eatCos = Math.cos(EAT_ANGLE);
    for (let i = 0; i < FOOD_COUNT; i++) {
      const f = foods[i];
      if (f && dot(headP, f) > eatCos) takeFood(i);
    }
    for (const d of drops) {
      if (d.active && dot(headP, d.pos) > eatCos) takeDrop(d);
    }

    // ── 蛇灵: the Ribbon eats what it touches ────────────────────────────────
    //
    // The skill's reach IS its collision volume — whatever the swinging body
    // passes over is taken. That makes it a HARVESTER rather than a whip that
    // happens to look nice: the swing is worth aiming, and the figure-eight's
    // width is the reason to hold it rather than tap it.
    //
    // Tested against the body's own rings, not against a circle around the
    // snake. A radius around the head would be the same skill with a bigger
    // number on it; testing the actual geometry means what you can reach is
    // what you can SEE, which is the only version of this a player can aim.
    if (waterRibbon?.active && alive) {
      waterRibbon.forEachPoint(2, (at, rad) => {
        const reach = rad + RIBBON_EAT;
        const r2 = reach * reach;
        for (let i = 0; i < FOOD_COUNT; i++) {
          const f = foods[i];
          if (!f) continue;
          const fr = gr(f, FOOD_R);
          const dx = at[0] - f[0] * fr, dy = at[1] - f[1] * fr, dz = at[2] - f[2] * fr;
          if (dx * dx + dy * dy + dz * dz < r2) takeFood(i);
        }
        for (const d of drops) {
          if (!d.active) continue;
          const dr = gr(d.pos, DROP_R);
          const dx = at[0] - d.pos[0] * dr, dy = at[1] - d.pos[1] * dr, dz = at[2] - d.pos[2] * dr;
          if (dx * dx + dy * dy + dz * dz < r2) takeDrop(d);
        }
      });
    }

    // — crash into surface terrain? (angular proximity to any obstacle) —
    for (const o of obstacles) {
      if (!photo.god && dot(headP, o.dir) > o.hitCos) { gameOver(TERRAIN_DEATH); break; }
    }

    // — self collision: head vs body segments past the neck —
    if (alive) {
      const hitCos = Math.cos(HIT_ANGLE);
      for (let i = SELF_SKIP; i < length; i++) {
        const segPos = sampleTrail(totalArc - i * SEG_SPACING);
        if (!photo.god && dot(headP, segPos) > hitCos) { gameOver('🐍 撞到自己啦~'); break; }
      }
    }

    // The skin is a wall for its owner too. Making it lethal only to bots would
    // be a free turret with no downside; you left something behind that is no
    // longer yours, and the arming delay in slough.ts is the whole of the mercy.
    if (alive && !photo.god && slough?.hits(headP, Math.cos(HIT_ANGLE), true)) {
      gameOver('🪶 撞到自己的蛇蜕啦~');
    }

    const __t0 = performance.now();
    if (lastFrameAt > 0) frameMs = frameMs * 0.9 + (__t0 - lastFrameAt) * 0.1;
    lastFrameAt = __t0;
    try {
    // — rival bots think, roam, dodge, eat + grow —
    for (const bot of bots) updateBot(bot, dt);

    // — bots die by the SAME rules the player does: crashing into the player's
    //   body (a reverse-kill → player scores), the surface terrain, another
    //   snake, or their own tail. Every death scatters edible drops. —
    if (alive) {
      const botHitCos = Math.cos(BOT_HIT_ANGLE);
      for (const bot of bots) {
        if (!bot.alive) continue;
        // (a) into the player's body → reverse-kill, player scores
        let byPlayer = false;
        for (let i = 1; i < length; i++) {
          if (dot(bot.pos, sampleTrail(totalArc - i * SEG_SPACING)) > botHitCos) { byPlayer = true; break; }
        }
        // The skin kills, and it kills as a PLAYER kill — you put it there, and
        // the whole point of spending a quarter of your length is that the wall
        // keeps earning after you have left. Lethal to bots from frame one; the
        // arming delay in slough.ts is for its owner only.
        if (!byPlayer && slough?.hits(bot.pos, botHitCos, false)) byPlayer = true;
        // A strike lands on the NECK. This is the game's one way to kill without
        // being crashed into, and it punishes an exposed head — a different sin
        // from crossing a wall, so body-play stays the primary kill verb.
        if (!byPlayer && striking > 0 && dot(headP, bot.pos) > Math.cos(BOT_HIT_ANGLE * 1.5)) {
          byPlayer = true;
        }
        let crashed = false;
        // (b) into surface terrain
        if (!byPlayer) {
          for (const o of obstacles) if (dot(bot.pos, o.dir) > o.hitCos) { crashed = true; break; }
        }
        // (c) into another bot's head or body
        if (!byPlayer && !crashed) {
          for (const other of bots) {
            if (other === bot || !other.alive) continue;
            if (dot(bot.pos, other.pos) > botHitCos) { crashed = true; break; }
            let h = false;
            for (let i = 1; i < other.len; i++) {
              if (dot(bot.pos, sampleTrailArr(other.trail, other.pos, other.totalArc - i * SEG_SPACING)) > botHitCos) { h = true; break; }
            }
            if (h) { crashed = true; break; }
          }
        }
        // (d) into its own tail (past the neck)
        if (!byPlayer && !crashed && bot.len > BOT_SELF_SKIP) {
          for (let i = BOT_SELF_SKIP; i < bot.len; i++) {
            if (dot(bot.pos, sampleTrailArr(bot.trail, bot.pos, bot.totalArc - i * SEG_SPACING)) > botHitCos) { crashed = true; break; }
          }
        }
        if (byPlayer || crashed) botDies(bot, byPlayer);
      }
    }

    // — PLAYER head vs bot (head or body) → player dies —
    if (alive) {
      const botHitCos = Math.cos(BOT_HIT_ANGLE);
      for (const bot of bots) {
        if (!bot.alive) continue;
        let hit = dot(headP, bot.pos) > botHitCos;
        for (let i = 1; !hit && i < bot.len; i++) {
          if (dot(pos, sampleTrailArr(bot.trail, bot.pos, bot.totalArc - i * SEG_SPACING)) > botHitCos) hit = true;
        }
        if (hit && !photo.god) { gameOver('💥 撞到机器人啦~'); break; }
      }
    }

    // ── skills ──────────────────────────────────────────────────────────────
    // Declarations are dropped and re-made every frame; see src/skill-lights.ts.
    declareSkillLights();

    updateCamera();
    syncEclipseAnchor();
    waterPatch?.update(pos, clock, buildWakeSamples(), slitherUrge, buildDents());
    {
      const hr = gr(headP, 0.35);
      waterRibbon?.update(dt, clock, [headP[0] * hr, headP[1] * hr, headP[2] * hr],
        headF, camRight, camUp, (d) => gr(d, 0),
        spray ? (at, v) => spray.emitAt(at, gr(at, 0), v, clock, 1) : undefined);
      bloom?.update(dt, (d) => gr(d, 0),
        spray ? (at, v) => spray.emitAt(at, gr(at, 0), v, clock, 1) : undefined,
        (at, radius, col, inten) => { skillLights?.add(at, radius, col, inten); });
      deformSkin.flush();
      sweep?.update(dt, (d) => gr(d, 0), wetness, deformStore,
        dust ? (at, v) => dust.emitAt(at, gr(at, 0), v, clock, 1) : undefined,
        (at, radius, col, inten) => { skillLights?.add(at, radius, col, inten); });
      // The crest kills what it runs over — the same rule every other skill
      // here obeys, because an effect with no consequence cannot be read.
      if (sweep?.active && alive) {
        for (const b of bots) {
          if (!b.alive) continue;
          let hit = false;
          sweep.forEachCrest(3, (d) => {
            if (!hit && dot(b.pos, d) > Math.cos(1.6 / PLANET_R)) hit = true;
          });
          if (hit) botDies(b, true);
        }
      }
      // The eruption kills what is standing in it, on the frame it goes off.
      // Same rule as the Ribbon: an effect with no consequence cannot be read.
      if (bloom?.burst && alive) {
        for (const b of bots) {
          if (!b.alive) continue;
          if (dot(b.pos, bloom.at) > Math.cos(BLOOM_R / PLANET_R)) botDies(b, true);
        }
      }

      // ── what the Ribbon is FOR ──────────────────────────────────────────
      // The Maelstrom it replaced was beautiful and did nothing, and no amount
      // of effect work fixes that: a skill with no consequence cannot be read,
      // because there is nothing to read. So this one hits.
      //
      // Two ways, and they are the two halves of the verb. Held, it is a WHIP —
      // a bot that the swinging body touches dies, which is what makes holding
      // it a thing you aim rather than a thing you admire. Thrown, it BURSTS,
      // and the burst clears a patch you were never next to. Sweep what is on
      // you; throw at what is not.
      if (waterRibbon?.active && alive) {
        for (const b of bots) {
          if (!b.alive) continue;
          const brr = gr(b.pos, 0);
          const bx = b.pos[0] * brr, by = b.pos[1] * brr, bz = b.pos[2] * brr;
          let hit = false;
          waterRibbon.forEachPoint(2, (at, rad) => {
            if (hit) return;
            const reach = rad + BODY_R + 0.35;
            const dx = at[0] - bx, dy = at[1] - by, dz = at[2] - bz;
            if (dx * dx + dy * dy + dz * dz < reach * reach) hit = true;
          });
          if (hit) botDies(b, true);
        }
      }
      if (waterRibbon?.splashed && alive) {
        const sp = waterRibbon.splashAt;
        for (const b of bots) {
          if (!b.alive) continue;
          const brr = gr(b.pos, 0);
          const dx = sp[0] - b.pos[0] * brr, dy = sp[1] - b.pos[1] * brr, dz = sp[2] - b.pos[2] * brr;
          if (dx * dx + dy * dy + dz * dz < RIBBON_BURST * RIBBON_BURST) botDies(b, true);
        }
      }
    }
    // The water a strike throws. Driven off the TRAIL, so the sheets bend where
    // the strike bent — see src/strikewake.ts.
    strikeAge += dt;
    strikeWake?.update(headP, headF, strikeAge / Math.max(strikeFor, 1e-3),
      (back) => sampleTrail(totalArc - back), (d) => gr(d, 0), wetness(headP));
    // Grains off the helices, at the helices' own tangential velocity — the
    // particle field never learns what a vortex is.
    bursts?.update(clock, dt, camWorld, PLANET_R + 0.05);
    spray?.update(clock, dt, camWorld, PLANET_R + 0.05);
    dust?.update(clock, dt, camWorld, PLANET_R + 0.05);
    // A burst system is DRIVEN FROM HERE, not by a system of its own. Adding
    // `motes` without adding this line left it integrating nothing and
    // uploading nothing: emit() filled its pool and the pool was never read,
    // so `live()` stayed 0 and not one grain was ever drawn.
    motes?.update(clock, dt, camWorld, PLANET_R + 0.05);
    if (spaceEntity !== undefined) updateSpaceParams(world, spaceEntity, spaceCam());
    } catch (err) {
      // KEPT DELIBERATELY. Three separate temporal-dead-zone ReferenceErrors
      // have been introduced into this update by inserting a block above the
      // `const` it reads (curSpeed, then ox0 in water-patch). Every one of them
      // killed the REST of the frame silently — the water patch and the post
      // pass both update near the end, so the visible symptom was "the sea
      // freezes" with a clean console, and each cost a long bisect to find.
      // The engine does not surface a throw from a user system; this does, once.
      const g = globalThis as Record<string, unknown>;
      if (!g.__psErr) {
        g.__psErr = String((err as Error)?.stack ?? err);
        console.error('[planet-snake] update threw — the rest of this frame did not run:', err);
      }
    }
    // How long OUR update actually took, separated from everything the engine
    // does around it. Comparing whole-frame rates across toggles was too noisy
    // on a contended machine to attribute anything; this attributes directly.
    upMs = upMs * 0.9 + (performance.now() - __t0) * 0.1;
    upPeak = Math.max(upPeak * 0.995, performance.now() - __t0);
    },
  }).unwrap();
}

export default bootstrap;
