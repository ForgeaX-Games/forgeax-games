/**
 * MarsCraft -> forgeax-engine — projectile system (Milestone M6)
 * =============================================================================
 * Port of `web/systems/ProjectileSystem.ts` (the flight + hit-detection + bounce
 * core; the direction-wave / hazard-intercept branches belong to M9 abilities and
 * are noted, not stubbed). Runs after the attack system. Per projectile:
 *
 *   1. age it; expire past maxLifetime
 *   2. retrack a live target's position (homing)
 *   3. straight-line flight (XZ + Y interpolation) toward the target; bounce
 *      redirects fly as an arc (quadratic Bezier) for a natural feel
 *   4. within HIT_DIST -> resolve the attack payload (damage + splash) and either
 *      bounce to the next nearest enemy (decaying damage) or despawn
 *
 * The source held a JS `AttackPayload` on the projectile; here the payload's
 * numeric fields live in the `Projectile` SoA columns and the rest in
 * `projectilePayloadData` (projectile-spawn.ts). On hit we run the exact
 * AttackPayload.onHit logic: resolveDamage on the primary + resolveAreaDamage for
 * splash, then bounce decay.
 *
 * ── forgeax adaptation ───────────────────────────────────────────────────────
 * - Two queries: qr[0] = projectiles, qr[1] = combat entities (for the splash +
 *   bounce-search snapshot, since forgeax has no ad-hoc World query). Both iterate
 *   as batch arrays.
 * - Dead projectiles are collected then despawned AFTER the loop (despawning
 *   mid-iteration corrupts the batch). Payload Maps are pruned on despawn.
 * - Hit VFX (M11): on impact we call the VFX system — `explosion` for a splash
 *   hit (area weapons read as a blast), `impact` for a single-target hit. The
 *   M11 VfxSystem buffers the spawn + flushes it safely in its own tick, so it's
 *   safe to call from inside this query loop. (Replaced the M6 minimal hit-flash
 *   sphere.) The `combat:attack_hit` + `combat:damage` events this system / the
 *   resolver emit ALSO drive VFX (muzzle/impact/spark/blood) via the bus wiring;
 *   this direct call adds the projectile-specific blast read.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import { Projectile, Health, Faction, projectileWeaponId } from '../components';
import { resolveDamage } from './damage-resolver';
import { resolveAreaDamage, type AreaParams } from './splash-resolver';
import { eventBus } from '../core/event-bus';
import {
  snapshotCombatTargets, isHostileTarget, type CombatTarget,
} from './combat-registry';
import { projectilePayloadData } from './projectile-spawn';
import type { VfxHandle } from './vfx-system';
import { getWeaponVFX, hexRgb } from '../data/weapon-vfx';

/** Hit-detection distance. */
const HIT_DIST = 0.5;
/** Bounce search radius (source CProjectile default). */
const BOUNCE_SEARCH_RADIUS = 8;
/** Arc length compensation (arc path ~30% longer than straight). */
const ARC_LENGTH_FACTOR = 1.3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

function shapeCodeToStr(code: number): 'circle' | 'cone' | 'line' {
  return code === 1 ? 'cone' : code === 2 ? 'line' : 'circle';
}

export class ProjectileSystem {
  private _gameTime = 0;
  private _snapshot: CombatTarget[] = [];
  private _world!: World;
  /** M11 VFX system — hit blasts spawn through it (replaces the M6 flash sphere). */
  private _vfx: VfxHandle | null;

  constructor(vfx?: VfxHandle) {
    this._vfx = vfx ?? null;
  }

  install(world: World): void {
    this._world = world;
    world.addSystem({
      name: 'mc-projectile-system',
      queries: [
        { with: [Entity, Transform, Projectile] },
        { with: [Entity, Transform, Health, Faction] }, // combat snapshot source
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time').dt;
        this._gameTime += dt;

        const projBatches = qr[0] as unknown as Batch[];
        // perf: skip the per-frame combat snapshot entirely when no projectiles are
        // in flight (the common case) — the snapshot only feeds projectile hit tests.
        let anyProj = false;
        for (const b of projBatches) { if ((b.Entity.self.length as number) > 0) { anyProj = true; break; } }
        if (!anyProj) return;

        // Build the combat snapshot from the 2nd query (Health+Faction rows).
        snapshotCombatTargets(world, qr[1] as unknown as Batch[], this._snapshot);

        const toDespawn: EntityHandle[] = [];

        for (const b of projBatches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            if (this._tickProjectile(b, i, dt)) {
              toDespawn.push(b.Entity.self[i] as EntityHandle);
            }
          }
        }

        for (const e of toDespawn) this._despawnProjectile(e);
      },
    });
  }

  // ── per-projectile flight + hit ──────────────────────────────────────────────

  /** @returns true = despawn this projectile. */
  private _tickProjectile(b: Batch, i: number, dt: number): boolean {
    const P = b.Projectile;
    const entity = b.Entity.self[i] as EntityHandle;

    // lifetime
    P.lifetime[i] += dt;
    if (P.lifetime[i] > P.maxLifetime[i]) return true;

    // retrack live target
    const targetId = P.targetEntity[i] as number;
    const tgt = this._findTarget(targetId);
    if (tgt) {
      P.targetX[i] = tgt.x;
      P.targetY[i] = tgt.y;
      P.targetZ[i] = tgt.z;
    }

    let px = b.Transform.pos[i * 3] as number;
    let py = b.Transform.pos[i * 3 + 1] as number;
    let pz = b.Transform.pos[i * 3 + 2] as number;
    const tx = P.targetX[i] as number;
    const ty = P.targetY[i] as number;
    const tz = P.targetZ[i] as number;

    // ── per-weapon projectile TRAIL (M17): drop a fading mote at the current
    // position each frame, colored by the weapon's trailColor. A short lifetime
    // keeps ~trailLength motes alive → a colored streak marking the flight path
    // (the particle-model port of the source's ribbon trail). Emitted every
    // frame; instant/hitscan attacks spawn no Projectile entity so never reach
    // here — only real flying projectiles get trails.
    if (this._vfx) {
      const cfg = getWeaponVFX(projectileWeaponId.get(entity));
      this._vfx.spawnVfx('trail', px, py, pz, {
        color: hexRgb(cfg.trailColor),
        size: Math.max(0.08, cfg.trailWidth * 2),
        count: Math.max(0.08, cfg.trailLength / 45), // reuse `count` as lifetime (s)
      });
    }

    // ── arc-homing (bounce redirect) ──
    if (P.isArcHoming[i]) {
      const arrived = this._stepArc(b, i, dt);
      if (arrived) {
        b.Transform.pos[i * 3] = tx;
        b.Transform.pos[i * 3 + 1] = ty;
        b.Transform.pos[i * 3 + 2] = tz;
        return this._onHit(b, i, tx, ty, tz);
      }
      return false;
    }

    // ── straight-line flight ──
    const dx = tx - px;
    const dz = tz - pz;
    const distXZ = Math.sqrt(dx * dx + dz * dz);

    if (distXZ < HIT_DIST) {
      return this._onHit(b, i, tx, ty, tz);
    }

    const step = (P.speed[i] as number) * dt;
    if (step >= distXZ) {
      px = tx; py = ty; pz = tz;
    } else {
      const ratio = step / distXZ;
      px += (dx / distXZ) * step;
      pz += (dz / distXZ) * step;
      py += (ty - py) * ratio;
    }
    b.Transform.pos[i * 3] = px;
    b.Transform.pos[i * 3 + 1] = py;
    b.Transform.pos[i * 3 + 2] = pz;
    return false;
  }

  /** Quadratic-Bezier arc step; @returns true when arcProgress reaches 1. */
  private _stepArc(b: Batch, i: number, dt: number): boolean {
    const P = b.Projectile;
    // init start point on first arc frame
    if (P.arcProgress[i] === 0) {
      P.arcStartX[i] = b.Transform.pos[i * 3];
      P.arcStartY[i] = b.Transform.pos[i * 3 + 1];
      P.arcStartZ[i] = b.Transform.pos[i * 3 + 2];
    }
    const sx = P.arcStartX[i] as number;
    const sy = P.arcStartY[i] as number;
    const sz = P.arcStartZ[i] as number;
    const tx = P.targetX[i] as number;
    const ty = P.targetY[i] as number;
    const tz = P.targetZ[i] as number;

    const totalDx = tx - sx, totalDy = ty - sy, totalDz = tz - sz;
    const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy + totalDz * totalDz);
    if (totalDist < 0.01) { P.arcProgress[i] = 1.0; return true; }

    const delta = ((P.speed[i] as number) * dt) / (totalDist * ARC_LENGTH_FACTOR);
    P.arcProgress[i] = Math.min(1.0, (P.arcProgress[i] as number) + delta);
    const t = P.arcProgress[i] as number;

    const midX = (sx + tx) * 0.5, midY = (sy + ty) * 0.5, midZ = (sz + tz) * 0.5;
    const dirLen = Math.sqrt(totalDx * totalDx + totalDz * totalDz);
    let perpX = 0, perpZ = 0;
    if (dirLen > 0.01) { perpX = -totalDz / dirLen; perpZ = totalDx / dirLen; }
    const arcHeight = P.arcHeight[i] as number;
    const lateral = arcHeight * 0.6 * (P.arcSide[i] as number);
    const ctrlX = midX + perpX * lateral;
    const ctrlY = midY + arcHeight;
    const ctrlZ = midZ + perpZ * lateral;

    const om = 1 - t;
    const a = om * om, bb = 2 * om * t, c = t * t;
    b.Transform.pos[i * 3] = a * sx + bb * ctrlX + c * tx;
    b.Transform.pos[i * 3 + 1] = a * sy + bb * ctrlY + c * ty;
    b.Transform.pos[i * 3 + 2] = a * sz + bb * ctrlZ + c * tz;
    return P.arcProgress[i] >= 1.0;
  }

  /**
   * Resolve the attack payload (damage + splash), then bounce or despawn.
   * @returns true = despawn this projectile.
   */
  private _onHit(b: Batch, i: number, hitX: number, hitY: number, hitZ: number): boolean {
    const P = b.Projectile;
    const projEntity = b.Entity.self[i] as EntityHandle;
    const payload = projectilePayloadData.get(projEntity);
    const targetId = P.targetEntity[i] as number;
    const target = this._findTarget(targetId);
    const sourcePlayer = P.sourcePlayerId[i] as number;
    let wasSplash = false;

    if (payload && target && isHostileTarget(target, sourcePlayer)) {
      // primary hit (attackBonus already folded into payload.damage)
      const sourceEntity = (P.sourceEntity[i] as number) as unknown as EntityHandle;
      const res = resolveDamage(
        this._world, target.entity, payload.damage, payload.damageCount,
        payload.damageType, this._gameTime, hitY, 0, 0, payload.attackerCombatType,
        sourceEntity,
      );
      // on_attack_hit (attacker view); damage/kill events fire in resolveDamage.
      eventBus.emit('combat:attack_hit', {
        attacker: P.sourceEntity[i] as number,
        target: target.entity as unknown as number,
        damage: res.actualDamage,
      });
      // splash
      if (payload.splashRadius > 0) {
        wasSplash = true;
        const areaParams: AreaParams = {
          shape: shapeCodeToStr(payload.splashShape),
          radius: payload.splashRadius,
          falloff: payload.splashFalloff,
          angle: payload.splashAngle,
          width: payload.splashWidth,
          directionX: P.sourceX[i] as number,
          directionZ: P.sourceZ[i] as number,
        };
        resolveAreaDamage(
          this._world, this._snapshot, hitX, hitZ, sourcePlayer, areaParams,
          payload.damage, payload.damageType, this._gameTime, hitY,
          payload.attackerCombatType, target.entity as unknown as number,
        );
      }
    }
    // M11 hit VFX: a splash hit reads as an explosion blast; a single-target hit
    // as a spark impact. (The bus also fires muzzle/impact/spark/blood via
    // combat:attack_hit + combat:damage; this is the projectile-specific blast.)
    this._vfx?.spawnVfx(wasSplash ? 'explosion' : 'impact', hitX, hitY, hitZ);

    // bounce
    if ((P.bounceRemaining[i] as number) > 0) {
      const next = this._findBounceTarget(targetId, hitX, hitZ, sourcePlayer);
      if (next) {
        P.isArcHoming[i] = 1;
        P.arcProgress[i] = 0;
        P.arcStartX[i] = hitX; P.arcStartY[i] = hitY; P.arcStartZ[i] = hitZ;
        P.arcSide[i] = (P.bounceIndex[i] as number) % 2 === 0 ? 1 : -1;
        P.arcHeight[i] = 1.5;
        P.targetEntity[i] = (next.entity as unknown as number) >>> 0;
        P.targetX[i] = next.x; P.targetY[i] = next.y; P.targetZ[i] = next.z;
        P.bounceRemaining[i] -= 1;
        P.bounceIndex[i] += 1;
        P.lifetime[i] = 0;
        // bounce damage decay
        const decay = P.bounceDamageDecay[i] as number;
        if (decay > 0 && payload) payload.damage *= (1 - decay);
        return false; // keep flying
      }
    }
    return true; // despawn
  }

  /** Nearest hostile within BOUNCE_SEARCH_RADIUS of the hit point (excl. last). */
  private _findBounceTarget(
    hitEntityId: number, hx: number, hz: number, sourcePlayer: number,
  ): CombatTarget | null {
    let best: CombatTarget | null = null;
    let bestDist = Infinity;
    for (const t of this._snapshot) {
      if ((t.entity as unknown as number) === hitEntityId) continue;
      if (!isHostileTarget(t, sourcePlayer)) continue;
      const dx = t.x - hx, dz = t.z - hz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > BOUNCE_SEARCH_RADIUS) continue;
      if (dist < bestDist) { bestDist = dist; best = t; }
    }
    return best;
  }

  private _findTarget(targetId: number): CombatTarget | undefined {
    for (const t of this._snapshot) {
      if ((t.entity as unknown as number) === targetId) return t;
    }
    return undefined;
  }

  private _despawnProjectile(e: EntityHandle): void {
    projectilePayloadData.delete(e);
    projectileWeaponId.delete(e);
    this._world.despawn(e);
  }
}
