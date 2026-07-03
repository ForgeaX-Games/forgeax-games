/**
 * MarsCraft → forgeax-engine — ECS component port (Milestone M2)
 * =============================================================================
 *
 * forgeax components are **SoA, numeric-only**: every field is one of
 * `'f32' | 'i32' | 'u32' | 'bool'` (or the `{ type, default }` descriptor form).
 * NO string / object / array / Set / Map / callback fields are allowed in a
 * `defineComponent` schema. Every non-numeric piece of per-entity data from the
 * Three.js source therefore lives in a parallel `Map<Entity, T>` companion
 * declared next to its component and documented in the table below.
 *
 * Conventions used throughout this file
 * -------------------------------------
 * - **Enums** (string unions stored as ints): exported `const X = {...} as const`
 *   maps + a `type` alias, e.g. `FACTION_RACE.TERRAN === 0`.
 * - **Entity references** that the source stored as `number | null`: kept as a
 *   single `'i32'` field with sentinel **`-1 = none`** (no ghost boolean). Entity
 *   ids in forgeax are non-negative, so `-1` is an unambiguous "absent" marker.
 * - **Booleans** → `'bool'`. Integral counts / ids / enum codes → `'u32'`
 *   (or `'i32'` where negatives/sentinels are needed). Continuous values → `'f32'`.
 * - Source `getter`/method-only members (e.g. `hpPercent`, `isQueueFull`,
 *   `larvaeCount`, `bunkerEntity`) are **derived** — they carry no stored state,
 *   so they are not fields. The static class constants (LARVAE_*, WARP_*, PYLON_*,
 *   PLACING_*) are exported as plain consts, not component fields.
 * - The source `CTransform` is NOT redefined — its position/rotation maps onto
 *   the engine built-in `Transform`. Only the extra non-Transform datum
 *   (`rotationY` facing + `fallVelocity`) gets a small `Motion` component (see §1).
 *
 * =============================================================================
 * SSOT mapping table — source component → forgeax component → Map companions
 * =============================================================================
 *
 *  Source (web/components)  forgeax component   Fields kept numeric            Fields moved to Map<Entity,…> (companion)
 *  -----------------------  ------------------  -----------------------------  -------------------------------------------
 *  CTransform               (engine Transform)  x,y,z→pos; rotationY,           — (rotationY+fallVelocity → Motion)
 *                           + Motion            scale*→Transform; Motion:
 *                                               facingY, fallVelocity
 *  CRenderable              Renderable          entity, shape(enum), color,    modelPath:string → renderableModelPath
 *                                               size, visible, alwaysPickable
 *  CSelectable              Selectable          selected, selectionRadius,     —
 *                                               priority
 *  CMovement                Movement            speed,currentSpeed,turnRate,   moveType(enum)→kept numeric; — (none Map)
 *                                               hasTarget,targetX/Z,arrived,
 *                                               arrivalThreshold,moveType,
 *                                               useFlowField,flowDirX/Z,
 *                                               isPushed,pushTargetX/Z,
 *                                               creepBoosted
 *  CFaction                 Faction             playerId, race(enum), color    —
 *  CCommand                 Command             (queue length cache: n/a)      current:UnitCommand|null → commandCurrent
 *                                                                              queue:UnitCommand[]      → commandQueue
 *  CHealth                  Health              hp,maxHp,armor,shield,         —
 *                                               maxShield,shieldArmor,isDead,
 *                                               lastDamageTime
 *  CAttack                  Attack              damage,damageCount,            weaponId:string          → attackWeaponId
 *                                               damageType(enum),range,        splashFalloff:number[]   → attackSplashFalloff
 *                                               cooldown,projectileType(enum),
 *                                               projectileSpeed,canAttackAir,
 *                                               canAttackGround,splashRadius,
 *                                               splashShape(enum),splashAngle,
 *                                               splashWidth,bounceCount,
 *                                               bounceDamageDecay,leashDistance,
 *                                               currentCooldown,targetEntity(-1),
 *                                               isAttacking,originX,originZ
 *  CProjectile              Projectile          sourceEntity,sourcePlayerId,   payload:ProjectilePayload        → projectilePayload
 *                                               sourceX/Z,targetEntity,        wavePayload:DirectionWavePayload → projectileWavePayload
 *                                               targetX/Y/Z,speed,maxLifetime, weaponId:string                  → projectileWeaponId
 *                                               lifetime,bounceRemaining,      orbWeaponId:string               → projectileOrbWeaponId
 *                                               bounceSearchRadius,            waveHitSet:Set<Entity>           → projectileWaveHitSet
 *                                               bounceDamageDecay,bounceIndex,
 *                                               isArcHoming,arcSide,arcHeight,
 *                                               arcProgress,arcStartX/Y/Z,
 *                                               isDirectionWave,waveDirX/Z,
 *                                               waveWidth,waveMaxRange,
 *                                               waveTraveled,waveOriginX/Z,
 *                                               waveRevealRange,
 *                                               waveRevealDuration,
 *                                               waveRevealLastDist
 *  CUnitType                UnitType            category(enum),unitSize(enum), typeId:string      → unitTypeId
 *                                               combatType(enum),race(enum),   displayName:string → unitDisplayName
 *                                               visionRange,baseVisionRange
 *  CBuilding                Building            state(enum),buildProgress,     builderEntity(-1) kept; the entity-id /
 *                                               buildTime,buildingTypeId(Map), string list members → Maps:
 *                                               race(enum),rallyX/Z,hasRally,  buildingTypeId:string    → buildingTypeId
 *                                               rallyResourceEntity(-1),       additionalBuilders:n[]   → buildingAdditionalBuilders
 *                                               rallyAttackEntity(-1),         productionQueue:Prod[]   → buildingProductionQueue
 *                                               garrisonCapacity,              garrisonedUnits:n[]      → buildingGarrisonedUnits
 *                                               garrisonUsedSlots,             larvaeEntities:Entity[]  → buildingLarvaeEntities
 *                                               builderEntity(-1),             morphTargetTypeId:string → buildingMorphTargetTypeId
 *                                               attachedGeyser(-1),            warpInTypeId:string      → buildingWarpInTypeId
 *                                               morphProgress,morphTime,
 *                                               larvaeTimer,isPowered,
 *                                               warpCooldown,warpInProgress,
 *                                               warpInTime,warpInTargetX/Z,
 *                                               placingWaitTimer,
 *                                               placingTravelTimer,liftPaused
 *  CMineral                 Mineral             amount,maxAmount,              —
 *                                               currentHarvester(-1)
 *  CGeyser                  Geyser              amount,maxAmount,hasRefinery,  currentWorkers:Set       → geyserCurrentWorkers
 *                                               refineryEntity(-1)             assignedWorkers:Set      → geyserAssignedWorkers
 *  CHarvester               Harvester           state(enum),targetMineral(-1), —
 *                                               targetGeyser(-1),targetBase(-1),
 *                                               carryAmount,carryType(enum),
 *                                               timer,isHarvesting
 *  CAbilities               Abilities           (none stored numeric beyond    abilityIds:string[]      → abilityIds
 *                                               attackModifier flags via Map)  cooldowns:Map            → abilityCooldowns
 *                                                                              buffs:ActiveBuff[]       → abilityBuffs
 *                                                                              toggleStates:Map         → abilityToggleStates
 *                                                                              autocast:Map             → abilityAutocast
 *                                                                              activatedPassives:Set    → abilityActivatedPassives
 *                                                                              attackModifier:obj|null  → abilityAttackModifier
 *                                                                              abilityTriggerCooldowns  → abilityTriggerCooldowns
 *  CEnergy                  Energy              energy,maxEnergy,regenRate,    —
 *                                               startPercent
 *  CForm                    Form                (activeFormId flag derivable)  activeFormId:string|null → formActiveId
 *                                                                              baseSnapshot:FormSnapshot→ formBaseSnapshot
 *  CGarrisoned              Garrisoned          carrierEntity, slotIndex       —
 *  CTransport               Transport           capacity,usedSlots,            units:Entity[]           → transportUnits
 *                                               crashDamagePercent,            unloadQueue:Entity[]     → transportUnloadQueue
 *                                               canAttackFromInside,uiColumns, requiredUpgrade:string   → transportRequiredUpgrade
 *                                               rightClickToLoad,
 *                                               rightClickToBoard,
 *                                               unloadMode(enum),unloadInterval,
 *                                               ejectRadius,unloadTimer
 *  CLarva                   Larva               parentBuilding,state(enum),    morphTypeId:string|null  → larvaMorphTypeId
 *                                               morphProgress,morphTime,
 *                                               wiggleTimer,homeX/Z,
 *                                               wiggleTargetX/Z
 *  CHazard                  Hazard              playerId,hp,maxHp,             hazardTypeId:string      → hazardTypeId
 *                                               remainingDuration,maxDuration, areaEffects:AbilityEffect[] → hazardAreaEffects
 *                                               shape(enum),radius,angle,
 *                                               width,height,dirX/Z,
 *                                               blocksMovement,blocksProjectiles,
 *                                               blocksAllFactions,areaInterval,
 *                                               areaTimer,casterEntity
 *  CGroundEffect            GroundEffect        playerId,casterEntity,radius,  typeId:string            → groundEffectTypeId
 *                                               remainingDuration,maxDuration
 *  CCreepTumor              CreepTumor          radius                         —
 *  CIllusion                Illusion            damageTakenMultiplier,         —
 *                                               damageDealtMultiplier
 *  CSummonedLifetime        SummonedLifetime    casterEntity,remainingLife,    —
 *                                               totalLife
 *  UnitStats                UnitStats           all base/final/upgrade         —
 *                                               numeric fields + lastCombatTime
 *
 * =============================================================================
 */

import { defineComponent, type EntityHandle as Entity } from '@forgeax/engine-ecs';

// =============================================================================
// Shared sentinel
// =============================================================================

/** Sentinel stored in an `'i32'` entity-reference field meaning "no entity". */
export const NO_ENTITY = -1;

// =============================================================================
// Enums (string unions in source → integer codes in forgeax components)
// =============================================================================

/** CFaction.playerId well-known slots (config.ts: 0=player,1=AI,99=neutral). */
export const PLAYER_ID = { PLAYER: 0, ENEMY: 1, NEUTRAL: 99 } as const;

/** RaceType — terran | protoss | zerg. */
export const RACE = { TERRAN: 0, PROTOSS: 1, ZERG: 2 } as const;
export type RaceCode = (typeof RACE)[keyof typeof RACE];

/** CRenderable.shape — 'box'|'sphere'|'cylinder'|'cone'|'model'. */
export const SHAPE = { BOX: 0, SPHERE: 1, CYLINDER: 2, CONE: 3, MODEL: 4 } as const;
export type ShapeCode = (typeof SHAPE)[keyof typeof SHAPE];

/** CMovement.moveType — 'ground'|'air'|'hover'. */
export const MOVE_TYPE = { GROUND: 0, AIR: 1, HOVER: 2 } as const;
export type MoveTypeCode = (typeof MOVE_TYPE)[keyof typeof MOVE_TYPE];

/** weapons.ts DamageType — 'normal'|'spell'. */
export const DAMAGE_TYPE = { NORMAL: 0, SPELL: 1 } as const;
export type DamageTypeCode = (typeof DAMAGE_TYPE)[keyof typeof DAMAGE_TYPE];

/** weapons.ts ProjectileType — 'instant'|'bullet'|'missile'|'bounce'. */
export const PROJECTILE_TYPE = { INSTANT: 0, BULLET: 1, MISSILE: 2, BOUNCE: 3 } as const;
export type ProjectileTypeCode = (typeof PROJECTILE_TYPE)[keyof typeof PROJECTILE_TYPE];

/** weapons.ts SplashShape — 'circle'|'cone'|'line'. */
export const SPLASH_SHAPE = { CIRCLE: 0, CONE: 1, LINE: 2 } as const;
export type SplashShapeCode = (typeof SPLASH_SHAPE)[keyof typeof SPLASH_SHAPE];

/** units.ts UnitCategory — 'worker'|'infantry'|'vehicle'|'building'. */
export const UNIT_CATEGORY = { WORKER: 0, INFANTRY: 1, VEHICLE: 2, BUILDING: 3 } as const;
export type UnitCategoryCode = (typeof UNIT_CATEGORY)[keyof typeof UNIT_CATEGORY];

/** units.ts UnitSize — 'small'|'medium'|'large' (legacy: model/collision only). */
export const UNIT_SIZE = { SMALL: 0, MEDIUM: 1, LARGE: 2 } as const;
export type UnitSizeCode = (typeof UNIT_SIZE)[keyof typeof UNIT_SIZE];

/** units.ts CombatType — 'bio'|'armored'|'psionic'|'void'|'structure'. */
export const COMBAT_TYPE = { BIO: 0, ARMORED: 1, PSIONIC: 2, VOID: 3, STRUCTURE: 4 } as const;
export type CombatTypeCode = (typeof COMBAT_TYPE)[keyof typeof COMBAT_TYPE];

/** CBuilding.state — 'placing'|'constructing'|'complete'|'morphing'. */
export const BUILDING_STATE = { PLACING: 0, CONSTRUCTING: 1, COMPLETE: 2, MORPHING: 3 } as const;
export type BuildingStateCode = (typeof BUILDING_STATE)[keyof typeof BUILDING_STATE];

/** CHarvester.state — HarvestState union. */
export const HARVEST_STATE = {
  IDLE: 0,
  MOVING_TO_MINERAL: 1,
  MINING: 2,
  RETURNING_MINERAL: 3,
  MOVING_TO_GAS: 4,
  HARVESTING_GAS: 5,
  RETURNING_GAS: 6,
} as const;
export type HarvestStateCode = (typeof HARVEST_STATE)[keyof typeof HARVEST_STATE];

/** CHarvester.carryType — 'mineral'|'gas'|'none'. */
export const CARRY_TYPE = { NONE: 0, MINERAL: 1, GAS: 2 } as const;
export type CarryTypeCode = (typeof CARRY_TYPE)[keyof typeof CARRY_TYPE];

/** CTransport.unloadMode — 'instant'|'queued'. */
export const UNLOAD_MODE = { INSTANT: 0, QUEUED: 1 } as const;
export type UnloadModeCode = (typeof UNLOAD_MODE)[keyof typeof UNLOAD_MODE];

/** CLarva.state — 'idle'|'morphing'. */
export const LARVA_STATE = { IDLE: 0, MORPHING: 1 } as const;
export type LarvaStateCode = (typeof LARVA_STATE)[keyof typeof LARVA_STATE];

/** CHazard.shape / HazardShape — 'circle'|'arc'|'line'. */
export const HAZARD_SHAPE = { CIRCLE: 0, ARC: 1, LINE: 2 } as const;
export type HazardShapeCode = (typeof HAZARD_SHAPE)[keyof typeof HAZARD_SHAPE];

// =============================================================================
// Supporting TS types (ported from source) for the Map companions
// =============================================================================

/** Command.ts CommandType. */
export type CommandType =
  | 'move' | 'attack_move' | 'attack' | 'stop' | 'hold' | 'patrol'
  | 'harvest' | 'return_cargo' | 'build' | 'repair' | 'follow'
  | 'garrison' | 'pickup' | 'ability_move';

/** Command.ts UnitCommand (ported verbatim). */
export interface UnitCommand {
  type: CommandType;
  targetX?: number;
  targetZ?: number;
  clickX?: number;
  clickZ?: number;
  targetEntity?: number;
  buildTypeId?: string;
  targetMineral?: number;
  targetGeyser?: number;
  abilityId?: string;
  abilityTargetEntity?: number;
  abilityTargetX?: number;
  abilityTargetZ?: number;
}

/** Command.ts — max queued commands per unit. */
export const MAX_COMMAND_QUEUE = 8;

/** Building.ts ProductionItem (ported verbatim). */
export interface ProductionItem {
  itemId: string;
  isUpgrade: boolean;
  progress: number;
  buildTime: number;
  mineralCost: number;
  gasCost: number;
}

/** Building.ts — max production-queue length + static class constants. */
export const MAX_PRODUCTION_QUEUE = 10;
export const LARVAE_NATURAL_MAX = 5;
export const LARVAE_SPAWN_INTERVAL = 9;
export const PYLON_POWER_RADIUS = 7;
export const WARP_COOLDOWN = 20;
export const WARP_IN_TIME = 3;
export const PLACING_WAIT_TIMEOUT = 8;
export const PLACING_TRAVEL_TIMEOUT = 20;

/** Abilities.ts BuffStackMode. */
export type BuffStackMode = 'refresh' | 'stack' | 'independent';

/**
 * Abilities.ts ActiveBuff (ported). `modifiers` / `triggers` reference engine
 * data-layer types (`BuffModifier`, `TriggerDef`, `BuffVFXConfig`) which are
 * ported in their own data-table milestone; typed loosely here to keep the
 * component file self-contained and import-safe.
 */
export interface ActiveBuff {
  id: string;
  remaining: number;
  totalDuration: number;
  modifiers: BuffModifier[];
  sourceEntity: number;
  isDebuff: boolean;
  triggers?: unknown[];
  triggerCooldowns?: Map<string, number>;
  stackMode: BuffStackMode;
  maxStacks: number;
  stacks: number;
  vfx?: unknown;
}

/** Abilities.ts BuffModifier (minimal port — full table comes with data/abilities). */
export interface BuffModifier {
  stat: string;
  mode: 'add' | 'multiply';
  value: number;
}

/** Abilities.ts AbilityCooldown. */
export interface AbilityCooldown {
  abilityId: string;
  remaining: number;
  total: number;
}

/** Abilities.ts ToggleState. */
export interface ToggleState {
  stateId: string;
  active: boolean;
  transitionRemaining: number;
  recloakTimer?: number;
  transitionTotal: number;
}

/** Abilities.ts AttackModifierState (config typed loosely until data/abilities port). */
export interface AttackModifierState {
  abilityId: string;
  active: boolean;
  energyCost: number;
  config: unknown;
}

/** Form.ts FormSnapshot (ported verbatim). */
export interface FormSnapshot {
  weaponId: string | null;
  damage: number;
  damageCount: number;
  damageType: string;
  range: number;
  cooldown: number;
  projectileType: string;
  projectileSpeed: number;
  canAttackAir: boolean;
  canAttackGround: boolean;
  splashRadius: number;
  splashShape: string;
  splashFalloff: number[];
  splashAngle: number;
  splashWidth: number;
  bounceCount: number;
  bounceDamageDecay: number;
  speed: number;
  turnRate: number;
  moveType: string;
  maxHp: number;
  armor: number;
  maxShield: number;
  shieldArmor: number;
  modelPath: string;
  modelSize: number;
  selectionRadius: number;
  abilityIds: string[];
  visionRange: number;
  baseDamage: number;
  baseAttackCooldown: number;
  baseRange: number;
  baseMoveSpeed: number;
  baseTurnRate: number;
  baseArmor: number;
  baseMaxHp: number;
  baseMaxShield: number;
  baseShieldArmor: number;
  baseVisionRange: number;
  baseSplashRadius: number;
}

/** Transport.ts TransportConfig (ported verbatim). */
export interface TransportConfig {
  capacity: number;
  crashDamagePercent?: number;
  canAttackFromInside?: boolean;
  uiColumns?: number;
  rightClickToLoad?: boolean;
  rightClickToBoard?: boolean;
  unloadMode?: 'instant' | 'queued';
  unloadInterval?: number;
  requiredUpgrade?: string;
  ejectRadius?: number;
}

/**
 * Projectile payload behaviours — set on hit. The concrete payload classes
 * (AttackPayload, ability payloads, DirectionWavePayload) are ported in the
 * combat/ability milestones; typed loosely here so the components file stays
 * import-safe and decoupled from systems/.
 */
export type ProjectilePayload = unknown;
export type DirectionWavePayload = unknown;

/** Hazard.ts / GroundEffect.ts AbilityEffect (ported with data/abilities). */
export type AbilityEffect = unknown;

// Geyser.ts module constants (ported verbatim).
export const GEYSER_DEPLETED_THRESHOLD = 0;
export const GEYSER_NORMAL_YIELD = 8;
export const GEYSER_MAX_WORKERS = 3;

// Harvester.ts module constants (ported verbatim).
export const MINERAL_PER_TRIP = 10;
export const GAS_PER_TRIP = 10;
export const MINING_DURATION = 1.8;
export const GAS_HARVEST_DURATION = 2.8;
export const MINERAL_REACH_DIST = 1.5;
export const GAS_REACH_DIST = 2.0;
export const BASE_REACH_DIST = 3.0;

// CreepTumor.ts constant.
export const CREEP_TUMOR_MAX_RADIUS = 10;

// =============================================================================
// §1  Transform / Motion
// =============================================================================
// Source CTransform { x,y,z, rotationY, scaleX/Y/Z, fallVelocity }.
//   - x,y,z          → engine Transform.posX/posY/posZ
//   - scaleX/Y/Z     → engine Transform.scaleX/scaleY/scaleZ
//   - rotationY      → horizontal facing (radians). The engine Transform stores
//     rotation as a quaternion; systems derive the quat from facingY each frame,
//     but the source's authoritative scalar facing is kept here so RTS turn-rate
//     logic stays 1:1 with the original (it reasons in scalar radians, not quats).
//   - fallVelocity   → vertical fall speed for downhill-dash smoothing.
// Methods (setPosition/distanceTo/distanceXZ/lookAtXZ) are pure helpers — ported
// as free functions when the movement milestone needs them, not stored state.

export const Motion = defineComponent('Motion', {
  /** Horizontal facing angle, radians (source CTransform.rotationY). */
  facingY: 'f32',
  /** Vertical fall velocity, 0 = not falling (source CTransform.fallVelocity). */
  fallVelocity: { type: 'f32', default: 0 },
});

// =============================================================================
// §2  Renderable
// =============================================================================
export const Renderable = defineComponent('Renderable', {
  /** Owning entity id (source kept it for reverse lookup). */
  entity: 'u32',
  /** ShapeCode (SHAPE.*). */
  shape: { type: 'u32', default: SHAPE.BOX },
  /** Base color packed 0xRRGGBB. */
  color: { type: 'u32', default: 0x4488ff },
  /** Uniform scale. */
  size: { type: 'f32', default: 1 },
  visible: { type: 'bool', default: true },
  alwaysPickable: { type: 'bool', default: false },
});
/** Renderable.modelPath:string (shape==MODEL) → companion. */
export const renderableModelPath = new Map<Entity, string>();

// =============================================================================
// §3  Selectable
// =============================================================================
export const Selectable = defineComponent('Selectable', {
  selected: { type: 'bool', default: false },
  selectionRadius: { type: 'f32', default: 0.8 },
  priority: { type: 'u32', default: 0 },
});

// =============================================================================
// §4  Movement
// =============================================================================
export const Movement = defineComponent('Movement', {
  speed: { type: 'f32', default: 5 },
  currentSpeed: { type: 'f32', default: 0 },
  turnRate: { type: 'f32', default: Math.PI * 4 },
  hasTarget: { type: 'bool', default: false },
  targetX: { type: 'f32', default: 0 },
  targetZ: { type: 'f32', default: 0 },
  arrived: { type: 'bool', default: true },
  arrivalThreshold: { type: 'f32', default: 0.3 },
  /** MoveTypeCode (MOVE_TYPE.*). */
  moveType: { type: 'u32', default: MOVE_TYPE.GROUND },
  useFlowField: { type: 'bool', default: false },
  flowDirX: { type: 'f32', default: 0 },
  flowDirZ: { type: 'f32', default: 0 },
  isPushed: { type: 'bool', default: false },
  pushTargetX: { type: 'f32', default: 0 },
  pushTargetZ: { type: 'f32', default: 0 },
  /** Source _creepBoosted. */
  creepBoosted: { type: 'bool', default: false },
});

// =============================================================================
// §5  Faction
// =============================================================================
export const Faction = defineComponent('Faction', {
  playerId: { type: 'u32', default: PLAYER_ID.PLAYER },
  /** RaceCode (RACE.*). */
  race: { type: 'u32', default: RACE.TERRAN },
  /** Player color packed 0xRRGGBB. */
  color: { type: 'u32', default: 0x4488ff },
});

// =============================================================================
// §6  Command
// =============================================================================
// CCommand holds a `current: UnitCommand | null` + `queue: UnitCommand[]`.
// Both are object/array — neither numeric. The component itself is a pure tag;
// all state lives in the two Map companions below.
export const Command = defineComponent('Command', {});
/** CCommand.current → companion (null/absent = no current command). */
export const commandCurrent = new Map<Entity, UnitCommand | null>();
/** CCommand.queue → companion (Shift-queued commands). */
export const commandQueue = new Map<Entity, UnitCommand[]>();

// =============================================================================
// §7  Health
// =============================================================================
export const Health = defineComponent('Health', {
  hp: 'f32',
  maxHp: 'f32',
  armor: { type: 'f32', default: 0 },
  shield: { type: 'f32', default: 0 },
  maxShield: { type: 'f32', default: 0 },
  shieldArmor: { type: 'f32', default: 0 },
  isDead: { type: 'bool', default: false },
  lastDamageTime: { type: 'f32', default: 0 },
});

// =============================================================================
// §8  Attack
// =============================================================================
export const Attack = defineComponent('Attack', {
  damage: 'f32',
  damageCount: 'u32',
  /** DamageTypeCode (DAMAGE_TYPE.*). */
  damageType: { type: 'u32', default: DAMAGE_TYPE.NORMAL },
  range: 'f32',
  cooldown: 'f32',
  /** ProjectileTypeCode (PROJECTILE_TYPE.*). */
  projectileType: { type: 'u32', default: PROJECTILE_TYPE.INSTANT },
  projectileSpeed: 'f32',
  canAttackAir: { type: 'bool', default: false },
  canAttackGround: { type: 'bool', default: true },
  splashRadius: { type: 'f32', default: 0 },
  /** SplashShapeCode (SPLASH_SHAPE.*). */
  splashShape: { type: 'u32', default: SPLASH_SHAPE.CIRCLE },
  splashAngle: { type: 'f32', default: 0 },
  splashWidth: { type: 'f32', default: 0 },
  bounceCount: { type: 'u32', default: 0 },
  bounceDamageDecay: { type: 'f32', default: 0 },
  leashDistance: { type: 'f32', default: 20 },
  // runtime state
  currentCooldown: { type: 'f32', default: 0 },
  /** targetEntity, -1 = none (source used number|null). */
  targetEntity: { type: 'i32', default: NO_ENTITY },
  isAttacking: { type: 'bool', default: false },
  originX: { type: 'f32', default: 0 },
  originZ: { type: 'f32', default: 0 },
});
/** CAttack.weaponId?:string → companion. */
export const attackWeaponId = new Map<Entity, string>();
/** CAttack.splashFalloff:number[] → companion. */
export const attackSplashFalloff = new Map<Entity, number[]>();

// =============================================================================
// §9  Projectile
// =============================================================================
export const Projectile = defineComponent('Projectile', {
  sourceEntity: 'u32',
  sourcePlayerId: 'u32',
  sourceX: 'f32',
  sourceZ: 'f32',
  targetEntity: 'u32',
  targetX: 'f32',
  targetY: 'f32',
  targetZ: 'f32',
  speed: 'f32',
  maxLifetime: { type: 'f32', default: 5 },
  lifetime: { type: 'f32', default: 0 },
  bounceRemaining: { type: 'u32', default: 0 },
  bounceSearchRadius: { type: 'f32', default: 8 },
  bounceDamageDecay: { type: 'f32', default: 0 },
  bounceIndex: { type: 'u32', default: 0 },
  isArcHoming: { type: 'bool', default: false },
  /** +1 right arc, -1 left arc. */
  arcSide: { type: 'i32', default: 1 },
  arcHeight: { type: 'f32', default: 3.0 },
  arcProgress: { type: 'f32', default: 0 },
  arcStartX: { type: 'f32', default: 0 },
  arcStartY: { type: 'f32', default: 0 },
  arcStartZ: { type: 'f32', default: 0 },
  isDirectionWave: { type: 'bool', default: false },
  waveDirX: { type: 'f32', default: 0 },
  waveDirZ: { type: 'f32', default: 1 },
  waveWidth: { type: 'f32', default: 2 },
  waveMaxRange: { type: 'f32', default: 10 },
  waveTraveled: { type: 'f32', default: 0 },
  waveOriginX: { type: 'f32', default: 0 },
  waveOriginZ: { type: 'f32', default: 0 },
  waveRevealRange: { type: 'f32', default: 0 },
  waveRevealDuration: { type: 'f32', default: 5 },
  waveRevealLastDist: { type: 'f32', default: 0 },
});
/** CProjectile.payload:ProjectilePayload → companion (on-hit behaviour). */
export const projectilePayload = new Map<Entity, ProjectilePayload>();
/** CProjectile.wavePayload:DirectionWavePayload|null → companion. */
export const projectileWavePayload = new Map<Entity, DirectionWavePayload | null>();
/** CProjectile.weaponId:string → companion (VFX lookup). */
export const projectileWeaponId = new Map<Entity, string>();
/** CProjectile.orbWeaponId:string → companion (orb override). */
export const projectileOrbWeaponId = new Map<Entity, string>();
/** CProjectile.waveHitSet:Set<Entity> → companion (dedupe). */
export const projectileWaveHitSet = new Map<Entity, Set<Entity>>();

// =============================================================================
// §10  UnitType
// =============================================================================
export const UnitType = defineComponent('UnitType', {
  /** UnitCategoryCode (UNIT_CATEGORY.*). */
  category: 'u32',
  /** UnitSizeCode (UNIT_SIZE.*) — legacy, model/collision only. */
  unitSize: 'u32',
  /** CombatTypeCode (COMBAT_TYPE.*). */
  combatType: 'u32',
  /** RaceCode (RACE.*). */
  race: 'u32',
  visionRange: 'f32',
  /** Source _baseVisionRange (creep-boost baseline). */
  baseVisionRange: 'f32',
});
/** CUnitType.typeId:string → companion (units.ts lookup key). */
export const unitTypeId = new Map<Entity, string>();
/** CUnitType.displayName:string → companion. */
export const unitDisplayName = new Map<Entity, string>();

// =============================================================================
// §11  Building
// =============================================================================
export const Building = defineComponent('Building', {
  /** BuildingStateCode (BUILDING_STATE.*). */
  state: { type: 'u32', default: BUILDING_STATE.PLACING },
  buildProgress: { type: 'f32', default: 0 },
  buildTime: 'f32',
  /** builderEntity, -1 = none. */
  builderEntity: { type: 'i32', default: NO_ENTITY },
  /** RaceCode (RACE.*). */
  race: { type: 'u32', default: RACE.TERRAN },
  morphProgress: { type: 'f32', default: 0 },
  morphTime: { type: 'f32', default: 0 },
  rallyX: { type: 'f32', default: 0 },
  rallyZ: { type: 'f32', default: 0 },
  hasRally: { type: 'bool', default: false },
  /** rallyResourceEntity, -1 = none. */
  rallyResourceEntity: { type: 'i32', default: NO_ENTITY },
  /** rallyAttackEntity, -1 = none. */
  rallyAttackEntity: { type: 'i32', default: NO_ENTITY },
  garrisonCapacity: { type: 'u32', default: 0 },
  garrisonUsedSlots: { type: 'u32', default: 0 },
  /** attachedGeyser, -1 = none. */
  attachedGeyser: { type: 'i32', default: NO_ENTITY },
  larvaeTimer: { type: 'f32', default: 0 },
  isPowered: { type: 'bool', default: false },
  warpCooldown: { type: 'f32', default: 0 },
  warpInProgress: { type: 'f32', default: 0 },
  warpInTime: { type: 'f32', default: 0 },
  warpInTargetX: { type: 'f32', default: 0 },
  warpInTargetZ: { type: 'f32', default: 0 },
  placingWaitTimer: { type: 'f32', default: 0 },
  placingTravelTimer: { type: 'f32', default: 0 },
  /** Source _liftPaused. */
  liftPaused: { type: 'bool', default: false },
});
/** CBuilding.buildingTypeId:string → companion (BuildingDef lookup key). */
export const buildingTypeId = new Map<Entity, string>();
/** CBuilding.morphTargetTypeId:string|null → companion. */
export const buildingMorphTargetTypeId = new Map<Entity, string | null>();
/** CBuilding.warpInTypeId:string|null → companion. */
export const buildingWarpInTypeId = new Map<Entity, string | null>();
/** CBuilding.additionalBuilders:number[] → companion (multi-SCV build). */
export const buildingAdditionalBuilders = new Map<Entity, number[]>();
/** CBuilding.productionQueue:ProductionItem[] → companion. */
export const buildingProductionQueue = new Map<Entity, ProductionItem[]>();
/** CBuilding.garrisonedUnits:number[] → companion (bunker occupants). */
export const buildingGarrisonedUnits = new Map<Entity, number[]>();
/** CBuilding.larvaeEntities:Entity[] → companion (Zerg larvae). */
export const buildingLarvaeEntities = new Map<Entity, Entity[]>();

// =============================================================================
// §12  Mineral
// =============================================================================
export const Mineral = defineComponent('Mineral', {
  amount: { type: 'f32', default: 1500 },
  maxAmount: { type: 'f32', default: 1500 },
  /** currentHarvester, -1 = none (max 1 worker per patch). */
  currentHarvester: { type: 'i32', default: NO_ENTITY },
});

// =============================================================================
// §13  Geyser
// =============================================================================
export const Geyser = defineComponent('Geyser', {
  amount: { type: 'f32', default: 2500 },
  maxAmount: { type: 'f32', default: 2500 },
  hasRefinery: { type: 'bool', default: false },
  /** refineryEntity, -1 = none. */
  refineryEntity: { type: 'i32', default: NO_ENTITY },
});
/** CGeyser.currentWorkers:Set<number> → companion (active harvesters cap). */
export const geyserCurrentWorkers = new Map<Entity, Set<number>>();
/** CGeyser.assignedWorkers:Set<number> → companion (incl. in-transit). */
export const geyserAssignedWorkers = new Map<Entity, Set<number>>();

// =============================================================================
// §14  Harvester
// =============================================================================
export const Harvester = defineComponent('Harvester', {
  /** HarvestStateCode (HARVEST_STATE.*). */
  state: { type: 'u32', default: HARVEST_STATE.IDLE },
  /** targetMineral, -1 = none. */
  targetMineral: { type: 'i32', default: NO_ENTITY },
  /** targetGeyser, -1 = none. */
  targetGeyser: { type: 'i32', default: NO_ENTITY },
  /** targetBase, -1 = none. */
  targetBase: { type: 'i32', default: NO_ENTITY },
  carryAmount: { type: 'f32', default: 0 },
  /** CarryTypeCode (CARRY_TYPE.*). */
  carryType: { type: 'u32', default: CARRY_TYPE.NONE },
  timer: { type: 'f32', default: 0 },
  isHarvesting: { type: 'bool', default: false },
});

// =============================================================================
// §15  Abilities
// =============================================================================
// Every CAbilities member is a string[] / Map / Set / object — all non-numeric.
// The component is a pure tag; all state lives in the Map companions below.
export const Abilities = defineComponent('Abilities', {});
/** CAbilities.abilityIds:string[] → companion. */
export const abilityIds = new Map<Entity, string[]>();
/** CAbilities.cooldowns:Map<abilityId,AbilityCooldown> → companion. */
export const abilityCooldowns = new Map<Entity, Map<string, AbilityCooldown>>();
/** CAbilities.buffs:ActiveBuff[] → companion. */
export const abilityBuffs = new Map<Entity, ActiveBuff[]>();
/** CAbilities.toggleStates:Map<stateId,ToggleState> → companion. */
export const abilityToggleStates = new Map<Entity, Map<string, ToggleState>>();
/** CAbilities.autocast:Map<abilityId,boolean> → companion. */
export const abilityAutocast = new Map<Entity, Map<string, boolean>>();
/** CAbilities.activatedPassives:Set<string> → companion. */
export const abilityActivatedPassives = new Map<Entity, Set<string>>();
/** CAbilities.attackModifier:AttackModifierState|null → companion. */
export const abilityAttackModifier = new Map<Entity, AttackModifierState | null>();
/** CAbilities.abilityTriggerCooldowns:Map<triggerId,number> → companion. */
export const abilityTriggerCooldowns = new Map<Entity, Map<string, number>>();

// =============================================================================
// §16  Energy
// =============================================================================
export const Energy = defineComponent('Energy', {
  energy: 'f32',
  maxEnergy: { type: 'f32', default: 200 },
  regenRate: { type: 'f32', default: 0.5625 },
  startPercent: { type: 'f32', default: 0.25 },
});

// =============================================================================
// §17  Form
// =============================================================================
// CForm { activeFormId: string|null, baseSnapshot: FormSnapshot|null } — both
// non-numeric. Pure-tag component; state in the Map companions below.
export const Form = defineComponent('Form', {});
/** CForm.activeFormId:string|null → companion (null = base form). */
export const formActiveId = new Map<Entity, string | null>();
/** CForm.baseSnapshot:FormSnapshot|null → companion (restore on revert). */
export const formBaseSnapshot = new Map<Entity, FormSnapshot | null>();

// =============================================================================
// §18  Garrisoned
// =============================================================================
export const Garrisoned = defineComponent('Garrisoned', {
  /** Carrier/bunker entity (source bunkerEntity getter aliases this). */
  carrierEntity: 'u32',
  /** Bunker firing-slot index 0-3 (meaningless in transports). */
  slotIndex: { type: 'u32', default: 0 },
});

// =============================================================================
// §19  Transport
// =============================================================================
export const Transport = defineComponent('Transport', {
  capacity: 'u32',
  usedSlots: { type: 'u32', default: 0 },
  crashDamagePercent: { type: 'f32', default: 0 },
  canAttackFromInside: { type: 'bool', default: false },
  uiColumns: { type: 'u32', default: 4 },
  rightClickToLoad: { type: 'bool', default: false },
  rightClickToBoard: { type: 'bool', default: false },
  /** UnloadModeCode (UNLOAD_MODE.*). */
  unloadMode: { type: 'u32', default: UNLOAD_MODE.INSTANT },
  unloadInterval: { type: 'f32', default: 0.36 },
  ejectRadius: { type: 'f32', default: 2.5 },
  unloadTimer: { type: 'f32', default: 0 },
});
/** CTransport.units:Entity[] → companion (loaded units). */
export const transportUnits = new Map<Entity, Entity[]>();
/** CTransport.unloadQueue:Entity[] → companion (queued unload). */
export const transportUnloadQueue = new Map<Entity, Entity[]>();
/** CTransport.requiredUpgrade:string → companion ('' = none). */
export const transportRequiredUpgrade = new Map<Entity, string>();

// =============================================================================
// §20  Larva
// =============================================================================
export const Larva = defineComponent('Larva', {
  parentBuilding: 'u32',
  /** LarvaStateCode (LARVA_STATE.*). */
  state: { type: 'u32', default: LARVA_STATE.IDLE },
  morphProgress: { type: 'f32', default: 0 },
  morphTime: { type: 'f32', default: 0 },
  wiggleTimer: { type: 'f32', default: 0 },
  homeX: 'f32',
  homeZ: 'f32',
  wiggleTargetX: 'f32',
  wiggleTargetZ: 'f32',
});
/** CLarva.morphTypeId:string|null → companion (unit being hatched). */
export const larvaMorphTypeId = new Map<Entity, string | null>();

// =============================================================================
// §21  Hazard
// =============================================================================
export const Hazard = defineComponent('Hazard', {
  playerId: 'u32',
  hp: 'f32',
  maxHp: 'f32',
  remainingDuration: 'f32',
  maxDuration: 'f32',
  /** HazardShapeCode (HAZARD_SHAPE.*). */
  shape: 'u32',
  radius: 'f32',
  angle: { type: 'f32', default: Math.PI * 0.5 },
  width: { type: 'f32', default: 0.5 },
  height: { type: 'f32', default: 2.0 },
  dirX: 'f32',
  dirZ: 'f32',
  blocksMovement: { type: 'bool', default: true },
  blocksProjectiles: { type: 'bool', default: false },
  blocksAllFactions: { type: 'bool', default: false },
  areaInterval: { type: 'f32', default: 1.0 },
  areaTimer: { type: 'f32', default: 0 },
  casterEntity: 'u32',
});
/** CHazard.hazardTypeId:string → companion. */
export const hazardTypeId = new Map<Entity, string>();
/** CHazard.areaEffects:AbilityEffect[] → companion. */
export const hazardAreaEffects = new Map<Entity, AbilityEffect[]>();

// =============================================================================
// §22  GroundEffect
// =============================================================================
export const GroundEffect = defineComponent('GroundEffect', {
  playerId: 'u32',
  casterEntity: 'u32',
  radius: 'f32',
  remainingDuration: 'f32',
  maxDuration: 'f32',
});
/** CGroundEffect.typeId:string → companion (GROUND_EFFECT_TYPES key). */
export const groundEffectTypeId = new Map<Entity, string>();

// =============================================================================
// §22b DirectionWave (sonar-pulse style traveling wave — M17/M9 seam)
// =============================================================================
// A wave that propagates from its origin along a fixed normalized direction at
// `speed` up to `maxRange`, scanning a `width`-wide corridor behind its wavefront
// each frame and running `hitEffects` (companion) once per newly-hit enemy, and
// (optionally) revealing fog along its path. Port of the source direction_wave
// projectile branch (Projectile.ts / ProjectileSystem._updateDirectionWave).
export const DirectionWave = defineComponent('DirectionWave', {
  playerId: 'u32',
  casterEntity: 'u32',
  dirX: 'f32',
  dirZ: 'f32',
  originX: 'f32',
  originZ: 'f32',
  speed: 'f32',
  width: 'f32',
  maxRange: 'f32',
  traveled: { type: 'f32', default: 0 },
  revealRange: { type: 'f32', default: 0 },
  revealDuration: { type: 'f32', default: 5 },
  revealLastDist: { type: 'f32', default: 0 },
});
/** CDirectionWave.hitEffects:AbilityEffect[] → companion (run once per hit). */
export const directionWaveHitEffects = new Map<Entity, AbilityEffect[]>();
/** CDirectionWave per-wave unique-hit dedupe set (raw entity ids). */
export const directionWaveHitSet = new Map<Entity, Set<number>>();

// =============================================================================
// §23  CreepTumor
// =============================================================================
export const CreepTumor = defineComponent('CreepTumor', {
  radius: { type: 'f32', default: 2 },
});

// =============================================================================
// §24  Illusion
// =============================================================================
export const Illusion = defineComponent('Illusion', {
  damageTakenMultiplier: { type: 'f32', default: 1 },
  damageDealtMultiplier: { type: 'f32', default: 0.1 },
});

// =============================================================================
// §25  SummonedLifetime
// =============================================================================
export const SummonedLifetime = defineComponent('SummonedLifetime', {
  casterEntity: 'u32',
  remainingLife: 'f32',
  totalLife: 'f32',
});

// =============================================================================
// §26  UnitStats
// =============================================================================
export const UnitStats = defineComponent('UnitStats', {
  // base values (set by UnitFactory, immutable at runtime)
  baseMaxHp: { type: 'f32', default: 0 },
  baseMaxShield: { type: 'f32', default: 0 },
  baseMaxEnergy: { type: 'f32', default: 0 },
  baseArmor: { type: 'f32', default: 0 },
  baseShieldArmor: { type: 'f32', default: 0 },
  baseDamage: { type: 'f32', default: 0 },
  baseAttackCooldown: { type: 'f32', default: 1 },
  baseRange: { type: 'f32', default: 0 },
  baseMoveSpeed: { type: 'f32', default: 0 },
  baseTurnRate: { type: 'f32', default: Math.PI * 4 },
  baseVisionRange: { type: 'f32', default: 0 },
  baseSplashRadius: { type: 'f32', default: 0 },
  baseEnergyRegen: { type: 'f32', default: 0 },
  baseShieldRegen: { type: 'f32', default: 0 },
  baseShieldRegenDelay: { type: 'f32', default: 7.0 },
  // final values (recomputed each frame by StatModifierSystem)
  finalMaxHp: { type: 'f32', default: 0 },
  finalMaxShield: { type: 'f32', default: 0 },
  finalMaxEnergy: { type: 'f32', default: 0 },
  finalArmor: { type: 'f32', default: 0 },
  finalShieldArmor: { type: 'f32', default: 0 },
  finalDamage: { type: 'f32', default: 0 },
  finalAttackCooldown: { type: 'f32', default: 1 },
  finalRange: { type: 'f32', default: 0 },
  finalMoveSpeed: { type: 'f32', default: 0 },
  finalVisionRange: { type: 'f32', default: 0 },
  finalSplashRadius: { type: 'f32', default: 0 },
  finalEnergyRegen: { type: 'f32', default: 0 },
  finalShieldRegen: { type: 'f32', default: 0 },
  finalShieldRegenDelay: { type: 'f32', default: 7.0 },
  // buff multipliers
  finalDamageTakenMult: { type: 'f32', default: 1.0 },
  finalSpellDamageTakenMult: { type: 'f32', default: 1.0 },
  finalNormalDamageTakenMult: { type: 'f32', default: 1.0 },
  finalHealPowerMult: { type: 'f32', default: 1.0 },
  finalHealRateMult: { type: 'f32', default: 1.0 },
  // upgrade bonuses (UpgradeManager → StatModifierSystem)
  upgradeAttackBonus: { type: 'f32', default: 0 },
  upgradeArmorBonus: { type: 'f32', default: 0 },
  upgradeRangeBonus: { type: 'f32', default: 0 },
  /**
   * Last game-time this unit was in combat. Source default is -Infinity
   * ("never fought"); f32 storage cannot hold -Infinity faithfully, so the
   * stored sentinel is a large negative finite number — OutOfCombatSystem
   * compares `now - lastCombatTime > threshold`, which holds identically.
   */
  lastCombatTime: { type: 'f32', default: -1e30 },
});

// =============================================================================
// Import-safety guard
// =============================================================================
// M2 only DEFINES the components; gameplay wiring lands in M3+. This guard makes
// the module import-safe and verifiable in isolation: every component token is
// referenced so the registry actually runs at import time (defineComponent has
// side effects — it allocates a global ComponentId), and a typo in any schema
// surfaces immediately rather than silently at first spawn.
export const MARSCRAFT_COMPONENTS = [
  Motion, Renderable, Selectable, Movement, Faction, Command, Health, Attack,
  Projectile, UnitType, Building, Mineral, Geyser, Harvester, Abilities, Energy,
  Form, Garrisoned, Transport, Larva, Hazard, GroundEffect, DirectionWave, CreepTumor, Illusion,
  SummonedLifetime, UnitStats,
] as const;

/** Number of forgeax components defined by this module (sanity guard). */
export const MARSCRAFT_COMPONENT_COUNT = MARSCRAFT_COMPONENTS.length;
