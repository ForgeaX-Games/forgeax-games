// Hellforge bag grid — Diablo-style multi-size placement, pure functions.
// Single source of truth for grid dimensions (inventory-ui renders from these).
// The bag stores one ANCHOR per item (top-left cell); occupancy is always
// DERIVED from anchors via itemFootprint — items never carry covered-cell
// markers. Zero DOM/engine imports.

import { itemFootprint, type ItemInstance } from './items';

export const BAG_COLS = 12;
export const BAG_ROWS = 5;
export const BAG_CELLS = BAG_COLS * BAG_ROWS;

/** Personal stash (仓库): a second per-character grid beside the bag. */
export const STASH_COLS = 12;
export const STASH_ROWS = 10;
export const STASH_CELLS = STASH_COLS * STASH_ROWS;

/** One bag item: the instance plus its top-left anchor cell (0-based). */
export interface BagAnchor {
  readonly item: ItemInstance;
  readonly x: number; // 0..BAG_COLS-1 (left edge)
  readonly y: number; // 0..BAG_ROWS-1 (top edge)
}

/**
 * Grid helpers below share one caller contract: the `cells` array passed to
 * occupancy/canPlace/firstFit must have exactly `cols*rows` entries — hot-path
 * pure functions, so the invariant is documented, not asserted.
 */

/** Derive the occupancy grid (row-major boolean cells) from anchors. */
export function occupancy(
  anchors: readonly BagAnchor[],
  cols: number = BAG_COLS,
  rows: number = BAG_ROWS,
): boolean[] {
  const cells = new Array<boolean>(cols * rows).fill(false);
  for (const a of anchors) {
    const { w, h } = itemFootprint(a.item);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = a.x + dx;
        const cy = a.y + dy;
        if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
          cells[cy * cols + cx] = true;
        }
      }
    }
  }
  return cells;
}

/** True when a w×h item can sit with its top-left at (x, y) — in bounds, no overlap. */
export function canPlace(
  cells: readonly boolean[],
  w: number,
  h: number,
  x: number,
  y: number,
  cols: number = BAG_COLS,
  rows: number = BAG_ROWS,
): boolean {
  if (w < 1 || h < 1 || x < 0 || y < 0) return false;
  if (x + w > cols || y + h > rows) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (cells[(y + dy) * cols + (x + dx)]) return false;
    }
  }
  return true;
}

/** First free w×h spot in row-major scan order (D2-style top-left packing). */
export function firstFit(
  cells: readonly boolean[],
  w: number,
  h: number,
  cols: number = BAG_COLS,
  rows: number = BAG_ROWS,
): { x: number; y: number } | null {
  for (let y = 0; y <= rows - h; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (canPlace(cells, w, h, x, y, cols, rows)) return { x, y };
    }
  }
  return null;
}

/** firstFit convenience on anchors: where would `item` land, if anywhere. */
export function firstFitFor(
  anchors: readonly BagAnchor[],
  item: Readonly<ItemInstance>,
  cols: number = BAG_COLS,
  rows: number = BAG_ROWS,
): { x: number; y: number } | null {
  const { w, h } = itemFootprint(item);
  return firstFit(occupancy(anchors, cols, rows), w, h, cols, rows);
}

/** Coarse "any space left" probe (a 1×1 fit) — loot magnet gating. */
export function hasFreeCell(
  anchors: readonly BagAnchor[],
  cols: number = BAG_COLS,
  rows: number = BAG_ROWS,
): boolean {
  return occupancy(anchors, cols, rows).some((c) => !c);
}

/** Count of occupied cells (bag-title "used/total" display). */
export function occupiedCellCount(
  anchors: readonly BagAnchor[],
  cols: number = BAG_COLS,
  rows: number = BAG_ROWS,
): number {
  return occupancy(anchors, cols, rows).filter(Boolean).length;
}
