/**
 * MarsCraft -> forgeax-engine — VictorySystem (M19 UI port)
 * =============================================================================
 * Win/lose detection + end-of-match stats, driving the GameOverScreen. Faithful
 * to the Three.js source `main.ts._checkGameOver`: count living BUILDINGS per
 * player each (throttled) tick; a player who once HAD buildings and now has ZERO
 * is defeated, the other player wins. The local player (PLAYER_ID.PLAYER) sees
 * VICTORY when the enemy is eliminated, DEFEAT when eliminated.
 *
 * Stats (source `GameStats`): unitsKilled / unitsLost from the `combat:kill` bus
 * event (resolve killer/victim Faction → playerId); unitsProduced = distinct unit
 * ids ever owned (accumulated from the per-tick unit scan). Game time from the
 * `Time` resource. Fires the GameOverScreen exactly once.
 *
 * ⚠️ ECS: qr[N] is Batch[]; read-only counting (no spawn/despawn); `world.get().ok`.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Building, Health, Faction, UnitType, PLAYER_ID } from '../components';
import { eventBus } from '../core/event-bus';
import type { GameOverHandle, PlayerGameStats } from '../ui/game-over';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;
const CHECK_INTERVAL = 1.0; // seconds between win/lose scans (cheap, vision-like cadence)

interface Tally { killed: number; lost: number; }

export interface VictoryDeps {
  ui: GameOverHandle;
  /** Display names for the two sides. */
  localName?: string;
  enemyName?: string;
}

export interface VictoryHandle {
  /** {resolved, isVictory?, reason?, playerBuildings, enemyBuildings, ...stats} for verify. */
  probe(): Record<string, unknown>;
  /** Force a win/lose re-check now (verify aid). */
  check(): void;
}

export class VictorySystem implements VictoryHandle {
  readonly name = 'VictorySystem';
  private _world!: World;
  private readonly _deps: VictoryDeps;
  private _timer = 0;
  private _gameTime = 0;
  private _resolved = false;
  private _isVictory = false;
  private _reason = '';
  private _everHad = new Map<number, boolean>();
  private _lastCount = new Map<number, number>();
  private readonly _tally = new Map<number, Tally>();
  private readonly _seenUnits = new Map<number, Set<number>>(); // playerId -> unit ids ever owned

  constructor(deps: VictoryDeps) { this._deps = deps; }

  private _tallyOf(pid: number): Tally {
    let t = this._tally.get(pid);
    if (!t) { t = { killed: 0, lost: 0 }; this._tally.set(pid, t); }
    return t;
  }

  install(world: World): VictoryHandle {
    this._world = world;

    // combat:kill → tally kills/losses by the involved players' factions.
    eventBus.on('combat:kill', (d) => {
      if (this._resolved) return;
      const kf = world.get(d.killer as unknown as EntityHandle, Faction);
      const vf = world.get(d.victim as unknown as EntityHandle, Faction);
      if (vf.ok) this._tallyOf(vf.value.playerId).lost++;
      if (kf.ok && kf.value.playerId !== 99) this._tallyOf(kf.value.playerId).killed++;
    });

    world.addSystem({
      name: this.name,
      queries: [
        { with: [Entity, Building, Faction, Health] },  // buildings (win condition)
        { with: [Entity, UnitType, Faction] },          // units (produced tally)
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0 || this._resolved) return;
        this._gameTime += dt;

        // accumulate "units ever produced" per player from the live unit scan.
        for (const b of (qr[1] as unknown as Batch[])) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const pid = b.Faction.playerId[i] as number;
            if (pid === 99) continue;
            let set = this._seenUnits.get(pid);
            if (!set) { set = new Set<number>(); this._seenUnits.set(pid, set); }
            set.add(rawId(b.Entity.self[i] as EntityHandle));
          }
        }

        this._timer += dt;
        if (this._timer < CHECK_INTERVAL) return;
        this._timer = 0;
        this._scan(qr[0] as unknown as Batch[]);
      },
    });

    // Seed `everHad` from the buildings present NOW — bootstrap spawns both bases
    // before this install, so both sides register as "had buildings" immediately.
    // Without this, an elimination before the first throttled scan wouldn't resolve
    // (the everHad guard would still be unset).
    for (let raw = 0; raw < 9000; raw++) {
      const e = raw as unknown as EntityHandle;
      const bd = world.get(e, Building);
      if (!bd.ok) continue;
      const h = world.get(e, Health);
      if (h.ok && h.value.isDead) continue;
      const f = world.get(e, Faction);
      if (f.ok && f.value.playerId !== 99) this._everHad.set(f.value.playerId, true);
    }
    return this;
  }

  /** Count living buildings per player + resolve win/lose (source _checkGameOver). */
  private _scan(buildingBatches: Batch[]): void {
    const count = new Map<number, number>();
    for (const b of buildingBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        if (b.Health.isDead[i]) continue;
        const pid = b.Faction.playerId[i] as number;
        if (pid === 99) continue;
        count.set(pid, (count.get(pid) ?? 0) + 1);
      }
    }
    this._lastCount = count;
    for (const pid of [PLAYER_ID.PLAYER, PLAYER_ID.ENEMY]) {
      const c = count.get(pid) ?? 0;
      if (c > 0) this._everHad.set(pid, true);
      // a player that once had buildings and now has none is defeated.
      if (c === 0 && this._everHad.get(pid)) {
        const winner = pid === PLAYER_ID.PLAYER ? PLAYER_ID.ENEMY : PLAYER_ID.PLAYER;
        this._resolve(winner);
        return;
      }
    }
  }

  private _resolve(winner: number): void {
    if (this._resolved) return;
    this._resolved = true;
    this._isVictory = winner === PLAYER_ID.PLAYER;
    this._reason = this._isVictory ? 'Enemy base eliminated' : 'Your base was eliminated';
    this._deps.ui.show({
      isVictory: this._isVictory,
      reason: this._reason,
      gameTime: this._fmtTime(),
      local: this._statsFor(PLAYER_ID.PLAYER, this._deps.localName ?? 'You'),
      enemy: this._statsFor(PLAYER_ID.ENEMY, this._deps.enemyName ?? 'Enemy'),
    });
  }

  private _statsFor(pid: number, name: string): PlayerGameStats {
    const t = this._tally.get(pid);
    return {
      name,
      unitsKilled: t?.killed ?? 0,
      unitsLost: t?.lost ?? 0,
      unitsProduced: this._seenUnits.get(pid)?.size ?? 0,
    };
  }

  private _fmtTime(): string {
    const s = Math.floor(this._gameTime);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  probe(): Record<string, unknown> {
    return {
      resolved: this._resolved,
      isVictory: this._resolved ? this._isVictory : null,
      reason: this._resolved ? this._reason : null,
      playerBuildings: this._lastCount.get(PLAYER_ID.PLAYER) ?? 0,
      enemyBuildings: this._lastCount.get(PLAYER_ID.ENEMY) ?? 0,
      playerKills: this._tally.get(PLAYER_ID.PLAYER)?.killed ?? 0,
      playerLosses: this._tally.get(PLAYER_ID.PLAYER)?.lost ?? 0,
      gameTime: this._fmtTime(),
    };
  }

  check(): void {
    if (this._resolved || !this._world) return;
    // one-off manual scan over a fresh building snapshot (verify aid).
    const counts = new Map<number, number>();
    for (let raw = 0; raw < 9000; raw++) {
      const e = raw as unknown as EntityHandle;
      const bd = this._world.get(e, Building);
      if (!bd.ok) continue;
      const h = this._world.get(e, Health);
      if (h.ok && h.value.isDead) continue;
      const f = this._world.get(e, Faction);
      if (!f.ok || f.value.playerId === 99) continue;
      counts.set(f.value.playerId, (counts.get(f.value.playerId) ?? 0) + 1);
    }
    this._lastCount = counts;
    for (const pid of [PLAYER_ID.PLAYER, PLAYER_ID.ENEMY]) {
      const c = counts.get(pid) ?? 0;
      if (c > 0) this._everHad.set(pid, true);
      if (c === 0 && this._everHad.get(pid)) { this._resolve(pid === PLAYER_ID.PLAYER ? PLAYER_ID.ENEMY : PLAYER_ID.PLAYER); return; }
    }
  }
}
