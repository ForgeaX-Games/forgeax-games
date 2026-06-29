/** Tile color index 0..4 */
export const NUM_COLORS = 5;
export const NUM_PLAYERS = 4;
export const FACTORY_COUNT = 9;
export const WALL_ROWS = 5;
export const WALL_COLS = 5;
export const TILES_PER_COLOR = 20;
/** Human sits at bottom-right quadrant (player index 3) */
export const HUMAN_PLAYER = 3;

/** Pattern row capacities top → bottom */
export const ROW_CAPACITIES = [1, 2, 3, 4, 5] as const;

/**
 * Wall color at [row][col] — same for every player.
 * Row r, column c holds color WALL_PATTERN[r][c].
 */
export const WALL_PATTERN: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4],
  [4, 0, 1, 2, 3],
  [3, 4, 0, 1, 2],
  [2, 3, 4, 0, 1],
  [1, 2, 3, 4, 0],
];

export const COLOR_INFO = [
  { name: '蓝', hex: '#3b82f6', dark: '#1d4ed8' },
  { name: '黄', hex: '#eab308', dark: '#a16207' },
  { name: '红', hex: '#ef4444', dark: '#b91c1c' },
  { name: '黑', hex: '#374151', dark: '#111827' },
  { name: '白', hex: '#f8fafc', dark: '#cbd5e1' },
] as const;

/** Visible floor slots on player board */
export const FLOOR_SLOT_COUNT = 7;

/** Per-slot marginal penalty (1st slot, 2nd slot, …) — design SSOT */
export const FLOOR_MARGINAL_PENALTIES = [1, 1, 2, 2, 3, 3, 3] as const;

/** Marginal penalty for floor slot index (0-based); slots 8+ follow extended pattern */
export function floorSlotMarginalPenalty(slotIndex: number): number {
  if (slotIndex < FLOOR_MARGINAL_PENALTIES.length) {
    return FLOOR_MARGINAL_PENALTIES[slotIndex]!;
  }
  const extended = [4, 4, 5, 5, 5, 6, 6, 6];
  const idx = slotIndex - FLOOR_MARGINAL_PENALTIES.length;
  return extended[Math.min(idx, extended.length - 1)] ?? 6;
}

/** Total floor penalty for `count` tiles (+1 marker counts as one tile) */
export function floorCumulativePenalty(count: number): number {
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += floorSlotMarginalPenalty(i);
  return -sum;
}

/** @deprecated alias — use floorCumulativePenalty */
export function floorPenalty(count: number): number {
  return floorCumulativePenalty(count);
}

export const ENDGAME_ROW_BONUS = 2;
export const ENDGAME_COL_BONUS = 7;
export const ENDGAME_COLOR_BONUS = 10;
