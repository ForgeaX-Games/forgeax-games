import {
  ENDGAME_COL_BONUS,
  ENDGAME_COLOR_BONUS,
  ENDGAME_ROW_BONUS,
  floorSlotMarginalPenalty,
  floorCumulativePenalty,
  FLOOR_SLOT_COUNT,
  FLOOR_MARGINAL_PENALTIES,
} from './constants';

export {
  ENDGAME_COL_BONUS,
  ENDGAME_COLOR_BONUS,
  ENDGAME_ROW_BONUS,
  floorSlotMarginalPenalty,
  floorCumulativePenalty,
  FLOOR_SLOT_COUNT,
  FLOOR_MARGINAL_PENALTIES,
};

/** Marginal penalty label for floor slot index (0-based). */
export function floorSlotPenaltyLabel(slotIndex: number): string {
  return `-${floorSlotMarginalPenalty(slotIndex)}`;
}

/** Cumulative floor penalty labels for 1..n tiles. */
export function floorCumulativeLabels(maxCount = 7): { count: number; total: string }[] {
  const rows: { count: number; total: string }[] = [];
  for (let n = 1; n <= maxCount; n++) {
    rows.push({ count: n, total: String(floorCumulativePenalty(n)) });
  }
  return rows;
}
