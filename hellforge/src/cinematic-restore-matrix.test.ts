// PR4a T5 — Four-path restore matrix (scripted §5.2 spirit).
// Major beat id × (complete|skip|error|stop) → owner inactive + policy null.
// Browser footage / Esc·Stop matrix left for human gate.

import { describe, expect, test } from 'bun:test';
import {
  BEAT_BOSS_DEFEAT,
  BEAT_BOSS_ENTRANCE,
  BEAT_CAMP_ARRIVAL,
  BEAT_QUEST_ACCEPTANCE,
  shouldFreezeAi,
  shouldPlayerBeInvulnerable,
} from './cinematic-policy';
import {
  createSeamRestoreGuard,
  type SeamRestoreReason,
} from './hero-shot-seam';

/** Plan §5.2 — four authored narrative beats (16 combinations with exit paths). */
const MAJOR_BEAT_IDS = [
  BEAT_CAMP_ARRIVAL,
  BEAT_QUEST_ACCEPTANCE,
  BEAT_BOSS_ENTRANCE,
  BEAT_BOSS_DEFEAT,
] as const;

const RELEASE_REASONS: readonly SeamRestoreReason[] = [
  'complete',
  'skip',
  'error',
  'stop',
];

describe('PR4a T5 restore matrix (beat × release reason)', () => {
  for (const beatId of MAJOR_BEAT_IDS) {
    for (const reason of RELEASE_REASONS) {
      test(`${beatId} × ${reason}: inactive + policy null + audio unducked`, () => {
        let ducked = false;
        const guard = createSeamRestoreGuard(
          () => {},
          beatId,
          {
            audio: {
              acquire: () => { ducked = true; },
              release: () => { ducked = false; },
            },
          },
        );

        expect(guard.done).toBe(false);
        expect(guard.beatId).toBe(beatId);
        expect(guard.policy).not.toBe(null);
        expect(ducked).toBe(true);

        expect(guard.restoreOnce(reason)).toBe(true);
        expect(guard.done).toBe(true);
        expect(guard.reason).toBe(reason);
        expect(guard.beatId).toBe(null);
        expect(guard.policy).toBe(null);
        expect(ducked).toBe(false);
        expect(shouldFreezeAi(guard)).toBe(false);
        expect(shouldPlayerBeInvulnerable(guard)).toBe(false);

        // Idempotent — second release is a no-op (no strand / no re-duck).
        expect(guard.restoreOnce(reason)).toBe(false);
        expect(guard.beatId).toBe(null);
        expect(guard.policy).toBe(null);
        expect(ducked).toBe(false);
      });
    }
  }

  test('matrix covers 16 combinations (4 beats × 4 reasons)', () => {
    expect(MAJOR_BEAT_IDS.length * RELEASE_REASONS.length).toBe(16);
  });
});
