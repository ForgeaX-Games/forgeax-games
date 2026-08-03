/**
 * Minimal closed-loop track sampler (mirrors src/track-data.ts) for bake/build scripts.
 */
const TRACK_MODULES = [
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
const TRACK_START = { x: 86, z: -45.5 };
const TENSION = 0.35;

function walkModules(mods, cx, cz) {
  let x = cx;
  let z = cz;
  let h = 0;
  let y = 0;
  const pts = [{ x, y, z }];
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

function catmull(pts, t) {
  const n = pts.length;
  const u = ((t % 1) + 1) % 1;
  const ft = u * n;
  const i1 = Math.floor(ft) % n;
  const i0 = (i1 - 1 + n) % n;
  const i2 = (i1 + 1) % n;
  const i3 = (i1 + 2) % n;
  const localT = ft - Math.floor(ft);
  const s = (1 - TENSION) / 2;
  const p0 = pts[i0];
  const p1 = pts[i1];
  const p2 = pts[i2];
  const p3 = pts[i3];
  const t2 = localT * localT;
  const t3 = t2 * localT;
  const mix = (a, b, c, d) =>
    a * (-s * t3 + 2 * s * t2 - s * localT) +
    b * ((2 - s) * t3 + (s - 3) * t2 + 1) +
    c * ((s - 2) * t3 + (3 - 2 * s) * t2 + s * localT) +
    d * (s * t3 - s * t2);
  return {
    x: mix(p0.x, p1.x, p2.x, p3.x),
    y: mix(p0.y, p1.y, p2.y, p3.y),
    z: mix(p0.z, p1.z, p2.z, p3.z),
  };
}

const controlPoints = walkModules(TRACK_MODULES, TRACK_START.x, TRACK_START.z);

export function pointAt(t) {
  return catmull(controlPoints, t);
}

export function sideAt(t) {
  const a = catmull(controlPoints, t - 0.0005);
  const b = catmull(controlPoints, t + 0.0005);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  // side = perpendicular to tangent in XZ
  return { x: -dz / len, y: 0, z: dx / len };
}

/** Sample roadside world positions along the loop. */
export function roadsideSamples({ step = 0.012, lats = [10.4, -10.4] } = {}) {
  const out = [];
  for (let t = 0.01; t < 0.995; t += step) {
    const p = pointAt(t);
    const s = sideAt(t);
    for (const lat of lats) {
      out.push({
        t,
        x: p.x + s.x * lat,
        y: Math.max(0, p.y),
        z: p.z + s.z * lat,
        lat,
      });
    }
  }
  return out;
}
