// PR4a T3 — Once-fire helpers for boss narrative beats.
// Pure: main.ts owns playback; these decide play vs consume-without-play.

export type BossBeatTriggerDecision = {
  /** Latch after first opportunity (play or skip). */
  readonly played: boolean;
  /** True iff caller should start the beat now. */
  readonly shouldPlay: boolean;
};

/**
 * Boss entrance — once per Play session when the player first enters threat range.
 * If finisher Hero Shot / face CU already owns the stage, consume the trigger
 * without playing so entrance is never stranded after the climax queue.
 */
export function takeBossEntranceTrigger(args: {
  readonly alreadyPlayed: boolean;
  readonly finisherClimaxBusy: boolean;
}): BossBeatTriggerDecision {
  if (args.alreadyPlayed) return { played: true, shouldPlay: false };
  if (args.finisherClimaxBusy) return { played: true, shouldPlay: false };
  return { played: true, shouldPlay: true };
}

/**
 * Boss defeat sting — once on domain death.
 * When finisher climax owns the stage, consume without playing (face CU is the
 * climax); do not defer defeat behind the CU queue.
 */
export function takeBossDefeatTrigger(args: {
  readonly alreadyPlayed: boolean;
  readonly finisherClimaxBusy: boolean;
}): BossBeatTriggerDecision {
  if (args.alreadyPlayed) return { played: true, shouldPlay: false };
  if (args.finisherClimaxBusy) return { played: true, shouldPlay: false };
  return { played: true, shouldPlay: true };
}
