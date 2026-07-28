/**
 * Orientation SSOT — distilled from claude-fable-5-93 ToyKart / Props / Track.
 *
 * DO NOT sprinkle ±π/2 or ±π elsewhere. Import from here only.
 *
 * Three race kart (ToyKart): local +Z = nose / travel.
 * ForgeaX drive root: local −Z = travel (engine / camera convention).
 * Bridge: ForgeaXYaw = plusZHeading + π  (== plusZHeadingToNegZYaw).
 *
 * ToyKart mesh under a ChildOf visual uses MESH_PLUS_Z_TO_FORGEAX_YAW once
 * so mesh +Z aligns with parent −Z.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Original ToyKart seat (mesh / visual local space). */
export const TOYKART_SEAT: readonly [number, number, number] = [0, 0.55, -0.25];

/** Steering wheel offset relative to seat (original addCockpit defaults). */
export const TOYKART_STEER_OFFSET: readonly [number, number, number] = [0, 0.75, 0.66];

/**
 * Yaw applied on Kart*Visual (ChildOf drive root) when the mesh nose is +Z.
 * Maps mesh +Z → parent −Z.
 */
export const MESH_PLUS_Z_TO_FORGEAX_YAW = Math.PI;

/** Track tangent heading with +Z-forward model convention (original). */
export function headingFromTangent(tan: Vec3): number {
  return Math.atan2(tan.x, tan.z);
}

/** ForgeaX local −Z forward for a yaw around Y. */
export function forwardNegZ(yaw: number): Vec3 {
  return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

/** Convert +Z heading (original) → ForgeaX −Z yaw (same world forward). */
export function plusZHeadingToNegZYaw(heading: number): number {
  return heading + Math.PI;
}

/**
 * Three.js Object3D.lookAt: local −Z faces the target.
 * Given prop world xz and a track-facing target xz, yaw around Y for ForgeaX
 * (same numeric convention as Three Y-up when only yaw matters).
 */
export function propYawLookAtNegZ(
  propX: number,
  propZ: number,
  targetX: number,
  targetZ: number,
): number {
  return Math.atan2(targetX - propX, targetZ - propZ);
}
