import { describe, expect, test } from 'bun:test';
import {
  BAG_CELLS,
  BAG_COLS,
  BAG_ROWS,
  canPlace,
  firstFit,
  firstFitFor,
  hasFreeCell,
  occupancy,
  occupiedCellCount,
  type BagAnchor,
} from './bag-grid';
import type { ItemInstance, ItemSize, ItemSlot } from './items';

function stub(slot: ItemSlot, id: string, size?: ItemSize): ItemInstance {
  return {
    instanceId: id,
    slot,
    rarity: 'common',
    name: id,
    ilvl: 1,
    reqLevel: 1,
    affixes: [],
    score: 0,
    ...(size ? { size } : {}),
  };
}

function anchor(slot: ItemSlot, id: string, x: number, y: number, size?: ItemSize): BagAnchor {
  return { item: stub(slot, id, size), x, y };
}

describe('grid constants', () => {
  test('12×5 = 60 cells (legacy BAG_SIZE parity)', () => {
    expect(BAG_COLS).toBe(12);
    expect(BAG_ROWS).toBe(5);
    expect(BAG_CELLS).toBe(60);
  });
});

describe('occupancy', () => {
  test('derives covered cells from anchors + footprints (no stored markers)', () => {
    const cells = occupancy([anchor('armor', 'a', 1, 1)]); // 2×3 at (1,1)
    expect(cells.filter(Boolean)).toHaveLength(6);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]] as const) {
      expect(cells[y * BAG_COLS + x]).toBe(true);
    }
    expect(cells[0]).toBe(false);
    expect(cells[4 * BAG_COLS + 3]).toBe(false);
  });

  test('explicit item.size overrides the slot default', () => {
    const cells = occupancy([anchor('ring', 'big-ring', 0, 0, { w: 2, h: 2 })]);
    expect(cells.filter(Boolean)).toHaveLength(4);
  });
});

describe('canPlace', () => {
  test('bounds: rejects overflow on every edge', () => {
    const cells = new Array<boolean>(BAG_CELLS).fill(false);
    expect(canPlace(cells, 1, 1, 0, 0)).toBe(true);
    expect(canPlace(cells, 1, 1, BAG_COLS - 1, BAG_ROWS - 1)).toBe(true);
    expect(canPlace(cells, 2, 1, BAG_COLS - 1, 0)).toBe(false); // wide over right edge
    expect(canPlace(cells, 1, 3, 0, BAG_ROWS - 2)).toBe(false); // tall over bottom edge
    expect(canPlace(cells, 1, 1, -1, 0)).toBe(false);
    expect(canPlace(cells, 1, 1, 0, -1)).toBe(false);
    expect(canPlace(cells, 0, 1, 0, 0)).toBe(false);
  });

  test('overlap: rejects cells already covered', () => {
    const cells = occupancy([anchor('helm', 'h', 0, 0)]); // 2×2 at origin
    expect(canPlace(cells, 1, 1, 1, 1)).toBe(false);
    expect(canPlace(cells, 1, 1, 2, 0)).toBe(true);
    expect(canPlace(cells, 2, 2, 1, 1)).toBe(false); // partial overlap still blocked
  });
});

describe('firstFit', () => {
  test('row-major scan: packs top-left first', () => {
    const cells = new Array<boolean>(BAG_CELLS).fill(false);
    expect(firstFit(cells, 2, 3)).toEqual({ x: 0, y: 0 });
    const after = occupancy([anchor('armor', 'a', 0, 0)]);
    expect(firstFit(after, 2, 3)).toEqual({ x: 2, y: 0 });
  });

  test('skips gaps too small for the footprint', () => {
    // Fill everything except a 1-wide vertical strip at x=0.
    const anchors: BagAnchor[] = [];
    for (let y = 0; y < BAG_ROWS; y++) {
      for (let x = 1; x < BAG_COLS; x++) anchors.push(anchor('ring', `r${x}-${y}`, x, y));
    }
    const cells = occupancy(anchors);
    expect(firstFit(cells, 2, 2)).toBeNull(); // strip is only 1 wide
    expect(firstFit(cells, 1, 3)).toEqual({ x: 0, y: 0 }); // tall staff fits the strip
  });

  test('full grid → null', () => {
    const cells = new Array<boolean>(BAG_CELLS).fill(true);
    expect(firstFit(cells, 1, 1)).toBeNull();
  });
});

describe('firstFitFor / hasFreeCell / occupiedCellCount', () => {
  test('sixty 1×1 rings fill the bag exactly, then no fit remains', () => {
    const anchors: BagAnchor[] = [];
    for (let i = 0; i < BAG_CELLS; i++) {
      const fit = firstFitFor(anchors, stub('ring', `r${i}`));
      expect(fit).not.toBeNull();
      anchors.push({ item: stub('ring', `r${i}`), x: fit!.x, y: fit!.y });
    }
    expect(anchors).toHaveLength(60);
    expect(occupiedCellCount(anchors)).toBe(60);
    expect(hasFreeCell(anchors)).toBe(false);
    expect(firstFitFor(anchors, stub('ring', 'overflow'))).toBeNull();
  });

  test('footprint-aware: big items report no fit while 1×1 holes remain', () => {
    // Scatter 1×1 rings so only isolated single cells stay free.
    const anchors: BagAnchor[] = [
      anchor('ring', 'a', 0, 0), anchor('ring', 'b', 2, 0), anchor('ring', 'c', 4, 0),
      anchor('ring', 'd', 6, 0), anchor('ring', 'e', 8, 0), anchor('ring', 'f', 10, 0),
      anchor('ring', 'g', 1, 1), anchor('ring', 'h', 3, 1), anchor('ring', 'i', 5, 1),
      anchor('ring', 'j', 7, 1), anchor('ring', 'k', 9, 1), anchor('ring', 'l', 11, 1),
      anchor('armor', 'm', 0, 2), anchor('armor', 'n', 2, 2), anchor('armor', 'o', 4, 2),
      anchor('armor', 'p', 6, 2), anchor('armor', 'q', 8, 2), anchor('armor', 'r', 10, 2),
    ];
    expect(hasFreeCell(anchors)).toBe(true); // (1,0),(3,0),… single holes
    expect(firstFitFor(anchors, stub('armor', 'big'))).toBeNull(); // no 2×3 gap
    expect(firstFitFor(anchors, stub('ring', 'small'))).toEqual({ x: 1, y: 0 });
  });

  test('occupiedCellCount counts covered cells, not items', () => {
    const anchors = [anchor('armor', 'a', 0, 0), anchor('ring', 'b', 2, 0)];
    expect(occupiedCellCount(anchors)).toBe(7); // 6 + 1
  });
});
