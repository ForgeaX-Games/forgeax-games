import { SPAWN, type SpawnPattern } from '../config/spawn.ts';
import { createRng } from './rng.ts';

export const DIRECTOR_STATE_KEY = 'BrotatoV2SpawnDirector';
export const DEFAULT_SPAWN_SEED = 0xdecafbad;

export interface SpawnBatch {
  readonly enemy: 'sprouted-potato';
  readonly count: number;
  readonly pattern: SpawnPattern;
  readonly intraStaggerSec: number;
}

export interface DirectorState {
  elapsed: number;
  nextBatchAt: number;
  batchSeq: number;
  rngState: number;
  frozen: boolean;
  skipped: number;
  relax1: number;
  relax2: number;
  relax3: number;
  fallback: number;
}

interface SpawnTier {
  readonly untilSec: number;
  readonly intervalSec: number;
  readonly countMin: number;
  readonly countMax: number;
  readonly patterns: readonly SpawnPattern[];
  readonly rampEverySec?: number;
  readonly rampFactor?: number;
  readonly intervalFloorSec?: number;
}

export function createDirectorState(seed = DEFAULT_SPAWN_SEED): DirectorState {
  return {
    elapsed: 0,
    nextBatchAt: SPAWN.batch.firstAtSec,
    batchSeq: 0,
    rngState: seed >>> 0,
    frozen: false,
    skipped: 0,
    relax1: 0,
    relax2: 0,
    relax3: 0,
    fallback: 0,
  };
}

export function resetDirector(state: DirectorState, seed = DEFAULT_SPAWN_SEED): void {
  const next = createDirectorState(seed);
  state.elapsed = next.elapsed;
  state.nextBatchAt = next.nextBatchAt;
  state.batchSeq = next.batchSeq;
  state.rngState = next.rngState;
  state.frozen = next.frozen;
  state.skipped = next.skipped;
  state.relax1 = next.relax1;
  state.relax2 = next.relax2;
  state.relax3 = next.relax3;
  state.fallback = next.fallback;
}

export function tierAt(elapsed: number): number {
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  for (let index = 0; index < SPAWN.tiers.length; index += 1) {
    if (safeElapsed < (SPAWN.tiers[index]?.untilSec ?? Number.POSITIVE_INFINITY)) return index;
  }
  return SPAWN.tiers.length - 1;
}

export function tierIntervalAt(elapsed: number): number {
  const tierIndex = tierAt(elapsed);
  const tier = (SPAWN.tiers[tierIndex] ?? SPAWN.tiers[SPAWN.tiers.length - 1]) as SpawnTier;
  if (tier.rampEverySec === undefined || tier.rampFactor === undefined || tier.intervalFloorSec === undefined) {
    return tier.intervalSec;
  }
  const ramp = Math.max(0, Math.floor(Math.max(0, elapsed - 38) / tier.rampEverySec));
  return Math.max(tier.intervalFloorSec, tier.intervalSec * Math.pow(tier.rampFactor, ramp));
}

function nextBatch(state: DirectorState, batchAt: number): SpawnBatch {
  const tier = (SPAWN.tiers[tierAt(batchAt)] ?? SPAWN.tiers[SPAWN.tiers.length - 1]) as SpawnTier;
  const rng = createRng(state.rngState);
  const count = Math.min(SPAWN.batch.maxPerBatch, rng.nextInt(tier.countMin, tier.countMax));
  state.rngState = rng.state;
  const patterns = tier.patterns as readonly SpawnPattern[];
  const pattern = patterns[state.batchSeq % patterns.length] ?? 'scattered';
  return {
    enemy: 'sprouted-potato',
    count,
    pattern,
    intraStaggerSec: SPAWN.batch.intraStaggerSec,
  };
}

/** Advance the deterministic endless schedule; skipped batches are not queued. */
export function stepDirector(
  state: DirectorState,
  dt: number,
  live: number,
  pending: number,
): readonly SpawnBatch[] {
  if (state.frozen) return [];
  const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  state.elapsed += delta;
  const batches: SpawnBatch[] = [];
  while (state.elapsed + Number.EPSILON >= state.nextBatchAt) {
    const batchAt = state.nextBatchAt;
    const batch = nextBatch(state, batchAt);
    state.batchSeq += 1;
    // Keep the authored decimal schedule stable across thousands of fixed
    // steps; this also makes the debug timeline readable and reproducible.
    state.nextBatchAt = Number((batchAt + tierIntervalAt(batchAt)).toFixed(6));
    if (live + pending >= SPAWN.cap.onScreen) state.skipped += 1;
    else batches.push(batch);
    if (batches.length >= 8) break;
  }
  return batches;
}

export function secondsToNextBatch(state: DirectorState): number {
  return Math.max(0, state.nextBatchAt - state.elapsed);
}
