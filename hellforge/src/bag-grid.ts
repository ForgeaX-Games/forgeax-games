// Hellforge bag grid — Diablo-style multi-size placement, pure functions.
// Single source of truth for grid dimensions (inventory-ui renders from these).
// The bag stores one ANCHOR per item (top-left cell); occupancy is always
// DERIVED from anchors via itemFootprint — items never carry covered-cell
// markers. Zero DOM/engine imports.

import { itemFootprint, type ItemInstance } from './items';

export const BAG_COLS = 12;
export const BAG_ROWS = 5;
export const BAG_CELLS = BAG_COLS * BAG_ROWS;

/** One bag item: the instance plus its top-left anchor cell (0-based). */
export interface BagAnchor {
  readonly item: ItemInstance;
  readonly x: number; // 0..BAG_COLS-1 (left edge)
  readonly y: number; // 0..BAG_ROWS-1 (top edge)
}

/** Derive the occupancy grid (row-major boolean cells) from anchors. */
export function occupancy(anchors: readonly BagAnchor[]): boolean[] {
  const cells = new Array<boolean>(BAG_CELLS).fill(false);
  for (const a of anchors) {
    const { w, h } = itemFootprint(a.item);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = a.x + dx;
        const cy = a.y + dy;
        if (cx >= 0 && cx < BAG_COLS && cy >= 0 && cy < BAG_ROWS) {
          cells[cy * BAG_COLS + cx] = true;
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
): boolean {
  if (w < 1 || h < 1 || x < 0 || y < 0) return false;
  if (x + w > BAG_COLS || y + h > BAG_ROWS) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (cells[(y + dy) * BAG_COLS + (x + dx)]) return false;
    }
  }
  return true;
}

/** First free w×h spot in row-major scan order (D2-style top-left packing). */
export function firstFit(
  cells: readonly boolean[],
  w: number,
  h: number,
): { x: number; y: number } | null {
  for (let y = 0; y <= BAG_ROWS - h; y++) {
    for (let x = 0; x <= BAG_COLS - w; x++) {
      if (canPlace(cells, w, h, x, y)) return { x, y };
    }
  }
  return null;
}

/** firstFit convenience on anchors: where would `item` land, if anywhere. */
export function firstFitFor(
  anchors: readonly BagAnchor[],
  item: Readonly<ItemInstance>,
): { x: number; y: number } | null {
  const { w, h } = itemFootprint(item);
  return firstFit(occupancy(anchors), w, h);
}

/** Coarse "any space left" probe (a 1×1 fit) — loot magnet gating. */
export function hasFreeCell(anchors: readonly BagAnchor[]): boolean {
  return occupancy(anchors).some((c) => !c);
}

/** Count of occupied cells (bag-title "used/total" display). */
export function occupiedCellCount(anchors: readonly BagAnchor[]): number {
  return occupancy(anchors).filter(Boolean).length;
}
