/**
 * MarsCraft -> forgeax-engine — M15 chunk 2 wire protocol
 * =============================================================================
 * The JSON messages exchanged between the lockstep WS client (`RtsClient`) and the
 * authoritative room (`server/`). Numeric player ids everywhere (they match the sim
 * `TurnSync` player ids directly — the source used string ids + a mapping; we drop
 * that indirection). PlayerCommand is the sim command batch element (turn-sync.ts).
 *
 * Turn lifecycle: client → `cmds`(turn, myCmds); server collects every player's
 * `cmds` for turn T; when all present it broadcasts `turn`(T, cmdsByPlayer); each
 * client submits that full set to its TurnSync and steps turn T. On checksum turns
 * the client reports `checksum`(T, hash); the room cross-checks and broadcasts
 * `desync` on a mismatch. `ping`/`pong` feed RTT → the client's AdaptiveTurnRate.
 */

import type { PlayerCommand } from './turn-sync';

export type ClientMessage =
  | { t: 'join'; playerId: number }
  | { t: 'cmds'; playerId: number; turn: number; cmds: PlayerCommand[] }
  | { t: 'checksum'; playerId: number; turn: number; hash: string }
  | { t: 'ping'; ts: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: number; expected: number }
  | { t: 'start'; players: number[] }
  | { t: 'turn'; turn: number; cmds: Record<number, PlayerCommand[]> }
  | { t: 'rate'; effectiveTurn: number; durationMs: number }
  | { t: 'desync'; turn: number; hashes: Record<number, string> }
  | { t: 'pong'; ts: number };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(data: string): ClientMessage | null {
  try { return JSON.parse(data) as ClientMessage; } catch { return null; }
}

export function decodeServer(data: string): ServerMessage | null {
  try { return JSON.parse(data) as ServerMessage; } catch { return null; }
}

/** Minimal WebSocket surface both Bun's and the browser's client sockets satisfy. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', cb: (ev: unknown) => void): void;
}
