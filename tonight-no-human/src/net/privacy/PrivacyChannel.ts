import type { CluePayload, PlayerId } from '../../shared/types';
import type { NetHost } from '../NetHost';

/**
 * Directed private delivery — NEVER broadcast then hide on client.
 * Architecture §4.3 iron rule.
 */
export class PrivacyChannel {
  constructor(private net: NetHost) {}

  /** Host → single player. Loopback drops if not local. */
  sendClue(clue: CluePayload): void {
    this.net.send({ type: 'privacy.clue', clue }, { to: clue.targetPlayerId });
  }

  distributeUnique(clues: Array<{ clueId: string; body: string }>, playerIds: PlayerId[]): CluePayload[] {
    const out: CluePayload[] = [];
    const n = Math.min(clues.length, playerIds.length);
    for (let i = 0; i < n; i++) {
      const payload: CluePayload = {
        clueId: clues[i]!.clueId,
        body: clues[i]!.body,
        targetPlayerId: playerIds[i]!,
      };
      this.sendClue(payload);
      out.push(payload);
    }
    return out;
  }
}
