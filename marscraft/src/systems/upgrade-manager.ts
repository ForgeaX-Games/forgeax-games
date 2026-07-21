/**
 * MarsCraft -> forgeax-engine — UpgradeManager (Milestone M9 chunk 2)
 * =============================================================================
 * Port of the Three.js source `web/systems/UpgradeManager.ts`. Owns the per-
 * player upgrade levels + the EFFECT logic (which UnitStats.upgrade* fields each
 * upgrade bumps for which unit category/typeId). Reconciles with the M8
 * BuildingSystem (which previously kept its own `_upgrades` map + a fixed-cost
 * research stub): the BuildingSystem now delegates research cost/time + level
 * storage here, so there is ONE SSOT for upgrade levels.
 *
 * ── how upgrades reach unit final stats ───────────────────────────────────────
 * The source UpgradeManager exposed `getAttackBonus/getArmorBonus/getRangeBonus`
 * which the StatModifierSystem queried PER UNIT every frame. forgeax has no ad-hoc
 * World query (only `world.addSystem`), and the forgeax StatModifierSystem reads
 * the PER-ENTITY `UnitStats.upgradeAttackBonus/upgradeArmorBonus/upgradeRangeBonus`
 * columns. So this manager installs its OWN per-frame system that writes those
 * columns onto every unit from its player's current level table (running BEFORE
 * StatModifierSystem, which then folds them into final* the same frame). This is
 * the exact same per-frame derivation the source did inside StatModifierSystem —
 * just relocated to its own pass, and idempotent (same input -> same columns).
 *
 * REAL upgrade effects (the source's three numeric bonuses):
 *   - infantry_weapons (level N) -> +N attack for infantry/worker units
 *   - vehicle_weapons  (level N) -> +N attack for vehicle units
 *   - infantry_armor   (level N) -> +N armor  for infantry/worker units
 *   - vehicle_armor    (level N) -> +N armor  for vehicle units
 *   - u238_shells      (level>0) -> +1 grid (= RANGE_SCALE world) range for marine
 * Every other upgrade in the table is an ABILITY/FORM UNLOCK (stim_pack, blink,
 * siege_mode, ...) — those have no UnitStats bonus; their gameplay effect is the
 * ability/form they enable (requiredUpgrade gating is a remaining M9 seam). Their
 * cost/time/level are still tracked (research spends + level rises), which is the
 * verification target for unlock-style upgrades.
 *
 * ⚠️ ECS rules: qr[0] is Batch[] — iterate; this system only writes UnitStats
 * columns in place (no world.spawn/despawn).
 */

import { Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Faction, UnitType, UnitStats, unitTypeId,
  UNIT_CATEGORY,
} from '../components';
import { getUpgradeDef } from '../data/upgrades';
import { RANGE_SCALE } from '../data/weapons';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/** Per-player upgrade levels (source `PlayerUpgradeLevels`). */
export type PlayerUpgradeLevels = Record<string, number>;

export interface UpgradeManagerHandle {
  getLevel(playerId: number, upgradeId: string): number;
  getAll(playerId: number): PlayerUpgradeLevels;
  canResearch(playerId: number, upgradeId: string): boolean;
  nextResearch(playerId: number, upgradeId: string): { mineral: number; gas: number; time: number; level: number } | null;
  setLevel(playerId: number, upgradeId: string, level: number): void;
  /** Bump to next level + (the per-frame system re-applies columns). Returns new level. */
  completeUpgrade(playerId: number, upgradeId: string): number;
}

export class UpgradeManager implements UpgradeManagerHandle {
  readonly name = 'mc-upgrade-manager';
  private _world!: World;
  /** Per-player upgrade levels (source `_upgrades`). */
  private readonly _upgrades = new Map<number, PlayerUpgradeLevels>();

  /**
   * Install the per-frame upgrade-apply system. Must be installed BEFORE the
   * StatModifierSystem (which folds the upgrade* columns into final* the same
   * frame). Returns the handle (level queries + research cost + completion).
   */
  install(world: World): UpgradeManagerHandle {
    this._world = world;
    world.addSystem(Update, {
      name: this.name,
      queries: [{ with: [Entity, Faction, UnitType, UnitStats] }],
      resources: [],
      fn: (_w, qr) => {
        const batches = qr[0] as unknown as Batch[];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const playerId = b.Faction.playerId[i] as number;
            const levels = this._upgrades.get(playerId);
            // No upgrades for this player -> columns stay 0 (StatMod already
            // defaults them); skip writes to keep the common case cheap.
            if (!levels) continue;
            const cat = b.UnitType.category[i] as number;
            const e = b.Entity.self[i] as EntityHandle;
            const s = b.UnitStats;
            s.upgradeAttackBonus[i] = this._attackBonus(levels, cat);
            s.upgradeArmorBonus[i] = this._armorBonus(levels, cat);
            s.upgradeRangeBonus[i] = this._rangeBonus(levels, unitTypeId.get(e));
          }
        }
      },
    });
    return this;
  }

  // ==========================================================================
  // Level management (source setLevel / getLevel / getAll)
  // ==========================================================================

  setLevel(playerId: number, upgradeId: string, level: number): void {
    let m = this._upgrades.get(playerId);
    if (!m) { m = {}; this._upgrades.set(playerId, m); }
    m[upgradeId] = level;
  }

  getLevel(playerId: number, upgradeId: string): number {
    return this._upgrades.get(playerId)?.[upgradeId] ?? 0;
  }

  getAll(playerId: number): PlayerUpgradeLevels {
    return this._upgrades.get(playerId) ?? {};
  }

  /**
   * Bump `upgradeId` to the next level for `playerId` (capped at maxLevel). The
   * per-frame system applies the new columns next frame. Returns the new level.
   */
  completeUpgrade(playerId: number, upgradeId: string): number {
    const def = getUpgradeDef(upgradeId);
    const cur = this.getLevel(playerId, upgradeId);
    const max = def?.maxLevel ?? 1;
    const next = Math.min(max, cur + 1);
    this.setLevel(playerId, upgradeId, next);
    return next;
  }

  // ==========================================================================
  // Cost / research (used by the building production queue)
  // ==========================================================================

  /**
   * Cost + time for researching the NEXT level of `upgradeId` for `playerId`.
   * Returns null if unknown or already maxed.
   */
  nextResearch(playerId: number, upgradeId: string): { mineral: number; gas: number; time: number; level: number } | null {
    const def = getUpgradeDef(upgradeId);
    if (!def) return null;
    const cur = this.getLevel(playerId, upgradeId);
    if (cur >= def.maxLevel) return null;
    return {
      mineral: def.mineralCostPerLevel,
      gas: def.gasCostPerLevel,
      time: def.researchTimePerLevel,
      level: cur + 1,
    };
  }

  canResearch(playerId: number, upgradeId: string): boolean {
    const def = getUpgradeDef(upgradeId);
    if (!def) return false;
    return this.getLevel(playerId, upgradeId) < def.maxLevel;
  }

  // ==========================================================================
  // Bonus computation (source getAttackBonus / getArmorBonus / getRangeBonus)
  // ==========================================================================

  private _attackBonus(levels: PlayerUpgradeLevels, categoryCode: number): number {
    if (categoryCode === UNIT_CATEGORY.INFANTRY || categoryCode === UNIT_CATEGORY.WORKER) {
      return levels['infantry_weapons'] ?? 0;
    }
    if (categoryCode === UNIT_CATEGORY.VEHICLE) {
      return levels['vehicle_weapons'] ?? 0;
    }
    return 0;
  }

  private _armorBonus(levels: PlayerUpgradeLevels, categoryCode: number): number {
    if (categoryCode === UNIT_CATEGORY.INFANTRY || categoryCode === UNIT_CATEGORY.WORKER) {
      return levels['infantry_armor'] ?? 0;
    }
    if (categoryCode === UNIT_CATEGORY.VEHICLE) {
      return levels['vehicle_armor'] ?? 0;
    }
    return 0;
  }

  private _rangeBonus(levels: PlayerUpgradeLevels, typeId: string | undefined): number {
    if (typeId === 'marine' && (levels['u238_shells'] ?? 0) > 0) return RANGE_SCALE;
    return 0;
  }
}
