/** D2-ish gentle exponential: L1→2 needs 60, then ×1.45 per level. */
export function xpForLevel(level: number): number {
  return Math.floor(60 * Math.pow(1.45, level - 1));
}
