/**
 * M2 enemy deployment is deliberately data-driven. Keep all timing and
 * placement numbers here so the director can be tuned without changing ECS
 * glue or combat rules.
 */
export const SPAWN = {
  marker: {
    leadSec: 1.0,
    popInSec: 0.15,
    blinkStartHz: 2.0,
    blinkEndHz: 6.0,
    baseEmissive: 0.35,
    peakEmissive: 1.60,
    swellFrom: 0.85,
    swellScale: 0.15,
  },
  placement: {
    /** M2's playable deployment rectangle is the inner 26 x 26 area. */
    arenaHalfExtent: 14,
    minRadius: 7.5,
    maxRadius: 11.0,
    minRadiusRelaxed: 5.5,
    arenaInset: 1.0,
    viewInset: 1.2,
    markerSeparation: 1.6,
    enemySeparation: 1.2,
    apartSeparation: 4.0,
    groupRadius: 2.4,
    attemptsPerLevel: 8,
  },
  batch: {
    firstAtSec: 1.0,
    intraStaggerSec: 0.08,
    maxPerBatch: 6,
  },
  cap: { onScreen: 20 },
  birth: { popSec: 0.15, contactGraceSec: 0.5, spawnScale: 0.30 },
  death: {
    /** Keep the defeated model visible briefly, then remove its entity. */
    ttlSec: 0.20,
    flashSec: 0.06,
    popScale: 1.25,
    flattenScale: 0.05,
    spreadScale: 1.45,
    sinkY: 0.02,
  },
  tiers: [
    { untilSec: 8, intervalSec: 3.0, countMin: 1, countMax: 2, patterns: ['scattered'] },
    { untilSec: 20, intervalSec: 2.2, countMin: 2, countMax: 3, patterns: ['scattered', 'scattered', 'group'] },
    { untilSec: 38, intervalSec: 1.6, countMin: 3, countMax: 4, patterns: ['group', 'edge'] },
    {
      untilSec: Number.POSITIVE_INFINITY,
      intervalSec: 1.2,
      countMin: 4,
      countMax: 5,
      patterns: ['group', 'group', 'edge', 'scattered'],
      rampEverySec: 20,
      rampFactor: 0.85,
      intervalFloorSec: 0.6,
    },
  ],
} as const;

export type SpawnPattern = 'scattered' | 'group' | 'edge' | 'apart';
