/**
 * MarsCraft -> forgeax-engine — weapon data table (Milestone M6)
 * =============================================================================
 * Port of the Three.js source `web/data/weapons.ts`. The weapon table is the
 * SSOT for combat numbers: each unit's `attackWeaponId` (set by the M3 factory)
 * looks up a `WeaponDef` here for its real damage / range / cooldown / projectile
 * / splash. M3's factory seeded the M2 `Attack` component from vision/role
 * heuristics; M6 (`attack-system.ts`) overwrites those columns from this table
 * the first time a unit is processed (see `attack-system.ts`).
 *
 * 1:1 with the source: every weapon's numbers are verbatim. `RANGE_SCALE = 1.84`
 * (1 SC range grid = 1.84 world units) is inlined here exactly as M3's units.ts
 * inlined it — `balance.ts` is otherwise an M6/M8/M9 data table. Grid-denominated
 * fields (range, splashRadius, splashWidth) are converted to world units at table
 * build time, identical to the source `weapon()` helper.
 *
 * The string union types (`DamageType` / `ProjectileType` / `SplashShape`) here
 * mirror `components.ts`'s enum const-maps (DAMAGE_TYPE / PROJECTILE_TYPE /
 * SPLASH_SHAPE); the attack-system maps a looked-up WeaponDef's strings to those
 * integer codes when it writes the SoA Attack columns.
 */

/** 1 SC range grid = 1.84 world units (Marine 5-grid range = 9.2 world units). */
export const RANGE_SCALE = 1.84;

export type DamageType = 'normal' | 'spell';
export type ProjectileType = 'instant' | 'bullet' | 'missile' | 'bounce';
export type SplashShape = 'circle' | 'cone' | 'line';

export interface WeaponDef {
  id: string;
  damage: number;
  /** Hits per attack (e.g. flamethrower = 2). */
  damageCount: number;
  damageType: DamageType;
  /** SC grid range (pre-scale). */
  rangeGrid: number;
  /** World-unit range (rangeGrid * RANGE_SCALE). */
  range: number;
  /** Attack interval, seconds. */
  cooldown: number;
  projectileType: ProjectileType;
  /** Projectile speed (instant = 0). */
  projectileSpeed: number;
  canAttackAir: boolean;
  canAttackGround: boolean;
  /** Splash radius (circle/cone R, line length L) — world units. */
  splashRadius: number;
  /** Splash shape (default circle). */
  splashShape: SplashShape;
  /** Splash falloff steps inner->outer, e.g. [1.0, 0.5, 0.25]. */
  splashFalloff: number[];
  /** Cone angle (degrees), cone only. */
  splashAngle: number;
  /** Line width (world units), line only. */
  splashWidth: number;
  /** Bounce count. */
  bounceCount: number;
  /** Per-bounce damage decay ratio. */
  bounceDamageDecay: number;
  /** Leash distance (give up chase past this). */
  leashDistance: number;
}

type WeaponInput = Omit<WeaponDef, 'range' | 'splashShape' | 'splashFalloff' | 'splashAngle' | 'splashWidth'>
  & Partial<Pick<WeaponDef, 'splashShape' | 'splashFalloff' | 'splashAngle' | 'splashWidth'>>;

/** Build a WeaponDef from grid-denominated input (mirrors source `weapon()`). */
function weapon(partial: WeaponInput): WeaponDef {
  const splashWidthGrid = partial.splashWidth ?? 0;
  const result: WeaponDef = {
    splashShape: 'circle',
    splashFalloff: [],
    splashAngle: 0,
    splashWidth: splashWidthGrid * RANGE_SCALE,
    ...partial,
    // range / splashRadius / splashWidth are grid values -> world units.
    range: partial.rangeGrid * RANGE_SCALE,
    splashRadius: partial.splashRadius * RANGE_SCALE,
  };
  result.splashWidth = splashWidthGrid * RANGE_SCALE;
  return result;
}

// ── Worker weapons ───────────────────────────────────────────────────────────

export const WEAPON_SCV_DRILL = weapon({
  id: 'scv_drill', damage: 5, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.83, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 15,
});

export const WEAPON_DRONE_CLAWS = weapon({
  id: 'drone_claws', damage: 5, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.83, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 15,
});

export const WEAPON_PARTICLE_BEAM = weapon({
  id: 'particle_beam', damage: 5, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.83, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 15,
});

// ── Terran weapons (blitz) ─────────────────────────────────────────────────

export const WEAPON_GAUSS_RIFLE_BLITZ = weapon({
  id: 'gauss_rifle_blitz', damage: 6, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 0.65, projectileType: 'bullet', projectileSpeed: 34,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_FLAME_THROWER_BLITZ = weapon({
  id: 'flame_thrower_blitz', damage: 6, damageCount: 2, damageType: 'normal',
  rangeGrid: 2, cooldown: 0.85, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 1.75,
  splashShape: 'cone', splashFalloff: [1.0], splashAngle: 70,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 18,
});

export const WEAPON_MARAUDER_CANNON = weapon({
  id: 'marauder_cannon', damage: 13, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.05, projectileType: 'missile', projectileSpeed: 20,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_ARCLITE_CANNON_BLITZ = weapon({
  id: 'arclite_cannon_blitz', damage: 32, damageCount: 1, damageType: 'normal',
  rangeGrid: 7, cooldown: 1.10, projectileType: 'bullet', projectileSpeed: 22,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 24,
});

/** Siege-mode tank weapon — high damage, long range, arc missile. */
export const WEAPON_ARCLITE_CANNON_SIEGE = weapon({
  id: 'arclite_cannon_siege', damage: 50, damageCount: 1, damageType: 'normal',
  rangeGrid: 13, cooldown: 2.14, projectileType: 'missile', projectileSpeed: 16,
  canAttackAir: false, canAttackGround: true,
  // NOTE: source pre-scaled this splashRadius (1.25 * RANGE_SCALE) then weapon()
  // multiplied by RANGE_SCALE again — replicated verbatim to stay 1:1.
  splashRadius: 1.25 * RANGE_SCALE, splashShape: 'circle', splashFalloff: [1.0, 0.5, 0.25],
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 30,
});

export const WEAPON_GOLIATH_AUTOCANNON = weapon({
  id: 'goliath_autocannon', damage: 13, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.00, projectileType: 'bullet', projectileSpeed: 30,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_THOR_CANNONS = weapon({
  id: 'thor_cannons', damage: 40, damageCount: 1, damageType: 'normal',
  rangeGrid: 7, cooldown: 1.35, projectileType: 'bullet', projectileSpeed: 20,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 24,
});

export const WEAPON_WRAITH_LASERS = weapon({
  id: 'wraith_lasers', damage: 11, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 0.75, projectileType: 'bullet', projectileSpeed: 34,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_RAIDER_RIFLE = weapon({
  id: 'raider_rifle', damage: 9, damageCount: 1, damageType: 'normal',
  rangeGrid: 4, cooldown: 0.80, projectileType: 'bullet', projectileSpeed: 30,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_GHOST_RIFLE = weapon({
  id: 'ghost_rifle', damage: 11, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 1.10, projectileType: 'bullet', projectileSpeed: 34,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

// ── Zerg weapons (blitz) ────────────────────────────────────────────────────

export const WEAPON_ZERGLING_CLAWS_BLITZ = weapon({
  id: 'zergling_claws_blitz', damage: 5, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.34, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 18,
});

export const WEAPON_NEEDLE_SPINES_BLITZ = weapon({
  id: 'needle_spines_blitz', damage: 9, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 0.70, projectileType: 'bullet', projectileSpeed: 30,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_BANELING_BLAST = weapon({
  id: 'baneling_blast', damage: 16, damageCount: 1, damageType: 'spell',
  rangeGrid: 0.5, cooldown: 1.00, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 2.75,
  splashShape: 'circle', splashFalloff: [1.0, 0.5],
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 16,
});

export const WEAPON_ROACH_ACID = weapon({
  id: 'roach_acid', damage: 13, damageCount: 1, damageType: 'normal',
  rangeGrid: 4, cooldown: 0.95, projectileType: 'missile', projectileSpeed: 20,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_LURKER_SPINES = weapon({
  id: 'lurker_spines', damage: 15, damageCount: 1, damageType: 'normal',
  rangeGrid: 8, cooldown: 1.20, projectileType: 'bullet', projectileSpeed: 24,
  canAttackAir: false, canAttackGround: true, splashRadius: 2.5,
  splashShape: 'line', splashFalloff: [1.0, 0.5], splashWidth: 1.0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_RAVAGER_ACID = weapon({
  id: 'ravager_acid', damage: 16, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.20, projectileType: 'missile', projectileSpeed: 20,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_MUTALISK_GLAIVE = weapon({
  id: 'mutalisk_glaive', damage: 7, damageCount: 1, damageType: 'normal',
  rangeGrid: 3, cooldown: 1.10, projectileType: 'bounce', projectileSpeed: 26,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 3, bounceDamageDecay: 0.33, leashDistance: 22,
});

export const WEAPON_CORRUPTOR_SPIT = weapon({
  id: 'corruptor_spit', damage: 13, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.00, projectileType: 'missile', projectileSpeed: 22,
  canAttackAir: true, canAttackGround: false, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_CORRUPTOR_SONIC = weapon({
  id: 'corruptor_sonic', damage: 11, damageCount: 1, damageType: 'spell',
  rangeGrid: 4, cooldown: 1.10, projectileType: 'missile', projectileSpeed: 26,
  canAttackAir: true, canAttackGround: false, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_LURKER_CLAWS = weapon({
  id: 'lurker_claws', damage: 8, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 1.50, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 18,
});

export const WEAPON_SWARM_GUARD_SPINE = weapon({
  id: 'swarm_guard_spine', damage: 17, damageCount: 1, damageType: 'normal',
  rangeGrid: 10, cooldown: 1.45, projectileType: 'missile', projectileSpeed: 20,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_BROODLING_CLAWS = weapon({
  id: 'broodling_claws', damage: 6, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.65, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 15,
});

export const WEAPON_KAISER_BLADES_BLITZ = weapon({
  id: 'kaiser_blades_blitz', damage: 32, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.75, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 1.0,
  splashShape: 'circle', splashFalloff: [0.5],
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 18,
});

// ── Protoss weapons (blitz) ─────────────────────────────────────────────────

export const WEAPON_PSI_BLADES_BLITZ = weapon({
  id: 'psi_blades_blitz', damage: 7, damageCount: 2, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 0.85, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 18,
});

export const WEAPON_ADEPT_GLAIVE = weapon({
  id: 'adept_glaive', damage: 10, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 0.90, projectileType: 'bullet', projectileSpeed: 26,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0.5, leashDistance: 22,
});

export const WEAPON_PHASE_DISRUPTOR_BLITZ = weapon({
  id: 'phase_disruptor_blitz', damage: 17, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 1.05, projectileType: 'missile', projectileSpeed: 20,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_STALKER_BLASTER = weapon({
  id: 'stalker_blaster', damage: 13, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 0.80, projectileType: 'missile', projectileSpeed: 22,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_COLOSSUS_LANCE = weapon({
  id: 'colossus_lance', damage: 20, damageCount: 1, damageType: 'spell',
  rangeGrid: 7, cooldown: 1.20, projectileType: 'bullet', projectileSpeed: 28,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 24,
});

export const WEAPON_IMMORTAL_CANNON = weapon({
  id: 'immortal_cannon', damage: 28, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.30, projectileType: 'missile', projectileSpeed: 18,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_PHOENIX_LASERS = weapon({
  id: 'phoenix_lasers', damage: 9, damageCount: 1, damageType: 'normal',
  rangeGrid: 5, cooldown: 0.55, projectileType: 'bullet', projectileSpeed: 34,
  canAttackAir: true, canAttackGround: false, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_VOID_RAY_BEAM = weapon({
  id: 'void_ray_beam', damage: 30, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.10, projectileType: 'bullet', projectileSpeed: 28,
  canAttackAir: true, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

export const WEAPON_SHADOW_BLADES = weapon({
  id: 'shadow_blades', damage: 35, damageCount: 1, damageType: 'normal',
  rangeGrid: 0.5, cooldown: 1.10, projectileType: 'instant', projectileSpeed: 0,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 18,
});

export const WEAPON_PHASE_ORB = weapon({
  id: 'phase_orb', damage: 8, damageCount: 1, damageType: 'spell',
  rangeGrid: 4, cooldown: 1.20, projectileType: 'missile', projectileSpeed: 24,
  canAttackAir: false, canAttackGround: true, splashRadius: 0,
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 22,
});

// ── Building weapons ────────────────────────────────────────────────────────

export const WEAPON_IBIKS_CANNON = weapon({
  id: 'ibiks_cannon', damage: 40, damageCount: 1, damageType: 'normal',
  rangeGrid: 6, cooldown: 1.50, projectileType: 'bullet', projectileSpeed: 18,
  canAttackAir: false, canAttackGround: true, splashRadius: 1.5,
  splashShape: 'circle', splashFalloff: [0.5],
  bounceCount: 0, bounceDamageDecay: 0, leashDistance: 24,
});

// ── Lookup table ────────────────────────────────────────────────────────────

export const ALL_WEAPONS: WeaponDef[] = [
  // workers
  WEAPON_SCV_DRILL, WEAPON_DRONE_CLAWS, WEAPON_PARTICLE_BEAM,
  // Terran
  WEAPON_GAUSS_RIFLE_BLITZ, WEAPON_FLAME_THROWER_BLITZ, WEAPON_MARAUDER_CANNON,
  WEAPON_ARCLITE_CANNON_BLITZ, WEAPON_ARCLITE_CANNON_SIEGE,
  WEAPON_GOLIATH_AUTOCANNON, WEAPON_THOR_CANNONS, WEAPON_WRAITH_LASERS,
  WEAPON_RAIDER_RIFLE, WEAPON_GHOST_RIFLE,
  // Zerg
  WEAPON_ZERGLING_CLAWS_BLITZ, WEAPON_NEEDLE_SPINES_BLITZ,
  WEAPON_BANELING_BLAST, WEAPON_ROACH_ACID, WEAPON_LURKER_SPINES, WEAPON_LURKER_CLAWS,
  WEAPON_RAVAGER_ACID, WEAPON_MUTALISK_GLAIVE, WEAPON_CORRUPTOR_SPIT, WEAPON_CORRUPTOR_SONIC,
  WEAPON_SWARM_GUARD_SPINE, WEAPON_BROODLING_CLAWS, WEAPON_KAISER_BLADES_BLITZ,
  // Protoss
  WEAPON_PSI_BLADES_BLITZ, WEAPON_ADEPT_GLAIVE,
  WEAPON_PHASE_DISRUPTOR_BLITZ, WEAPON_STALKER_BLASTER,
  WEAPON_COLOSSUS_LANCE, WEAPON_IMMORTAL_CANNON,
  WEAPON_PHOENIX_LASERS, WEAPON_VOID_RAY_BEAM,
  WEAPON_SHADOW_BLADES, WEAPON_PHASE_ORB,
  // buildings
  WEAPON_IBIKS_CANNON,
];

export const WEAPON_DEFS: Record<string, WeaponDef> = {};
for (const w of ALL_WEAPONS) {
  WEAPON_DEFS[w.id] = w;
}

export function getWeaponDef(weaponId: string): WeaponDef | undefined {
  return WEAPON_DEFS[weaponId];
}
