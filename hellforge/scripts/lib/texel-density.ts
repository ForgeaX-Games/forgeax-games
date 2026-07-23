// Texel-density helpers for kit mechanical gate.
//
// Formula (per triangle, albedo texture W×H px):
//   worldArea = 0.5 * ||(P1−P0) × (P2−P0)||          (m²)
//   uvArea    = 0.5 * |(U1−U0)×(U2−U0)|               (UV², 2D cross)
//   density   = sqrt( (W * H * uvArea) / worldArea )  (px/m)
// Module density = world-area-weighted mean of triangle densities.
// Degenerate world/UV area → skip (null / not counted).

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export type DensitySample = {
  readonly densityPxPerM: number;
  readonly worldAreaM2: number;
};

const AREA_EPS = 1e-12;

function crossLen(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.hypot(cx, cy, cz);
}

/** Triangle texel density in px/m, or null if degenerate. */
export function triangleTexelDensityPxPerM(
  p0: Vec3, p1: Vec3, p2: Vec3,
  u0: Vec2, u1: Vec2, u2: Vec2,
  texW: number, texH: number,
): number | null {
  const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
  const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
  const worldArea = 0.5 * crossLen(e1x, e1y, e1z, e2x, e2y, e2z);
  if (worldArea < AREA_EPS) return null;

  const du1 = u1[0] - u0[0], dv1 = u1[1] - u0[1];
  const du2 = u2[0] - u0[0], dv2 = u2[1] - u0[1];
  const uvArea = 0.5 * Math.abs(du1 * dv2 - du2 * dv1);
  if (uvArea < AREA_EPS) return null;

  return Math.sqrt((texW * texH * uvArea) / worldArea);
}

/** Area-weighted mean density, or null if no samples. */
export function weightedMeanDensity(samples: readonly DensitySample[]): number | null {
  let areaSum = 0;
  let weighted = 0;
  for (const s of samples) {
    if (!(s.worldAreaM2 > 0) || !Number.isFinite(s.densityPxPerM)) continue;
    areaSum += s.worldAreaM2;
    weighted += s.densityPxPerM * s.worldAreaM2;
  }
  if (areaSum < AREA_EPS) return null;
  return weighted / areaSum;
}
