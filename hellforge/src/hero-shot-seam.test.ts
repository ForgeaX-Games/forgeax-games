// PR2a T5 / PR4a T2 — Hero Shot seam restore guard + world-policy ownership.

import { describe, expect, test } from 'bun:test';
import {
  BEAT_CAMP_ARRIVAL,
  shouldFreezeAi,
  shouldPlayerBeInvulnerable,
} from './cinematic-policy';
import { FINISHER_HERO_SHOT_ID } from './cutscene';
import {
  createSeamRestoreGuard,
  isFinisherHeroShotActive,
} from './hero-shot-seam';

const DEN_FLAGS = {
  freezeAi: true,
  playerInvulnerable: true,
  playerInputLocked: true,
} as const;

const CAMP_FLAGS = {
  freezeAi: false,
  playerInvulnerable: false,
  playerInputLocked: true,
} as const;

describe('createSeamRestoreGuard', () => {
  test('restoreOnce runs the restore callback exactly once across complete/skip/error/stop', () => {
    let restores = 0;
    const guard = createSeamRestoreGuard(() => {
      restores += 1;
    });
    expect(guard.done).toBe(false);
    // Default beat = finisher Hero Shot → den freeze/invuln (owner is SSOT).
    expect(guard.beatId).toBe(FINISHER_HERO_SHOT_ID);
    expect(guard.policy).toEqual(DEN_FLAGS);
    expect(shouldFreezeAi(guard)).toBe(true);
    expect(shouldPlayerBeInvulnerable(guard)).toBe(true);

    expect(guard.restoreOnce('complete')).toBe(true);
    expect(restores).toBe(1);
    expect(guard.done).toBe(true);
    expect(guard.reason).toBe('complete');
    expect(guard.beatId).toBe(null);
    expect(guard.policy).toBe(null);
    // Seam restore clears policy → freeze gate opens (no strand).
    expect(shouldFreezeAi(guard)).toBe(false);
    expect(shouldPlayerBeInvulnerable(guard)).toBe(false);
    expect(!shouldFreezeAi(guard)).toBe(true);

    // Skip / error / Stop after complete must not re-restore.
    expect(guard.restoreOnce('skip')).toBe(false);
    expect(guard.restoreOnce('error')).toBe(false);
    expect(guard.restoreOnce('stop')).toBe(false);
    expect(restores).toBe(1);
    expect(guard.reason).toBe('complete');
  });

  test('skip path restores once when it wins the race', () => {
    let restores = 0;
    const guard = createSeamRestoreGuard(() => {
      restores += 1;
    });
    expect(guard.restoreOnce('skip')).toBe(true);
    expect(guard.restoreOnce('complete')).toBe(false);
    expect(guard.restoreOnce('stop')).toBe(false);
    expect(restores).toBe(1);
    expect(guard.reason).toBe('skip');
    expect(shouldFreezeAi(guard)).toBe(false);
  });

  test('camp beat id acquires camp policy (no freeze / no invuln)', () => {
    const guard = createSeamRestoreGuard(() => {}, BEAT_CAMP_ARRIVAL);
    expect(guard.beatId).toBe(BEAT_CAMP_ARRIVAL);
    expect(guard.policy).toEqual(CAMP_FLAGS);
    expect(shouldFreezeAi(guard)).toBe(false);
    expect(shouldPlayerBeInvulnerable(guard)).toBe(false);
    expect(!shouldFreezeAi(guard)).toBe(true);
    expect(guard.restoreOnce('complete')).toBe(true);
    expect(guard.policy).toBe(null);
  });

  test('policy getter is owner SSOT — external mutation cannot disarm freeze', () => {
    const guard = createSeamRestoreGuard(() => {});
    const viewed = guard.policy!;
    viewed.freezeAi = false;
    viewed.playerInvulnerable = false;
    expect(shouldFreezeAi(guard)).toBe(true);
    expect(shouldPlayerBeInvulnerable(guard)).toBe(true);
    expect(guard.policy).toEqual(DEN_FLAGS);
    expect(guard.restoreOnce('complete')).toBe(true);
    expect(guard.policy).toBe(null);
    expect(shouldFreezeAi(guard)).toBe(false);
  });

  test('optional audio channel ducks on acquire and unducks on release', () => {
    const events: string[] = [];
    const guard = createSeamRestoreGuard(
      () => events.push('restore'),
      BEAT_CAMP_ARRIVAL,
      {
        audio: {
          acquire: () => events.push('duck'),
          release: () => events.push('unduck'),
        },
      },
    );
    expect(events).toEqual(['duck']);
    expect(guard.restoreOnce('skip')).toBe(true);
    // Release order: audio before world (reverse acquire).
    expect(events).toEqual(['duck', 'unduck', 'restore']);
    expect(guard.restoreOnce('stop')).toBe(false);
    expect(events).toEqual(['duck', 'unduck', 'restore']);
  });
});

describe('isFinisherHeroShotActive', () => {
  test('cutscene-id helper only — not a freeze gate writer', () => {
    expect(isFinisherHeroShotActive(null)).toBe(false);
    expect(isFinisherHeroShotActive({ id: 'camp-intro' })).toBe(false);
    expect(isFinisherHeroShotActive({ id: FINISHER_HERO_SHOT_ID })).toBe(true);
    // Id check alone must not imply freeze; gate reads owner.policy.
    expect(shouldFreezeAi(null)).toBe(false);
  });
});
