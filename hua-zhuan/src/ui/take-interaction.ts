import type { GameState, TakeAction, TakeSource, TileColor } from '../core/types';
import { getValidTargetRows } from '../core/rules';
import type { TakeSelectionStore } from './take-selection';

export function syncTakeSelection(state: GameState, selection: TakeSelectionStore): void {
  const p = state.players[state.currentPlayer];
  if (state.phase !== 'take_turn' || !p?.isHuman) {
    selection.clear();
  }
}

export function effectiveTakeSelection(
  state: GameState,
  selection: TakeSelectionStore,
): TakeAction | null {
  if (state.pendingAction) return state.pendingAction;
  const sel = selection.get();
  if (sel.source && sel.color !== null && sel.targetRow !== null) {
    return { source: sel.source, color: sel.color, targetRow: sel.targetRow };
  }
  return null;
}

function sameSource(a: TakeSource, b: TakeSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'center') return true;
  return b.kind === 'factory' && a.index === b.index;
}

export function isSourceColorSelected(
  state: GameState,
  selection: TakeSelectionStore,
  source: TakeSource,
  color: TileColor,
): boolean {
  const action = state.pendingAction;
  const src = action?.source ?? selection.get().source;
  const col = action?.color ?? selection.get().color;
  if (!src || col === null || col !== color) return false;
  return sameSource(src, source);
}

export function isPatternRowSelected(
  state: GameState,
  selection: TakeSelectionStore,
  row: number,
): boolean {
  if (state.pendingAction) return state.pendingAction.targetRow === row;
  return selection.get().targetRow === row;
}

export function canPickPatternRow(state: GameState, selection: TakeSelectionStore, row: number): boolean {
  const p = state.players[state.currentPlayer];
  if (!p?.isHuman || state.phase !== 'take_turn') return false;
  const sel = selection.get();
  if (!sel.source || sel.color === null) return false;
  const valid = getValidTargetRows(p, sel.color);
  if (valid.length === 0) return row === 0;
  return valid.includes(row);
}
