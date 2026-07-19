/**
 * MarsCraft -> forgeax-engine — ResourceManager port (Milestone M7)
 * =============================================================================
 * Port of the Three.js source `web/systems/ResourceManager.ts`. Per-player
 * mineral / gas / supply balances with the SC1-style spend / canAfford / refund
 * API. This is plain game state (no ECS components / systems): the HarvestSystem
 * deposits into it, building / unit production (M8) will spend from it, and the
 * HUD (M12) reads it.
 *
 * ── ECS adaptation ───────────────────────────────────────────────────────────
 * The source emitted EventBus `resource:changed` / `supply:changed` events for
 * its UI. forgeax has no EventBus port yet (the HUD lands in M12), so this port
 * drops the event emission and exposes the balances directly via `getResources`
 * — the M12 HUD will poll them. The numeric balance logic is otherwise 1:1.
 *
 * The income-rate tracking (minerals/gas per minute, used only by the source UI)
 * is kept verbatim — `updateRates` ticks it; the HarvestSystem records income via
 * `addMinerals` / `addGas` exactly as the source did.
 */

/** Per-player resource balances (source PlayerResources). */
export interface PlayerResources {
  minerals: number;
  gas: number;
  /** Current used supply (population). */
  supply: number;
  /** Supply cap. */
  supplyMax: number;
}

/** Total supply cap (source MAX_SUPPLY_CAP). */
export const MAX_SUPPLY_CAP = 240;
/** Starting minerals (source INITIAL_MINERALS). */
export const INITIAL_MINERALS = 200;
/** Starting gas (source INITIAL_GAS). */
export const INITIAL_GAS = 0;

interface IncomeTracker {
  total: number;
  lastCheck: number;
  rate: number;
}

/** A clock source (ms). Defaults to performance.now where available. */
function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export class ResourceManager {
  private _resources = new Map<number, PlayerResources>();
  private _mineralIncome = new Map<number, IncomeTracker>();
  private _gasIncome = new Map<number, IncomeTracker>();

  /** Initialise a player's resources (source initPlayer). */
  initPlayer(playerId: number, minerals = INITIAL_MINERALS, gas = INITIAL_GAS, supplyMax = 0): void {
    this._resources.set(playerId, { minerals, gas, supply: 0, supplyMax });
    this._mineralIncome.set(playerId, { total: 0, lastCheck: nowMs(), rate: 0 });
    this._gasIncome.set(playerId, { total: 0, lastCheck: nowMs(), rate: 0 });
  }

  /** Ensure a player exists (lazy init, e.g. enemy AI workers in the verify hook). */
  ensurePlayer(playerId: number): PlayerResources {
    let res = this._resources.get(playerId);
    if (!res) {
      this.initPlayer(playerId);
      res = this._resources.get(playerId)!;
    }
    return res;
  }

  /** Read-only balances for a player (undefined if uninitialised). */
  getResources(playerId: number): PlayerResources | undefined {
    return this._resources.get(playerId);
  }

  /** Add minerals (source addMinerals) — the harvest deposit path. */
  addMinerals(playerId: number, amount: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.minerals += amount;
    const income = this._mineralIncome.get(playerId);
    if (income) income.total += amount;
  }

  /** Add gas (source addGas) — the harvest deposit path. */
  addGas(playerId: number, amount: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.gas += amount;
    const income = this._gasIncome.get(playerId);
    if (income) income.total += amount;
  }

  /** Spend minerals + gas + supply (source spend). Returns false if unaffordable. */
  spend(playerId: number, minerals: number, gas: number, supply: number): boolean {
    const res = this._resources.get(playerId);
    if (!res) return false;
    if (!this.canAfford(playerId, minerals, gas, supply)) return false;
    res.minerals -= minerals;
    res.gas -= gas;
    res.supply += supply;
    return true;
  }

  /** Affordability check (source canAfford; supply===0 skips the cap check). */
  canAfford(playerId: number, minerals: number, gas: number, supply: number): boolean {
    const res = this._resources.get(playerId);
    if (!res) return false;
    const supplyOk = supply === 0 || res.supply + supply <= res.supplyMax;
    return res.minerals >= minerals && res.gas >= gas && supplyOk;
  }

  /** Refund a cancelled build/unit (minerals + gas back, supply freed). */
  refund(playerId: number, minerals: number, gas: number, supply: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.minerals += minerals;
    res.gas += gas;
    res.supply = Math.max(0, res.supply - supply);
  }

  /** Increase used supply (source addSupply). */
  addSupply(playerId: number, amount: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.supply += amount;
  }

  /** Decrease used supply on unit death (source removeSupply). */
  removeSupply(playerId: number, amount: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.supply = Math.max(0, res.supply - amount);
  }

  /** Raise the supply cap (source addSupplyMax; clamped to MAX_SUPPLY_CAP). */
  addSupplyMax(playerId: number, amount: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.supplyMax = Math.min(MAX_SUPPLY_CAP, res.supplyMax + amount);
  }

  /** Lower the supply cap when a depot is destroyed (source removeSupplyMax). */
  removeSupplyMax(playerId: number, amount: number): void {
    const res = this._resources.get(playerId);
    if (!res) return;
    res.supplyMax = Math.max(0, res.supplyMax - amount);
  }

  /** Mineral income (per minute) for the HUD (source getMineralRate). */
  getMineralRate(playerId: number): number {
    return this._mineralIncome.get(playerId)?.rate ?? 0;
  }

  /** Gas income (per minute) for the HUD (source getGasRate). */
  getGasRate(playerId: number): number {
    return this._gasIncome.get(playerId)?.rate ?? 0;
  }

  /** Recompute income rates (source updateRates; every ~5s of wall time). */
  updateRates(): void {
    const now = nowMs();
    const tick = (map: Map<number, IncomeTracker>) => {
      for (const income of map.values()) {
        const elapsed = (now - income.lastCheck) / 1000;
        if (elapsed >= 5) {
          income.rate = Math.round((income.total / elapsed) * 60);
          income.total = 0;
          income.lastCheck = now;
        }
      }
    };
    tick(this._mineralIncome);
    tick(this._gasIncome);
  }
}
