import type { CluePayload, PlayerId, PlayerInput, RoomCode } from '../shared/types';

/** Wire events between Host and Clients. */

export type NetEvent =
  | { type: 'room.joined'; roomCode: RoomCode; playerId: PlayerId }
  | { type: 'room.roster'; payload: RoomRosterPayload }
  | { type: 'room.ready'; playerId: PlayerId; ready: boolean }
  | { type: 'room.chapter'; chapterId: string }
  | { type: 'match.phase'; phase: string; nodeIndex: number }
  | { type: 'match.sync'; payload: MatchSyncPayload }
  | { type: 'match.roles'; mapping: Record<PlayerId, string>; seed: number }
  | { type: 'match.snapshot'; frame: number; body: unknown }
  | { type: 'match.input'; input: PlayerInput }
  | { type: 'cast.submit'; playerId: PlayerId; cardIds: [string, string, string] }
  | { type: 'privacy.clue'; clue: CluePayload }
  | { type: 'vote.open'; options: string[]; deadlineMs: number }
  | { type: 'vote.close'; result: unknown }
  | { type: 'host.migrate'; newHostId: PlayerId };

export type RoomRosterPayload = {
  roomCode: string;
  hostId: PlayerId;
  chapterId: string;
  players: Array<{
    id: PlayerId;
    displayName: string;
    ready: boolean;
    isHost: boolean;
    connected: boolean;
  }>;
};

export type MatchSyncPayload = {
  phase: string;
  nodeIndex: number;
  matchSeed: number;
  room: RoomRosterPayload;
  roles?: Record<PlayerId, string>;
  privateClue?: string; // never set on broadcast — host uses send(..., {to})
  lastResult?: unknown;
  timeline?: { narrativeId: string; duration: number; t: number; playing: boolean };
};

export type NetHandler = (ev: NetEvent) => void;

export interface NetHost {
  readonly isHost: boolean;
  readonly localPlayerId: PlayerId;
  send(ev: NetEvent, opts?: { to?: PlayerId }): void;
  broadcast(ev: NetEvent): void;
  on(handler: NetHandler): () => void;
}

/**
 * Single-process loopback — solo / offline fallback.
 * Privacy events with `to` only deliver to that player id.
 */
export class LocalLoopbackNet implements NetHost {
  readonly isHost: boolean;
  readonly localPlayerId: PlayerId;
  private handlers = new Set<NetHandler>();

  constructor(localPlayerId: PlayerId, isHost: boolean) {
    this.localPlayerId = localPlayerId;
    this.isHost = isHost;
  }

  on(handler: NetHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(ev: NetEvent, opts?: { to?: PlayerId }): void {
    if (opts?.to && opts.to !== this.localPlayerId) return;
    for (const h of this.handlers) h(ev);
  }

  broadcast(ev: NetEvent): void {
    for (const h of this.handlers) h(ev);
  }
}
