/**
 * MarsCraft -> forgeax-engine — M15 chunk 2: authoritative room
 * =============================================================================
 * Port of the lockstep core of `server/RTSRoom.ts` (+ `ChecksumVerifier.ts`):
 * an authoritative match room that owns a `TurnCollector`, broadcasts `turn_ready`
 * once every player's commands for a turn are in, cross-checks the per-turn
 * checksums peers report (desync detection), answers `ping` with `pong`, and
 * auto-fills a disconnected player's turns. Transport-agnostic: it emits via an
 * injected `send(playerId, msg)` so the Bun server and the test harness share it.
 */

import type { PlayerCommand } from '../turn-sync';
import type { ClientMessage, ServerMessage } from '../protocol';
import { TurnCollector } from './turn-collector';

type SendFn = (playerId: number, msg: ServerMessage) => void;

export class Room {
  private readonly _expected: number;
  private readonly _send: SendFn;
  private readonly _players = new Set<number>();
  private _collector: TurnCollector | null = null;
  private _started = false;
  /** turn -> (playerId -> reported hash) for the desync cross-check. */
  private readonly _checksums = new Map<number, Map<number, string>>();
  private readonly _desyncedTurns = new Set<number>();

  constructor(expectedPlayers: number, send: SendFn) {
    this._expected = expectedPlayers;
    this._send = send;
  }

  get started(): boolean { return this._started; }
  get currentTurn(): number { return this._collector?.currentTurnId ?? 0; }
  get playerCount(): number { return this._players.size; }
  get desyncCount(): number { return this._desyncedTurns.size; }

  /** Route a decoded client message into the room. */
  handle(playerId: number, msg: ClientMessage): void {
    switch (msg.t) {
      case 'join': this._join(msg.playerId); break;
      case 'cmds': this._collector?.receiveCommands(msg.playerId, msg.turn, msg.cmds); break;
      case 'checksum': this._checksum(msg.playerId, msg.turn, msg.hash); break;
      case 'ping': this._send(playerId, { t: 'pong', ts: msg.ts }); break;
    }
  }

  removePlayer(playerId: number): void {
    if (!this._players.has(playerId)) return;
    this._collector?.markDisconnected(playerId);
  }

  stop(): void { this._collector?.stop(); }

  // ── internals ────────────────────────────────────────────────────────────────
  private _join(playerId: number): void {
    this._players.add(playerId);
    this._send(playerId, { t: 'welcome', playerId, expected: this._expected });
    if (!this._started && this._players.size >= this._expected) this._start();
  }

  private _start(): void {
    this._started = true;
    const players = [...this._players].sort((a, b) => a - b);
    this._collector = new TurnCollector(players);
    this._collector.onTurnReady = (turn, cmdsByPlayer) => this._broadcast({ t: 'turn', turn, cmds: cmdsByPlayer as Record<number, PlayerCommand[]> });
    this._collector.start();
    this._broadcast({ t: 'start', players });
  }

  private _checksum(playerId: number, turn: number, hash: string): void {
    let byPlayer = this._checksums.get(turn);
    if (!byPlayer) { byPlayer = new Map(); this._checksums.set(turn, byPlayer); }
    byPlayer.set(playerId, hash);
    if (byPlayer.size < this._players.size) return; // wait for everyone's report

    // all reported for this turn → compare. A mismatch = desync.
    const hashes: Record<number, string> = {};
    let first: string | null = null;
    let mismatch = false;
    for (const [pid, h] of byPlayer) {
      hashes[pid] = h;
      if (first === null) first = h;
      else if (h !== first) mismatch = true;
    }
    if (mismatch && !this._desyncedTurns.has(turn)) {
      this._desyncedTurns.add(turn);
      this._broadcast({ t: 'desync', turn, hashes });
    }
    this._checksums.delete(turn);
  }

  private _broadcast(msg: ServerMessage): void {
    for (const pid of this._players) this._send(pid, msg);
  }
}
