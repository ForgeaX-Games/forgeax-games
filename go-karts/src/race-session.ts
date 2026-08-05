/**
 * Race session — lap / time / rank from track progress (player + AI).
 */

export type RacePhase = 'race' | 'waiting' | 'results';

export interface RacerProgress {
  readonly id: string;
  /** lap + fractional track t in [0,1) → comparable race distance */
  readonly progress: number;
}

export interface RacerResult {
  readonly id: string;
  readonly rank: number;
  readonly finishTime: number;
}

export interface RaceSession {
  readonly phase: RacePhase;
  readonly elapsed: number;
  readonly lap: number;
  readonly totalLaps: number;
  readonly rank: number;
  /** Frozen snapshot from the instant the player crossed the finish line. */
  readonly playerResult: RacerResult | null;
  /** Finish-order results. Populated incrementally while rivals finish. */
  readonly standings: readonly RacerResult[];
  update(dt: number, playerTrackT: number, rivals?: readonly RacerProgress[]): void;
  /** Comparable score: (lap-1) + trackT */
  playerProgress(trackT: number): number;
}

export function createRaceSession(options?: { totalLaps?: number }): RaceSession {
  const PERSONAL_RESULT_HOLD = 2.2;
  const totalLaps = options?.totalLaps ?? 3;
  let phase: RacePhase = 'race';
  let elapsed = 0;
  let lap = 1;
  let lastT = 0;
  let rank = 1;
  let finishOrder = 0;
  const finishes = new Map<string, { time: number; order: number }>();
  const rivalIds = new Set<string>();

  const playerProgress = (trackT: number): number => (lap - 1) + (((trackT % 1) + 1) % 1);
  const standings = (): RacerResult[] =>
    [...finishes.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id, finish], index) => ({
        id,
        rank: index + 1,
        finishTime: finish.time,
      }));

  return {
    get phase() {
      return phase;
    },
    get elapsed() {
      return elapsed;
    },
    get lap() {
      return lap;
    },
    get totalLaps() {
      return totalLaps;
    },
    get rank() {
      return rank;
    },
    get playerResult() {
      return standings().find((result) => result.id === 'player') ?? null;
    },
    get standings() {
      return standings();
    },
    playerProgress,
    update(dt: number, playerTrackT: number, rivals: readonly RacerProgress[] = []) {
      if (phase !== 'results') {
        elapsed += dt;
      }

      for (const rival of rivals) rivalIds.add(rival.id);

      const crossedLine = lastT > 0.85 && playerTrackT < 0.15;
      let playerFinishedThisFrame = false;
      if (phase === 'race' && crossedLine) {
        if (lap < totalLaps) {
          lap += 1;
        } else if (!finishes.has('player')) {
          playerFinishedThisFrame = true;
          phase = 'waiting';
        }
      }
      lastT = playerTrackT;

      // Racers can cross during the same frame. Their overshoot gives a stable,
      // fair tie-break instead of always favoring the player or an array slot.
      const newFinishers: RacerProgress[] = rivals
        .filter((rival) => rival.progress >= totalLaps && !finishes.has(rival.id));
      if (playerFinishedThisFrame) {
        newFinishers.push({
          id: 'player',
          progress: totalLaps + Math.max(0, playerTrackT),
        });
      }
      newFinishers.sort((a, b) => b.progress - a.progress || a.id.localeCompare(b.id));
      for (const racer of newFinishers) {
        finishes.set(racer.id, { time: elapsed, order: finishOrder++ });
      }

      const playerFinish = finishes.get('player');
      const allRivalsFinished = [...rivalIds].every((id) => finishes.has(id));
      // Keep the personal result readable even when the player is the last
      // racer across the line and everyone completes during the same frame.
      if (
        playerFinish !== undefined &&
        allRivalsFinished &&
        elapsed - playerFinish.time >= PERSONAL_RESULT_HOLD
      ) {
        phase = 'results';
      }

      const mine = {
        id: 'player',
        progress: finishes.has('player') ? totalLaps : playerProgress(playerTrackT),
      };
      const all = [mine, ...rivals].sort((a, b) => b.progress - a.progress);
      const idx = all.findIndex((r) => r.id === 'player');
      rank = finishes.has('player')
        ? (standings().find((result) => result.id === 'player')?.rank ?? all.length)
        : idx >= 0
          ? idx + 1
          : all.length;
    },
  };
}
