import type { TakeSource, TileColor } from '../core/types';

export interface TakeSelection {
  source: TakeSource | null;
  color: TileColor | null;
  targetRow: number | null;
}

export type TakeSelectionListener = () => void;

export interface TakeSelectionStore {
  get(): TakeSelection;
  setSourceColor(source: TakeSource, color: TileColor): void;
  setTargetRow(row: number): void;
  clear(): void;
  subscribe(fn: TakeSelectionListener): () => void;
}

export function createTakeSelection(): TakeSelectionStore {
  let sel: TakeSelection = { source: null, color: null, targetRow: null };
  const listeners = new Set<TakeSelectionListener>();

  function notify(): void {
    for (const fn of listeners) fn();
  }

  return {
    get: () => ({ ...sel }),
    setSourceColor(source, color) {
      sel = { source, color, targetRow: null };
      notify();
    },
    setTargetRow(row) {
      sel = { ...sel, targetRow: row };
      notify();
    },
    clear() {
      if (sel.source === null && sel.color === null && sel.targetRow === null) return;
      sel = { source: null, color: null, targetRow: null };
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
