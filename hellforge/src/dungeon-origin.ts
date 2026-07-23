/** Den / PCG dungeon world offset — beyond the camp camera far plane. */
export const DUNGEON_ORIGIN = { x: 300, z: 300 };

/** Den mountain-ring centre — map centre, not the +x/+z corner (PR 0 bugfix). */
export function denMountainRingOrigin(): { x: number; z: number } {
  return { x: DUNGEON_ORIGIN.x, z: DUNGEON_ORIGIN.z };
}
