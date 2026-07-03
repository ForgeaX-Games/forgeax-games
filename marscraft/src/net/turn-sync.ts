/**
 * MarsCraft -> forgeax-engine — transport-agnostic lockstep driver (M15 chunk 1)
 * =============================================================================
 * Port of the Three.js source `web/network/TurnSync.ts` LOGIC, decoupled from the
 * WebSocket transport (`RTSClient`). This is the deterministic LOCKSTEP CORE:
 *
 *   - Per turn T, each player submits their command batch (`submitTurn`).
 *   - The sim only executes turn T once EVERY player has submitted for T
 *     (`canAdvance`) — otherwise it STALLS (never speculatively advances). This
 *     is the invariant that guarantees all peers apply the identical command
 *     stream in the identical order, which (with the single seeded RNG) yields
 *     bit-identical state.
 *   - `step()` executes the current turn: it merges all players' commands in a
 *     STABLE order (players sorted by id, preserving each player's submit order),
 *     applies each via the injected `applyCommand`, advances the turn counter, and
 *     — every `CHECKSUM_INTERVAL_TURNS` turns — computes the world checksum for
 *     desync detection.
 *
 * ── Faithful pieces carried over from the source ─────────────────────────────
 *   - Input-delay prelude: `INPUT_DELAY_TURNS` empty turns are auto-submitted for
 *     every player at start, building a jitter buffer (source's pre-sent empties).
 *   - StallHandler grades missing-turn stalls into a speedScale.
 *   - AdaptiveTurnRate recommends the turn duration from RTT samples.
 *
 * ── chunk-2 seam (WS transport) ──────────────────────────────────────────────
 * The source's send-side (`startFlushing` / command-ahead redundancy / the
 * WS `sendTurnCommands` calls) belongs to the network transport. In chunk 1 the
 * driver is fed locally (the demo submits both the human's and the AI's turn
 * batches directly). Chunk 2 replaces the local feeder with an RTSClient that
 * calls `submitTurn` on `turn_ready` and drives `step()` — the driver contract is
 * unchanged. See ./chunk2-seam.ts.
 */

import { StallHandler } from './stall-handler';
import { AdaptiveTurnRate, INPUT_DELAY_TURNS, TURN_DURATION_MS, TICKS_PER_TURN } from './adaptive-turn-rate';
import { CHECKSUM_INTERVAL_TURNS, type ChecksumResult } from './checksum';
import type { UnitCommand } from '../components';

/** A single command tagged with the player who issued it. */
export interface PlayerCommand {
  /** The unit/entity the command targets (raw entity id). */
  entity: number;
  /** The command payload (move/attack_move/stop/...). */
  command: UnitCommand;
}

/** Applies one player's command batch for a turn to the world. Injected. */
export type ApplyCommandFn = (playerId: number, cmds: PlayerCommand[]) => void;

/** Computes the deterministic world checksum on demand. Injected. */
export type ComputeChecksumFn = () => ChecksumResult;

export interface TurnSyncOptions {
  /** All player ids participating (order-independent; the driver sorts them). */
  players: number[];
  /** Applies a player's turn batch to the world. */
  applyCommand: ApplyCommandFn;
  /** Computes the world checksum (folded in every CHECKSUM_INTERVAL_TURNS turns). */
  computeChecksum: ComputeChecksumFn;
  /**
   * Skip the local input-delay prelude (the constructor's auto-submit of empty
   * turns for every player). The LOCAL demo wants it (single-process feeder). The
   * NETWORKED client (chunk 2 `RtsClient`) sets this true: there, the SERVER owns
   * the input-delay buffer + broadcasts each turn's full command set, so the client
   * must only submit what the server sends (auto-empties would let it step ahead).
   */
  skipInputDelayPrelude?: boolean;
}

/** Result of a successful `step()`. */
export interface TurnStepResult {
  turn: number;
  /** Total commands applied across all players this turn. */
  commandCount: number;
  /** Non-null on checksum turns (every CHECKSUM_INTERVAL_TURNS turns). */
  checksum: ChecksumResult | null;
}

export class TurnSync {
  private readonly _players: number[];
  private readonly _applyCommand: ApplyCommandFn;
  private readonly _computeChecksum: ComputeChecksumFn;

  /** The turn the sim is currently waiting to execute. */
  private _executingTurn = 0;
  /** turn -> (playerId -> command batch). A turn is ready when all players present. */
  private _submitted = new Map<number, Map<number, PlayerCommand[]>>();
  private _stalled = false;

  /** Recorded checksums by turn (append-only history for desync inspection). */
  private _checksums = new Map<number, ChecksumResult>();
  private _lastChecksum: ChecksumResult | null = null;

  readonly stallHandler = new StallHandler();
  readonly adaptiveTurnRate = new AdaptiveTurnRate();

  private _turnDurationMs = TURN_DURATION_MS;
  private _ticksPerTurn = TICKS_PER_TURN;

  constructor(opts: TurnSyncOptions) {
    // Freeze a sorted copy so player order is deterministic everywhere.
    this._players = [...opts.players].sort((a, b) => a - b);
    this._applyCommand = opts.applyCommand;
    this._computeChecksum = opts.computeChecksum;

    // Input-delay prelude: auto-submit empty turns for every player so the sim
    // has a jitter buffer before real commands arrive (source pre-sent empties).
    // Skipped for the networked client — the server owns the buffer + broadcasts.
    if (!opts.skipInputDelayPrelude) {
      for (let t = 0; t < INPUT_DELAY_TURNS; t++) {
        for (const p of this._players) this.submitTurn(p, t, []);
      }
    }
  }

  // ── introspection ──────────────────────────────────────────────────────────

  get currentTurn(): number { return this._executingTurn; }
  get stalled(): boolean { return this._stalled; }
  get turnDurationMs(): number { return this._turnDurationMs; }
  get ticksPerTurn(): number { return this._ticksPerTurn; }
  get lastChecksum(): ChecksumResult | null { return this._lastChecksum; }

  /** How many consecutive future turns (from the current one) are fully ready. */
  get bufferedTurns(): number {
    let count = 0;
    for (let t = this._executingTurn; t < this._executingTurn + 32; t++) {
      if (this._turnComplete(t)) count++;
      else break;
    }
    return count;
  }

  /** The recorded checksum for a specific turn (or null). */
  getChecksumAt(turn: number): ChecksumResult | null {
    return this._checksums.get(turn) ?? null;
  }

  // ── submit ───────────────────────────────────────────────────────────────

  /**
   * Submit a player's command batch for a turn. Idempotent per (player, turn):
   * a resubmission overwrites (mirrors the source's command-ahead redundancy,
   * where the latest snapshot wins).
   */
  submitTurn(playerId: number, turn: number, cmds: PlayerCommand[]): void {
    if (turn < this._executingTurn) return; // already executed; ignore late arrival
    let byPlayer = this._submitted.get(turn);
    if (!byPlayer) {
      byPlayer = new Map();
      this._submitted.set(turn, byPlayer);
    }
    byPlayer.set(playerId, cmds);
  }

  /** True once every player has submitted for `turn`. */
  private _turnComplete(turn: number): boolean {
    const byPlayer = this._submitted.get(turn);
    if (!byPlayer) return false;
    for (const p of this._players) {
      if (!byPlayer.has(p)) return false;
    }
    return true;
  }

  /** True if the sim may execute the current turn (all players submitted). */
  canAdvance(): boolean {
    return this._turnComplete(this._executingTurn);
  }

  // ── step ─────────────────────────────────────────────────────────────────

  /**
   * Execute the current turn if it is ready. Applies every player's commands in a
   * deterministic order, advances the turn counter, and computes the checksum on
   * checksum turns. Returns null (and marks stalled) if the turn isn't ready.
   */
  step(): TurnStepResult | null {
    if (!this._turnComplete(this._executingTurn)) {
      this._stalled = true;
      return null;
    }
    this._stalled = false;

    const turn = this._executingTurn;
    const byPlayer = this._submitted.get(turn)!;

    // Apply in sorted-player order (deterministic across peers). Within a player,
    // the submitted array order is preserved.
    let commandCount = 0;
    for (const p of this._players) {
      const cmds = byPlayer.get(p) ?? [];
      if (cmds.length > 0) {
        this._applyCommand(p, cmds);
        commandCount += cmds.length;
      }
    }

    this._submitted.delete(turn);
    this._executingTurn++;

    // Checksum every CHECKSUM_INTERVAL_TURNS turns (turn 0, 10, 20, ...).
    let checksum: ChecksumResult | null = null;
    if (turn % CHECKSUM_INTERVAL_TURNS === 0) {
      checksum = this._computeChecksum();
      this._checksums.set(turn, checksum);
      this._lastChecksum = checksum;
    }

    return { turn, commandCount, checksum };
  }

  /**
   * Frame hook: update the stall grading (speedScale / bufferHealth). Call once
   * per rendered frame with `performance.now()`.
   */
  updateStall(nowMs: number): void {
    this.stallHandler.update(this._stalled, this.bufferedTurns, nowMs);
  }

  /** Feed an RTT sample + re-evaluate the adaptive turn rate (chunk-2 wiring). */
  addRttSample(playerId: number, rtt: number): void {
    this.adaptiveTurnRate.addRttSample(String(playerId), rtt);
    const preset = this.adaptiveTurnRate.evaluate();
    if (preset) {
      this._turnDurationMs = preset.durationMs;
      this._ticksPerTurn = preset.ticksPerTurn;
    }
  }

  reset(): void {
    this._executingTurn = 0;
    this._submitted.clear();
    this._checksums.clear();
    this._lastChecksum = null;
    this._stalled = false;
    this._turnDurationMs = TURN_DURATION_MS;
    this._ticksPerTurn = TICKS_PER_TURN;
    this.stallHandler.resetStallTimer();
  }
}
