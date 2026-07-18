/**
 * MarsCraft -> forgeax-engine — AI build-order + difficulty data (Milestone M13 ch1)
 * =============================================================================
 * Faithful port of the per-race BUILD_ORDER tables + the difficulty configs from
 * the Three.js source `web/systems/SimpleAI.ts` (DIFFICULTY_CONFIGS,
 * TERRAN/ZERG/PROTOSS build orders, RACE_CONFIGS). Pure data — no ECS, no world;
 * the M13 SimpleAI system (src/systems/simple-ai.ts) consumes it.
 *
 * The numbers are 1:1 with the source. A few *consumers* of these fields are the
 * M13 chunk-2 seam (scouting / adaptive threat / expansion / research); the data
 * is ported whole so chunk-2 needs no data change, only new code paths.
 */

import type { RaceType } from './units';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

/** Difficulty knobs (source DifficultyConfig). Faithful numbers. */
export interface DifficultyConfig {
  /** Decision cadence (seconds between AI update cycles). */
  decisionInterval: number;
  /** Worker cap (hard ceiling; the effective cap also considers mineral count). */
  maxWorkers: number;
  /** Base army cap (initial). */
  maxArmy: number;
  /** Army-cap bonus per extra base (chunk-2 expansion seam). */
  maxArmyPerExtraBase: number;
  /** Army-cap growth per game-minute. */
  maxArmyPerMinute: number;
  /** Absolute army-cap ceiling. */
  maxArmyCap: number;
  /** Will this difficulty ever attack? */
  willAttack: boolean;
  /** Army size that triggers the FIRST attack wave. */
  attackThreshold: number;
  /** Army size that triggers the SECOND (and later) waves. */
  attackThreshold2: number;
  /** Max production buildings of each type (chunk-2 free-build seam). */
  maxProductionBuildings: number;
  /** Will it expand to new bases? (chunk-2 seam) */
  willExpand: boolean;
  /** Will it scout? (chunk-2 seam) */
  willScout: boolean;
  /** Will it research upgrades? (chunk-2 seam) */
  willResearch: boolean;
  /** Will it focus-fire low-hp targets? (chunk-2 seam) */
  willFocusFire: boolean;
  /** Retreat wounded below this hp ratio (0 = never; chunk-2 micro seam). */
  retreatHpRatio: number;
  /** Mineral hoard that triggers extra production buildings (chunk-2 seam). */
  excessMineralThreshold: number;
  /** Earliest expansion time, seconds (chunk-2 seam). */
  expandMinTime: number;
  /** Extra expansion delay per existing base (chunk-2 seam). */
  expandExtraTimePerBase: number;
  /** Min army before expanding (chunk-2 seam). */
  expandMinArmy: number;
  /** Extra army per base before expanding (chunk-2 seam). */
  expandExtraArmyPerBase: number;
  /** Excess minerals that force a proactive expansion (chunk-2 seam). */
  expandExcessMineralThreshold: number;
  /** Enable dynamic threat assessment (hard AI; chunk-2 seam). */
  adaptiveStrategy: boolean;
}

export const DIFFICULTY_CONFIGS: Record<AIDifficulty, DifficultyConfig> = {
  easy: {
    decisionInterval: 8,
    maxWorkers: 12,
    maxArmy: 10,
    maxArmyPerExtraBase: 5,
    maxArmyPerMinute: 0.5,
    maxArmyCap: 50,
    willAttack: true,
    attackThreshold: 15,
    attackThreshold2: 15,
    maxProductionBuildings: 1,
    willExpand: false,
    willScout: false,
    willResearch: false,
    willFocusFire: false,
    retreatHpRatio: 0,
    excessMineralThreshold: 800,
    expandMinTime: 9999,
    expandExtraTimePerBase: 0,
    expandMinArmy: 999,
    expandExtraArmyPerBase: 0,
    expandExcessMineralThreshold: 9999,
    adaptiveStrategy: false,
  },
  normal: {
    decisionInterval: 4,
    maxWorkers: 44,
    maxArmy: 15,
    maxArmyPerExtraBase: 15,
    maxArmyPerMinute: 2,
    maxArmyCap: 80,
    willAttack: true,
    attackThreshold: 10,
    attackThreshold2: 18,
    maxProductionBuildings: 2,
    willExpand: true,
    willScout: true,
    willResearch: true,
    willFocusFire: true,
    retreatHpRatio: 0.2,
    excessMineralThreshold: 600,
    expandMinTime: 360,
    expandExtraTimePerBase: 180,
    expandMinArmy: 10,
    expandExtraArmyPerBase: 6,
    expandExcessMineralThreshold: 800,
    adaptiveStrategy: false,
  },
  hard: {
    decisionInterval: 2,
    maxWorkers: 60,
    maxArmy: 20,
    maxArmyPerExtraBase: 20,
    maxArmyPerMinute: 3,
    maxArmyCap: 100,
    willAttack: true,
    attackThreshold: 8,
    attackThreshold2: 14,
    maxProductionBuildings: 3,
    willExpand: true,
    willScout: true,
    willResearch: true,
    willFocusFire: true,
    retreatHpRatio: 0.3,
    excessMineralThreshold: 400,
    expandMinTime: 360,
    expandExtraTimePerBase: 180,
    expandMinArmy: 10,
    expandExtraArmyPerBase: 6,
    expandExcessMineralThreshold: 700,
    adaptiveStrategy: true,
  },
};

// ============================================================================
// Per-race build orders (source TERRAN/ZERG/PROTOSS_BUILD_ORDER)
// ============================================================================

/** One build-order step (source BuildStep). */
export interface BuildStep {
  /**
   * - `build`        — construct a building (typeId)
   * - `train`        — train a unit (typeId)
   * - `wait_workers` — block until worker count >= count
   * - `wait_supply`  — block until free supply >= count
   * - `gas`          — build the race's gas structure on a free geyser
   * - `morph`        — morph a building fromTypeId -> typeId (chunk-2 seam:
   *                    building-morph is stepped-past here; SimpleAI's
   *                    _tryMorphBuilding wiring is chunk-2)
   */
  action: 'build' | 'train' | 'wait_workers' | 'wait_supply' | 'gas' | 'morph';
  typeId?: string;
  fromTypeId?: string;
  count?: number;
}

export const TERRAN_BUILD_ORDER: BuildStep[] = [
  { action: 'wait_workers', count: 6 },
  { action: 'build', typeId: 'supply_depot' },
  { action: 'wait_workers', count: 8 },
  { action: 'build', typeId: 'barracks' },
  { action: 'gas' },
  { action: 'wait_workers', count: 10 },
  { action: 'build', typeId: 'supply_depot' },
  { action: 'build', typeId: 'barracks' },
  { action: 'build', typeId: 'factory' },
  { action: 'build', typeId: 'supply_depot' },
  { action: 'build', typeId: 'engineering_bay' },
  { action: 'build', typeId: 'armory' },
  { action: 'build', typeId: 'starport' },
  // building-morph to planetary_fortress is a chunk-2 seam (stepped past).
  { action: 'morph', typeId: 'planetary_fortress', fromTypeId: 'command_center' },
];

export const ZERG_BUILD_ORDER: BuildStep[] = [
  { action: 'wait_workers', count: 6 },
  { action: 'build', typeId: 'spawning_pool' },
  { action: 'gas' },
  { action: 'wait_workers', count: 10 },
  { action: 'build', typeId: 'roach_warren' },
  { action: 'morph', typeId: 'lair', fromTypeId: 'hatchery' },
  { action: 'build', typeId: 'hydra_den' },
  { action: 'morph', typeId: 'hive', fromTypeId: 'lair' },
];

export const PROTOSS_BUILD_ORDER: BuildStep[] = [
  { action: 'wait_workers', count: 6 },
  { action: 'build', typeId: 'pylon' },
  { action: 'wait_workers', count: 8 },
  { action: 'build', typeId: 'gateway' },
  { action: 'gas' },
  { action: 'wait_workers', count: 10 },
  { action: 'build', typeId: 'pylon' },
  { action: 'build', typeId: 'gateway' },
  { action: 'build', typeId: 'cybernetics_core' },
  { action: 'morph', typeId: 'warp_gate', fromTypeId: 'gateway' },
  { action: 'build', typeId: 'pylon' },
  { action: 'build', typeId: 'robotics' },
];

// ============================================================================
// Per-race config (source RaceConfig / RACE_CONFIGS)
// ============================================================================

export interface RaceConfig {
  /** Town-hall typeId. */
  baseTypeId: string;
  /** Worker typeId (scv / drone / probe). */
  workerTypeId: string;
  /** Supply structure/unit typeId (depot / overlord / pylon). */
  supplyTypeId: string;
  /** True when supply comes from a UNIT (zerg overlord) not a building. */
  supplyIsUnit: boolean;
  /** Gas structure typeId (refinery / extractor / assimilator). */
  gasTypeId: string;
  buildOrder: BuildStep[];
  /** T1 army units (cheap, early). */
  t1Units: string[];
  /** T2 army units (need tech). */
  t2Units: string[];
  /**
   * Target squad composition: unitTypeId -> relative weight. The AI trains the
   * unit with the biggest deficit vs this ratio (units that lost tech-gating are
   * filtered out and the rest re-normalized).
   */
  targetComposition: Record<string, number>;
  /** Supply the supply structure/unit provides. */
  supplyProvide: number;
  /** Base-equivalent typeIds (for "do I still have a base?"). */
  baseEquivalents: string[];
  /** Extra production buildings for resource overflow (chunk-2 seam). */
  productionBuildings: string[];
  /** Research priority [upgradeId, buildingTypeId] (chunk-2 seam). */
  upgradePriority: Array<[string, string]>;
}

export const RACE_CONFIGS: Record<RaceType, RaceConfig> = {
  terran: {
    baseTypeId: 'command_center',
    workerTypeId: 'scv',
    supplyTypeId: 'supply_depot',
    supplyIsUnit: false,
    gasTypeId: 'refinery',
    buildOrder: TERRAN_BUILD_ORDER,
    t1Units: ['marine', 'firebat'],
    t2Units: ['marauder', 'tank', 'goliath', 'medivac'],
    targetComposition: {
      marine: 5,
      firebat: 2,
      marauder: 3,
      tank: 2,
      goliath: 1,
      medivac: 2,
    },
    supplyProvide: 16,
    baseEquivalents: ['command_center', 'orbital_command', 'planetary_fortress'],
    productionBuildings: ['barracks', 'factory', 'starport'],
    upgradePriority: [
      ['stim_pack', 'barracks'],
      ['infantry_weapons', 'engineering_bay'],
      ['siege_mode', 'factory'],
      ['infantry_armor', 'engineering_bay'],
      ['u238_shells', 'academy'],
    ],
  },
  zerg: {
    baseTypeId: 'hatchery',
    workerTypeId: 'drone',
    supplyTypeId: 'overlord',
    supplyIsUnit: true,
    gasTypeId: 'extractor',
    buildOrder: ZERG_BUILD_ORDER,
    t1Units: ['zergling'],
    t2Units: ['roach', 'hydralisk', 'mutalisk'],
    targetComposition: {
      zergling: 5,
      roach: 3,
      hydralisk: 3,
      mutalisk: 2,
      ultralisk: 1,
    },
    supplyProvide: 8,
    baseEquivalents: ['hatchery', 'lair', 'hive'],
    productionBuildings: [],
    upgradePriority: [
      ['brood_pod', 'swarm_nest'],
      ['earth_shatter', 'ultralisk_cavern'],
      ['ultralisk_pressure', 'swarm_nest'],
    ],
  },
  protoss: {
    baseTypeId: 'nexus',
    workerTypeId: 'probe',
    supplyTypeId: 'pylon',
    supplyIsUnit: false,
    gasTypeId: 'assimilator',
    buildOrder: PROTOSS_BUILD_ORDER,
    t1Units: ['zealot', 'adept'],
    t2Units: ['stalker', 'dragoon', 'immortal', 'colossus'],
    targetComposition: {
      zealot: 4,
      adept: 2,
      stalker: 3,
      dragoon: 2,
      immortal: 2,
      colossus: 1,
    },
    supplyProvide: 16,
    baseEquivalents: ['nexus'],
    productionBuildings: ['gateway', 'warp_gate', 'robotics', 'stargate'],
    upgradePriority: [
      ['blink', 'cybernetics_core'],
      ['dragoon_slow', 'forge'],
      ['strafe_run', 'stargate'],
    ],
  },
};
