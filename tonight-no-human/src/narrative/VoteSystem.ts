import type { PlayerId, VoteBallot, VoteResult } from '../shared/types';
import type { SeedService } from '../session/SeedService';

/** Simultaneous vote; ballots hidden until deadline; ties → DM dice. */
export class VoteSystem {
  open = false;
  options: string[] = [];
  deadlineMs = 0;
  private ballots = new Map<PlayerId, VoteBallot>();

  begin(options: string[], deadlineMs: number): void {
    this.open = true;
    this.options = options.slice();
    this.deadlineMs = deadlineMs;
    this.ballots.clear();
  }

  cast(ballot: VoteBallot): void {
    if (!this.open) return;
    if (!this.options.includes(ballot.optionId)) return;
    this.ballots.set(ballot.playerId, ballot);
  }

  close(seed: SeedService): VoteResult {
    this.open = false;
    const tallies: Record<string, number> = {};
    for (const opt of this.options) tallies[opt] = 0;
    for (const b of this.ballots.values()) {
      tallies[b.optionId] = (tallies[b.optionId] ?? 0) + 1;
    }
    let best = this.options[0]!;
    let bestN = -1;
    let tie = false;
    for (const opt of this.options) {
      const n = tallies[opt] ?? 0;
      if (n > bestN) {
        best = opt;
        bestN = n;
        tie = false;
      } else if (n === bestN) {
        tie = true;
      }
    }
    let tieBrokenByDice = false;
    if (tie) {
      best = seed.pick(this.options.filter((o) => (tallies[o] ?? 0) === bestN));
      tieBrokenByDice = true;
    }
    return { winningOptionId: best, tallies, tieBrokenByDice };
  }
}
