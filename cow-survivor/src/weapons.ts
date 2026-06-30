// Weapons + bullets for the Cow-Level Survivor.
//
// VISUAL ARCHITECTURE
// ───────────────────
// Each bullet is a ROOT entity holding only the rigid body + collider
// (no mesh — the root is invisible). Visible "parts" are ChildOf the
// root: per-weapon lowpoly assemblies built from cube/sphere primitives.
// We write the ROOT's Transform every frame (position + facing yaw +
// per-bullet spin) → ChildOf carries every part with it so the shape
// flies as a unit.
//
// This lets each weapon have a distinctive silhouette that a single
// HANDLE_SPHERE could never give:
//   pistol     → a long bullet (cube spindle)
//   fire       → an orange sphere with 4 radiating spikes
//   ice        → a real elongated ice shard (cube, pointed)
//   chain      → a glowing Z-shaped 3-segment lightning bolt (visible!)
//   shotgun    → small forward bullet pellets
//   boomerang  → a 90° cross of two flat cubes that VISIBLY SPINS
//   grenade    → grey ball + black short fuse cube + tiny red ember
//
// PHYSICS
// ───────
// Same kinematic-ball collider trick as before: collider radius is
// inflated (≥0.5) for reliable enemy contacts during a discrete step
// (engine bug: kinematic CCD is a no-op; comment is preserved below).
// Visual scale is independent of collider radius.

import {
  Transform, MeshFilter, MeshRenderer, ChildOf,
  HANDLE_CUBE, HANDLE_SPHERE, Materials, quat,
  type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type Ctx = Parameters<GameEntry>[0];

export type WeaponKind = 'pistol' | 'fire' | 'ice' | 'chain' | 'shotgun' | 'boomerang' | 'grenade';

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  desc: string;
  icon: string;
  // base stats — multiplied by level
  baseDamage: number;
  baseCooldown: number;
  baseBullets: number;
  baseSpread: number;       // total angular spread (radians)
  baseSpeed: number;
  baseLife: number;
  baseRadius: number;       // collider radius hint (visual built independently)
  // visual
  color: [number, number, number, number];
  emissive: [number, number, number];
  emissiveIntensity: number;
  // optional secondary material color (accents, fuse, tips). Defaults to emissive black.
  accent?: [number, number, number, number];
  accentEmissive?: [number, number, number];
  accentEmissiveIntensity?: number;
  // behavior flags
  onHit?: 'aoe' | 'slow' | 'chain' | null;
  aoeRadius?: number;
  slowSec?: number;
  chainTargets?: number;
  chainRange?: number;
  isBoomerang?: boolean;
  isGrenade?: boolean;
  pierce?: boolean;
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  pistol: {
    kind: 'pistol', name: '手枪', desc: '基础单发，可靠的老朋友~', icon: '🔫',
    baseDamage: 18, baseCooldown: 0.32, baseBullets: 1, baseSpread: 0, baseSpeed: 28, baseLife: 1.2, baseRadius: 0.18,
    color: [1, 0.85, 0.3, 1], emissive: [1, 0.7, 0.15], emissiveIntensity: 0.8,
    accent: [1, 0.5, 0.1, 1], accentEmissive: [1, 0.4, 0.05], accentEmissiveIntensity: 0.5,
    pierce: false,
  },
  fire: {
    kind: 'fire', name: '火焰弹', desc: '爆炸范围伤害，烤化一片牛~', icon: '🔥',
    baseDamage: 14, baseCooldown: 0.55, baseBullets: 1, baseSpread: 0, baseSpeed: 20, baseLife: 2.0, baseRadius: 0.32,
    // baseColor + emissive kept for the Materials.standard fallback path
    // (when fxRef.bulletMaterial returns undefined). With the custom
    // fire-trail shader active, the SPHERE body uses that shader; only
    // the 4 spikes use this standard PBR material as `accent`.
    color: [1, 0.35, 0.08, 1], emissive: [1, 0.3, 0.05], emissiveIntensity: 0.8,
    // Accent spikes were the actual culprit of "fire bullet looks yellow-
    // white": baseColor (1, 0.85, 0.3) + emissive (1, 0.8, 0.2) × 2.8
    // gave per-pixel output ~vec3(2.8, 2.24, 0.56) → ACES (0.95, 0.92,
    // 0.61) = bright yellow-white. The 4 spikes around the orange sphere
    // dominated the bullet's visual colour. Pull accent into the SAME
    // red-orange hue family as main, and drop the emissive intensity.
    accent: [1, 0.30, 0.05, 1], accentEmissive: [1, 0.30, 0.05], accentEmissiveIntensity: 0.5,
    onHit: 'aoe', aoeRadius: 2.4, pierce: false,
  },
  ice: {
    kind: 'ice', name: '冰锥', desc: '命中减速，让奶牛慢慢思考人生~', icon: '❄️',
    baseDamage: 10, baseCooldown: 0.28, baseBullets: 1, baseSpread: 0, baseSpeed: 32, baseLife: 1.0, baseRadius: 0.22,
    color: [0.4, 0.75, 1, 1], emissive: [0.3, 0.6, 1], emissiveIntensity: 0.7,
    // Ice accent was [0.9, 0.95, 1] — near-WHITE. With emissive (0.8, 0.9,
    // 1)*1.6 ≈ vec3(1.28, 1.44, 1.6) the spikes rendered as PURE WHITE
    // and dominated the bullet's colour. Pull into the cyan family.
    accent: [0.5, 0.85, 1, 1], accentEmissive: [0.4, 0.75, 1], accentEmissiveIntensity: 0.5,
    onHit: 'slow', slowSec: 1.6, pierce: true,
  },
  chain: {
    kind: 'chain', name: '闪电链', desc: '命中后跳到周围的牛~', icon: '⚡',
    baseDamage: 12, baseCooldown: 0.45, baseBullets: 1, baseSpread: 0, baseSpeed: 28, baseLife: 1.6, baseRadius: 0.20,
    color: [0.85, 0.65, 1, 1], emissive: [0.7, 0.5, 1], emissiveIntensity: 1.5,
    accent: [0.55, 0.30, 1, 1], accentEmissive: [0.55, 0.30, 1], accentEmissiveIntensity: 1.0,
    onHit: 'chain', chainTargets: 3, chainRange: 5, pierce: false,
  },
  shotgun: {
    kind: 'shotgun', name: '散弹', desc: '一次 5 发扇形，近距离爆炸感~', icon: '💢',
    baseDamage: 9, baseCooldown: 0.7, baseBullets: 5, baseSpread: Math.PI / 4, baseSpeed: 26, baseLife: 0.7, baseRadius: 0.16,
    color: [1, 0.75, 0.4, 1], emissive: [1, 0.6, 0.2], emissiveIntensity: 2.0,
    accent: [1, 0.4, 0.1, 1], accentEmissive: [1, 0.3, 0.05], accentEmissiveIntensity: 1.6,
    pierce: false,
  },
  boomerang: {
    kind: 'boomerang', name: '回旋镖', desc: '飞出去又飞回来，路过都挨打~', icon: '🌀',
    baseDamage: 11, baseCooldown: 0.9, baseBullets: 1, baseSpread: 0, baseSpeed: 22, baseLife: 2.2, baseRadius: 0.30,
    color: [0.45, 0.95, 0.55, 1], emissive: [0.3, 1, 0.5], emissiveIntensity: 1.0,
    accent: [0.85, 1, 0.6, 1], accentEmissive: [0.7, 1, 0.6], accentEmissiveIntensity: 1.2,
    isBoomerang: true, pierce: true,
  },
  grenade: {
    kind: 'grenade', name: '手雷', desc: '抛物线落地大爆炸，物理感拉满~', icon: '💣',
    baseDamage: 30, baseCooldown: 1.1, baseBullets: 1, baseSpread: 0, baseSpeed: 18, baseLife: 1.8, baseRadius: 0.26,
    color: [0.30, 0.32, 0.38, 1], emissive: [0.05, 0.05, 0.08], emissiveIntensity: 0.1,
    accent: [1, 0.3, 0.05, 1], accentEmissive: [1, 0.4, 0.05], accentEmissiveIntensity: 1.8,
    isGrenade: true, onHit: 'aoe', aoeRadius: 3.6, pierce: false,
  },
};

export interface WeaponState {
  def: WeaponDef;
  level: number;       // 1..5
  cooldown: number;    // time remaining until next auto-fire
  mainMat: MatHandle;
  accentMat: MatHandle;
}

export interface Bullet {
  e: Entity;
  weapon: WeaponKind;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;   // velocity direction (unit)
  speed: number;
  damage: number;
  age: number;
  life: number;
  hits: Set<Entity>;
  onHit: 'aoe' | 'slow' | 'chain' | null;
  aoeRadius: number;
  slowSec: number;
  chainTargets: number;
  chainRange: number;
  pierce: boolean;
  isBoomerang: boolean;
  isGrenade: boolean;
  boomReturn: boolean;
  grenadeVY: number;
  // local roll/yaw — boomerang spins on Y, grenade rolls on X for a tumbling
  // look, others just face their velocity direction.
  spin: number;
  // Visual parts (ChildOf the root). Despawning the root does NOT auto-cull
  // its ChildOf children — we have to despawn each part explicitly. Without
  // this, every fired bullet leaks 2..5 entities; after a few hundred shots
  // the world hits its entity cap and `world.spawn` silently fails for new
  // bullets → "bullets stop spawning, old ones float forever" (the user-
  // reported bug). Tracked here, walked in destroyBullet + lifetime-expiry
  // and on-hit non-pierce paths.
  parts: Entity[];
}

// ── PartSpec for bullet visuals (same shape concept as enemies) ────────────
type BulletPart = {
  shape: 'cube' | 'sphere';
  px: number; py: number; pz: number;
  sx: number; sy: number; sz: number;
  rotY?: number;
  mat: 'main' | 'accent';
};

// Per-weapon visual blueprints. The bullet's velocity-direction yaw is
// applied to the ROOT, so part.pz is "forward" along the flight direction.
const BULLET_VISUALS: Record<WeaponKind, BulletPart[]> = {
  // Long yellow bullet (spindle): a stretched cube + a small cube tip.
  // Total length ~0.5 along Z.
  pistol: [
    { shape: 'cube',   px: 0, py: 0, pz: 0,    sx: 0.10, sy: 0.10, sz: 0.40, mat: 'main' },
    { shape: 'cube',   px: 0, py: 0, pz: 0.22, sx: 0.08, sy: 0.08, sz: 0.10, mat: 'accent' },
  ],

  // Pure red fireball: SOLID sphere only (no accent spikes). The 4 cube
  // spikes used Materials.standard PBR + the player PointLight, which at
  // close range over-bright the spikes (PointLight intensity 12 × spike
  // emissive (1, 0.3, 0.05) × 0.5 + diffuse term) — the spikes washed the
  // bullet's edges yellow-white. Drop them; the lone sphere body uses the
  // fire-trail shader (custom, NO PointLight) and stays pure red end-to-end.
  fire: [
    { shape: 'sphere', px: 0, py: 0, pz: 0, sx: 0.55, sy: 0.55, sz: 0.55, mat: 'main' },
  ],

  // Ice shard — long sharp blue cube along Z, with a smaller bright tip.
  ice: [
    // shaft (long thin cube)
    { shape: 'cube',   px: 0, py: 0, pz: 0,    sx: 0.14, sy: 0.14, sz: 0.55, mat: 'main' },
    // bright pointed tip
    { shape: 'cube',   px: 0, py: 0, pz: 0.30, sx: 0.08, sy: 0.08, sz: 0.18, mat: 'accent' },
    // back fin
    { shape: 'cube',   px: 0, py: 0, pz: -0.25, sx: 0.18, sy: 0.04, sz: 0.10, mat: 'accent' },
  ],

  // Lightning bolt — pure ZIGZAG silhouette, NO spheres. Three thin glowing
  // bars connected end-to-end forming a Z. We rotate the middle bar via
  // rotY=±0.9 to slant it; segments stay thin enough that the silhouette
  // reads as a lightning streak (sphere accents drowned out the zigzag in
  // prior versions, so they are deliberately removed). All emissive 14 →
  // bloom paints a bright halo around the bars without an actual halo prim.
  //
  // Z layout (top-down, root facing +Z):
  //
  //       ╲          ← back segment (slanted)
  //        ──        ← middle bar (slanted opposite)
  //           ╲      ← forward segment (slanted same as back, points +Z)
  chain: [
    // forward bolt (the "head" — points along +Z, the flight direction)
    { shape: 'cube', px:  0.12, py: 0.06, pz:  0.40, sx: 0.08, sy: 0.08, sz: 0.55, mat: 'main', rotY:  0.55 },
    // middle connector (counter-slanted to make a Z corner)
    { shape: 'cube', px:  0.00, py: 0.00, pz:  0.05, sx: 0.08, sy: 0.08, sz: 0.45, mat: 'main', rotY: -0.65 },
    // tail bolt (mirrors the head — points backward)
    { shape: 'cube', px: -0.12, py: -0.06, pz: -0.30, sx: 0.08, sy: 0.08, sz: 0.55, mat: 'main', rotY:  0.55 },
    // two bright accent crackle nodes at the joints (small cubes, NOT spheres)
    { shape: 'cube', px:  0.07, py: 0.04, pz:  0.18, sx: 0.14, sy: 0.14, sz: 0.14, mat: 'accent' },
    { shape: 'cube', px: -0.07, py: -0.03, pz: -0.10, sx: 0.14, sy: 0.14, sz: 0.14, mat: 'accent' },
  ],

  // Shotgun pellet — small forward bullet head.
  shotgun: [
    { shape: 'cube',   px: 0, py: 0, pz: 0,    sx: 0.10, sy: 0.10, sz: 0.22, mat: 'main' },
    { shape: 'cube',   px: 0, py: 0, pz: 0.14, sx: 0.07, sy: 0.07, sz: 0.06, mat: 'accent' },
  ],

  // Boomerang — true CROSS shape: two flat cubes at 90°. The whole bullet
  // spins on its Y axis every frame (set in tickBullets) so the cross is
  // visibly twirling end-over-end.
  boomerang: [
    // horizontal blade (long along Z, thin along X)
    { shape: 'cube',   px: 0, py: 0, pz: 0, sx: 0.10, sy: 0.05, sz: 0.65, mat: 'main' },
    // perpendicular blade (long along X, thin along Z)
    { shape: 'cube',   px: 0, py: 0, pz: 0, sx: 0.65, sy: 0.05, sz: 0.10, mat: 'main' },
    // small centre stud
    { shape: 'sphere', px: 0, py: 0.04, pz: 0, sx: 0.12, sy: 0.10, sz: 0.12, mat: 'accent' },
  ],

  // Grenade — grey sphere body + short black fuse cube + tiny red ember.
  grenade: [
    { shape: 'sphere', px: 0,    py: 0,    pz: 0,    sx: 0.30, sy: 0.30, sz: 0.30, mat: 'main' },
    // fuse stem (short black cube sticking up)
    { shape: 'cube',   px: 0,    py: 0.22, pz: 0,    sx: 0.05, sy: 0.10, sz: 0.05, mat: 'main' },
    // glowing ember at the tip
    { shape: 'sphere', px: 0,    py: 0.30, pz: 0,    sx: 0.08, sy: 0.08, sz: 0.08, mat: 'accent' },
  ],
};

export class WeaponSystem {
  loadout: WeaponState[] = [];
  bullets: Bullet[] = [];
  // Bonuses applied to ALL weapons (set by upgrades)
  damageMul = 1;
  cooldownMul = 1;
  bulletMul = 0;
  speedMul = 1;
  // Two material handles per weapon (main + accent), built once.
  private mats = new Map<WeaponKind, { main: MatHandle; accent: MatHandle }>();
  private fxRef: {
    bulletMaterial(family: 'fire' | 'ice'): MatHandle | undefined;
    bulletTrail?(x: number, y: number, z: number, vx: number, vy: number, vz: number, family: 'fire' | 'ice'): void;
  } | undefined;

  constructor(private ctx: Ctx, fx?: {
    bulletMaterial(family: 'fire' | 'ice'): MatHandle | undefined;
    bulletTrail?(x: number, y: number, z: number, vx: number, vy: number, vz: number, family: 'fire' | 'ice'): void;
  }) {
    this.fxRef = fx;
    for (const def of Object.values(WEAPONS)) {
      // E1+ — fire / ice bullets use a custom shader material registered
      // by the FX system (assets/effects/{fire-trail,ice-shard}.fx.json).
      // Other weapons keep their standard PBR emissive material.
      const override = fx?.bulletMaterial(def.kind as 'fire' | 'ice');
      // engine e53f4616: `assets.register` is gone → mint inline shared
      // material handles directly via `world.allocSharedRef` (never fails).
      const main = override ?? ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: def.color, roughness: 0.35, metallic: 0.1,
        emissive: def.emissive, emissiveIntensity: def.emissiveIntensity,
      }));
      // accent material — falls back to a dim black if unspecified, but every
      // weapon in WEAPONS provides an `accent` so the fallback is just safety.
      const accent = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: def.accent ?? [0.1, 0.1, 0.1, 1],
        roughness: 0.4, metallic: 0.1,
        emissive: def.accentEmissive ?? [0.05, 0.05, 0.05],
        emissiveIntensity: def.accentEmissiveIntensity ?? 0.5,
      }));
      this.mats.set(def.kind, { main, accent });
    }
  }

  acquire(kind: WeaponKind): WeaponState {
    const existing = this.loadout.find((w) => w.def.kind === kind);
    if (existing) {
      existing.level = Math.min(5, existing.level + 1);
      return existing;
    }
    const pair = this.mats.get(kind)!;
    const state: WeaponState = {
      def: WEAPONS[kind], level: 1, cooldown: 0,
      mainMat: pair.main, accentMat: pair.accent,
    };
    if (this.loadout.length >= 4) {
      let lowestIdx = 0;
      for (let i = 1; i < this.loadout.length; i++) {
        if (this.loadout[i]!.level < this.loadout[lowestIdx]!.level) lowestIdx = i;
      }
      this.loadout[lowestIdx] = state;
    } else {
      this.loadout.push(state);
    }
    return state;
  }

  /** Tick auto-fire: each weapon picks the nearest enemy and shoots if its
   *  cooldown is ready. Returns the list of weapon kinds that fired this
   *  frame, so main.ts can play one SFX per actual shot (for screen-shake
   *  the caller can just check `.length > 0`). */
  tickAutoFire(dt: number, originX: number, originY: number, originZ: number,
               nearest: (x: number, z: number, r?: number) => { x: number; z: number } | null): WeaponKind[] {
    const fired: WeaponKind[] = [];
    for (const w of this.loadout) {
      w.cooldown -= dt;
      if (w.cooldown > 0) continue;
      const tgt = nearest(originX, originZ, 22);
      if (!tgt) { w.cooldown = 0.1; continue; }
      const dx = tgt.x - originX, dz = tgt.z - originZ;
      const len = Math.hypot(dx, dz) || 1;
      const aimX = dx / len, aimZ = dz / len;
      this.fire(w, originX, originY, originZ, aimX, aimZ);
      w.cooldown = w.def.baseCooldown * this.cooldownMul * (1 - 0.06 * (w.level - 1));
      fired.push(w.def.kind);
    }
    return fired;
  }

  /** Manual fire (player presses F or clicks). Uses the FIRST weapon.
   *  Returns the kind that fired (so main.ts can play SFX), or null. */
  fireManual(originX: number, originY: number, originZ: number, aimX: number, aimY: number, aimZ: number): WeaponKind | null {
    if (this.loadout.length === 0) return null;
    const w = this.loadout[0]!;
    if (w.cooldown > 0) return null;
    this.fire(w, originX, originY, originZ, aimX, aimZ, aimY);
    w.cooldown = w.def.baseCooldown * this.cooldownMul * (1 - 0.06 * (w.level - 1));
    return w.def.kind;
  }

  private fire(w: WeaponState, ox: number, oy: number, oz: number, ax: number, az: number, ay: number = 0): void {
    const def = w.def;
    const count = def.baseBullets + (def.kind === 'shotgun' ? this.bulletMul : Math.floor(this.bulletMul * 0.5));
    const dmg = def.baseDamage * this.damageMul * (1 + 0.25 * (w.level - 1));
    const speed = def.baseSpeed * this.speedMul;
    const life = def.baseLife * (def.isBoomerang ? 1 : (1 + 0.1 * (w.level - 1)));
    const spread = def.baseSpread;
    const baseAng = Math.atan2(az, ax);
    for (let i = 0; i < count; i++) {
      let ang: number;
      if (count === 1) {
        ang = baseAng + (Math.random() - 0.5) * 0.02;
      } else {
        const t = (i / (count - 1)) - 0.5;
        ang = baseAng + t * spread;
      }
      const dx = Math.cos(ang), dz = Math.sin(ang);
      let dy = ay;
      if (def.isGrenade) dy = 0.7;
      this.spawnBullet(w, ox, oy, oz, dx, dy, dz, speed, life, dmg);
    }
  }

  private spawnBullet(w: WeaponState, ox: number, oy: number, oz: number,
                      dx: number, dy: number, dz: number,
                      speed: number, life: number, damage: number): void {
    const def = w.def;
    const { world } = this.ctx;
    const bx = ox + dx * 0.7, by = oy + dy * 0.7, bz = oz + dz * 0.7;
    // Initial yaw so the bullet's local +Z faces flight direction (matches
    // the visual layout — pistol/ice spindles, chain stroke point forward).
    const yaw = Math.atan2(dx, dz);
    const q = quat.eulerY(yaw);
    // ROOT entity: invisible carrier (no MeshFilter / MeshRenderer), holds
    // the rigid body + collider. Visible parts are children below.
    // Explicit scale 1 — partial Transform.set() later writes posX/Y/Z + quat
    // only, so the root must already carry the identity scale; otherwise some
    // ECS/physics paths can re-default scale to 0 and shrink every ChildOf
    // visual part to invisible.
    const e = world.spawn(
      { component: Transform, data: {
        posX: bx, posY: by, posZ: bz,
        quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]!,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } },
      // RELIABLE CONTACT FIX (preserved from template):
      //  ENGINE BUG: kinematic bodies don't honor `ccdEnabled`. So we use a
      //  LARGER physical collider than the visual to ensure contact registers
      //  during a discrete physics step.
      { component: Collider, data: {
        shape: ColliderShapeValue.sphere,
        radius: Math.max(0.5, def.baseRadius * 1.8),
        friction: 0, restitution: 0.4,
      } },
    ).unwrap();

    // Spawn the per-weapon visual parts as ChildOf the root. Track each
    // spawned entity so we can despawn them when the bullet ends — ChildOf
    // does NOT auto-cascade despawn in this engine, so without tracking we
    // leak 2..5 entities per shot, the world's entity cap fills up, and
    // subsequent `world.spawn` for new bullets silently fails (the user-
    // reported "bullets stop spawning, old ones float forever" symptom).
    const partEntities: Entity[] = [];
    const partsSpec = BULLET_VISUALS[def.kind];
    for (const p of partsSpec) {
      const mat = p.mat === 'main' ? w.mainMat : w.accentMat;
      const handle = p.shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE;
      const partT: Record<string, number> = {
        posX: p.px, posY: p.py, posZ: p.pz,
        scaleX: p.sx, scaleY: p.sy, scaleZ: p.sz,
      };
      if (p.rotY !== undefined) {
        const pq = quat.eulerY(p.rotY);
        partT.quatX = pq[0]!; partT.quatY = pq[1]!; partT.quatZ = pq[2]!; partT.quatW = pq[3]!;
      }
      const partE = world.spawn(
        { component: Transform, data: partT },
        { component: MeshFilter, data: { assetHandle: handle } },
        { component: MeshRenderer, data: { materials: [mat] } },
        { component: ChildOf, data: { parent: e } },
      ).unwrap();
      partEntities.push(partE);
    }

    this.bullets.push({
      e, weapon: def.kind,
      x: bx, y: by, z: bz,
      dx, dy, dz, speed, damage,
      age: 0, life,
      hits: new Set<Entity>(),
      onHit: def.onHit ?? null,
      aoeRadius: def.aoeRadius ?? 0,
      slowSec: def.slowSec ?? 0,
      chainTargets: def.chainTargets ?? 0,
      chainRange: def.chainRange ?? 0,
      pierce: def.pierce ?? false,
      isBoomerang: !!def.isBoomerang,
      isGrenade: !!def.isGrenade,
      boomReturn: false,
      grenadeVY: def.isGrenade ? 6 : 0,
      spin: 0,
      parts: partEntities,
    });
  }

  /** Advance bullet positions; despawn expired. Caller handles hit detection. */
  /** Per-frame bullet update. The `onGrenadeImpact` callback is fired
   *  EXACTLY ONCE per grenade when it lands (y ≤ 0.3), with the impact's
   *  world position + base AoE damage + radius — main.ts uses it to walk
   *  the enemy list, deal damage, spawn the visual explosion, and play the
   *  boom SFX. The bullet is killed immediately after; without this hook
   *  the grenade just despawned on landing and the AoE never registered
   *  (the user-reported "grenade flies off, no boom" bug). */
  tickBullets(
    dt: number, playerX: number, playerY: number, playerZ: number,
    onGrenadeImpact?: (x: number, y: number, z: number, damage: number, radius: number) => void,
  ): void {
    const { world } = this.ctx;
    void playerY;
    // Helper: despawn the bullet root AND every ChildOf visual part. The
    // engine does NOT auto-cascade ChildOf despawn — if we only despawn the
    // root, the parts persist (orphaned in place where the root last wrote
    // its Transform) and the entity pool keeps growing until spawn() starts
    // failing. That was the "bullets stop firing after a while + a few float
    // forever" bug.
    const killBullet = (b: Bullet) => {
      world.despawn(b.e);
      for (const pe of b.parts) world.despawn(pe);
      b.parts.length = 0;
    };
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      b.age += dt;
      if (b.age > b.life) {
        killBullet(b);
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.isBoomerang) {
        if (!b.boomReturn && b.age > b.life * 0.45) b.boomReturn = true;
        if (b.boomReturn) {
          const rx = playerX - b.x, rz = playerZ - b.z;
          const rl = Math.hypot(rx, rz) || 1;
          b.dx = rx / rl; b.dz = rz / rl;
          if (rl < 0.7) {
            killBullet(b);
            this.bullets.splice(i, 1);
            continue;
          }
        }
      }
      if (b.isGrenade) {
        b.grenadeVY -= 14 * dt;
        b.y += b.grenadeVY * dt;
        if (b.y <= 0.3) {
          b.y = 0.3;
          // Fire the AoE callback FIRST (so main.ts sees the impact and
          // damages enemies), then kill the bullet on the spot. The previous
          // version set `b.life = b.age + 0.01` and relied on the next-frame
          // expiry path, but that gave a 1-frame window for the regular
          // bullet↔enemy proximity scan to also miss it (and skipped the
          // boom SFX entirely) — visible result: grenade flies and never
          // explodes.
          onGrenadeImpact?.(b.x, b.y, b.z, b.damage, b.aoeRadius);
          killBullet(b);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      b.x += b.dx * b.speed * dt;
      b.z += b.dz * b.speed * dt;
      if (!b.isGrenade) b.y += b.dy * b.speed * dt;

      // ── per-bullet rotation: write the ROOT's Transform so all ChildOf
      //    visual parts ride along. ──────────────────────────────────────
      //   • boomerang spins on Y at ~12 rad/s (very visibly)
      //   • grenade tumbles on Y slowly + arcs (already moving)
      //   • everyone else faces velocity direction (yaw from dx/dz)
      let qx = 0, qy = 0, qz = 0, qw = 1;
      if (b.isBoomerang) {
        b.spin += dt * 12;
        const h = b.spin * 0.5;
        qy = Math.sin(h); qw = Math.cos(h);
      } else if (b.isGrenade) {
        b.spin += dt * 3;
        const h = b.spin * 0.5;
        qy = Math.sin(h); qw = Math.cos(h);
      } else {
        const yaw = Math.atan2(b.dx, b.dz);
        const h = yaw * 0.5;
        qy = Math.sin(h); qw = Math.cos(h);
      }
      // Keep scale 1 in the partial set — safety against schema defaults
      // resetting unspecified scale fields to 0 on partial component writes.
      world.set(b.e, Transform, {
        posX: b.x, posY: b.y, posZ: b.z,
        quatX: qx, quatY: qy, quatZ: qz, quatW: qw,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
      // P3: NO trail particles. The previous approach (emit particles
      // behind the bullet in world space) was correct in 3D — particles
      // spread back from the bullet at 1.5-3 m/s relative — but the
      // SURVIVOR camera is a top-down 3/4 view, so "behind the bullet"
      // in world space projects onto roughly the same screen pixel as
      // the bullet head. Additive blend stacks N trail particles +
      // bullet body emissive at that pixel → ACES roll-off pushes the
      // colour through orange → yellow → near-white as the trail
      // accumulates. The visual user perceived as "fireball turning
      // white over time" was actually screen-space additive pileup.
      //
      // Solution: drop trail particles entirely. The bullet body's
      // fire-trail.wgsl already animates a self-contained flame
      // (noise-modulated heat profile from tail to leading face); that
      // alone reads as a moving fireball without any external trail.
      // No more additive pileup, no muzzle halo, no hue drift.
      void b;
    }
  }

  destroyBullet(b: Bullet): void {
    // Mirror killBullet — root + all ChildOf parts. Caller is responsible for
    // splicing the bullet out of `this.bullets`.
    this.ctx.world.despawn(b.e);
    for (const pe of b.parts) this.ctx.world.despawn(pe);
    b.parts.length = 0;
    const i = this.bullets.indexOf(b);
    if (i >= 0) this.bullets.splice(i, 1);
  }
}
