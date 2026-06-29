import type { GameState, TakeAction, TileColor } from '../core/types';
import {
  canTakeColor,
  getAvailableColorsFromSource,
  getValidTargetRows,
  isValidTake,
} from '../core/rules';
import { FACTORY_COUNT } from '../core/constants';

function pickBestRow(player: import('../core/types').PlayerState, color: TileColor): number {
  const rows = getValidTargetRows(player, color);
  if (rows.length === 0) return 0;
  // Prefer row closest to completion
  rows.sort((a, b) => {
    const pa = player.patternRows[a]!.tiles.length;
    const pb = player.patternRows[b]!.tiles.length;
    return pb - pa;
  });
  return rows[0]!;
}

export function pickAiAction(state: GameState): TakeAction | null {
  const player = state.players[state.currentPlayer]!;
  const candidates: TakeAction[] = [];

  for (let fi = 0; fi < FACTORY_COUNT; fi++) {
    const f = state.factories[fi]!;
    if (f.length === 0) continue;
    const colors = getAvailableColorsFromSource(state, { kind: 'factory', index: fi });
    for (const color of colors) {
      const onlyLeft = f.every((t) => t === color);
      if (!canTakeColor(player, color) && !onlyLeft) continue;
      const rows = getValidTargetRows(player, color);
      const targetRow = rows.length > 0 ? pickBestRow(player, color) : 0;
      candidates.push({ source: { kind: 'factory', index: fi }, color, targetRow });
    }
  }

  if (state.center.length > 0) {
    const colors = getAvailableColorsFromSource(state, { kind: 'center' });
    for (const color of colors) {
      const onlyLeft = state.center.every((t) => t === color);
      if (!canTakeColor(player, color) && !onlyLeft) continue;
      const rows = getValidTargetRows(player, color);
      const targetRow = rows.length > 0 ? pickBestRow(player, color) : 0;
      candidates.push({ source: { kind: 'center' }, color, targetRow });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer factory with most tiles of chosen color
  candidates.sort((a, b) => {
    const countA =
      a.source.kind === 'factory'
        ? state.factories[a.source.index]!.filter((t) => t === a.color).length
        : state.center.filter((t) => t === a.color).length;
    const countB =
      b.source.kind === 'factory'
        ? state.factories[b.source.index]!.filter((t) => t === b.color).length
        : state.center.filter((t) => t === b.color).length;
    return countB - countA;
  });

  const action = candidates[0]!;
  if (!isValidTake(state, action).ok) return null;
  return action;
}
