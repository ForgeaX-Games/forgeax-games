// XP gems — drop-on-kill currency that the player magnet-vacuums up.
//
// Why a separate module?
//   Vampire-survivors-likes get their core feedback loop from "kill → walk
//   over orb → bar fills". The DROP step (delayed gratification) and the
//   PICKUP step (rewarding movement) are gameplay surface a stat tick can't
//   replace. So onKill no longer adds xp directly; it spawns gems here, and
//   gems.tick() decides when xp lands on the player.
//
// Implementation notes
// ────────────────────
// • Each gem is ONE entity (a sphere with an emissive material) — no rigid
//   body, no collider. Gems live in JS arrays + integrate manually.
// • Gems hover with a tiny sin-wave bob and a slow Y-rotation, both purely
//   cosmetic Transform writes per frame.
// • Magnet behavior: outside `pickupAttractR` (4.0u) gems sit still on the
//   ground; once the player crosses inside, the gem accelerates toward the
//   player and locks on (it doesn't escape if the player walks back away).
//   Inside `pickupCollectR` (0.6u) the gem is consumed.
// • Lifetime: 18s if uncollected. Stays bright; warns by halving emissive
//   in the last 3 seconds (visual hint "I'm about to vanish").
// • 4 visual variants by tier (T1/T2/T3/BOSS) — pre-registered materials so
//   the spawn path is just three Transform/MeshFilter/MeshRenderer fields.

import {
  Transform, MeshFilter, MeshRenderer, Materials,
  HANDLE_SPHERE, type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';

import type { EnemyKind, Tier } from './enemies';
import { ENEMIES } from './enemies';

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type Ctx = Parameters<GameEntry>[0];

interface Gem {
  e: Entity;
  // World pos (we manually integrate; Transform is just the renderer's view).
  x: number; y: number; z: number;
  baseY: number;        // bobbing center
  // velocity used during the magnet phase
  vx: number; vz: number;
  age: number;          // total seconds alive
  /** Once true, the gem is committed to flying to the player every frame. */
  hooked: boolean;
  xp: number;
  tier: Tier;
  // small per-gem random phase so a cluster doesn't bob in lockstep
  bobPhase: number;
  spinPhase: number;
}

export interface GemPickupEvent {
  xp: number;
  tier: Tier;
  x: number; y: number; z: number;
}

export class GemSystem {
  private gems: Gem[] = [];
  private mats: Record<Tier, MatHandle>;
  // Tunable
  readonly pickupAttractR = 4.5;
  readonly pickupCollectR = 0.8;
  readonly lifeSec = 18;
  readonly bobAmp = 0.12;
  readonly bobHz = 1.6;

  constructor(private ctx: Ctx) {
    // Each tier has a distinctive color. Emissive is bright enough to bloom
    // through the post FX so gems pop against the dark ground.
    // engine e53f4616: `assets.register` is gone → mint inline shared material
    // handles directly via `world.allocSharedRef` (never fails).
    const reg = (color: [number, number, number], emI: number) =>
      ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: [color[0], color[1], color[2], 1],
        roughness: 0.25, metallic: 0.4,
        emissive: color, emissiveIntensity: emI,
      }));
    this.mats = {
      T1:   reg([0.30, 1.0, 0.45], 6),     // green
      T2:   reg([0.40, 0.70, 1.0], 7),     // blue
      T3:   reg([0.85, 0.40, 1.0], 8),     // purple
      BOSS: reg([1.0,  0.85, 0.30], 12),   // gold
    };
  }

  /** Spawn 1..N gems around the kill point. The total xp of the dropped
   *  cluster equals `def.xp` from ENEMIES — we just split it into a few
   *  smaller orbs so the screen pops with multiple pickups instead of
   *  one giant blob (and so the player gets 2-3 dings of feedback). */
  dropFrom(payload: { kind: EnemyKind; x: number; z: number }): void {
    const def = ENEMIES[payload.kind];
    const tier = def.tier;
    // gem count: 1 for tiny mooks, scales up for bosses. Cap at 8 (boss).
    const count = Math.max(1, Math.min(8, Math.floor(def.xp / 4) || 1));
    // distribute xp evenly with the remainder dumped on the first gem
    const each = Math.max(1, Math.floor(def.xp / count));
    const remainder = def.xp - each * count;
    for (let i = 0; i < count; i++) {
      const xp = each + (i === 0 ? remainder : 0);
      // splatter pattern: small random ring around the kill point
      const ang = Math.random() * Math.PI * 2;
      const r = count === 1 ? 0 : 0.3 + Math.random() * 0.6;
      this.spawn(payload.x + Math.cos(ang) * r, payload.z + Math.sin(ang) * r, xp, tier);
    }
  }

  spawn(x: number, z: number, xp: number, tier: Tier): void {
    const baseY = 0.45;
    // gem visual size scales with tier so a boss drops feel chunkier
    const r = tier === 'BOSS' ? 0.32 : tier === 'T3' ? 0.22 : tier === 'T2' ? 0.18 : 0.15;
    const e = this.ctx.world.spawn(
      { component: Transform, data: { posX: x, posY: baseY, posZ: z, scaleX: r, scaleY: r, scaleZ: r } },
      { component: MeshFilter, data: { assetHandle: HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [this.mats[tier]] } },
    ).unwrap();
    this.gems.push({
      e, x, y: baseY, z, baseY,
      vx: 0, vz: 0,
      age: 0, hooked: false, xp, tier,
      bobPhase: Math.random() * Math.PI * 2,
      spinPhase: Math.random() * Math.PI * 2,
    });
  }

  /** Per-frame: bob + magnet + pickup. Returns the list of pickups that
   *  occurred THIS frame so main.ts can fire HUD/SFX events for each. */
  tick(dt: number, playerX: number, playerY: number, playerZ: number): GemPickupEvent[] {
    const { world } = this.ctx;
    const events: GemPickupEvent[] = [];
    const attractR2 = this.pickupAttractR * this.pickupAttractR;
    const collectR2 = this.pickupCollectR * this.pickupCollectR;

    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i]!;
      g.age += dt;
      if (g.age > this.lifeSec) {
        world.despawn(g.e);
        this.gems.splice(i, 1);
        continue;
      }

      const dx = playerX - g.x;
      const dz = playerZ - g.z;
      const d2 = dx * dx + dz * dz;

      if (!g.hooked && d2 < attractR2) g.hooked = true;

      if (g.hooked) {
        // Velocity-target magnet (NOT acceleration-based) — eliminates the
        // orbiting bug: the previous version added accel · dt to vx/vz every
        // frame, capped only by maxSpeed. Once the gem built up speed, a
        // change in player direction left a large lateral velocity that
        // overshot and looped back. Here we set the velocity DIRECTLY toward
        // the player every frame (with a smooth lerp so it doesn't snap),
        // and ramp speed up with proximity so close pickups feel snappy
        // while distant ones still arc in.
        const d = Math.sqrt(d2) || 1;
        // target speed: small at attractR, large near the player; in [4, 16]
        const t = Math.max(0, Math.min(1, 1 - d / this.pickupAttractR));
        const targetSpeed = 4 + t * 14;
        const tvx = (dx / d) * targetSpeed;
        const tvz = (dz / d) * targetSpeed;
        // lerp toward target velocity — `k` is per-second smoothing, framerate-independent
        const k = 1 - Math.exp(-12 * dt);
        g.vx += (tvx - g.vx) * k;
        g.vz += (tvz - g.vz) * k;
        g.x += g.vx * dt;
        g.z += g.vz * dt;
        // ease toward player Y so the gem flies into the chest, not the feet
        const targetY = playerY + 0.6;
        g.y += (targetY - g.y) * Math.min(1, dt * 6);

        if (d2 < collectR2) {
          events.push({ xp: g.xp, tier: g.tier, x: g.x, y: g.y, z: g.z });
          world.despawn(g.e);
          this.gems.splice(i, 1);
          continue;
        }
      } else {
        // idle bob + slow ground rotation (purely visual)
        g.bobPhase += dt * this.bobHz * Math.PI * 2;
        g.y = g.baseY + Math.sin(g.bobPhase) * this.bobAmp;
      }

      // spin (always-on)
      g.spinPhase += dt * 2.0;
      const cy = Math.cos(g.spinPhase * 0.5);
      const sy = Math.sin(g.spinPhase * 0.5);
      world.set(g.e, Transform, {
        posX: g.x, posY: g.y, posZ: g.z,
        // quat for Y-axis rotation: (0, sin(θ/2), 0, cos(θ/2))
        quatX: 0, quatY: sy, quatZ: 0, quatW: cy,
      });
    }
    return events;
  }

  /** Force-collect ALL gems instantly (used by a hypothetical "magnet" pickup
   *  power-up; not wired to UI yet but the API is here). */
  collectAll(): GemPickupEvent[] {
    const events: GemPickupEvent[] = this.gems.map((g) => ({ xp: g.xp, tier: g.tier, x: g.x, y: g.y, z: g.z }));
    for (const g of this.gems) this.ctx.world.despawn(g.e);
    this.gems.length = 0;
    return events;
  }

  count(): number { return this.gems.length; }
}
