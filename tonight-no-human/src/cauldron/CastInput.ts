import type { CastSubmission, PlayerId } from '../shared/types';
import { GAME_CONFIG } from '../shared/config';

/** Collect 3-card submissions; Host waits for all confirm or timeout. */
export class CastInput {
  private subs = new Map<PlayerId, CastSubmission>();

  submit(playerId: PlayerId, cardIds: [string, string, string], now: number): void {
    if (cardIds.length !== GAME_CONFIG.castCardsPerPlayer) {
      throw new Error('need exactly 3 cards');
    }
    this.subs.set(playerId, { playerId, cardIds, confirmedAt: now });
  }

  has(playerId: PlayerId): boolean {
    return this.subs.has(playerId);
  }

  allConfirmed(playerIds: PlayerId[]): boolean {
    return playerIds.every((id) => this.subs.has(id));
  }

  list(): CastSubmission[] {
    return [...this.subs.values()].sort((a, b) => a.confirmedAt - b.confirmedAt);
  }

  clear(): void {
    this.subs.clear();
  }
}
