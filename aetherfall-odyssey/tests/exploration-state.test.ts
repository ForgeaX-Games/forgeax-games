import { describe, expect, it } from 'vitest';
import {
  MEMORY_TEMPLE_IDS,
  createExplorationState,
  explorationWorldStage,
  interactWithExploration,
  resetExplorationState,
  serializeExplorationSnapshot,
} from '../assets/plugins/exploration-state';

const NEAR = { distance: 1, interactionRadius: 1 } as const;

function interact(state: ReturnType<typeof createExplorationState>, targetId: string) {
  return interactWithExploration(state, { targetId, ...NEAR });
}

describe('Aetherfall exploration state', () => {
  it('derives stable world stages for the beacon climax and sanctuary finale', () => {
    const initial = createExplorationState();
    expect(explorationWorldStage(initial)).toBe('seeking-memories');
    expect(explorationWorldStage({
      ...initial,
      phase: 'beacon-unlocked',
      beaconUnlocked: true,
    })).toBe('beacon-ready');
    expect(explorationWorldStage({
      ...initial,
      phase: 'returning',
      beaconUnlocked: true,
      beaconAttuned: true,
    })).toBe('beacon-attuned');
    expect(explorationWorldStage({
      ...initial,
      phase: 'complete',
      beaconUnlocked: true,
      beaconAttuned: true,
      returnedToSanctuary: true,
    })).toBe('sanctuary-returned');
  });

  it('requires all three unique memory temples before the Last Light beacon can be attuned', () => {
    let state = createExplorationState();
    expect(interact(state, 'last-light-beacon')).toMatchObject({ accepted: false, outcome: 'beacon-locked' });

    for (const temple of MEMORY_TEMPLE_IDS) {
      const transition = interact(state, temple);
      expect(transition).toMatchObject({ accepted: true, outcome: 'temple-activated' });
      state = transition.snapshot;
    }

    expect(state).toMatchObject({
      phase: 'beacon-unlocked',
      activatedTempleIds: [...MEMORY_TEMPLE_IDS],
      beaconUnlocked: true,
      beaconAttuned: false,
    });
    const beacon = interact(state, 'last-light-beacon');
    expect(beacon).toMatchObject({ accepted: true, outcome: 'beacon-attuned', snapshot: { phase: 'returning' } });
  });

  it('deduplicates temple activation and requires the sanctuary return to finish', () => {
    const first = interact(createExplorationState(), MEMORY_TEMPLE_IDS[0]);
    const duplicate = interact(first.snapshot, MEMORY_TEMPLE_IDS[0]);
    expect(duplicate).toMatchObject({ accepted: false, outcome: 'temple-already-activated' });
    expect(duplicate.snapshot).toEqual(first.snapshot);
    expect(interact(first.snapshot, 'sanctuary')).toMatchObject({ accepted: false, outcome: 'sanctuary-locked' });
  });

  it('rejects invalid or out-of-range interactions without corrupting progress', () => {
    const state = createExplorationState();
    for (const interaction of [
      { targetId: MEMORY_TEMPLE_IDS[0], distance: 1.01, interactionRadius: 1 },
      { targetId: MEMORY_TEMPLE_IDS[0], distance: Number.NaN, interactionRadius: 1 },
      { targetId: 'unknown-ruin', ...NEAR },
    ]) {
      const transition = interactWithExploration(state, interaction);
      expect(transition.accepted).toBe(false);
      expect(transition.snapshot).toEqual(state);
    }
  });

  it('provides a detached JSON snapshot and a complete reset baseline', () => {
    const activated = interact(createExplorationState(), MEMORY_TEMPLE_IDS[0]).snapshot;
    const restored = JSON.parse(serializeExplorationSnapshot(activated));
    expect(restored).toEqual(activated);
    expect(resetExplorationState()).toEqual({
      version: 1,
      phase: 'exploring',
      activatedTempleIds: [],
      beaconUnlocked: false,
      beaconAttuned: false,
      returnedToSanctuary: false,
      interactionCount: 0,
    });
  });
});
