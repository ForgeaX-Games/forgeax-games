/**
 * MarsCraft -> forgeax-engine — M15 chunk 2: lockstep WS client transport
 * =============================================================================
 * Port of `web/network/RTSClient.ts` (the lockstep path): wires a WebSocket to the
 * transport-agnostic `TurnSync` (chunk 1). It does NOT touch the sim — it only
 * moves turns across the wire:
 *
 *   • connect + `join` the room; on `start` it begins the send/step pump.
 *   • SEND side (source input-delay pre-send + command-ahead): keeps `LOOKAHEAD`
 *     turns of this player's command batches in flight so the room always has the
 *     next turns queued and no peer stalls waiting on us.
 *   • RECEIVE side: on `turn`(T, cmdsByPlayer) it `submitTurn`s every player's batch
 *     into TurnSync, then `step()`s turn T. On checksum turns it reports the hash
 *     (`checksum`) for the room's desync cross-check, then queues the next send turn.
 *   • RTT: periodic `ping`; on `pong` it feeds `TurnSync.addRttSample` (drives the
 *     client-side AdaptiveTurnRate).
 *
 * Transport-agnostic: it takes any `SocketLike` (Bun's `WebSocket`, the browser's,
 * or a test double), so the same client runs in a Bun harness and in a browser.
 */

import type { TurnSync, PlayerCommand } from './turn-sync';
import { type ClientMessage, type ServerMessage, type SocketLike, encode, decodeServer } from './protocol';

/** How many turns of local commands to keep in flight (send-ahead buffer). */
const LOOKAHEAD = 3;
/** RTT ping cadence (ms). */
const PING_INTERVAL_MS = 1000;

export interface RtsClientOptions {
  socket: SocketLike;
  localPlayerId: number;
  turnSync: TurnSync;
  /** This player's command batch for a given turn (deterministic per peer). */
  getLocalCommands: (turn: number) => PlayerCommand[];
  /** Called after each executed turn (host drives the world tick / render here). */
  onTurnStep?: (turn: number, commandCount: number) => void;
  /** Called when the room reports a desync (checksum mismatch). */
  onDesync?: (turn: number, hashes: Record<number, string>) => void;
  /** Gate on whether to still send commands for a turn (default: always). Returning
   *  false stops the send pipeline so the match drains to a clean halt (match end /
   *  test cap) instead of pumping turns forever. */
  shouldSend?: (turn: number) => boolean;
  /** Injected clock (ms). Defaults to performance.now / Date.now — pass for tests. */
  now?: () => number;
}

export class RtsClient {
  private readonly _socket: SocketLike;
  private readonly _pid: number;
  private readonly _sync: TurnSync;
  private readonly _getLocal: (turn: number) => PlayerCommand[];
  private readonly _onStep?: (turn: number, n: number) => void;
  private readonly _onDesync?: (turn: number, hashes: Record<number, string>) => void;
  private readonly _shouldSend: (turn: number) => boolean;
  private readonly _now: () => number;

  private _started = false;
  private _sentThrough = -1;      // highest turn we've sent commands for
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _pending: ServerMessage[] = []; // messages arriving before start

  constructor(opts: RtsClientOptions) {
    this._socket = opts.socket;
    this._pid = opts.localPlayerId;
    this._sync = opts.turnSync;
    this._getLocal = opts.getLocalCommands;
    this._onStep = opts.onTurnStep;
    this._onDesync = opts.onDesync;
    this._shouldSend = opts.shouldSend ?? (() => true);
    this._now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

    this._socket.addEventListener('open', () => this._send({ t: 'join', playerId: this._pid }));
    this._socket.addEventListener('message', (ev) => this._onMessage(ev));
    this._socket.addEventListener('close', () => this._stopPing());
  }

  /** Turn the sim is currently at (mirrors TurnSync). */
  get currentTurn(): number { return this._sync.currentTurn; }
  get started(): boolean { return this._started; }

  dispose(): void { this._stopPing(); this._socket.close(); }

  // ── receive ────────────────────────────────────────────────────────────────
  private _onMessage(ev: unknown): void {
    const data = (ev as { data?: unknown }).data;
    const msg = decodeServer(typeof data === 'string' ? data : String(data));
    if (!msg) return;
    if (!this._started && msg.t !== 'start' && msg.t !== 'welcome') { this._pending.push(msg); return; }
    this._handle(msg);
  }

  private _handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        break; // roster ack; the real go signal is `start`
      case 'start':
        this._onStart();
        break;
      case 'turn':
        this._onTurn(msg.turn, msg.cmds);
        break;
      case 'rate':
        // server-issued cadence change is advisory for the host's tick loop; the
        // deterministic sim is turn-locked regardless (no action needed here).
        break;
      case 'desync':
        this._onDesync?.(msg.turn, msg.hashes);
        break;
      case 'pong':
        this._sync.addRttSample(this._pid, Math.max(0, this._now() - msg.ts));
        break;
    }
  }

  private _onStart(): void {
    if (this._started) return;
    this._started = true;
    // prime the pipeline: send LOOKAHEAD turns of our commands up-front so the room
    // can broadcast turn 0 as soon as the other peer's turn 0 arrives.
    for (let t = 0; t <= LOOKAHEAD; t++) this._sendCmdsFor(t);
    this._startPing();
    // drain any turns that arrived before `start`.
    const pending = this._pending; this._pending = [];
    for (const m of pending) this._handle(m);
  }

  private _onTurn(turn: number, cmdsByPlayer: Record<number, PlayerCommand[]>): void {
    // submit EVERY player's batch for this turn, then execute it.
    for (const key of Object.keys(cmdsByPlayer)) {
      const p = Number(key);
      this._sync.submitTurn(p, turn, cmdsByPlayer[p] ?? []);
    }
    // step forward as far as we can (usually exactly this turn).
    let res = this._sync.step();
    while (res) {
      if (res.checksum) this._send({ t: 'checksum', playerId: this._pid, turn: res.turn, hash: String(res.checksum.checksum) });
      this._onStep?.(res.turn, res.commandCount);
      // keep the send-ahead window full relative to the turn we just executed.
      this._sendCmdsFor(res.turn + LOOKAHEAD + 1);
      res = this._sync.step();
    }
  }

  // ── send ─────────────────────────────────────────────────────────────────────
  private _sendCmdsFor(turn: number): void {
    if (turn <= this._sentThrough) return; // already sent this (or earlier) turn
    for (let t = this._sentThrough + 1; t <= turn; t++) {
      if (!this._shouldSend(t)) { this._sentThrough = t - 1; return; } // stop the pipeline here
      this._send({ t: 'cmds', playerId: this._pid, turn: t, cmds: this._getLocal(t) });
      this._sentThrough = t;
    }
  }

  private _startPing(): void {
    this._stopPing();
    this._pingTimer = setInterval(() => this._send({ t: 'ping', ts: this._now() }), PING_INTERVAL_MS);
  }
  private _stopPing(): void { if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; } }

  private _send(msg: ClientMessage): void { this._socket.send(encode(msg)); }
}
