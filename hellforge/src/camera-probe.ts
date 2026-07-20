/**
 * Spring-arm camera probe — ray vs authored camp obstacle proxies (Spec §6.2).
 * Reuses the M1 2D obstacle source; optional probeHeight / probePad thicken
 * volumes for camera collision without changing navigation.
 */

export interface CameraProbe {
  maxDistance(
    origin: readonly [number, number, number],
    desiredEye: readonly [number, number, number],
    skin: number,
  ): number;
}

export type ProbeAabb = {
  readonly type: 'aabb';
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  readonly label?: string;
  /** World-Y height of the extruded volume (default 3.2). */
  readonly probeHeight?: number;
  /** Horizontal pad added to XZ extents before the ray test (default 0.12). */
  readonly probePad?: number;
};

export type ProbePolygon = {
  readonly type: 'polygon';
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly label?: string;
  readonly probeHeight?: number;
  readonly probePad?: number;
};

export type ProbeBlocker = ProbeAabb | ProbePolygon;

export type ProbeObstacleDoc = {
  readonly version: 1;
  readonly blockers: readonly ProbeBlocker[];
};

export const DEFAULT_PROBE_HEIGHT = 3.2;
export const DEFAULT_PROBE_PAD = 0.12;

type Box3 = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function aabbBox(b: ProbeAabb, defaultHeight: number, defaultPad: number): Box3 {
  const pad = b.probePad ?? defaultPad;
  const h = b.probeHeight ?? defaultHeight;
  const minX = Math.min(b.min[0], b.max[0]) - pad;
  const maxX = Math.max(b.min[0], b.max[0]) + pad;
  const minZ = Math.min(b.min[1], b.max[1]) - pad;
  const maxZ = Math.max(b.min[1], b.max[1]) + pad;
  return { minX, minY: 0, minZ, maxX, maxY: h, maxZ };
}

/** Axis-aligned bounds of a polygon (XZ), extruded on Y for probe tests. */
function polygonBox(b: ProbePolygon, defaultHeight: number, defaultPad: number): Box3 {
  const pad = b.probePad ?? defaultPad;
  const h = b.probeHeight ?? defaultHeight;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of b.points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  return {
    minX: minX - pad,
    minY: 0,
    minZ: minZ - pad,
    maxX: maxX + pad,
    maxY: h,
    maxZ: maxZ + pad,
  };
}

/** Ray (origin → origin+dir*len) vs AABB; returns hit t in [0,1] or null. */
export function rayAabbHitT(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  box: Box3,
): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: Array<[number, number, number, number]> = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
      continue;
    }
    const inv = 1 / d;
    let t0 = (mn - o) * inv;
    let t1 = (mx - o) * inv;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  if (tMin < 0 || tMin > 1) return null;
  return tMin;
}

export function createObstacleCameraProbe(
  blockers: readonly ProbeBlocker[],
  opts: { height?: number; pad?: number } = {},
): CameraProbe {
  const defaultHeight = opts.height ?? DEFAULT_PROBE_HEIGHT;
  const defaultPad = opts.pad ?? DEFAULT_PROBE_PAD;
  const boxes: Box3[] = [];
  for (const b of blockers) {
    if (b.type === 'aabb') boxes.push(aabbBox(b, defaultHeight, defaultPad));
    else boxes.push(polygonBox(b, defaultHeight, defaultPad));
  }

  return {
    maxDistance(origin, desiredEye, skin) {
      const dx = desiredEye[0]! - origin[0]!;
      const dy = desiredEye[1]! - origin[1]!;
      const dz = desiredEye[2]! - origin[2]!;
      const full = Math.hypot(dx, dy, dz);
      if (full < 1e-5) return 0;
      let hitT = 1;
      let hit = false;
      for (const box of boxes) {
        const t = rayAabbHitT(
          origin[0]!, origin[1]!, origin[2]!,
          dx, dy, dz,
          box,
        );
        if (t !== null && t < hitT) {
          hitT = t;
          hit = true;
        }
      }
      if (!hit) return full;
      return Math.max(0, hitT * full - Math.max(0, skin));
    },
  };
}
