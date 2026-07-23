// PR2a T5 — minimal Hero Shot seam helpers (pure).
// Takeover/restore ownership lives in main.ts (rig + uiLayers + input funnel);
// this module owns the exactly-once restore guard and the world-policy predicate
// so sol can review seam contracts without reading all of main.

import { FINISHER_HERO_SHOT_ID } from './cutscene';

export type SeamRestoreReason = 'complete' | 'skip' | 'error' | 'stop';

export type SeamRestoreGuard = {
  /** Run restore exactly once. Returns true iff this call performed restore. */
  restoreOnce(reason: SeamRestoreReason): boolean;
  /** Whether restore has already run. */
  readonly done: boolean;
  /** Reason of the first successful restore, or null if not yet restored. */
  readonly reason: SeamRestoreReason | null;
};

/** Exactly-once restore covering complete / skip / error / Stop. */
export function createSeamRestoreGuard(restore: () => void): SeamRestoreGuard {
  let done = false;
  let reason: SeamRestoreReason | null = null;
  return {
    get done() {
      return done;
    },
    get reason() {
      return reason;
    },
    restoreOnce(nextReason) {
      if (done) return false;
      done = true;
      reason = nextReason;
      restore();
      return true;
    },
  };
}

/** World policy (monster freeze + player invuln) applies only to Hero Shot. */
export function isFinisherHeroShotActive(
  cutscene: { readonly id: string } | null | undefined,
): boolean {
  return !!cutscene && cutscene.id === FINISHER_HERO_SHOT_ID;
}
