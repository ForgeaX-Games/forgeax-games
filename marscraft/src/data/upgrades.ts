/**
 * MarsCraft -> forgeax-engine — upgrade data table (Milestone M9 chunk 2)
 * =============================================================================
 * Port of the Three.js source `web/data/buildings.ts` §UpgradeDef table
 * (`UPGRADE_*` consts + `ALL_UPGRADES` + `UPGRADE_DEFS` + `getUpgradeDef`).
 *
 * The source kept upgrade cost/time/maxLevel in `data/buildings.ts` and the
 * upgrade EFFECT logic (which UnitStats fields each upgrade bumps for which unit
 * category) in `systems/UpgradeManager.ts`. This port splits them faithfully:
 *   - DATA (cost/time/maxLevel/hotkey) lives here, 1:1 with the source table.
 *   - EFFECT logic lives in `systems/upgrade-manager.ts`.
 *
 * Chinese display strings/descriptions in the source are rendered to English
 * (the source's i18n key carries the localized label; here `displayName` is the
 * source's English-equivalent and `description` summarizes the effect). The
 * NUMBERS (mineralCostPerLevel / gasCostPerLevel / researchTimePerLevel /
 * maxLevel / hotkey) are verbatim from the source.
 */

export interface UpgradeDef {
  upgradeId: string;
  displayName: string;
  /** Mineral cost per level. */
  mineralCostPerLevel: number;
  /** Gas cost per level. */
  gasCostPerLevel: number;
  /** Research time per level (seconds). */
  researchTimePerLevel: number;
  /** Max level (1 for unlock-style upgrades, 3 for weapon/armor). */
  maxLevel: number;
  /** Effect summary (display only). */
  description: string;
  /** Hotkey letter (unique within the owning building's canResearch list). */
  hotkey: string;
}

/** Build an UpgradeDef with the common 1-level/100-100-40 defaults pre-filled. */
function up(p: Partial<UpgradeDef> & Pick<UpgradeDef, 'upgradeId' | 'displayName' | 'hotkey'>): UpgradeDef {
  return {
    mineralCostPerLevel: 100,
    gasCostPerLevel: 100,
    researchTimePerLevel: 40,
    maxLevel: 1,
    description: '',
    ...p,
  };
}

// ── Terran weapon/armor (3 levels) ────────────────────────────────────────────
export const UPGRADE_INFANTRY_WEAPONS = up({ upgradeId: 'infantry_weapons', displayName: 'Infantry Weapons', maxLevel: 3, description: 'Infantry attack +1/level', hotkey: 'W' });
export const UPGRADE_INFANTRY_ARMOR = up({ upgradeId: 'infantry_armor', displayName: 'Infantry Armor', maxLevel: 3, description: 'Infantry armor +1/level', hotkey: 'A' });
export const UPGRADE_VEHICLE_WEAPONS = up({ upgradeId: 'vehicle_weapons', displayName: 'Vehicle Weapons', maxLevel: 3, description: 'Vehicle attack +1/level', hotkey: 'W' });
export const UPGRADE_VEHICLE_ARMOR = up({ upgradeId: 'vehicle_armor', displayName: 'Vehicle Armor', maxLevel: 3, description: 'Vehicle armor +1/level', hotkey: 'A' });

// ── Terran utility ────────────────────────────────────────────────────────────
export const UPGRADE_STIM_PACK = up({ upgradeId: 'stim_pack', displayName: 'Stim Pack', researchTimePerLevel: 60, description: 'Marines/Firebats can use Stim (+50% attack speed, -10 HP)', hotkey: 'T' });
export const UPGRADE_U238_SHELLS = up({ upgradeId: 'u238_shells', displayName: 'U-238 Shells', mineralCostPerLevel: 150, gasCostPerLevel: 150, researchTimePerLevel: 60, description: 'Marine range +1', hotkey: 'U' });
export const UPGRADE_COMBAT_SHIELD = up({ upgradeId: 'combat_shield', displayName: 'Combat Shield', description: 'Raider max HP +15', hotkey: 'C' });
export const UPGRADE_SIEGE_MODE = up({ upgradeId: 'siege_mode', displayName: 'Siege Mode', mineralCostPerLevel: 120, gasCostPerLevel: 120, researchTimePerLevel: 50, description: 'Unlock Tank siege mode', hotkey: 'E' });
export const UPGRADE_FOCUS_SIGHT = up({ upgradeId: 'focus_sight', displayName: 'Focus Sight', description: 'Unlock Wraith focus sight', hotkey: 'F' });
export const UPGRADE_MEDIVAC_TRANSPORT = up({ upgradeId: 'medivac_transport', displayName: 'Medivac Transport', mineralCostPerLevel: 75, gasCostPerLevel: 75, researchTimePerLevel: 35, description: 'Unlock Medivac load/unload', hotkey: 'T' });
export const UPGRADE_EMP = up({ upgradeId: 'emp', displayName: 'EMP Round', mineralCostPerLevel: 150, gasCostPerLevel: 150, researchTimePerLevel: 60, description: 'Unlock Ghost EMP', hotkey: 'E' });
export const UPGRADE_FIREBAT_HEAT_PLATING = up({ upgradeId: 'firebat_heat_plating', displayName: 'Heat Plating', description: 'Firebat heat plating (damage reduction when hurt)', hotkey: 'F' });
export const UPGRADE_MARAUDER_SLOW = up({ upgradeId: 'marauder_slow', displayName: 'Concussive Shells', description: 'Marauder attacks slow targets', hotkey: 'M' });
export const UPGRADE_RAIDER_SCORCH = up({ upgradeId: 'raider_scorch', displayName: 'Scorched Earth', researchTimePerLevel: 45, description: 'Unlock Raider scorch', hotkey: 'R' });
export const UPGRADE_TACTICAL_MARK = up({ upgradeId: 'tactical_mark', displayName: 'Tactical Mark', description: 'Unlock Goliath tactical mark (damage mark)', hotkey: 'T' });
export const UPGRADE_WAR_FERVOR = up({ upgradeId: 'war_fervor', displayName: 'War Fervor', mineralCostPerLevel: 150, gasCostPerLevel: 150, researchTimePerLevel: 55, description: 'Unlock Thor war fervor (attack speed)', hotkey: 'F' });
export const UPGRADE_MISSILE_BARRAGE = up({ upgradeId: 'missile_barrage', displayName: 'Missile Barrage', mineralCostPerLevel: 150, gasCostPerLevel: 150, researchTimePerLevel: 55, description: 'Unlock Thor missile barrage', hotkey: 'M' });
export const UPGRADE_WRAITH_AFTERBURNER = up({ upgradeId: 'wraith_afterburner', displayName: 'Afterburners', description: 'Unlock Wraith afterburners (speed)', hotkey: 'W' });

// ── Zerg ──────────────────────────────────────────────────────────────────────
export const UPGRADE_ZERGLING_SWARM = up({ upgradeId: 'zergling_swarm', displayName: 'Swarm Rush', description: 'Unlock Zergling swarm rush (charge speed)', hotkey: 'Z' });
export const UPGRADE_CARAPACE_BRACE = up({ upgradeId: 'carapace_brace', displayName: 'Carapace Brace', description: 'Roach carapace brace (damage reduction when hurt)', hotkey: 'C' });
export const UPGRADE_NEURAL_CORROSION = up({ upgradeId: 'neural_corrosion', displayName: 'Neural Corrosion', researchTimePerLevel: 45, description: 'Hydralisk neural corrosion (armor -10%/stack, max 6)', hotkey: 'N' });
export const UPGRADE_SPINE_PRECISION = up({ upgradeId: 'spine_precision', displayName: 'Spine Precision', description: 'Hydralisk spine precision (damage mark)', hotkey: 'P' });
export const UPGRADE_SPINE_RUSH = up({ upgradeId: 'spine_rush', displayName: 'Spine Volley', description: 'Lurker spine volley (attack speed burst)', hotkey: 'R' });
export const UPGRADE_MUTALISK_CORROSION = up({ upgradeId: 'mutalisk_corrosion', displayName: 'Corrosive Glaive', mineralCostPerLevel: 120, gasCostPerLevel: 120, researchTimePerLevel: 50, description: 'Mutalisk corrosive glaive (bounce armor reduction)', hotkey: 'C' });
export const UPGRADE_SURGE_INSTINCT = up({ upgradeId: 'surge_instinct', displayName: 'Surge Instinct', description: 'Roach surge instinct (+15% move speed out of brace)', hotkey: 'S' });
export const UPGRADE_EARTH_SHATTER = up({ upgradeId: 'earth_shatter', displayName: 'Earth Shatter', mineralCostPerLevel: 160, gasCostPerLevel: 160, researchTimePerLevel: 60, description: 'Unlock Ultralisk dash', hotkey: 'E' });
export const UPGRADE_ULTRALISK_PRESSURE = up({ upgradeId: 'ultralisk_pressure', displayName: 'Pressure Field', mineralCostPerLevel: 140, gasCostPerLevel: 140, researchTimePerLevel: 55, description: 'Unlock Ultralisk slow aura', hotkey: 'P' });
export const UPGRADE_BROOD_POD = up({ upgradeId: 'brood_pod', displayName: 'Brood Pod', mineralCostPerLevel: 120, gasCostPerLevel: 120, researchTimePerLevel: 50, description: 'Unlock Swarm Guard brood pod', hotkey: 'B' });

// ── Protoss ───────────────────────────────────────────────────────────────────
export const UPGRADE_BLINK = up({ upgradeId: 'blink', displayName: 'Blink', mineralCostPerLevel: 150, gasCostPerLevel: 150, researchTimePerLevel: 55, description: 'Unlock Stalker blink', hotkey: 'B' });
export const UPGRADE_STRAFE_RUN = up({ upgradeId: 'strafe_run', displayName: 'Gravity Beam', mineralCostPerLevel: 120, gasCostPerLevel: 120, researchTimePerLevel: 50, description: 'Unlock Phoenix gravity beam (lift non-massive ground)', hotkey: 'S' });
export const UPGRADE_PRISMATIC_CHARGE = up({ upgradeId: 'prismatic_charge', displayName: 'Prismatic Strike', mineralCostPerLevel: 150, gasCostPerLevel: 150, researchTimePerLevel: 60, description: 'Unlock Void Ray prismatic strike', hotkey: 'P' });
export const UPGRADE_DRAGOON_SLOW = up({ upgradeId: 'dragoon_slow', displayName: 'Lingering Bolt', researchTimePerLevel: 45, description: 'Dragoon attacks slow targets', hotkey: 'D' });
export const UPGRADE_ZEALOT_SHIELD_BOOST = up({ upgradeId: 'zealot_shield_boost', displayName: 'Shield Overload', description: 'Unlock Zealot shield overload (temp shield)', hotkey: 'S' });
export const UPGRADE_ZEALOT_FRENZY = up({ upgradeId: 'zealot_frenzy', displayName: 'Frenzy', description: 'Unlock Zealot frenzy (attack speed)', hotkey: 'F' });
export const UPGRADE_ADEPT_BOUNCE = up({ upgradeId: 'adept_bounce', displayName: 'Psionic Bounce', researchTimePerLevel: 45, description: 'Unlock Adept psionic bounce', hotkey: 'A' });
export const UPGRADE_DRAGOON_ENERGY_DRIVE = up({ upgradeId: 'dragoon_energy_drive', displayName: 'Energy Drive', description: 'Unlock Dragoon energy drive', hotkey: 'E' });
export const UPGRADE_STALKER_RAPID_SHIELD = up({ upgradeId: 'stalker_rapid_shield', displayName: 'Rapid Shields', description: 'Stalker rapid shield regen', hotkey: 'R' });
export const UPGRADE_COLOSSUS_PHASE_DISSIPATION = up({ upgradeId: 'colossus_phase_dissipation', displayName: 'Phase Dissipation', description: 'Colossus phase dissipation', hotkey: 'D' });
export const UPGRADE_IMMORTAL_SHIELD_RESTORE = up({ upgradeId: 'immortal_shield_restore', displayName: 'Shield Restore', description: 'Immortal shield restore', hotkey: 'R' });
export const UPGRADE_IMMORTAL_SIEGE_BREAKER = up({ upgradeId: 'immortal_siege_breaker', displayName: 'Siege Breaker', description: 'Immortal siege breaker', hotkey: 'B' });
export const UPGRADE_PHANTOM_CLONE = up({ upgradeId: 'phantom_clone', displayName: 'Phantom Clone', description: 'Unlock Dark Templar phantom clone', hotkey: 'C' });
export const UPGRADE_PSIONIC_DRAIN = up({ upgradeId: 'psionic_drain', displayName: 'Psionic Drain', description: 'Unlock Sentry psionic drain', hotkey: 'D' });

/** All upgrade defs, 1:1 with the source `ALL_UPGRADES`. */
export const ALL_UPGRADES: UpgradeDef[] = [
  UPGRADE_INFANTRY_WEAPONS, UPGRADE_INFANTRY_ARMOR, UPGRADE_VEHICLE_WEAPONS, UPGRADE_VEHICLE_ARMOR,
  UPGRADE_STIM_PACK, UPGRADE_U238_SHELLS, UPGRADE_COMBAT_SHIELD, UPGRADE_SIEGE_MODE,
  UPGRADE_FOCUS_SIGHT, UPGRADE_MEDIVAC_TRANSPORT, UPGRADE_EMP, UPGRADE_FIREBAT_HEAT_PLATING,
  UPGRADE_MARAUDER_SLOW, UPGRADE_RAIDER_SCORCH, UPGRADE_TACTICAL_MARK, UPGRADE_WAR_FERVOR,
  UPGRADE_MISSILE_BARRAGE, UPGRADE_WRAITH_AFTERBURNER,
  UPGRADE_ZERGLING_SWARM, UPGRADE_CARAPACE_BRACE, UPGRADE_NEURAL_CORROSION, UPGRADE_SPINE_PRECISION,
  UPGRADE_SPINE_RUSH, UPGRADE_MUTALISK_CORROSION, UPGRADE_SURGE_INSTINCT, UPGRADE_EARTH_SHATTER,
  UPGRADE_ULTRALISK_PRESSURE, UPGRADE_BROOD_POD,
  UPGRADE_BLINK, UPGRADE_STRAFE_RUN, UPGRADE_PRISMATIC_CHARGE, UPGRADE_DRAGOON_SLOW,
  UPGRADE_ZEALOT_SHIELD_BOOST, UPGRADE_ZEALOT_FRENZY, UPGRADE_ADEPT_BOUNCE, UPGRADE_DRAGOON_ENERGY_DRIVE,
  UPGRADE_STALKER_RAPID_SHIELD, UPGRADE_COLOSSUS_PHASE_DISSIPATION, UPGRADE_IMMORTAL_SHIELD_RESTORE,
  UPGRADE_IMMORTAL_SIEGE_BREAKER, UPGRADE_PHANTOM_CLONE, UPGRADE_PSIONIC_DRAIN,
];

export const UPGRADE_DEFS: Record<string, UpgradeDef> = {};
for (const u of ALL_UPGRADES) UPGRADE_DEFS[u.upgradeId] = u;

/** Source `getUpgradeDef`. */
export function getUpgradeDef(upgradeId: string): UpgradeDef | undefined {
  return UPGRADE_DEFS[upgradeId];
}
