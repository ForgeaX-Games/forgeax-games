/**
 * MarsCraft -> forgeax-engine — death system (Milestone M6)
 * =============================================================================
 * Port of `web/systems/DeathSystem.ts`. Runs after combat. Detects
 * `Health.isDead`, then for each dead unit:
 *   - despawns its ChildOf model-part children (engine despawn does NOT cascade
 *     ChildOf — the ChildOf docstring is explicit: "Despawning the parent does not
 *     auto-clean the child's ChildOf"; the parent's `Children` forward list gives
 *     us the parts to despawn explicitly)
 *   - despawns the unit entity
 *   - removes it from the selection set + despawns its selection ring
 *     (`selection.notifyDespawned`)
 *   - prunes its companion-Map side-data (attack/command/etc.)
 *
 * Occupancy: the OccupancyGrid's dynamic `unitCount` layer is rebuilt every frame
 * by the movement system (clearUnits + addUnit per live mover), so a dead unit
 * drops out of occupancy automatically next frame — no explicit removal needed
 * (units never claim the static building-footprint layer). NOTE recorded.
 *
 * ── safe despawn during iteration ────────────────────────────────────────────
 * Dead entities are COLLECTED inside the batch loop and despawned only AFTER it —
 * despawning mid-iteration swap-removes a batch row and corrupts the loop (per the
 * engine's transient-view contract). Children are read (Children snapshot) before
 * the parent is despawned.
 */

import { Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform,
  Children,
  ChildOf,
} from '@forgeax/engine-scene';
import {
  Health,
  attackWeaponId, attackSplashFalloff,
  commandCurrent, commandQueue,
  renderableModelPath, unitTypeId, unitDisplayName,
} from '../components';
import type { SelectionHandle } from './selection';
import { eventBus } from '../core/event-bus';
import { lastAttacker } from './damage-resolver';

export interface DeathSystemDeps {
  /** Selection handle — dead units are pruned from the selection + ring removed. */
  selection: SelectionHandle | null;
  /** Health-bar handle — a dead unit's ChildOf bars are despawned synchronously
   *  here (before the unit), avoiding a 1-frame orphan → hierarchy-broken. */
  healthBar?: { notifyDespawned(e: EntityHandle): void } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

export class DeathSystem {
  private _world!: World;

  constructor(private deps: DeathSystemDeps) {}

  install(world: World): void {
    this._world = world;
    world.addSystem(Update, {
      name: 'mc-death-system',
      queries: [{ with: [Entity, Health] }],
      resources: [],
      fn: (_w, qr) => {
        const batches = qr[0] as unknown as Batch[];
        const dead: EntityHandle[] = [];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            if (b.Health.isDead[i]) dead.push(b.Entity.self[i] as EntityHandle);
          }
        }
        for (const e of dead) this._killEntity(e);
      },
    });
  }

  private _killEntity(entity: EntityHandle): void {
    const world = this._world;
    // Skip if already gone (a splash + projectile could both flag the same frame).
    if (!world.get(entity, Transform).ok) return;

    // 0. combat:kill (on_death + on_kill triggers) — emitted BEFORE despawn so the
    //    victim's components are still readable by the TriggerSystem. killer = the
    //    last attributed attacker (0 = unattributed, e.g. self-kill / DoT).
    const victimId = entity as unknown as number;
    const killerId = lastAttacker.get(victimId) ?? 0;
    eventBus.emit('combat:kill', { killer: killerId, victim: victimId });
    lastAttacker.delete(victimId);

    // 1. selection + health-bar cleanup (drops id + despawns ring/bars) — before
    //    the unit despawns, so no ChildOf child dangles a reference to it.
    this.deps.selection?.notifyDespawned(entity);
    this.deps.healthBar?.notifyDespawned(entity);

    // 2. despawn ChildOf model parts (snapshot the forward list first).
    const ch = world.get(entity, Children);
    if (ch.ok) {
      const kids = ch.value.entities; // Uint32Array snapshot
      // Copy out before despawning (the snapshot is transient).
      const ids: number[] = [];
      for (let k = 0; k < kids.length; k++) ids.push(kids[k]);
      // Remove ChildOf from EVERY child BEFORE despawning the parent. Engine
      // despawns are batched to end-of-frame, so despawning the parent while a
      // child still holds ChildOf→parent leaves a 1-frame dangling reference
      // that `RenderSystem.draw (propagateTransforms)` flags as
      // `hierarchy-broken` (189 errors on a mass zerg death). Clearing ChildOf
      // first — exactly the engine's hint — guarantees no dangling link.
      for (const childId of ids) {
        const child = childId as unknown as EntityHandle;
        if (world.get(child, ChildOf).ok) world.removeComponent(child, ChildOf);
      }
      for (const childId of ids) {
        const child = childId as unknown as EntityHandle;
        if (world.get(child, Transform).ok) world.despawn(child);
      }
    }

    // 3. prune companion-Map side data.
    attackWeaponId.delete(entity);
    attackSplashFalloff.delete(entity);
    commandCurrent.delete(entity);
    commandQueue.delete(entity);
    renderableModelPath.delete(entity);
    unitTypeId.delete(entity);
    unitDisplayName.delete(entity);

    // 4. despawn the unit itself.
    world.despawn(entity);
  }
}
