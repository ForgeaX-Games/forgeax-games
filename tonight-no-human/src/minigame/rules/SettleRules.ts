import type { MinigameResult, MinigameType, PlayerId } from '../../shared/types';
import { GAME_CONFIG } from '../../shared/config';

/** Sugar-coat delta helpers by minigame type. */
export function applyTypeRules(
  type: MinigameType,
  playerIds: PlayerId[],
  opts: {
    success?: boolean;
    rankings?: PlayerId[];
    villainId?: PlayerId;
    villainWon?: boolean;
  },
): Record<PlayerId, number> {
  const delta: Record<PlayerId, number> = {};
  for (const id of playerIds) delta[id] = 0;

  switch (type) {
    case 'coop': {
      const d = opts.success ? 1 : -1;
      for (const id of playerIds) delta[id] = d;
      break;
    }
    case 'ffa': {
      const last = opts.rankings?.[opts.rankings.length - 1];
      if (last) delta[last] = -1;
      break;
    }
    case '2v2': {
      // Caller marks losers via rankings second half or explicit — stub: last half lose.
      const ranks = opts.rankings ?? playerIds;
      const half = Math.ceil(ranks.length / 2);
      for (let i = half; i < ranks.length; i++) delta[ranks[i]!] = -1;
      break;
    }
    case '3v1': {
      if (opts.villainId) {
        if (opts.villainWon) {
          for (const id of playerIds) if (id !== opts.villainId) delta[id] = -1;
        } else {
          delta[opts.villainId] = -2;
        }
      }
      break;
    }
  }
  return delta;
}

export function clampSugar(n: number): number {
  return Math.max(0, Math.min(GAME_CONFIG.sugarCoatMax, n));
}

export function emptyResult(playerIds: PlayerId[]): MinigameResult {
  return {
    rankings: playerIds.slice(),
    survivors: playerIds.slice(),
    sugarDelta: Object.fromEntries(playerIds.map((id) => [id, 0])),
    titleEvents: [],
  };
}
