/** Separate thresholds avoid flickering when the player crosses the boundary. */
export function useFarEnemyLod(wasFar: boolean, distance: number): boolean {
  if (!Number.isFinite(distance) || distance < 0) return false;
  return wasFar ? distance > 18 : distance > 22;
}
