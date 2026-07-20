/**
 * MarsCraft -> forgeax-engine — stall handler (Milestone M15 chunk 1)
 * =============================================================================
 * Port of the Three.js source `web/network/StallHandler.ts` (VERBATIM logic).
 *
 * When a turn's commands are missing (a lockstep sim can NOT advance past a turn
 * until every player's commands for it have arrived), this grades the stall and
 * yields a `speedScale` (0..1) + a `bufferHealth` label so the driver can slow /
 * pause the sim smoothly instead of freezing hard:
 *   - healthy: buffer >= 1, full speed
 *   - low:     stalled 200ms..1s,  mild slowdown (0.5x)
 *   - empty:   stalled 1s..3s,     heavy slowdown (0.25x)
 *   - stalled: stalled 3s..10s,    pause (0x) + waiting overlay
 *   - disconnected: stalled > 10s, disconnect countdown
 *
 * In the LOCAL demo (chunk 1) every turn's commands are always present, so the
 * handler stays 'healthy'; it is ported intact for chunk 2 (real WS transport).
 */

export type BufferHealth = 'healthy' | 'low' | 'empty' | 'stalled' | 'disconnected';

export class StallHandler {
  // Public state
  speedScale: number = 1.0; // current execution speed (0..1), smoothly interpolated
  bufferHealth: BufferHealth = 'healthy';
  disconnectCountdown: number = 0; // seconds until disconnect timeout (0 = not counting)
  stallDurationMs: number = 0; // how long we've been stalled

  // Private
  private _targetSpeed: number = 1.0;
  private _stallStartMs: number = 0;
  private _isStalled: boolean = false;

  // Config constants
  static readonly DISCONNECT_TIMEOUT_MS = 60_000; // 60s total before auto-disconnect
  static readonly GRACE_MS = 200; // stall < 200ms = normal jitter, no speed change
  static readonly SLOW_MS = 1_000; // 200ms..1s: mild slowdown
  static readonly STALL_WARN_MS = 3_000; // 1s..3s: severe slowdown
  static readonly STALL_DISCONNECT_MS = 10_000; // 3s..10s: pause + waiting overlay
  static readonly SPEED_LERP = 0.15; // smoothing factor per frame

  /**
   * Called every frame. Reads the stalled/buffered state and updates speedScale.
   * @param stalled  whether the turn driver is waiting for a turn
   * @param buffered number of buffered ready turns
   * @param nowMs    current performance.now()
   */
  update(stalled: boolean, buffered: number, nowMs: number): void {
    if (stalled) {
      if (!this._isStalled) {
        this._stallStartMs = nowMs;
        this._isStalled = true;
      }
      this.stallDurationMs = nowMs - this._stallStartMs;

      if (this.stallDurationMs < StallHandler.GRACE_MS) {
        this._targetSpeed = 1.0;
        this.bufferHealth = 'healthy';
        this.disconnectCountdown = 0;
      } else if (this.stallDurationMs < StallHandler.SLOW_MS) {
        this._targetSpeed = 0.5;
        this.bufferHealth = 'low';
        this.disconnectCountdown = 0;
      } else if (this.stallDurationMs < StallHandler.STALL_WARN_MS) {
        this._targetSpeed = 0.25;
        this.bufferHealth = 'empty';
        this.disconnectCountdown = 0;
      } else if (this.stallDurationMs < StallHandler.STALL_DISCONNECT_MS) {
        this._targetSpeed = 0.0;
        this.bufferHealth = 'stalled';
        this.disconnectCountdown = 0;
      } else {
        this._targetSpeed = 0.0;
        this.bufferHealth = 'disconnected';
        this.disconnectCountdown = Math.max(
          0,
          Math.ceil((StallHandler.DISCONNECT_TIMEOUT_MS - this.stallDurationMs) / 1000),
        );
      }
    } else {
      if (this._isStalled) {
        // Stall just ended: snap speed back to 1.0 immediately (no slow lerp).
        this.speedScale = 1.0;
      }
      this._isStalled = false;
      this.stallDurationMs = 0;
      this.disconnectCountdown = 0;
      this.bufferHealth = 'healthy';
      this._targetSpeed = 1.0;
    }

    // buffered is currently informational (kept for signature parity + future
    // buffer-based grading); referenced to keep the intent explicit.
    void buffered;

    // Smooth interpolation (only matters for sustained stalls, not brief jitter).
    this.speedScale += (this._targetSpeed - this.speedScale) * StallHandler.SPEED_LERP;
    if (this.speedScale < 0.01) this.speedScale = 0;
    if (this.speedScale > 0.99) this.speedScale = 1.0;
  }

  /** Whether the disconnect timeout has been reached. */
  get isDisconnectTimeout(): boolean {
    return (
      this.bufferHealth === 'disconnected' &&
      this.disconnectCountdown <= 0 &&
      this.stallDurationMs >= StallHandler.DISCONNECT_TIMEOUT_MS
    );
  }

  /** Reset the stall timer (e.g. after returning from background). */
  resetStallTimer(): void {
    this._isStalled = false;
    this.stallDurationMs = 0;
    this.disconnectCountdown = 0;
    this.bufferHealth = 'healthy';
    this.speedScale = 1.0;
    this._targetSpeed = 1.0;
  }
}
