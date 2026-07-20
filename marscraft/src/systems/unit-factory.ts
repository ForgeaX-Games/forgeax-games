/**
 * MarsCraft -> forgeax-engine — unit factory (Milestone M3)
 * =============================================================================
 * Port of the Three.js source `web/systems/UnitFactory.ts`. Data-driven spawn:
 * reads a `UnitDef` (src/data/units.ts) and attaches the M2 components
 * (src/components.ts) populated from the def, sets the non-numeric Map
 * companions, and builds the composite model (src/world/unit-models.ts,
 * approach A) under the unit's parent entity.
 *
 * ── Source component -> forgeax mapping (see components.ts SSOT table) ────────
 *   CTransform            -> engine Transform (pos from x / heightAt / z;
 *                            facing -> Motion.facingY)
 *   CFaction              -> Faction (playerId, race, color)
 *   CRenderable('model')  -> Renderable (shape=MODEL, color, size) + the model
 *                            child entities; renderableModelPath = typeId
 *   CSelectable           -> Selectable (radius, priority)
 *   CUnitType             -> UnitType (category/size/combat/race/vision enums) +
 *                            unitTypeId / unitDisplayName companions
 *   CHealth               -> Health (hp/armor/shield...) — buildings start @10%
 *   CMovement (speed>0)   -> Movement (speed, turnRate, moveType)
 *   CAttack (weaponId)    -> Attack (range/cooldown derived; full weapon numbers
 *                            land in M6) + attackWeaponId companion
 *   CCommand              -> Command (+ commandCurrent/commandQueue companions)
 *   CHarvester (worker)   -> Harvester
 *   CBuilding (building)  -> Building + buildingTypeId companion
 *   CAbilities (non-bldg) -> Abilities + abilityIds companion (form abilityIds
 *                            seed it until data/abilities lands in M9)
 *   CEnergy (energyMax)   -> Energy
 *   UnitStats (all)       -> UnitStats base values
 *   CForm (has forms)     -> Form
 *   CTransport (capacity) -> Transport (+ transportRequiredUpgrade companion)
 *
 * Cross-milestone data tables NOT ported here (and why):
 *   - weapons.ts (M6): real damage/range/cooldown/splash. Attack is seeded from
 *     vision/role heuristics; M6's port overwrites these from the weapon def.
 *   - abilities.ts (M9): per-unit ability lists; seeded from form.abilityIds.
 */

import { Transform } from '@forgeax/engine-runtime';
import { type World, type EntityHandle } from '@forgeax/engine-ecs';
import type { UnitDef, RaceType } from '../data/units';
import { getUnitDef } from '../data/units';
import {
  Motion, Renderable, Selectable, Movement, Faction, Command, Health, Attack,
  UnitType, Building, Harvester, Abilities, Energy, Form, Transport, UnitStats,
  renderableModelPath, unitTypeId, unitDisplayName, attackWeaponId,
  commandCurrent, commandQueue, buildingTypeId, abilityIds, transportRequiredUpgrade,
  RACE, SHAPE, MOVE_TYPE, UNIT_CATEGORY, UNIT_SIZE, COMBAT_TYPE, BUILDING_STATE,
  type UnitCommand,
} from '../components';
import {
  spawnUnitModel, type UnitPrimitives, type TintFn,
} from '../world/unit-models';

// ── enum-string -> component enum-code maps (source unions -> M2 int codes) ──

const RACE_CODE: Record<RaceType, number> = {
  terran: RACE.TERRAN, protoss: RACE.PROTOSS, zerg: RACE.ZERG,
};
const CATEGORY_CODE: Record<UnitDef['category'], number> = {
  worker: UNIT_CATEGORY.WORKER, infantry: UNIT_CATEGORY.INFANTRY,
  vehicle: UNIT_CATEGORY.VEHICLE, building: UNIT_CATEGORY.BUILDING,
};
const SIZE_CODE: Record<UnitDef['unitSize'], number> = {
  small: UNIT_SIZE.SMALL, medium: UNIT_SIZE.MEDIUM, large: UNIT_SIZE.LARGE,
};
const COMBAT_CODE: Record<UnitDef['combatType'], number> = {
  bio: COMBAT_TYPE.BIO, armored: COMBAT_TYPE.ARMORED, psionic: COMBAT_TYPE.PSIONIC,
  void: COMBAT_TYPE.VOID, structure: COMBAT_TYPE.STRUCTURE,
};

/** Default shield-regen rate (source ShieldRegenSystem.SHIELD_REGEN_RATE). */
const SHIELD_REGEN_RATE = 2.0;

/** Spawn context: the cached primitives + a tint fn (closes over base GUID). */
export interface UnitFactoryCtx {
  prims: UnitPrimitives;
  tint: TintFn;
  /** Terrain surface sampler — unit sits on the heightfield. */
  heightAt: (x: number, z: number) => number;
}

export interface SpawnUnitArgs {
  typeId: string;
  x: number;
  z: number;
  playerId: number;
  /** Packed 0xRRGGBB faction color (model + Faction.color). */
  playerColor: number;
  /** Race override (defaults to the def's race). */
  race?: RaceType;
  /** Building already complete (initial map structures) — else starts @10% hp. */
  isComplete?: boolean;
}

/**
 * Create a unit entity from its `UnitDef`, attach M2 components + companions,
 * and build its composite model. Returns the parent entity (or null on unknown
 * typeId / spawn failure).
 */
export function spawnUnit(world: World, ctx: UnitFactoryCtx, args: SpawnUnitArgs): EntityHandle | null {
  const def = getUnitDef(args.typeId);
  if (!def) {
    console.warn(`[marscraft] spawnUnit: unknown unit type "${args.typeId}"`);
    return null;
  }

  const playerColor = args.playerColor;
  const race = args.race ?? def.race;
  const terrainY = ctx.heightAt(args.x, args.z);
  // Source sat the unit on the surface + half model height; air units float.
  const yOffset = terrainY + def.modelSize / 2 + (def.isGround ? 0 : 1.5);

  // ── parent entity: engine Transform + Faction + Motion + Renderable tag ──
  const res = world.spawn(
    { component: Transform, data: { pos: [args.x, yOffset, args.z] } },
    { component: Faction, data: { playerId: args.playerId, race: RACE_CODE[race], color: playerColor } },
    { component: Motion, data: { facingY: 0, fallVelocity: 0 } },
    {
      component: Renderable,
      data: { shape: SHAPE.MODEL, color: playerColor >>> 0, size: def.modelSize, visible: true, alwaysPickable: false },
    },
    {
      component: Selectable,
      data: { selected: false, selectionRadius: def.selectionRadius, priority: def.selectionPriority },
    },
    {
      component: UnitType,
      data: {
        category: CATEGORY_CODE[def.category],
        unitSize: SIZE_CODE[def.unitSize],
        combatType: COMBAT_CODE[def.combatType],
        race: RACE_CODE[race],
        visionRange: def.visionRange,
        baseVisionRange: def.visionRange,
      },
    },
    {
      component: Health,
      data: {
        hp: def.category === 'building' && !args.isComplete ? Math.max(1, Math.floor(def.hp * 0.1)) : def.hp,
        maxHp: def.hp,
        armor: def.armor,
        shield: def.shield,
        maxShield: def.shield,
        shieldArmor: def.shieldArmor,
        isDead: false,
        lastDamageTime: 0,
      },
    },
    { component: Command, data: {} },
  );
  if (!res.ok) {
    console.error(`[marscraft] spawnUnit: spawn failed for "${args.typeId}"`);
    return null;
  }
  const entity = res.value;

  // Renderable owning-entity backref + model-path companion (source modelPath).
  world.set(entity, Renderable, { entity: (entity as unknown as number) >>> 0 });
  renderableModelPath.set(entity, def.typeId);
  unitTypeId.set(entity, def.typeId);
  unitDisplayName.set(entity, def.displayName);
  commandCurrent.set(entity, null);
  commandQueue.set(entity, [] as UnitCommand[]);

  // ── Movement (speed > 0 only) ──────────────────────────────────────────────
  if (def.speed > 0) {
    world.addComponent(entity, {
      component: Movement,
      data: {
        speed: def.speed,
        currentSpeed: 0,
        turnRate: def.turnRate,
        moveType: def.isGround ? MOVE_TYPE.GROUND : MOVE_TYPE.AIR,
        hasTarget: false,
        arrived: true,
      },
    });
  }

  // ── Attack (units with a weapon) ───────────────────────────────────────────
  // Weapon numbers (damage/range/cooldown/splash) come from data/weapons.ts in
  // M6; until then we seed range from vision and leave damage to be filled by
  // M6's weapon-def pass. attackWeaponId carries the lookup key.
  if (def.weaponId) {
    world.addComponent(entity, {
      component: Attack,
      data: {
        damage: 0,
        damageCount: 1,
        range: Math.max(1, def.visionRange * 0.6),
        cooldown: 1,
        projectileSpeed: 0,
        canAttackAir: false,
        canAttackGround: true,
        currentCooldown: 0,
        targetEntity: -1,
        isAttacking: false,
        originX: args.x,
        originZ: args.z,
      },
    });
    attackWeaponId.set(entity, def.weaponId);
  }

  // ── Harvester (workers) ────────────────────────────────────────────────────
  if (def.category === 'worker') {
    world.addComponent(entity, { component: Harvester, data: {} });
  }

  // ── Building (structures) ──────────────────────────────────────────────────
  if (def.category === 'building') {
    world.addComponent(entity, {
      component: Building,
      data: {
        state: args.isComplete ? BUILDING_STATE.COMPLETE : BUILDING_STATE.CONSTRUCTING,
        buildProgress: args.isComplete ? 1 : 0,
        buildTime: def.buildTime,
        race: RACE_CODE[race],
      },
    });
    buildingTypeId.set(entity, def.typeId);
  }

  // ── Abilities (all non-building units carry it, for buffs/debuffs) ──────────
  if (def.category !== 'building') {
    world.addComponent(entity, { component: Abilities, data: {} });
    // Seed from form ability lists until data/abilities lands (M9).
    const ids: string[] = [];
    for (const f of def.forms ?? []) for (const a of f.abilityIds ?? []) ids.push(a);
    abilityIds.set(entity, ids);
  }

  // ── Energy (caster / support units) ────────────────────────────────────────
  if (def.energyMax && def.energyMax > 0) {
    world.addComponent(entity, {
      component: Energy,
      data: {
        energy: def.energyMax * (def.energyStartPercent ?? 0.25),
        maxEnergy: def.energyMax,
        regenRate: def.energyRegen ?? 0.5625,
        startPercent: def.energyStartPercent ?? 0.25,
      },
    });
  }

  // ── UnitStats (all units) — base values from def (+ weapon numbers in M6) ──
  world.addComponent(entity, {
    component: UnitStats,
    data: {
      baseMaxHp: def.hp,
      baseMaxShield: def.shield,
      baseMaxEnergy: def.energyMax ?? 0,
      baseArmor: def.armor,
      baseShieldArmor: def.shieldArmor,
      baseDamage: 0,
      baseAttackCooldown: 1,
      baseRange: def.weaponId ? Math.max(1, def.visionRange * 0.6) : 0,
      baseMoveSpeed: def.speed,
      baseTurnRate: def.turnRate,
      baseVisionRange: def.visionRange,
      baseSplashRadius: 0,
      baseEnergyRegen: def.energyRegen ?? 0.5625,
      baseShieldRegen: def.shield > 0 ? SHIELD_REGEN_RATE : 0,
    },
  });

  // ── Form (units with forms) ────────────────────────────────────────────────
  if (def.forms && def.forms.length > 0) {
    world.addComponent(entity, { component: Form, data: {} });
  }

  // ── Transport (bunker / dropship) ──────────────────────────────────────────
  if (def.transportCapacity && def.transportCapacity > 0) {
    world.addComponent(entity, {
      component: Transport,
      data: {
        capacity: def.transportCapacity,
        crashDamagePercent: def.transportCrashDamage ?? 0,
        canAttackFromInside: def.transportCanAttack ?? false,
        uiColumns: def.transportUiColumns ?? 4,
        rightClickToLoad: def.transportRightClickToLoad ?? false,
        rightClickToBoard: def.transportRightClickToBoard ?? false,
        unloadMode: def.transportUnloadMode === 'queued' ? 1 : 0,
        unloadInterval: def.transportUnloadInterval ?? 0.36,
        ejectRadius: def.transportEjectRadius ?? 2.5,
      },
    });
    transportRequiredUpgrade.set(entity, def.transportRequiredUpgrade ?? '');
  }

  // ── composite model (approach A: child entities parented via ChildOf) ──────
  spawnUnitModel(world, entity, def, playerColor, ctx.prims, ctx.tint);

  return entity;
}
