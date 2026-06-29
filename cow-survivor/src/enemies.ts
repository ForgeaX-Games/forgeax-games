// Enemies — lowpoly cow-level bestiary.
//
// ARCHITECTURE
// ────────────
// Each enemy is a single ROOT entity (the rigid body + collider) with N
// "parts" parented to it via ChildOf. A part is a primitive (cube or
// sphere) at a fixed local Transform with its own material. Cube + sphere
// are the only engine builtins we depend on — cylinder was deliberately
// dropped to avoid coupling enemies.ts to scene-pack-loaded mesh GUIDs
// (the prior version called a non-existent `findByGuidString` API as a
// fallback). Visual-only parts have NO physics; only the root has
// Collider + RigidBody, so rapier sees just one body per enemy → 80
// enemies stays solver-feasible.
//
// DIFFICULTY TIERS
// ────────────────
// Day (level 1):
//   T1 (early)    GrassCalf, RagingCow
//   T2 (escalate) SparkCalf, BloodCow
//   T3 (late)     StoneBull, ToxicCow, ShadowStalker
//   BOSS          CowKing
// Night (level 2):
//   T1            Batling
//   T2            GraveWalker, NightHowler
//   BOSS          VampireLord
//
// All enemies share:
//   - same root primitive (a kinematic-bodied cuboid hidden inside the
//     visible parts) sized by tier
//   - 3 material variants per kind (normal / hit-flash / cold-slow) so
//     status FX swap with one MeshRenderer write per state change
//   - timestamped status: flashUntil / slowUntil / poisonUntil
//
// SPAWN MIX
// ─────────
// `tickSpawn` rolls each spawn against the ACTIVE LevelSpawnConfig's
// time-phased weight tables (src/levels.ts). main.ts calls `setLevel`
// on every stage transition; boss kind/cadence also come from the config.

import {
  Transform, MeshFilter, MeshRenderer, ChildOf,
  HANDLE_CUBE, HANDLE_SPHERE, Materials, quat,
  type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';
import type { LevelSpawnConfig } from './levels';

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type Ctx = Parameters<GameEntry>[0];

// (cylinder mesh deliberately not used — see file header. shadowstalker's
// torso, the only previous cylinder user, is now a thin tall cube.)

// ─── Enemy taxonomy ────────────────────────────────────────────────────────
export type EnemyKind =
  | 'grasscalf'      // T1 — weak, fast-spawn mooks
  | 'ragingcow'      // T1+ — classic D2 cow-man, charges
  | 'sparkcalf'      // T2 — fast, fragile, suicide-bomber
  | 'bloodcow'       // T2 — fat, slow, splits on death
  | 'stonebull'      // T3 — armored bruiser
  | 'toxiccow'       // T3 — slows player on touch (poison aura)
  | 'shadowstalker'  // T3 — fast, semi-transparent, low HP
  | 'cowking'        // BOSS (day)
  | 'batling'        // T1 night — small fast flyer
  | 'gravewalker'    // T2 night — shambling undead cow-man
  | 'nighthowler'    // T2 night — fast lunging wolf
  | 'vampirelord';   // BOSS (night)

export type Tier = 'T1' | 'T2' | 'T3' | 'BOSS';

export type DeathFx =
  | 'gibs'           // generic red gibs
  | 'split'          // spawn 2 sparkcalves
  | 'explode'        // self-AoE damage to nearby enemies (NOT player)
  | 'shatter'        // gray rock chunks
  | 'cloud'          // green poison puff
  | 'wisp'           // purple wisps
  | 'gem';           // boss: spawn xp gem cluster

export interface PartSpec {
  /** Visual primitive used by this part. Only cube + sphere supported —
   *  cylinder was removed to keep enemies.ts decoupled from scene-pack
   *  GUID lookups (an engine API that didn't exist on this version). */
  shape: 'cube' | 'sphere';
  /** Local position relative to the enemy root, in world units. */
  px: number; py: number; pz: number;
  /** Local non-uniform scale (cubes scale all 3 axes; spheres use sx). */
  sx: number; sy: number; sz: number;
  /** Optional Y-axis rotation (radians). Other axes rarely needed for lowpoly. */
  rotY?: number;
  /** Material kind: 'body'/'accent'/'horn'/'eye'/'glow'/'aura'. Maps to one of
   *  the per-enemy material variants pre-registered in EnemyManager. */
  mat: PartMatKey;
}

/** Named material slots per enemy kind. Kept small & meaningful. */
export type PartMatKey =
  | 'body'      // primary mass color
  | 'spot'      // secondary skin (e.g. cow patches)
  | 'horn'      // bone / metal accents
  | 'eye'       // glowing eyes (always emissive)
  | 'glow'      // major emissive feature (lightning, fire, etc)
  | 'aura'      // semi-emissive halo (boss / toxic)
  | 'wing';     // dark accent (shadow stalker)

export interface EnemyDef {
  kind: EnemyKind;
  tier: Tier;
  hp: number;
  speed: number;          // units/s
  /** Collider half-extents (cuboid). Not necessarily the visual size. */
  colliderHX: number;
  colliderHY: number;
  colliderHZ: number;
  /** Anchor height (root posY = colliderHY + 0.05 → bottom rests at y=0.05). */
  damage: number;         // contact damage / s? — applied as a single discrete
                          //   hit during the player's i-frame window
  score: number;
  xp: number;
  knockback: number;      // bullet impulse multiplier (1 = standard)
  deathFx: DeathFx;
  /** Cosmetic: which named material variants this kind uses (registered once
   *  by EnemyManager). Unused keys are simply omitted. */
  palette: Partial<Record<PartMatKey, { color: [number, number, number]; emissive?: [number, number, number]; emissiveIntensity?: number; metallic?: number; roughness?: number }>>;
  /** Lowpoly assembly: list of parts to spawn as ChildOf the root. */
  parts: PartSpec[];
  /** Special combat traits, all opt-in. */
  contactSlow?: number;       // toxic — applies slow on player contact
  selfDestructOnContact?: boolean;
  bossPhase2HpFraction?: number; // boss enrages below this hp ratio
}

// ─── Bestiary ──────────────────────────────────────────────────────────────
//
// Coordinate convention: root anchor sits at (0, colliderHY+0.05, 0). Part
// positions are LOCAL to the root, so part.py = world height − root.posY.
// We model parts as if the root were at y=0; the engine's hierarchical
// transform takes care of placing them above the floor.

// Material colors used inline below (small palette, easy to tweak).
const C = {
  white:    [0.94, 0.94, 0.92] as [number, number, number],
  black:    [0.10, 0.10, 0.12] as [number, number, number],
  rotting:  [0.45, 0.10, 0.12] as [number, number, number],
  bloodRed: [0.66, 0.08, 0.10] as [number, number, number],
  bone:     [0.86, 0.82, 0.70] as [number, number, number],
  steel:    [0.32, 0.34, 0.40] as [number, number, number],
  rock:     [0.40, 0.40, 0.45] as [number, number, number],
  rockDark: [0.22, 0.22, 0.26] as [number, number, number],
  bullskin: [0.55, 0.18, 0.14] as [number, number, number],
  plagueGreen: [0.36, 0.55, 0.20] as [number, number, number],
  plagueDark:  [0.20, 0.30, 0.10] as [number, number, number],
  shadow:   [0.10, 0.06, 0.18] as [number, number, number],
  shadowAccent: [0.32, 0.18, 0.55] as [number, number, number],
  gold:     [0.95, 0.72, 0.18] as [number, number, number],
  goldDeep: [0.70, 0.40, 0.10] as [number, number, number],
  crown:    [1.00, 0.85, 0.30] as [number, number, number],
};
const E = {
  redEye:    { e: [1.0, 0.10, 0.10] as [number, number, number], i: 18 },
  blueArc:   { e: [0.55, 0.85, 1.0] as [number, number, number], i: 22 },
  fire:      { e: [1.0, 0.55, 0.10] as [number, number, number], i: 14 },
  toxic:     { e: [0.55, 1.0, 0.30] as [number, number, number], i: 12 },
  wisp:      { e: [0.85, 0.40, 1.0] as [number, number, number], i: 12 },
  bossAura:  { e: [1.0, 0.35, 0.10] as [number, number, number], i: 16 },
};

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  // ── T1 GrassCalf — small, slow-ish, white with black spots, two stub legs.
  grasscalf: {
    kind: 'grasscalf', tier: 'T1',
    hp: 22, speed: 3.0,
    colliderHX: 0.40, colliderHY: 0.35, colliderHZ: 0.55,
    damage: 6, score: 8, xp: 2, knockback: 1.1, deathFx: 'gibs',
    palette: {
      body: { color: C.white, roughness: 0.85 },
      spot: { color: C.black, roughness: 0.9 },
      horn: { color: [0.95, 0.78, 0.65], roughness: 0.7 },   // muzzle pink
      eye:  { color: [0.05, 0.05, 0.05], emissive: E.redEye.e, emissiveIntensity: 4 },
    },
    // 4-legged little cow, broadside silhouette. py is LOCAL to root center.
    // Root center sits at ground+colliderHY+0.05; legs reach down to py=-0.30.
    parts: [
      // body (broad cuboid, long along Z so it looks like a cow from the side)
      { shape: 'cube',   px: 0,     py:  0.05, pz: 0,     sx: 0.55, sy: 0.40, sz: 0.85, mat: 'body' },
      // big black blotch on back
      { shape: 'cube',   px: 0.05,  py:  0.25, pz: -0.10, sx: 0.50, sy: 0.06, sz: 0.55, mat: 'spot' },
      // side blotch
      { shape: 'cube',   px: -0.30, py:  0.05, pz:  0.10, sx: 0.04, sy: 0.32, sz: 0.40, mat: 'spot' },
      // head (cube, juts forward)
      { shape: 'cube',   px: 0,     py:  0.15, pz:  0.55, sx: 0.36, sy: 0.36, sz: 0.32, mat: 'body' },
      // muzzle (small pink front block)
      { shape: 'cube',   px: 0,     py:  0.05, pz:  0.74, sx: 0.20, sy: 0.18, sz: 0.10, mat: 'horn' },
      // two ears (slanted thin cubes)
      { shape: 'cube',   px: -0.20, py:  0.32, pz:  0.50, sx: 0.06, sy: 0.10, sz: 0.10, mat: 'body', rotY:  0.4 },
      { shape: 'cube',   px:  0.20, py:  0.32, pz:  0.50, sx: 0.06, sy: 0.10, sz: 0.10, mat: 'body', rotY: -0.4 },
      // 4 legs (thin tall cubes at the corners, reaching down to ground)
      { shape: 'cube',   px: -0.20, py: -0.20, pz:  0.30, sx: 0.10, sy: 0.30, sz: 0.10, mat: 'spot' },
      { shape: 'cube',   px:  0.20, py: -0.20, pz:  0.30, sx: 0.10, sy: 0.30, sz: 0.10, mat: 'spot' },
      { shape: 'cube',   px: -0.20, py: -0.20, pz: -0.30, sx: 0.10, sy: 0.30, sz: 0.10, mat: 'spot' },
      { shape: 'cube',   px:  0.20, py: -0.20, pz: -0.30, sx: 0.10, sy: 0.30, sz: 0.10, mat: 'spot' },
      // two red eyes (small spheres on the head)
      { shape: 'sphere', px: -0.10, py:  0.18, pz:  0.70, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.10, py:  0.18, pz:  0.70, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      // tail stub
      { shape: 'cube',   px: 0,     py:  0.05, pz: -0.50, sx: 0.05, sy: 0.05, sz: 0.20, mat: 'spot' },
    ],
  },

  // ── T1+ RagingCow — D2's iconic cow-man: bipedal, red eyes, big shoulders.
  ragingcow: {
    kind: 'ragingcow', tier: 'T1',
    hp: 45, speed: 3.6,
    colliderHX: 0.45, colliderHY: 0.70, colliderHZ: 0.40,
    damage: 12, score: 18, xp: 4, knockback: 1.0, deathFx: 'gibs',
    palette: {
      body: { color: C.white, roughness: 0.85 },
      spot: { color: C.black, roughness: 0.9 },
      horn: { color: C.bone, roughness: 0.5, metallic: 0.2 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: E.redEye.e, emissiveIntensity: 8 },
    },
    // Bipedal D2 cow-man. py LOCAL range [-0.70, +0.70].
    parts: [
      // legs (two thick cubes, reach the ground)
      { shape: 'cube', px: -0.15, py: -0.40, pz:  0,    sx: 0.18, sy: 0.55, sz: 0.22, mat: 'spot' },
      { shape: 'cube', px:  0.15, py: -0.40, pz:  0,    sx: 0.18, sy: 0.55, sz: 0.22, mat: 'spot' },
      // torso (broad, upright)
      { shape: 'cube', px: 0,     py:  0.05, pz:  0,    sx: 0.65, sy: 0.70, sz: 0.40, mat: 'body' },
      // chest dark fur patch
      { shape: 'cube', px: 0,     py:  0,    pz:  0.18, sx: 0.45, sy: 0.45, sz: 0.06, mat: 'spot' },
      // shoulders (small cubes flaring out)
      { shape: 'cube', px: -0.42, py:  0.35, pz:  0,    sx: 0.18, sy: 0.22, sz: 0.30, mat: 'spot' },
      { shape: 'cube', px:  0.42, py:  0.35, pz:  0,    sx: 0.18, sy: 0.22, sz: 0.30, mat: 'spot' },
      // hanging arms / fists
      { shape: 'cube', px: -0.50, py:  0.05, pz:  0.04, sx: 0.12, sy: 0.50, sz: 0.18, mat: 'body' },
      { shape: 'cube', px:  0.50, py:  0.05, pz:  0.04, sx: 0.12, sy: 0.50, sz: 0.18, mat: 'body' },
      // head (forward of the torso)
      { shape: 'cube', px: 0,     py:  0.55, pz:  0.10, sx: 0.42, sy: 0.40, sz: 0.46, mat: 'body' },
      // horns (angled cubes)
      { shape: 'cube', px: -0.30, py:  0.66, pz:  0.05, sx: 0.10, sy: 0.10, sz: 0.32, mat: 'horn', rotY:  0.5 },
      { shape: 'cube', px:  0.30, py:  0.66, pz:  0.05, sx: 0.10, sy: 0.10, sz: 0.32, mat: 'horn', rotY: -0.5 },
      // glowing eye bar
      { shape: 'cube', px: 0,     py:  0.58, pz:  0.34, sx: 0.28, sy: 0.05, sz: 0.04, mat: 'eye' },
    ],
  },

  // ── T2 SparkCalf — small, electric, all-emissive blue, hovers slightly.
  sparkcalf: {
    kind: 'sparkcalf', tier: 'T2',
    hp: 14, speed: 6.0,
    colliderHX: 0.30, colliderHY: 0.40, colliderHZ: 0.30,
    damage: 14, score: 18, xp: 4, knockback: 1.6, deathFx: 'explode',
    selfDestructOnContact: true,
    palette: {
      body: { color: [0.20, 0.30, 0.50], roughness: 0.4, metallic: 0.2 },
      glow: { color: [0.40, 0.70, 1.00], emissive: E.blueArc.e, emissiveIntensity: E.blueArc.i },
      spot: { color: [0.10, 0.18, 0.35], roughness: 0.45 },
      eye:  { color: [1.0, 1.0, 1.0], emissive: [1, 1, 1], emissiveIntensity: 8 },
    },
    // A floating CUBE core wrapped in lightning arcs — no body sphere.
    // py LOCAL range [-0.40, +0.40].
    parts: [
      // dark cube core (the body), slightly tilted to feel "spinning"
      { shape: 'cube',   px: 0,    py:  0.05, pz:  0,    sx: 0.40, sy: 0.40, sz: 0.40, mat: 'body', rotY: 0.5 },
      // inner glowing crystal (smaller cube, rotated for an extra "spin" silhouette)
      { shape: 'cube',   px: 0,    py:  0.05, pz:  0,    sx: 0.22, sy: 0.22, sz: 0.22, mat: 'glow', rotY: 0.8 },
      // 5 lightning arc spikes (top + 4 horizontal)
      { shape: 'cube',   px: 0,    py:  0.40, pz:  0,    sx: 0.06, sy: 0.36, sz: 0.06, mat: 'glow' },
      { shape: 'cube',   px: -0.40, py:  0.05, pz:  0,   sx: 0.36, sy: 0.06, sz: 0.06, mat: 'glow' },
      { shape: 'cube',   px:  0.40, py:  0.05, pz:  0,   sx: 0.36, sy: 0.06, sz: 0.06, mat: 'glow' },
      { shape: 'cube',   px: 0,    py:  0.05, pz:  0.40, sx: 0.06, sy: 0.06, sz: 0.36, mat: 'glow' },
      { shape: 'cube',   px: 0,    py:  0.05, pz: -0.40, sx: 0.06, sy: 0.06, sz: 0.36, mat: 'glow' },
      // tiny dust beneath (so it reads as "hovering, no legs")
      { shape: 'cube',   px: 0,    py: -0.35, pz:  0,    sx: 0.20, sy: 0.04, sz: 0.20, mat: 'spot' },
      // single bright forward eye
      { shape: 'sphere', px: 0,    py:  0.10, pz:  0.22, sx: 0.08, sy: 0.08, sz: 0.08, mat: 'eye' },
    ],
  },

  // ── T2 BloodCow — bloated, dark red, splits into 2 sparkcalves on death.
  bloodcow: {
    kind: 'bloodcow', tier: 'T2',
    hp: 95, speed: 1.9,
    colliderHX: 0.70, colliderHY: 0.60, colliderHZ: 0.85,
    damage: 16, score: 35, xp: 7, knockback: 0.55, deathFx: 'split',
    palette: {
      body: { color: C.bullskin, roughness: 0.55 },
      spot: { color: C.bloodRed, roughness: 0.4 },
      horn: { color: C.bone, roughness: 0.5 },
      glow: { color: [0.9, 0.2, 0.2], emissive: [1.0, 0.20, 0.10], emissiveIntensity: 3 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: E.redEye.e, emissiveIntensity: 6 },
    },
    // Big bloated quadruped — cube body (NOT sphere), with tumors and legs.
    // py LOCAL range [-0.60, +0.60].
    parts: [
      // bloated belly (oversized non-uniform cube)
      { shape: 'cube',   px: 0,     py:  0.05, pz:  0,    sx: 1.10, sy: 0.85, sz: 1.30, mat: 'body' },
      // glowing crack across the spine
      { shape: 'cube',   px: 0,     py:  0.50, pz: -0.10, sx: 0.70, sy: 0.05, sz: 0.80, mat: 'glow' },
      // side cracks
      { shape: 'cube',   px: -0.45, py:  0.10, pz:  0.20, sx: 0.10, sy: 0.20, sz: 0.30, mat: 'glow', rotY: -0.6 },
      { shape: 'cube',   px:  0.45, py:  0.10, pz: -0.10, sx: 0.10, sy: 0.20, sz: 0.30, mat: 'glow', rotY:  0.6 },
      // 4 short stocky legs
      { shape: 'cube',   px: -0.35, py: -0.40, pz:  0.55, sx: 0.18, sy: 0.30, sz: 0.18, mat: 'spot' },
      { shape: 'cube',   px:  0.35, py: -0.40, pz:  0.55, sx: 0.18, sy: 0.30, sz: 0.18, mat: 'spot' },
      { shape: 'cube',   px: -0.35, py: -0.40, pz: -0.55, sx: 0.18, sy: 0.30, sz: 0.18, mat: 'spot' },
      { shape: 'cube',   px:  0.35, py: -0.40, pz: -0.55, sx: 0.18, sy: 0.30, sz: 0.18, mat: 'spot' },
      // head (forward, dripping)
      { shape: 'cube',   px: 0,     py:  0.10, pz:  0.85, sx: 0.50, sy: 0.40, sz: 0.40, mat: 'spot' },
      // tiny curved horns
      { shape: 'cube',   px: -0.20, py:  0.32, pz:  0.85, sx: 0.07, sy: 0.07, sz: 0.18, mat: 'horn', rotY:  0.6 },
      { shape: 'cube',   px:  0.20, py:  0.32, pz:  0.85, sx: 0.07, sy: 0.07, sz: 0.18, mat: 'horn', rotY: -0.6 },
      // back tumor cluster (still spheres, but small and accent-y)
      { shape: 'sphere', px: -0.20, py:  0.55, pz: -0.30, sx: 0.22, sy: 0.22, sz: 0.22, mat: 'glow' },
      { shape: 'sphere', px:  0.25, py:  0.55, pz:  0.10, sx: 0.20, sy: 0.20, sz: 0.20, mat: 'glow' },
      // angry forward eyes
      { shape: 'cube',   px: -0.10, py:  0.14, pz:  1.05, sx: 0.05, sy: 0.05, sz: 0.04, mat: 'eye' },
      { shape: 'cube',   px:  0.10, py:  0.14, pz:  1.05, sx: 0.05, sy: 0.05, sz: 0.04, mat: 'eye' },
    ],
  },

  // ── T3 StoneBull — tank, gray armor, oversized horns, glowing red eye line.
  stonebull: {
    kind: 'stonebull', tier: 'T3',
    hp: 240, speed: 1.7,
    colliderHX: 0.65, colliderHY: 0.80, colliderHZ: 0.55,
    damage: 22, score: 80, xp: 14, knockback: 0.20, deathFx: 'shatter',
    palette: {
      body: { color: C.rock, roughness: 0.85, metallic: 0.1 },
      spot: { color: C.rockDark, roughness: 0.95 },
      horn: { color: C.bone, roughness: 0.3, metallic: 0.4 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.25, 0.10], emissiveIntensity: 9 },
    },
    // Bipedal heavy bruiser. py LOCAL range [-0.80, +0.80].
    parts: [
      // legs (chunky)
      { shape: 'cube', px: -0.22, py: -0.45, pz:  0,    sx: 0.28, sy: 0.55, sz: 0.32, mat: 'spot' },
      { shape: 'cube', px:  0.22, py: -0.45, pz:  0,    sx: 0.28, sy: 0.55, sz: 0.32, mat: 'spot' },
      // torso (broad, tall block)
      { shape: 'cube', px: 0,     py:  0,    pz:  0,    sx: 1.00, sy: 0.85, sz: 0.65, mat: 'body' },
      // chest plate (darker layered slab)
      { shape: 'cube', px: 0,     py: -0.05, pz:  0.35, sx: 0.80, sy: 0.55, sz: 0.08, mat: 'spot' },
      // back hump (jagged armor)
      { shape: 'cube', px: 0,     py:  0.50, pz: -0.20, sx: 0.55, sy: 0.20, sz: 0.35, mat: 'spot' },
      // head (thick block, jutting forward)
      { shape: 'cube', px: 0,     py:  0.55, pz:  0.30, sx: 0.55, sy: 0.45, sz: 0.50, mat: 'body' },
      // huge curved horns (long cubes, angled forward + outward)
      { shape: 'cube', px: -0.40, py:  0.68, pz:  0.45, sx: 0.14, sy: 0.14, sz: 0.65, mat: 'horn', rotY:  0.7 },
      { shape: 'cube', px:  0.40, py:  0.68, pz:  0.45, sx: 0.14, sy: 0.14, sz: 0.65, mat: 'horn', rotY: -0.7 },
      // glowing eye-slit (single emissive bar)
      { shape: 'cube', px: 0,     py:  0.55, pz:  0.58, sx: 0.36, sy: 0.06, sz: 0.04, mat: 'eye' },
      // shoulder spike
      { shape: 'cube', px: 0,     py:  0.78, pz: -0.05, sx: 0.10, sy: 0.18, sz: 0.10, mat: 'horn' },
    ],
  },

  // ── T3 ToxicCow — plague-green, swollen sacs on the back, slows on touch.
  toxiccow: {
    kind: 'toxiccow', tier: 'T3',
    hp: 110, speed: 2.3,
    colliderHX: 0.50, colliderHY: 0.55, colliderHZ: 0.70,
    damage: 10, score: 60, xp: 12, knockback: 0.7, deathFx: 'cloud',
    contactSlow: 1.5,
    palette: {
      body: { color: C.plagueDark, roughness: 0.8 },
      spot: { color: C.plagueGreen, roughness: 0.7 },
      glow: { color: [0.6, 1.0, 0.4], emissive: E.toxic.e, emissiveIntensity: E.toxic.i },
      eye:  { color: [0.05, 0.05, 0.05], emissive: [0.9, 1.0, 0.3], emissiveIntensity: 6 },
      aura: { color: [0.40, 0.95, 0.30], emissive: E.toxic.e, emissiveIntensity: 1.5 },
    },
    // Quadruped with massive tumor sacs on the back. py LOCAL range [-0.55, +0.55].
    parts: [
      // body (asymmetric block)
      { shape: 'cube',   px: 0,     py:  0.05, pz:  0,    sx: 0.75, sy: 0.55, sz: 0.95, mat: 'body' },
      // sickly green underside
      { shape: 'cube',   px: 0,     py: -0.20, pz:  0,    sx: 0.65, sy: 0.10, sz: 0.80, mat: 'spot' },
      // 4 short twisted legs
      { shape: 'cube',   px: -0.28, py: -0.40, pz:  0.40, sx: 0.14, sy: 0.30, sz: 0.14, mat: 'spot' },
      { shape: 'cube',   px:  0.28, py: -0.40, pz:  0.40, sx: 0.14, sy: 0.30, sz: 0.14, mat: 'spot' },
      { shape: 'cube',   px: -0.28, py: -0.40, pz: -0.40, sx: 0.14, sy: 0.30, sz: 0.14, mat: 'spot' },
      { shape: 'cube',   px:  0.28, py: -0.40, pz: -0.40, sx: 0.14, sy: 0.30, sz: 0.14, mat: 'spot' },
      // head (drooping forward)
      { shape: 'cube',   px: 0.05,  py:  0.05, pz:  0.65, sx: 0.40, sy: 0.36, sz: 0.40, mat: 'spot' },
      // back tumor cluster (three GIANT glowing sacs — the silhouette signature)
      { shape: 'sphere', px: -0.22, py:  0.45, pz: -0.10, sx: 0.32, sy: 0.34, sz: 0.32, mat: 'glow' },
      { shape: 'sphere', px:  0.22, py:  0.48, pz:  0.10, sx: 0.36, sy: 0.36, sz: 0.36, mat: 'glow' },
      { shape: 'sphere', px:  0.05, py:  0.50, pz: -0.40, sx: 0.26, sy: 0.26, sz: 0.26, mat: 'glow' },
      // single glowing squinting eye
      { shape: 'sphere', px: 0.10,  py:  0.10, pz:  0.85, sx: 0.07, sy: 0.05, sz: 0.05, mat: 'eye' },
      // poison aura disc at the feet
      { shape: 'sphere', px: 0,     py: -0.50, pz:  0,    sx: 1.10, sy: 0.06, sz: 1.10, mat: 'aura' },
    ],
  },

  // ── T3 ShadowStalker — slim, hovering, two purple eyes, faint translucent
  //    body. Fast, low HP, designed to flank.
  shadowstalker: {
    kind: 'shadowstalker', tier: 'T3',
    hp: 65, speed: 5.5,
    colliderHX: 0.32, colliderHY: 0.75, colliderHZ: 0.32,
    damage: 16, score: 55, xp: 9, knockback: 1.3, deathFx: 'wisp',
    palette: {
      body: { color: C.shadow, roughness: 0.5 },
      wing: { color: C.shadowAccent, roughness: 0.4, metallic: 0.2 },
      glow: { color: [0.6, 0.3, 1.0], emissive: E.wisp.e, emissiveIntensity: 4 },
      eye:  { color: [0.05, 0.05, 0.10], emissive: [1.0, 0.35, 1.0], emissiveIntensity: 1.5 },
    },
    // Tall, hovering, NO legs. py LOCAL range [-0.75, +0.75].
    parts: [
      // tapered torso (cube — explicit shape, not sphere)
      { shape: 'cube',   px: 0,     py:  0.10, pz:  0,    sx: 0.45, sy: 0.85, sz: 0.30, mat: 'body' },
      // lower trailing wisp (no legs — a tapered cube going down)
      { shape: 'cube',   px: 0,     py: -0.55, pz:  0,    sx: 0.16, sy: 0.40, sz: 0.16, mat: 'wing', rotY: 0.5 },
      // hood / head (cube, slightly forward)
      { shape: 'cube',   px: 0,     py:  0.62, pz:  0.05, sx: 0.40, sy: 0.36, sz: 0.40, mat: 'body' },
      // hood crest (thin slanted cube on top)
      { shape: 'cube',   px: 0,     py:  0.78, pz:  0,    sx: 0.22, sy: 0.10, sz: 0.30, mat: 'wing' },
      // two glowing eyes
      { shape: 'sphere', px: -0.10, py:  0.62, pz:  0.24, sx: 0.06, sy: 0.06, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.10, py:  0.62, pz:  0.24, sx: 0.06, sy: 0.06, sz: 0.05, mat: 'eye' },
      // floating cape wisp behind
      { shape: 'cube',   px: 0,     py:  0.10, pz: -0.20, sx: 0.50, sy: 0.85, sz: 0.04, mat: 'wing', rotY: 0.2 },
      // two side wing-blades (swept back, dramatic)
      { shape: 'cube',   px: -0.42, py:  0.30, pz: -0.05, sx: 0.04, sy: 0.55, sz: 0.45, mat: 'wing', rotY:  0.7 },
      { shape: 'cube',   px:  0.42, py:  0.30, pz: -0.05, sx: 0.04, sy: 0.55, sz: 0.45, mat: 'wing', rotY: -0.7 },
      // chest gem (signature glow)
      { shape: 'sphere', px: 0,     py:  0.20, pz:  0.18, sx: 0.12, sy: 0.12, sz: 0.12, mat: 'glow' },
    ],
  },

  // ── BOSS CowKing — golden-red colossus, jagged crown, glowing core,
  //    wingspan via cape cubes. Phase-2 enrage at 40% HP (handled in tickAI).
  cowking: {
    kind: 'cowking', tier: 'BOSS',
    hp: 1500, speed: 2.6,
    colliderHX: 1.10, colliderHY: 1.35, colliderHZ: 1.00,
    damage: 38, score: 800, xp: 60, knockback: 0.10, deathFx: 'gem',
    bossPhase2HpFraction: 0.4,
    palette: {
      body: { color: C.bullskin, roughness: 0.45, metallic: 0.15 },
      spot: { color: C.goldDeep, roughness: 0.4, metallic: 0.5 },
      horn: { color: C.gold, roughness: 0.25, metallic: 0.7, emissive: [0.6, 0.4, 0.05], emissiveIntensity: 1.5 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.15, 0.10], emissiveIntensity: 1.8 },
      glow: { color: C.crown, emissive: E.bossAura.e, emissiveIntensity: E.bossAura.i },
      aura: { color: [1.0, 0.4, 0.10], emissive: E.bossAura.e, emissiveIntensity: 2.5 },
    },
    // Bipedal giant. py LOCAL range [-1.35, +1.35].
    parts: [
      // legs (massive, reach the ground)
      { shape: 'cube',   px: -0.40, py: -0.85, pz:  0,    sx: 0.45, sy: 0.95, sz: 0.55, mat: 'spot' },
      { shape: 'cube',   px:  0.40, py: -0.85, pz:  0,    sx: 0.45, sy: 0.95, sz: 0.55, mat: 'spot' },
      // colossal torso
      { shape: 'cube',   px: 0,     py:  0.05, pz:  0,    sx: 1.70, sy: 1.35, sz: 1.20, mat: 'body' },
      // chest plate (gold)
      { shape: 'cube',   px: 0,     py:  0,    pz:  0.62, sx: 1.20, sy: 0.85, sz: 0.10, mat: 'spot' },
      // glowing core (heart of fire)
      { shape: 'sphere', px: 0,     py:  0,    pz:  0.72, sx: 0.30, sy: 0.30, sz: 0.30, mat: 'glow' },
      // shoulder pauldrons
      { shape: 'cube',   px: -0.95, py:  0.55, pz:  0,    sx: 0.40, sy: 0.50, sz: 0.60, mat: 'spot' },
      { shape: 'cube',   px:  0.95, py:  0.55, pz:  0,    sx: 0.40, sy: 0.50, sz: 0.60, mat: 'spot' },
      // head
      { shape: 'cube',   px: 0,     py:  1.00, pz:  0.20, sx: 0.80, sy: 0.65, sz: 0.85, mat: 'body' },
      // colossal curved horns
      { shape: 'cube',   px: -0.55, py:  1.20, pz:  0.35, sx: 0.18, sy: 0.18, sz: 0.85, mat: 'horn', rotY:  0.6 },
      { shape: 'cube',   px:  0.55, py:  1.20, pz:  0.35, sx: 0.18, sy: 0.18, sz: 0.85, mat: 'horn', rotY: -0.6 },
      // crown spike (between the horns)
      { shape: 'cube',   px: 0,     py:  1.30, pz:  0,    sx: 0.12, sy: 0.20, sz: 0.12, mat: 'horn' },
      // glowing eye-slit
      { shape: 'cube',   px: 0,     py:  1.00, pz:  0.65, sx: 0.45, sy: 0.07, sz: 0.04, mat: 'eye' },
    ],
  },

  // ── NIGHT T1 Batling — small dark flyer, hovers, swept wings, red eyes.
  batling: {
    kind: 'batling', tier: 'T1',
    hp: 16, speed: 4.6,
    colliderHX: 0.35, colliderHY: 0.30, colliderHZ: 0.30,
    damage: 7, score: 10, xp: 2, knockback: 1.5, deathFx: 'wisp',
    palette: {
      body: { color: C.shadow, roughness: 0.6 },
      wing: { color: C.shadowAccent, roughness: 0.5 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: E.redEye.e, emissiveIntensity: 9 },
    },
    // Hovering — no legs. py LOCAL range [-0.30, +0.30].
    parts: [
      // compact fuzzy body
      { shape: 'cube',   px: 0,     py:  0.00, pz:  0,    sx: 0.30, sy: 0.26, sz: 0.34, mat: 'body' },
      // head (slightly forward + up)
      { shape: 'cube',   px: 0,     py:  0.14, pz:  0.20, sx: 0.22, sy: 0.20, sz: 0.18, mat: 'body' },
      // two tall pointed ears
      { shape: 'cube',   px: -0.08, py:  0.30, pz:  0.20, sx: 0.05, sy: 0.14, sz: 0.05, mat: 'wing' },
      { shape: 'cube',   px:  0.08, py:  0.30, pz:  0.20, sx: 0.05, sy: 0.14, sz: 0.05, mat: 'wing' },
      // two big thin swept wings (the silhouette signature)
      { shape: 'cube',   px: -0.42, py:  0.05, pz: -0.05, sx: 0.55, sy: 0.04, sz: 0.30, mat: 'wing', rotY:  0.45 },
      { shape: 'cube',   px:  0.42, py:  0.05, pz: -0.05, sx: 0.55, sy: 0.04, sz: 0.30, mat: 'wing', rotY: -0.45 },
      // tiny wing claws
      { shape: 'cube',   px: -0.62, py:  0.10, pz:  0.10, sx: 0.06, sy: 0.10, sz: 0.06, mat: 'body' },
      { shape: 'cube',   px:  0.62, py:  0.10, pz:  0.10, sx: 0.06, sy: 0.10, sz: 0.06, mat: 'body' },
      // two glowing red eyes
      { shape: 'sphere', px: -0.06, py:  0.16, pz:  0.30, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.06, py:  0.16, pz:  0.30, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
    ],
  },

  // ── NIGHT T2 GraveWalker — shambling undead cow-man, exposed glowing ribs.
  gravewalker: {
    kind: 'gravewalker', tier: 'T2',
    hp: 80, speed: 2.1,
    colliderHX: 0.45, colliderHY: 0.70, colliderHZ: 0.40,
    damage: 15, score: 30, xp: 6, knockback: 0.8, deathFx: 'cloud',
    palette: {
      body: { color: [0.30, 0.34, 0.28], roughness: 0.95 },
      spot: { color: C.plagueDark, roughness: 0.9 },
      horn: { color: C.bone, roughness: 0.6 },
      glow: { color: [0.5, 0.9, 0.4], emissive: E.toxic.e, emissiveIntensity: 3 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: [0.5, 1.0, 0.4], emissiveIntensity: 7 },
    },
    // Bipedal like ragingcow but hunched forward, asymmetric. py LOCAL [-0.70, +0.70].
    parts: [
      // uneven legs (one dragging)
      { shape: 'cube', px: -0.16, py: -0.42, pz:  0,    sx: 0.16, sy: 0.52, sz: 0.20, mat: 'spot' },
      { shape: 'cube', px:  0.16, py: -0.48, pz: -0.08, sx: 0.16, sy: 0.42, sz: 0.20, mat: 'spot' },
      // hunched torso (leaning forward via offset blocks)
      { shape: 'cube', px: 0,     py:  0.00, pz:  0.06, sx: 0.60, sy: 0.62, sz: 0.38, mat: 'body' },
      { shape: 'cube', px: 0,     py:  0.34, pz:  0.16, sx: 0.52, sy: 0.30, sz: 0.34, mat: 'body' },
      // exposed glowing rib slits
      { shape: 'cube', px: 0,     py:  0.08, pz:  0.26, sx: 0.36, sy: 0.05, sz: 0.04, mat: 'glow' },
      { shape: 'cube', px: 0,     py: -0.06, pz:  0.26, sx: 0.30, sy: 0.05, sz: 0.04, mat: 'glow' },
      // single remaining arm + a bone stump
      { shape: 'cube', px: -0.45, py:  0.05, pz:  0.10, sx: 0.12, sy: 0.55, sz: 0.16, mat: 'body' },
      { shape: 'cube', px:  0.42, py:  0.22, pz:  0.06, sx: 0.10, sy: 0.22, sz: 0.12, mat: 'horn' },
      // drooping head (low, forward)
      { shape: 'cube', px: 0.05,  py:  0.52, pz:  0.30, sx: 0.36, sy: 0.32, sz: 0.40, mat: 'body' },
      // one broken horn
      { shape: 'cube', px: -0.22, py:  0.64, pz:  0.26, sx: 0.08, sy: 0.08, sz: 0.24, mat: 'horn', rotY: 0.5 },
      // sickly glowing eyes
      { shape: 'sphere', px: -0.04, py:  0.54, pz:  0.50, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.14, py:  0.52, pz:  0.50, sx: 0.06, sy: 0.06, sz: 0.05, mat: 'eye' },
    ],
  },

  // ── NIGHT T2 NightHowler — lean fast wolf, yellow eyes, raised hackles.
  nighthowler: {
    kind: 'nighthowler', tier: 'T2',
    hp: 48, speed: 5.2,
    colliderHX: 0.35, colliderHY: 0.40, colliderHZ: 0.60,
    damage: 17, score: 40, xp: 8, knockback: 1.2, deathFx: 'gibs',
    palette: {
      body: { color: [0.20, 0.22, 0.30], roughness: 0.85 },
      spot: { color: [0.12, 0.13, 0.18], roughness: 0.9 },
      horn: { color: C.bone, roughness: 0.5 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.85, 0.20], emissiveIntensity: 9 },
    },
    // Lean quadruped, long low body. py LOCAL range [-0.40, +0.40].
    parts: [
      // long lean body
      { shape: 'cube',   px: 0,     py:  0.05, pz: -0.05, sx: 0.40, sy: 0.36, sz: 1.00, mat: 'body' },
      // raised hackles ridge along the spine
      { shape: 'cube',   px: 0,     py:  0.28, pz: -0.15, sx: 0.12, sy: 0.14, sz: 0.60, mat: 'spot' },
      // chest (deeper at the front)
      { shape: 'cube',   px: 0,     py: -0.02, pz:  0.35, sx: 0.36, sy: 0.42, sz: 0.30, mat: 'spot' },
      // head + long snout
      { shape: 'cube',   px: 0,     py:  0.22, pz:  0.55, sx: 0.28, sy: 0.24, sz: 0.30, mat: 'body' },
      { shape: 'cube',   px: 0,     py:  0.16, pz:  0.78, sx: 0.16, sy: 0.14, sz: 0.26, mat: 'spot' },
      // bared teeth strip
      { shape: 'cube',   px: 0,     py:  0.08, pz:  0.80, sx: 0.14, sy: 0.04, sz: 0.18, mat: 'horn' },
      // two pointed ears
      { shape: 'cube',   px: -0.10, py:  0.40, pz:  0.48, sx: 0.05, sy: 0.12, sz: 0.05, mat: 'spot' },
      { shape: 'cube',   px:  0.10, py:  0.40, pz:  0.48, sx: 0.05, sy: 0.12, sz: 0.05, mat: 'spot' },
      // 4 lean legs
      { shape: 'cube',   px: -0.15, py: -0.25, pz:  0.35, sx: 0.09, sy: 0.32, sz: 0.09, mat: 'spot' },
      { shape: 'cube',   px:  0.15, py: -0.25, pz:  0.35, sx: 0.09, sy: 0.32, sz: 0.09, mat: 'spot' },
      { shape: 'cube',   px: -0.15, py: -0.25, pz: -0.40, sx: 0.09, sy: 0.32, sz: 0.09, mat: 'spot' },
      { shape: 'cube',   px:  0.15, py: -0.25, pz: -0.40, sx: 0.09, sy: 0.32, sz: 0.09, mat: 'spot' },
      // low tail
      { shape: 'cube',   px: 0,     py:  0.10, pz: -0.65, sx: 0.07, sy: 0.07, sz: 0.30, mat: 'body' },
      // two hungry yellow eyes
      { shape: 'sphere', px: -0.08, py:  0.26, pz:  0.70, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.08, py:  0.26, pz:  0.70, sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
    ],
  },

  // ── NIGHT BOSS VampireLord — tall caped figure, crimson core, bat-wing
  //    blades. Phase-2 enrage at 50% HP.
  vampirelord: {
    kind: 'vampirelord', tier: 'BOSS',
    hp: 2000, speed: 2.9,
    colliderHX: 1.00, colliderHY: 1.40, colliderHZ: 0.90,
    damage: 42, score: 1000, xp: 70, knockback: 0.10, deathFx: 'gem',
    bossPhase2HpFraction: 0.5,
    palette: {
      body: { color: [0.08, 0.06, 0.12], roughness: 0.45, metallic: 0.1 },
      spot: { color: [0.45, 0.05, 0.10], roughness: 0.4 },
      horn: { color: [0.75, 0.70, 0.60], roughness: 0.3, metallic: 0.5 },
      eye:  { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.10, 0.15], emissiveIntensity: 2.0 },
      glow: { color: [1.0, 0.15, 0.25], emissive: [1.0, 0.10, 0.20], emissiveIntensity: 1.6 },
      wing: { color: [0.20, 0.08, 0.25], roughness: 0.5, metallic: 0.2 },
    },
    // Tall slim giant. py LOCAL range [-1.40, +1.40].
    parts: [
      // long legs under the robe
      { shape: 'cube',   px: -0.30, py: -0.90, pz:  0,    sx: 0.34, sy: 1.00, sz: 0.40, mat: 'body' },
      { shape: 'cube',   px:  0.30, py: -0.90, pz:  0,    sx: 0.34, sy: 1.00, sz: 0.40, mat: 'body' },
      // slim tall torso
      { shape: 'cube',   px: 0,     py:  0.10, pz:  0,    sx: 1.05, sy: 1.30, sz: 0.75, mat: 'body' },
      // blood-red inner robe panel
      { shape: 'cube',   px: 0,     py:  0.00, pz:  0.40, sx: 0.60, sy: 1.05, sz: 0.06, mat: 'spot' },
      // glowing crimson heart
      { shape: 'sphere', px: 0,     py:  0.30, pz:  0.46, sx: 0.26, sy: 0.26, sz: 0.26, mat: 'glow' },
      // huge cape (wide thin slab behind)
      { shape: 'cube',   px: 0,     py:  0.05, pz: -0.50, sx: 1.80, sy: 1.60, sz: 0.08, mat: 'wing' },
      // high collar (two angled plates framing the head)
      { shape: 'cube',   px: -0.50, py:  0.95, pz: -0.15, sx: 0.10, sy: 0.70, sz: 0.45, mat: 'spot', rotY:  0.4 },
      { shape: 'cube',   px:  0.50, py:  0.95, pz: -0.15, sx: 0.10, sy: 0.70, sz: 0.45, mat: 'spot', rotY: -0.4 },
      // pale head
      { shape: 'cube',   px: 0,     py:  1.05, pz:  0.10, sx: 0.55, sy: 0.50, sz: 0.55, mat: 'horn' },
      // slicked crown spikes
      { shape: 'cube',   px: -0.15, py:  1.35, pz:  0,    sx: 0.10, sy: 0.18, sz: 0.10, mat: 'body' },
      { shape: 'cube',   px:  0.15, py:  1.35, pz:  0,    sx: 0.10, sy: 0.18, sz: 0.10, mat: 'body' },
      // burning eye-slit
      { shape: 'cube',   px: 0,     py:  1.08, pz:  0.40, sx: 0.36, sy: 0.06, sz: 0.04, mat: 'eye' },
      // two bat-wing blades flaring from the shoulders
      { shape: 'cube',   px: -0.95, py:  0.65, pz: -0.30, sx: 0.06, sy: 0.90, sz: 0.70, mat: 'wing', rotY:  0.6 },
      { shape: 'cube',   px:  0.95, py:  0.65, pz: -0.30, sx: 0.06, sy: 0.90, sz: 0.70, mat: 'wing', rotY: -0.6 },
      // clawed hands
      { shape: 'cube',   px: -0.65, py: -0.10, pz:  0.25, sx: 0.14, sy: 0.45, sz: 0.18, mat: 'horn' },
      { shape: 'cube',   px:  0.65, py: -0.10, pz:  0.25, sx: 0.14, sy: 0.45, sz: 0.18, mat: 'horn' },
    ],
  },
};

// ─── runtime ───────────────────────────────────────────────────────────────

// ── Monster visuals from packs (the editable appearance SSOT) ──────────────
// assets/monsters/<kind>.pack.json (generated once by scripts/gen-monster-packs.ts,
// then edited freely in the Studio editor's 怪物资产 scene group) overrides the
// built-in parts/palette above at game start. The pack is a NATIVE scene pack:
// each part is an entity whose Name carries the material-slot key
// (`body` / `glow_2` / …), MeshFilter picks cube vs sphere, MeshRenderer points
// at the slot's material. Behavior (hp/speed/damage/AI) stays in code — only
// the look is data. Missing/corrupt packs silently keep the built-in look.
const PACK_CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const PACK_SPHERE_GUID = '95730fd2-9846-5f84-8658-0b3c971eb263';
const MAT_KEYS = new Set<PartMatKey>(['body', 'spot', 'horn', 'eye', 'glow', 'aura', 'wing']);

interface MonsterPackEntity { localId: number; components: Record<string, Record<string, unknown>> }

function parseMonsterPack(pack: unknown): { parts: PartSpec[]; palette: EnemyDef['palette'] } | null {
  const assets = (pack as { assets?: Array<{ guid: string; kind: string; payload: unknown; refs?: string[] }> })?.assets;
  if (!Array.isArray(assets)) return null;
  const sceneEntry = assets.find((a) => a.kind === 'scene');
  if (!sceneEntry) return null;
  const refs = sceneEntry.refs ?? [];
  const matByGuid = new Map<string, Record<string, unknown>>();
  for (const a of assets) {
    if (a.kind !== 'material') continue;
    const pv = (a.payload as { paramValues?: Record<string, unknown> })?.paramValues;
    if (pv) matByGuid.set(a.guid, pv);
  }
  const entities = ((sceneEntry.payload as { entities?: MonsterPackEntity[]; nodes?: MonsterPackEntity[] })?.entities
    ?? (sceneEntry.payload as { nodes?: MonsterPackEntity[] })?.nodes) ?? [];
  const parts: PartSpec[] = [];
  const palette: EnemyDef['palette'] = {};
  for (const e of entities) {
    const comps = e.components ?? {};
    const mf = comps.MeshFilter as { assetHandle?: number } | undefined;
    if (!mf || typeof mf.assetHandle !== 'number') continue;  // lights/etc — visual parts only
    const name = String((comps.Name as { value?: string } | undefined)?.value ?? 'body');
    const slotRaw = name.replace(/_\d+$/, '');
    const slot: PartMatKey = MAT_KEYS.has(slotRaw as PartMatKey) ? (slotRaw as PartMatKey) : 'body';
    const t = (comps.Transform ?? {}) as Record<string, number>;
    const meshGuid = refs[mf.assetHandle];
    // ubpa 17926e5 migrated MeshRenderer to `materials: [<ref-index>]` (plural
    // array) for engine 81dfc5297's spawn-data fail-fast. Read the new field
    // first; fall back to legacy `material` (singular) so any non-migrated pack
    // still works.
    const mr = comps.MeshRenderer as { material?: number; materials?: readonly number[] } | undefined;
    const mrIdx = Array.isArray(mr?.materials) ? mr.materials[0] : mr?.material;
    const pv = typeof mrIdx === 'number' ? matByGuid.get(refs[mrIdx] ?? '') : undefined;
    if (pv && !palette[slot]) {
      const bc = (pv.baseColor as number[] | undefined) ?? [1, 1, 1, 1];
      const em = pv.emissive as number[] | undefined;
      palette[slot] = {
        color: [bc[0] ?? 1, bc[1] ?? 1, bc[2] ?? 1],
        ...(typeof pv.metallic === 'number' ? { metallic: pv.metallic } : {}),
        ...(typeof pv.roughness === 'number' ? { roughness: pv.roughness } : {}),
        ...(em ? { emissive: [em[0] ?? 0, em[1] ?? 0, em[2] ?? 0] as [number, number, number] } : {}),
        ...(typeof pv.emissiveIntensity === 'number' ? { emissiveIntensity: pv.emissiveIntensity } : {}),
      };
    }
    const spec: PartSpec = {
      shape: meshGuid === PACK_SPHERE_GUID ? 'sphere' : 'cube',
      px: t.posX ?? 0, py: t.posY ?? 0, pz: t.posZ ?? 0,
      sx: t.scaleX ?? 1, sy: t.scaleY ?? 1, sz: t.scaleZ ?? 1,
      mat: slot,
    };
    // Recover a pure-Y rotation (the only axis lowpoly parts use). Editor
    // rotations on other axes are dropped — spawn() only applies eulerY.
    const qy = t.quatY ?? 0, qw = t.quatW ?? 1;
    if (Math.abs(t.quatX ?? 0) < 1e-3 && Math.abs(t.quatZ ?? 0) < 1e-3 && Math.abs(qy) > 1e-4) {
      spec.rotY = 2 * Math.atan2(qy, qw);
    }
    parts.push(spec);
  }
  if (parts.length === 0) return null;
  return { parts, palette };
}

/** Replace each enemy kind's built-in look with its pack, when present. Call
 *  BEFORE constructing EnemyManager (the constructor bakes palette materials). */
export async function loadMonsterVisuals(moduleUrl: string): Promise<void> {
  await Promise.all((Object.keys(ENEMIES) as EnemyKind[]).map(async (kind) => {
    try {
      const res = await fetch(new URL(`./assets/monsters/${kind}.pack.json`, moduleUrl), { cache: 'no-store' });
      if (!res.ok) return;
      const visual = parseMonsterPack(await res.json());
      if (!visual) return;
      ENEMIES[kind].parts = visual.parts;
      if (Object.keys(visual.palette).length > 0) ENEMIES[kind].palette = visual.palette;
    } catch { /* keep the built-in look */ }
  }));
}

export type PackVisual = { parts: PartSpec[]; palette: EnemyDef['palette'] };

/** Load a character appearance pack (assets/characters/<name>.pack.json —
 *  same editable format as the monster packs). */
export async function loadCharacterVisual(moduleUrl: string, name: string): Promise<PackVisual | null> {
  try {
    const res = await fetch(new URL(`./assets/characters/${name}.pack.json`, moduleUrl), { cache: 'no-store' });
    if (!res.ok) return null;
    return parseMonsterPack(await res.json());
  } catch { return null; }
}

/** Spawn a parsed pack's visual parts as ChildOf `root` with plain materials
 *  (no hit-flash/slow variants) — the player character assembly path. Returns
 *  the spawned parts with their authored scales (FPS mode hides via scale-0). */
export function spawnPackVisual(
  ctx: Ctx,
  root: Entity,
  visual: PackVisual,
): Array<{ e: Entity; sx: number; sy: number; sz: number }> {
  const { world } = ctx;
  const mats = new Map<PartMatKey, MatHandle>();
  for (const [key, p] of Object.entries(visual.palette)) {
    if (!p) continue;
    // engine e53f4616: `assets.register` is gone → mint an inline shared
    // material handle directly via `world.allocSharedRef` (never fails).
    mats.set(key as PartMatKey, world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
      baseColor: [p.color[0], p.color[1], p.color[2], 1],
      metallic: p.metallic ?? 0.05,
      roughness: p.roughness ?? 0.6,
      emissive: p.emissive,
      emissiveIntensity: p.emissiveIntensity ?? (p.emissive ? 2 : 0),
    })));
  }
  const out: Array<{ e: Entity; sx: number; sy: number; sz: number }> = [];
  for (const ps of visual.parts) {
    const m = mats.get(ps.mat) ?? mats.get('body');
    if (!m) continue;
    const tform: Record<string, number> = {
      posX: ps.px, posY: ps.py, posZ: ps.pz,
      scaleX: ps.sx, scaleY: ps.sy, scaleZ: ps.sz,
    };
    if (ps.rotY !== undefined) {
      const q = quat.eulerY(ps.rotY);
      tform.quatX = q[0]!; tform.quatY = q[1]!; tform.quatZ = q[2]!; tform.quatW = q[3]!;
    }
    const e = world.spawn(
      { component: Transform, data: tform },
      { component: MeshFilter, data: { assetHandle: ps.shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [m] } },
      { component: ChildOf, data: { parent: root } },
    ).unwrap();
    out.push({ e, sx: ps.sx, sy: ps.sy, sz: ps.sz });
  }
  return out;
}

export interface Enemy {
  e: Entity;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  /** Cached XZ for AI / queries (synced from Transform each tick). */
  x: number; z: number;
  /** Status timers (seconds remaining). */
  flashUntil: number;
  slowUntil: number;
  poisonUntil: number;
  /** Phase-2 latch for boss (kicks once below bossPhase2HpFraction). */
  enraged: boolean;
  /** All visual parts (root included), so we can swap their materials in
   *  bulk for hit-flash / cold-tint without touching the registered POD. */
  parts: Array<{ e: Entity; matKey: PartMatKey }>;
  /** Per-kind material variants (one set, shared across all instances). */
  matBank: MatBank;
  matState: 'normal' | 'flash' | 'slow';
}

interface MatBank {
  /** Per part-material-slot, the three visual variants. */
  byKey: Map<PartMatKey, { normal: MatHandle; flash: MatHandle; slow: MatHandle }>;
}

export class EnemyManager {
  enemies: Enemy[] = [];
  private banks = new Map<EnemyKind, MatBank>();
  /** Active level's spawn tables — set via setLevel before the first tick. */
  private cfg: LevelSpawnConfig | null = null;
  private elapsed = 0;
  private spawnTimer = 0;
  private bossTimer = 60;
  private bossWarned = false;     // edge-trigger for the "boss incoming" warning
  private maxAlive = 30;
  private worldRadius = 26;
  private playArea = 28;
  /** Difficulty knob — bumped when player levels (callable from main.ts). */
  difficultyTier = 0;

  /** Optional callbacks main.ts can wire up for boss-related cinematic FX. */
  onBossWarning: (() => void) | null = null;
  onBossSpawn: ((x: number, z: number) => void) | null = null;

  constructor(private ctx: Ctx) {
    // Pre-register the 3 material variants for each named slot of every kind.
    for (const def of Object.values(ENEMIES)) {
      const bank: MatBank = { byKey: new Map() };
      for (const [key, p] of Object.entries(def.palette)) {
        if (!p) continue;
        const baseColor: [number, number, number, number] = [p.color[0], p.color[1], p.color[2], 1];
        // engine e53f4616: `assets.register` is gone → mint inline shared
        // material handles directly via `world.allocSharedRef` (never fails).
        const normal = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor,
          metallic: p.metallic ?? 0.05,
          roughness: p.roughness ?? 0.6,
          emissive: p.emissive,
          emissiveIntensity: p.emissiveIntensity ?? (p.emissive ? 2 : 0),
        }));
        // Hit flash: subdued reddish flash. Previously emissive (1,1,0.7)×9 ≈ pure white
        // post-ACES — when fire bullets hit a stream of enemies, every flash bleached the
        // bullet stream in screen-space and made the (correctly red) fire-trail look like
        // it "drifted to white". Drop intensity to 1.4 and hue to warm-amber so the flash
        // pops without saturating, and reads as "hit" not "explosion".
        const flash = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [1, 0.55, 0.35, 1], roughness: 0.4, metallic: 0,
          emissive: [1, 0.45, 0.20], emissiveIntensity: 1.4,
        }));
        // Cold-tint: lerp toward icy cyan.
        const slow = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [
            p.color[0] * 0.4 + 0.4,
            p.color[1] * 0.4 + 0.55,
            p.color[2] * 0.4 + 0.85,
            1,
          ] as [number, number, number, number],
          metallic: 0.2, roughness: 0.35,
          emissive: [0.3, 0.6, 1.0], emissiveIntensity: 1.4,
        }));
        bank.byKey.set(key as PartMatKey, { normal, flash, slow });
      }
      this.banks.set(def.kind, bank);
    }
  }

  /** Build a single enemy instance: spawn the root rigid body, then assemble
   *  every PartSpec as a ChildOf the root (visual-only, no collider). */
  spawn(kind: EnemyKind, x: number, z: number): Enemy {
    const def = ENEMIES[kind];
    const bank = this.banks.get(kind)!;
    const { world } = this.ctx;
    const rootY = def.colliderHY + 0.05;

    // ROOT — invisible (no MeshFilter/Renderer). Holds the rigid body.
    //
    // Kinematic vs dynamic: we use **kinematic** here, NOT dynamic. Reason:
    // tickAI() drives each enemy by WRITING Transform.posX/posZ every frame.
    // For a dynamic body, rapier overwrites the Transform from its own
    // simulation each step, so manual writes get clobbered → enemies sit
    // still. Kinematic = "you set the Transform, rapier honors it AND
    // generates contact events". The kinematic body still pushes dynamic
    // props out of the way (the same trick the player uses), and its
    // Collider still registers contacts (used for player damage). Knock-
    // back from bullets is handled by main.ts (per-hit Transform.posX/Z
    // displacement), not by rapier impulses.
    const root = world.spawn(
      { component: Transform, data: { posX: x, posY: rootY, posZ: z } },
      { component: RigidBody, data: {
        type: RigidBodyTypeValue.kinematic,
      } },
      { component: Collider, data: {
        shape: ColliderShapeValue.cuboid,
        halfExtentsX: def.colliderHX,
        halfExtentsY: def.colliderHY,
        halfExtentsZ: def.colliderHZ,
        friction: 0.6, restitution: 0.05,
      } },
    ).unwrap();

    const parts: Array<{ e: Entity; matKey: PartMatKey }> = [];
    for (const ps of def.parts) {
      const slot = bank.byKey.get(ps.mat);
      if (!slot) continue;
      const meshHandle = ps.shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE;
      const tform: Record<string, number> = {
        posX: ps.px, posY: ps.py, posZ: ps.pz,
        scaleX: ps.sx, scaleY: ps.sy, scaleZ: ps.sz,
      };
      if (ps.rotY !== undefined) {
        const q = quat.eulerY(ps.rotY);
        tform.quatX = q[0]!; tform.quatY = q[1]!; tform.quatZ = q[2]!; tform.quatW = q[3]!;
      }
      const partE = world.spawn(
        { component: Transform, data: tform },
        { component: MeshFilter, data: { assetHandle: meshHandle } },
        { component: MeshRenderer, data: { materials: [slot.normal] } },
        { component: ChildOf, data: { parent: root } },
      ).unwrap();
      parts.push({ e: partE, matKey: ps.mat });
    }

    const en: Enemy = {
      e: root, kind, hp: def.hp, maxHp: def.hp, x, z,
      flashUntil: 0, slowUntil: 0, poisonUntil: 0,
      enraged: false,
      parts, matBank: bank, matState: 'normal',
    };
    this.enemies.push(en);
    return en;
  }

  spawnAtRing(kind: EnemyKind, centerX: number, centerZ: number): Enemy {
    const ang = Math.random() * Math.PI * 2;
    const r = this.worldRadius + Math.random() * 4;
    let x = centerX + Math.cos(ang) * r;
    let z = centerZ + Math.sin(ang) * r;
    x = Math.max(-this.playArea, Math.min(this.playArea, x));
    z = Math.max(-this.playArea, Math.min(this.playArea, z));
    return this.spawn(kind, x, z);
  }

  // ─── difficulty / spawn ────────────────────────────────────────────────

  /** Switch the spawner to a level's tables and reset all pacing clocks.
   *  main.ts calls this on game start and on every stage transition. */
  setLevel(cfg: LevelSpawnConfig): void {
    this.cfg = cfg;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.bossTimer = cfg.bossFirstAt;
    this.bossWarned = false;
    this.maxAlive = cfg.aliveBase;
  }

  /** Despawn every alive enemy (no drops, no death FX) — stage transition. */
  killAll(): void {
    for (const en of this.enemies) {
      for (const p of en.parts) this.ctx.world.despawn(p.e);
      this.ctx.world.despawn(en.e);
    }
    this.enemies.length = 0;
  }

  /** Pick a kind for THIS spawn from the active level's time-phased
   *  cumulative-weight tables. The last phase is the open-ended tail. */
  private rollKind(): EnemyKind {
    const phases = this.cfg!.phases;
    let phase = phases[phases.length - 1]!;
    for (const p of phases) {
      if (this.elapsed < p.until) { phase = p; break; }
    }
    const r = Math.random();
    for (const [kind, cum] of phase.weights) {
      if (r < cum) return kind;
    }
    return phase.weights[phase.weights.length - 1]![0];
  }

  tickSpawn(dt: number, playerX: number, playerZ: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.elapsed += dt;
    this.spawnTimer -= dt;
    this.bossTimer -= dt;
    this.maxAlive = Math.min(cfg.aliveCap, cfg.aliveBase + Math.floor(this.elapsed / 10) * cfg.alivePer10s);

    // Boss approach warning — fire 4s before the boss spawns so main.ts can
    // play the banner + red screen shake. Edge-trigger via the bossWarned
    // latch so we don't fire every frame.
    const bossAlive = this.enemies.some((e) => ENEMIES[e.kind].tier === 'BOSS');
    if (this.bossTimer <= 4 && !this.bossWarned && !bossAlive) {
      this.bossWarned = true;
      this.onBossWarning?.();
    }

    // Boss
    if (this.bossTimer <= 0 && !bossAlive) {
      const ang = Math.random() * Math.PI * 2;
      const r = this.worldRadius + 2;
      const bx = playerX + Math.cos(ang) * r;
      const bz = playerZ + Math.sin(ang) * r;
      this.spawn(cfg.boss, bx, bz);
      this.onBossSpawn?.(bx, bz);
      this.bossTimer = cfg.bossInterval;
      this.bossWarned = false;
    }

    if (this.spawnTimer > 0) return;
    if (this.enemies.length >= this.maxAlive) {
      this.spawnTimer = 0.6;
      return;
    }
    const waveSize = cfg.waveBase + Math.floor(Math.random() * (cfg.waveRand + 1))
      + Math.min(cfg.waveGrowthCap, Math.floor(this.elapsed / 25));
    for (let i = 0; i < waveSize; i++) {
      if (this.enemies.length >= this.maxAlive) break;
      this.spawnAtRing(this.rollKind(), playerX, playerZ);
    }
    // Spawn cadence accelerates over time, but never below the floor (so the
    // run feels relentless without melting the solver).
    this.spawnTimer = Math.max(cfg.intervalMin, cfg.intervalStart - this.elapsed * cfg.intervalAccel);
  }

  // ─── per-frame AI ──────────────────────────────────────────────────────
  tickAI(dt: number, playerX: number, playerZ: number): void {
    const { world } = this.ctx;
    for (const en of this.enemies) {
      const tr = world.get(en.e, Transform);
      if (!tr.ok) continue;
      en.x = tr.value.posX;
      en.z = tr.value.posZ;
      const def = ENEMIES[en.kind];

      // Boss enrage: bump speed once below threshold
      let speed = def.speed;
      if (def.bossPhase2HpFraction !== undefined && !en.enraged && en.hp <= en.maxHp * def.bossPhase2HpFraction) {
        en.enraged = true;
      }
      if (en.enraged) speed *= 1.45;

      // Slow status
      if (en.slowUntil > 0) speed *= 0.45;

      const dx = playerX - en.x;
      const dz = playerZ - en.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = speed * dt;
      const nx = en.x + (dx / d) * sp;
      const nz = en.z + (dz / d) * sp;
      const yaw = Math.atan2(-dx, -dz);
      const q = quat.eulerY(yaw);
      world.set(en.e, Transform, {
        posX: nx, posZ: nz,
        quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]!,
      });
      en.x = nx; en.z = nz;

      // Status decay
      en.flashUntil = Math.max(0, en.flashUntil - dt);
      en.slowUntil = Math.max(0, en.slowUntil - dt);
      en.poisonUntil = Math.max(0, en.poisonUntil - dt);

      // Material state machine — switch ALL parts when state changes.
      const want: 'normal' | 'flash' | 'slow' =
        en.flashUntil > 0 ? 'flash' : en.slowUntil > 0 ? 'slow' : 'normal';
      if (want !== en.matState) {
        for (const p of en.parts) {
          const slot = en.matBank.byKey.get(p.matKey);
          if (!slot) continue;
          const mat = want === 'flash' ? slot.flash : want === 'slow' ? slot.slow : slot.normal;
          world.set(p.e, MeshRenderer, { materials: [mat] });
        }
        en.matState = want;
      }
    }
  }

  // ─── status / damage / lifecycle ───────────────────────────────────────
  damage(en: Enemy, dmg: number): { score: number; xp: number; kind: EnemyKind; x: number; z: number } | null {
    en.hp -= dmg;
    en.flashUntil = 0.08;
    if (en.hp <= 0) {
      const def = ENEMIES[en.kind];
      const payload = { score: def.score, xp: def.xp, kind: en.kind, x: en.x, z: en.z };
      this.kill(en);
      return payload;
    }
    return null;
  }

  slow(en: Enemy, sec: number): void {
    en.slowUntil = Math.max(en.slowUntil, sec);
  }

  /** Kill + remove. Caller looks at ENEMIES[kind].deathFx for spawn-on-death. */
  kill(en: Enemy): void {
    // Despawn all parts (they're parented but rapier doesn't auto-cull).
    for (const p of en.parts) this.ctx.world.despawn(p.e);
    this.ctx.world.despawn(en.e);
    const i = this.enemies.indexOf(en);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  // ─── queries (for weapons / contact damage) ────────────────────────────
  nearest(x: number, z: number, maxR: number = 30): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxR * maxR;
    for (const en of this.enemies) {
      const dx = en.x - x, dz = en.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = en; }
    }
    return best;
  }

  inRadius(x: number, z: number, r: number): Enemy[] {
    const r2 = r * r;
    const out: Enemy[] = [];
    for (const en of this.enemies) {
      const dx = en.x - x, dz = en.z - z;
      if (dx * dx + dz * dz <= r2) out.push(en);
    }
    return out;
  }
}
