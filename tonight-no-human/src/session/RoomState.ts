import { GAME_CONFIG } from '../shared/config';
import { makePlayerId, makeRoomCode } from '../shared/ids';
import type { ChapterDef, PlayerId, PlayerSlot, RoomCode } from '../shared/types';
import type { RoomRosterPayload } from '../net/NetHost';

/** Lobby / room roster — who is in, ready flags, selected chapter. */
export class RoomState {
  roomCode: RoomCode;
  hostId: PlayerId;
  chapterId: string;
  players: PlayerSlot[] = [];

  constructor(opts?: { hostName?: string; chapterId?: string; empty?: boolean }) {
    this.roomCode = makeRoomCode(GAME_CONFIG.roomCodeLength);
    this.hostId = '';
    this.chapterId = opts?.chapterId ?? GAME_CONFIG.demoChapterId;
    if (opts?.empty) return;
    this.hostId = makePlayerId('host');
    this.players.push({
      id: this.hostId,
      displayName: opts?.hostName ?? '房主',
      ready: false,
      isHost: true,
      connected: true,
      sugarCoat: GAME_CONFIG.sugarCoatStart,
      isGhost: false,
    });
  }

  get localHost(): PlayerSlot | undefined {
    return this.players.find((p) => p.isHost);
  }

  find(id: PlayerId): PlayerSlot | undefined {
    return this.players.find((p) => p.id === id);
  }

  addPlayer(displayName: string): PlayerSlot {
    if (this.players.length >= GAME_CONFIG.maxPlayers) {
      throw new Error('room full');
    }
    const slot: PlayerSlot = {
      id: makePlayerId('p'),
      displayName,
      ready: false,
      isHost: false,
      connected: true,
      sugarCoat: GAME_CONFIG.sugarCoatStart,
      isGhost: false,
    };
    this.players.push(slot);
    return slot;
  }

  /** Demo helper: fill empty seats with local bots so solo testing works. */
  fillBots(upTo = GAME_CONFIG.maxPlayers): void {
    const names = ['阿糖', '小骨', '蜜瓜', '烛影'];
    let i = 0;
    while (this.players.length < upTo) {
      const bot = this.addPlayer(names[i % names.length]!);
      bot.ready = true;
      i++;
    }
  }

  setReady(id: PlayerId, ready: boolean): void {
    const p = this.find(id);
    if (p) p.ready = ready;
  }

  setChapter(chapter: ChapterDef): void {
    if (!chapter.unlocked) return;
    this.chapterId = chapter.id;
  }

  /** Apply authoritative roster from signaling / host sync (preserves sugar/role). */
  applyRoster(payload: RoomRosterPayload): void {
    this.roomCode = payload.roomCode;
    this.hostId = payload.hostId;
    this.chapterId = payload.chapterId;
    const prev = new Map(this.players.map((p) => [p.id, p]));
    this.players = payload.players.map((row) => {
      const old = prev.get(row.id);
      return {
        id: row.id,
        displayName: row.displayName,
        ready: row.ready,
        isHost: row.isHost,
        connected: row.connected,
        sugarCoat: old?.sugarCoat ?? GAME_CONFIG.sugarCoatStart,
        role: old?.role,
        isGhost: old?.isGhost ?? false,
      };
    });
  }

  /** Host may start when 2–4 players exist and everyone is ready. */
  canStart(): boolean {
    if (this.players.length < GAME_CONFIG.minPlayersToStart) return false;
    if (this.players.length > GAME_CONFIG.maxPlayers) return false;
    return this.players.every((p) => p.ready);
  }

  snapshot() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      chapterId: this.chapterId,
      players: this.players.map((p) => ({ ...p })),
    };
  }
}
