/**
 * M9 ability data table — ported verbatim from web/data/abilities.ts.
 *
 * Defines all active/passive abilities. Structure (types + data) is copied
 * 1:1 from the source Three.js game; only the natural-language Chinese text
 * (displayName / description / comments) has been translated to English.
 * No logic, numeric values, field names, ids, or ordering were changed.
 *
 * Note: range and splash-radius modifier values use world units (cells x RANGE_SCALE).
 *
 * Effect types (atomic effects):
 *   damage / heal / apply_buff / apply_debuff / remove_buff / spawn_unit /
 *   morph / cloak / decloak / teleport / area_damage / area_effect / stun /
 *   drain / toggle / knockback / modify_energy / spawn_hazard / restore_shield
 *   (and recall / spawn_direction_wave / transport_* / form_switch /
 *    spawn_ground_effect / kill_self).
 *
 * This file is self-contained: it has NO external imports.
 */

// ============================================================================
// Type definitions
// ============================================================================

/** Ability target type */
export type AbilityTargetType =
  | 'none'          // no target (self-cast, e.g. Stimpack)
  | 'point'         // ground point (e.g. nuke, Psionic Storm)
  | 'unit'          // unit target (e.g. lock-on, heal)
  | 'unit_or_point' // unit or ground point (e.g. EMP)
  | 'direction'     // direction type (e.g. arc field, sonar pulse) — click ground to set direction, targetX/Z store the normalized direction vector

/** Target faction filter */
export type TargetFilter =
  | 'self'     // self only
  | 'ally'     // allies
  | 'enemy'    // enemies
  | 'any'      // any
  | 'neutral'  // neutral

/** Target unit-type filter */
export type TargetUnitFilter =
  | 'any'
  | 'ground'
  | 'air'
  | 'biological'
  | 'mechanical'
  | 'building'
  | 'infantry'
  | 'worker'
  | 'vehicle'
  | 'hasEnergy'
  | 'groundNonMassive'

// ============================================================================
// Buff VFX config (declarative, auto-driven create/destroy by BuffSystem)
// ============================================================================

/** Buff-attached emissive tint (overall tinting) */
export interface BuffTintVFX {
  color: number
  intensity: number
}

/** Buff-attached sustained particle effect */
export interface BuffParticleVFX {
  color: number
  color2?: number
  /** Particle size */
  size: number
  /** Spawn interval (seconds) */
  interval: number
  /** Particle velocity direction: 'up' float upward | 'down' drip downward | 'radial' spread outward */
  direction: 'up' | 'down' | 'radial'
  /** Particle speed */
  speed: number
  /** Particle lifetime (seconds) */
  lifetime: number
  /** Blend mode */
  blending?: 'additive' | 'normal'
}

/** Buff-attached overhead marker */
export interface BuffMarkerVFX {
  color: number
  /** Marker shape */
  shape: 'diamond' | 'circle' | 'ring'
  size: number
  /** Whether it spins */
  spin?: boolean
  /** Whether it pulses in scale */
  pulse?: boolean
}

/** Buff-attached ground ring at the feet */
export interface BuffGroundRingVFX {
  color: number
  radius: number
  /** Whether it pulses */
  pulse?: boolean
}

/** One-shot burst effect at the moment the buff activates */
export interface BuffBurstVFX {
  /** Burst particle color */
  color: number
  /** Particle count */
  count: number
  /** Particle size */
  size: number
  /** Spread speed */
  speed: number
  /** Ground ring at the feet */
  ring?: { color: number; radius: number; duration: number }
}

/** Full buff VFX config */
export interface BuffVFXConfig {
  /** Overall tint (during the duration) */
  tint?: BuffTintVFX
  /** Sustained particle effect */
  particles?: BuffParticleVFX
  /** Overhead marker */
  marker?: BuffMarkerVFX
  /** Ground ring at the feet */
  groundRing?: BuffGroundRingVFX
  /** Burst at the moment of activation */
  burst?: BuffBurstVFX
}

// ============================================================================
// Effect definitions
// ============================================================================

/** Base effect interface */
export interface AbilityEffectBase {
  type: string
}

/** Damage effect */
export interface DamageEffect extends AbilityEffectBase {
  type: 'damage'
  amount: number
  damageType: 'normal' | 'spell'  // spell ignores armor
  /** Whether it deals damage to self (e.g. Stimpack) */
  selfDamage?: boolean
}

/** Heal effect */
export interface HealEffect extends AbilityEffectBase {
  type: 'heal'
  amount: number
  /** Sustained heal (per second) */
  perSecond?: boolean
}

/** Apply-buff effect */
export interface ApplyBuffEffect extends AbilityEffectBase {
  type: 'apply_buff'
  buffId: string
  duration: number       // seconds, 0 = permanent
  /** Specific buff effects */
  modifiers: BuffModifier[]
  /** Trigger list — reactive triggers active while the buff persists (optional) */
  triggers?: TriggerDef[]
  /**
   * Stack mode (default 'refresh')
   * - refresh: only 1 buff of the same name exists; re-applying refreshes duration
   * - stack: stacks layers of the same-name buff; effect scales with layer count, a new layer refreshes the timer of all layers
   * - independent: multiple same-name buffs coexist independently, each timing independently
   */
  stackMode?: 'refresh' | 'stack' | 'independent'
  /** Max layers in stack mode (default 1) */
  maxStacks?: number
  /** Attached VFX config (auto-plays while buff persists, auto-cleaned on expiry) */
  vfx?: BuffVFXConfig
}

/** Apply-debuff effect */
export interface ApplyDebuffEffect extends AbilityEffectBase {
  type: 'apply_debuff'
  debuffId: string
  duration: number
  modifiers: BuffModifier[]
  /** Trigger list — reactive triggers active while the debuff persists (optional) */
  triggers?: TriggerDef[]
  /**
   * Stack mode (default 'refresh')
   * - refresh: only 1 debuff of the same name exists; re-applying refreshes duration
   * - stack: stacks layers of the same-name debuff; effect scales with layer count, a new layer refreshes the timer of all layers
   * - independent: multiple same-name debuffs coexist independently, each timing independently
   */
  stackMode?: 'refresh' | 'stack' | 'independent'
  /** Max layers in stack mode (default 1) */
  maxStacks?: number
  /** Attached VFX config (auto-plays while debuff persists, auto-cleaned on expiry) */
  vfx?: BuffVFXConfig
}

/** Remove-buff effect */
export interface RemoveBuffEffect extends AbilityEffectBase {
  type: 'remove_buff'
  buffId: string
  /** Remove all buffs (regardless of ID) */
  removeAll?: boolean
}

/** Spawn-unit effect */
export interface SpawnUnitEffect extends AbilityEffectBase {
  type: 'spawn_unit'
  unitTypeId: string
  count: number
  /** Offset relative to the caster (used when spawnAtTarget=false) */
  offsetX?: number
  offsetZ?: number
  /** Spawn at the target location (instead of the caster's location) */
  spawnAtTarget?: boolean
  /** Immediately attack CastContext.targetEntity after spawning */
  autoAttackTarget?: boolean
  /** Inherit the caster's HP/Shield (for clones, etc.) */
  inheritCasterStats?: boolean
  /** Lifetime (seconds), auto-destroyed on expiry; permanent if unset */
  lifetime?: number
  /** Damage-taken multiplier (e.g. 2.5 means takes 250% damage, for clones) */
  damageTakenMultiplier?: number
  /** Damage-dealt multiplier (e.g. 0.1 means deals only 10% damage, for clones) */
  damageDealtMultiplier?: number
}

/** Morph effect */
export interface MorphEffect extends AbilityEffectBase {
  type: 'morph'
  /** Target morph form ID */
  targetFormId: string
  /** Morph time (seconds, 0 = instant) */
  morphTime: number
}

/** Cloak effect */
export interface CloakEffect extends AbilityEffectBase {
  type: 'cloak'
  /** Energy cost per second (to maintain cloak) */
  energyPerSecond: number
  /** Whether to temporarily decloak when attacking (default false) */
  breakOnAttack?: boolean
  /** Delay (seconds) to auto-recloak after decloaking on attack (default 2) */
  recloakDelay?: number
}

/** Decloak effect */
export interface DecloakEffect extends AbilityEffectBase {
  type: 'decloak'
}

/** Teleport effect */
export interface TeleportEffect extends AbilityEffectBase {
  type: 'teleport'
  /** Teleport range limit (0 = no limit) */
  maxRange: number
  /**
   * Facing rule after teleport:
   * - 'movement_dir' (default): face the teleport direction (from start to end)
   * - 'keep': keep the pre-teleport facing unchanged
   */
  facingAfter?: 'movement_dir' | 'keep'
}

/** Recall effect (Nexus Recall): teleport allied units near the target point to the caster's location */
export interface RecallEffect extends AbilityEffectBase {
  type: 'recall'
  /** Recall search radius */
  radius: number
}

/** Area-damage effect (damage only, simplified) */
export interface AreaDamageEffect extends AbilityEffectBase {
  type: 'area_damage'
  radius: number
  damagePerSecond: number
  duration: number
  damageType: 'normal' | 'spell'
}

/**
 * Generic area effect — executes a set of sub-effects on each target within the area
 *
 * Difference from area_damage:
 * - area_damage can only deal damage
 * - area_effect can execute any combination of sub-effects (damage + buff + knockback + heal ...)
 *
 * Use cases:
 * - Prismatic Strike (area damage) → effects: [{ type: 'damage', ... }]
 * - Medical Station (area heal)     → effects: [{ type: 'heal', ... }]
 * - Slow Field (area slow)          → effects: [{ type: 'apply_debuff', ... }]
 * - Earth Shatter (damage+knockback)→ effects: [{ type: 'damage', ... }, { type: 'knockback', ... }]
 */
export interface AreaEffectDef extends AbilityEffectBase {
  type: 'area_effect'
  /** Area shape */
  shape: 'circle' | 'cone' | 'line'
  /** Area radius (circle/cone=R, line=length) */
  radius: number
  /** Cone angle (cone only) */
  angle?: number
  /** Line width (line only) */
  width?: number
  /** Falloff steps (evenly divides the range from inner to outer); unset = [1.0] (full hit) */
  falloff?: number[]
  /** Target filter: enemy / ally / any */
  targetFilter: 'enemy' | 'ally' | 'any'
  /** Sub-effects executed on each hit target */
  effects: AbilityEffect[]
  /** Whether to apply the falloff coefficient to damage in sub-effects (default false, i.e. full effect) */
  applyFalloffToDamage?: boolean
  /** Max number of targets hit (unset = no limit) */
  maxHits?: number
  /** Exclude the targetEntity in CastContext (avoids the main target being hit twice, used for bounces, etc.) */
  excludeTarget?: boolean
  /** Weapon ID for the splash VFX (unset = no visual effect) */
  splashVfxId?: string
}

/** Stun/snare effect */
export interface StunEffect extends AbilityEffectBase {
  type: 'stun'
  duration: number
  /** Whether it can be dispelled */
  dispellable: boolean
}

/** Drain effect */
export interface DrainEffect extends AbilityEffectBase {
  type: 'drain'
  /** Drain type */
  drainType: 'energy' | 'hp'
  amountPerSecond: number
  duration: number
}

/** Toggle-state effect */
export interface ToggleEffect extends AbilityEffectBase {
  type: 'toggle'
  /** State ID (e.g. siege_mode) */
  stateId: string
  /** Toggle time (seconds, 0 = instant) */
  toggleTime: number
  /** Buff modifiers applied on activation (auto-removed on deactivation) */
  onActivateModifiers?: BuffModifier[]
}

/**
 * Knockback effect — pushes the target unit away in a specified direction
 *
 * Execution logic:
 * 1. Compute direction (away from caster / away from target point)
 * 2. Compute landing point = current position + direction x distance
 * 3. Clamp to map boundary / passability
 * 4. Reuse CMovement.pushTo() to perform the displacement
 * 5. Apply a brief stun (cannot act during knockback)
 */
export interface KnockbackEffect extends AbilityEffectBase {
  type: 'knockback'
  /** Knockback distance (world units) */
  distance: number
  /** Knockback speed (units/sec). Default 12 */
  speed?: number
  /** Knockback direction: away from caster / away from ability target point */
  direction: 'away_from_source' | 'away_from_target'
  /** Stun duration during knockback (seconds). 0 = no stun, unset = auto-compute distance/speed */
  stunDuration?: number
}

/**
 * Modify-energy effect — instantly modifies the target's energy value
 *
 * Use cases:
 * - Nexus Energy Overcharge (+75 energy)
 * - Sentry Psionic Drain (clear energy)
 * - Ghost EMP (clear energy)
 *
 * Note: this is a one-time operation, not a buff. Does not go through healPower/healRate bonuses.
 */
export interface ModifyEnergyEffect extends AbilityEffectBase {
  type: 'modify_energy'
  /** Modify amount: positive = restore, negative = drain, 'clear' = zero out */
  amount: number | 'clear'
  /** Apply to: default target (target entity), optionally self (the caster) */
  applyTo?: 'self' | 'target'
}

/**
 * Spawn-hazard/obstacle effect — spawns a physical entity at the specified location
 *
 * Use cases:
 * - Sentry Arc Barrier (destructible barrier, blocks ground units and low-trajectory projectiles)
 * - Ravager Corrosive Bile (sustained-damage area zone)
 *
 * The spawned entity has:
 * - HP (can be destroyed by attacks)
 * - Collision volume (blocks movement/projectiles)
 * - Lifecycle (auto-disappears on expiry)
 * - Optional area effects (sustained damage/slow, etc.)
 */
export interface SpawnHazardEffect extends AbilityEffectBase {
  type: 'spawn_hazard'
  /** Hazard type ID (used to look up the specific config) */
  hazardTypeId: string
  /** HP (0 = indestructible) */
  hp: number
  /** Duration (seconds, 0 = permanent until destroyed) */
  duration: number
  /** Collision shape */
  shape: 'circle' | 'arc' | 'line'
  /** Collision radius/length */
  radius: number
  /** Arc angle (shape='arc' only) */
  angle?: number
  /** Arc width / line width (shape='arc'/'line' only) */
  width?: number
  /** Height (for projectile-interception checks; trajectories below this height are intercepted) */
  height?: number
  /** Whether it blocks ground unit movement */
  blocksMovement?: boolean
  /** Whether it blocks low-trajectory projectiles */
  blocksProjectiles?: boolean
  /** Block all factions (true = blocks allies and enemies, e.g. force field; false = blocks enemies only, e.g. mines). Default false */
  blocksAllFactions?: boolean
  /** Area effects (executed per second on enemies in range) */
  areaEffects?: AbilityEffect[]
  /** Area effect interval (seconds) */
  areaInterval?: number
  /** Visual style (the render layer picks a presentation by this field; defaults to plain box if unset) */
  visualStyle?: 'energy_shield' | 'solid'
  /** Visual params (interpreted differently per visualStyle) */
  visualParams?: {
    /** Main color (CSS hex, e.g. '#2288cc') */
    color?: string
    /** Edge/highlight color */
    edgeColor?: string
    /** Color when near-shattered */
    criticalColor?: string
    /** Whether to show HP-degradation cracks (default true) */
    showCracks?: boolean
    /** Whether to play shatter particles on destruction (default true) */
    shatterOnDestroy?: boolean
  }
}

/**
 * Restore-shield effect — instantly restores the target's shield value
 *
 * Difference from heal:
 * - heal restores HP, goes through healPower/healRate bonuses
 * - restore_shield restores shield, ignores heal bonuses, directly restores a fixed value
 *
 * Use cases:
 * - Shield Battery charging
 */
export interface RestoreShieldEffect extends AbilityEffectBase {
  type: 'restore_shield'
  /** Restore amount */
  amount: number
  /** Apply to: default target */
  applyTo?: 'self' | 'target'
}

/**
 * Spawn-direction-wave effect — fires a wave projectile in a specified direction
 *
 * Use cases:
 * - Corruptor Sonar Pulse (propagates along a direction, exposing cloaked units along the path)
 * - Other "propagate along a direction, applying effects along the path" abilities
 *
 * The wave projectile continuously detects enemy units along the path during flight,
 * executing hitEffects on each newly hit unit (each unit triggers only once).
 *
 * Note: this effect requires CastContext's targetX/targetZ to be a normalized direction vector
 * (auto-converted by AbilitySystem for direction-type abilities).
 */
export interface SpawnDirectionWaveEffect extends AbilityEffectBase {
  type: 'spawn_direction_wave'
  /** Wave propagation speed (world units/sec) */
  speed: number
  /** Max wave propagation distance (world units) */
  maxRange: number
  /** Wave width (world units) */
  width: number
  /** Sub-effects executed when the wave hits each target */
  hitEffects: AbilityEffect[]
  /** Projectile visual identifier (for VFX) */
  weaponId?: string
  /** Wave-path reveal vision radius (world units); 0 or unset = no reveal */
  revealRange?: number
  /** Wave-path reveal duration (seconds), default 5 */
  revealDuration?: number
}

/** Transport-load effect — loads the target friendly unit into the transport vehicle */
export interface TransportLoadEffect extends AbilityEffectBase {
  type: 'transport_load'
}

/** Transport-unload effect — unloads all units inside the transport vehicle */
export interface TransportUnloadEffect extends AbilityEffectBase {
  type: 'transport_unload'
}

/** Form-switch effect — triggers a reversible form switch */
export interface FormSwitchEffect extends AbilityEffectBase {
  type: 'form_switch'
  /** Target form ID (corresponds to UnitDef.forms[].formId) */
  formId: string
}

/** Spawn-ground-effect effect — creates a persistent ground area effect at the target location */
export interface SpawnGroundEffectEffect extends AbilityEffectBase {
  type: 'spawn_ground_effect'
  /** Ground effect type ID (corresponds to the GROUND_EFFECT_TYPES registry) */
  groundEffectId: string
  /** Duration (seconds) */
  duration: number
  /** Affected radius (world units) */
  radius: number
}

/** Union type of all effects */
export type AbilityEffect =
  | DamageEffect
  | HealEffect
  | ApplyBuffEffect
  | ApplyDebuffEffect
  | RemoveBuffEffect
  | SpawnUnitEffect
  | MorphEffect
  | CloakEffect
  | DecloakEffect
  | TeleportEffect
  | RecallEffect
  | AreaDamageEffect
  | AreaEffectDef
  | StunEffect
  | DrainEffect
  | ToggleEffect
  | KnockbackEffect
  | ModifyEnergyEffect
  | SpawnHazardEffect
  | RestoreShieldEffect
  | SpawnDirectionWaveEffect
  | TransportLoadEffect
  | TransportUnloadEffect
  | FormSwitchEffect
  | SpawnGroundEffectEffect
  | KillSelfEffect

export interface KillSelfEffect extends AbilityEffectBase {
  type: 'kill_self'
}

// ============================================================================
// Trigger definitions (Trigger System)
// ============================================================================

/**
 * Trigger event type — defines "when it triggers"
 *
 * Each event maps to an actual game event on the EventBus:
 * - on_ability_cast  → ability:used
 * - on_attack_hit    → combat:attack_hit (when AttackSystem fires a hit)
 * - on_damage_dealt  → combat:damage (after dealing damage)
 * - on_damage_taken  → combat:damage_taken (after taking damage)
 * - on_kill          → combat:kill
 * - on_death         → entity:destroyed
 * - on_buff_applied  → ability:buff_applied
 * - on_buff_expired  → ability:buff_removed
 * - on_interval      → TriggerSystem times it itself
 */
export type TriggerEvent =
  | 'on_ability_cast'
  | 'on_attack_hit'
  | 'on_damage_dealt'
  | 'on_damage_taken'
  | 'on_kill'
  | 'on_death'
  | 'on_buff_applied'
  | 'on_buff_expired'
  | 'on_interval'

/**
 * Trigger conditions — all conditions are AND'd; triggers only when all are satisfied
 */
export type TriggerCondition =
  | { type: 'ability_id'; abilityId: string }                       // the cast ability ID matches
  | { type: 'buff_id'; buffId: string }                             // the buffId in the event matches (for on_buff_applied/on_buff_expired)
  | { type: 'unit_type'; typeIds: string[] }                        // own unit type ∈ [X]
  | { type: 'target_type'; typeIds: string[] }                      // target unit type ∈ [X]
  | { type: 'has_buff'; buffId: string }                            // self has a certain buff
  | { type: 'no_buff'; buffId: string }                             // self does not have a certain buff
  | { type: 'hp_below'; percent: number }                           // own HP < X%
  | { type: 'hp_above'; percent: number }                           // own HP > X%
  | { type: 'shield_below'; percent: number }                       // own shield < X%
  | { type: 'shield_above'; percent: number }                       // own shield > X%
  | { type: 'probability'; chance: number }                         // probability (0~1)
  | { type: 'upgrade_level'; upgradeId: string; min: number }       // upgrade level >= X
  // ── P0 new conditions ──
  | { type: 'is_on_creep' }                                         // self is on creep
  | { type: 'is_out_of_combat'; thresholdSec?: number }             // self out of combat (default 5s)
  | { type: 'target_combat_type'; combatTypes: string[] }           // target combatType ∈ [X]
  | { type: 'nearby_unit_count'; radius: number; filter: 'ally' | 'enemy' | 'any'; min?: number; max?: number } // nearby unit count
  | { type: 'stat_check'; stat: string; op: '>=' | '<=' | '>' | '<' | '=='; value?: number; percent?: number; target?: 'self' | 'target' } // generic stat condition

/**
 * Effect application target
 * - self: the entity the trigger belongs to
 * - event_target: the target associated with the event (e.g. the attacked entity, the ability's target)
 * - event_source: the source of the event (e.g. the damage source, for reflect-style triggers)
 */
export type TriggerEffectTarget = 'self' | 'event_target' | 'event_source'

/**
 * Trigger definition — full config
 *
 * Triggers can be attached to:
 * 1. AbilityDef.triggers — ability-level triggers
 * 2. ApplyBuffEffect.triggers / ActiveBuff.triggers — buff-level triggers
 * 3. UnitPassiveDef — unit passive triggers (via the passives.ts data table)
 */
export interface TriggerDef {
  /** Unique trigger ID (for cooldown tracking and debugging) */
  id: string
  /** Which event triggers it */
  event: TriggerEvent
  /** Condition list (AND'd, all must be satisfied to execute effects) */
  conditions?: TriggerCondition[]
  /** Atomic effects executed when triggered (reuses the existing AbilityEffect types) */
  effects: AbilityEffect[]
  /** Effect application target */
  effectTarget: TriggerEffectTarget
  /** Built-in trigger cooldown (seconds) to prevent overly frequent triggering */
  cooldown?: number
  /** on_interval only: period interval (seconds) */
  interval?: number
}

// ============================================================================
// Buff/Debuff modifiers
// ============================================================================

/**
 * Buff modifier — affects unit stats
 *
 * SC2-style rules:
 * - 'add' mode: direct additive stacking (armor +1, damage +1)
 * - 'multiply' mode: percentage additive stacking
 *   value is a percentage increment (0.5 = +50%); percentages of multiple same-type buffs add rather than multiply
 *   final effect computed by the consumer:
 *     attack speed: cooldown = base cooldown / (1 + sum of percentages)
 *     move speed:   speed = base speed x (1 + sum of percentages)
 */
export interface BuffModifier {
  /** The modified stat */
  stat: BuffStat
  /** Modify method: 'add' = direct addition, 'multiply' = percentage additive stacking */
  mode: 'add' | 'multiply'
  /** Modify value: absolute value in add mode, percentage increment in multiply mode (0.5 = +50%) */
  value: number
}

/** Stats that can be modified by buffs */
export type BuffStat =
  | 'attackSpeed'     // attack speed (percentage bonus, 0.5 = +50% attack speed)
  | 'moveSpeed'       // move speed (percentage bonus, 0.5 = +50% move speed)
  | 'armor'           // armor
  | 'damage'          // damage
  | 'range'           // range
  | 'splashRadius'    // splash radius
  | 'visionRange'     // vision
  | 'healPower'       // caster's heal-strength bonus (percentage bonus, 0.25 = +25% heal amount)
  | 'healRate'        // recipient's heal multiplier (percentage, -1 = no heal, -0.5 = -50% heal)
  | 'energyRegen'     // energy regen rate
  | 'shieldRegen'     // shield regen rate
  | 'shieldRegenDelay' // shield recovery delay (seconds, add: -2.5 = delay shortened by 2.5s)
  | 'damageTaken'     // damage-taken modifier (percentage bonus, 0.2 = +20% damage taken/vulnerability, -0.3 = -30% damage taken) — applies to all damage types
  | 'spellDamageTaken' // spell-damage-taken modifier (applies only to spell damage, -0.2 = -20% spell damage)
  | 'normalDamageTaken' // normal-damage-taken modifier (applies only to normal damage, -0.2 = -20% normal damage)
  // ── new: resource max values ──
  | 'maxHp'           // max HP (add: +50HP, multiply: +20%HP)
  | 'maxShield'       // max shield
  | 'maxEnergy'       // max energy
  // ── new: other trait types ──
  | 'shieldArmor'     // shield armor
  | 'turnRate'        // turn rate
  // ── new: boolean markers (do not go through StatModifierSystem; queried by CAbilities.hasDetector()/isRevealed()) ──
  | 'isDetector'      // detector marker (effective as long as the buff exists, value is meaningless)
  | 'isRevealed'      // revealed marker (effective as long as the debuff exists, value is meaningless)
  | 'bounceCount'     // bounce-count bonus (add: +N bounces, added on top of the weapon's base bounceCount)

// ============================================================================
// Attack modifier definition (Attack Modifier / Orb Effect)
// ============================================================================

/**
 * Attack modifier (orb) config
 *
 * Mechanics (similar to DOTA2 orbs):
 * 1. Player right-clicks to activate/cancel → ability icon highlights
 * 2. After activation, on each attack initiation check energy:
 *    - energy ≥ energyCost → deduct energy + projectile carries the orb effect
 *    - insufficient energy → normal attack (no energy deducted, activation state not canceled)
 * 3. Orb effect is attached on attack initiation (when the projectile is created), not on hit
 *
 * Difference from Toggle:
 * - does not change unit stats (no modifiers)
 * - does not continuously drain energy (only consumed on attack)
 * - insufficient energy does not close the activation state
 */
export interface AttackModifierConfig {
  /** Energy consumed per attack */
  energyCost: number
  /** Orb's attached effects (executed on the target on hit) */
  effects: AbilityEffect[]
  /** Orb's extra damage (added on top of base damage, applied when the projectile is created) */
  damageBonus?: number
  /** Orb projectile VFX weapon ID (for distinguishing trail/hit-flash color) */
  orbWeaponId?: string
}

// ============================================================================
// Sustained phase definition (Sustained Phase)
// ============================================================================

/** Sustained-phase movement mode */
export type SustainedMovement = 'stationary' | 'free' | 'dash'

/**
 * Dash config (valid only when movement = 'dash')
 */
export interface DashConfig {
  /** Dash speed (world units/sec) */
  speed: number
  /** Dash target mode: track target entity / target point / current facing */
  target: 'target_entity' | 'target_point' | 'forward'
  /** Max dash distance (world units), undefined = no limit */
  maxDistance?: number
  /** Mid-path collision effects (executed when hitting enemies along the path) */
  pathEffects?: AbilityEffect[]
  /** Mid-path collision detection radius */
  pathHitRadius?: number
  /** Effects executed on reaching the target */
  arrivalEffects?: AbilityEffect[]
  /** Trail effects spawned at fixed intervals along the dash path (e.g. flame trail), independent of hitting enemies */
  trailEffects?: AbilityEffect[]
  /** Trail effect spawn spacing (world units, default 1.5) */
  trailInterval?: number
  /** Whether to ignore terrain obstacles (cliffs/highground); true = can fly over terrain, false = stop on hitting a cliff (default false) */
  ignoreCliffs?: boolean
}

/**
 * Sustained-phase config — unifies channeling / whirlwind / dash
 *
 * The sustained phase is after the "effect point": cost already deducted, cooldown already set, effects already executed.
 * In this phase the caster is in a special state (movement restrictions, periodic effects, special stats).
 *
 * Three movement modes:
 * - stationary (stand-and-channel): cannot move; move/stop/hold/stun can interrupt
 * - free (move-channel): can move freely, cannot attack/cast; stun can interrupt
 * - dash (forced displacement): not controllable; stun can interrupt (unless unstoppable)
 */
export interface SustainedPhase {
  /** Duration (seconds) */
  duration: number

  /** Movement mode */
  movement: SustainedMovement

  // ---- Periodic effects ----
  /** Periodic effect trigger interval (seconds), undefined = no periodic effects */
  interval?: number
  /** Effects executed each interval (caster-centered area_damage, etc.) */
  intervalEffects?: AbilityEffect[]

  // ---- Phase-end effects ----
  /** Effects executed when the sustained phase ends naturally */
  completionEffects?: AbilityEffect[]
  /** Effects executed when an early-completion condition triggers (e.g. energy drained dry → stun); does not trigger on natural expiry */
  onEarlyCompleteEffects?: AbilityEffect[]
  /** Effects executed when the sustained phase is interrupted (e.g. remove the mind_control buff) */
  onInterruptEffects?: AbilityEffect[]

  // ---- Dash config (movement = 'dash' only) ----
  dash?: DashConfig

  // ---- Caster restrictions ----
  /** Whether the caster can attack during the duration (default false) */
  canAttack?: boolean
  /** Whether the caster can cast other abilities during the duration (default false) */
  canCastOther?: boolean

  // ---- Sustained energy cost ----
  /** Energy cost per second during the sustained phase (0/undefined = no cost); auto-interrupts when energy runs out */
  energyPerSecond?: number

  // ---- Target tracking ----
  /** Continuously track CastContext.targetEntity (death/out-of-range → interrupt) */
  trackTarget?: boolean
  /** Track-break distance (world units, default = ability castRange) */
  trackRange?: number
  /** Whether to keep facing the target during channeling (default false, recommended on when trackTarget=true) */
  faceTarget?: boolean

  // ---- Interrupt conditions ----
  /** Whether stun interrupts (default true) */
  interruptOnStun?: boolean
  /**
   * Whether player commands (stop/hold) interrupt
   * Default: stationary → true, free / dash → false
   */
  interruptOnCommand?: boolean
  /** Any command (move/attack/ability/stop/hold) interrupts (default false) */
  interruptOnAnyCommand?: boolean

  // ---- Special stats during the duration ----
  /** Magic immunity (whirlwind) */
  magicImmune?: boolean
  /** Invulnerable */
  invulnerable?: boolean
  /** Unstoppable / crowd-control immune (immune to stun, knockback, etc.) */
  unstoppable?: boolean

  // ---- Early-completion conditions (trigger completionEffects, not interrupt) ----
  /** Complete channeling early when the target's energy reaches zero (e.g. Psionic Drain: drain energy dry → stun) */
  completeWhenTargetEnergyDepleted?: boolean
  /** Complete channeling early when the target reaches full HP (e.g. heal: target full HP → stop) */
  completeWhenTargetFullHp?: boolean

  // ---- Hit de-duplication ----
  /**
   * Whether to prevent duplicate hits for the whole duration — the same target receives the effect only once during this cast's entire sustained phase.
   *
   * When enabled, AbilitySystem creates a hitSet on the CastContext;
   * dash-path collisions, intervalEffects' area_effect, etc. all share this set.
   *
   * Typical case: dash-path knockback (earth_shatter) — enemies are knocked back once rather than hit repeatedly every frame.
   * Default false.
   */
  uniqueHits?: boolean

  // ---- UI ----
  /**
   * Whether to show a progress bar
   * Default: stationary → true, free / dash → false
   */
  showProgressBar?: boolean
}

// ============================================================================
// Ability definition
// ============================================================================

export interface AbilityDef {
  /** Unique ability ID */
  id: string
  /** Display name */
  displayName: string
  /** Icon (emoji or image path) */
  icon: string
  /** Hotkey (KeyCode, e.g. 'KeyT') */
  hotkey: string
  /** Hotkey display character */
  hotkeyLabel: string
  /** Ability description */
  description: string

  // ---- Cast conditions ----
  /** Energy cost */
  energyCost: number
  /** HP cost (e.g. Stimpack) */
  hpCost: number
  /** Cooldown (seconds) */
  cooldown: number
  /** Prerequisite research ID (empty = no research needed) */
  requiredUpgrade: string
  /** List of unit types that can use this ability */
  allowedUnits: string[]

  // ---- Target ----
  targetType: AbilityTargetType
  /** Cast range (0 = unlimited/self) */
  castRange: number
  /** Target faction filter */
  targetFilter: TargetFilter
  /** Target unit-type filter */
  targetUnitFilter: TargetUnitFilter

  // ---- Effects ----
  effects: AbilityEffect[]

  /** Trigger list — ability-level triggers (optional). Unlike effects, triggers are reactive,
   *  executed only when a specific game event occurs, not immediately on cast */
  triggers?: TriggerDef[]

  /** Whether it is a toggle-type ability (e.g. Siege Mode) */
  isToggle: boolean
  /** Energy cost per second while Toggle is active (0 or undefined = no cost) */
  toggleEnergyCost?: number
  /** Whether it is an autocast ability (e.g. Medic heal) */
  isAutocast: boolean
  /** Whether it is a passive ability (auto-activated, cannot be manually cast)
   *
   * Passive ability activation rules:
   * 1. requiredUpgrade === '' → activates immediately when the unit is created
   * 2. requiredUpgrade !== '' → activates after the upgrade research completes (existing units take effect immediately)
   *
   * On activation, executes the effects list (usually a permanent buff of apply_buff + triggers)
   */
  isPassive: boolean

  /**
   * Attack modifier (orb) config — optional
   *
   * If set, this ability is an orb-type ability:
   * - after activation, consumes energy and attaches effects on each attack initiation
   * - performs a normal attack when energy is insufficient, without canceling the activation state
   * - mutually exclusive with isToggle
   */
  attackModifier?: AttackModifierConfig

  // ---- Caster Phases ----
  /**
   * Whether to face the target at the moment of casting (default true).
   * When set to false, instant casts and the start of the windup do not turn toward the target.
   * Typical use: self-cast abilities (Stimpack) need no turning.
   */
  faceTarget?: boolean
  /**
   * Windup time (seconds); 0 or undefined is an instant cast.
   * During the windup the caster must stay still; if interrupted (stop/hold/knockback) the cost is refunded and no cooldown begins.
   * After the windup completes, the "effect point" begins: cost confirmed, cooldown starts, effects execute.
   */
  castTime?: number
  /**
   * Whether the windup can be canceled by stop/hold commands (default true).
   * When set to false, stop/hold commands are ignored during the windup (only external force pushing can still interrupt).
   * Typical use: form-switch abilities (the morph process cannot be canceled).
   */
  channelingCancelable?: boolean
  /**
   * Sustained phase (sustained behavior after the effect point), undefined = no sustained phase.
   *
   * Entered after effects finish executing. Three modes:
   * - stationary: stand-and-channel (the channel-maintain part of Psionic Storm, Neural Parasite)
   * - free: move-channel (whirlwind, Garen E) — can move, cannot attack/cast
   * - dash: forced displacement (charge, lunge) — not controllable
   */
  sustained?: SustainedPhase
  /**
   * Backswing time (seconds), pure animation delay.
   * The backswing does not block move commands; any player command can cancel the backswing (animation cancel).
   * Auto-attack is paused during the backswing.
   */
  backswing?: number

  /**
   * Whether to clear the current command queue after casting the ability (default false).
   *
   * When set to true, after the ability's effect point executes it clears CCommand (current command + queue),
   * preventing the unit from continuing to execute old commands after the ability finishes (e.g. walking back after a blink).
   * Typical use: blink/teleport-type instant abilities.
   */
  clearCommandOnCast?: boolean

  /**
   * Batch-cast mode (default false).
   *
   * When set to true, after selecting multiple units and pressing the hotkey + clicking the target,
   * all available units cast the ability at the same target simultaneously, rather than being assigned one by one.
   * Suitable for point/unit/direction-type abilities that need the whole group to cast simultaneously (e.g. blink).
   *
   * Note: abilities with targetType='none' are naturally whole-group casts and need no such config.
   */
  batchCast?: boolean

  /**
   * Whether, during batch-cast, to scatter each unit's target point by a formation grid (default false).
   *
   * Only takes effect when batchCast=true. When set to true, multiple units' target points are offset by a grid,
   * avoiding all units teleporting to and overlapping at the same location.
   * Typical use: blink (units teleport to the target point and need scattered landing points).
   * Not applicable to EMP/Psionic Storm, etc. (multiple units casting on the same point is correct behavior).
   */
  batchSpread?: boolean

  /** AOE range-preview radius (point-type abilities show a semi-transparent circle at the mouse position) */
  aimPreviewRadius?: number

  /** Direction/shape preview config (optional; auto-derived by priority if absent) */
  aimPreview?: AimPreview

  /**
   * Ability projectile config — optional
   *
   * If set, the ability effect is not executed immediately on cast completion;
   * instead, a projectile is launched from the caster's position flying toward the target point,
   * and the effects list executes on arrival.
   *
   * Supports both straight-line and arc (parabolic) trajectories.
   */
  projectile?: AbilityProjectileConfig
}

export interface AbilityProjectileConfig {
  /** Projectile flight speed (world units/sec). Serves as fallback when flightTime is set */
  speed: number
  /** Whether to use an arc trajectory (parabola), default false (straight line) */
  arc?: boolean
  /** Arc height coefficient (larger = higher parabola), default 3.0 */
  arcHeight?: number
  /** Fixed flight time (seconds). When set, speed is back-computed from distance to guarantee the projectile lands after this time */
  flightTime?: number
  /** Projectile visual: shape, default 'sphere' */
  visualShape?: string
  /** Projectile visual: color, default 0x44aaff */
  visualColor?: number
  /** Projectile visual: size, default 0.3 */
  visualSize?: number
  /** Weapon ID (for VFX lookup), defaults to the ability id */
  weaponId?: string
}

export interface AimPreview {
  type: 'circle' | 'rect' | 'cone' | 'arc'
  radius?: number
  angle?: number
  width?: number
  length?: number
  color?: number
}

// ============================================================================
// Ability data
// ============================================================================

/** Stimpack — Marine/Firebat
 * spec §12.5: lasts 6s, cooldown 12s, hpCost=10, attackSpeed +35%, moveSpeed +20%
 * HP cost is deducted uniformly via the hpCost field in useAbility() (with validation + windup refund), no longer using a separate damage effect
 */
export const ABILITY_STIM_PACK: AbilityDef = {
  id: 'stim_pack',
  displayName: 'Stimpack',
  icon: '💉',
  hotkey: 'KeyT',
  hotkeyLabel: 'T',
  description: 'Lose 10 HP, for 6s: attack speed +35%, move speed +20%. Cooldown 12s',
  energyCost: 0,
  hpCost: 10,
  cooldown: 12,
  requiredUpgrade: 'stim_pack',
  allowedUnits: ['marine', 'marauder'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'stim_pack',
      duration: 6,
      modifiers: [
        { stat: 'attackSpeed', mode: 'multiply', value: 0.35 },
        { stat: 'moveSpeed', mode: 'multiply', value: 0.2 },
      ],
      vfx: {
        tint: { color: 0xff2200, intensity: 0.25 },
        particles: {
          color: 0xcc2211, color2: 0x440808,
          size: 0.06, interval: 0.08,
          direction: 'up', speed: 0.7, lifetime: 0.5,
          blending: 'additive',
        },
        burst: {
          color: 0xff2200, count: 7, size: 0.08, speed: 2.0,
          ring: { color: 0xff3300, radius: 0.4, duration: 0.3 },
        },
      },
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Siege Mode — Siege Tank */
export const ABILITY_SIEGE_MODE: AbilityDef = {
  id: 'siege_mode',
  displayName: 'Siege Mode',
  icon: '🔧',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Toggle Siege Mode: cannot move, switches to siege cannon, range and damage greatly increased',
  energyCost: 0,
  hpCost: 0,
  cooldown: 2,
  requiredUpgrade: 'siege_mode',
  allowedUnits: ['tank'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'form_switch', formId: 'tank_siege' },
  ],
  isToggle: true,
  isAutocast: false,
  isPassive: false,
  castTime: 1.5,
  channelingCancelable: false,
}

/** Unsiege — Tank (return to mobile form)
 *  allowedUnits empty: injected into the siege form only via FormDef.abilityIds */
export const ABILITY_SIEGE_MODE_CANCEL: AbilityDef = {
  id: 'siege_mode_cancel',
  displayName: 'Unsiege',
  icon: '🔧',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Cancel Siege Mode, restore movement ability',
  energyCost: 0,
  hpCost: 0,
  cooldown: 2,
  requiredUpgrade: '',
  allowedUnits: [],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'form_switch', formId: 'tank_siege' },
  ],
  isToggle: true,
  isAutocast: false,
  isPassive: false,
  castTime: 1.5,
  channelingCancelable: false,
}

/** Heal — Medic (reserved) */
export const ABILITY_HEAL: AbilityDef = {
  id: 'heal',
  displayName: 'Heal',
  icon: '💚',
  hotkey: 'KeyQ',
  hotkeyLabel: 'Q',
  description: 'Consume energy to heal friendly biological units',
  energyCost: 1,  // each heal consumes 1 energy
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['medic'],
  targetType: 'unit',
  castRange: 2,
  targetFilter: 'ally',
  targetUnitFilter: 'biological',
  effects: [
    { type: 'heal', amount: 2, perSecond: true },
  ],
  isToggle: false,
  isAutocast: true,
  isPassive: false,
}

/** Afterburners — Wraith (mobility harass window) */
export const ABILITY_AFTERBURNERS: AbilityDef = {
  id: 'afterburners',
  displayName: 'Afterburners',
  icon: '🔥',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Activate afterburners, move speed +60% for 4 seconds. Cooldown 30s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 30,
  requiredUpgrade: 'wraith_afterburner',
  allowedUnits: ['wraith'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'afterburners',
      duration: 4,
      modifiers: [
        { stat: 'moveSpeed', mode: 'multiply', value: 0.6 },  // move speed +60%
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Graviton Beam — Phoenix (lift a non-massive ground unit, channel for 7s) */
export const ABILITY_GRAVITON_BEAM: AbilityDef = {
  id: 'graviton_beam',
  displayName: 'Graviton Beam',
  icon: '🔗',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Consume 50 energy, channel 7s, lift a non-massive ground enemy unit. The target becomes an air unit and cannot move/attack. Cooldown 4s',
  energyCost: 50,
  hpCost: 0,
  cooldown: 4,
  requiredUpgrade: 'strafe_run',
  allowedUnits: ['phoenix'],
  targetType: 'unit',
  castRange: 4 * 1.84,
  targetFilter: 'enemy',
  targetUnitFilter: 'groundNonMassive',
  faceTarget: true,
  effects: [
    {
      type: 'apply_debuff',
      debuffId: 'graviton_lift',
      duration: 999,
      modifiers: [
        { stat: 'moveSpeed', mode: 'multiply', value: -1 },
        { stat: 'attackSpeed', mode: 'multiply', value: -1 },
      ],
    },
  ],
  sustained: {
    duration: 7,
    movement: 'stationary',
    faceTarget: true,
    trackTarget: true,
    trackRange: 5 * 1.84,
    canAttack: false,
    canCastOther: false,
    interruptOnStun: true,
    interruptOnCommand: false,
    showProgressBar: true,
    completionEffects: [
      { type: 'remove_buff', buffId: 'graviton_lift' },
    ],
    onInterruptEffects: [
      { type: 'remove_buff', buffId: 'graviton_lift' },
    ],
  },
  castTime: 0.1,
  backswing: 0,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Full-Shield Armor — Phoenix (armor boost at full shield) */
export const ABILITY_PHOENIX_SHIELD_GUARD: AbilityDef = {
  id: 'phoenix_shield_guard',
  displayName: 'Full-Shield Armor',
  icon: '🛡️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Armor +1 when shield is full.',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['phoenix'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'phoenix_shield_guard',
      duration: 0,
      modifiers: [],
      triggers: [
        {
          id: 'phoenix_shield_guard_on',
          event: 'on_interval',
          interval: 0.25,
          conditions: [
            { type: 'shield_above', percent: 0.999 },
            { type: 'no_buff', buffId: 'phoenix_shield_full_armor' },
          ],
          effects: [
            {
              type: 'apply_buff',
              buffId: 'phoenix_shield_full_armor',
              duration: 0,
              modifiers: [
                { stat: 'armor', mode: 'add', value: 1 },
              ],
            },
          ],
          effectTarget: 'self',
        },
        {
          id: 'phoenix_shield_guard_off',
          event: 'on_interval',
          interval: 0.25,
          conditions: [
            { type: 'shield_below', percent: 0.999 },
            { type: 'has_buff', buffId: 'phoenix_shield_full_armor' },
          ],
          effects: [
            { type: 'remove_buff', buffId: 'phoenix_shield_full_armor' },
          ],
          effectTarget: 'self',
        },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Recall — Nexus (Strategic Recall) */
export const ABILITY_RECALL: AbilityDef = {
  id: 'recall',
  displayName: 'Recall',
  icon: '🌀',
  hotkey: 'KeyR',
  hotkeyLabel: 'R',
  description: 'Consume 50 energy, teleport friendly forces in the target area to near the Nexus (cooldown 90s)',
  energyCost: 50,
  hpCost: 0,
  cooldown: 90,
  requiredUpgrade: '',
  allowedUnits: ['nexus'],
  targetType: 'point',
  castRange: 0,  // unlimited cast range (whole map)
  targetFilter: 'self',
  targetUnitFilter: 'any',
  aimPreviewRadius: 8,
  effects: [
    { type: 'recall', radius: 8 },
  ],
  castTime: 0.2,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/**
 * Medical Array — Medivac (sustained channel-heal on friendly biological units)
 *
 * - Active single-target ability: cast on a friendly biological unit
 * - Supports autocast: when enabled by right-click, auto-channels on injured allies in range
 * - Sustained channel: consumes energy per second to heal the target, no time limit (duration=0)
 * - Interrupted by any command: move/attack/other abilities all interrupt the channel (autocast does not interrupt itself)
 * - Green link VFX: shows a beam from the caster to the target during the channel
 */
export const ABILITY_MEDIVAC_HEAL: AbilityDef = {
  id: 'medivac_heal',
  displayName: 'Medical Array',
  icon: '💚',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Channel-heal a friendly biological unit, restoring 6 HP per second, with a sustained cost of 3 energy/sec',
  energyCost: 5,
  hpCost: 0,
  cooldown: 0,
  castTime: 0.3,
  requiredUpgrade: '',
  allowedUnits: ['medivac'],
  targetType: 'unit',
  castRange: 5,
  targetFilter: 'ally',
  targetUnitFilter: 'biological',
  effects: [],
  isToggle: false,
  isAutocast: true,
  isPassive: false,
  faceTarget: true,
  sustained: {
    duration: 0,
    movement: 'free',
    interval: 1,
    intervalEffects: [
      { type: 'heal', amount: 6 },
    ],
    energyPerSecond: 3,
    trackTarget: true,
    trackRange: 6,
    faceTarget: true,
    completeWhenTargetFullHp: true,
    interruptOnAnyCommand: true,
    canAttack: false,
    canCastOther: false,
    showProgressBar: false,
  },
}

/** Sow Creep — Overlord·Seeder (releases a creep node at its feet) */
export const ABILITY_SPAWN_CREEP_TUMOR: AbilityDef = {
  id: 'spawn_creep_tumor',
  displayName: 'Sow Creep',
  icon: '🟣',
  hotkey: 'KeyC',
  hotkeyLabel: 'C',
  description: 'Consume 25 energy, after standing still for 2s release a creep node at its feet (permanent, cooldown 20s)',
  energyCost: 25,
  hpCost: 0,
  cooldown: 20,  // cooldown 20s after sowing
  requiredUpgrade: '',  // no global upgrade needed, unlocked via individual morph
  allowedUnits: ['overlord_seeder'],  // only the Seeder can use it
  targetType: 'none',      // self-cast (at its feet)
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'spawn_unit', unitTypeId: 'creep_tumor', count: 1, offsetX: 0, offsetZ: 0 },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: false,
  castTime: 2,  // releases only after standing still for 2s
}

// ============================================================================
// spec §12.2 recommended abilities
// ============================================================================

/** Blink — Stalker (short-range teleport)
 * spec §12.2.4 / §12.5: castRange=4 cells, cooldown=11s, requires blink research
 */
export const ABILITY_BLINK: AbilityDef = {
  id: 'blink',
  displayName: 'Blink',
  icon: '⚡',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Teleport to the target location (distance 4 cells), cooldown 11s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 11,
  requiredUpgrade: 'blink',
  allowedUnits: ['stalker'],
  targetType: 'point',
  castRange: 0,             // unlimited cast range (blink wherever you click, distance clamped by teleport.maxRange)
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'teleport', maxRange: 7.36 },  // actual teleport distance cap 4 cells x RANGE_SCALE(1.84)
  ],
  clearCommandOnCast: true,
  batchCast: true,
  batchSpread: true,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Focus Sight — Wraith (range + vision window)
 * duration=5s, cooldown=16s, attackRange +3 cells, visionRange +3 cells
 * requires focus_sight research
 */
export const ABILITY_FOCUS_SIGHT: AbilityDef = {
  id: 'focus_sight',
  displayName: 'Focus Sight',
  icon: '🔭',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'For 5s: attack range +3 cells, vision +3 cells. Cooldown 16s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 16,
  requiredUpgrade: 'focus_sight',
  allowedUnits: ['wraith'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'focus_sight',
      duration: 5,
      modifiers: [
        { stat: 'range', mode: 'add', value: 3 * 1.84 },        // +3 cells x RANGE_SCALE
        { stat: 'visionRange', mode: 'add', value: 3 * 1.84 },  // +3 cells x RANGE_SCALE
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

// ============================================================================
// P3 — Terran new abilities
// ============================================================================

/** EMP — Ghost (area energy clear + extra damage to psionic) */
export const ABILITY_EMP: AbilityDef = {
  id: 'emp',
  displayName: 'EMP',
  icon: '⚡',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'All enemy units within radius 2.5 have their energy zeroed and take 15 spell damage. Consumes 75 energy, cooldown 20s',
  energyCost: 75,
  hpCost: 0,
  cooldown: 20,
  requiredUpgrade: 'emp',
  allowedUnits: ['ghost'],
  targetType: 'point',
  castRange: 6 * 1.84,  // 6 cells
  targetFilter: 'enemy',
  targetUnitFilter: 'any',
  aimPreviewRadius: 2.5 * 1.84,
  effects: [
    {
      type: 'area_effect',
      shape: 'circle',
      radius: 2.5 * 1.84,  // 2.5 cells
      targetFilter: 'enemy',
      effects: [
        { type: 'modify_energy', amount: 'clear' },
      ],
    },
    {
      type: 'area_effect',
      shape: 'circle',
      radius: 2.5 * 1.84,
      targetFilter: 'enemy',
      effects: [
        { type: 'damage', amount: 15, damageType: 'spell' },
      ],
    },
  ],
  castTime: 0.12,
  backswing: 0.25,
  projectile: {
    speed: 18,
    arc: true,
    arcHeight: 2.5,
    visualShape: 'sphere',
    visualColor: 0x4488ff,
    visualSize: 0.25,
    weaponId: 'emp_grenade',
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Cloak — Ghost (toggle cloak, consumes energy per second) */
export const ABILITY_GHOST_CLOAK: AbilityDef = {
  id: 'ghost_cloak',
  displayName: 'Cloak',
  icon: '👻',
  hotkey: 'KeyC',
  hotkeyLabel: 'C',
  description: 'Activation consumes 25 energy, maintaining it consumes 2 energy per second; auto-decloaks when energy runs out',
  energyCost: 25,
  hpCost: 0,
  cooldown: 1,
  requiredUpgrade: '',
  allowedUnits: ['ghost'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'cloak', energyPerSecond: 2 },
  ],
  isToggle: true,
  toggleEnergyCost: 2,
  isAutocast: false,
  isPassive: false,
}

/** Phase Snipe — Goliath (long-range single-target ability damage, similar to a Dota2 musketeer ult)
 * 1s cast windup (interruptible during it); fires a high-speed tracking shot after the windup completes
 * The shot can still fire if the target walks out of cast range during the windup
 */
export const ABILITY_PHASE_SNIPE: AbilityDef = {
  id: 'phase_snipe',
  displayName: 'Phase Snipe',
  icon: '🎯',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'After a 1s charge, fire a tracking shot dealing 70 spell damage (ignores armor); +20% (84 total) on already-marked targets. Consumes 60 energy, cooldown 14s',
  energyCost: 60,
  hpCost: 0,
  cooldown: 14,
  requiredUpgrade: '',
  allowedUnits: ['goliath'],
  targetType: 'unit',
  castRange: 10 * 1.84,  // 10 cells
  targetFilter: 'enemy',
  targetUnitFilter: 'any',
  effects: [
    { type: 'damage', amount: 70, damageType: 'spell' },
  ],
  castTime: 1.0,
  backswing: 0.3,
  projectile: {
    speed: 30,
    arc: false,
    visualShape: 'sphere',
    visualColor: 0x44ddff,
    visualSize: 0.35,
    weaponId: 'phase_snipe',
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Tactical Mark — Goliath passive (gain vision on hit + expose cloaked) */
export const ABILITY_TACTICAL_MARK: AbilityDef = {
  id: 'tactical_mark',
  displayName: 'Tactical Mark',
  icon: '🔍',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'On normal-attack or Phase Snipe hit, the target gains a phase mark for 5s: grants 3-cell vision; cloaked/burrowed targets are visible to everyone',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'tactical_mark',
  allowedUnits: ['goliath'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'tactical_mark_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'tactical_mark',
          duration: 5,
          modifiers: [
            { stat: 'isRevealed', mode: 'add', value: 1 },
          ],
          stackMode: 'refresh',
          vfx: {
            marker: { color: 0xff3333, shape: 'diamond', size: 0.15, spin: true, pulse: true },
          },
        },
      ],
      effectTarget: 'event_target',
    },
    {
      id: 'tactical_mark_on_ability_dmg',
      event: 'on_damage_dealt',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'tactical_mark',
          duration: 5,
          modifiers: [
            { stat: 'isRevealed', mode: 'add', value: 1 },
          ],
          stackMode: 'refresh',
          vfx: {
            marker: { color: 0xff3333, shape: 'diamond', size: 0.15, spin: true, pulse: true },
          },
        },
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Missile Barrage — Thor (lasts 12s, each normal attack fires 4 extra arc missiles) */
export const ABILITY_MISSILE_BARRAGE: AbilityDef = {
  id: 'missile_barrage',
  displayName: 'Missile Barrage',
  icon: '🚀',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'For 12s: each normal attack fires 4 extra arc tracking missiles (20 damage each, falloff on the same target); own attack speed x0.77. Cooldown 22s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 22,
  requiredUpgrade: 'missile_barrage',
  allowedUnits: ['thor'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'missile_barrage',
      duration: 12,
      modifiers: [
        { stat: 'attackSpeed', mode: 'multiply', value: -0.23 },  // attack speed x0.77
      ],
      vfx: {
        tint: { color: 0xff8833, intensity: 0.15 },
        particles: {
          color: 0xff9944, color2: 0x663311,
          size: 0.07, interval: 0.12,
          direction: 'up', speed: 0.6, lifetime: 0.4,
          blending: 'additive',
        },
        burst: {
          color: 0xffaa33, count: 6, size: 0.09, speed: 1.8,
          ring: { color: 0xff8822, radius: 0.5, duration: 0.25 },
        },
      },
    },
  ],
  castTime: 0.15,
  backswing: 0.2,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Battle Fervor — Thor passive (each normal attack stacks attack speed) */
export const ABILITY_WAR_FERVOR: AbilityDef = {
  id: 'war_fervor',
  displayName: 'Battle Fervor',
  icon: '🔥',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Each normal attack adds 1 stack of +3% attack speed, up to 10 stacks (+30%); stacking refreshes the timer to 8s; all stacks are lost after 8s without attacking',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'war_fervor',
  allowedUnits: ['thor'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'war_fervor_stack',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_buff',
          buffId: 'war_fervor',
          duration: 8,
          modifiers: [
            { stat: 'attackSpeed', mode: 'multiply', value: 0.03 },  // +3%/stack
          ],
          stackMode: 'stack',
          maxStacks: 10,
        },
      ],
      effectTarget: 'self',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Flame Dash — Raider (dash + flame trail) */
export const ABILITY_FLAME_DASH: AbilityDef = {
  id: 'flame_dash',
  displayName: 'Flame Dash',
  icon: '🔥',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Dash forward 5 cells, leaving a flame trail along the path (width 1.2, lasts 4s, dealing 6 damage + burn every 0.5s). Can cross terrain. Cooldown 14s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 14,
  requiredUpgrade: '',
  allowedUnits: ['raider'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  sustained: {
    duration: 0.55,  // 5 cells / speed 9 ≈ 0.55s
    movement: 'dash',
    dash: {
      speed: 9 * 1.84,  // speed 9 cells/s
      target: 'forward',
      maxDistance: 5 * 1.84,  // 5 cells
      ignoreCliffs: true,
      trailEffects: [
        {
          type: 'spawn_ground_effect',
          groundEffectId: 'flame_trail',
          duration: 4,
          radius: 0.8 * 1.84,
        },
      ],
      trailInterval: 0.5 * 1.84,  // one spawned every 0.5 cells, radius 0.8 cells → adjacent circles overlap to stay continuous
    },
    unstoppable: true,
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Scorch — Raider passive (normal-attack hit applies DOT) */
export const ABILITY_RAIDER_SCORCH: AbilityDef = {
  id: 'raider_scorch',
  displayName: 'Scorch',
  icon: '🔥',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Normal-attack hit applies a 4/s x 4s DOT; repeat hits extend the duration (cap 8s), no stacking of layers. During it, the target receives -50% heal effect',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'raider_scorch',
  allowedUnits: ['raider'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'raider_scorch_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'raider_scorch',
          duration: 4,
          modifiers: [
            { stat: 'healRate', mode: 'multiply', value: -0.5 },
          ],
          stackMode: 'refresh',
          vfx: {
            tint: { color: 0xff6600, intensity: 0.2 },
            particles: {
              color: 0xff8800, color2: 0x442200,
              size: 0.07, interval: 0.1,
              direction: 'up', speed: 0.5, lifetime: 0.4,
              blending: 'additive',
            },
          },
        },
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Hobble — Marauder passive (normal-attack hit slows) */
export const ABILITY_MARAUDER_SLOW: AbilityDef = {
  id: 'marauder_slow',
  displayName: 'Hobble',
  icon: '🐌',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Normal-attack hit slows the target by 25% for 1.5s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'marauder_slow',
  allowedUnits: ['marauder'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'marauder_slow_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'marauder_slow',
          duration: 1.5,
          modifiers: [
            { stat: 'moveSpeed', mode: 'multiply', value: -0.25 },
          ],
          stackMode: 'refresh',
        },
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Heat Plating — Firebat passive (+1 armor) */
export const ABILITY_FIREBAT_HEAT_PLATING: AbilityDef = {
  id: 'firebat_heat_plating',
  displayName: 'Heat Plating',
  icon: '🛡️',
  hotkey: '',
  hotkeyLabel: '',
  description: 'Thick heat-resistant plating gives the Firebat an extra +1 armor',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'firebat_heat_plating',
  allowedUnits: ['firebat'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'firebat_heat_plating',
      duration: Infinity,
      modifiers: [
        { stat: 'armor', mode: 'add', value: 1 },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Combat Shield — Marine passive (+15 max HP) */
export const ABILITY_MARINE_COMBAT_SHIELD: AbilityDef = {
  id: 'marine_combat_shield',
  displayName: 'Combat Shield',
  icon: '❤️',
  hotkey: '',
  hotkeyLabel: '',
  description: 'An extra combat-armor module gives the Marine +15 max HP',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'combat_shield',
  allowedUnits: ['marine'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'marine_combat_shield',
      duration: Infinity,
      modifiers: [
        { stat: 'maxHp', mode: 'add', value: 15 },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Load — Medivac (load friendly infantry/workers) */
export const ABILITY_MEDIVAC_LOAD: AbilityDef = {
  id: 'medivac_load',
  displayName: 'Load',
  icon: '📥',
  hotkey: 'KeyT',
  hotkeyLabel: 'T',
  description: 'Load the target friendly infantry/worker into the transport (capacity 6). Requires medical transport research',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0.25,
  requiredUpgrade: 'medivac_transport',
  allowedUnits: ['medivac'],
  targetType: 'unit',
  castRange: 1.5 * 1.84,  // 1.5 cells
  targetFilter: 'ally',
  targetUnitFilter: 'any',
  effects: [
    { type: 'transport_load' },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Unload All — Medivac (unload all carried units) */
export const ABILITY_MEDIVAC_UNLOAD: AbilityDef = {
  id: 'medivac_unload',
  displayName: 'Unload All',
  icon: '📤',
  hotkey: 'KeyD',
  hotkeyLabel: 'D',
  description: 'Select a target location; the transport flies to that point and unloads carried units one by one. Requires medical transport research',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'medivac_transport',
  allowedUnits: ['medivac'],
  targetType: 'point',
  castRange: 1.0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'transport_unload' },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

// ============================================================================
// P3 — Zerg new abilities
// ============================================================================

/** Swarm Synergy — Zergling passive (more nearby allies = faster attack speed) */
export const ABILITY_ZERGLING_SWARM: AbilityDef = {
  id: 'zergling_swarm',
  displayName: 'Swarm Synergy',
  icon: '🐜',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Within radius 6, +8% attack speed per 3 allies, up to +32%',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'zergling_swarm',
  allowedUnits: ['zergling'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'zergling_swarm_t1',
      event: 'on_interval',
      interval: 0.5,
      conditions: [
        { type: 'nearby_unit_count', radius: 6 * 1.84, filter: 'ally', min: 3 },
      ],
      effects: [
        {
          type: 'apply_buff',
          buffId: 'zergling_swarm_1',
          duration: 1,
          modifiers: [{ stat: 'attackSpeed', mode: 'multiply', value: 0.08 }],
          stackMode: 'refresh',
        },
      ],
      effectTarget: 'self',
    },
    {
      id: 'zergling_swarm_t2',
      event: 'on_interval',
      interval: 0.5,
      conditions: [
        { type: 'nearby_unit_count', radius: 6 * 1.84, filter: 'ally', min: 6 },
      ],
      effects: [
        {
          type: 'apply_buff',
          buffId: 'zergling_swarm_2',
          duration: 1,
          modifiers: [{ stat: 'attackSpeed', mode: 'multiply', value: 0.08 }],
          stackMode: 'refresh',
        },
      ],
      effectTarget: 'self',
    },
    {
      id: 'zergling_swarm_t3',
      event: 'on_interval',
      interval: 0.5,
      conditions: [
        { type: 'nearby_unit_count', radius: 6 * 1.84, filter: 'ally', min: 9 },
      ],
      effects: [
        {
          type: 'apply_buff',
          buffId: 'zergling_swarm_3',
          duration: 1,
          modifiers: [{ stat: 'attackSpeed', mode: 'multiply', value: 0.08 }],
          stackMode: 'refresh',
        },
      ],
      effectTarget: 'self',
    },
    {
      id: 'zergling_swarm_t4',
      event: 'on_interval',
      interval: 0.5,
      conditions: [
        { type: 'nearby_unit_count', radius: 6 * 1.84, filter: 'ally', min: 12 },
      ],
      effects: [
        {
          type: 'apply_buff',
          buffId: 'zergling_swarm_4',
          duration: 1,
          modifiers: [{ stat: 'attackSpeed', mode: 'multiply', value: 0.08 }],
          stackMode: 'refresh',
        },
      ],
      effectTarget: 'self',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Corrosive Venom — Mutalisk passive (hit applies DOT + heal-block) */
export const ABILITY_MUTALISK_CORROSION: AbilityDef = {
  id: 'mutalisk_corrosion',
  displayName: 'Corrosive Venom',
  icon: '☠️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Hit applies a 4/s DOT for 4s; during it, the target receives -50% heal effect',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'mutalisk_corrosion',
  allowedUnits: ['mutalisk'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'mutalisk_corrosion_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'mutalisk_corrosion',
          duration: 4,
          modifiers: [
            { stat: 'healRate', mode: 'multiply', value: -0.5 },
          ],
          triggers: [
            {
              id: 'mutalisk_corrosion_dot',
              event: 'on_interval',
              interval: 1,
              effects: [
                { type: 'damage', amount: 4, damageType: 'spell' },
              ],
              effectTarget: 'self',
            },
          ],
          stackMode: 'refresh',
        },
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Gale-Wing Regen — Mutalisk passive (regenerate HP out of combat) */
export const ABILITY_MUTALISK_REGEN: AbilityDef = {
  id: 'mutalisk_regen',
  displayName: 'Gale-Wing Regen',
  icon: '💚',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'After 3s out of combat, regenerate 3 HP/s; taking damage immediately interrupts and resets the timer',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['mutalisk'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'mutalisk_regen_tick',
      event: 'on_interval',
      interval: 1,
      conditions: [
        { type: 'is_out_of_combat', thresholdSec: 3 },
      ],
      effects: [
        { type: 'heal', amount: 3 },
      ],
      effectTarget: 'self',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Neural Corrosion — Hydralisk passive (hit stacks armor reduction); researched at hydra_den */
export const ABILITY_NEURAL_CORROSION: AbilityDef = {
  id: 'neural_corrosion',
  displayName: 'Neural Corrosion',
  icon: '🧪',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Hit stacks -10% armor/stack, up to 6 stacks (-60%), for 5s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'neural_corrosion',
  allowedUnits: ['hydralisk'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'neural_corrosion_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'neural_corrosion',
          duration: 5,
          modifiers: [
            { stat: 'armor', mode: 'multiply', value: -0.10 },  // -10%/stack
          ],
          stackMode: 'stack',
          maxStacks: 6,
        },
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Precision Spines — Hydralisk passive (range +1) */
export const ABILITY_SPINE_PRECISION: AbilityDef = {
  id: 'spine_precision',
  displayName: 'Precision Spines',
  icon: '🎯',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Attack range permanently +1 (4→5)',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'spine_precision',
  allowedUnits: ['hydralisk'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'spine_precision',
      duration: 0,  // permanent
      modifiers: [
        { stat: 'range', mode: 'add', value: 1.84 },  // +1 cell
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Carapace Brace — Roach (toggle defensive form) */
export const ABILITY_CARAPACE_BRACE: AbilityDef = {
  id: 'carapace_brace',
  displayName: 'Carapace Brace',
  icon: '🛡️',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Defensive form: armor +3, cannot attack/move, model changes; +8 HP/s regen on creep',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'carapace_brace',
  allowedUnits: ['roach'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'form_switch', formId: 'roach_brace' },
  ],
  isToggle: true,
  isAutocast: false,
  isPassive: false,
  castTime: 1.0,
  channelingCancelable: false,
}

/** Cancel Carapace Brace — Roach (return to combat form)
 *  allowedUnits empty: injected into the defensive form only via FormDef.abilityIds */
export const ABILITY_CARAPACE_BRACE_CANCEL: AbilityDef = {
  id: 'carapace_brace_cancel',
  displayName: 'Cancel Brace',
  icon: '🛡️',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Cancel the defensive form, restore attack and movement ability',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: [],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'form_switch', formId: 'roach_brace' },
  ],
  isToggle: true,
  isAutocast: false,
  isPassive: false,
  castTime: 1.0,
  channelingCancelable: false,
}

/** Carapace Regen — Roach defensive-form passive (+8 HP/s on creep)
 *  allowedUnits empty: injected into the defensive form only via FormDef.abilityIds */
export const ABILITY_BRACE_REGEN: AbilityDef = {
  id: 'brace_regen',
  displayName: 'Carapace Regen',
  icon: '💚',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'In defensive form, regenerate 8 HP per second while on creep',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'carapace_brace',
  allowedUnits: [],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'brace_regen',
      duration: 0,
      modifiers: [],
      triggers: [
        {
          id: 'brace_regen_tick',
          event: 'on_interval',
          interval: 1,
          conditions: [
            { type: 'is_on_creep' },
          ],
          effects: [
            { type: 'heal', amount: 8 },
          ],
          effectTarget: 'self',
        },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Surge Instinct — Roach passive (move speed +15% in non-defensive form) */
export const ABILITY_SURGE_INSTINCT: AbilityDef = {
  id: 'surge_instinct',
  displayName: 'Surge Instinct',
  icon: '💨',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Move speed +15% when not in defensive form',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'surge_instinct',
  allowedUnits: ['roach'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'surge_instinct',
      duration: 0,  // permanent
      modifiers: [
        { stat: 'moveSpeed', mode: 'multiply', value: 0.15 },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Acid Blast — Baneling passive (onHit/onDeath dual-trigger area explosion + self-destruct) */
export const ABILITY_ACID_BLAST: AbilityDef = {
  id: 'acid_blast',
  displayName: 'Acid Blast',
  icon: '💥',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'On attack contact or death, triggers an area explosion (R1=1.0 full damage / R2=2.2 half damage) and self-destructs',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['baneling'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'acid_blast_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'area_effect',
          shape: 'circle',
          radius: 2.2 * 1.84,
          targetFilter: 'enemy',
          falloff: [1.0, 0.5],
          effects: [
            { type: 'damage', amount: 16, damageType: 'spell' },
          ],
          applyFalloffToDamage: true,
          splashVfxId: 'baneling_blast',
        },
        { type: 'apply_buff', buffId: 'acid_blast_exploded', duration: 5, modifiers: [] },
        { type: 'kill_self' },
      ],
      effectTarget: 'self',
    },
    {
      id: 'acid_blast_on_death',
      event: 'on_death',
      conditions: [
        { type: 'no_buff', buffId: 'acid_blast_exploded' },
      ],
      effects: [
        {
          type: 'area_effect',
          shape: 'circle',
          radius: 2.2 * 1.84,
          targetFilter: 'enemy',
          falloff: [1.0, 0.5],
          effects: [
            { type: 'damage', amount: 16, damageType: 'spell' },
          ],
          applyFalloffToDamage: true,
          splashVfxId: 'baneling_blast',
        },
      ],
      effectTarget: 'self',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Sonar Pulse — Corruptor (direction-type scout + detection) */
export const ABILITY_SONAR_PULSE: AbilityDef = {
  id: 'sonar_pulse',
  displayName: 'Sonar Pulse',
  icon: '📡',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Fire a sonar wave in the chosen direction (27 cells x width 2.5), revealing the path for 6s and exposing cloaked/burrowed units for 6s. Consumes 50 energy, cooldown 15s',
  energyCost: 50,
  hpCost: 0,
  cooldown: 15,
  requiredUpgrade: '',
  allowedUnits: ['corruptor'],
  targetType: 'direction',
  castRange: 27 * 1.84,  // 27-cell propagation distance
  targetFilter: 'self',
  targetUnitFilter: 'any',
  aimPreview: { type: 'rect', width: 2.5 * 1.84, length: 27 * 1.84 },
  effects: [
    {
      type: 'spawn_direction_wave',
      speed: 14,                // wave speed 14 world units/sec (about 7.6 cells/sec, ~3.6s to cross the full path)
      maxRange: 27 * 1.84,     // max propagation distance 27 cells
      width: 2.5 * 1.84,       // wave width 2.5 cells
      hitEffects: [
        {
          type: 'apply_debuff',
          debuffId: 'sonar_revealed',
          duration: 6,
          modifiers: [
            { stat: 'isRevealed', mode: 'add', value: 1 },
          ],
          stackMode: 'refresh',
        },
      ],
      weaponId: 'sonar_wave',
      revealRange: 4 * 1.84,    // wave-path reveal radius 4 cells
      revealDuration: 6,         // reveal lasts 6 seconds
    },
  ],
  castTime: 0.12,
  backswing: 0.15,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Burrow Form — Lurker (toggle burrow/ground) */
export const ABILITY_LURKER_BURROW: AbilityDef = {
  id: 'lurker_burrow',
  displayName: 'Burrow Form',
  icon: '⬇️',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Burrow: cloaked, cannot move/attack, gains the Spine Rush ability. Automatically returns to the surface after dashing. Cooldown 4s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 4,
  requiredUpgrade: '',
  allowedUnits: ['lurker'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'form_switch', formId: 'lurker_burrowed' },
  ],
  isToggle: true,
  isAutocast: false,
  isPassive: false,
  castTime: 1.0,
  channelingCancelable: false,
}

/** Cancel Burrow — Lurker (manually return to ground form)
 *  allowedUnits empty: injected into the burrow form only via FormDef.abilityIds */
export const ABILITY_LURKER_BURROW_CANCEL: AbilityDef = {
  id: 'lurker_burrow_cancel',
  displayName: 'Cancel Burrow',
  icon: '⬆️',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Return to ground form, restore movement and melee attack',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: [],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'form_switch', formId: 'lurker_burrowed' },
  ],
  isToggle: true,
  isAutocast: false,
  isPassive: false,
  castTime: 1.0,
  channelingCancelable: false,
}

/** Spine Rush — Lurker (burrowed-state active ability, auto-returns to ground form after casting)
 *  allowedUnits empty: injected into the burrow form only via FormDef.abilityIds */
export const ABILITY_SPINE_RUSH: AbilityDef = {
  id: 'spine_rush',
  displayName: 'Spine Rush',
  icon: '🗡️',
  hotkey: 'KeyQ',
  hotkeyLabel: 'Q',
  description: 'Dash underground toward the chosen location (max 7 cells), path width 1.5, 22 damage, passing through units. Automatically returns to ground form after the dash ends',
  energyCost: 0,
  hpCost: 0,
  cooldown: 2,
  requiredUpgrade: 'spine_rush',
  allowedUnits: [],
  targetType: 'point',
  castRange: 7 * 1.84,  // max 7 cells
  targetFilter: 'any',
  targetUnitFilter: 'any',
  effects: [],
  sustained: {
    duration: 2,  // safety cap (actually ended early by reaching the target point)
    movement: 'dash',
    dash: {
      speed: 10 * 1.84,  // speed 10 cells/s
      target: 'target_point',
      maxDistance: 7 * 1.84,  // cap to prevent over-far
      pathEffects: [
        { type: 'damage', amount: 22, damageType: 'normal' },
      ],
      pathHitRadius: 0.75 * 1.84,  // half of the 1.5-cell width
    },
    unstoppable: true,
    uniqueHits: true,
    completionEffects: [
      { type: 'form_switch', formId: 'lurker_burrowed' },
    ],
  },
  castTime: 0.15,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Corrosive Bile — Ravager (area sustained damage + slow) */
export const ABILITY_CORROSIVE_BILE: AbilityDef = {
  id: 'corrosive_bile',
  displayName: 'Corrosive Bile',
  icon: '🟢',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Spawn a 3s corrosive zone at the target point (radius 1.5), dealing 12 spell damage every 0.5s and slowing by 30%. Cooldown 7s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 7,
  requiredUpgrade: '',
  allowedUnits: ['ravager'],
  targetType: 'point',
  castRange: 9 * 1.84,  // 9 cells
  targetFilter: 'enemy',
  targetUnitFilter: 'any',
  aimPreviewRadius: 1.5 * 1.84,
  effects: [
    {
      type: 'spawn_ground_effect',
      groundEffectId: 'corrosive_bile',
      duration: 3,
      radius: 1.5 * 1.84,
    },
  ],
  projectile: {
    speed: 10,
    arc: true,
    arcHeight: 8,
    flightTime: 1.0,
    visualShape: 'sphere',
    visualColor: 0x44ff22,
    visualSize: 0.4,
    weaponId: 'baneling_blast',
  },
  castTime: 0.5,
  backswing: 0.5,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Spore Slime — Swarm Guard core passive (hit stacks attack-speed reduction + minor slow) */
export const ABILITY_SPORE_SLIME: AbilityDef = {
  id: 'spore_slime',
  displayName: 'Spore Slime',
  icon: '🟣',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'When enabled, each attack consumes 5 energy; hit stacks slime -10% attack speed/-4% move speed per stack, up to 5 stacks (-50% attack speed/-20% move speed)',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['swarm_guard'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  attackModifier: {
    energyCost: 5,
    effects: [
      {
        type: 'apply_debuff',
        debuffId: 'spore_slime',
        duration: 5,
        modifiers: [
          { stat: 'attackSpeed', mode: 'multiply', value: -0.10 },  // -10%/stack, 5 stacks = -50%
          { stat: 'moveSpeed',   mode: 'multiply', value: -0.04 },  // -4%/stack, 5 stacks = -20%
        ],
        stackMode: 'stack',
        maxStacks: 5,
        vfx: {
          particles: {
            color: 0x8844aa, color2: 0x667733,
            size: 0.08, interval: 0.2,
            direction: 'down', speed: 1.2, lifetime: 0.35,
            blending: 'normal',
          },
          groundRing: {
            color: 0x665588, radius: 0.3 * 1.84, pulse: false,
          },
        },
      },
    ],
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Brood Pod — Swarm Guard (summon void melee units at a distant point) */
export const ABILITY_BROOD_POD: AbilityDef = {
  id: 'brood_pod',
  displayName: 'Brood Pod',
  icon: '🥚',
  hotkey: 'KeyQ',
  hotkeyLabel: 'Q',
  description: 'Consume 25 energy, summon 3 zerg melee units at the target point (hp=35, damage=6, speed=5.5), lasting 8s. Cooldown 18s',
  energyCost: 25,
  hpCost: 0,
  cooldown: 18,
  requiredUpgrade: 'brood_pod',
  allowedUnits: ['swarm_guard'],
  targetType: 'point',
  castRange: 8 * 1.84,  // 8 cells
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'spawn_unit',
      unitTypeId: 'broodling',
      count: 3,
      spawnAtTarget: true,
      lifetime: 8,
    },
  ],
  castTime: 0.2,
  backswing: 0.25,
  projectile: {
    speed: 10,
    arc: true,
    arcHeight: 6,
    flightTime: 0.8,
    visualShape: 'sphere',
    visualColor: 0x886633,
    visualSize: 0.4,
    weaponId: 'brood_pod',
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Earth Shatter — Ultralisk (dash-path damage + knockback + slow) */
export const ABILITY_EARTH_SHATTER: AbilityDef = {
  id: 'earth_shatter',
  displayName: 'Earth Shatter',
  icon: '💥',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Dash distance 6, path damage 25, knockback 1.5, slow 30% for 2s. Cooldown 18s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 18,
  requiredUpgrade: 'earth_shatter',
  allowedUnits: ['ultralisk'],
  targetType: 'point',
  castRange: 6 * 1.84,  // 6 cells
  targetFilter: 'self',
  targetUnitFilter: 'any',
  aimPreview: { type: 'rect', width: 1.3 * 1.84 * 2, length: 6 * 1.84 },
  effects: [],
  sustained: {
    duration: 0.8,  // 6 cells / ~7.5 cells/s
    movement: 'dash',
    dash: {
      speed: 7.5 * 1.84,
      target: 'target_point',
      maxDistance: 6 * 1.84,
      pathEffects: [
        { type: 'damage', amount: 25, damageType: 'normal' },
        { type: 'knockback', distance: 1.5 * 1.84, speed: 12, direction: 'away_from_source' },
        {
          type: 'apply_debuff',
          debuffId: 'earth_shatter_slow',
          duration: 2,
          modifiers: [
            { stat: 'moveSpeed', mode: 'multiply', value: -0.3 },
          ],
          stackMode: 'refresh',
        },
      ],
      pathHitRadius: 1.3 * 1.84,
    },
    unstoppable: true,
    uniqueHits: true,
  },
  castTime: 0.2,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Massive Crush — Ultralisk passive (melee splash) */
export const ABILITY_ULTRALISK_CRUSH: AbilityDef = {
  id: 'ultralisk_crush',
  displayName: 'Massive Crush',
  icon: '🦶',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Melee splash radius 1.2, splash damage 50%',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['ultralisk'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'ultralisk_crush',
      duration: 0,  // permanent
      modifiers: [
        { stat: 'splashRadius', mode: 'add', value: 1.2 * 1.84 },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Oppression Field — Ultralisk passive (close-range slow aura) */
export const ABILITY_ULTRALISK_PRESSURE: AbilityDef = {
  id: 'ultralisk_pressure',
  displayName: 'Oppression Field',
  icon: '🌀',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Enemies within radius 4 are continuously slowed by 12%; the effect ends when they leave',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'ultralisk_pressure',
  allowedUnits: ['ultralisk'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'ultralisk_pressure_aura',
      event: 'on_interval',
      interval: 0.5,
      effects: [
        {
          type: 'area_effect',
          shape: 'circle',
          radius: 4 * 1.84,
          targetFilter: 'enemy',
          effects: [
            {
              type: 'apply_debuff',
              debuffId: 'ultralisk_pressure',
              duration: 1,
              modifiers: [
                { stat: 'moveSpeed', mode: 'multiply', value: -0.12 },
              ],
              stackMode: 'refresh',
            },
          ],
        },
      ],
      effectTarget: 'self',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

// ============================================================================
// P3 — Protoss new abilities
// ============================================================================

/** Shield Boost — Zealot passive (max shield +20%) */
export const ABILITY_ZEALOT_SHIELD_BOOST: AbilityDef = {
  id: 'zealot_shield_boost',
  displayName: 'Shield Boost',
  icon: '🛡️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Max shield +20% (40→48)',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'zealot_shield_boost',
  allowedUnits: ['zealot'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'zealot_shield_boost',
      duration: 0,
      modifiers: [
        { stat: 'maxShield', mode: 'multiply', value: 0.2 },  // +20%
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Psi-Blade Frenzy — Zealot passive (attack speed +20%) */
export const ABILITY_ZEALOT_FRENZY: AbilityDef = {
  id: 'zealot_frenzy',
  displayName: 'Psi-Blade Frenzy',
  icon: '⚔️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Attack speed permanently +20% (normal-attack cooldown 0.85s→0.71s)',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'zealot_frenzy',
  allowedUnits: ['zealot'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'zealot_frenzy',
      duration: 0,
      modifiers: [
        { stat: 'attackSpeed', mode: 'multiply', value: 0.2 },  // +20%
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Phase Bounce — Adept passive (attack bounces to a second target) */
export const ABILITY_ADEPT_BOUNCE: AbilityDef = {
  id: 'adept_bounce',
  displayName: 'Phase Bounce',
  icon: '↗️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Attack bounces to a second target, 50% damage, bounce radius 3',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'adept_bounce',
  allowedUnits: ['adept'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'adept_bounce_passive',
      duration: 0,   // permanent
      modifiers: [
        { stat: 'bounceCount', mode: 'add', value: 1 },
      ],
    },
  ],
  triggers: [],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Energy Drive — Dragoon orb (when enabled, normal attacks consume energy, damage +8) */
export const ABILITY_DRAGOON_ENERGY_DRIVE: AbilityDef = {
  id: 'dragoon_energy_drive',
  displayName: 'Energy Drive',
  icon: '⚡',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'When enabled, normal attacks consume 8 energy, damage +8',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'dragoon_energy_drive',
  allowedUnits: ['dragoon'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  attackModifier: {
    energyCost: 8,
    damageBonus: 8,
    effects: [],
    orbWeaponId: 'orb_energy_drive',
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Hobbling Ray — Dragoon passive (hit slows) */
export const ABILITY_DRAGOON_SLOW: AbilityDef = {
  id: 'dragoon_slow',
  displayName: 'Hobbling Ray',
  icon: '🐌',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Normal-attack hit slows the target by 35% for 2.0s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'dragoon_slow',
  allowedUnits: ['dragoon'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'dragoon_slow_on_hit',
      event: 'on_attack_hit',
      effects: [
        {
          type: 'apply_debuff',
          debuffId: 'dragoon_slow',
          duration: 2,
          modifiers: [
            { stat: 'moveSpeed', mode: 'multiply', value: -0.35 },
          ],
          stackMode: 'refresh',
          vfx: {
            groundRing: { color: 0x4488ff, radius: 0.5, pulse: true },
            particles: {
              color: 0x6699ff, color2: 0x223366,
              size: 0.06, interval: 0.1,
              direction: 'down', speed: 0.6, lifetime: 0.5,
            },
          },
        },
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Rapid Shield — Stalker passive (shield recovery accelerates after leaving combat) */
export const ABILITY_STALKER_RAPID_SHIELD: AbilityDef = {
  id: 'stalker_rapid_shield',
  displayName: 'Rapid Shield',
  icon: '🛡️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'After leaving combat, shield recovery delay 7s→3s, recovery rate doubled (2→4/s)',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'stalker_rapid_shield',
  allowedUnits: ['stalker'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'stalker_rapid_shield',
      duration: 0,  // permanent
      modifiers: [
        { stat: 'shieldRegen', mode: 'multiply', value: 1.0 },       // +100% recovery rate
        { stat: 'shieldRegenDelay', mode: 'add', value: -4.0 },      // 7.0s → 3.0s
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Thermal Sweep — Colossus (cone sustained damage) */
export const ABILITY_THERMAL_SWEEP: AbilityDef = {
  id: 'thermal_sweep',
  displayName: 'Thermal Sweep',
  icon: '🔥',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Cone 60° radius 4.0, lasts 3s, dealing 18 damage every 0.5s. Cooldown 12s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 12,
  requiredUpgrade: '',
  allowedUnits: ['colossus'],
  targetType: 'direction',
  castRange: 4 * 1.84,  // 4 cells
  targetFilter: 'self',
  targetUnitFilter: 'any',
  aimPreview: { type: 'cone', radius: 4 * 1.84, angle: 60 },
  effects: [],
  sustained: {
    duration: 3,
    movement: 'stationary',
    interval: 0.5,
    intervalEffects: [
      {
        type: 'area_effect',
        shape: 'cone',
        radius: 4 * 1.84,
        angle: 60,
        targetFilter: 'enemy',
        effects: [
          { type: 'damage', amount: 18, damageType: 'spell' },
        ],
      },
    ],
    interruptOnStun: true,
    interruptOnCommand: true,
    showProgressBar: true,
  },
  castTime: 0.25,
  backswing: 0.3,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Phase Dissipation — Colossus passive (spell damage taken -20%) */
export const ABILITY_COLOSSUS_PHASE_DISSIPATION: AbilityDef = {
  id: 'colossus_phase_dissipation',
  displayName: 'Phase Dissipation',
  icon: '🌀',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Spell damage taken reduced by 20%',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'colossus_phase_dissipation',
  allowedUnits: ['colossus'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'colossus_phase_dissipation',
      duration: 0,
      modifiers: [
        { stat: 'spellDamageTaken', mode: 'multiply', value: -0.2 },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Shield Restore — Immortal passive (after shield hits zero, restore 50% with a 2s delay) */
export const ABILITY_IMMORTAL_SHIELD_RESTORE: AbilityDef = {
  id: 'immortal_shield_restore',
  displayName: 'Shield Restore',
  icon: '🛡️',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Triggers 2s after shield reaches 0, restoring 50% of max shield; cooldown 12s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'immortal_shield_restore',
  allowedUnits: ['immortal'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      // Phase 1: detect shield=0 → start the 4s charge timer (empty buff)
      id: 'immortal_shield_restore_start',
      event: 'on_interval',
      interval: 0.5,
      conditions: [
        { type: 'shield_below', percent: 0.01 },
        { type: 'no_buff', buffId: 'immortal_shield_charging' },
        { type: 'no_buff', buffId: 'immortal_shield_restore_cd' },
      ],
      effects: [
        {
          type: 'apply_buff',
          buffId: 'immortal_shield_charging',
          duration: 2,
          modifiers: [],
          // Source _createShieldChargeVFX (buff-triggered): a pulsing blue foot-ring
          // + rising blue motes while the shield recharges. Declarative here so the
          // BuffAuraSystem renders it (SSOT) instead of a bespoke hardcoded effect.
          vfx: {
            groundRing: { color: 0x4488ff, radius: 1.2, pulse: true },
            particles: { color: 0x66bbff, size: 0.05, interval: 0.12, direction: 'up', speed: 0.9, lifetime: 0.8 },
          },
        },
      ],
      effectTarget: 'self',
    },
    {
      // Phase 2: charge buff expires naturally (4s elapsed) → restore shield + enter cooldown
      id: 'immortal_shield_restore_fire',
      event: 'on_buff_expired',
      conditions: [
        { type: 'buff_id', buffId: 'immortal_shield_charging' },
      ],
      effects: [
        { type: 'restore_shield', amount: 45 },
        {
          type: 'apply_buff',
          buffId: 'immortal_shield_restore_cd',
          duration: 12,
          modifiers: [],
        },
      ],
      effectTarget: 'self',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Siege Breaker — Immortal passive (damage to buildings +40%) */
export const ABILITY_IMMORTAL_SIEGE_BREAKER: AbilityDef = {
  id: 'immortal_siege_breaker',
  displayName: 'Siege Breaker',
  icon: '🏰',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Damage to structure-type units +40%',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: 'immortal_siege_breaker',
  allowedUnits: ['immortal'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [],
  triggers: [
    {
      id: 'immortal_siege_breaker_on_hit',
      event: 'on_attack_hit',
      conditions: [
        { type: 'target_combat_type', combatTypes: ['structure'] },
      ],
      effects: [
        { type: 'damage', amount: 11, damageType: 'normal' },  // ≈40% of base damage(28)
      ],
      effectTarget: 'event_target',
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Prismatic Charge — Void Ray (area damage after channeling) */
export const ABILITY_PRISMATIC_CHARGE: AbilityDef = {
  id: 'prismatic_charge',
  displayName: 'Prismatic Charge',
  icon: '💎',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Channel 3s (interruptible); on completion, deal 90 damage in radius 2.2. Cooldown 18s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 18,
  requiredUpgrade: 'prismatic_charge',
  allowedUnits: ['void_ray'],
  targetType: 'point',
  castRange: 6 * 1.84,  // 6 cells
  targetFilter: 'enemy',
  targetUnitFilter: 'any',
  aimPreviewRadius: 2.2 * 1.84,
  effects: [],
  sustained: {
    duration: 3,
    movement: 'stationary',
    completionEffects: [
      {
        type: 'area_effect',
        shape: 'circle',
        radius: 2.2 * 1.84,
        targetFilter: 'enemy',
        effects: [
          { type: 'damage', amount: 90, damageType: 'spell' },
        ],
      },
    ],
    interruptOnStun: true,
    interruptOnCommand: true,
    canAttack: false,
    canCastOther: false,
    showProgressBar: true,
  },
  castTime: 0.15,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Phantom Clone — Dark Templar (summon a clone at the target location) */
export const ABILITY_PHANTOM_CLONE: AbilityDef = {
  id: 'phantom_clone',
  displayName: 'Phantom Clone',
  icon: '👤',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Summon a clone at the target location (HP80/shield45), immediately attacking the target; takes x250% damage, lasts 10s. Consumes 65 energy, cooldown 18s',
  energyCost: 65,
  hpCost: 0,
  cooldown: 18,
  requiredUpgrade: 'phantom_clone',
  allowedUnits: ['dark_templar'],
  targetType: 'unit',
  castRange: 6 * 1.84,  // 6 cells
  targetFilter: 'enemy',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'spawn_unit',
      unitTypeId: 'dark_templar',
      count: 1,
      spawnAtTarget: true,
      autoAttackTarget: true,
      inheritCasterStats: true,
      lifetime: 10,
      damageTakenMultiplier: 2.5,
      damageDealtMultiplier: 0.4,
    },
  ],
  castTime: 0.1,
  backswing: 0.15,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Permanent Cloak — Dark Templar passive */
export const ABILITY_DARK_TEMPLAR_STEALTH: AbilityDef = {
  id: 'dark_templar_stealth',
  displayName: 'Permanent Cloak',
  icon: '👻',
  hotkey: 'KeyP',
  hotkeyLabel: 'P',
  description: 'Permanently cloaked; temporarily decloaks when attacking, auto-recloaks after 2s',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['dark_templar'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    { type: 'cloak', energyPerSecond: 0, breakOnAttack: true, recloakDelay: 2 },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

/** Arc Barrier — Sentry (place an entity barrier at a chosen point; facing is auto-set by caster→placement point) */
export const ABILITY_ARC_BARRIER: AbilityDef = {
  id: 'arc_barrier',
  displayName: 'Arc Barrier',
  icon: '🛡️',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Spawn an arc barrier at the target location (arc length 4 x depth 1.5), HP250, lasts 6s; blocks ground units + low-trajectory projectiles. Consumes 60 energy, cooldown 14s',
  energyCost: 60,
  hpCost: 0,
  cooldown: 14,
  requiredUpgrade: '',
  allowedUnits: ['sentry'],
  targetType: 'point',
  castRange: 6 * 1.84,  // 6-cell cast range
  targetFilter: 'self',
  targetUnitFilter: 'any',
  aimPreview: { type: 'arc', radius: 2 * 1.84, angle: 90, width: 0.3 * 1.84 },
  effects: [
    {
      type: 'spawn_hazard',
      hazardTypeId: 'arc_barrier',
      hp: 250,
      duration: 6,
      shape: 'arc',
      radius: 2 * 1.84,  // arc radius
      angle: 90,  // arc angle
      width: 0.3 * 1.84,  // arc wall thickness
      height: 2,  // height (low-trajectory interception threshold)
      blocksMovement: true,
      blocksProjectiles: true,
      blocksAllFactions: true,
      visualStyle: 'energy_shield',
      visualParams: {
        color: '#2288cc',
        edgeColor: '#66ddff',
        criticalColor: '#cc4422',
        showCracks: true,
        shatterOnDestroy: true,
      },
    },
  ],
  castTime: 0.1,
  backswing: 0.15,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Psionic Drain — Sentry (channel to drain energy + stun) */
export const ABILITY_PSIONIC_DRAIN: AbilityDef = {
  id: 'psionic_drain',
  displayName: 'Psionic Drain',
  icon: '🔮',
  hotkey: 'KeyQ',
  hotkeyLabel: 'Q',
  description: 'Channel up to 4s, draining 25 energy from the target per second and restoring it to self; stuns the target 1.5s when energy is drained dry. Usable only on enemy units with energy. Consumes 35 energy, cooldown 26s',
  energyCost: 35,
  hpCost: 0,
  cooldown: 26,
  castTime: 0.2,
  requiredUpgrade: 'psionic_drain',
  allowedUnits: ['sentry'],
  targetType: 'unit',
  castRange: 5 * 1.84,
  targetFilter: 'enemy',
  targetUnitFilter: 'hasEnergy',
  faceTarget: true,
  effects: [],
  sustained: {
    duration: 4,
    movement: 'stationary',
    faceTarget: true,
    trackTarget: true,
    trackRange: 6 * 1.84,
    interval: 1,
    intervalEffects: [
      { type: 'drain', drainType: 'energy', amountPerSecond: 25, duration: 1 },
    ],
    onEarlyCompleteEffects: [
      { type: 'stun', duration: 1.5, dispellable: true },
    ],
    completeWhenTargetEnergyDepleted: true,
    interruptOnStun: true,
    interruptOnCommand: true,
    canAttack: false,
    canCastOther: false,
    showProgressBar: true,
  },
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}


/** Stellar Insight — Nexus (grant a unit detector ability) */
export const ABILITY_STELLAR_INSIGHT: AbilityDef = {
  id: 'stellar_insight',
  displayName: 'Stellar Insight',
  icon: '👁️',
  hotkey: 'KeyE',
  hotkeyLabel: 'E',
  description: 'Grant the target friendly unit detector ability for 30s. Consumes 50 base energy, cooldown 30s',
  energyCost: 50,
  hpCost: 0,
  cooldown: 30,
  requiredUpgrade: '',
  allowedUnits: ['nexus'],
  targetType: 'unit',
  castRange: 0,  // whole map
  targetFilter: 'ally',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'stellar_insight',
      duration: 30,
      modifiers: [
        { stat: 'isDetector', mode: 'add', value: 1 },
      ],
      vfx: {
        particles: {
          color: 0x66bbff, color2: 0x2244aa,
          size: 0.04, interval: 0.35,
          direction: 'up', speed: 0.2, lifetime: 0.6,
        },
      },
    },
  ],
  castTime: 0.1,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Energy Overcharge — Nexus (restore the target's energy) */
export const ABILITY_ENERGY_OVERCHARGE: AbilityDef = {
  id: 'energy_overcharge',
  displayName: 'Energy Overcharge',
  icon: '⚡',
  hotkey: 'KeyQ',
  hotkeyLabel: 'Q',
  description: 'Immediately restore 75 energy to the target friendly unit. Consumes 50 base energy, cooldown 30s',
  energyCost: 50,
  hpCost: 0,
  cooldown: 30,
  requiredUpgrade: '',
  allowedUnits: ['nexus'],
  targetType: 'unit',
  castRange: 0,  // whole map
  targetFilter: 'ally',
  targetUnitFilter: 'any',
  effects: [
    { type: 'modify_energy', amount: 75 },
  ],
  castTime: 0.1,
  isToggle: false,
  isAutocast: false,
  isPassive: false,
}

/** Detection Radar — Bunker passive (innate detection) */
export const ABILITY_BUNKER_DETECTION: AbilityDef = {
  id: 'bunker_detection',
  displayName: 'Detection Radar',
  icon: '📡',
  hotkey: '',
  hotkeyLabel: '',
  description: 'The bunker has a built-in detection radar that detects cloaked units within vision range',
  energyCost: 0,
  hpCost: 0,
  cooldown: 0,
  requiredUpgrade: '',
  allowedUnits: ['bunker'],
  targetType: 'none',
  castRange: 0,
  targetFilter: 'self',
  targetUnitFilter: 'any',
  effects: [
    {
      type: 'apply_buff',
      buffId: 'bunker_detector',
      duration: 0,
      modifiers: [
        { stat: 'isDetector', mode: 'add', value: 1 },
      ],
    },
  ],
  isToggle: false,
  isAutocast: false,
  isPassive: true,
}

// ============================================================================
// Ability lookup table
// ============================================================================

export const ALL_ABILITIES: AbilityDef[] = [
  // ── Original abilities ──
  ABILITY_STIM_PACK,
  ABILITY_SIEGE_MODE, ABILITY_SIEGE_MODE_CANCEL,
  ABILITY_HEAL,
  ABILITY_RECALL,
  ABILITY_MEDIVAC_HEAL,
  ABILITY_AFTERBURNERS,
  ABILITY_GRAVITON_BEAM,
  ABILITY_PHOENIX_SHIELD_GUARD,
  ABILITY_SPAWN_CREEP_TUMOR,
  ABILITY_BLINK,
  ABILITY_FOCUS_SIGHT,
  // ── P3 Terran ──
  ABILITY_EMP,
  ABILITY_GHOST_CLOAK,
  ABILITY_PHASE_SNIPE,
  ABILITY_TACTICAL_MARK,
  ABILITY_MISSILE_BARRAGE,
  ABILITY_WAR_FERVOR,
  ABILITY_FLAME_DASH,
  ABILITY_RAIDER_SCORCH,
  ABILITY_MARAUDER_SLOW,
  ABILITY_FIREBAT_HEAT_PLATING,
  ABILITY_MARINE_COMBAT_SHIELD,
  ABILITY_MEDIVAC_LOAD,
  ABILITY_MEDIVAC_UNLOAD,
  // ── P3 Zerg ──
  ABILITY_ZERGLING_SWARM,
  ABILITY_MUTALISK_CORROSION,
  ABILITY_MUTALISK_REGEN,
  ABILITY_NEURAL_CORROSION,
  ABILITY_SPINE_PRECISION,
  ABILITY_CARAPACE_BRACE, ABILITY_CARAPACE_BRACE_CANCEL,
  ABILITY_BRACE_REGEN,
  ABILITY_SURGE_INSTINCT,
  ABILITY_ACID_BLAST,
  ABILITY_SONAR_PULSE,
  ABILITY_LURKER_BURROW, ABILITY_LURKER_BURROW_CANCEL,
  ABILITY_SPINE_RUSH,
  ABILITY_CORROSIVE_BILE,
  ABILITY_SPORE_SLIME,
  ABILITY_BROOD_POD,
  ABILITY_EARTH_SHATTER,
  ABILITY_ULTRALISK_CRUSH,
  ABILITY_ULTRALISK_PRESSURE,
  // ── P3 Protoss ──
  ABILITY_ZEALOT_SHIELD_BOOST,
  ABILITY_ZEALOT_FRENZY,
  ABILITY_ADEPT_BOUNCE,
  ABILITY_DRAGOON_ENERGY_DRIVE,
  ABILITY_DRAGOON_SLOW,
  ABILITY_STALKER_RAPID_SHIELD,
  ABILITY_THERMAL_SWEEP,
  ABILITY_COLOSSUS_PHASE_DISSIPATION,
  ABILITY_IMMORTAL_SHIELD_RESTORE,
  ABILITY_IMMORTAL_SIEGE_BREAKER,
  ABILITY_PRISMATIC_CHARGE,
  ABILITY_PHANTOM_CLONE,
  ABILITY_DARK_TEMPLAR_STEALTH,
  ABILITY_ARC_BARRIER,
  ABILITY_PSIONIC_DRAIN,
  ABILITY_STELLAR_INSIGHT,
  ABILITY_ENERGY_OVERCHARGE,
  // ── Building passives ──
  ABILITY_BUNKER_DETECTION,
]

export const ABILITY_DEFS: Record<string, AbilityDef> = {}
for (const a of ALL_ABILITIES) {
  ABILITY_DEFS[a.id] = a
}

export function getAbilityDef(abilityId: string): AbilityDef | undefined {
  return ABILITY_DEFS[abilityId]
}

/**
 * Look up the declarative buff/debuff config (duration + modifiers + vfx) for a
 * given buffId by scanning every ability's top-level `apply_buff` / `apply_debuff`
 * effect. Used to drive the buff-aura path from a test hook against real data
 * (self-buffs like stim_pack / missile_barrage / stellar_insight are top-level).
 * Returns null if no ability grants that buff directly.
 */
export function findBuffConfig(
  buffId: string,
): { duration: number; modifiers: BuffModifier[]; isDebuff: boolean; vfx?: BuffVFXConfig } | null {
  const match = (eff: AbilityEffect): { duration: number; modifiers: BuffModifier[]; isDebuff: boolean; vfx?: BuffVFXConfig } | null => {
    if (eff.type === 'apply_buff' && (eff as ApplyBuffEffect).buffId === buffId) {
      const e = eff as ApplyBuffEffect
      return { duration: e.duration, modifiers: e.modifiers, isDebuff: false, vfx: e.vfx }
    }
    if (eff.type === 'apply_debuff' && (eff as ApplyDebuffEffect).debuffId === buffId) {
      const e = eff as ApplyDebuffEffect
      return { duration: e.duration, modifiers: e.modifiers, isDebuff: true, vfx: e.vfx }
    }
    return null
  }
  for (const ability of ALL_ABILITIES) {
    for (const eff of ability.effects) { const r = match(eff); if (r) return r }
    // debuffs/marks are often applied via reactive triggers (on_attack_hit, …)
    for (const trig of ability.triggers ?? []) {
      for (const eff of trig.effects) { const r = match(eff); if (r) return r }
    }
  }
  return null
}

/**
 * Get the list of abilities available to the specified unit type
 */
export function getAbilitiesForUnit(unitTypeId: string): AbilityDef[] {
  return ALL_ABILITIES.filter(a => a.allowedUnits.includes(unitTypeId))
}

/**
 * Get the list of passive abilities for the specified unit type
 */
export function getPassiveAbilitiesForUnit(unitTypeId: string): AbilityDef[] {
  return ALL_ABILITIES.filter(a => a.isPassive && a.allowedUnits.includes(unitTypeId))
}
