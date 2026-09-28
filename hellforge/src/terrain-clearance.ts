/** X/Z bounds relative to a peak's origin, including its scale and lean. */
export type TerrainFootprint = readonly [minX: number, minZ: number, maxX: number, maxZ: number];

/** The orbit camera can reach 12 m beyond the playable floor. */
export const TERRAIN_CAMERA_CLEARANCE = 12;

export function transformedTerrainFootprint(
  aabb: ArrayLike<number>,
  rotation: readonly [number, number, number, number],
  scale: readonly [number, number, number],
): TerrainFootprint {
  const [qx, qy, qz, qw] = rotation;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  // Transform all eight corners: leaning a tall cone changes its footprint.
  for (let corner = 0; corner < 8; corner++) {
    const x = aabb[(corner & 1) ? 3 : 0]! * scale[0];
    const y = aabb[(corner & 2) ? 4 : 1]! * scale[1];
    const z = aabb[(corner & 4) ? 5 : 2]! * scale[2];
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    const rx = x + qw * tx + qy * tz - qz * ty;
    const rz = z + qw * tz + qx * ty - qy * tx;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
  }
  return [minX, minZ, maxX, maxZ];
}

/**
 * Move outward on the authored radial heading until the WHOLE mesh clears
 * the playable square and camera margin. Keep geometry, height and seed intact.
 * Separation on either X or Z suffices; requiring both needlessly loses peaks
 * on the horizon (and is impossible for an axis-aligned heading).
 */
export function clearTerrainFootprint(
  position: readonly [number, number],
  origin: readonly [number, number],
  half: number,
  footprint: TerrainFootprint,
  clearance = TERRAIN_CAMERA_CLEARANCE,
): [number, number] {
  const dx = position[0] - origin[0], dz = position[1] - origin[1];
  const radius = Math.hypot(dx, dz);
  const ux = radius > 0 ? dx / radius : 1;
  const uz = radius > 0 ? dz / radius : 0;
  const edge = half + clearance;
  const distanceForAxis = (u: number, min: number, max: number): number =>
    Math.abs(u) < 1e-8 ? Infinity : u > 0 ? (edge - min) / u : (edge + max) / -u;
  const required = Math.min(
    distanceForAxis(ux, footprint[0], footprint[2]),
    distanceForAxis(uz, footprint[1], footprint[3]),
  );
  if (required <= radius) return [position[0], position[1]];
  return [origin[0] + ux * required, origin[1] + uz * required];
}
