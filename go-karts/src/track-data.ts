/**
 * Closed-loop track math ported from claude-fable-5-93 Track.ts.
 * Single source of truth for baking and runtime driving.
 */

export type TrackModule =
  | { k: 's'; len: number; dy?: number }
  | { k: 't'; a: number; r: number; dy?: number };

/** ~668 m loop, roadWidth 14. Start chosen so centroid stays near origin. */
export const TRACK_MODULES: readonly TrackModule[] = [
  { k: 's', len: 120.1 },
  { k: 't', a: -90, r: 39.2 },
  { k: 's', len: 56, dy: 2.6 },
  { k: 't', a: -90, r: 39.2 },
  { k: 's', len: 28 },
  { k: 't', a: 60, r: 28 },
  { k: 's', len: 22.4, dy: -2.6 },
  { k: 't', a: -60, r: 28 },
  { k: 's', len: 33.6 },
  { k: 't', a: -90, r: 39.2 },
  { k: 's', len: 102.8 },
  { k: 't', a: -90, r: 39.2 },
];

export const ROAD_WIDTH = 14;
export const TRACK_START = { x: 86, z: -45.5 } as const;
export const CATMULL_TENSION = 0.35;
export const SPAWN_T = 0.004;
export const SPAWN_LATERAL = -2.6;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function moduleLengths(mods: readonly TrackModule[]): { lens: number[]; total: number } {
  const lens = mods.map((m) =>
    m.k === 's' ? m.len : (Math.abs(m.a) * Math.PI) / 180 * m.r,
  );
  return { lens, total: lens.reduce((a, b) => a + b, 0) };
}

export function moduleTRange(i: number): [number, number] {
  const { lens, total } = moduleLengths(TRACK_MODULES);
  const before = lens.slice(0, i).reduce((a, b) => a + b, 0);
  return [before / total, (before + lens[i]!) / total];
}

export function corridorTRange(): [number, number] {
  const { lens, total } = moduleLengths(TRACK_MODULES);
  const before = lens.slice(0, 9).reduce((a, b) => a + b, 0);
  return [before / total, (before + lens[9]! - 1.2) / total];
}

function walkModules(mods: readonly TrackModule[], cx: number, cz: number): Vec3[] {
  let x = cx;
  let z = cz;
  let h = 0;
  let y = 0;
  const pts: Vec3[] = [{ x, y, z }];
  for (const m of mods) {
    if (m.k === 's') {
      const steps = Math.max(1, Math.round(m.len / 7));
      for (let i = 0; i < steps; i++) {
        x += Math.sin(h) * (m.len / steps);
        z += Math.cos(h) * (m.len / steps);
        y += (m.dy || 0) / steps;
        pts.push({ x, y, z });
      }
    } else {
      const ang = (m.a * Math.PI) / 180;
      const arc = Math.abs(ang) * m.r;
      const steps = Math.max(2, Math.round(arc / 7));
      for (let i = 0; i < steps; i++) {
        h += ang / steps;
        x += Math.sin(h) * (arc / steps);
        z += Math.cos(h) * (arc / steps);
        y += (m.dy || 0) / steps;
        pts.push({ x, y, z });
      }
    }
  }
  pts.pop();
  return pts;
}

/** Catmull-Rom closed curve sample (matches THREE.CatmullRomCurve3 tension). */
function catmullRomPoint(pts: readonly Vec3[], t: number, tension: number): Vec3 {
  const n = pts.length;
  const u = ((t % 1) + 1) % 1;
  const ft = u * n;
  const i1 = Math.floor(ft) % n;
  const i0 = (i1 - 1 + n) % n;
  const i2 = (i1 + 1) % n;
  const i3 = (i1 + 2) % n;
  const localT = ft - Math.floor(ft);
  const s = (1 - tension) / 2;
  const p0 = pts[i0]!;
  const p1 = pts[i1]!;
  const p2 = pts[i2]!;
  const p3 = pts[i3]!;
  const t2 = localT * localT;
  const t3 = t2 * localT;
  const interpolate = (a: number, b: number, c: number, d: number) =>
    a * (-s * t3 + 2 * s * t2 - s * localT) +
    b * ((2 - s) * t3 + (s - 3) * t2 + 1) +
    c * ((s - 2) * t3 + (3 - 2 * s) * t2 + s * localT) +
    d * (s * t3 - s * t2);
  return {
    x: interpolate(p0.x, p1.x, p2.x, p3.x),
    y: interpolate(p0.y, p1.y, p2.y, p3.y),
    z: interpolate(p0.z, p1.z, p2.z, p3.z),
  };
}

function catmullRomTangent(pts: readonly Vec3[], t: number, tension: number): Vec3 {
  const e = 0.0005;
  const a = catmullRomPoint(pts, t - e, tension);
  const b = catmullRomPoint(pts, t + e, tension);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

export interface TrackCurve {
  readonly length: number;
  readonly roadWidth: number;
  readonly controlPoints: readonly Vec3[];
  readonly mapPoints: readonly { x: number; z: number }[];
  pointAt(t: number): Vec3;
  heightAt(t: number): number;
  tangentAt(t: number): Vec3;
  sideAt(t: number): Vec3;
  nearestInfo(p: Vec3): { t: number; dist: number };
  signedCurvature(t: number): number;
  boundaryLat(t: number): number;
  readonly corrT0: number;
  readonly corrT1: number;
  readonly centroid: Vec3;
}

export function createTrackCurve(): TrackCurve {
  const controlPoints = walkModules(TRACK_MODULES, TRACK_START.x, TRACK_START.z);
  const SAMPLES = 1024;
  const samplePts: Vec3[] = [];
  let length = 0;
  for (let i = 0; i < SAMPLES; i++) {
    samplePts.push(catmullRomPoint(controlPoints, i / SAMPLES, CATMULL_TENSION));
  }
  for (let i = 0; i < SAMPLES; i++) {
    const a = samplePts[i]!;
    const b = samplePts[(i + 1) % SAMPLES]!;
    length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  const mapPoints: { x: number; z: number }[] = [];
  for (let i = 0; i < 192; i++) {
    const p = catmullRomPoint(controlPoints, i / 192, CATMULL_TENSION);
    mapPoints.push({ x: p.x, z: p.z });
  }

  const [corrT0, corrT1] = corridorTRange();

  const centroid = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 64; i++) {
    const p = catmullRomPoint(controlPoints, i / 64, CATMULL_TENSION);
    centroid.x += p.x;
    centroid.z += p.z;
  }
  centroid.x /= 64;
  centroid.z /= 64;

  const pointAt = (t: number): Vec3 =>
    catmullRomPoint(controlPoints, ((t % 1) + 1) % 1, CATMULL_TENSION);

  const tangentAt = (t: number): Vec3 => {
    const tan = catmullRomTangent(controlPoints, ((t % 1) + 1) % 1, CATMULL_TENSION);
    const len = Math.hypot(tan.x, tan.z) || 1;
    return { x: tan.x / len, y: 0, z: tan.z / len };
  };

  const sideAt = (t: number): Vec3 => {
    const tan = tangentAt(t);
    return { x: -tan.z, y: 0, z: tan.x };
  };

  const nearestInfo = (p: Vec3): { t: number; dist: number } => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      const s = samplePts[i]!;
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { t: best / SAMPLES, dist: Math.sqrt(bd) };
  };

  const signedCurvature = (t: number): number => {
    const e = 0.004;
    const t1 = ((t - e) % 1 + 1) % 1;
    const t2 = (t + e) % 1;
    const a = tangentAt(t1);
    const b = tangentAt(t2);
    const d = { x: b.x - a.x, y: 0, z: b.z - a.z };
    const side = sideAt(t);
    return (side.x * d.x + side.z * d.z) / (2 * e * length);
  };

  const boundaryLat = (t: number): number => {
    const blend = 0.012;
    if (t >= corrT0 && t <= corrT1) return 9.55;
    if (t > corrT0 - blend && t < corrT0) {
      const u = (t - (corrT0 - blend)) / blend;
      return 7.45 + (9.55 - 7.45) * u;
    }
    if (t > corrT1 && t < corrT1 + blend) {
      const u = (t - corrT1) / blend;
      return 9.55 + (7.45 - 9.55) * u;
    }
    return 7.45;
  };

  return {
    length,
    roadWidth: ROAD_WIDTH,
    controlPoints,
    mapPoints,
    pointAt,
    heightAt: (t) => pointAt(t).y,
    tangentAt,
    sideAt,
    nearestInfo,
    signedCurvature,
    boundaryLat,
    corrT0,
    corrT1,
    centroid,
  };
}

/** Heading that faces along track tangent using +Z model convention (original). */
export { headingFromTangent, forwardNegZ, plusZHeadingToNegZYaw } from './orientation';
export type { Vec3 as OrientVec3 } from './orientation';
