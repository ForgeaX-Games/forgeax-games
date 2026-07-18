/**
 * MarsCraft -> forgeax-engine — attack system (Milestone M6)
 * =============================================================================
 * Port of the Three.js source `web/systems/AttackSystem.ts`. Runs AFTER the
 * command-executor / before movement (installed after movement in main.ts; order
 * within a frame is the registration order — see main.ts NOTE). Per attacker:
 *
 *   1. tick cooldown
 *   2. validate the current target (alive? still hostile? air/ground legal?)
 *   3. command gating (1:1 with source):
 *        move / patrol / ability_move -> drop target, never auto-acquire
 *        attack <entity>              -> lock the commanded target
 *        attack_move / hold / (none)  -> allow auto-acquire (workers never auto)
 *   4. auto-acquire nearest hostile in vision (respecting canAttackAir/Ground)
 *   5. in range -> turn to face + halt movement + (cooldown ready & facing) fire
 *   6. out of range -> chase (melee: to contact; ranged: to 85% range), unless Hold
 *   7. past leash distance from engage origin -> give up
 *
 * Fire: instant weapons (`projectileType === instant`) apply damage immediately
 * (+ splash); projectile weapons spawn a Projectile entity that the
 * projectile-system flies + resolves on arrival.
 *
 * ── forgeax adaptation ───────────────────────────────────────────────────────
 * - `qr[0]` is an ARRAY OF BATCHES; a prologue snapshots every combat entity from
 *   those batches (combat-registry.ts) so acquisition/splash can scan without a
 *   live World query (forgeax has none). Per-attacker Attack columns are written
 *   straight to the batch SoA arrays.
 * - The M3 factory only seeded placeholder Attack numbers; this system applies the
 *   real `WeaponDef` (data/weapons.ts) into the Attack columns ONCE per entity
 *   (tracked in `_weaponApplied`) — that is M6's "overwrite from the weapon def".
 * - Facing writes `Motion.facingY` AND the derived yaw quat directly, so a
 *   stationary attacker turns to its target even when movement isn't driving it.
 * - DEFERRED (noted, not stubbed silently): garrison/bunker fire, buffs/upgrades,
 *   abilities/orb modifiers, illusions, deterministic vision, missile-barrage
 *   salvo — all belong to M9/M10/M13. The core attack/chase/leash/fire loop is 1:1.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform, quat } from '@forgeax/engine-runtime';
import {
  Attack, Health, Faction, Movement, Motion, UnitType,
  attackWeaponId, attackSplashFalloff,
  commandCurrent,
  DAMAGE_TYPE, PROJECTILE_TYPE, SPLASH_SHAPE, UNIT_CATEGORY,
  type CombatTypeCode,
} from '../components';
import { getWeaponDef, type WeaponDef } from '../data/weapons';
import { resolveDamage } from './damage-resolver';
import { resolveAreaDamage, type AreaParams } from './splash-resolver';
import {
  snapshotCombatTargets, isHostileTarget, type CombatTarget,
} from './combat-registry';
import { CHASE_RANGE_FACTOR } from '../data/balance';
import { spawnProjectile, type ProjectileAssets } from './projectile-spawn';
import { eventBus } from '../core/event-bus';

// ── tuning (verbatim from source) ────────────────────────────────────────────
const MELEE_RANGE = 1.5;
const MELEE_CHASE_EXTRA = 0.5;
/** Muzzle Y up the model (relative to modelSize/2). */
const MUZZLE_Y_RATIO = 0.6;
/** Muzzle forward offset along facing (relative to modelSize/2). */
const MUZZLE_FORWARD_RATIO = 0.8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

// ── string-enum -> code maps for applying a WeaponDef into the SoA Attack cols ─
const DAMAGE_TYPE_CODE: Record<string, number> = {
  normal: DAMAGE_TYPE.NORMAL, spell: DAMAGE_TYPE.SPELL,
};
const PROJECTILE_TYPE_CODE: Record<string, number> = {
  instant: PROJECTILE_TYPE.INSTANT, bullet: PROJECTILE_TYPE.BULLET,
  missile: PROJECTILE_TYPE.MISSILE, bounce: PROJECTILE_TYPE.BOUNCE,
};
const SPLASH_SHAPE_CODE: Record<string, number> = {
  circle: SPLASH_SHAPE.CIRCLE, cone: SPLASH_SHAPE.CONE, line: SPLASH_SHAPE.LINE,
};

export interface AttackSystemDeps {
  /** Terrain sampler (high-ground miss + muzzle Y); optional. */
  getTerrainHeight?: (x: number, z: number) => number;
  /** Shared projectile mesh + per-color material cache (built once). */
  projectileAssets: ProjectileAssets;
}

export class AttackSystem {
  private _gameTime = 0;
  private _snapshot: CombatTarget[] = [];
  /** Entities whose Attack columns already received their real WeaponDef. */
  private _weaponApplied = new Set<number>();
  private _scratchQuat = quat.create();
  private _world!: World;

  constructor(private deps: AttackSystemDeps) {}

  install(world: World): void {
    this._world = world;
    world.addSystem({
      name: 'mc-attack-system',
      queries: [
        { with: [Entity, Transform, Health, Faction, Attack] }, // attackers
        { with: [Entity, Transform, Health, Faction] },         // all targets (snapshot)
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time').dt;
        const attackers = qr[0] as unknown as Batch[];
        this._gameTime += dt;
        // Snapshot EVERY combat entity (incl. weaponless buildings) so acquisition
        // / splash can target units that don't themselves carry Attack.
        snapshotCombatTargets(world, qr[1] as unknown as Batch[], this._snapshot);

        for (const b of attackers) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._tickAttacker(world, b, i, dt);
          }
        }
      },
    });
  }

  // ── per-attacker tick ──────────────────────────────────────────────────────

  private _tickAttacker(world: World, b: Batch, i: number, dt: number): void {
    const entity = b.Entity.self[i] as EntityHandle;

    if (b.Health.isDead[i]) { b.Attack.isAttacking[i] = 0; return; }

    // Apply the real weapon def into the Attack columns once.
    this._ensureWeapon(world, entity, b, i);

    const A = b.Attack;
    const selfX = b.Transform.pos[i * 3] as number;
    const selfZ = b.Transform.pos[i * 3 + 2] as number;
    const selfY = b.Transform.pos[i * 3 + 1] as number;
    const selfPlayer = b.Faction.playerId[i] as number;

    // 1. cooldown
    if (A.currentCooldown[i] > 0) A.currentCooldown[i] -= dt;

    // 2. validate current target
    let target = A.targetEntity[i] as number; // -1 = none
    if (target >= 0 && !this._targetUsable(world, target, selfPlayer, A, i)) {
      target = -1;
      A.targetEntity[i] = -1;
      A.isAttacking[i] = 0;
    }

    // 3. command gating
    const cmd = commandCurrent.get(entity) ?? null;
    const cmdType = cmd?.type;

    if (cmdType === 'move' || cmdType === 'patrol' || cmdType === 'ability_move') {
      A.targetEntity[i] = -1;
      A.isAttacking[i] = 0;
      return;
    }

    if (cmdType === 'attack' && cmd?.targetEntity !== undefined) {
      const cmdTarget = cmd.targetEntity;
      if (this._targetUsable(world, cmdTarget, selfPlayer, A, i)) {
        target = cmdTarget;
        A.targetEntity[i] = cmdTarget;
      } else {
        A.targetEntity[i] = -1;
        A.isAttacking[i] = 0;
        // advance the queue so the unit doesn't wedge on a dead target
        commandCurrent.set(entity, null);
        return;
      }
    }

    // workers never auto-acquire; only attack/attack_move/hold/(none) auto.
    const ut = world.get(entity, UnitType);
    const isWorker = ut.ok && ut.value.category === UNIT_CATEGORY.WORKER;
    const allowAuto = !isWorker && (
      cmdType === 'attack_move' || cmdType === 'hold' || cmdType === undefined || cmdType === 'attack'
    );

    // 4. auto-acquire
    if (target < 0 && allowAuto) {
      const acq = this._findNearestEnemy(entity, selfX, selfZ, selfPlayer, A, i);
      if (acq >= 0) {
        target = acq;
        A.targetEntity[i] = acq;
        A.originX[i] = selfX;
        A.originZ[i] = selfZ;
      }
    }

    if (target < 0) { A.isAttacking[i] = 0; return; }

    // 5-7
    this._processAttack(world, entity, b, i, target, selfX, selfZ, selfY, selfPlayer, cmdType, dt);
  }

  /** Apply the unit's WeaponDef into its SoA Attack columns (once per entity). */
  private _ensureWeapon(world: World, entity: EntityHandle, b: Batch, i: number): void {
    const eid = entity as unknown as number;
    if (this._weaponApplied.has(eid)) return;
    this._weaponApplied.add(eid);

    const wid = attackWeaponId.get(entity);
    if (!wid) return;
    const def: WeaponDef | undefined = getWeaponDef(wid);
    if (!def) return;

    const A = b.Attack;
    A.damage[i] = def.damage;
    A.damageCount[i] = def.damageCount;
    A.damageType[i] = DAMAGE_TYPE_CODE[def.damageType] ?? DAMAGE_TYPE.NORMAL;
    A.range[i] = def.range;
    A.cooldown[i] = def.cooldown;
    A.projectileType[i] = PROJECTILE_TYPE_CODE[def.projectileType] ?? PROJECTILE_TYPE.INSTANT;
    A.projectileSpeed[i] = def.projectileSpeed;
    A.canAttackAir[i] = def.canAttackAir ? 1 : 0;
    A.canAttackGround[i] = def.canAttackGround ? 1 : 0;
    A.splashRadius[i] = def.splashRadius;
    A.splashShape[i] = SPLASH_SHAPE_CODE[def.splashShape] ?? SPLASH_SHAPE.CIRCLE;
    A.splashAngle[i] = def.splashAngle;
    A.splashWidth[i] = def.splashWidth;
    A.bounceCount[i] = def.bounceCount;
    A.bounceDamageDecay[i] = def.bounceDamageDecay;
    A.leashDistance[i] = def.leashDistance;
    // splashFalloff (number[]) lives in the companion Map — seed it from the def.
    attackSplashFalloff.set(entity, def.splashFalloff.slice());
  }

  // ── target validity ─────────────────────────────────────────────────────────

  /** Find the snapshot row for a raw entity id (or undefined). */
  private _findTarget(targetId: number): CombatTarget | undefined {
    for (const t of this._snapshot) {
      if ((t.entity as unknown as number) === targetId) return t;
    }
    return undefined;
  }

  /** True if target is alive, hostile, and air/ground-legal for this attacker. */
  private _targetUsable(world: World, targetId: number, selfPlayer: number, A: Batch, i: number): boolean {
    const t = this._findTarget(targetId);
    if (!t) return false;
    if (!isHostileTarget(t, selfPlayer)) return false;
    const canAir = !!A.canAttackAir[i];
    const canGround = !!A.canAttackGround[i];
    if (t.isAir && !canAir) return false;
    if (!t.isAir && !canGround) return false;
    return true;
  }

  // ── auto-acquire ─────────────────────────────────────────────────────────────

  private _findNearestEnemy(self: EntityHandle, sx: number, sz: number, selfPlayer: number, A: Batch, i: number): number {
    const selfId = self as unknown as number;
    // vision range — UnitStats/abilities are M9. Use UnitType.visionRange (read
    // via the visionRange cache below), else range*2 (1:1 with the source's
    // no-UnitStats fallback).
    const vr = this._visionRange(self);
    const visionRange = vr > 0 ? vr : (A.range[i] as number) * 2;

    const selfRadius = this._selfRadius(selfId);
    const canAir = !!A.canAttackAir[i];
    const canGround = !!A.canAttackGround[i];

    let best = -1;
    let bestEdge = Infinity;
    for (const t of this._snapshot) {
      if ((t.entity as unknown as number) === selfId) continue;
      if (!isHostileTarget(t, selfPlayer)) continue;
      if (t.isAir && !canAir) continue;
      if (!t.isAir && !canGround) continue;
      const dx = t.x - sx;
      const dz = t.z - sz;
      const centerDist = Math.sqrt(dx * dx + dz * dz);
      const edgeDist = Math.max(0, centerDist - selfRadius - t.radius);
      if (edgeDist > visionRange) continue;
      if (edgeDist < bestEdge) { bestEdge = edgeDist; best = t.entity as unknown as number; }
    }
    return best;
  }

  private _selfRadius(selfId: number): number {
    const t = this._findTarget(selfId);
    return t ? t.radius : 0.5;
  }

  /** UnitType.visionRange for an entity (0 if absent -> caller uses range*2). */
  private _visionRange(self: EntityHandle): number {
    const ut = this._world.get(self, UnitType);
    return ut.ok ? ut.value.visionRange : 0;
  }

  // ── attack / chase / leash ───────────────────────────────────────────────────

  private _processAttack(
    world: World, entity: EntityHandle, b: Batch, i: number, targetId: number,
    selfX: number, selfZ: number, selfY: number, selfPlayer: number,
    cmdType: string | undefined, dt: number,
  ): void {
    const A = b.Attack;
    const t = this._findTarget(targetId);
    if (!t) { A.targetEntity[i] = -1; A.isAttacking[i] = 0; return; }

    const dx = t.x - selfX;
    const dz = t.z - selfZ;
    const centerDist = Math.sqrt(dx * dx + dz * dz);
    const selfRadius = this._selfRadius(entity as unknown as number);
    const edgeDist = Math.max(0, centerDist - selfRadius - t.radius);

    const isHold = cmdType === 'hold';

    // leash (non-hold): give up if we wandered too far from the engage origin
    if (!isHold) {
      const ldx = selfX - (A.originX[i] as number);
      const ldz = selfZ - (A.originZ[i] as number);
      const leashDist = Math.sqrt(ldx * ldx + ldz * ldz);
      if (leashDist > (A.leashDistance[i] as number)) {
        A.targetEntity[i] = -1; A.isAttacking[i] = 0; return;
      }
    }

    const effectiveRange = A.range[i] as number; // UnitStats range bonuses are M9
    const inRange = edgeDist <= effectiveRange;

    if (inRange) {
      A.isAttacking[i] = 1;

      // turn to face (turn-rate limited), write facing + quat directly
      const targetAngle = Math.atan2(dx, dz);
      const facing = this._turnToFace(world, entity, b, i, targetAngle, dt);

      // halt movement so MovementSystem stops driving
      const mv = world.get(entity, Movement);
      if (mv.ok) {
        world.set(entity, Movement, { useFlowField: false, hasTarget: false, currentSpeed: 0 });
      }

      if ((A.currentCooldown[i] as number) <= 0 && facing) {
        this._fire(world, entity, b, i, t, selfX, selfZ, selfY, selfPlayer);
        A.currentCooldown[i] = A.cooldown[i];
      }
    } else {
      A.isAttacking[i] = 0;
      if (isHold) { A.targetEntity[i] = -1; return; } // hold doesn't chase

      // chase: melee to contact, ranged to 85% range
      const isMelee = effectiveRange <= MELEE_RANGE;
      const desiredEdge = isMelee ? MELEE_CHASE_EXTRA : effectiveRange * CHASE_RANGE_FACTOR;
      const stopDist = t.radius + desiredEdge;
      const inv = centerDist > 0.0001 ? 1 / centerDist : 0;
      const moveToX = t.x - dx * inv * stopDist;
      const moveToZ = t.z - dz * inv * stopDist;

      // Direct-seek chase (source falls back to setTarget when no path executor
      // ref; CommandExecutor.navigateEntityTo is not exposed here, M6 NOTE).
      const mv = world.get(entity, Movement);
      if (mv.ok) {
        world.set(entity, Movement, {
          useFlowField: false, hasTarget: true, arrived: false,
          targetX: moveToX, targetZ: moveToZ,
        });
      }
    }
  }

  /** Turn-rate-limited yaw toward `targetAngle`; returns true if facing. */
  private _turnToFace(world: World, entity: EntityHandle, b: Batch, i: number, targetAngle: number, dt: number): boolean {
    const mo = world.get(entity, Motion);
    let facingY = mo.ok ? mo.value.facingY : 0;
    let angleDiff = targetAngle - facingY;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const mv = world.get(entity, Movement);
    const turnRate = mv.ok ? mv.value.turnRate : Math.PI * 4;
    const maxTurn = turnRate * dt;

    if (Math.abs(angleDiff) > maxTurn) facingY += Math.sign(angleDiff) * maxTurn;
    else facingY = targetAngle;
    while (facingY > Math.PI) facingY -= Math.PI * 2;
    while (facingY < -Math.PI) facingY += Math.PI * 2;

    const facing = Math.abs(angleDiff) <= maxTurn || Math.abs(angleDiff) < 0.1;

    if (mo.ok) world.set(entity, Motion, { facingY });
    quat.fromAxisAngle(this._scratchQuat, [0, 1, 0], facingY);
    world.set(entity, Transform, { quat: this._scratchQuat });
    return facing;
  }

  // ── fire ─────────────────────────────────────────────────────────────────────

  private _fire(
    world: World, entity: EntityHandle, b: Batch, i: number, t: CombatTarget,
    selfX: number, selfZ: number, selfY: number, selfPlayer: number,
  ): void {
    const A = b.Attack;
    const baseDamage = A.damage[i] as number;
    const damageCount = A.damageCount[i] as number;
    const damageType = (A.damageType[i] === DAMAGE_TYPE.SPELL) ? 'spell' : 'normal';
    const splashRadius = A.splashRadius[i] as number;
    const splashShape = (A.splashShape[i] as number);
    const ut = world.get(entity, UnitType);
    const attackerCombat = (ut.ok ? ut.value.combatType : 0) as CombatTypeCode;

    // companion falloff
    const falloff: number[] = attackSplashFalloff.get(entity) ?? [];

    if (A.projectileType[i] === PROJECTILE_TYPE.INSTANT) {
      // instant hit (melee / hitscan)
      const res = resolveDamage(
        world, t.entity, baseDamage, damageCount,
        damageType, this._gameTime, selfY, 0, 0, attackerCombat, entity,
      );
      // on_attack_hit trigger event (attacker view); damage events fire inside
      // resolveDamage. Bus no-ops without subscribers (TriggerSystem).
      eventBus.emit('combat:attack_hit', {
        attacker: entity as unknown as number,
        target: t.entity as unknown as number,
        damage: res.actualDamage,
      });
      if (splashRadius > 0) {
        const areaParams: AreaParams = {
          shape: splashShape === SPLASH_SHAPE.CONE ? 'cone' : splashShape === SPLASH_SHAPE.LINE ? 'line' : 'circle',
          radius: splashRadius,
          falloff,
          angle: A.splashAngle[i] as number,
          width: A.splashWidth[i] as number,
          directionX: selfX,
          directionZ: selfZ,
        };
        resolveAreaDamage(
          world, this._snapshot, t.x, t.z, selfPlayer, areaParams,
          baseDamage, damageType, this._gameTime, selfY, attackerCombat,
          t.entity as unknown as number,
        );
      }
    } else {
      // projectile (bullet / missile / bounce) — spawn an entity
      const halfSize = this._selfRadius(entity as unknown as number); // visual half from radius
      const muzzleY = selfY + halfSize * MUZZLE_Y_RATIO;
      const fwd = halfSize * MUZZLE_FORWARD_RATIO;
      const mo = world.get(entity, Motion);
      const facingY = mo.ok ? mo.value.facingY : 0;
      const startX = selfX + Math.sin(facingY) * fwd;
      const startZ = selfZ + Math.cos(facingY) * fwd;

      spawnProjectile(world, this.deps.projectileAssets, {
        sourceEntity: entity,
        sourcePlayerId: selfPlayer,
        startX, startY: muzzleY, startZ,
        target: t.entity,
        targetX: t.x, targetY: t.y, targetZ: t.z,
        projectileType: A.projectileType[i] as number,
        speed: A.projectileSpeed[i] as number,
        damage: baseDamage,
        damageCount,
        damageType,
        splashRadius,
        splashShape,
        splashFalloff: falloff,
        splashAngle: A.splashAngle[i] as number,
        splashWidth: A.splashWidth[i] as number,
        bounceCount: A.bounceCount[i] as number,
        bounceDamageDecay: A.bounceDamageDecay[i] as number,
        attackerCombatType: attackerCombat,
        weaponId: attackWeaponId.get(entity) ?? '',
      });
    }
  }
}

