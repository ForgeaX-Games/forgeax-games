/**
 * Blocker-vs-prop consistency — pure helpers for camp/wild spatial drift checks.
 *
 * Camp compares authored obstacle AABBs to visual pack entity footprints
 * (unit-cube mesh bounds × transform; no per-mesh AABB in .meta.json today).
 * Camp is the hard L2 gate for PR1.
 *
 * Wild (ashen-reach) is **layout-internal only by design for PR1** — there is
 * no companion scene pack / prop set to match against. Validators check
 * blocker well-formedness, route clear of blockers, and landmarks near decor
 * markers only. Do not invent wild prop AABBs until a pack lands.
 */

import { blockerIdFromEntityName } from './camera-fade';

/** XZ axis-aligned rectangle (world metres). */
export type XzAabb = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type ConsistencyTolerance = {
  /** Max XZ distance between blocker and prop AABB centers (metres). */
  readonly maxCenterDelta: number;
  /** Max absolute difference per footprint axis (metres). */
  readonly maxExtentDelta: number;
};

/** Documented default — camp tip content fits with unit-cube authored boxes. */
export const DEFAULT_TOLERANCE: ConsistencyTolerance = {
  maxCenterDelta: 0.75,
  maxExtentDelta: 1.25,
};

/** Landmark must have a decor marker within this XZ distance (metres). */
export const WILD_LANDMARK_DECOR_MAX_DIST = 3;

/** Explicit name aliases when pack labels diverge from obstacle labels. */
const LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  GateColumns: ['GateColumnL'],
  GateColumnsR: ['GateColumnR'],
  CampfireRing: ['CampfireBase', 'CampfireLog'],
};

export type CompareResult = {
  readonly ok: boolean;
  readonly centerDelta: number;
  readonly extentDeltaX: number;
  readonly extentDeltaZ: number;
  readonly reasons: readonly string[];
};

export type PackEntityTransform = {
  readonly name: string;
  readonly pos: readonly [number, number, number];
  readonly quat: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
};

export type WildLayoutDoc = {
  readonly version?: number;
  readonly route?: ReadonlyArray<{ readonly id: string; readonly pos: readonly [number, number] }>;
  readonly blockers?: ReadonlyArray<WildBlocker>;
  readonly landmarks?: ReadonlyArray<{ readonly id: string; readonly pos: readonly [number, number] }>;
  readonly decorMarkers?: ReadonlyArray<{ readonly id: string; readonly pos: readonly [number, number] }>;
};

export type WildBlocker =
  | {
      readonly type: 'aabb';
      readonly label?: string;
      readonly min: readonly [number, number];
      readonly max: readonly [number, number];
    }
  | {
      readonly type: 'polygon';
      readonly label?: string;
      readonly points: ReadonlyArray<readonly [number, number]>;
    };

export function xzAabbFromMinMax(
  min: readonly [number, number],
  max: readonly [number, number],
): XzAabb {
  return {
    minX: Math.min(min[0], max[0]),
    maxX: Math.max(min[0], max[0]),
    minZ: Math.min(min[1], max[1]),
    maxZ: Math.max(min[1], max[1]),
  };
}

export function xzAabbFromPolygon(
  points: ReadonlyArray<readonly [number, number]>,
): XzAabb | null {
  if (points.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]!);
    maxX = Math.max(maxX, p[0]!);
    minZ = Math.min(minZ, p[1]!);
    maxZ = Math.max(maxZ, p[1]!);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ };
}

export function unionXzAabbs(boxes: readonly XzAabb[]): XzAabb | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  return { minX, maxX, minZ, maxZ };
}

function quatRotate(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/**
 * World XZ AABB of a unit cube (−0.5…0.5) under pos/quat/scale.
 * Used when mesh bounds are unavailable in asset meta (current camp props).
 */
export function unitCubeWorldXzAabb(
  pos: readonly [number, number, number],
  quat: readonly [number, number, number, number],
  scale: readonly [number, number, number],
): XzAabb {
  const hx = scale[0]! * 0.5;
  const hy = scale[1]! * 0.5;
  const hz = scale[2]! * 0.5;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const x of [-hx, hx]) {
    for (const y of [-hy, hy]) {
      for (const z of [-hz, hz]) {
        const [wx, , wz] = quatRotate(quat, [x, y, z]);
        const px = wx + pos[0]!;
        const pz = wz + pos[2]!;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minZ = Math.min(minZ, pz);
        maxZ = Math.max(maxZ, pz);
      }
    }
  }
  return { minX, maxX, minZ, maxZ };
}

export function xzAabbCenter(box: XzAabb): { x: number; z: number } {
  return {
    x: (box.minX + box.maxX) * 0.5,
    z: (box.minZ + box.maxZ) * 0.5,
  };
}

export function compareXzAabbs(
  blocker: XzAabb,
  prop: XzAabb,
  tol: ConsistencyTolerance = DEFAULT_TOLERANCE,
): CompareResult {
  const bc = xzAabbCenter(blocker);
  const pc = xzAabbCenter(prop);
  const centerDelta = Math.hypot(pc.x - bc.x, pc.z - bc.z);
  const extentDeltaX = Math.abs((prop.maxX - prop.minX) - (blocker.maxX - blocker.minX));
  const extentDeltaZ = Math.abs((prop.maxZ - prop.minZ) - (blocker.maxZ - blocker.minZ));
  const reasons: string[] = [];
  if (centerDelta > tol.maxCenterDelta) {
    reasons.push(`center Δ=${centerDelta.toFixed(3)}m > ${tol.maxCenterDelta}m`);
  }
  if (extentDeltaX > tol.maxExtentDelta) {
    reasons.push(`extentX Δ=${extentDeltaX.toFixed(3)}m > ${tol.maxExtentDelta}m`);
  }
  if (extentDeltaZ > tol.maxExtentDelta) {
    reasons.push(`extentZ Δ=${extentDeltaZ.toFixed(3)}m > ${tol.maxExtentDelta}m`);
  }
  return {
    ok: reasons.length === 0,
    centerDelta,
    extentDeltaX,
    extentDeltaZ,
    reasons,
  };
}

function entityBaseName(name: string): string {
  return name.split('__')[0] ?? name;
}

/**
 * Map a pack entity Name onto an obstacle/layout blocker label.
 * Reuses fade's prefix rule, then digit-suffix (FenceW1) and aliases.
 */
export function matchEntityToBlockerLabel(
  name: string,
  labels: readonly string[],
): string | null {
  if (/Glow$/i.test(name) || /^Torch/i.test(name)) return null;

  const direct = blockerIdFromEntityName(name, labels);
  if (direct) return direct;

  const base = entityBaseName(name);
  for (const label of labels) {
    if (base === label) return label;
    if (
      base.startsWith(label)
      && (base.length === label.length || /^\d/.test(base.slice(label.length)))
    ) {
      return label;
    }
  }

  for (const label of labels) {
    const aliases = LABEL_ALIASES[label];
    if (!aliases) continue;
    for (const alias of aliases) {
      if (name === alias || base === alias || name.startsWith(`${alias}_`) || base.startsWith(alias)) {
        return label;
      }
    }
  }
  return null;
}

export type CampPairResult = {
  readonly label: string;
  readonly ok: boolean;
  readonly missingProps: boolean;
  readonly compare?: CompareResult;
  readonly propCount: number;
};

/** Build prop unions per blocker label and compare to authored obstacle AABBs. */
export function compareCampBlockersToProps(
  blockers: ReadonlyArray<{
    readonly type: string;
    readonly label?: string;
    readonly min?: readonly [number, number];
    readonly max?: readonly [number, number];
  }>,
  entities: readonly PackEntityTransform[],
  tol: ConsistencyTolerance = DEFAULT_TOLERANCE,
): CampPairResult[] {
  const aabbBlockers = blockers.filter(
    (b): b is { type: 'aabb'; label: string; min: readonly [number, number]; max: readonly [number, number] } =>
      b.type === 'aabb'
      && typeof b.label === 'string'
      && Array.isArray(b.min)
      && Array.isArray(b.max),
  );
  const labels = aabbBlockers.map((b) => b.label);
  const boxesByLabel = new Map<string, XzAabb[]>();
  for (const e of entities) {
    const id = matchEntityToBlockerLabel(e.name, labels);
    if (!id) continue;
    const box = unitCubeWorldXzAabb(e.pos, e.quat, e.scale);
    const list = boxesByLabel.get(id);
    if (list) list.push(box);
    else boxesByLabel.set(id, [box]);
  }

  const out: CampPairResult[] = [];
  for (const b of aabbBlockers) {
    const propBoxes = boxesByLabel.get(b.label) ?? [];
    if (propBoxes.length === 0) {
      out.push({
        label: b.label,
        ok: false,
        missingProps: true,
        propCount: 0,
      });
      continue;
    }
    const propUnion = unionXzAabbs(propBoxes)!;
    const blockerBox = xzAabbFromMinMax(b.min, b.max);
    const compare = compareXzAabbs(blockerBox, propUnion, tol);
    out.push({
      label: b.label,
      ok: compare.ok,
      missingProps: false,
      compare,
      propCount: propBoxes.length,
    });
  }
  return out;
}

function pointInXzAabb(pos: readonly [number, number], box: XzAabb): boolean {
  return (
    pos[0]! >= box.minX
    && pos[0]! <= box.maxX
    && pos[1]! >= box.minZ
    && pos[1]! <= box.maxZ
  );
}

/** Ray-crossing point-in-polygon on XZ (pos = [x,z]). */
function pointInPolygon(
  pos: readonly [number, number],
  points: ReadonlyArray<readonly [number, number]>,
): boolean {
  const x = pos[0]!;
  const z = pos[1]!;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]![0]!;
    const zi = points[i]![1]!;
    const xj = points[j]![0]!;
    const zj = points[j]![1]!;
    const intersect =
      (zi > z) !== (zj > z)
      && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function xzDist(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

/**
 * Layout-only wild checks (no ashen-reach.pack.json today).
 * Stance: do not invent prop AABBs — verify blockers/route/landmark↔decor.
 */
export function validateWildLayoutInternal(layout: WildLayoutDoc): string[] {
  const violations: string[] = [];
  const blockers = layout.blockers ?? [];
  if (blockers.length === 0) {
    violations.push('wild: no blockers authored');
  }

  for (const b of blockers) {
    const label = b.label ?? '(unnamed)';
    if (b.type === 'aabb') {
      const box = xzAabbFromMinMax(b.min, b.max);
      if (box.maxX - box.minX < 1e-6 || box.maxZ - box.minZ < 1e-6) {
        violations.push(`wild blocker ${label}: degenerate aabb`);
      }
    } else if (b.type === 'polygon') {
      if (!b.points || b.points.length < 3) {
        violations.push(`wild blocker ${label}: polygon needs ≥3 points`);
      } else if (!xzAabbFromPolygon(b.points)) {
        violations.push(`wild blocker ${label}: invalid polygon`);
      }
    } else {
      violations.push(`wild blocker ${label}: unknown type`);
    }
  }

  for (const r of layout.route ?? []) {
    for (const b of blockers) {
      const label = b.label ?? '(unnamed)';
      if (b.type === 'aabb') {
        if (pointInXzAabb(r.pos, xzAabbFromMinMax(b.min, b.max))) {
          violations.push(`wild route ${r.id} inside blocker ${label}`);
        }
      } else if (b.type === 'polygon' && b.points.length >= 3) {
        if (pointInPolygon(r.pos, b.points)) {
          violations.push(`wild route ${r.id} inside blocker ${label}`);
        }
      }
    }
  }

  const decor = layout.decorMarkers ?? [];
  for (const lm of layout.landmarks ?? []) {
    let best = Infinity;
    for (const d of decor) {
      best = Math.min(best, xzDist(lm.pos, d.pos));
    }
    if (decor.length === 0 || best > WILD_LANDMARK_DECOR_MAX_DIST) {
      violations.push(
        `wild landmark ${lm.id}: no decor within ${WILD_LANDMARK_DECOR_MAX_DIST}m`
          + (Number.isFinite(best) ? ` (nearest ${best.toFixed(2)}m)` : ''),
      );
    }
  }

  return violations;
}

export type AllowlistEntry = {
  readonly scene: 'camp' | 'wild';
  readonly label: string;
  readonly reason: string;
};

export function isAllowlisted(
  entries: readonly AllowlistEntry[],
  scene: 'camp' | 'wild',
  label: string,
): AllowlistEntry | undefined {
  return entries.find((e) => e.scene === scene && e.label === label);
}
