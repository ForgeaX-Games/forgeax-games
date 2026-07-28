/**
 * Race session — lap / time / rank from track progress (player + AI).
 */

export type RacePhase = 'menu' | 'intro' | 'countdown' | 'race' | 'over';

export interface RacerProgress {
  readonly id: string;
  /** lap + fractional track t in [0,1) → comparable race distance */
  readonly progress: number;
}

export interface RaceSession {
  readonly phase: RacePhase;
  readonly elapsed: number;
  readonly lap: number;
  readonly totalLaps: number;
  readonly rank: number;
  update(dt: number, playerTrackT: number, rivals?: readonly RacerProgress[]): void;
  /** Comparable score: (lap-1) + trackT */
  playerProgress(trackT: number): number;
}

export function createRaceSession(options?: { totalLaps?: number }): RaceSession {
  const totalLaps = options?.totalLaps ?? 3;
  let phase: RacePhase = 'race';
  let elapsed = 0;
  let lap = 1;
  let lastT = 0;
  let rank = 1;

  const playerProgress = (trackT: number): number => (lap - 1) + (((trackT % 1) + 1) % 1);

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
    playerProgress,
    update(dt: number, playerTrackT: number, rivals: readonly RacerProgress[] = []) {
      if (phase === 'over') {
        // still refresh rank display
      } else {
        elapsed += dt;
        if (lastT > 0.85 && playerTrackT < 0.15) {
          if (lap < totalLaps) lap += 1;
          else phase = 'over';
        }
        lastT = playerTrackT;
      }

      const mine = { id: 'player', progress: playerProgress(playerTrackT) };
      const all = [mine, ...rivals].sort((a, b) => b.progress - a.progress);
      const idx = all.findIndex((r) => r.id === 'player');
      rank = idx >= 0 ? idx + 1 : all.length;
    },
  };
}
