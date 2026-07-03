/**
 * MarsCraft -> forgeax-engine — building data table (Milestone M8)
 * =============================================================================
 * Port of the Three.js source `web/data/buildings.ts`. Building defs carry the
 * footprint / pathing-size / prerequisites / produces / research lists and the
 * build hotkey; the COST / buildTime / supplyProvide / modelSize / hp all live
 * in the matching `UnitDef` (src/data/units.ts — buildings ARE units with
 * `category: 'building'`), read here via `getUnitDef`. This mirrors the source,
 * which kept the same split (BuildingDef = placement/tech data, UnitDef = stats).
 *
 * 1:1 with the source except:
 *   - comments translated to English / ASCII-only (studio source-text rule).
 *   - the `i18n` display-name helper is replaced by `getUnitDef(...).displayName`
 *     (the unit table already carries the English label).
 */

import type { RaceType } from './units';
import { getUnitDef } from './units';

// ============================================================================
// Building def
// ============================================================================

/** Build-panel tab (SC2-style B = basic, V = advanced). */
export type BuildTab = 'basic' | 'advanced';

export interface BuildingDef {
  /** typeId — matches the building's UnitDef in units.ts. */
  typeId: string;
  /** Build hotkey (shown after a worker presses B). */
  hotkey: string;
  /** Build tab: basic = expand on B, advanced = expand on V. */
  buildTab: BuildTab;
  /** Prerequisite building typeIds (player must own a COMPLETE one of each). */
  prerequisite: string[];
  /** Unit typeIds this building can train. */
  canProduce: string[];
  /** Upgrade ids this building can research. */
  canResearch: string[];
  /** Footprint size (NxN world units) for placement + OccupancyGrid reservation. */
  footprint: number;
  /**
   * Pathing-blocked size (NxN world units) — may be smaller than footprint so
   * units can path closer to the structure. Defaults to footprint when unset.
   */
  pathingSize?: number;
  /** Must be placed on a vespene geyser. */
  requiresGeyser: boolean;
}

// ============================================================================
// Terran buildings
// ============================================================================

export const BUILD_COMMAND_CENTER: BuildingDef = {
  typeId: 'command_center', hotkey: 'C', buildTab: 'basic',
  prerequisite: [], canProduce: ['scv'], canResearch: [],
  footprint: 5, pathingSize: 4, requiresGeyser: false,
};
export const BUILD_SUPPLY_DEPOT: BuildingDef = {
  typeId: 'supply_depot', hotkey: 'S', buildTab: 'basic',
  prerequisite: ['command_center'], canProduce: [], canResearch: [],
  footprint: 2, requiresGeyser: false,
};
export const BUILD_REFINERY: BuildingDef = {
  typeId: 'refinery', hotkey: 'R', buildTab: 'basic',
  prerequisite: ['command_center'], canProduce: [], canResearch: [],
  footprint: 3, pathingSize: 2, requiresGeyser: true,
};
export const BUILD_BARRACKS: BuildingDef = {
  typeId: 'barracks', hotkey: 'B', buildTab: 'basic',
  prerequisite: ['command_center'],
  canProduce: ['marine', 'firebat', 'marauder', 'raider', 'ghost'],
  canResearch: ['stim_pack'], footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_FACTORY: BuildingDef = {
  typeId: 'factory', hotkey: 'F', buildTab: 'advanced',
  prerequisite: ['barracks'], canProduce: ['tank', 'goliath', 'thor'],
  canResearch: ['siege_mode'], footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ARMORY: BuildingDef = {
  typeId: 'armory', hotkey: 'Y', buildTab: 'advanced',
  prerequisite: ['factory'], canProduce: [],
  canResearch: ['vehicle_weapons', 'vehicle_armor', 'tactical_mark', 'war_fervor', 'missile_barrage'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_STARPORT: BuildingDef = {
  typeId: 'starport', hotkey: 'P', buildTab: 'advanced',
  prerequisite: ['factory'], canProduce: ['medivac', 'wraith'],
  canResearch: ['focus_sight', 'medivac_transport', 'wraith_afterburner'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_BUNKER: BuildingDef = {
  typeId: 'bunker', hotkey: 'U', buildTab: 'basic',
  prerequisite: ['barracks'], canProduce: [], canResearch: [],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ENGINEERING_BAY: BuildingDef = {
  typeId: 'engineering_bay', hotkey: 'E', buildTab: 'basic',
  prerequisite: ['command_center'], canProduce: [],
  canResearch: ['infantry_weapons', 'infantry_armor'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ACADEMY: BuildingDef = {
  typeId: 'academy', hotkey: 'A', buildTab: 'advanced',
  prerequisite: ['barracks'], canProduce: [],
  canResearch: ['u238_shells', 'combat_shield', 'emp', 'firebat_heat_plating', 'marauder_slow', 'raider_scorch'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};

// ============================================================================
// Zerg buildings
// ============================================================================

export const BUILD_HATCHERY: BuildingDef = {
  typeId: 'hatchery', hotkey: 'H', buildTab: 'basic',
  prerequisite: [],
  canProduce: ['drone', 'overlord', 'zergling', 'roach', 'hydralisk', 'mutalisk', 'corruptor', 'swarm_guard', 'ultralisk'],
  canResearch: [], footprint: 5, pathingSize: 4, requiresGeyser: false,
};
export const BUILD_SPAWNING_POOL: BuildingDef = {
  typeId: 'spawning_pool', hotkey: 'S', buildTab: 'basic',
  prerequisite: ['hatchery'], canProduce: [], canResearch: ['zergling_swarm'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_HYDRA_DEN: BuildingDef = {
  typeId: 'hydra_den', hotkey: 'D', buildTab: 'advanced',
  prerequisite: ['spawning_pool'], canProduce: [],
  canResearch: ['spine_precision', 'neural_corrosion'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_SPIRE: BuildingDef = {
  typeId: 'spire', hotkey: 'P', buildTab: 'advanced',
  prerequisite: ['lair'], canProduce: [], canResearch: ['mutalisk_corrosion'],
  footprint: 2, requiresGeyser: false,
};
export const BUILD_ROACH_WARREN: BuildingDef = {
  typeId: 'roach_warren', hotkey: 'R', buildTab: 'basic',
  prerequisite: ['spawning_pool'], canProduce: [],
  canResearch: ['carapace_brace', 'surge_instinct'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_BANELING_NEST: BuildingDef = {
  typeId: 'baneling_nest', hotkey: 'B', buildTab: 'basic',
  prerequisite: ['spawning_pool'], canProduce: [], canResearch: [],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_LURKER_DEN: BuildingDef = {
  typeId: 'lurker_den', hotkey: 'L', buildTab: 'advanced',
  prerequisite: ['hydra_den', 'lair'], canProduce: [], canResearch: ['spine_rush'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_SWARM_NEST: BuildingDef = {
  typeId: 'swarm_nest', hotkey: 'W', buildTab: 'advanced',
  prerequisite: ['lair', 'hydra_den'], canProduce: [], canResearch: ['brood_pod'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ULTRALISK_CAVERN: BuildingDef = {
  typeId: 'ultralisk_cavern', hotkey: 'U', buildTab: 'advanced',
  prerequisite: ['hive', 'swarm_nest'], canProduce: [],
  canResearch: ['earth_shatter', 'ultralisk_pressure'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_EXTRACTOR: BuildingDef = {
  typeId: 'extractor', hotkey: 'E', buildTab: 'basic',
  prerequisite: ['hatchery'], canProduce: [], canResearch: [],
  footprint: 3, pathingSize: 2, requiresGeyser: true,
};

// ============================================================================
// Protoss buildings
// ============================================================================

export const BUILD_NEXUS: BuildingDef = {
  typeId: 'nexus', hotkey: 'N', buildTab: 'basic',
  prerequisite: [], canProduce: ['probe'], canResearch: [],
  footprint: 5, pathingSize: 4, requiresGeyser: false,
};
export const BUILD_PYLON: BuildingDef = {
  typeId: 'pylon', hotkey: 'E', buildTab: 'basic',
  prerequisite: ['nexus'], canProduce: [], canResearch: [],
  footprint: 2, requiresGeyser: false,
};
export const BUILD_GATEWAY: BuildingDef = {
  typeId: 'gateway', hotkey: 'G', buildTab: 'basic',
  prerequisite: ['nexus'], canProduce: ['zealot', 'adept', 'sentry', 'dark_templar'],
  canResearch: [], footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_CYBERNETICS_CORE: BuildingDef = {
  typeId: 'cybernetics_core', hotkey: 'C', buildTab: 'basic',
  prerequisite: ['gateway'], canProduce: [],
  canResearch: ['blink', 'adept_bounce', 'stalker_rapid_shield', 'psionic_drain'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_TWILIGHT_COUNCIL: BuildingDef = {
  typeId: 'twilight_council', hotkey: 'T', buildTab: 'advanced',
  prerequisite: ['cybernetics_core'], canProduce: ['dragoon', 'stalker'],
  canResearch: [], footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_DARK_SHRINE: BuildingDef = {
  typeId: 'dark_shrine', hotkey: 'D', buildTab: 'advanced',
  prerequisite: ['cybernetics_core'], canProduce: [], canResearch: ['phantom_clone'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_FORGE: BuildingDef = {
  typeId: 'forge', hotkey: 'F', buildTab: 'basic',
  prerequisite: ['nexus'], canProduce: [],
  canResearch: ['dragoon_slow', 'zealot_shield_boost', 'zealot_frenzy', 'dragoon_energy_drive'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ROBOTICS: BuildingDef = {
  typeId: 'robotics', hotkey: 'R', buildTab: 'advanced',
  prerequisite: ['cybernetics_core'], canProduce: ['immortal', 'colossus'],
  canResearch: ['colossus_phase_dissipation', 'immortal_shield_restore', 'immortal_siege_breaker'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_STARGATE: BuildingDef = {
  typeId: 'stargate', hotkey: 'S', buildTab: 'advanced',
  prerequisite: ['cybernetics_core'], canProduce: ['phoenix', 'void_ray'],
  canResearch: ['strafe_run', 'prismatic_charge'],
  footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ASSIMILATOR: BuildingDef = {
  typeId: 'assimilator', hotkey: 'A', buildTab: 'basic',
  prerequisite: ['nexus'], canProduce: [], canResearch: [],
  footprint: 3, pathingSize: 2, requiresGeyser: true,
};
export const BUILD_SHIELD_BATTERY: BuildingDef = {
  typeId: 'shield_battery', hotkey: 'B', buildTab: 'basic',
  prerequisite: ['gateway'], canProduce: [], canResearch: [],
  footprint: 2, requiresGeyser: false,
};

// ============================================================================
// Morph-target buildings (not directly buildable — reached via morph)
// ============================================================================

export const BUILD_WARP_GATE: BuildingDef = {
  typeId: 'warp_gate', hotkey: '', buildTab: 'basic',
  prerequisite: ['nexus'],
  canProduce: ['zealot', 'adept', 'dragoon', 'stalker', 'sentry', 'dark_templar'],
  canResearch: [], footprint: 3, pathingSize: 2, requiresGeyser: false,
};
export const BUILD_ORBITAL_COMMAND: BuildingDef = {
  typeId: 'orbital_command', hotkey: '', buildTab: 'basic',
  prerequisite: ['barracks'], canProduce: ['scv'], canResearch: [],
  footprint: 5, pathingSize: 4, requiresGeyser: false,
};
export const BUILD_PLANETARY_FORTRESS: BuildingDef = {
  typeId: 'planetary_fortress', hotkey: '', buildTab: 'basic',
  prerequisite: ['command_center', 'engineering_bay'], canProduce: ['scv'], canResearch: [],
  footprint: 5, pathingSize: 4, requiresGeyser: false,
};
export const BUILD_LAIR: BuildingDef = {
  typeId: 'lair', hotkey: '', buildTab: 'basic',
  prerequisite: ['hatchery'],
  canProduce: ['drone', 'overlord', 'zergling', 'roach', 'hydralisk', 'mutalisk', 'corruptor', 'swarm_guard', 'ultralisk'],
  canResearch: [], footprint: 5, pathingSize: 4, requiresGeyser: false,
};
export const BUILD_HIVE: BuildingDef = {
  typeId: 'hive', hotkey: '', buildTab: 'basic',
  prerequisite: ['lair', 'hydra_den'],
  canProduce: ['drone', 'overlord', 'zergling', 'roach', 'hydralisk', 'mutalisk', 'corruptor', 'swarm_guard', 'ultralisk'],
  canResearch: [], footprint: 5, pathingSize: 4, requiresGeyser: false,
};

// ============================================================================
// Morph definitions (building -> upgraded building)
// ============================================================================

export interface MorphDef {
  fromTypeId: string;
  toTypeId: string;
  displayName: string;
  hotkey: string;
}

export const ALL_MORPHS: MorphDef[] = [
  { fromTypeId: 'command_center', toTypeId: 'planetary_fortress', displayName: 'Upgrade to Planetary Fortress', hotkey: 'P' },
  { fromTypeId: 'gateway', toTypeId: 'warp_gate', displayName: 'Morph to Warp Gate', hotkey: 'G' },
  { fromTypeId: 'hatchery', toTypeId: 'lair', displayName: 'Evolve to Lair', hotkey: 'L' },
  { fromTypeId: 'lair', toTypeId: 'hive', displayName: 'Evolve to Hive', hotkey: 'H' },
];

/** Available morphs for a source building typeId. */
export function getMorphsForBuilding(fromTypeId: string): MorphDef[] {
  return ALL_MORPHS.filter((m) => m.fromTypeId === fromTypeId);
}

// ============================================================================
// Lookup tables
// ============================================================================

const MORPH_BUILDINGS: BuildingDef[] = [
  BUILD_ORBITAL_COMMAND, BUILD_PLANETARY_FORTRESS, BUILD_WARP_GATE, BUILD_LAIR, BUILD_HIVE,
];

export const ALL_BUILDINGS: BuildingDef[] = [
  // Terran
  BUILD_COMMAND_CENTER, BUILD_SUPPLY_DEPOT, BUILD_REFINERY, BUILD_BARRACKS,
  BUILD_FACTORY, BUILD_ARMORY, BUILD_STARPORT, BUILD_BUNKER,
  BUILD_ENGINEERING_BAY, BUILD_ACADEMY,
  // Zerg (Overlord hatches from larva, not a worker-built structure -> omitted)
  BUILD_HATCHERY, BUILD_SPAWNING_POOL, BUILD_ROACH_WARREN, BUILD_HYDRA_DEN,
  BUILD_BANELING_NEST, BUILD_LURKER_DEN, BUILD_SPIRE, BUILD_SWARM_NEST,
  BUILD_ULTRALISK_CAVERN, BUILD_EXTRACTOR,
  // Protoss
  BUILD_NEXUS, BUILD_PYLON, BUILD_GATEWAY, BUILD_CYBERNETICS_CORE,
  BUILD_TWILIGHT_COUNCIL, BUILD_DARK_SHRINE, BUILD_ROBOTICS, BUILD_STARGATE,
  BUILD_FORGE, BUILD_ASSIMILATOR, BUILD_SHIELD_BATTERY,
];

export const BUILDING_DEFS: Record<string, BuildingDef> = {};
for (const b of ALL_BUILDINGS) BUILDING_DEFS[b.typeId] = b;
// Morph-target buildings are reachable too (not in the build panel).
for (const b of MORPH_BUILDINGS) BUILDING_DEFS[b.typeId] = b;

export function getBuildingDef(typeId: string): BuildingDef | undefined {
  return BUILDING_DEFS[typeId];
}

// Per-race building lists (cached) for the build panel.
const _buildingsByRace: Record<string, BuildingDef[]> = {};
export function getBuildingsForRace(race: RaceType): BuildingDef[] {
  if (!_buildingsByRace[race]) {
    _buildingsByRace[race] = ALL_BUILDINGS.filter((bd) => {
      const ud = getUnitDef(bd.typeId);
      return ud && ud.race === race;
    });
  }
  return _buildingsByRace[race];
}

// Per-race + tab building lists (SC2 paging: B = basic, V = advanced).
const _buildingsByRaceTab: Record<string, BuildingDef[]> = {};
export function getBuildingsForRaceAndTab(race: RaceType, tab: BuildTab): BuildingDef[] {
  const key = `${race}:${tab}`;
  if (!_buildingsByRaceTab[key]) {
    _buildingsByRaceTab[key] = getBuildingsForRace(race).filter((bd) => bd.buildTab === tab);
  }
  return _buildingsByRaceTab[key];
}

/** Train hotkeys (unit typeId -> letter), shown on a production building. */
export const TRAIN_HOTKEYS: Record<string, string> = {
  // Terran
  scv: 'S', marine: 'M', firebat: 'F', marauder: 'A', raider: 'R', ghost: 'G',
  tank: 'T', goliath: 'G', thor: 'R', wraith: 'W', medivac: 'E',
  // Zerg
  drone: 'D', zergling: 'Z', roach: 'R', hydralisk: 'H', baneling: 'B',
  mutalisk: 'M', corruptor: 'C', swarm_guard: 'W', ultralisk: 'U', overlord: 'O',
  // Protoss
  probe: 'P', zealot: 'Z', adept: 'A', dragoon: 'D', stalker: 'S', sentry: 'E',
  dark_templar: 'T', colossus: 'C', immortal: 'I', phoenix: 'X', void_ray: 'V',
};
