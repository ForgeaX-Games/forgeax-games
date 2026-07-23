// PR2a T5 — Hero Shot seam restore guard + world-policy predicate.

import { describe, expect, test } from 'bun:test';
import { FINISHER_HERO_SHOT_ID } from './cutscene';
import {
  createSeamRestoreGuard,
  isFinisherHeroShotActive,
} from './hero-shot-seam';

describe('createSeamRestoreGuard', () => {
  test('restoreOnce runs the restore callback exactly once across complete/skip/error/stop', () => {
    let restores = 0;
    const guard = createSeamRestoreGuard(() => {
      restores += 1;
    });
    expect(guard.done).toBe(false);

    expect(guard.restoreOnce('complete')).toBe(true);
    expect(restores).toBe(1);
    expect(guard.done).toBe(true);
    expect(guard.reason).toBe('complete');

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
  });
});

describe('isFinisherHeroShotActive', () => {
  test('true only for the finisher hero-shot script id while a cutscene is present', () => {
    expect(isFinisherHeroShotActive(null)).toBe(false);
    expect(isFinisherHeroShotActive({ id: 'camp-intro' })).toBe(false);
    expect(isFinisherHeroShotActive({ id: FINISHER_HERO_SHOT_ID })).toBe(true);
  });
});
