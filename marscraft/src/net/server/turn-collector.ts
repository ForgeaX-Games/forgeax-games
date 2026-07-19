/**
 * MarsCraft -> forgeax-engine — M15 chunk 2: authoritative TurnCollector
 * =============================================================================
 * Faithful port of `server/TurnCollector.ts` (numeric player ids + the port's
 * `PlayerCommand`). Collects every player's command batch for a turn; once all are
 * in it fires `onTurnReady(turn, cmdsByPlayer)` (the room broadcasts it) and
 * advances. A periodic timer re-tries advance so a DISCONNECTED player's turns get
 * auto-filled with empty commands (the match never hard-stalls). Turn-rate changes
 * are scheduled to take effect at a designated turn (restarts the timer).
 */

import type { PlayerCommand } from '../turn-sync';
import { TURN_DURATION_MS } from '../adaptive-turn-rate';

interface TurnSlot {
  commands: Map<number, PlayerCommand[]>;
  receivedFrom: Set<number>;
}

export class TurnCollector {
  private currentTurn = 0;
  private readonly playerIds: number[];
  private readonly slots = new Map<number, TurnSlot>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly disconnected = new Set<number>();
  private _intervalMs = TURN_DURATION_MS;
  private _pendingRateChange: { effectiveTurn: number; durationMs: number } | null = null;

  onTurnReady: ((turnId: number, commandsByPlayer: Record<number, PlayerCommand[]>) => void) | null = null;

  constructor(playerIds: number[]) { this.playerIds = [...playerIds].sort((a, b) => a - b); }

  start(): void { this._startTimer(); }
  stop(): void { this._stopTimer(); this.slots.clear(); }

  get currentTurnId(): number { return this.currentTurn; }
  get intervalMs(): number { return this._intervalMs; }

  scheduleTurnRateChange(effectiveTurn: number, durationMs: number): void {
    this._pendingRateChange = { effectiveTurn, durationMs };
  }

  markDisconnected(playerId: number): void {
    this.disconnected.add(playerId);
    this._tryAdvance();
  }
  markReconnected(playerId: number): void {
    this.disconnected.delete(playerId);
    for (const [turnId, slot] of this.slots) {
      if (turnId >= this.currentTurn && slot.receivedFrom.has(playerId)) {
        const cmds = slot.commands.get(playerId);
        if (cmds && cmds.length === 0) { slot.commands.delete(playerId); slot.receivedFrom.delete(playerId); }
      }
    }
  }

  receiveCommands(playerId: number, turnId: number, commands: PlayerCommand[]): void {
    if (turnId < this.currentTurn) return; // already broadcast; ignore late arrival
    let slot = this.slots.get(turnId);
    if (!slot) { slot = { commands: new Map(), receivedFrom: new Set() }; this.slots.set(turnId, slot); }
    slot.commands.set(playerId, commands);
    slot.receivedFrom.add(playerId);
    this._tryAdvance();
  }

  private _startTimer(): void { this._stopTimer(); this.timer = setInterval(() => this._tryAdvance(), this._intervalMs); }
  private _stopTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private _tryAdvance(): void {
    for (;;) {
      // auto-fill empties for disconnected players so the match doesn't hard-stall.
      if (this.disconnected.size > 0) {
        let slot = this.slots.get(this.currentTurn);
        if (!slot) { slot = { commands: new Map(), receivedFrom: new Set() }; this.slots.set(this.currentTurn, slot); }
        for (const dc of this.disconnected) {
          if (!slot.receivedFrom.has(dc)) { slot.commands.set(dc, []); slot.receivedFrom.add(dc); }
        }
      }

      const slot = this.slots.get(this.currentTurn);
      if (!slot) break;
      if (!this.playerIds.every((id) => slot.receivedFrom.has(id))) break;

      const cmdsByPlayer: Record<number, PlayerCommand[]> = {};
      for (const pid of this.playerIds) cmdsByPlayer[pid] = slot.commands.get(pid) ?? [];
      this.onTurnReady?.(this.currentTurn, cmdsByPlayer);

      this.slots.delete(this.currentTurn);
      this.currentTurn++;

      if (this._pendingRateChange && this.currentTurn >= this._pendingRateChange.effectiveTurn) {
        this._intervalMs = this._pendingRateChange.durationMs;
        this._pendingRateChange = null;
        this._startTimer();
      }
    }
  }
}
