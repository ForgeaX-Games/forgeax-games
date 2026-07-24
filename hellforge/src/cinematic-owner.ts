// PR4a T1 — CinematicOwner: atomic acquire/release for real-time narrative beats.
// Acquire order (documented): input → camera → ui → world → audio.
// Release: reverse order, exactly-once, idempotent (complete/skip/error/Stop may all call).
// T2 world freeze/invuln lives in cinematic-policy.ts; T3 authors beats; T4 ducks BGM.

export type CinematicChannel =
  | 'input'
  | 'camera'
  | 'ui'
  | 'world' // policy holder; T2 fills freeze/invuln
  | 'audio'; // duck; T4 fills

/** Acquire / release channel order. Release walks this list in reverse. */
export const CINEMATIC_CHANNEL_ORDER: readonly CinematicChannel[] = [
  'input',
  'camera',
  'ui',
  'world',
  'audio',
] as const;

export type WorldPolicy = {
  freezeAi: boolean;
  playerInvulnerable: boolean;
  playerInputLocked: boolean;
};

export type CinematicChannelHandlers = {
  acquire: () => void;
  /** Must be idempotent — release may be invoked from multiple exit paths. */
  release: () => void;
};

export type CinematicAcquireArgs = {
  beatId: string;
  policy: WorldPolicy;
  /** Called in reverse channel order on release; each must be idempotent. */
  channels: {
    input?: CinematicChannelHandlers;
    camera?: CinematicChannelHandlers;
    ui?: CinematicChannelHandlers;
    world?: CinematicChannelHandlers;
    audio?: CinematicChannelHandlers;
  };
};

function releaseAcquired(
  channels: CinematicAcquireArgs['channels'],
  acquired: readonly CinematicChannel[],
): void {
  for (let i = acquired.length - 1; i >= 0; i--) {
    const ch = acquired[i]!;
    channels[ch]?.release();
  }
}

export class CinematicOwner {
  private _active = false;
  private _beatId: string | null = null;
  private _policy: WorldPolicy | null = null;
  private _channels: CinematicAcquireArgs['channels'] | null = null;
  /** Channels that were actually acquired (present in args), in acquire order. */
  private _acquired: CinematicChannel[] = [];

  get active(): boolean {
    return this._active;
  }

  get beatId(): string | null {
    return this._beatId;
  }

  get policy(): WorldPolicy | null {
    // Defensive copy — acquire/release are the only writers of gate flags.
    return this._policy ? { ...this._policy } : null;
  }

  /**
   * Take over channels in documented order: input → camera → ui → world → audio.
   * Rejects if already active. On mid-acquire throw, already-acquired channels
   * are released in reverse order and the owner stays inactive.
   */
  acquire(args: CinematicAcquireArgs): void {
    if (this._active) {
      throw new Error(
        `CinematicOwner: already active (beatId=${this._beatId ?? 'unknown'}); refuse double-acquire`,
      );
    }

    const acquired: CinematicChannel[] = [];
    try {
      for (const ch of CINEMATIC_CHANNEL_ORDER) {
        const handlers = args.channels[ch];
        if (!handlers) continue;
        // Claim before acquire so a throw after side effects (e.g. BGM duck)
        // still unwinds this channel. release() is required to be idempotent.
        acquired.push(ch);
        handlers.acquire();
      }
    } catch (err) {
      // Best-effort reverse unwind; never leave half-owned external state.
      try {
        releaseAcquired(args.channels, acquired);
      } catch {
        // Prefer the original acquire failure; cleanup errors are secondary.
      }
      throw err;
    }

    // Snapshot so callers cannot alias-mutate owner state after acquire.
    const channelSnapshot: CinematicAcquireArgs['channels'] = {};
    for (const ch of acquired) {
      channelSnapshot[ch] = args.channels[ch];
    }

    this._beatId = args.beatId;
    this._policy = { ...args.policy };
    this._channels = channelSnapshot;
    this._acquired = acquired;
    this._active = true;
  }

  /**
   * Exactly-once release in reverse acquire order. Idempotent.
   * @returns true iff this call performed the release.
   */
  release(): boolean {
    if (!this._active) return false;

    // Flip first so re-entrant / concurrent release paths are no-ops.
    this._active = false;
    const channels = this._channels;
    const acquired = this._acquired;
    this._channels = null;
    this._acquired = [];
    this._beatId = null;
    this._policy = null;

    if (channels) releaseAcquired(channels, acquired);
    return true;
  }
}
