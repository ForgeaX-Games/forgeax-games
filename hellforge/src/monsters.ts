// Hellforge bestiary + MonsterManager — Act 1 monsters.
//
// Visual architecture (cow-survivor pattern): each monster is an invisible
// ROOT entity (Transform only, no physics — all movement/hit-tests are plain
// math) with lowpoly cube/sphere parts as ChildOf children. The manager
// writes the root Transform each frame: position + facing yaw + a shamble
// bob so the statue-still primitives read as "alive".
//
// AI: idle until the player enters aggroRange → chase → melee swing (or
// ranged fire bolt for the shaman) on cooldown. A walkable(x, z) callback
// lets the dungeon's PCG grid block movement; the open wilderness passes
// `() => true`.

import {
  AnimationPlayer,
} from '@forgeax/engine-animation';
import {
  ChildOf,
  Transform,
} from '@forgeax/engine-scene';
import {
  Materials,
  MeshFilter,
  MeshRenderer,
  SceneInstance,
} from '@forgeax/engine-render';
import {
  quat,
} from '@forgeax/engine-runtime';
import {
  type MaterialAsset,
} from '@forgeax/engine-types';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { ENTITY_NULL_RAW, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { AnimationClip, Handle, SceneAsset } from '@forgeax/engine-types';
import { normalizeClipRoot } from './anim-root';
import { armSkinnedAnimationPlayer, collectRootJointTargetIds } from './bind-skinned-animation';
import type { BodyVfx, FlightStyle, FxSystem, NovaTelegraphVfx } from './fx';
import { combatBeat } from './fx/defs';
import type { ContactShadowKit } from './contact-shadow';
import { createEnemyRings, type EnemyRingHandle, type EnemyRings } from './enemy-rings';

type MatHandle = Handle<'MaterialAsset', 'shared'>;

export type MonsterKind = 'imp' | 'ashwalker' | 'charred' | 'flamecaller' | 'slaglord';

/**
 * Zone split for lazy GLB-visual loading (PR11 T5). Wild kinds spawn from
 * frame one (authored ashen-reach encounters), so they load at boot; den-only
 * kinds load lazily inside ensureDenLoaded(). The den ALSO spawns wild kinds,
 * but those banks are already warm from boot, so the den pre-spawn (run after
 * the den kinds load) always finds every bank it needs.
 */
export const WILD_MONSTER_KINDS: readonly MonsterKind[] = ['imp', 'ashwalker', 'charred'];
export const DEN_MONSTER_KINDS: readonly MonsterKind[] = ['flamecaller', 'slaglord'];

export type PartMatKey = 'body' | 'accent' | 'bone' | 'eye' | 'glow' | 'weapon';

export interface PartSpec {
  shape: 'cube' | 'sphere';
  px: number; py: number; pz: number;
  sx: number; sy: number; sz: number;
  rotY?: number;
  mat: PartMatKey;
}

export interface MonsterDef {
  kind: MonsterKind;
  name: string;               // HUD / banner display name (Chinese)
  hp: number;
  speed: number;              // m/s chase speed
  damage: number;             // per melee swing / projectile
  attackRange: number;        // melee reach (m, centre-to-centre)
  attackCooldown: number;     // s between swings
  aggroRange: number;
  xp: number;
  /** Monster level — drives dropped item level (装备等级). */
  level: number;
  goldChance: number;         // 0..1 → drops a gold pile
  radius: number;             // body radius for projectile hit-tests
  isBoss?: boolean;
  ranged?: { speed: number; cooldown: number; range: number; keepDistance: number };
  enrageBelow?: number;       // hp fraction → speed ×1.5
  palette: Partial<Record<PartMatKey, { color: [number, number, number]; emissive?: [number, number, number]; emissiveIntensity?: number; roughness?: number; metallic?: number }>>;
  parts: PartSpec[];
}

// Part py values are ABSOLUTE heights above ground — the root's Transform
// carries only (x, bob, z) + yaw, so blueprints below read like elevation
// drawings. Facing is +Z.
export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  // ── 炉渣小鬼 Cinder Imp — small ember imp, fast, cowardly numbers ──────────────
  imp: {
    kind: 'imp', name: '炉渣小鬼',
    hp: 26, speed: 3.4, damage: 5, attackRange: 1.0, attackCooldown: 1.1,
    aggroRange: 11, xp: 7, level: 1, goldChance: 0.35, radius: 0.45,
    palette: {
      body:   { color: [0.72, 0.16, 0.10], roughness: 0.8 },
      accent: { color: [0.42, 0.08, 0.06], roughness: 0.85 },
      bone:   { color: [0.85, 0.78, 0.60], roughness: 0.6 },
      eye:    { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.85, 0.15], emissiveIntensity: 6 },
      weapon: { color: [0.45, 0.42, 0.40], metallic: 0.6, roughness: 0.35 },
    },
    parts: [
      { shape: 'cube',   px: 0,     py: 0.52, pz: 0,     sx: 0.42, sy: 0.42, sz: 0.30, mat: 'body' },   // torso
      { shape: 'cube',   px: 0,     py: 0.92, pz: 0.02,  sx: 0.34, sy: 0.30, sz: 0.30, mat: 'body' },   // head
      { shape: 'cube',   px: -0.12, py: 1.14, pz: 0,     sx: 0.07, sy: 0.22, sz: 0.07, mat: 'bone', rotY: 0.3 },  // horn L
      { shape: 'cube',   px:  0.12, py: 1.14, pz: 0,     sx: 0.07, sy: 0.22, sz: 0.07, mat: 'bone', rotY: -0.3 }, // horn R
      { shape: 'sphere', px: -0.09, py: 0.94, pz: 0.16,  sx: 0.06, sy: 0.06, sz: 0.06, mat: 'eye' },
      { shape: 'sphere', px:  0.09, py: 0.94, pz: 0.16,  sx: 0.06, sy: 0.06, sz: 0.06, mat: 'eye' },
      { shape: 'cube',   px: -0.14, py: 0.20, pz: 0,     sx: 0.12, sy: 0.40, sz: 0.12, mat: 'accent' }, // leg L
      { shape: 'cube',   px:  0.14, py: 0.20, pz: 0,     sx: 0.12, sy: 0.40, sz: 0.12, mat: 'accent' }, // leg R
      { shape: 'cube',   px:  0.30, py: 0.60, pz: 0.10,  sx: 0.09, sy: 0.09, sz: 0.34, mat: 'accent' }, // arm R (forward)
      { shape: 'cube',   px:  0.30, py: 0.60, pz: 0.42,  sx: 0.05, sy: 0.16, sz: 0.34, mat: 'weapon' }, // crude blade
      { shape: 'cube',   px: -0.28, py: 0.58, pz: 0.04,  sx: 0.09, sy: 0.09, sz: 0.26, mat: 'accent' }, // arm L
    ],
  },

  // ── 灰烬行尸 Ash Walker — slow shambler, tanky, hits hard ──────────────────────
  ashwalker: {
    kind: 'ashwalker', name: '灰烬行尸',
    hp: 55, speed: 1.15, damage: 11, attackRange: 1.15, attackCooldown: 1.6,
    aggroRange: 9, xp: 11, level: 2, goldChance: 0.45, radius: 0.55,
    palette: {
      body:   { color: [0.35, 0.42, 0.28], roughness: 0.95 },
      accent: { color: [0.22, 0.26, 0.18], roughness: 0.95 },
      bone:   { color: [0.30, 0.14, 0.12], roughness: 0.9 },   // gore patches
      eye:    { color: [0.05, 0.05, 0.05], emissive: [0.9, 0.95, 0.5], emissiveIntensity: 4 },
    },
    parts: [
      { shape: 'cube',   px: 0,     py: 0.95, pz: 0,     sx: 0.56, sy: 0.62, sz: 0.34, mat: 'body' },   // torso
      { shape: 'cube',   px: 0.10,  py: 1.42, pz: 0.04,  sx: 0.32, sy: 0.32, sz: 0.30, mat: 'body', rotY: 0.25 }, // tilted head
      { shape: 'cube',   px: -0.08, py: 1.05, pz: 0.18,  sx: 0.20, sy: 0.26, sz: 0.05, mat: 'bone' },   // chest wound
      { shape: 'sphere', px:  0.04, py: 1.46, pz: 0.18,  sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.20, py: 1.45, pz: 0.16,  sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'cube',   px: -0.16, py: 0.32, pz: 0,     sx: 0.16, sy: 0.64, sz: 0.16, mat: 'accent' }, // leg L
      { shape: 'cube',   px:  0.16, py: 0.30, pz: 0.06,  sx: 0.16, sy: 0.60, sz: 0.16, mat: 'accent' }, // leg R (dragging)
      { shape: 'cube',   px: -0.36, py: 1.05, pz: 0.30,  sx: 0.11, sy: 0.11, sz: 0.55, mat: 'body' },   // arm L (outstretched)
      { shape: 'cube',   px:  0.36, py: 1.00, pz: 0.28,  sx: 0.11, sy: 0.11, sz: 0.50, mat: 'body' },   // arm R (outstretched)
    ],
  },

  // ── 焦骨武士 Charred Bones — scorched bone warrior with blade ──────────────────────────
  charred: {
    kind: 'charred', name: '焦骨武士',
    hp: 38, speed: 2.3, damage: 8, attackRange: 1.2, attackCooldown: 1.25,
    aggroRange: 10, xp: 13, level: 3, goldChance: 0.5, radius: 0.5,
    palette: {
      bone:   { color: [0.88, 0.84, 0.72], roughness: 0.55 },
      accent: { color: [0.55, 0.50, 0.40], roughness: 0.7 },
      eye:    { color: [0.05, 0.05, 0.05], emissive: [0.4, 0.9, 1.0], emissiveIntensity: 7 },
      weapon: { color: [0.55, 0.55, 0.62], metallic: 0.75, roughness: 0.3 },
    },
    parts: [
      { shape: 'cube',   px: 0,     py: 1.05, pz: 0,     sx: 0.42, sy: 0.40, sz: 0.24, mat: 'bone' },   // ribcage
      { shape: 'cube',   px: 0,     py: 0.72, pz: 0,     sx: 0.26, sy: 0.16, sz: 0.18, mat: 'accent' }, // pelvis
      { shape: 'sphere', px: 0,     py: 1.48, pz: 0,     sx: 0.24, sy: 0.26, sz: 0.24, mat: 'bone' },   // skull
      { shape: 'cube',   px: 0,     py: 1.36, pz: 0.06,  sx: 0.16, sy: 0.10, sz: 0.14, mat: 'bone' },   // jaw
      { shape: 'sphere', px: -0.08, py: 1.52, pz: 0.14,  sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'sphere', px:  0.08, py: 1.52, pz: 0.14,  sx: 0.05, sy: 0.05, sz: 0.05, mat: 'eye' },
      { shape: 'cube',   px: -0.12, py: 0.34, pz: 0,     sx: 0.10, sy: 0.68, sz: 0.10, mat: 'bone' },   // leg L
      { shape: 'cube',   px:  0.12, py: 0.34, pz: 0,     sx: 0.10, sy: 0.68, sz: 0.10, mat: 'bone' },   // leg R
      { shape: 'cube',   px:  0.30, py: 1.05, pz: 0.16,  sx: 0.08, sy: 0.08, sz: 0.40, mat: 'bone' },   // sword arm
      { shape: 'cube',   px:  0.30, py: 1.05, pz: 0.62,  sx: 0.06, sy: 0.14, sz: 0.55, mat: 'weapon' }, // blade
      { shape: 'cube',   px: -0.32, py: 1.05, pz: 0.10,  sx: 0.30, sy: 0.38, sz: 0.08, mat: 'accent', rotY: 0.35 }, // shield
    ],
  },

  // ── 火纹术士 Flamecaller — ranged fire caster, keeps distance ──────────
  flamecaller: {
    kind: 'flamecaller', name: '火纹术士',
    hp: 32, speed: 2.4, damage: 9, attackRange: 1.0, attackCooldown: 1.4,
    aggroRange: 13, xp: 18, level: 4, goldChance: 0.6, radius: 0.5,
    ranged: { speed: 9, cooldown: 2.2, range: 12, keepDistance: 7 },
    palette: {
      body:   { color: [0.72, 0.16, 0.10], roughness: 0.8 },
      accent: { color: [0.30, 0.06, 0.05], roughness: 0.85 },
      bone:   { color: [0.85, 0.78, 0.60], roughness: 0.6 },
      eye:    { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.85, 0.15], emissiveIntensity: 6 },
      glow:   { color: [1.0, 0.45, 0.10], emissive: [1.0, 0.40, 0.08], emissiveIntensity: 3 },
      weapon: { color: [0.35, 0.22, 0.12], roughness: 0.8 },
    },
    parts: [
      { shape: 'cube',   px: 0,     py: 0.70, pz: 0,     sx: 0.46, sy: 0.60, sz: 0.32, mat: 'body' },   // robed torso
      { shape: 'cube',   px: 0,     py: 0.25, pz: 0,     sx: 0.52, sy: 0.50, sz: 0.36, mat: 'accent' }, // robe skirt
      { shape: 'cube',   px: 0,     py: 1.18, pz: 0.02,  sx: 0.32, sy: 0.30, sz: 0.30, mat: 'body' },   // head
      { shape: 'cube',   px: 0,     py: 1.42, pz: 0,     sx: 0.38, sy: 0.12, sz: 0.34, mat: 'bone' },   // headdress
      { shape: 'cube',   px: -0.14, py: 1.52, pz: 0,     sx: 0.06, sy: 0.20, sz: 0.06, mat: 'bone', rotY: 0.3 },
      { shape: 'cube',   px:  0.14, py: 1.52, pz: 0,     sx: 0.06, sy: 0.20, sz: 0.06, mat: 'bone', rotY: -0.3 },
      { shape: 'sphere', px: -0.09, py: 1.20, pz: 0.16,  sx: 0.06, sy: 0.06, sz: 0.06, mat: 'eye' },
      { shape: 'sphere', px:  0.09, py: 1.20, pz: 0.16,  sx: 0.06, sy: 0.06, sz: 0.06, mat: 'eye' },
      { shape: 'cube',   px:  0.32, py: 0.85, pz: 0.10,  sx: 0.08, sy: 0.08, sz: 0.30, mat: 'body' },   // staff arm
      { shape: 'cube',   px:  0.34, py: 0.85, pz: 0.30,  sx: 0.07, sy: 0.95, sz: 0.07, mat: 'weapon' }, // staff
      { shape: 'sphere', px:  0.34, py: 1.38, pz: 0.30,  sx: 0.13, sy: 0.13, sz: 0.13, mat: 'glow' },   // staff orb
    ],
  },

  // ── 熔渣督军 Slaglord — Slagdeep Hollow unique (Act 1 boss slice) ────────
  slaglord: {
    kind: 'slaglord', name: '熔渣督军',
    hp: 360, speed: 2.4, damage: 14, attackRange: 2.3, attackCooldown: 2.4,
    aggroRange: 14, xp: 300, level: 6, goldChance: 1, radius: 1.15,
    isBoss: true, enrageBelow: 0.4,
    ranged: { speed: 11, cooldown: 6.0, range: 13, keepDistance: 0 },
    palette: {
      body:   { color: [0.38, 0.10, 0.14], roughness: 0.75 },
      accent: { color: [0.20, 0.05, 0.08], roughness: 0.85 },
      bone:   { color: [0.80, 0.72, 0.55], roughness: 0.55 },
      eye:    { color: [0.05, 0.05, 0.05], emissive: [1.0, 0.15, 0.05], emissiveIntensity: 10 },
      glow:   { color: [1.0, 0.30, 0.05], emissive: [1.0, 0.30, 0.05], emissiveIntensity: 2.5 },
      weapon: { color: [0.30, 0.28, 0.30], metallic: 0.7, roughness: 0.35 },
    },
    parts: [
      { shape: 'cube',   px: 0,     py: 1.45, pz: 0,     sx: 1.05, sy: 0.95, sz: 0.60, mat: 'body' },   // massive torso
      { shape: 'cube',   px: 0,     py: 0.60, pz: 0,     sx: 0.75, sy: 0.75, sz: 0.50, mat: 'accent' }, // hips
      { shape: 'cube',   px: 0,     py: 2.15, pz: 0.06,  sx: 0.50, sy: 0.45, sz: 0.45, mat: 'body' },   // head
      { shape: 'cube',   px: -0.30, py: 2.55, pz: 0,     sx: 0.12, sy: 0.45, sz: 0.12, mat: 'bone', rotY: 0.4 },  // horn L
      { shape: 'cube',   px:  0.30, py: 2.55, pz: 0,     sx: 0.12, sy: 0.45, sz: 0.12, mat: 'bone', rotY: -0.4 }, // horn R
      { shape: 'sphere', px: -0.13, py: 2.20, pz: 0.24,  sx: 0.09, sy: 0.09, sz: 0.09, mat: 'eye' },
      { shape: 'sphere', px:  0.13, py: 2.20, pz: 0.24,  sx: 0.09, sy: 0.09, sz: 0.09, mat: 'eye' },
      { shape: 'cube',   px: -0.28, py: 0.28, pz: 0,     sx: 0.24, sy: 0.56, sz: 0.24, mat: 'accent' }, // leg L
      { shape: 'cube',   px:  0.28, py: 0.28, pz: 0,     sx: 0.24, sy: 0.56, sz: 0.24, mat: 'accent' }, // leg R
      { shape: 'cube',   px: -0.72, py: 1.45, pz: 0.20,  sx: 0.20, sy: 0.20, sz: 0.80, mat: 'body' },   // arm L
      { shape: 'cube',   px: -0.74, py: 1.42, pz: 0.72,  sx: 0.26, sy: 0.10, sz: 0.30, mat: 'weapon' }, // claw L
      { shape: 'cube',   px:  0.72, py: 1.45, pz: 0.20,  sx: 0.20, sy: 0.20, sz: 0.80, mat: 'body' },   // arm R
      { shape: 'cube',   px:  0.74, py: 1.42, pz: 0.72,  sx: 0.26, sy: 0.10, sz: 0.30, mat: 'weapon' }, // claw R
      { shape: 'cube',   px: 0,     py: 1.95, pz: -0.36, sx: 0.14, sy: 0.55, sz: 0.14, mat: 'bone', rotY: 0.2 },  // back spike
      { shape: 'cube',   px: -0.30, py: 1.80, pz: -0.34, sx: 0.12, sy: 0.42, sz: 0.12, mat: 'bone', rotY: 0.5 },
      { shape: 'cube',   px:  0.30, py: 1.80, pz: -0.34, sx: 0.12, sy: 0.42, sz: 0.12, mat: 'bone', rotY: -0.5 },
      { shape: 'sphere', px: 0,     py: 1.45, pz: 0.32,  sx: 0.16, sy: 0.16, sz: 0.16, mat: 'glow' },   // chest core
    ],
  },
};

export interface Monster {
  /** Stable interaction id — never an ECS EntityHandle (handle reuse safe). */
  id: string;
  e: EntityHandle;
  kind: MonsterKind;
  hp: number;
  maxHp: number;
  x: number; z: number;
  yaw: number;
  attackCd: number;
  rangedCd: number;
  slowUntil: number;         // wall-clock s (performance.now()/1000 based)
  flashUntil: number;
  /** Scorch DoT — one stack; refresh replaces amount (Spec §7.2). */
  burnUntil: number;
  burnDps: number;
  enraged: boolean;
  bobPhase: number;
  matState: 'normal' | 'flash' | 'slow';
  /** Dungeon-area monsters count toward the Den quest. */
  zone: 'wild' | 'den';
  parts: Array<{ e: EntityHandle; matKey: PartMatKey }>;
  /** GLB visual (assets/monsters/*.glb) — null = lowpoly parts fallback. */
  skinEnt: EntityHandle | null;
  /** SceneInstance root hosting AnimationPlayer (null when parts fallback). */
  animPlayer: EntityHandle | null;
  /** Every entity the GLB instantiate produced (for despawn). */
  instEntities: EntityHandle[];
  clip: string;
  /** wall-clock ms when the current one-shot clip (attack/hit) ends. */
  clipUntil: number;
  /** Contact-frame strike scheduled by an attack swing (manager clock s; 0 = none). */
  strikeAt: number;
  strikeRanged: boolean;
  /**
   * True once the player has entered aggroRange (idle→aggro latch, with
   * hysteresis) — drives the one-shot onAggro event.
   */
  aggro: boolean;
  /**
   * Boss AoE slam in flight: telegraph decals + marked ground point, set at
   * melee wind-up and resolved (or cancelled) with the strike.
   */
  slam: { vfx: NovaTelegraphVfx; x: number; z: number; radius: number } | null;
  /** Knockback velocity (m/s, decays fast). */
  kbX: number; kbZ: number;
  /** Base playback speed of the current clip (before fps compensation). */
  animBase: number;
  /** Soft ground contact disc (skinned GLBs cannot cast CSM). */
  contactShadow: EntityHandle | null;
  /** Under-ring marker (G2-A) — null when rings are off (pool exhausted / Edit mode). */
  ring: EnemyRingHandle | null;
}

/** A flamecaller/boss fire bolt in flight (managed by MonsterManager). */
interface HostileBolt {
  x: number; y: number; z: number;
  dx: number; dz: number;
  speed: number;
  damage: number;
  age: number;
  /** Attribution for onPlayerHit (the fan volley is the boss's, not the shaman's). */
  source: MonsterKind;
  /** Flight presentation — sprite body + trail (0-handles in Edit mode). */
  style: FlightStyle;
  vfx: BodyVfx;
  trailT: number;
}

interface MatBank { byKey: Map<PartMatKey, { normal: MatHandle; flash: MatHandle; slow: MatHandle }> }

// ── GLB monster visuals (assets/monsters/*.glb, imported via cli-gltf) ────
// Every rig ships the same 5 clips; the meta.json sourceIndex order is the
// GLB's own animation order, which for this set is alphabetical:
//   [0]=attack [1]=death [2]=hit [3]=idle [4]=move
// Scene + clip GUIDs below mirror each *.glb.meta.json subAssets[].
interface GlbClipGuids { attack: string; death: string; hit: string; idle: string; move: string }
const GLB_VISUALS: Record<MonsterKind, { scene: string; clips: GlbClipGuids; animStride: number }> = {
  imp: {          // enemy_goblin_001.glb — 1.3 m goblin
    scene: '019f23d5-2dc8-7884-915f-af72d70bf346',
    clips: { attack: '019f23d5-2dc8-7884-915f-af770ada4df4', death: '019f23d5-2dc8-7884-915f-af781cd2b4fe', hit: '019f23d5-2dc8-7884-915f-af79a6454a16', idle: '019f23d5-2dc8-7884-915f-af7a1a85e5fa', move: '019f23d5-2dc8-7884-915f-af7bd5f4f2e4' },
    animStride: 1.6,
  },
  ashwalker: {    // enemy_zombie_001.glb — 1.75 m shambler
    scene: '019f23d5-2e17-71cc-ad91-7e0ee538db18',
    clips: { attack: '019f23d5-2e17-71cc-ad91-7e1261dbc77b', death: '019f23d5-2e17-71cc-ad91-7e1313599737', hit: '019f23d5-2e17-71cc-ad91-7e14a98b43f4', idle: '019f23d5-2e18-79b2-b06a-9a99ee43e9c1', move: '019f23d5-2e18-79b2-b06a-9a9a7159ec9f' },
    animStride: 0.9,
  },
  charred: {      // enemy_skeleton_001.glb — 1.8 m bone warrior
    scene: '019f23d5-2df0-7a46-bee0-512679f0b5d5',
    clips: { attack: '019f23d5-2df0-7a46-bee0-512b774f1af4', death: '019f23d5-2df0-7a46-bee0-512cdc628173', hit: '019f23d5-2df0-7a46-bee0-512de86b7782', idle: '019f23d5-2df0-7a46-bee0-512e96c663fc', move: '019f23d5-2df0-7a46-bee0-512fa2239ae4' },
    animStride: 1.3,
  },
  flamecaller: {  // enemy_boss_lich_001.glb — 2.0 m hooded caster with a fire staff
    // (wizard_001.glb renders lying flat on this engine version — its clips
    // sample wrong here even though the source renders fine; the lich rig
    // behaves, and the hooded-cultist look fits the flamecaller better.)
    scene: '019f23de-5d35-7098-aa80-3a5547e52c7b',
    clips: { attack: '019f23de-5d35-7098-aa80-3a5a6c9f5441', death: '019f23de-5d35-7098-aa80-3a5b18b27cf5', hit: '019f23de-5d35-7098-aa80-3a5c1c140e16', idle: '019f23de-5d35-7098-aa80-3a5d99262426', move: '019f23de-5d35-7098-aa80-3a5e73f0f527' },
    animStride: 1.3,
  },
  slaglord: {     // boss_lava_troll.glb — 3.5 m molten troll
    scene: '019f23d5-2da2-7b81-b122-d1e6d51f2e05',
    clips: { attack: '019f23d5-2da2-7b81-b122-d1eb55e4ebdb', death: '019f23d5-2da2-7b81-b122-d1ec17c72bc6', hit: '019f23d5-2da2-7b81-b122-d1ed9565ece0', idle: '019f23d5-2da2-7b81-b122-d1ee03e2493e', move: '019f23d5-2da2-7b81-b122-d1ef14f5fc3a' },
    animStride: 1.5,
  },
};

type ClipHandle = Handle<'AnimationClip', 'shared'>;
interface GlbBank {
  scene: Handle<'SceneAsset', 'shared'>;
  clips: Map<string, { h: ClipHandle; dur: number }>;
  /**
   * Clip payloads still awaiting `normalizeClipRoot`. Root joints are only
   * identifiable through an instantiated scene, so the first spawn of this kind
   * normalizes the bank in place and clears this.
   */
  rawClips: AnimationClip[];
}

/** Dead GLB monster playing its death clip; despawned when the clock runs out. */
interface Corpse {
  entities: EntityHandle[];
  until: number;             // wall-clock s
}

export interface MonsterEvents {
  /**
   * Monster melee/bolt landed on the player.
   * `damage` is raw (pre–damage-reduction). Callers must run
   * `resolveIncomingDamage(damage, combatStats)` before applying to HP.
   */
  onPlayerHit(damage: number, source: MonsterKind): void;
  /** Monster died (already despawned). */
  onDeath(m: Monster): void;
  /** Idle→aggro transition (one shot per aggro latch; hysteresis on exit). */
  onAggro?(m: Monster): void;
  /** A melee/ranged strike was INITIATED (wind-up start, not impact). */
  onAttack?(m: Monster): void;
}

// ── Boss (Slaglord) attack tuning ──────────────────────────────────────────
/** AoE slam: ground-mark radius the player must escape during the wind-up. */
const BOSS_SLAM_RADIUS = 2.5;
/** AoE slam: seconds from telegraph mark to contact frame (readable dodge). */
const BOSS_SLAM_WINDUP = 1.1;
/** Ranged volley: 3 bolts fanned ±15° around the player-bearing. */
const BOSS_FAN_ANGLE = Math.PI / 12;

export class MonsterManager {
  monsters: Monster[] = [];
  private banks = new Map<MonsterKind, MatBank>();
  private bolts: HostileBolt[] = [];
  private now = 0;
  private nextStableId = 1;
  /**
   * fps compensation hook (main.ts sets when c0 fixed-1/60 anim step is on).
   * Default 1 = mainline Time.delta path; do not wire default-on compensation
   * into games main commits.
   */
  animRate = 1;
  /** Loaded GLB visuals by kind — empty until loadVisuals() runs. */
  private glb = new Map<MonsterKind, GlbBank>();
  /**
   * Kinds whose visual load was REQUESTED (settled or not) — PR11 T5. spawn()
   * uses this to tell "bank failed → genuine parts fallback" apart from
   * "spawned before its load was even requested → sequencing bug" (loud).
   */
  private visualsAttempted = new Set<MonsterKind>();
  private corpses: Corpse[] = [];
  /** AssetRegistry surface kept from loadVisuals (instantiate per spawn). */
  private assets: {
    instantiate<T>(h: Handle<'SceneAsset', 'shared'>, w: World, parent?: EntityHandle):
      { ok: boolean; value?: unknown; error?: { code?: string } };
  } | null = null;
  /** Soft contact shadows for skinned (and fallback) monsters. */
  private contact: ContactShadowKit | null = null;
  /** Enemy under-ring pool (G2-A) — null when the fx surface is unavailable. */
  private rings: EnemyRings | null = null;

  /** Wire after installContactShadows — call before first spawn. */
  setContactShadows(kit: ContactShadowKit): void {
    this.contact = kit;
  }

  constructor(private world: World, private fx: FxSystem, private events: MonsterEvents) {
    for (const def of Object.values(MONSTERS)) {
      const bank: MatBank = { byKey: new Map() };
      for (const [key, p] of Object.entries(def.palette)) {
        if (!p) continue;
        const normal = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [p.color[0], p.color[1], p.color[2], 1],
          metallic: p.metallic ?? 0.05,
          roughness: p.roughness ?? 0.7,
          emissive: p.emissive,
          emissiveIntensity: p.emissiveIntensity ?? (p.emissive ? 2 : 0),
        }));
        const flash = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [1, 0.55, 0.35, 1], roughness: 0.4, metallic: 0,
          emissive: [1, 0.45, 0.2], emissiveIntensity: 1.4,
        }));
        const slow = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [p.color[0] * 0.4 + 0.4, p.color[1] * 0.4 + 0.55, p.color[2] * 0.4 + 0.85, 1],
          metallic: 0.2, roughness: 0.35,
          emissive: [0.3, 0.6, 1.0], emissiveIntensity: 1.4,
        }));
        bank.byKey.set(key as PartMatKey, { normal, flash, slow });
      }
      this.banks.set(def.kind, bank);
    }
    // G2-A under-rings: built from the FX persistent-decal surface. Unit-test
    // fx stubs / Edit-mode shims lack it → rings degrade to off (same
    // degradation class as contact shadows before the kit is wired).
    this.rings = typeof fx.persistentDecalSurface === 'function'
      ? createEnemyRings(fx.persistentDecalSurface())
      : null;
  }

  /**
   * Load the skinned GLB visuals (scene + 5 clips per kind) for the given
   * kinds — kinds race each other and each kind's clips race each other
   * (PR11 T3). Kinds that fail quietly fall back to the lowpoly PartSpec
   * assemblies; a missing idle clip still fails the whole kind (unchanged).
   *
   * `onItem` (PR11 T2) fires once per settled scene/clip load (success OR
   * failure) so a LoadTracker can advance — 6 items per kind (1 scene + 5
   * clips), matching the caller's registered count.
   */
  async loadVisualsFor(
    kinds: readonly MonsterKind[],
    assets: {
      loadByGuid<T>(guid: unknown): Promise<{ ok: boolean; value?: T; error?: { code?: string } }>;
      instantiate<T>(h: Handle<'SceneAsset', 'shared'>, w: World, parent?: EntityHandle):
        { ok: boolean; value?: unknown; error?: { code?: string } };
    },
    onItem?: () => void,
  ): Promise<readonly MonsterKind[]> {
    this.assets = assets;
    const results = await Promise.all(kinds.map((kind) => this.loadKindVisual(kind, assets, onItem)));
    const loaded = results.filter((k): k is MonsterKind => k !== null);
    console.log(`[hellforge] monster GLB visuals loaded: ${loaded.join(', ') || '(none)'}`);
    return loaded;
  }

  /**
   * Load one kind's scene + 5 clips in parallel. Returns the kind on success,
   * null on failure (→ parts fallback). Strip-root-motion stays per-clip.
   */
  private async loadKindVisual(
    kind: MonsterKind,
    assets: {
      loadByGuid<T>(guid: unknown): Promise<{ ok: boolean; value?: T; error?: { code?: string } }>;
    },
    onItem?: () => void,
  ): Promise<MonsterKind | null> {
    this.visualsAttempted.add(kind);
    const def = GLB_VISUALS[kind];
    const note = (): void => { onItem?.(); };
    try {
      const sceneGuid = AssetGuid.parse(def.scene);
      if (!sceneGuid.ok) {
        // Settle this kind's scene + clip items so a bad constant can't stall
        // the bar below 100% — the load is done (failed), not pending.
        for (let i = 0; i <= Object.keys(def.clips).length; i++) note();
        throw new Error('scene guid parse');
      }
      // Kick the scene + every clip load off together. A bad clip only warns
      // (unchanged); a missing scene or idle clip still fails the kind.
      const sceneP = assets.loadByGuid<SceneAsset>(sceneGuid.value).then((r) => { note(); return r; });
      const clipPs = (Object.entries(def.clips) as Array<[string, string]>).map(([name, guid]) => {
        const g = AssetGuid.parse(guid);
        if (!g.ok) { note(); return Promise.resolve<[string, AnimationClip | null]>([name, null]); }
        return assets.loadByGuid<AnimationClip>(g.value)
          .then((r): [string, AnimationClip | null] => { note(); return [name, r.ok && r.value ? r.value : null]; });
      });
      // Await scene + all clips together (no floating promise on scene failure).
      const [sceneRes, clipResults] = await Promise.all([sceneP, Promise.all(clipPs)]);
      if (!sceneRes.ok || !sceneRes.value) throw new Error('scene load: ' + (sceneRes.error?.code ?? '?'));
      const bank: GlbBank = {
        scene: this.world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value),
        clips: new Map(),
        rawClips: [],
      };
      for (const [name, payload] of clipResults) {
        if (payload === null) { console.warn(`[hellforge] monster clip load failed: ${kind}.${name}`); continue; }
        bank.rawClips.push(payload);
        bank.clips.set(name, {
          h: this.world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', payload),
          dur: (payload as unknown as { duration: number }).duration,
        });
      }
      if (!bank.clips.has('idle')) throw new Error('idle clip missing');
      this.glb.set(kind, bank);
      return kind;
    } catch (err) {
      console.warn(`[hellforge] GLB visual unavailable for ${kind} — parts fallback:`, (err as Error).message);
      return null;
    }
  }

  /** Swap a GLB monster's AnimationPlayer clip (looping locomotion). */
  private setClip(m: Monster, name: string, loop: boolean, speed = 1): void {
    if (m.animPlayer === null) return;
    const bank = this.glb.get(m.kind);
    const clip = bank?.clips.get(name);
    if (!clip) return;
    m.clip = name;
    m.animBase = speed;
    if (!loop) m.clipUntil = performance.now() + (clip.dur / speed) * 1000;
    this.world.set(m.animPlayer, AnimationPlayer, {
      clips: [clip.h], times: new Float32Array([0]), weights: new Float32Array([1]),
      speeds: new Float32Array([speed * this.animRate]), looping: loop, paused: false,
    });
  }

  /** One-shot (attack/hit) unless one is already playing. */
  private playOnce(m: Monster, name: string, speed = 1): void {
    if (m.animPlayer === null) return;
    if (performance.now() < m.clipUntil) return;
    this.setClip(m, name, false, speed);
  }

  spawn(kind: MonsterKind, x: number, z: number, zone: 'wild' | 'den'): Monster | null {
    const def = MONSTERS[kind];
    const rootRes = this.world.spawn(
      { component: Transform, data: { pos: [x, 0, z], scale: [1, 1, 1] } },
    );
    if (!rootRes.ok) return null;
    const root = rootRes.value as EntityHandle;
    const parts: Monster['parts'] = [];
    let skinEnt: EntityHandle | null = null;
    let animPlayer: EntityHandle | null = null;
    const instEntities: EntityHandle[] = [];

    // ── preferred: skinned GLB visual (assets/monsters/*.glb) ──
    // PR11 T5 invariant: spawn() must never consult a bank whose load was never
    // requested. Wild kinds load before the boot spawn block; den kinds load
    // inside ensureDenLoaded() before the den pre-spawn — so reaching here with
    // an un-attempted kind is a sequencing BUG (loud), distinct from a genuine
    // load failure (attempted, bank absent → silent-by-design parts fallback).
    if (!this.visualsAttempted.has(kind)) {
      console.error(
        `[hellforge] spawn('${kind}', ${zone}) before its GLB visual load was requested — ` +
        'sequencing bug (PR11 T5 intends this unreachable); falling back to parts.',
      );
    }
    const glbBank = this.glb.get(kind);
    if (glbBank && this.assets) {
      const instRes = this.assets.instantiate(glbBank.scene, this.world, root);
      if (instRes.ok) {
        const instRoot = instRes.value as EntityHandle;
        instEntities.push(instRoot);
        // Some rigs (zombie: 1.67 m of hips +Z in `move`) translate the root
        // across the clip, and since WE drive world position from the AI, the
        // animated offset makes monsters glide forward and SNAP BACK at every
        // loop. Un-bake it now that the scene can name the root joint; the
        // payloads are shared, so one pass per kind covers every spawn.
        if (glbBank.rawClips.length > 0) {
          const rootTargetIds = collectRootJointTargetIds(this.world, instRoot);
          for (const payload of glbBank.rawClips) normalizeClipRoot(payload, rootTargetIds);
          glbBank.rawClips.length = 0;
        }
        const sceneInst = this.world.get(instRoot, SceneInstance);
        if (sceneInst.ok) {
          for (let i = 0; i < sceneInst.value.mapping.length; i++) {
            const ent = sceneInst.value.mapping[i];
            if (ent === undefined || ent === ENTITY_NULL_RAW) continue;
            instEntities.push(ent as EntityHandle);
          }
        }
        const idle = glbBank.clips.get('idle');
        const armed = idle
          ? armSkinnedAnimationPlayer(this.world, instRoot, { clips: [idle.h] })
          : null;
        if (armed !== null) {
          skinEnt = armed.skin;
          animPlayer = armed.player;
        } else {
          console.warn(`[hellforge] ${kind} GLB instantiated but skinned anim arm failed`);
        }
      }
    }

    // ── fallback: lowpoly PartSpec assembly ──
    if (skinEnt === null && instEntities.length === 0) {
      const bank = this.banks.get(kind)!;
      for (const ps of def.parts) {
        const slot = bank.byKey.get(ps.mat);
        if (!slot) continue;
        const tform: { pos: number[]; scale: number[]; quat?: number[] } = {
          pos: [ps.px, ps.py, ps.pz],
          scale: [ps.sx, ps.sy, ps.sz],
        };
        if (ps.rotY !== undefined) {
          const q = quat.eulerY(ps.rotY);
          tform.quat = [q[0]!, q[1]!, q[2]!, q[3]!];
        }
        const partRes = this.world.spawn(
          { component: Transform, data: tform },
          { component: MeshFilter, data: { assetHandle: ps.shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE } },
          { component: MeshRenderer, data: { materials: [slot.normal] } },
          { component: ChildOf, data: { parent: root } },
        );
        if (partRes.ok) parts.push({ e: partRes.value as EntityHandle, matKey: ps.mat });
      }
    }

    const contactR = Math.max(0.35, Math.min(1.2, def.radius * 1.15));
    const contactShadow = this.contact?.spawn(x, z, contactR) ?? null;
    // G2-A under-ring — common exit for both the GLB and parts-fallback
    // paths; null when the pool is exhausted (silent skip, no crash).
    const ring = this.rings?.acquire(kind, x, z) ?? null;
    const m: Monster = {
      id: `m-${this.nextStableId++}`,
      e: root, kind, hp: def.hp, maxHp: def.hp, x, z,
      yaw: Math.random() * Math.PI * 2,
      attackCd: 0.5 + Math.random() * 0.5,
      rangedCd: 1 + Math.random(),
      slowUntil: 0, flashUntil: 0, burnUntil: 0, burnDps: 0, enraged: false,
      bobPhase: Math.random() * Math.PI * 2,
      matState: 'normal',
      zone, parts,
      skinEnt, animPlayer, instEntities,
      clip: 'idle', clipUntil: 0,
      strikeAt: 0, strikeRanged: false,
      aggro: false, slam: null,
      kbX: 0, kbZ: 0,
      animBase: 1,
      contactShadow,
      ring,
    };
    this.monsters.push(m);
    return m;
  }

  /**
   * Damage a monster (from a skill hit). Returns true if it died.
   * (kdx, kdz, kbForce) is the knockback impulse direction + strength —
   * bosses take 25% knockback so they keep their menace.
   */
  /** True while a slow is active (Winter's Grasp checks this before damage). */
  isSlowed(m: Monster): boolean {
    return m.slowUntil > this.now;
  }

  /** True while a Scorch burn is active (Searing / Furnace Heart). */
  isBurning(m: Monster): boolean {
    return m.burnUntil > this.now && m.burnDps > 0;
  }

  /** Deep Freeze: extend remaining slow by `extraSec` (no-op if not slowed). */
  refreshSlow(m: Monster, extraSec: number): void {
    if (extraSec <= 0 || m.slowUntil <= this.now) return;
    m.slowUntil += extraSec;
  }

  /**
   * Apply/replace Scorch burn. One stack per target: refresh duration and
   * replace stored DPS; does not stack (Spec §7.2).
   */
  applyBurn(m: Monster, totalDamage: number, durationSec: number): void {
    if (totalDamage <= 0 || durationSec <= 0) return;
    m.burnUntil = this.now + durationSec;
    m.burnDps = totalDamage / durationSec;
  }

  damage(m: Monster, dmg: number, slowSec = 0, kdx = 0, kdz = 0, kbForce = 0): boolean {
    m.hp -= dmg;
    m.flashUntil = this.now + 0.12;
    if (slowSec > 0) m.slowUntil = Math.max(m.slowUntil, this.now + slowSec);
    const def = MONSTERS[m.kind];
    if (kbForce > 0) {
      const resist = def.isBoss ? 0.25 : 1;
      m.kbX += kdx * kbForce * resist;
      m.kbZ += kdz * kbForce * resist;
    }
    if (!m.enraged && def.enrageBelow && m.hp / m.maxHp < def.enrageBelow) m.enraged = true;
    if (m.hp <= 0) {
      this.kill(m);
      return true;
    }
    // Flinch — bosses don't stagger. Two cases:
    //  • hit during a wind-up: INTERRUPT it (cancel the scheduled strike) —
    //    fast casts can stun swings out, which is the fun part
    //  • otherwise: flinch only if no one-shot is already playing, so chain
    //    hits don't re-trigger into a permanent stagger-lock
    if (!def.isBoss) {
      if (m.strikeAt > 0) {
        m.strikeAt = 0;
        m.clipUntil = 0;
        this.playOnce(m, 'hit', 1.6);
      } else if (performance.now() >= m.clipUntil) {
        this.playOnce(m, 'hit', 1.6);
      }
    }
    return false;
  }

  /** Release a pending boss slam telegraph (death / despawn mid wind-up). */
  private releaseSlam(m: Monster): void {
    if (m.slam === null) return;
    this.fx.releaseNovaTelegraph(m.slam.vfx);
    m.slam = null;
  }

  /** Exactly-once under-ring cleanup (death / despawn; idempotent). */
  private releaseRing(m: Monster): void {
    if (m.ring === null) return;
    this.rings?.release(m.ring);
    m.ring = null;
  }

  private kill(m: Monster): void {
    this.releaseSlam(m);
    this.releaseRing(m);
    this.fx.gibs(m.x, 0.6, m.z, 'blood', m.kind === 'slaglord' ? 22 : 9);
    // Dissolve envelope layers on top of the gibs (PR8 T7): flipbook pop +
    // smoke wisps + embers read as the body disintegrating during the death
    // clip. Skinned GLB materials can't be eroded per-entity, so it's a
    // particle envelope, not a shader dissolve.
    this.fx.playEffect(
      combatBeat(
        m.kind === 'slaglord' ? 'death-dissolve-boss' : 'death-dissolve',
        ['dissolve-flash', 'dissolve-wisps', 'dissolve-embers'],
      ),
      m.x, 0.7, m.z,
    );
    // Status VFX ends with death even when the corpse clip still plays.
    this.fx.endSlowStatus(m.id);
    if (m.contactShadow !== null) {
      this.contact?.disposeEntity(m.contactShadow);
      m.contactShadow = null;
    }
    const bank = this.glb.get(m.kind);
    const death = m.skinEnt !== null ? bank?.clips.get('death') : undefined;
    if (death) {
      // Play the death clip in place, then reap the corpse. The monster
      // leaves `monsters` NOW (quest/aggro/hit-tests all see it dead).
      m.clipUntil = 0;                       // death overrides any one-shot
      this.setClip(m, 'death', false, 1);
      this.corpses.push({
        entities: [m.e, ...m.instEntities],
        until: this.now + death.dur + 0.5,   // brief hold on the last frame
      });
      const i = this.monsters.indexOf(m);
      if (i >= 0) this.monsters.splice(i, 1);
    } else {
      this.despawn(m);
    }
    this.events.onDeath(m);
  }

  private despawn(m: Monster): void {
    this.releaseSlam(m);
    this.releaseRing(m);
    if (m.contactShadow !== null) {
      this.contact?.disposeEntity(m.contactShadow);
      m.contactShadow = null;
    }
    // Slow VFX lifetime matches gameplay status — drop on death/despawn.
    this.fx.endSlowStatus(m.id);
    this.world.despawn(m.e);
    for (const p of m.parts) this.world.despawn(p.e);
    for (const e of m.instEntities) this.world.despawn(e);
    m.parts.length = 0;
    m.instEntities.length = 0;
    const i = this.monsters.indexOf(m);
    if (i >= 0) this.monsters.splice(i, 1);
  }

  /** Nearest living monster within r of (x, z) — used by skill hit-tests. */
  nearest(x: number, z: number, r: number): Monster | null {
    let best: Monster | null = null;
    let bestD2 = r * r;
    for (const m of this.monsters) {
      const dx = m.x - x, dz = m.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = m; }
    }
    return best;
  }

  /** Lookup by stable InteractionRef id (not ECS handle). */
  byId(id: string): Monster | null {
    for (const m of this.monsters) if (m.id === id) return m;
    return null;
  }

  denAliveCount(): number {
    let n = 0;
    for (const m of this.monsters) if (m.zone === 'den') n++;
    return n;
  }

  boss(): Monster | null {
    for (const m of this.monsters) if (MONSTERS[m.kind].isBoss) return m;
    return null;
  }

  /**
   * Per-frame AI + movement + hostile bolts.
   * @param playerSafe true while the player stands in the camp safe zone —
   *        monsters break aggro and never deal damage there.
   */
  tick(
    dt: number, playerX: number, playerZ: number, playerSafe: boolean,
    walkable: (x: number, z: number) => boolean,
  ): void {
    this.now += dt;

    // ── separation: monsters must not stack on each other or the player ──
    // Soft pairwise push-apart (40% of the overlap per frame — settles in a
    // few frames without jitter). Brute force is fine at ≤ ~40 alive.
    const sep = 0.4;
    for (let i = 0; i < this.monsters.length; i++) {
      const a = this.monsters[i]!;
      const ra = MONSTERS[a.kind].radius;
      for (let j = i + 1; j < this.monsters.length; j++) {
        const b = this.monsters[j]!;
        const dx = b.x - a.x, dz = b.z - a.z;
        const minD = ra + MONSTERS[b.kind].radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) continue;
        // Exact overlap (pack spawns can share a cell): pick a random axis.
        let d = Math.sqrt(d2), nx: number, nz: number;
        if (d < 1e-3) {
          const ang = Math.random() * Math.PI * 2;
          nx = Math.cos(ang); nz = Math.sin(ang); d = 1e-3;
        } else {
          nx = dx / d; nz = dz / d;
        }
        const push = (minD - d) * sep;
        const ax = a.x - nx * push, az = a.z - nz * push;
        if (walkable(ax, a.z)) a.x = ax;
        if (walkable(a.x, az)) a.z = az;
        const bx = b.x + nx * push, bz = b.z + nz * push;
        if (walkable(bx, b.z)) b.x = bx;
        if (walkable(b.x, bz)) b.z = bz;
      }
      // Push out of the player's personal space (the monster yields, never
      // the player — being walked inside of reads as a collision bug).
      const pdx = a.x - playerX, pdz = a.z - playerZ;
      const pMin = ra + 0.45;
      const pd2 = pdx * pdx + pdz * pdz;
      if (pd2 < pMin * pMin && pd2 > 1e-6) {
        const pd = Math.sqrt(pd2);
        const push = (pMin - pd) * sep;
        const ax = a.x + (pdx / pd) * push, az = a.z + (pdz / pd) * push;
        if (walkable(ax, a.z)) a.x = ax;
        if (walkable(a.x, az)) a.z = az;
      }
    }

    for (let mi = this.monsters.length - 1; mi >= 0; mi--) {
      const m = this.monsters[mi]!;
      // Scorch DoT tick (one stack; expires cleanly).
      if (m.burnUntil > this.now && m.burnDps > 0) {
        m.hp -= m.burnDps * dt;
        if (m.hp <= 0) {
          this.kill(m);
          continue;
        }
      } else if (m.burnUntil <= this.now) {
        m.burnDps = 0;
      }

      const def = MONSTERS[m.kind];
      const dx = playerX - m.x, dz = playerZ - m.z;
      const dist = Math.hypot(dx, dz);

      // Idle→aggro latch (one-shot growl hook). Hysteresis on exit so a
      // player hovering at the rim doesn't re-trigger the roar every frame.
      const inAggro = !playerSafe && dist < def.aggroRange;
      if (inAggro && !m.aggro) {
        m.aggro = true;
        this.events.onAggro?.(m);
      } else if (m.aggro && (playerSafe || dist > def.aggroRange * 1.2)) {
        m.aggro = false;
      }

      const slowed = m.slowUntil > this.now;
      // Slow marker begins/ends with the same gameplay status clock.
      this.fx.syncSlowStatus(m.id, slowed, m.x, m.z, m.slowUntil);
      let speed = def.speed * (slowed ? 0.45 : 1) * (m.enraged ? 1.5 : 1);
      // Frost also drags the attack cadence, not just the feet.
      const cdRate = slowed ? 0.55 : 1;
      m.attackCd -= dt * cdRate;
      m.rangedCd -= dt * cdRate;

      // A one-shot clip (attack wind-up / hit flinch) ROOTS the monster:
      // no stepping, no turning. This is what makes swings dodgeable — step
      // out of reach during the wind-up and the strike whiffs.
      // Boss exception: the Slaglord keeps stalking through his RANGED
      // wind-up (rooted only for a beat at the loose, below) so the fight
      // doesn't degenerate into a stationary bolt turret.
      const busy = performance.now() < m.clipUntil
        && !(def.isBoss && m.strikeAt > 0 && m.strikeRanged);

      // ── contact-frame strike resolution ──
      if (m.strikeAt > 0 && this.now >= m.strikeAt) {
        m.strikeAt = 0;
        if (m.slam !== null) {
          // Boss AoE slam: drop the telegraph and test the player against the
          // MARKED ground (not the boss's reach) — sidestep the ring, no hit.
          const slam = m.slam;
          m.slam = null;
          this.fx.releaseNovaTelegraph(slam.vfx);
          const sdx = playerX - slam.x, sdz = playerZ - slam.z;
          if (!playerSafe && sdx * sdx + sdz * sdz <= slam.radius * slam.radius) {
            this.events.onPlayerHit(def.damage, m.kind);
            this.fx.burst(playerX, 0.9, playerZ, 'blood', 4, 2.2);
          }
          this.fx.novaShockRing(slam.x, slam.z, slam.radius);
          this.fx.novaScorch(slam.x, slam.z, slam.radius);
          this.fx.burst(slam.x, 0.6, slam.z, 'fire', 10, 3.2);
        } else if (m.strikeRanged && def.ranged) {
          // Loose at the player's CURRENT position — bosses fire a 3-bolt fan.
          const base = Math.atan2(dz, dx);
          const offs = def.isBoss ? [-BOSS_FAN_ANGLE, 0, BOSS_FAN_ANGLE] : [0];
          for (const off of offs) {
            this.spawnBolt(m, def, Math.cos(base + off), Math.sin(base + off));
          }
          if (def.isBoss) {
            // Brief root at the loose only (300 ms) — the wind-up itself
            // left him mobile (see `busy` above).
            m.clipUntil = Math.min(m.clipUntil, performance.now() + 300);
          }
        } else if (!playerSafe && dist <= def.attackRange + 0.55) {
          // Melee connects only if the player is STILL in reach — dodged
          // swings whiff (no damage, no blood).
          this.events.onPlayerHit(def.damage, m.kind);
          this.fx.burst(playerX, 0.9, playerZ, 'blood', 4, 2.2);
        }
      }

      // ── knockback (skill impacts) — overrides the root even mid-swing ──
      if (m.kbX !== 0 || m.kbZ !== 0) {
        const nxp = m.x + m.kbX * dt;
        const nzp = m.z + m.kbZ * dt;
        if (walkable(nxp, m.z)) m.x = nxp;
        if (walkable(m.x, nzp)) m.z = nzp;
        const k = Math.exp(-9 * dt);
        m.kbX *= k; m.kbZ *= k;
        if (Math.abs(m.kbX) + Math.abs(m.kbZ) < 0.05) { m.kbX = 0; m.kbZ = 0; }
      }

      let moving = false;
      if (!playerSafe && !busy && dist < def.aggroRange && dist > 0.01) {
        const nx = dx / dist, nz = dz / dist;
        m.yaw = Math.atan2(nx, nz);
        const wantRanged = def.ranged && dist < def.ranged.range && dist > def.attackRange;
        // The flamecaller keeps its distance; others close in.
        const advance = def.ranged && def.ranged.keepDistance > 0
          ? (dist > def.ranged.keepDistance ? 1 : (dist < def.ranged.keepDistance - 2 ? -0.7 : 0))
          : (dist > def.attackRange * 0.85 ? 1 : 0);
        if (advance !== 0) {
          const nxp = m.x + nx * speed * advance * dt;
          const nzp = m.z + nz * speed * advance * dt;
          if (walkable(nxp, m.z)) { m.x = nxp; moving = true; }
          if (walkable(m.x, nzp)) { m.z = nzp; moving = true; }
        }
        // Melee swing: start the wind-up NOW, land the hit at the clip's
        // contact frame (~45% in) — resolved above on a later tick.
        // A pending strike (boss mid-volley-wind-up) is never overwritten.
        if (dist <= def.attackRange && m.attackCd <= 0 && m.strikeAt <= 0) {
          m.attackCd = def.attackCooldown;
          const clip = this.glb.get(m.kind)?.clips.get('attack');
          if (def.isBoss) {
            // Boss AoE slam: mark the player's CURRENT ground, then a slow,
            // readable wind-up (~1.1 s to contact) — sidestep the ring.
            const speed = clip ? Math.max(0.4, (clip.dur * 0.45) / BOSS_SLAM_WINDUP) : 0.7;
            this.playOnce(m, 'attack', speed);
            m.strikeAt = this.now + BOSS_SLAM_WINDUP;
            m.strikeRanged = false;
            m.slam = {
              vfx: this.fx.novaTelegraph(playerX, playerZ, BOSS_SLAM_RADIUS),
              x: playerX, z: playerZ, radius: BOSS_SLAM_RADIUS,
            };
          } else {
            const windup = clip ? (clip.dur / 1.4) * 0.45 : 0.18;
            this.playOnce(m, 'attack', 1.4);
            m.strikeAt = this.now + windup;
            m.strikeRanged = false;
          }
          this.events.onAttack?.(m);
        }
        // Ranged: same wind-up treatment (bolt looses at ~40% of the cast).
        if (wantRanged && m.rangedCd <= 0 && m.strikeAt <= 0 && def.ranged) {
          m.rangedCd = def.ranged.cooldown;
          const clip = this.glb.get(m.kind)?.clips.get('attack');
          const windup = clip ? (clip.dur / 1.2) * 0.4 : 0.2;
          this.playOnce(m, 'attack', 1.2);
          m.strikeAt = this.now + windup;
          m.strikeRanged = true;
          this.events.onAttack?.(m);
        }
      } else if (!busy && dist > def.aggroRange * 2.5 && m.zone === 'wild') {
        // Far-away wilderness monsters idle-wander a little.
        m.bobPhase += dt;
        if (Math.random() < dt * 0.3) m.yaw = Math.random() * Math.PI * 2;
      }

      // Write the root transform. GLB rigs animate their own gait, so only
      // the parts-fallback gets the fake shamble bob.
      const isGlb = m.skinEnt !== null;
      if (moving) m.bobPhase += dt * (def.speed * 3.2);
      const bob = moving && !isGlb ? Math.abs(Math.sin(m.bobPhase)) * 0.09 : 0;
      const q = quat.eulerY(m.yaw);
      this.world.set(m.e, Transform, {
        pos: [m.x, bob, m.z],
        quat: [q[0]!, q[1]!, q[2]!, q[3]!],
        scale: [1, 1, 1],
      });
      if (m.contactShadow !== null) {
        const r = Math.max(0.35, Math.min(1.2, def.radius * 1.15));
        this.contact?.move(m.contactShadow, m.x, m.z, r);
      }

      // G2-A under-ring rides the final position — knockback and chase both
      // land before this point.
      if (m.ring !== null) this.rings?.follow(m.ring, m.x, m.z);

      if (isGlb) {
        // Locomotion state machine: one-shots (attack/hit) own the rig until
        // they end, then move/idle resumes. Move clip speed tracks ground
        // speed so feet keep pace (per-kind stride from GLB_VISUALS).
        if (performance.now() >= m.clipUntil) {
          const want = moving ? 'move' : 'idle';
          if (m.clip !== want) this.setClip(m, want, true, 1);
          if (moving && m.clip === 'move') {
            const stride = GLB_VISUALS[m.kind].animStride;
            m.animBase = Math.min(3.2, Math.max(0.5, speed / stride));
          } else if (m.clip === 'idle') {
            m.animBase = 1;
          }
        }
        // Re-write speeds every frame so animBase / animRate changes take
        // effect on the already-playing clip.
        if (m.animPlayer !== null) {
          this.world.set(m.animPlayer, AnimationPlayer, {
            speeds: new Float32Array([m.animBase * this.animRate]),
          });
        }
      } else {
        // Hit-flash / slow-tint material swaps (parts fallback only).
        const bank = this.banks.get(m.kind)!;
        const state: 'normal' | 'flash' | 'slow' =
          m.flashUntil > this.now ? 'flash' : (slowed ? 'slow' : 'normal');
        if (m.matState !== state) {
          m.matState = state;
          for (const p of m.parts) {
            const slot = bank.byKey.get(p.matKey);
            if (slot) this.world.set(p.e, MeshRenderer, { materials: [slot[state]] });
          }
        }
      }
    }

    // ── corpses: reap once the death clip has played out ──
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]!;
      if (this.now < c.until) continue;
      for (const e of c.entities) this.world.despawn(e);
      this.corpses.splice(i, 1);
    }

    // ── hostile bolts ──
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.age += dt;
      b.x += b.dx * b.speed * dt;
      b.z += b.dz * b.speed * dt;
      const dx = playerX - b.x, dz = playerZ - b.z;
      const hit = dx * dx + dz * dz < 0.55 * 0.55;
      if (hit && !playerSafe) {
        this.events.onPlayerHit(b.damage, b.source);
        this.fx.burst(b.x, 1.0, b.z, 'fire', 6, 2.6);
        this.fx.playEffect(combatBeat('hit-fire', ['sparks']), b.x, 1.0, b.z);
      }
      if (hit || b.age > 2.5) {
        this.fx.releaseFlightBody(b.vfx);
        this.bolts.splice(i, 1);
        continue;
      }
      // PR8 body follows the bolt; trail drips at ~33 Hz (same caller-side
      // rate-limit pattern as the player projectiles in skills.ts).
      this.fx.moveFlightBody(b.vfx, b.x, b.y, b.z);
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.03;
        this.fx.flightTrailPuff(b.style, b.x, b.y, b.z);
      }
    }
  }

  /** Loose one hostile bolt — sprite flight body (0-handles in Edit mode). */
  private spawnBolt(m: Monster, def: MonsterDef, dx: number, dz: number): void {
    const style: FlightStyle = def.isBoss ? 'slag' : 'magma';
    this.bolts.push({
      x: m.x, y: 1.1, z: m.z, dx, dz,
      speed: def.ranged!.speed, damage: def.damage, age: 0,
      source: m.kind, style,
      vfx: this.fx.flightBody(style, m.x, 1.1, m.z),
      trailT: 0,
    });
  }

  /** Wall-clock the manager runs on (skills use it for slow timing). */
  clock(): number { return this.now; }

  /** Despawn every living monster (combat-run reset). */
  clearAll(): void {
    while (this.monsters.length > 0) {
      this.despawn(this.monsters[this.monsters.length - 1]!);
    }
    for (const c of this.corpses) {
      for (const e of c.entities) this.world.despawn(e);
    }
    this.corpses.length = 0;
    this.clearEnemyAttacks();
  }

  /** Clear hostile bolts / pending attacks without touching living monsters. */
  clearEnemyAttacks(): void {
    for (const b of this.bolts) this.fx.releaseFlightBody(b.vfx);
    this.bolts.length = 0;
  }
}
