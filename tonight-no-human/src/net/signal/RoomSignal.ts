/**
 * Room discovery stub — real path is PartyNet → Studio `/ws/party`.
 * Kept for API compatibility with architecture §4.2 "signal" layer.
 */
import type { RoomCode } from '../../shared/types';
import { GAME_CONFIG } from '../../shared/config';

export class RoomSignal {
  /** Prefer `new PartyNet().createRoom()` / `joinRoom()`. */
  async createRoom(): Promise<{ roomCode: RoomCode }> {
    throw new Error('use PartyNet.createRoom — RoomSignal is a docs stub');
  }

  async joinRoom(roomCode: RoomCode): Promise<{ ok: boolean; error?: string }> {
    if (!roomCode || roomCode.length !== GAME_CONFIG.roomCodeLength) {
      return { ok: false, error: 'invalid room code' };
    }
    throw new Error('use PartyNet.joinRoom — RoomSignal is a docs stub');
  }

  async leaveRoom(): Promise<void> {
    /* noop */
  }
}
