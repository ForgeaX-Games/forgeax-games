/**
 * MarsCraft -> forgeax-engine — UnitMorphSystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of the Three.js source `web/systems/UnitMorphSystem.ts`. Handles
 * UNIT-level timed morphs (Zergling -> Baneling, Hydralisk -> Lurker, ...). A
 * morph: charges the cost (morphCost, or the unit-cost diff), shows an egg model,
 * progresses a timer, then on complete swaps the entity's typeId + Health /
 * Movement / Attack / UnitType / Energy / Abilities to the target def and
 * rebuilds the model. Cancel refunds 75%.
 *
 * `startMorph(entity, targetTypeId)` is the public entry. The M9 ch1 effect-
 * executor `morph` seam + the larva morph path wire to it (in main.ts). Building
 * morph (Hatchery->Lair) is the BuildingSystem's `morphProgress`/`morphTime`
 * seam and is OUT of scope for unit-morph (it transforms a Building, not a unit);
 * left as a seam.
 *
 * ── forgeax adaptation vs the source class ────────────────────────────────────
 *   - Morph progress lives in this system's own `_morphing` Map<rawId, data>
 *     (the source kept the same; M2's Larva.morphProgress is for larva-hatch, a
 *     different path). A per-frame ECS system advances every active morph; on
 *     completion it COLLECTS the entity and applies the swap AFTER the loop
 *     (model rebuild despawns/spawns child entities — never mid query-iteration).
 *   - `world.isAlive(e)` -> `world.get(e, Transform).ok`.
 *   - typeId / displayName live in the M2 Map companions; the SoA columns
 *     (UnitType.category/combat/race/vision, Health, Movement, Attack, Energy)
 *     are written via world.set. `getAbilitiesForUnit` reseeds abilityIds.
 *   - EventBus / i18n UI errors dropped (HUD = M12); console.warn on reject.
 *
 * ⚠️ ECS rules: qr[0] is Batch[] — iterate; collect-then-mutate (the model
 * rebuild + the swap run AFTER the batch loop).
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  UnitType, Health, Movement, Attack, Energy, Faction, UnitStats,
  unitTypeId, unitDisplayName, attackWeaponId, attackSplashFalloff, abilityIds,
  abilityActivatedPassives,
  MOVE_TYPE, COMBAT_TYPE, UNIT_CATEGORY, UNIT_SIZE, RACE,
} from '../components';
import { getUnitDef, type UnitDef, type CombatType, type UnitCategory, type UnitSize, type RaceType } from '../data/units';
import { getWeaponDef } from '../data/weapons';
import { getAbilitiesForUnit } from '../data/abilities';
import type { ResourceManager } from './resource-manager';
import { rebuildUnitModel, type ModelRebuildDeps } from './form-switch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const COMBAT_CODE: Record<CombatType, number> = {
  bio: COMBAT_TYPE.BIO, armored: COMBAT_TYPE.ARMORED, psionic: COMBAT_TYPE.PSIONIC,
  void: COMBAT_TYPE.VOID, structure: COMBAT_TYPE.STRUCTURE,
};
const CATEGORY_CODE: Record<UnitCategory, number> = {
  worker: UNIT_CATEGORY.WORKER, infantry: UNIT_CATEGORY.INFANTRY,
  vehicle: UNIT_CATEGORY.VEHICLE, building: UNIT_CATEGORY.BUILDING,
};
const SIZE_CODE: Record<UnitSize, number> = {
  small: UNIT_SIZE.SMALL, medium: UNIT_SIZE.MEDIUM, large: UNIT_SIZE.LARGE,
};
const RACE_CODE: Record<RaceType, number> = { terran: RACE.TERRAN, protoss: RACE.PROTOSS, zerg: RACE.ZERG };

interface MorphingData {
  targetTypeId: string;
  targetDef: UnitDef;
  morphTime: number;
  morphProgress: number;
  originalTypeId: string;
  paidMineral: number;
  paidGas: number;
}

export interface UnitMorphHandle {
  /** Begin morphing `entity` into `targetTypeId` (charges cost). */
  startMorph(entity: EntityHandle, targetTypeId: string): boolean;
  /** Cancel an in-progress morph (refund 75%). */
  cancelMorph(entity: EntityHandle): boolean;
  isMorphing(entity: EntityHandle): boolean;
  morphProgress(entity: EntityHandle): number;
}

export interface UnitMorphDeps {
  resourceManager: ResourceManager;
  model: ModelRebuildDeps;
  /** Debug/build-speed multiplier (default 1). */
  speedMultiplier?: number;
}

export class UnitMorphSystem implements UnitMorphHandle {
  private _world!: World;
  private readonly _rm: ResourceManager;
  private readonly _model: ModelRebuildDeps;
  private readonly _speed: number;
  private readonly _morphing = new Map<number, MorphingData>();

  constructor(deps: UnitMorphDeps) {
    this._rm = deps.resourceManager;
    this._model = deps.model;
    this._speed = deps.speedMultiplier ?? 1;
  }

  install(world: World): UnitMorphHandle {
    this._world = world;
    world.addSystem(Update, {
      name: 'mc-unit-morph',
      queries: [{ with: [Entity, Transform] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        if (this._morphing.size === 0) return;
        const dt = (world.getResource<{ dt: number }>('Time')?.dt ?? 0) * this._speed;
        if (dt <= 0) return;

        const toComplete: EntityHandle[] = [];
        // advance every active morph (the query is just to keep the system on the
        // frame loop; we iterate the morph Map directly — it's small).
        for (const [raw, data] of this._morphing) {
          const e = raw as unknown as EntityHandle;
          if (!world.get(e, Transform).ok) { this._morphing.delete(raw); continue; }
          // morphing units can't move
          const mv = world.get(e, Movement);
          if (mv.ok) world.set(e, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
          data.morphProgress += dt / data.morphTime;
          if (data.morphProgress >= 1) toComplete.push(e);
        }
        // collect-then-mutate: complete AFTER the loop (model rebuild despawns/
        // spawns child entities).
        for (const e of toComplete) this._completeMorph(e);
        void (qr[0]);
      },
    });
    return this;
  }

  isMorphing(entity: EntityHandle): boolean {
    return this._morphing.has(entity as unknown as number);
  }

  morphProgress(entity: EntityHandle): number {
    return this._morphing.get(entity as unknown as number)?.morphProgress ?? 0;
  }

  startMorph(entity: EntityHandle, targetTypeId: string): boolean {
    const world = this._world;
    const raw = entity as unknown as number;
    if (this._morphing.has(raw)) { console.warn('[marscraft][morph] already morphing'); return false; }

    const ut = world.get(entity, UnitType);
    const fac = world.get(entity, Faction);
    if (!ut.ok || !fac.ok) return false;

    const sourceTypeId = unitTypeId.get(entity);
    const sourceDef = sourceTypeId ? getUnitDef(sourceTypeId) : undefined;
    const targetDef = getUnitDef(targetTypeId);
    if (!sourceDef || !targetDef) return false;

    if (!sourceDef.canMorphTo?.includes(targetTypeId)) {
      console.warn(`[marscraft][morph] ${sourceTypeId} cannot morph to ${targetTypeId}`);
      return false;
    }

    // cost: morphCost (fixed extra) or the unit-cost diff (source formula).
    const mineralCost = targetDef.morphCost ? targetDef.morphCost.mineral : Math.max(0, targetDef.mineralCost - sourceDef.mineralCost);
    const gasCost = targetDef.morphCost ? targetDef.morphCost.gas : Math.max(0, targetDef.gasCost - sourceDef.gasCost);
    const supplyDiff = Math.max(0, (targetDef.supplyCost ?? 0) - (sourceDef.supplyCost ?? 0));

    if (!this._rm.canAfford(fac.value.playerId, mineralCost, gasCost, supplyDiff)) {
      console.warn('[marscraft][morph] insufficient resources');
      return false;
    }
    this._rm.spend(fac.value.playerId, mineralCost, gasCost, supplyDiff);

    const morphTime = targetDef.buildTime || 12;
    this._morphing.set(raw, {
      targetTypeId, targetDef, morphTime, morphProgress: 0,
      originalTypeId: sourceTypeId!, paidMineral: mineralCost, paidGas: gasCost,
    });

    // stop movement / attack
    const mv = world.get(entity, Movement);
    if (mv.ok) world.set(entity, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
    const at = world.get(entity, Attack);
    if (at.ok) world.set(entity, Attack, { isAttacking: false, targetEntity: -1 });

    // egg model during morph (SC2: ground units morph in an egg).
    if (sourceDef.isGround) {
      rebuildUnitModel(world, this._model, entity, 'egg', targetDef.modelSize ?? sourceDef.modelSize, sourceDef);
    }

    return true;
  }

  cancelMorph(entity: EntityHandle): boolean {
    const world = this._world;
    const raw = entity as unknown as number;
    const data = this._morphing.get(raw);
    if (!data) return false;

    const fac = world.get(entity, Faction);
    if (fac.ok) {
      this._rm.addMinerals(fac.value.playerId, Math.floor(data.paidMineral * 0.75));
      this._rm.addGas(fac.value.playerId, Math.floor(data.paidGas * 0.75));
      const sourceDef = getUnitDef(data.originalTypeId);
      const supplyDiff = (data.targetDef.supplyCost ?? 0) - (sourceDef?.supplyCost ?? 0);
      if (supplyDiff > 0) this._rm.removeSupply(fac.value.playerId, supplyDiff);
    }
    // restore the original model.
    const sourceDef = getUnitDef(data.originalTypeId);
    if (sourceDef) rebuildUnitModel(world, this._model, entity, data.originalTypeId, sourceDef.modelSize, sourceDef);
    this._morphing.delete(raw);
    return true;
  }

  // ── completion (source _completeMorph) ────────────────────────────────────────
  private _completeMorph(entity: EntityHandle): void {
    const world = this._world;
    const raw = entity as unknown as number;
    const data = this._morphing.get(raw);
    if (!data) return;
    const target = data.targetDef;

    // UnitType (+ companions)
    const ut = world.get(entity, UnitType);
    if (ut.ok) {
      world.set(entity, UnitType, {
        category: CATEGORY_CODE[target.category], unitSize: SIZE_CODE[target.unitSize],
        combatType: COMBAT_CODE[target.combatType], race: RACE_CODE[target.race],
        visionRange: target.visionRange, baseVisionRange: target.visionRange,
      });
    }
    unitTypeId.set(entity, target.typeId);
    unitDisplayName.set(entity, target.displayName);

    // Health — SC2: full hp on morph complete.
    const hr = world.get(entity, Health);
    if (hr.ok) {
      world.set(entity, Health, {
        maxHp: target.hp, hp: target.hp, armor: target.armor,
        maxShield: target.shield, shield: target.shield, shieldArmor: target.shieldArmor,
      });
    }

    // Movement
    const mv = world.get(entity, Movement);
    if (mv.ok) {
      world.set(entity, Movement, {
        speed: target.speed, turnRate: target.turnRate,
        moveType: target.isGround ? MOVE_TYPE.GROUND : MOVE_TYPE.AIR,
      });
    }

    // Attack
    if (target.weaponId) {
      const wdef = getWeaponDef(target.weaponId);
      if (wdef) {
        attackWeaponId.set(entity, target.weaponId);
        attackSplashFalloff.set(entity, [...wdef.splashFalloff]);
        const at = world.get(entity, Attack);
        const adata = {
          damage: wdef.damage, damageCount: wdef.damageCount, damageType: wdef.damageType === 'spell' ? 1 : 0,
          range: wdef.range, cooldown: wdef.cooldown,
          projectileType: wdef.projectileType === 'bullet' ? 1 : wdef.projectileType === 'missile' ? 2 : wdef.projectileType === 'bounce' ? 3 : 0,
          projectileSpeed: wdef.projectileSpeed, canAttackAir: wdef.canAttackAir, canAttackGround: wdef.canAttackGround,
          splashRadius: wdef.splashRadius, splashShape: wdef.splashShape === 'cone' ? 1 : wdef.splashShape === 'line' ? 2 : 0,
          splashAngle: wdef.splashAngle, splashWidth: wdef.splashWidth,
          bounceCount: wdef.bounceCount, bounceDamageDecay: wdef.bounceDamageDecay, leashDistance: wdef.leashDistance,
        };
        if (at.ok) world.set(entity, Attack, adata);
        else world.addComponent(entity, { component: Attack, data: adata });
      }
    }

    // Energy (target may have an energy pool the source unit lacked)
    if (target.energyMax && target.energyMax > 0) {
      const en = world.get(entity, Energy);
      if (en.ok) {
        world.set(entity, Energy, {
          maxEnergy: target.energyMax, regenRate: target.energyRegen ?? 0.5625,
          energy: Math.min(en.value.energy, target.energyMax),
        });
      } else {
        world.addComponent(entity, {
          component: Energy,
          data: { energy: target.energyMax * (target.energyStartPercent ?? 0.25), maxEnergy: target.energyMax, regenRate: target.energyRegen ?? 0.5625, startPercent: target.energyStartPercent ?? 0.25 },
        });
      }
    }

    // Abilities (target may have a different list)
    const newAbilities = getAbilitiesForUnit(target.typeId).map((a) => a.id);
    abilityIds.set(entity, newAbilities);
    abilityActivatedPassives.get(entity)?.clear();

    // UnitStats base values reflect the new unit (StatMod re-derives finals).
    this._reseedStats(entity, target);

    // Model swap to the target.
    rebuildUnitModel(world, this._model, entity, target.typeId, target.modelSize, target);

    this._morphing.delete(raw);
  }

  private _reseedStats(entity: EntityHandle, target: UnitDef): void {
    // Every unit carries UnitStats via the factory; re-seed its base columns so
    // StatModifierSystem re-derives the new unit's final stats next frame.
    if (!this._world.get(entity, UnitStats).ok) return;
    const wdef = target.weaponId ? getWeaponDef(target.weaponId) : undefined;
    this._world.set(entity, UnitStats, {
      baseMaxHp: target.hp, baseMaxShield: target.shield, baseMaxEnergy: target.energyMax ?? 0,
      baseArmor: target.armor, baseShieldArmor: target.shieldArmor,
      baseDamage: wdef ? wdef.damage : 0, baseAttackCooldown: wdef ? wdef.cooldown : 1,
      baseRange: wdef ? wdef.range : 0, baseMoveSpeed: target.speed, baseTurnRate: target.turnRate,
      baseVisionRange: target.visionRange, baseSplashRadius: wdef ? wdef.splashRadius : 0,
      baseEnergyRegen: target.energyRegen ?? 0.5625, baseShieldRegen: target.shield > 0 ? 2.0 : 0,
    });
  }
}
