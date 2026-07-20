// Map registry — id → blueprint for every ported preset, so the game can pick a
// map at load (`?map=<id>`), not just the hardcoded red-canyon. The blueprints
// themselves are the engine-agnostic mapgen data copied wholesale in M1.
//
// This is the M14 wiring: the presets were already ported; this exposes them as
// a selectable list + a resolver with a safe fallback.

import type { MapBlueprint } from './types';
import { redCanyonBlueprint } from './presets/red-canyon';
import { nebulaPlateauBlueprint } from './presets/nebula-plateau';
import { crystalWastelandBlueprint } from './presets/crystal-wasteland';
import { lavaSnowPoolBlueprint } from './presets/lava-snow-pool';
import { heatWaveHighwayBlueprint } from './presets/heat-wave-highway';
import { lostTempleBlueprint } from './presets/lost-temple';
import { twinPeaksBlueprint } from './presets/twin-peaks';

export interface MapEntry {
  id: string;
  name: string;
  blueprint: MapBlueprint;
}

/** All selectable maps. red-canyon is the default (index 0). */
export const MAP_REGISTRY: MapEntry[] = [
  { id: 'red-canyon', name: 'Red Canyon', blueprint: redCanyonBlueprint },
  { id: 'nebula-plateau', name: 'Nebula Plateau', blueprint: nebulaPlateauBlueprint },
  { id: 'crystal-wasteland', name: 'Crystal Wasteland', blueprint: crystalWastelandBlueprint },
  { id: 'lava-snow-pool', name: 'Lava Snow Pool', blueprint: lavaSnowPoolBlueprint },
  { id: 'heat-wave-highway', name: 'Heat Wave Highway', blueprint: heatWaveHighwayBlueprint },
  { id: 'lost-temple', name: 'Lost Temple', blueprint: lostTempleBlueprint },
  { id: 'twin-peaks', name: 'Twin Peaks', blueprint: twinPeaksBlueprint },
];

export const DEFAULT_MAP_ID = 'red-canyon';

/** Resolve a map id to its blueprint; falls back to red-canyon for unknown ids. */
export function getMapBlueprint(id: string | null | undefined): { id: string; blueprint: MapBlueprint } {
  const entry = MAP_REGISTRY.find((m) => m.id === id) ?? MAP_REGISTRY[0];
  return { id: entry.id, blueprint: entry.blueprint };
}

/** The list of available map ids (for a menu / verify hook). */
export function mapIds(): string[] {
  return MAP_REGISTRY.map((m) => m.id);
}
