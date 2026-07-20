/**
 * MarsCraft -> forgeax-engine — adaptive turn rate (Milestone M15 chunk 1)
 * =============================================================================
 * Port of the Three.js source `shared/sync/AdaptiveTurnRate.ts`. Dynamically
 * recommends a lockstep turn duration from the players' RTT samples: P75 per
 * player (smooths jitter), then the WORST player's P75 drives the choice (a
 * lockstep sim runs at the pace of its slowest link).
 *
 * The turn-rate config the source pulled from `shared/config.ts` is INLINED here
 * (verbatim values) — the studio port has no shared netcode config, and these are
 * the SSOT for the lockstep timing in chunk 1. TurnSync + AdaptiveTurnRate both
 * consume them from this one module.
 */

// ── Turn-sync timing config (inlined verbatim from source shared/config.ts) ────

/** Base turn period (ms). Shorter = snappier commands, more network chatter. */
export const TURN_DURATION_MS = 50;
/** Input delay (turns). 0 = no extra delay (local/LAN); 2-3 for high-latency net. */
export const INPUT_DELAY_TURNS = 0;
/** Logic ticks per turn (TURN_DURATION_MS / 16.67ms ~= 3). */
export const TICKS_PER_TURN = 3;

export interface TurnRatePreset {
  durationMs: number;
  ticksPerTurn: number;
  label: string;
}

export const TURN_RATE_PRESETS: TurnRatePreset[] = [
  { durationMs: 50, ticksPerTurn: 3, label: 'normal' },
  { durationMs: 66, ticksPerTurn: 4, label: 'slow' },
  { durationMs: 100, ticksPerTurn: 6, label: 'very_slow' },
];

/** RTT (ms) thresholds -> recommended preset. */
export const RTT_THRESHOLDS = {
  NORMAL: 80, // RTT < 80  -> 50ms turn
  SLOW: 150, // RTT < 150 -> 66ms turn; RTT >= 150 -> 100ms turn
};

// ── Adaptive controller ────────────────────────────────────────────────────

const MAX_SAMPLES = 20;
const MIN_SAMPLES = 5;

export class AdaptiveTurnRate {
  private _samples = new Map<string, number[]>();
  private _currentPreset: TurnRatePreset = {
    durationMs: TURN_DURATION_MS,
    ticksPerTurn: TICKS_PER_TURN,
    label: 'normal',
  };

  get currentDurationMs(): number { return this._currentPreset.durationMs; }
  get currentTicksPerTurn(): number { return this._currentPreset.ticksPerTurn; }
  get currentLabel(): string { return this._currentPreset.label; }

  addRttSample(playerId: string, rtt: number): void {
    let arr = this._samples.get(playerId);
    if (!arr) {
      arr = [];
      this._samples.set(playerId, arr);
    }
    arr.push(rtt);
    if (arr.length > MAX_SAMPLES) arr.shift();
  }

  /**
   * Evaluate whether the turn period should change.
   * @returns the new preset (if changed), or null (no change needed).
   */
  evaluate(): TurnRatePreset | null {
    const worstP75 = this._getWorstP75();
    if (worstP75 < 0) return null;

    const recommended = this._rttToPreset(worstP75);
    if (recommended.durationMs === this._currentPreset.durationMs) return null;

    this._currentPreset = recommended;
    return recommended;
  }

  /** Force-set the current preset (e.g. on a server turn_rate_change). */
  setPreset(durationMs: number, ticksPerTurn: number): void {
    const match = TURN_RATE_PRESETS.find((p) => p.durationMs === durationMs);
    this._currentPreset = match ?? { durationMs, ticksPerTurn, label: 'custom' };
  }

  private _getWorstP75(): number {
    let worst = -1;
    for (const [, samples] of this._samples) {
      if (samples.length < MIN_SAMPLES) return -1;
      const sorted = [...samples].sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      if (p75 > worst) worst = p75;
    }
    return worst;
  }

  private _rttToPreset(rtt: number): TurnRatePreset {
    if (rtt < RTT_THRESHOLDS.NORMAL) return TURN_RATE_PRESETS[0]; // 50ms
    if (rtt < RTT_THRESHOLDS.SLOW) return TURN_RATE_PRESETS[1]; // 66ms
    return TURN_RATE_PRESETS[2]; // 100ms
  }
}
