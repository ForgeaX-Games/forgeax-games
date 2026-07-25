/**
 * MarsCraft -> forgeax-engine — SummonSystem + recall (Milestone M9 chunk 3)
 * =============================================================================
 * Ports the summon side of the Three.js source:
 *   - `spawn_unit` ability effect: spawn `count` units of a type at the cast
 *     point / offset from the caster, same faction. Illusions/broodlings/
 *     interceptors carry:
 *       · `SummonedLifetime` (timed despawn) when a lifetime is given
 *       · `Illusion` (damage-taken / damage-dealt multipliers) for clones
 *       · an optional auto-attack command toward the cast target
 *     (Carrier interceptors are summoned sub-units that attack then return; their
 *      "return" steering is handled by the normal attack/leash loop — additive.)
 *   - `recall`: teleport allied units within a radius of a point to the caster.
 *
 * `SummonLifetimeSystem` ticks `SummonedLifetime.remainingLife`; on expiry it
 * flags `Health.isDead = true` so the DeathSystem (which runs after) does the full
 * despawn + ChildOf-part cleanup + companion-prune — no duplicated teardown.
 *
 * ⚠️ ECS rules: qr[0] is Batch[]; collect-then-mutate (set isDead, never despawn
 * here); spawning happens OUTSIDE any query loop (from the cast pipeline).
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  SummonedLifetime, Illusion, Health, Faction, Movement,
  commandCurrent, type UnitCommand,
} from '../components';
import { spawnUnit, type UnitFactoryCtx } from './unit-factory';
import type { SummonReq } from './effect-executor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;

export interface SummonDeps {
  factoryCtx: UnitFactoryCtx;
  factionColor: (playerId: number) => number;
}

export interface SummonHandle {
  /** Spawn summoned units per a SummonReq; returns the spawned entities. */
  summon(req: SummonReq): EntityHandle[];
  /** Recall allied units within `radius` of (x,z) to the caster's position. */
  recall(world: World, caster: EntityHandle, x: number, z: number, radius: number): void;
  probe(): Array<Record<string, unknown>>;
}

export class SummonSystem implements SummonHandle {
  readonly name = 'SummonLifetimeSystem';
  private _world!: World;
  private readonly _deps: SummonDeps;

  constructor(deps: SummonDeps) { this._deps = deps; }

  install(world: World): SummonHandle {
    this._world = world;
    world.addSystem(Update, {
      name: this.name,
      queries: [{ with: [Entity, SummonedLifetime, Health] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        const batches = qr[0] as unknown as Batch[];
        const expired: EntityHandle[] = [];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            if (b.Health.isDead[i]) continue;
            const remaining = (b.SummonedLifetime.remainingLife[i] as number) - dt;
            b.SummonedLifetime.remainingLife[i] = remaining;
            if (remaining <= 0) expired.push(b.Entity.self[i] as EntityHandle);
          }
        }
        // flag dead (DeathSystem despawns after) — no despawn mid-iteration.
        for (const e of expired) {
          if (world.get(e, Health).ok) world.set(e, Health, { hp: 0, isDead: true });
        }
      },
    });
    return this;
  }

  summon(req: SummonReq): EntityHandle[] {
    const world = this._world;
    const out: EntityHandle[] = [];
    const playerColor = this._deps.factionColor(req.playerId);
    for (let i = 0; i < req.count; i++) {
      // spread multiple summons in a small ring around the base point.
      const angle = req.count > 1 ? (i / req.count) * Math.PI * 2 : 0;
      const spread = req.count > 1 ? 1.5 : 0;
      const sx = req.x + Math.cos(angle) * spread;
      const sz = req.z + Math.sin(angle) * spread;
      const e = spawnUnit(world, this._deps.factoryCtx, {
        typeId: req.unitTypeId, x: sx, z: sz,
        playerId: req.playerId, playerColor,
      });
      if (!e) continue;

      // inherit caster HP/shield ratio (clones).
      if (req.inheritCasterStats) {
        const ch = world.get(req.casterEntity, Health);
        const eh = world.get(e, Health);
        if (ch.ok && eh.ok) {
          const ratio = ch.value.maxHp > 0 ? ch.value.hp / ch.value.maxHp : 1;
          world.set(e, Health, { hp: Math.max(1, eh.value.maxHp * ratio) });
        }
      }

      // illusion damage multipliers (clones deal less / take more).
      if (req.damageTakenMultiplier !== undefined || req.damageDealtMultiplier !== undefined) {
        world.addComponent(e, {
          component: Illusion,
          data: {
            damageTakenMultiplier: req.damageTakenMultiplier ?? 1,
            damageDealtMultiplier: req.damageDealtMultiplier ?? 0.1,
          },
        });
      }

      // timed lifetime.
      if (req.lifetime !== undefined && req.lifetime > 0) {
        world.addComponent(e, {
          component: SummonedLifetime,
          data: { casterEntity: rawId(req.casterEntity), remainingLife: req.lifetime, totalLife: req.lifetime },
        });
      }

      // auto-attack the cast target.
      if (req.autoAttackTarget !== undefined && world.get(req.autoAttackTarget, Health).ok) {
        const cmd: UnitCommand = { type: 'attack', targetEntity: rawId(req.autoAttackTarget) };
        commandCurrent.set(e, cmd);
      }

      out.push(e);
    }
    return out;
  }

  recall(world: World, caster: EntityHandle, x: number, z: number, radius: number): void {
    const ct = world.get(caster, Transform);
    if (!ct.ok) return;
    const cf = world.get(caster, Faction);
    if (!cf.ok) return;
    const destX = ct.value.pos[0], destZ = ct.value.pos[2];
    const r2 = radius * radius;
    // No World enumeration outside a system — scan a small raw-id range. Recall is
    // a rare, deterministic action; the cost is acceptable for the verify path.
    for (let raw = 0; raw < 9000; raw++) {
      const eh = raw as unknown as EntityHandle;
      const tf = world.get(eh, Faction);
      if (!tf.ok || tf.value.playerId !== cf.value.playerId) continue;
      const tt = world.get(eh, Transform);
      if (!tt.ok) continue;
      const dx = tt.value.pos[0] - x, dz = tt.value.pos[2] - z;
      if (dx * dx + dz * dz > r2) continue;
      // teleport near the caster (small spread so units don't stack).
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 2;
      world.set(eh, Transform, { pos: [destX + Math.cos(a) * d, tt.value.pos[1], destZ + Math.sin(a) * d] });
      const mv = world.get(eh, Movement);
      if (mv.ok) world.set(eh, Movement, { hasTarget: false, arrived: true });
      commandCurrent.set(eh, null);
    }
  }

  probe(): Array<Record<string, unknown>> {
    const world = this._world;
    const out: Array<Record<string, unknown>> = [];
    for (let raw = 0; raw < 9000; raw++) {
      const eh = raw as unknown as EntityHandle;
      const s = world.get(eh, SummonedLifetime);
      if (!s.ok) continue;
      const il = world.get(eh, Illusion);
      out.push({
        entity: raw,
        remainingLife: Number(s.value.remainingLife.toFixed(3)),
        totalLife: s.value.totalLife,
        caster: s.value.casterEntity,
        isIllusion: il.ok,
        damageDealtMult: il.ok ? il.value.damageDealtMultiplier : null,
      });
    }
    return out;
  }
}
