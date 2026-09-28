export type CombatWalkable = (x: number, z: number) => boolean;

/** Sweep the whole segment, not just its end, so a slow frame cannot skip a wall. */
export function firstCombatBlock(
  x0: number, z0: number, x1: number, z1: number, walkable: CombatWalkable,
): [number, number] | null {
  const dx = x1 - x0, dz = z1 - z0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + dx * i / steps, z = z0 + dz * i / steps;
    if (!walkable(x, z)) return [x, z];
  }
  return null;
}
