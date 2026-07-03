// Per-weapon VFX config — SSOT for how each weapon's attack LOOKS (trail /
// impact color+size / melee-slash / flame-stream / slime). Faithful port of the
// Three.js source `web/effects/CombatVFX.ts` WEAPON_VFX table + getWeaponVFX().
//
// The renderer differs (source used Three.js Sprites / BufferGeometry ribbons /
// CanvasTextures; the forgeax port drives everything through the ECS transient-
// particle VfxSystem), but the DATA — the per-weapon palette + flags — is the
// same table, so weapon identity reads identically on screen (green zergling
// claws, blue psi-blade slashes, orange flame stream, etc.).
//
// Colors are kept as source 0xRRGGBB numbers; `hexRgb()` converts to the [r,g,b]
// 0..1 tuples the VfxSystem consumes.

export interface WeaponVFXConfig {
  /** Projectile trail color (0xRRGGBB). */
  trailColor: number;
  /** Projectile trail width. */
  trailWidth: number;
  /** Projectile trail length (frames retained). */
  trailLength: number;
  /** Hit-flash color. */
  impactColor: number;
  /** Hit-flash size. */
  impactSize: number;
  /** Splash effect primary color (when the weapon splashes). */
  splashColor: number;
  /** Splash effect secondary color (gradient). */
  splashColor2: number;
  /** Use a melee slash arc instead of the spherical flash. */
  meleeSlash: boolean;
  /** Slash arc color. */
  slashColor: number;
  /** Slash arc count (3 = zergling claws, 2 = zealot psi X). */
  slashCount: number;
  /** Use dripping-slime trail instead of the ribbon trail. */
  slimeDrip: boolean;
  /** Slime drip secondary color (gradient). */
  slimeDripColor2: number;
  /** Use a slime-splatter hit effect instead of the spherical flash. */
  slimeSplatter: boolean;
  /** Continuous flame stream from the unit toward the target during attack. */
  flameStream: boolean;
  /** Flame stream secondary color (gradient). */
  flameStreamColor2: number;
  /** Projectile glow sprite size (0 = none). */
  glowSize: number;
  /** Projectile glow sprite color. */
  glowColor: number;
}

const DEFAULT_VFX: WeaponVFXConfig = {
  trailColor: 0xffff44,
  trailWidth: 0.06,
  trailLength: 6,
  impactColor: 0xffaa33,
  impactSize: 0.4,
  splashColor: 0xff6600,
  splashColor2: 0xff3300,
  meleeSlash: false,
  slashColor: 0xffffff,
  slashCount: 1,
  slimeDrip: false,
  slimeDripColor2: 0x000000,
  slimeSplatter: false,
  flameStream: false,
  flameStreamColor2: 0xff3300,
  glowSize: 0,
  glowColor: 0xffffff,
};

/**
 * Per-weapon overrides, keyed by weaponId. Colors match each race + weapon's
 * background flavor (Terran gold/orange, Zerg acid-green/purple, Protoss blue).
 * A weapon not listed here uses DEFAULT_VFX.
 */
const WEAPON_VFX: Record<string, Partial<WeaponVFXConfig>> = {
  // ── Terran ──
  gauss_rifle_blitz: {
    trailColor: 0xffee44, trailWidth: 0.04, trailLength: 5,
    impactColor: 0xffcc22, impactSize: 0.3,
  },
  flame_thrower_blitz: {
    splashColor: 0xff6600, splashColor2: 0xff2200,
    flameStream: true, flameStreamColor2: 0xff3300,
  },
  marauder_cannon: {
    trailColor: 0xff8844, trailWidth: 0.10, trailLength: 8,
    impactColor: 0xff6622, impactSize: 0.5,
  },
  arclite_cannon_blitz: {
    trailColor: 0xffaa33, trailWidth: 0.14, trailLength: 10,
    impactColor: 0xff8800, impactSize: 0.8,
    splashColor: 0xff6600, splashColor2: 0xff3300,
  },
  goliath_autocannon: {
    trailColor: 0xeeff66, trailWidth: 0.06, trailLength: 6,
    impactColor: 0xffdd33, impactSize: 0.4,
  },
  thor_cannons: {
    trailColor: 0xffcc33, trailWidth: 0.18, trailLength: 12,
    impactColor: 0xff9922, impactSize: 1.0,
    splashColor: 0xff7711, splashColor2: 0xcc4400,
  },
  wraith_lasers: {
    trailColor: 0x66bbff, trailWidth: 0.05, trailLength: 6,
    impactColor: 0x88ccff, impactSize: 0.35,
  },
  raider_rifle: {
    trailColor: 0xff6633, trailWidth: 0.05, trailLength: 5,
    impactColor: 0xff5522, impactSize: 0.3,
  },
  ghost_rifle: {
    trailColor: 0x88ccff, trailWidth: 0.03, trailLength: 7,
    impactColor: 0x99ddff, impactSize: 0.25,
  },
  emp_grenade: {
    trailColor: 0x4488ff, trailWidth: 0.08, trailLength: 8,
    impactColor: 0x88ccff, impactSize: 0.6,
  },
  phase_snipe: {
    trailColor: 0x44ddff, trailWidth: 0.14, trailLength: 16,
    impactColor: 0x88eeff, impactSize: 0.9,
    splashColor: 0x22aadd, splashColor2: 0x0066aa,
    glowSize: 1.2, glowColor: 0x22ccff,
  },
  ibiks_cannon: {
    trailColor: 0xff6644, trailWidth: 0.12, trailLength: 8,
    impactColor: 0xff5533, impactSize: 0.7,
    splashColor: 0xff4422, splashColor2: 0xcc2200,
  },

  // ── Zerg ──
  zergling_claws_blitz: {
    impactColor: 0x88ff44, impactSize: 0.25,
    meleeSlash: true, slashColor: 0x88ff44, slashCount: 3,
  },
  needle_spines_blitz: {
    trailColor: 0x66ff44, trailWidth: 0.05, trailLength: 5,
    impactColor: 0x44cc22, impactSize: 0.3,
  },
  baneling_blast: {
    splashColor: 0x44ff22, splashColor2: 0x22aa00,
  },
  roach_acid: {
    trailColor: 0x88cc22, trailWidth: 0.08, trailLength: 7,
    impactColor: 0x66aa11, impactSize: 0.45,
  },
  lurker_spines: {
    trailColor: 0x99aa44, trailWidth: 0.06, trailLength: 4,
    impactColor: 0x88aa33, impactSize: 0.4,
    splashColor: 0xaa8833, splashColor2: 0x886622,
  },
  ravager_acid: {
    trailColor: 0x77bb22, trailWidth: 0.10, trailLength: 8,
    impactColor: 0x55aa11, impactSize: 0.55,
  },
  mutalisk_glaive: {
    trailColor: 0x44ff88, trailWidth: 0.06, trailLength: 6,
    impactColor: 0x33dd66, impactSize: 0.35,
  },
  corruptor_spit: {
    trailColor: 0xaa44cc, trailWidth: 0.08, trailLength: 7,
    impactColor: 0x8833aa, impactSize: 0.45,
  },
  swarm_guard_spine: {
    trailColor: 0xcc6633, trailWidth: 0.09, trailLength: 7,
    impactColor: 0xaa5522, impactSize: 0.5,
  },
  brood_pod: {
    trailColor: 0x886633, trailWidth: 0.14, trailLength: 10,
    impactColor: 0x66aa33, impactSize: 0.7,
    splashColor: 0x558822, splashColor2: 0x443311,
  },
  broodling_claws: {
    impactColor: 0x66aa33, impactSize: 0.2,
    meleeSlash: true, slashColor: 0x77bb44, slashCount: 3,
  },
  orb_spore_slime: {
    trailColor: 0x8833bb, trailWidth: 0.10, trailLength: 8,
    impactColor: 0x9944cc, impactSize: 0.45,
    splashColor: 0x663399, splashColor2: 0x441166,
    slimeDrip: true, slimeDripColor2: 0x44cc33,
    slimeSplatter: true,
  },
  kaiser_blades_blitz: {
    splashColor: 0xffddaa, splashColor2: 0xccaa77,
  },
  orb_energy_drive: {
    trailColor: 0x88ddff, trailWidth: 0.15, trailLength: 12,
    impactColor: 0xaaeeff, impactSize: 0.65,
    splashColor: 0x44bbff, splashColor2: 0x2288dd,
    glowSize: 0.8, glowColor: 0x66ddff,
  },

  // ── Protoss ──
  psi_blades_blitz: {
    impactColor: 0x44aaff, impactSize: 0.3,
    meleeSlash: true, slashColor: 0x66ccff, slashCount: 2,
  },
  adept_glaive: {
    trailColor: 0x88bbff, trailWidth: 0.06, trailLength: 6,
    impactColor: 0x6699ff, impactSize: 0.35,
  },
  phase_disruptor_blitz: {
    trailColor: 0x4488ff, trailWidth: 0.09, trailLength: 8,
    impactColor: 0x3366ee, impactSize: 0.5,
  },
  stalker_blaster: {
    trailColor: 0x44ccbb, trailWidth: 0.07, trailLength: 7,
    impactColor: 0x33aa99, impactSize: 0.4,
  },
  colossus_lance: {
    trailColor: 0xff4444, trailWidth: 0.10, trailLength: 5,
    impactColor: 0xff3333, impactSize: 0.6,
    splashColor: 0xff4422, splashColor2: 0xcc2211,
  },
  immortal_cannon: {
    trailColor: 0xffcc44, trailWidth: 0.12, trailLength: 8,
    impactColor: 0xffbb33, impactSize: 0.6,
  },
  phoenix_lasers: {
    trailColor: 0x66aaff, trailWidth: 0.04, trailLength: 4,
    impactColor: 0x5599ee, impactSize: 0.3,
  },
  void_ray_beam: {
    trailColor: 0xffdd44, trailWidth: 0.08, trailLength: 6,
    impactColor: 0xffcc33, impactSize: 0.5,
  },
};

/** Merge a weapon's overrides onto the defaults (source getWeaponVFX). */
export function getWeaponVFX(weaponId: string | undefined): WeaponVFXConfig {
  if (!weaponId) return DEFAULT_VFX;
  const override = WEAPON_VFX[weaponId];
  if (!override) return DEFAULT_VFX;
  return { ...DEFAULT_VFX, ...override };
}

/** 0xRRGGBB → [r,g,b] each 0..1 (the VfxSystem's color tuple form). */
export function hexRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}
