/**
 * MarsCraft -> forgeax-engine — GarrisonSystem + CarrierUtils (M9 chunk 3)
 * =============================================================================
 * Port of `web/systems/GarrisonSystem.ts` + `web/systems/CarrierUtils.ts`.
 *
 * Load/unload units into transports & bunkers (any entity with a Transport
 * component). A loaded unit gets a `Garrisoned` component (so combat/healing
 * passives skip it — they already check Garrisoned), is hidden by moving it far
 * BELOW the field (the source hid the THREE mesh; forgeax has no per-entity mesh
 * toggle wired here, so off-field is the renderer-agnostic equivalent), its
 * command/movement cleared. On unload it is restored to an eject position around
 * the carrier (walkable-clamped for ground units) + re-shown.
 *
 * Per-frame: a carrier destroyed -> eject all (with crash damage); dead occupants
 * pruned; queued-unload mode drains one unit per `unloadInterval`.
 *
 * ⚠️ ECS rules: qr[0] is Batch[]; eject/despawn-side-effects collected then run
 * after the loop; Transport contents live in the `transportUnits` companion.
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Transport, Garrisoned, Health, Faction, Movement, Attack, Selectable, Building,
  MOVE_TYPE,
  transportUnits, transportUnloadQueue, commandCurrent, commandQueue, unitTypeId,
  type UnitCommand,
} from '../components';
import { getUnitDef } from '../data/units';
import type { SelectionHandle } from './selection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;
/** Off-field stash Y for hidden (garrisoned) units. */
const GARRISON_HIDE_Y = -1000;

// ── carrier callbacks (terrain / walkable clamp), injected ───────────────────
export interface CarrierCallbacks {
  getTerrainHeight: (x: number, z: number) => number;
  clampToWalkable: (x: number, z: number) => { x: number; z: number };
}

export interface GarrisonDeps {
  callbacks: CarrierCallbacks;
  /** Optional selection handle (deselect on load). */
  selection?: SelectionHandle;
}

export interface GarrisonHandle {
  loadUnit(unitEntity: EntityHandle, carrierEntity: EntityHandle): boolean;
  unloadUnit(unitEntity: EntityHandle, carrierEntity: EntityHandle): boolean;
  unloadAll(carrierEntity: EntityHandle): void;
  queueUnloadAll(carrierEntity: EntityHandle): void;
  probe(carrierEntity: EntityHandle): Record<string, unknown>;
}

/** Garrison size of a unit (slots consumed); default 1. */
function garrisonSizeOf(e: EntityHandle): number {
  const tid = unitTypeId.get(e);
  const def = tid ? getUnitDef(tid) : null;
  return def?.garrisonSize ?? 0;
}

export class GarrisonSystem implements GarrisonHandle {
  readonly name = 'GarrisonSystem';
  private _world!: World;
  private readonly _deps: GarrisonDeps;
  private _gameTime = 0;

  constructor(deps: GarrisonDeps) { this._deps = deps; }

  install(world: World): GarrisonHandle {
    this._world = world;
    world.addSystem(Update, {
      name: this.name,
      queries: [{ with: [Entity, Transport, Transform] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        this._gameTime += dt;

        const batches = qr[0] as unknown as Batch[];
        // Collect carriers whose occupants need attention; act after the loop.
        const ejectAll: EntityHandle[] = [];
        const drainQueue: EntityHandle[] = [];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const carrier = b.Entity.self[i] as EntityHandle;
            const units = transportUnits.get(carrier);
            if (!units || units.length === 0) continue;

            // carrier destroyed -> eject all + crash damage (after loop).
            const hr = world.get(carrier, Health);
            if (hr.ok && hr.value.hp <= 0) { ejectAll.push(carrier); continue; }

            // prune dead occupants.
            for (const u of [...units]) {
              if (!world.get(u, Transform).ok) this._removeFromCarrier(carrier, u);
            }

            // queued unload drain.
            const queue = transportUnloadQueue.get(carrier);
            if (queue && queue.length > 0) {
              let timer = b.Transport.unloadTimer[i] as number;
              if (timer > 0) { b.Transport.unloadTimer[i] = timer - dt; }
              else { drainQueue.push(carrier); }
            }
          }
        }
        for (const c of ejectAll) this._ejectAllOnDestroy(c);
        for (const c of drainQueue) this._processUnloadQueue(c);
      },
    });
    return this;
  }

  // ── load ──────────────────────────────────────────────────────────────────
  loadUnit(unitEntity: EntityHandle, carrierEntity: EntityHandle): boolean {
    const world = this._world;
    const tr = world.get(carrierEntity, Transport);
    if (!tr.ok) return false;
    const gSize = garrisonSizeOf(unitEntity);
    if (gSize <= 0) return false;
    if ((tr.value.usedSlots as number) + gSize > (tr.value.capacity as number)) return false;
    // same faction.
    const uf = world.get(unitEntity, Faction);
    const cf = world.get(carrierEntity, Faction);
    if (!uf.ok || !cf.ok || uf.value.playerId !== cf.value.playerId) return false;

    const units = transportUnits.get(carrierEntity) ?? [];
    if (units.includes(unitEntity)) return false;
    units.push(unitEntity);
    transportUnits.set(carrierEntity, units);
    world.set(carrierEntity, Transport, { usedSlots: tr.value.usedSlots + gSize });

    this._onUnitLoaded(unitEntity, carrierEntity, units.length - 1);
    return true;
  }

  unloadUnit(unitEntity: EntityHandle, carrierEntity: EntityHandle): boolean {
    const world = this._world;
    if (!world.get(carrierEntity, Transport).ok) return false;
    if (!this._removeFromCarrier(carrierEntity, unitEntity)) return false;
    return this._ejectUnit(unitEntity, carrierEntity);
  }

  unloadAll(carrierEntity: EntityHandle): void {
    const world = this._world;
    const units = transportUnits.get(carrierEntity);
    if (!units || units.length === 0) return;
    const ct = world.get(carrierEntity, Transform);
    if (!ct.ok) return;
    const building = world.get(carrierEntity, Building);
    const baseAngle = building.ok && building.value.hasRally
      ? Math.atan2(building.value.rallyZ - ct.value.pos[2], building.value.rallyX - ct.value.pos[0])
      : Math.random() * Math.PI * 2;
    const list = [...units];
    units.length = 0;
    transportUnits.set(carrierEntity, units);
    world.set(carrierEntity, Transport, { usedSlots: 0 });
    for (let i = 0; i < list.length; i++) {
      const pos = this._calcEjectPosition(ct.value.pos[0], ct.value.pos[2], list.length, i, baseAngle);
      if (!this._onUnitUnloaded(list[i], pos.x, pos.z)) continue;
      if (building.ok && building.value.hasRally) this._issueRallyCommand(list[i], carrierEntity);
    }
  }

  queueUnloadAll(carrierEntity: EntityHandle): void {
    const world = this._world;
    const units = transportUnits.get(carrierEntity);
    if (!units || units.length === 0) return;
    const queue = transportUnloadQueue.get(carrierEntity) ?? [];
    const wasEmpty = queue.length === 0;
    for (const u of units) if (!queue.includes(u)) queue.push(u);
    transportUnloadQueue.set(carrierEntity, queue);
    if (wasEmpty) world.set(carrierEntity, Transport, { unloadTimer: 0 });
  }

  // ── internals ───────────────────────────────────────────────────────────────
  private _removeFromCarrier(carrierEntity: EntityHandle, unitEntity: EntityHandle): boolean {
    const units = transportUnits.get(carrierEntity);
    if (!units) return false;
    const idx = units.indexOf(unitEntity);
    if (idx < 0) return false;
    units.splice(idx, 1);
    const gSize = garrisonSizeOf(unitEntity) || 1;
    const tr = this._world.get(carrierEntity, Transport);
    if (tr.ok) this._world.set(carrierEntity, Transport, { usedSlots: Math.max(0, tr.value.usedSlots - gSize) });
    const queue = transportUnloadQueue.get(carrierEntity);
    if (queue) { const qi = queue.indexOf(unitEntity); if (qi >= 0) queue.splice(qi, 1); }
    return true;
  }

  private _processUnloadQueue(carrierEntity: EntityHandle): void {
    const world = this._world;
    const queue = transportUnloadQueue.get(carrierEntity);
    const units = transportUnits.get(carrierEntity);
    if (!queue || !units) return;
    while (queue.length > 0) {
      const u = queue.shift()!;
      if (!world.get(u, Transform).ok || !units.includes(u)) continue;
      this._removeFromCarrier(carrierEntity, u);
      this._ejectUnit(u, carrierEntity);
      const tr = world.get(carrierEntity, Transport);
      if (tr.ok) world.set(carrierEntity, Transport, { unloadTimer: tr.value.unloadInterval });
      return;
    }
  }

  private _ejectUnit(unitEntity: EntityHandle, carrierEntity: EntityHandle): boolean {
    const world = this._world;
    if (!world.get(unitEntity, Transform).ok) return false;
    const ct = world.get(carrierEntity, Transform);
    if (!ct.ok) return false;
    const tr = world.get(carrierEntity, Transport);
    const ejectRadius = tr.ok ? tr.value.ejectRadius : 2.5;
    const building = world.get(carrierEntity, Building);
    const ejectAngle = building.ok && building.value.hasRally
      ? Math.atan2(building.value.rallyZ - ct.value.pos[2], building.value.rallyX - ct.value.pos[0])
      : Math.random() * Math.PI * 2;
    const ex = ct.value.pos[0] + Math.cos(ejectAngle) * ejectRadius;
    const ez = ct.value.pos[2] + Math.sin(ejectAngle) * ejectRadius;
    if (!this._onUnitUnloaded(unitEntity, ex, ez)) return false;
    if (building.ok && building.value.hasRally) this._issueRallyCommand(unitEntity, carrierEntity);
    return true;
  }

  private _ejectAllOnDestroy(carrierEntity: EntityHandle): void {
    const world = this._world;
    const units = transportUnits.get(carrierEntity);
    if (!units || units.length === 0) return;
    const ct = world.get(carrierEntity, Transform);
    if (!ct.ok) return;
    const tr = world.get(carrierEntity, Transport);
    const crashDmg = tr.ok ? tr.value.crashDamagePercent : 0;
    const building = world.get(carrierEntity, Building);
    const hasRally = building.ok && building.value.hasRally;
    const baseAngle = hasRally
      ? Math.atan2(building.value.rallyZ - ct.value.pos[2], building.value.rallyX - ct.value.pos[0])
      : Math.random() * Math.PI * 2;
    const list = [...units];
    units.length = 0;
    transportUnits.set(carrierEntity, units);
    if (tr.ok) world.set(carrierEntity, Transport, { usedSlots: 0 });
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!world.get(u, Transform).ok) continue;
      const pos = this._calcEjectPosition(ct.value.pos[0], ct.value.pos[2], list.length, i, baseAngle);
      this._onUnitUnloaded(u, pos.x, pos.z);
      if (crashDmg > 0) {
        const h = world.get(u, Health);
        if (h.ok && !h.value.isDead) {
          const dmg = Math.floor(h.value.maxHp * crashDmg);
          const hp = Math.max(0, h.value.hp - dmg);
          world.set(u, Health, { hp, isDead: hp <= 0, lastDamageTime: this._gameTime });
        }
      }
      if (hasRally) this._issueRallyCommand(u, carrierEntity);
    }
  }

  // ── CarrierUtils.onUnitLoaded / onUnitUnloaded (ported) ─────────────────────
  private _onUnitLoaded(unitEntity: EntityHandle, carrierEntity: EntityHandle, slotIndex: number): void {
    const world = this._world;
    commandCurrent.set(unitEntity, null);
    commandQueue.set(unitEntity, []);
    const mv = world.get(unitEntity, Movement);
    if (mv.ok) world.set(unitEntity, Movement, { hasTarget: false, arrived: true });
    if (!world.get(unitEntity, Garrisoned).ok) {
      world.addComponent(unitEntity, { component: Garrisoned, data: { carrierEntity: rawId(carrierEntity), slotIndex: Math.max(0, slotIndex) } });
    } else {
      world.set(unitEntity, Garrisoned, { carrierEntity: rawId(carrierEntity), slotIndex: Math.max(0, slotIndex) });
    }
    const sel = world.get(unitEntity, Selectable);
    if (sel.ok) world.set(unitEntity, Selectable, { selected: false });
    this._deps.selection?.notifyDespawned?.(unitEntity); // drop from selection + ring
    // hide: stash off-field (keep x/z for restore via the carrier eject path).
    const tr = world.get(unitEntity, Transform);
    if (tr.ok) world.set(unitEntity, Transform, { pos: [tr.value.pos[0], GARRISON_HIDE_Y, tr.value.pos[2]] });
  }

  private _onUnitUnloaded(unitEntity: EntityHandle, ejectX: number, ejectZ: number): boolean {
    const world = this._world;
    if (!world.get(unitEntity, Transform).ok) return false;
    if (world.get(unitEntity, Garrisoned).ok) world.removeComponent(unitEntity, Garrisoned);
    const at = world.get(unitEntity, Attack);
    if (at.ok) world.set(unitEntity, Attack, { targetEntity: -1, isAttacking: false });
    const mv = world.get(unitEntity, Movement);
    const isAir = mv.ok && mv.value.moveType === MOVE_TYPE.AIR;
    let fx = ejectX, fz = ejectZ;
    if (!isAir) { const safe = this._deps.callbacks.clampToWalkable(ejectX, ejectZ); fx = safe.x; fz = safe.z; }
    const y = this._deps.callbacks.getTerrainHeight(fx, fz);
    world.set(unitEntity, Transform, { pos: [fx, y + (isAir ? 1.5 : 0), fz] });
    return true;
  }

  private _calcEjectPosition(cx: number, cz: number, count: number, index: number, baseAngle: number, dist = 2.5): { x: number; z: number } {
    if (count <= 1) return { x: cx + Math.cos(baseAngle) * dist, z: cz + Math.sin(baseAngle) * dist };
    const angleSpread = Math.min(Math.PI * 1.5, count * 0.4);
    const startAngle = baseAngle - angleSpread / 2;
    const step = angleSpread / (count - 1);
    const angle = startAngle + step * index;
    return { x: cx + Math.cos(angle) * dist, z: cz + Math.sin(angle) * dist };
  }

  private _issueRallyCommand(unitEntity: EntityHandle, carrierEntity: EntityHandle): void {
    const world = this._world;
    const b = world.get(carrierEntity, Building);
    if (!b.ok) return;
    const spread = 1.5;
    const sa = Math.random() * Math.PI * 2;
    const sd = Math.random() * spread;
    const cmd: UnitCommand = b.value.rallyAttackEntity >= 0
      ? { type: 'attack', targetEntity: b.value.rallyAttackEntity, targetX: b.value.rallyX, targetZ: b.value.rallyZ }
      : { type: 'move', targetX: b.value.rallyX + Math.cos(sa) * sd, targetZ: b.value.rallyZ + Math.sin(sa) * sd };
    commandCurrent.set(unitEntity, cmd);
  }

  probe(carrierEntity: EntityHandle): Record<string, unknown> {
    const world = this._world;
    const tr = world.get(carrierEntity, Transport);
    const units = transportUnits.get(carrierEntity) ?? [];
    return {
      carrier: rawId(carrierEntity),
      capacity: tr.ok ? tr.value.capacity : null,
      usedSlots: tr.ok ? tr.value.usedSlots : null,
      loaded: units.map(rawId),
      queue: (transportUnloadQueue.get(carrierEntity) ?? []).map(rawId),
    };
  }
}
