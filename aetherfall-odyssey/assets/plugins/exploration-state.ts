/**
 * Pure progression model for Aetherfall's exploration loop.
 *
 * The state intentionally contains JSON values only: it can be handed to a
 * projection, persisted by a host, or restored into a fresh Play World without
 * retaining entity handles or mutable collections from a previous run.
 */
export const MEMORY_TEMPLE_IDS = [
  'memory-temple-1',
  'memory-temple-2',
  'memory-temple-3',
] as const;

export type MemoryTempleId = (typeof MEMORY_TEMPLE_IDS)[number];
export type ExplorationTargetId = MemoryTempleId | 'last-light-beacon' | 'sanctuary';
export type ExplorationPhase = 'exploring' | 'beacon-unlocked' | 'returning' | 'complete';
export type ExplorationWorldStage =
  | 'seeking-memories'
  | 'beacon-ready'
  | 'beacon-attuned'
  | 'sanctuary-returned';
export type ExplorationOutcome =
  | 'temple-activated'
  | 'temple-already-activated'
  | 'beacon-attuned'
  | 'beacon-locked'
  | 'beacon-already-attuned'
  | 'sanctuary-returned'
  | 'sanctuary-locked'
  | 'sanctuary-already-returned'
  | 'out-of-range'
  | 'invalid-distance'
  | 'invalid-target';

export interface ExplorationSnapshot {
  readonly version: 1;
  readonly phase: ExplorationPhase;
  readonly activatedTempleIds: readonly MemoryTempleId[];
  readonly beaconUnlocked: boolean;
  readonly beaconAttuned: boolean;
  readonly returnedToSanctuary: boolean;
  readonly interactionCount: number;
}

export interface ExplorationInteraction {
  readonly targetId: string;
  readonly distance: number;
  readonly interactionRadius: number;
}

export interface ExplorationTransition {
  readonly accepted: boolean;
  readonly outcome: ExplorationOutcome;
  readonly snapshot: ExplorationSnapshot;
}

const INITIAL_SNAPSHOT: ExplorationSnapshot = {
  version: 1,
  phase: 'exploring',
  activatedTempleIds: [],
  beaconUnlocked: false,
  beaconAttuned: false,
  returnedToSanctuary: false,
  interactionCount: 0,
};

function copySnapshot(snapshot: ExplorationSnapshot): ExplorationSnapshot {
  return {
    ...snapshot,
    activatedTempleIds: [...snapshot.activatedTempleIds],
  };
}

function isTempleId(value: string): value is MemoryTempleId {
  return (MEMORY_TEMPLE_IDS as readonly string[]).includes(value);
}

function isValidDistance(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function result(
  state: ExplorationSnapshot,
  outcome: ExplorationOutcome,
  accepted: boolean,
): ExplorationTransition {
  return { accepted, outcome, snapshot: copySnapshot(state) };
}

function progressed(
  state: ExplorationSnapshot,
  patch: Omit<Partial<ExplorationSnapshot>, 'version' | 'activatedTempleIds'> & {
    activatedTempleIds?: readonly MemoryTempleId[];
  },
): ExplorationSnapshot {
  return {
    ...state,
    ...patch,
    activatedTempleIds: patch.activatedTempleIds === undefined
      ? [...state.activatedTempleIds]
      : [...patch.activatedTempleIds],
    interactionCount: state.interactionCount + 1,
  };
}

/** Create a fresh, detached run state. */
export function createExplorationState(): ExplorationSnapshot {
  return copySnapshot(INITIAL_SNAPSHOT);
}

/** Reset is intentionally data-only so the lifecycle owner can reuse it. */
export function resetExplorationState(): ExplorationSnapshot {
  return createExplorationState();
}

/** Return a detached, JSON-safe view suitable for a game projection. */
export function snapshotExplorationState(state: ExplorationSnapshot): ExplorationSnapshot {
  return copySnapshot(state);
}

/** Derive the stable world-feedback stage without introducing render state. */
export function explorationWorldStage(
  state: ExplorationSnapshot,
): ExplorationWorldStage {
  if (state.returnedToSanctuary || state.phase === 'complete') {
    return 'sanctuary-returned';
  }
  if (state.beaconAttuned || state.phase === 'returning') {
    return 'beacon-attuned';
  }
  if (state.beaconUnlocked || state.phase === 'beacon-unlocked') {
    return 'beacon-ready';
  }
  return 'seeking-memories';
}

/** A convenience boundary for hosts that need an explicit serialized payload. */
export function serializeExplorationSnapshot(state: ExplorationSnapshot): string {
  return JSON.stringify(snapshotExplorationState(state));
}

/**
 * Apply one interaction against a known gameplay target. Invalid geometry and
 * progression violations do not alter the current snapshot.
 */
export function interactWithExploration(
  state: ExplorationSnapshot,
  interaction: ExplorationInteraction,
): ExplorationTransition {
  if (!isValidDistance(interaction.distance) || !isValidDistance(interaction.interactionRadius)) {
    return result(state, 'invalid-distance', false);
  }
  if (interaction.distance > interaction.interactionRadius) return result(state, 'out-of-range', false);

  if (isTempleId(interaction.targetId)) {
    if (state.activatedTempleIds.includes(interaction.targetId)) {
      return result(state, 'temple-already-activated', false);
    }
    const activatedTempleIds = [...state.activatedTempleIds, interaction.targetId];
    const beaconUnlocked = activatedTempleIds.length === MEMORY_TEMPLE_IDS.length;
    return result(progressed(state, {
      activatedTempleIds,
      beaconUnlocked,
      phase: beaconUnlocked ? 'beacon-unlocked' : 'exploring',
    }), 'temple-activated', true);
  }

  if (interaction.targetId === 'last-light-beacon') {
    if (!state.beaconUnlocked) return result(state, 'beacon-locked', false);
    if (state.beaconAttuned) return result(state, 'beacon-already-attuned', false);
    return result(progressed(state, {
      beaconAttuned: true,
      phase: 'returning',
    }), 'beacon-attuned', true);
  }

  if (interaction.targetId === 'sanctuary') {
    if (!state.beaconAttuned) return result(state, 'sanctuary-locked', false);
    if (state.returnedToSanctuary) return result(state, 'sanctuary-already-returned', false);
    return result(progressed(state, {
      returnedToSanctuary: true,
      phase: 'complete',
    }), 'sanctuary-returned', true);
  }

  return result(state, 'invalid-target', false);
}
