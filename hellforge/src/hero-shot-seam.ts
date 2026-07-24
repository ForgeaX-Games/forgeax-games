// PR2a T5 / PR4a T1–T4 — Hero Shot seam helpers (pure).
// Exactly-once restore is a thin facade over CinematicOwner. World freeze /
// invuln read only from owner.policy (L1 via policyForBeat at acquire).
// Audio duck rides the optional `audio` channel (PR4a T4 / L2).
// `isFinisherHeroShotActive` is a cutscene-id helper — not a freeze gate writer.

import {
  CinematicOwner,
  type CinematicChannelHandlers,
  type WorldPolicy,
} from './cinematic-owner';
import { policyForBeat } from './cinematic-policy';
import { FINISHER_HERO_SHOT_ID } from './cutscene';

export type SeamRestoreReason = 'complete' | 'skip' | 'error' | 'stop';

export type SeamAcquireExtras = {
  /** PR4a T4 — BGM duck channel (acquire ducks, release unducks). */
  audio?: CinematicChannelHandlers;
};

export type SeamRestoreGuard = {
  /** Run restore exactly once. Returns true iff this call performed restore. */
  restoreOnce(reason: SeamRestoreReason): boolean;
  /** Whether restore has already run. */
  readonly done: boolean;
  /** Reason of the first successful restore, or null if not yet restored. */
  readonly reason: SeamRestoreReason | null;
  /** Active beat id while the seam owns the world channel; null after release. */
  readonly beatId: string | null;
  /** Active L1 world policy while owned; null after release (owner is SSOT). */
  readonly policy: WorldPolicy | null;
};

/**
 * Exactly-once restore covering complete / skip / error / Stop.
 * Facade over CinematicOwner: world channel release is `restore`; optional
 * audio channel ducks BGM for the beat lifetime (L2).
 * Defaults to finisher Hero Shot den policy when beatId is omitted.
 */
export function createSeamRestoreGuard(
  restore: () => void,
  beatId: string = FINISHER_HERO_SHOT_ID,
  extras: SeamAcquireExtras = {},
): SeamRestoreGuard {
  const owner = new CinematicOwner();
  owner.acquire({
    beatId,
    policy: policyForBeat(beatId),
    channels: {
      // world + optional audio — release walks reverse acquire order.
      world: { acquire: () => {}, release: restore },
      ...(extras.audio ? { audio: extras.audio } : {}),
    },
  });

  let reason: SeamRestoreReason | null = null;
  return {
    get done() {
      return !owner.active;
    },
    get reason() {
      return reason;
    },
    get beatId() {
      return owner.beatId;
    },
    get policy() {
      return owner.policy;
    },
    restoreOnce(nextReason) {
      if (!owner.active) return false;
      reason = nextReason;
      return owner.release();
    },
  };
}

/** Cutscene-id helper only — freeze/invuln gates must read owner.policy. */
export function isFinisherHeroShotActive(
  cutscene: { readonly id: string } | null | undefined,
): boolean {
  return !!cutscene && cutscene.id === FINISHER_HERO_SHOT_ID;
}
