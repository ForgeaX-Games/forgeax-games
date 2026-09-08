import { TERRAIN_ALBEDO_WINDOWS } from './terrain-calibration';
import {
  PS_REGIONS,
  TERRAIN_PLAN,
  type LandformOp,
  type PSRegion,
  type RegionTerrain,
} from './terrain-plan';

// Procedural planet surface, evaluated per PIXEL.
//
// WHY THIS REPLACES THE SHELLS
//
// The planet used to be five masked spheres stacked at increasing radii, each a
// flat colour, with maskedSphere keeping or dropping WHOLE triangles. That
// makes the coastline a polygon edge by construction: it can never be finer
// than one triangle, so every shore, every ice cap and every dry patch read as a
// hard staircase of pure colour. Raising the tessellation 72x48 -> 240x160 only
// shortened the steps; it could not remove them, and it cost 38k vertices per
// shell to do it. Side by side with the reference — soft painterly coasts, no
// two pixels of land quite the same colour — that was the single largest
// remaining artefact, larger than any lighting term.
//
// landField is analytic: six dot products against fixed centres plus two sine
// wobbles. Nothing about it needs a mesh. Evaluated in the fragment shader
// instead, the coastline is exact at pixel resolution and costs no vertices at
// all, and the same field can then drive sand, dry earth, ice and water depth as
// smooth blends rather than as separate geometry. Six draws collapse to one.
//
// THE CENTRES ARE GENERATED, NOT RETYPED
//
// The field exists in two languages — TS for gameplay (isLandAt, food and bot
// placement) and WGSL for shading — and if they ever disagree the snake swims
// through visible land. So the WGSL is EMITTED from the same TS constants below
// rather than hand-transcribed, and the loop is unrolled during emission because
// WGSL cannot index a const array with a runtime index.

export type V3 = [number, number, number];

const nrm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Continent seeds. Six of them, alternating threshold, as the original field. */
export const LAND_CENTERS: V3[] = [
  nrm([1, 0.2, 0.1]),
  nrm([-0.65, 0.45, 0.25]),
  nrm([0.1, -0.55, -0.8]),
  nrm([-0.2, -0.75, 0.45]),
  nrm([0.55, 0.55, -0.5]),
  nrm([-0.8, -0.15, -0.5]),
];

/** The authoritative land field. Gameplay reads this one. */
export function landField(p: V3): number {
  let v = -1;
  for (let i = 0; i < LAND_CENTERS.length; i++) {
    const c = LAND_CENTERS[i]!;
    const wobble =
      0.09 * Math.sin(p[0] * 11 + i * 2.1) + 0.07 * Math.sin(p[1] * 17 - p[2] * 9 + i);
    v = Math.max(v, p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + wobble - (i % 2 ? 0.69 : 0.64));
  }
  return v;
}

// ── CPU mirror of the shader's noise ─────────────────────────────────────────
//
// The relief field exists on both sides now: the shader uses it for ALBEDO (bare
// ridges, shaded valleys) and the CPU uses it to DISPLACE the sphere, so the two
// have to describe the same hills or the terrain would be coloured as if its
// mountains were somewhere else. These are line-for-line ports of the WGSL
// below; float64-vs-float32 drift is irrelevant because the field is smooth.

const fract = (x: number): number => x - Math.floor(x);

function hash3(x: number, y: number, z: number): number {
  let qx = fract(x * 0.1031);
  let qy = fract(y * 0.1031);
  let qz = fract(z * 0.1031);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d;
  qy += d;
  qz += d;
  return fract((qx + qy) * qz);
}

function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * ux;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * ux;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * ux;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

// Exported so the region classifier and its audit harness read the SAME noise
// the shader is mirroring, rather than keeping a second copy. A second copy is
// exactly how props ended up planted on painted water.
export function fbm(x: number, y: number, z: number): number {
  let s = 0, a = 0.5, qx = x, qy = y, qz = z;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(qx, qy, qz);
    qx *= 2.03; qy *= 2.03; qz *= 2.03;
    a *= 0.5;
  }
  return s;
}

export function ridge(x: number, y: number, z: number): number {
  let s = 0, a = 0.5, qx = x, qy = y, qz = z;
  for (let i = 0; i < 4; i++) {
    s += a * (1 - Math.abs(vnoise(qx, qy, qz) * 2 - 1));
    qx *= 2.11; qy *= 2.11; qz *= 2.11;
    a *= 0.5;
  }
  return s;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Region fields are terrain-independent. In particular, highland is a slow
// tectonic/continental-core field and never reads relief(), so region -> height
// has no cycle. The WGSL emitter below interpolates these same constants.
const REGION_FIELD = {
  ice: { lo: 0.905, hi: 0.975, frequency: 4.5, jitter: 0.10 },
  dry: { lo: 0.52, hi: 0.66, frequency: 3.2, offset: [11, 3, 7] as V3 },
  highland: {
    lo: 0.46,
    hi: 0.60,
    broadFrequency: 1.65,
    detailFrequency: 3.3,
    broadWeight: 0.72,
    offsetA: [23, 17, 31] as V3,
    offsetB: [5, 29, 13] as V3,
    coreLo: 0.02,
    coreHi: 0.14,
  },
  beach: { lo: 0.02, hi: 0.05 },
  land: { lo: 0, hi: 0.02 },
} as const;

/** Normalised soft masks m-tilde used by both scattering and terrain. */
export function regionWeights(p: V3): Record<PSRegion, number> {
  const wf = warpedField(p);
  const iceCap = smoothstep(
    REGION_FIELD.ice.lo,
    REGION_FIELD.ice.hi,
    Math.abs(p[1]) + (fbm(
      p[0] * REGION_FIELD.ice.frequency,
      p[1] * REGION_FIELD.ice.frequency,
      p[2] * REGION_FIELD.ice.frequency,
    ) - 0.5) * REGION_FIELD.ice.jitter,
  );
  const dry = smoothstep(
    REGION_FIELD.dry.lo,
    REGION_FIELD.dry.hi,
    fbm(
      p[0] * REGION_FIELD.dry.frequency + REGION_FIELD.dry.offset[0],
      p[1] * REGION_FIELD.dry.frequency + REGION_FIELD.dry.offset[1],
      p[2] * REGION_FIELD.dry.frequency + REGION_FIELD.dry.offset[2],
    ),
  );
  const tectonic = REGION_FIELD.highland.broadWeight * fbm(
    p[0] * REGION_FIELD.highland.broadFrequency + REGION_FIELD.highland.offsetA[0],
    p[1] * REGION_FIELD.highland.broadFrequency + REGION_FIELD.highland.offsetA[1],
    p[2] * REGION_FIELD.highland.broadFrequency + REGION_FIELD.highland.offsetA[2],
  ) + (1 - REGION_FIELD.highland.broadWeight) * fbm(
    p[0] * REGION_FIELD.highland.detailFrequency + REGION_FIELD.highland.offsetB[0],
    p[1] * REGION_FIELD.highland.detailFrequency + REGION_FIELD.highland.offsetB[1],
    p[2] * REGION_FIELD.highland.detailFrequency + REGION_FIELD.highland.offsetB[2],
  );
  const highland = smoothstep(REGION_FIELD.highland.lo, REGION_FIELD.highland.hi, tectonic)
    * smoothstep(REGION_FIELD.highland.coreLo, REGION_FIELD.highland.coreHi, wf);
  // This remains the deliberately approximate scattering beach band. The
  // shader's equal-angular-width painted beach still uses its field gradient.
  const beach = wf > 0 ? 1 - smoothstep(REGION_FIELD.beach.lo, REGION_FIELD.beach.hi, wf) : 0;
  const grassland = smoothstep(REGION_FIELD.land.lo, REGION_FIELD.land.hi, wf)
    * (1 - dry) * (1 - highland) * (1 - iceCap) * (1 - beach);
  const raw: Record<PSRegion, number> = { iceCap, dry, highland, beach, grassland };
  const total = PS_REGIONS.reduce((sum, region) => sum + raw[region], 0);
  if (total <= 1e-9) return { iceCap: 0, dry: 0, highland: 0, beach: 0, grassland: 1 };
  return {
    iceCap: iceCap / total,
    dry: dry / total,
    highland: highland / total,
    beach: beach / total,
    grassland: grassland / total,
  };
}

const NOISE_FREQUENCIES = [2, 5, 9] as const;

/**
 * 权重低于它的 region 直接跳过求值。
 *
 * 为什么必须有：H(x) 是五个 region 的加权和，照定义写就是**每个采样点都把五个
 * region 的地形函数各算一遍**——17 次 fbm + 5 次 ridge，而这个函数是逐像素跑的。
 * 改成区域感知之前整个 relief 只有 11 次噪声调用，改完变成 22 次（还不算
 * regionWeights 自己的），实测帧率从 ~55 掉到 20。
 *
 * 而权重几乎总是接近 one-hot：region 是大片连续区域，绝大多数像素只有 1 个
 * region 权重非零，边界上才有 2 个。跳过可忽略的项之后平均只算 1.3 个 region，
 * 比改动前还便宜。
 *
 * 2e-3 这个值：被丢掉的贡献上界是 2e-3 × 该 region 高度（H 的 p99 是 0.77），
 * 即 1.5e-3，乘 amplitude 4.05 后是 0.006 世界单位——地形格点间距约 1 个世界单位，
 * 远在看得见的尺度以下。
 *
 * CPU 与 WGSL **必须用同一个阈值**，否则几何和着色会在权重接近阈值的地方分家。
 */
const REGION_WEIGHT_EPSILON = 2e-3;

const seedOffset = (seed: number): V3 => [seed * 0.1031, seed * 0.11369, seed * 0.13787];

function terrainFbm(p: V3, frequency: number, octaves: number, seed: number): number {
  let s = 0, a = 0.5;
  let q: V3 = [p[0] * frequency, p[1] * frequency, p[2] * frequency];
  for (let i = 0; i < octaves; i++) {
    const o = seedOffset(seed + i * 131);
    s += a * vnoise(q[0] + o[0], q[1] + o[1], q[2] + o[2]);
    q = [q[0] * 2.03, q[1] * 2.03, q[2] * 2.03];
    a *= 0.5;
  }
  return s;
}

function terrainRidge(p: V3, frequency: number, octaves: number, seed: number): number {
  let s = 0, a = 0.5;
  let q: V3 = [p[0] * frequency, p[1] * frequency, p[2] * frequency];
  for (let i = 0; i < octaves; i++) {
    const o = seedOffset(seed + i * 77);
    s += a * (1 - Math.abs(vnoise(q[0] + o[0], q[1] + o[1], q[2] + o[2]) * 2 - 1));
    q = [q[0] * 2.11, q[1] * 2.11, q[2] * 2.11];
    a *= 0.5;
  }
  return s;
}

/** WorldClaw field.py:66-96, adapted from its 2D plane to a unit-sphere vec3. */
function landform(op: LandformOp, p: V3, seed: number): number {
  switch (op) {
    case 'peak': return Math.max(0, terrainRidge(p, 2.7, 4, seed)) ** 2.2;
    case 'dune': return terrainRidge(p, 16.5, 3, seed) * 0.7;
    case 'terrace': {
      const base = terrainFbm(p, 3.9, 4, seed);
      return Math.floor(base * 6) / 6 + ((base * 6) % 1) * 0.12 / 6;
    }
    case 'erosion': return -Math.max(terrainRidge(p, 7.8, 4, seed + 991) - 0.55, 0) * 1.8;
    case 'ridge': return terrainRidge(p, 5.1, 4, seed + 313);
    case 'flat': return 0;
  }
}

function regionTerrain(p: V3, terrain: RegionTerrain, regionIndex: number): number {
  let noise = 0;
  for (let k = 0; k < NOISE_FREQUENCIES.length; k++) {
    noise += terrain.roughness * (0.5 ** k)
      * (terrainFbm(p, NOISE_FREQUENCIES[k]!, 4, 7 + regionIndex * 17 + k) - 0.5);
  }
  const ops = terrain.landformOps.length > 0 ? terrain.landformOps : ['flat'] as LandformOp[];
  let geo = 0;
  for (const op of ops) geo += landform(op, p, 7 + regionIndex * 53);
  geo /= ops.length;
  return terrain.baseElevation + noise + geo * terrain.roughness * 1.4;
}

/**
 * The authoritative region-aware H(x). terrain-plan.ts is its only parameter
 * table; terrainHeightWgsl() emits the shader-side evaluator from that table.
 */
export function relief(p: V3): number {
  const weights = regionWeights(p);
  let height = 0;
  for (let i = 0; i < PS_REGIONS.length; i++) {
    const region = PS_REGIONS[i]!;
    const weight = weights[region];
    // 见 REGION_WEIGHT_EPSILON：跳过可忽略项，否则每个采样点都要算满五个 region。
    if (weight <= REGION_WEIGHT_EPSILON) continue;
    height += weight * regionTerrain(p, TERRAIN_PLAN.byRegion[region], i);
  }
  return height;
}

/**
 * World-space height to add to the planet radius.
 *
 * Zero at and below the waterline — the ocean has to stay a clean sphere, and
 * more importantly the shoreline the SHADER draws comes from the same landField,
 * so keeping displacement at zero there makes the geometry and the painted coast
 * agree exactly at the one place a disagreement would show.
 *
 * This exists so the terrain can SELF-SHADOW. With the relief carried only as a
 * normal perturbation the sphere was geometrically smooth, so turning shadows on
 * changed 0.05% of the frame: there was nothing for them to fall across.
 */
export function terrainHeight(p: V3): number {
  const gate = smoothstep(0.0, 0.10, landField(p));
  return gate * relief(p) * TERRAIN_PLAN.amplitude;
}

/** landField plus the SAME coastline warp the shader paints with. Gameplay and
 *  placement gate on this, not on the raw field: the painted coast wanders up
 *  to ~±0.07 field units around the raw line, which at coastal gradients is a
 *  couple of world units — enough to plant props on painted water and fade the
 *  carve track at the wrong shoreline. (codex 5.6 finding #1) */
export function warpedField(p: V3): number {
  return landField(p)
    + (fbm(p[0] * 6, p[1] * 6, p[2] * 6) - 0.5) * 0.055
    + (fbm(p[0] * 21, p[1] * 21, p[2] * 21) - 0.5) * 0.018;
}

// ── height lattice: the surface EVERYTHING agrees on ─────────────────────────
//
// The mesh is displaced at its VERTICES; inside a triangle the rendered surface
// is the linear interpolation of the three corners, which for any bump lies
// BELOW the analytic field. Placement used the analytic field, so props and
// snakes sat on a surface that was not the one being drawn. Measured over land:
// p50 0.003, p90 0.074, p99 0.158, max 0.272 world units of gap — against a
// BODY_R of 0.5, that is up to half a snake floating, and it read exactly as the
// bots "climbing" on land. Over water the field is identically zero, the
// interpolation is exact, and nothing floated — which is the clue that named it.
//
// Fix: sample the field ONCE onto a lattice at the mesh's own resolution and
// have both the displacement and every placement query read that lattice. The
// two then differ only by the bilinear-vs-triangle twist term inside one cell
// (order 0.003), instead of by the field's whole curvature. It is also far
// cheaper: a placement query becomes four array reads instead of ~100 hashes.

export interface HeightLattice {
  ws: number;
  hs: number;
  data: Float32Array;
}

/** Direction for lattice node (i, j). Longitude i in [0,ws], latitude j in [0,hs]. */
function latticeDir(i: number, j: number, ws: number, hs: number): V3 {
  const u = (i / ws) * Math.PI * 2;
  const v = (j / hs) * Math.PI;
  const sv = Math.sin(v);
  return [sv * Math.cos(u), Math.cos(v), sv * Math.sin(u)];
}

export function buildHeightLattice(ws: number, hs: number): HeightLattice {
  const data = new Float32Array((ws + 1) * (hs + 1));
  for (let j = 0; j <= hs; j++) {
    for (let i = 0; i <= ws; i++) {
      data[j * (ws + 1) + i] = terrainHeight(latticeDir(i, j, ws, hs));
    }
  }
  return { ws, hs, data };
}

/**
 * Bilinear height at a direction. This is THE surface: the mesh is displaced by
 * it and every placement queries it, so geometry and gameplay cannot disagree.
 */
/**
 * Height at a direction, interpolated EXACTLY the way the mesh triangulates.
 *
 * Bilinear was not enough. The engine's own sphere factory uses a different
 * parameterisation than this lattice (probed: every axis/flip hypothesis was
 * off by >1.2 in direction space), so lattice cells and mesh triangles did not
 * line up and the residual gap was still 0.10 world units at worst. The planet
 * mesh is therefore BUILT here from this same lattice, with this same diagonal,
 * and this query walks the identical triangle — so the value returned is the
 * rendered surface, not an approximation of it.
 */
export function latticeHeight(L: HeightLattice, d: V3): number {
  const { ws, hs, data } = L;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const y = Math.max(-1, Math.min(1, d[1] / len));
  const v = Math.acos(y) / Math.PI;
  let u = Math.atan2(d[2] / len, d[0] / len) / (Math.PI * 2);
  if (u < 0) u += 1;
  const fi = Math.min(ws - 1e-9, u * ws);
  const fj = Math.max(0, Math.min(hs - 1e-9, v * hs));
  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const a = fi - i0;          // 0..1 across the cell in longitude
  const b = fj - j0;          // 0..1 across the cell in latitude
  const row0 = j0 * (ws + 1) + i0;
  const row1 = (j0 + 1) * (ws + 1) + i0;
  const h00 = data[row0]!, h10 = data[row0 + 1]!;
  const h01 = data[row1]!, h11 = data[row1 + 1]!;
  // Diagonal runs (i,j+1)-(i+1,j), matching buildSurfaceMesh's index order.
  return a + b <= 1
    ? h00 + (h10 - h00) * a + (h01 - h00) * b
    : h11 + (h01 - h11) * (1 - a) + (h10 - h11) * (1 - b);
}

/**
 * The planet's surface mesh, generated here rather than by the engine factory.
 *
 * Owning it is the point: the factory's parameterisation is unknown to this
 * module, so a height query could never be more than an approximation of what
 * it drew. Built from the lattice with a known diagonal, the query above is
 * exact and props stop hovering over the drawn triangles.
 *
 * Returns the 8-float interleaved layout meshFromInterleaved expects
 * (position, normal, uv) plus a uint16 index list (see the ceiling guard below).
 */
export function buildSurfaceMesh(L: HeightLattice, baseRadius: number): {
  verts: Float32Array;
  indices: Uint16Array;
} {
  const { ws, hs, data } = L;
  const vCount = (ws + 1) * (hs + 1);
  // The index list is uint16 ON PURPOSE, and this guard is what keeps it honest.
  //
  // ForgeaX derives a new mesh's index format from the array type it is handed
  // (render-data.ts: `indices instanceof Uint32Array ? 'uint32' : 'uint16'`),
  // but every updateMesh write-back re-declares it as a hardcoded 'uint16'
  // (gpu-resource-store.ts, still true at engine #2295). Hand it a Uint32Array
  // and the mesh is born uint32, then silently retyped on the first write-back:
  // the terrain disappears and the props are left hanging in the air. Observed
  // exactly that on a stock-engine build, 2026-08-19.
  //
  // Staying in uint16 makes both engine paths agree, so the game survives a
  // deform on a stock engine with no fork patch. A resolution bump that breaks
  // the ceiling must fail HERE, at boot, with this message -- never silently,
  // a minute into play.
  if (vCount > 65536) {
    throw new RangeError(
      `[planet-snake] surface lattice ${ws}x${hs} wants ${vCount} vertices; the uint16 index `
      + 'ceiling is 65536. Lower SURF_WS/SURF_HS in scatter-rules.ts, or split the terrain into '
      + 'submeshes. Do NOT switch to Uint32Array: the engine retypes it to uint16 on updateMesh.',
    );
  }
  const verts = new Float32Array(vCount * 8);
  const pos = new Float32Array(vCount * 3);
  for (let j = 0; j <= hs; j++) {
    for (let i = 0; i <= ws; i++) {
      const k = j * (ws + 1) + i;
      const d = latticeDir(i, j, ws, hs);
      const r = baseRadius + data[k]!;
      pos[k * 3] = d[0] * r; pos[k * 3 + 1] = d[1] * r; pos[k * 3 + 2] = d[2] * r;
      verts[k * 8 + 6] = i / ws;
      verts[k * 8 + 7] = j / hs;
    }
  }
  const indices = new Uint16Array(ws * hs * 6);
  let t = 0;
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const a = j * (ws + 1) + i, b = a + 1, c = a + (ws + 1), e = c + 1;
      // Winding is COUNTER-CLOCKWISE seen from outside — the engine culls back
      // faces with frontFace 'ccw', so getting this backwards culls every front
      // face and leaves the INSIDE of the far hemisphere visible through the
      // planet. Checked at the equator: with a=(i,j), b=(i+1,j), c=(i,j+1), the
      // edge a->b runs +z and a->c runs -y, so (a,b,c) gives z x -y = +x, the
      // outward normal; (a,c,b) gives -x and is the inverted case.
      // Diagonal stays b-c, mirrored by latticeHeight's `a + b <= 1` split.
      indices[t++] = a; indices[t++] = b; indices[t++] = c;
      indices[t++] = b; indices[t++] = e; indices[t++] = c;
    }
  }
  // Area-weighted vertex normals from the DISPLACED positions — the cross
  // product's length is twice the triangle area, so accumulating it unnormalised
  // is the weighting.
  const nrm = new Float32Array(vCount * 3);
  for (let q = 0; q < indices.length; q += 3) {
    const a = indices[q]! * 3, b = indices[q + 1]! * 3, c = indices[q + 2]! * 3;
    const e1x = pos[b]! - pos[a]!, e1y = pos[b + 1]! - pos[a + 1]!, e1z = pos[b + 2]! - pos[a + 2]!;
    const e2x = pos[c]! - pos[a]!, e2y = pos[c + 1]! - pos[a + 1]!, e2z = pos[c + 2]! - pos[a + 2]!;
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    for (const o of [a, b, c]) { nrm[o]! += fx; nrm[o + 1]! += fy; nrm[o + 2]! += fz; }
  }
  for (let k = 0; k < vCount; k++) {
    const l = Math.hypot(nrm[k * 3]!, nrm[k * 3 + 1]!, nrm[k * 3 + 2]!) || 1;
    verts[k * 8] = pos[k * 3]!; verts[k * 8 + 1] = pos[k * 3 + 1]!; verts[k * 8 + 2] = pos[k * 3 + 2]!;
    verts[k * 8 + 3] = nrm[k * 3]! / l;
    verts[k * 8 + 4] = nrm[k * 3 + 1]! / l;
    verts[k * 8 + 5] = nrm[k * 3 + 2]! / l;
  }
  return { verts, indices };
}

/** The same field, unrolled into WGSL from the same numbers. */
/** The land/water field as WGSL, for shaders outside the surface material —
 *  the space post-pass needs it to know which pixels are ocean. */
export function landFieldWgsl(): string {
  const terms = LAND_CENTERS.map((c, i) => {
    const thr = i % 2 ? 0.69 : 0.64;
    return `  v = max(v, dot(p, vec3<f32>(${c.map((x) => x.toFixed(6)).join(', ')}))
    + 0.09 * sin(p.x * 11.0 + ${(i * 2.1).toFixed(4)}) + 0.07 * sin(p.y * 17.0 - p.z * 9.0 + ${i}.0) - ${thr});`;
  });
  return `fn ps_landField(p: vec3<f32>) -> f32 {\n  var v = -1.0;\n${terms.join('\n')}\n  return v;\n}`;
}

// Albedos measured off the reference video. Its land clusters at RGB (80,85,45)
// — a dark desaturated olive — and carries a second, browner cluster; the audit
// found exactly three land albedos (green grass / khaki dry earth / cream-tan
// sand) and established that the "dark biome" regions are SHADING, not a fourth
// albedo. Water runs (26,67,75) deep to (67,107,109) near shore.
// Scaled down 2026-08-03 after a matched-composition measurement: with the land
// filling the lower half of frame, our Q3/Q4/Q5 bins read (147,147,100) /
// (160,159,109) / (183,183,141) against the reference's (115,93,42) /
// (126,103,48) / (148,127,73). Too bright in every channel, and G sat level with
// R where the reference has G/R 0.81 — its land is WARM, ours was neutral-green.
// Note these are post-tonemap display values, so they cannot be inverted to a
// linear exposure; the palette is fitted against them directly instead.
const PAL = {
  // GREEN, and it was not before: [0.180, 0.158, 0.030] is G/R 0.88 — a yellow.
  // Measured against the reference video, land pixels there run G/R 0.837 to
  // 1.117 across ten frames (mean 0.99); ours ran 0.914 to 0.988 across ten
  // places on the planet, so we were both too yellow AND had a quarter of the
  // biome variation. Screen G/R lands about +0.05 above the albedo's, so 1.05
  // here puts a grass region at the reference's green frames. Luminance is held
  // at the old value (0.1535) so nothing downstream needs re-exposing.
  grass: [0.129, 0.173, 0.031],
  dry: [0.295, 0.205, 0.046],
  sand: [0.52, 0.455, 0.295],
  ice: [0.60, 0.63, 0.665],
  deep: [0.008, 0.080, 0.122],
  shallow: [0.042, 0.228, 0.238],
  foam: [0.78, 0.9, 0.9],
};
const v3 = (c: number[]): string => `vec3<f32>(${c.map((x) => x.toFixed(4)).join(', ')})`;
/// ln(deep/shallow) per channel — the absorption exponent that carries the water
/// from the fitted shallow tone to the fitted deep tone along Beer-Lambert.
const absorbWgsl = v3(PAL.deep.map((d, i) => Math.log(Math.max(d, 1e-4) / Math.max(PAL.shallow[i]!, 1e-4))));

/**
 * `?hash=int` swaps the GPU value-noise hash for an integer-lattice one. The
 * float form below stays the default.
 *
 * The float hash IS precision-fragile in principle -- `fract((q.x + q.y) * q.z)`
 * takes the fraction of a product reaching ~2e4, leaving about 9 bits in f32 --
 * and the integer form is bit-exact on every backend. It was written as a fix
 * for Safari/Metal rendering the terrain as saturated colour blobs.
 *
 * IT IS NOT THAT FIX. Measured on 2026-08-20, six seeds, saturated-pixel share
 * of the frame, integer vs float: 0.08/0.00, 0.71/0.82, 0.02/0.00, 0.00/0.02,
 * 0.01/0.06, 0.00/0.00. Indistinguishable -- seed 21 corrupts under BOTH, the
 * rest are clean under both. An earlier one-run-each A/B looked decisive and
 * was not; it compared a corrupt draw against a clean one and read the
 * difference as the hash.
 *
 * Kept as a toggle because the precision concern is real and this is the
 * cheapest way to re-test it, but nothing observed so far is explained by it.
 */
export const USE_INTEGER_HASH: boolean =
  typeof globalThis.location !== 'undefined'
  && new URLSearchParams(globalThis.location.search).get('hash') === 'int';

/** One 3-D lattice hash, under whichever implementation is armed. */
export function hashFnWgsl(name: string): string {
  if (USE_INTEGER_HASH) {
    return `
fn ${name}(g: vec3<f32>) -> f32 {
  // \`g\` is always an integer lattice corner, so the cast is exact and every
  // step below is u32 arithmetic -- bit-identical on every backend.
  let i = vec3<i32>(round(g));
  var h: u32 = bitcast<u32>(i.x) * 374761393u
    + bitcast<u32>(i.y) * 668265263u
    + bitcast<u32>(i.z) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h >> 8u) * (1.0 / 16777216.0);
}
`;
  }
  return `
fn ${name}(g: vec3<f32>) -> f32 {
  var q = fract(g * 0.1031);
  q = q + dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;
}

/**
 * Value noise and fbm. The hash runs on an integer lattice but mixes in floats
 * (see `hashFnWgsl`); a sin-based hash was tried first and banded badly at the
 * frequencies used for the fine speckle, showing as moire on a sphere this size.
 */
const NOISE_WGSL = `
${hashFnWgsl('ps_hash')}

fn ps_vnoise(x: vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let c000 = ps_hash(i + vec3<f32>(0.0, 0.0, 0.0));
  let c100 = ps_hash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c010 = ps_hash(i + vec3<f32>(0.0, 1.0, 0.0));
  let c110 = ps_hash(i + vec3<f32>(1.0, 1.0, 0.0));
  let c001 = ps_hash(i + vec3<f32>(0.0, 0.0, 1.0));
  let c101 = ps_hash(i + vec3<f32>(1.0, 0.0, 1.0));
  let c011 = ps_hash(i + vec3<f32>(0.0, 1.0, 1.0));
  let c111 = ps_hash(i + vec3<f32>(1.0, 1.0, 1.0));
  let x00 = mix(c000, c100, u.x);
  let x10 = mix(c010, c110, u.x);
  let x01 = mix(c001, c101, u.x);
  let x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn ps_fbm(x: vec3<f32>) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = x;
  for (var i = 0; i < 4; i = i + 1) {
    s = s + a * ps_vnoise(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return s;
}

/** Ridged fbm — the sharp-crested variant, for mountain relief. */
fn ps_ridge(x: vec3<f32>) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = x;
  for (var i = 0; i < 4; i = i + 1) {
    s = s + a * (1.0 - abs(ps_vnoise(q) * 2.0 - 1.0));
    q = q * 2.11;
    a = a * 0.5;
  }
  return s;
}
`;

/** Region-aware relief shared by CPU mesh displacement and fragment shading. */
const wgslFloat = (value: number): string => value.toFixed(8);
const wgslVec3 = (value: V3): string => `vec3<f32>(${value.map(wgslFloat).join(', ')})`;

function landformWgsl(op: LandformOp, seed: number): string {
  switch (op) {
    case 'peak': return `pow(max(ps_terrainRidge(p, 2.7, 4, ${seed}), 0.0), 2.2)`;
    case 'dune': return `ps_terrainRidge(p, 16.5, 3, ${seed}) * 0.7`;
    case 'terrace': return `ps_opTerrace(p, ${seed})`;
    case 'erosion': return `-max(ps_terrainRidge(p, 7.8, 4, ${seed + 991}) - 0.55, 0.0) * 1.8`;
    case 'ridge': return `ps_terrainRidge(p, 5.1, 4, ${seed + 313})`;
    case 'flat': return '0.0';
  }
}

/** Generate the shader evaluator from TERRAIN_PLAN, the CPU evaluator's table. */
export function terrainHeightWgsl(): string {
  const regionFunctions = PS_REGIONS.map((region, regionIndex) => {
    const terrain = TERRAIN_PLAN.byRegion[region];
    const noise = NOISE_FREQUENCIES.map((frequency, k) =>
      `${wgslFloat(terrain.roughness * (0.5 ** k))} * (ps_terrainFbm(p, ${wgslFloat(frequency)}, 4, ${7 + regionIndex * 17 + k}) - 0.5)`,
    ).join('\n    + ');
    const ops = terrain.landformOps.length > 0 ? terrain.landformOps : ['flat'] as LandformOp[];
    const geo = ops.map((op) => landformWgsl(op, 7 + regionIndex * 53)).join('\n    + ');
    return `fn ps_regionTerrain_${region}(p: vec3<f32>) -> f32 {
  let noise = ${noise};
  let geo = (${geo}) / ${wgslFloat(ops.length)};
  return ${wgslFloat(terrain.baseElevation)} + noise
    + geo * ${wgslFloat(terrain.roughness)} * 1.4;
}`;
  }).join('\n\n');
  // 和 CPU 侧 relief() 逐字对应的跳过逻辑：权重可忽略的 region 不求值。
  // 阈值必须是同一个常量，见 REGION_WEIGHT_EPSILON。
  const reliefBranches = PS_REGIONS.map(
    (region) => `  if (w.${region} > ${wgslFloat(REGION_WEIGHT_EPSILON)}) {\n`
      + `    h += w.${region} * ps_regionTerrain_${region}(p);\n  }`,
  ).join('\n');

  return `
/// Land field plus its coastline warp. Split out as a function so its GRADIENT
/// can be taken: every coastal feature below is expressed as a distance to the
/// waterline, and a distance needs a derivative.
fn ps_field(p: vec3<f32>) -> f32 {
  return ps_landField(p)
    + (ps_fbm(p * 6.0) - 0.5) * 0.055
    + (ps_fbm(p * 21.0) - 0.5) * 0.018;
}

/// Wave height. Two crossed ridged bands plus a finer isotropic layer — the
/// crossed bands are what break the sun glint into a long streak of separate
/// crests instead of one smooth blob, which is how the reference's glint reads
/// in the six frames where it is the largest bright shape in the picture.
fn ps_waves(p: vec3<f32>) -> f32 {
  // Wavelength matters more than amplitude. At 38 per radian a crest was 4.3
  // world units across and the waves rendered as broad white smears in the
  // DIFFUSE — fog patches, not water. At ~220 a crest is about 0.75 units, which
  // averages out at screen scale in the diffuse and survives only where the
  // specular geometry is satisfied. That is what a glint is.
  // 220 per radian puts a crest at roughly 0.75 world units, which at the play
  // camera lands near one crest per pixel and aliases into visible horizontal
  // banding — the water read as corduroy rather than as water. Halved, and the
  // 520 speckle octave dropped entirely: it was pure aliasing fuel and the glint
  // gets its break-up from the two crossed ridged bands.
  let a = ps_ridge(p * vec3<f32>(105.0, 112.0, 100.0));
  let b = ps_ridge(p * vec3<f32>(76.0, 70.0, 83.0) + vec3<f32>(5.0, 2.0, 8.0));
  return a * 0.6 + b * 0.4;
}

fn ps_seedOffset(seed: i32) -> vec3<f32> {
  let s = f32(seed);
  return vec3<f32>(s * 0.1031, s * 0.11369, s * 0.13787);
}

fn ps_terrainFbm(p: vec3<f32>, frequency: f32, octaves: i32, seed: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p * frequency;
  for (var i = 0; i < octaves; i = i + 1) {
    s = s + a * ps_vnoise(q + ps_seedOffset(seed + i * 131));
    q = q * 2.03;
    a = a * 0.5;
  }
  return s;
}

fn ps_terrainRidge(p: vec3<f32>, frequency: f32, octaves: i32, seed: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p * frequency;
  for (var i = 0; i < octaves; i = i + 1) {
    s = s + a * (1.0 - abs(ps_vnoise(q + ps_seedOffset(seed + i * 77)) * 2.0 - 1.0));
    q = q * 2.11;
    a = a * 0.5;
  }
  return s;
}

fn ps_opTerrace(p: vec3<f32>, seed: i32) -> f32 {
  let base = ps_terrainFbm(p, 3.9, 4, seed);
  return floor(base * 6.0) / 6.0 + fract(base * 6.0) * 0.12 / 6.0;
}

struct PsRegionWeights {
  iceCap: f32,
  dry: f32,
  highland: f32,
  beach: f32,
  grassland: f32,
};

fn ps_regionWeights(p: vec3<f32>) -> PsRegionWeights {
  let wf = ps_field(p);
  let iceCap = smoothstep(${wgslFloat(REGION_FIELD.ice.lo)}, ${wgslFloat(REGION_FIELD.ice.hi)},
    abs(p.y) + (ps_fbm(p * ${wgslFloat(REGION_FIELD.ice.frequency)}) - 0.5) * ${wgslFloat(REGION_FIELD.ice.jitter)});
  let dry = smoothstep(${wgslFloat(REGION_FIELD.dry.lo)}, ${wgslFloat(REGION_FIELD.dry.hi)},
    ps_fbm(p * ${wgslFloat(REGION_FIELD.dry.frequency)} + ${wgslVec3(REGION_FIELD.dry.offset)}));
  let tectonic = ${wgslFloat(REGION_FIELD.highland.broadWeight)}
      * ps_fbm(p * ${wgslFloat(REGION_FIELD.highland.broadFrequency)} + ${wgslVec3(REGION_FIELD.highland.offsetA)})
    + ${wgslFloat(1 - REGION_FIELD.highland.broadWeight)}
      * ps_fbm(p * ${wgslFloat(REGION_FIELD.highland.detailFrequency)} + ${wgslVec3(REGION_FIELD.highland.offsetB)});
  let highland = smoothstep(${wgslFloat(REGION_FIELD.highland.lo)}, ${wgslFloat(REGION_FIELD.highland.hi)}, tectonic)
    * smoothstep(${wgslFloat(REGION_FIELD.highland.coreLo)}, ${wgslFloat(REGION_FIELD.highland.coreHi)}, wf);
  let beach = select(0.0, 1.0 - smoothstep(${wgslFloat(REGION_FIELD.beach.lo)}, ${wgslFloat(REGION_FIELD.beach.hi)}, wf), wf > 0.0);
  let grassland = smoothstep(${wgslFloat(REGION_FIELD.land.lo)}, ${wgslFloat(REGION_FIELD.land.hi)}, wf)
    * (1.0 - dry) * (1.0 - highland) * (1.0 - iceCap) * (1.0 - beach);
  let total = iceCap + dry + highland + beach + grassland;
  if (total <= 1e-9) {
    return PsRegionWeights(0.0, 0.0, 0.0, 0.0, 1.0);
  }
  return PsRegionWeights(iceCap / total, dry / total, highland / total, beach / total, grassland / total);
}

${regionFunctions}

fn ps_relief(p: vec3<f32>) -> f32 {
  let w = ps_regionWeights(p);
  var h = 0.0;
${reliefBranches}
  return h;
}
`;
}

/**
 * Fragment-side surface evaluation.
 *
 * `water` selects the water half of the palette and a mirror-smooth roughness;
 * both halves live in one function because the shoreline has to blend between
 * them continuously, which is the entire point of doing this per pixel.
 */
function surfaceWgsl(): string {
  return `
struct PsSurface {
  albedo: vec3<f32>,
  rough: f32,
  nrm: vec3<f32>,
  /// Dielectric F0. The stock 0.04 is right for water and wrong for dirt: with
  /// the albedo probed to zero, the terrain still rendered a NEUTRAL grey 30-48
  /// in display space, which on land this dark is most of the blue and green
  /// excess measured against the reference. The reference's ground is matte and
  /// its water carries the largest specular in most frames, so this has to vary
  /// per pixel rather than per material.
  spec: f32,
};

/// meshN is the INTERPOLATED VERTEX NORMAL, and passing it in is load-bearing.
/// The sphere is displaced by the relief field and its normals recomputed from
/// the result, but the graft replaces the shader's normal outright — so building
/// the output normal from normalize(worldPos) instead threw all of that away and
/// the terrain shaded as a smooth ball with a displaced silhouette. The hills
/// were there; nothing was lighting them.
fn ps_surface(wp: vec3<f32>, meshN: vec3<f32>) -> PsSurface {
  let p = normalize(wp);

  // Tangent frame, built from the least-aligned axis so there is no pole
  // degeneracy. Used for both the coastline distance and the relief normal.
  let ax = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(p.x) > 0.9);
  let t1 = normalize(cross(p, ax));
  let t2 = cross(p, t1);
  let e = 0.0035;

  // Coastal features are measured in ANGULAR DISTANCE to the waterline, not in
  // field value. The field is a smooth max of six dot products, so its gradient
  // is shallow in the interior of a continent — a beach defined as "field below
  // 0.055" was a narrow strip at steep coasts and a kilometre-wide cream river
  // running through the middle of the landmass wherever the field flattened out.
  // Dividing by |grad| converts the level set to a distance and the band becomes
  // the same width everywhere, which is what a beach actually is.
  //
  // The gradient is taken from the SMOOTH field only. Including the coastline
  // warp put its fbm-at-21 component into the denominator, so gmag swung
  // wildly from pixel to pixel and the shallow/deep blend broke into broad pale
  // streaks running across the ocean — they looked like fog banks and survived
  // two rounds of retuning the waves, which is not where they came from.
  let f = ps_field(p);
  let gf1 = ps_landField(normalize(p + t1 * e)) - ps_landField(normalize(p - t1 * e));
  let gf2 = ps_landField(normalize(p + t2 * e)) - ps_landField(normalize(p - t2 * e));
  let gmag = max(length(vec2<f32>(gf1, gf2)) / (2.0 * e), 0.05);
  let dist = f / gmag;                       // radians from the waterline, signed

  let grain = ps_fbm(p * 40.0);
  let blotch = ps_fbm(p * 4.5);

  // ── land ────────────────────────────────────────────────────────────────
  // Dry earth is carved out of the interior by a second, independent field, so
  // it reads as exposed ground rather than as a separate island.
  var land = ${v3(PAL.grass)};
  // The window has to sit ON the field's median or one biome eats the planet.
  // ps_fbm's distribution here is mean 0.468, std 0.112 (sampled over 200k
  // points on the sphere), so smoothstep(0.50, 0.78) put the ramp entirely in
  // the upper tail: 73% of the surface came out PURE grass and 0.4% pure dry,
  // which is why every location looked the same colour. Centred and narrowed,
  // it gives 77% clearly grass / 9% clearly dry / the rest painterly
  // transition. Grass-dominant is not a preference, it is what the reference
  // measures: its DAYLIGHT frames are 67.6% green pixels at G/R 1.052, which
  // is about what a pure grass region renders as here — so the reference is
  // very largely one green biome with a browner minority, and the earlier
  // 50/50 split (dry mean 0.25) left us at 18.9% green.
  let dry = smoothstep(0.52, 0.66, ps_fbm(p * 3.2 + vec3<f32>(11.0, 3.0, 7.0)));
  land = mix(land, ${v3(PAL.dry)}, dry);
  // Mountain flanks go bare, valleys stay green. The two windows below are
  // generated by tools/terrain-gate.ts from area-uniform land samples; their
  // percentile identities live beside the values in terrain-calibration.ts.
  let rel = ps_relief(p);
  land = mix(land, ${v3(PAL.dry)} * 0.86,
    smoothstep(${wgslFloat(TERRAIN_ALBEDO_WINDOWS.bareMix.lo)}, ${wgslFloat(TERRAIN_ALBEDO_WINDOWS.bareMix.hi)}, rel) * 0.30);
  // Blotch and valley contrast both pulled in. These two multiply, so the swing
  // between a lit ridge and a shaded hollow ran 0.86*0.78 = 0.67 to
  // 1.16*1.18 = 1.37 — better than 2:1 within one biome, which is what reads as
  // near-black patches stamped on bright sand. Now 0.79 to 1.24.
  land = land * (0.90 + 0.20 * blotch) * (0.96 + 0.08 * grain);
  // Valleys sit in their own shade. This wider p10-p80 window preserves a long
  // transition while the bare-flank mix above only reaches the upper tail.
  land = land * (0.91 + 0.16
    * smoothstep(${wgslFloat(TERRAIN_ALBEDO_WINDOWS.valleyShade.lo)}, ${wgslFloat(TERRAIN_ALBEDO_WINDOWS.valleyShade.hi)}, rel));
  // A slow warm/cool drift on top of the value variation. The reference's land
  // is never one hue over any large area; without this the blotches only change
  // brightness and the terrain still reads as a single tinted sheet.
  // TRIED WIDER AND PUT BACK. The within-frame hue spread still trails the
  // reference (31 vs 45 deg), and this term looked like the lever — but at
  // 0.55/0.45 amplitude the measured spread moved 31.1 -> 32.0 while the green
  // fraction fell 66.3 -> 61.4% (drift pushes grass across the 65-deg line).
  // The real source of the reference's breadth is LIT-VS-SHADOW hue
  // divergence: its shadowed land reads up to +35 deg greener than its lit
  // land (median ~+24), ours +16. Closing that means retinting shadow ambient,
  // which the player has already called tiring once — left alone deliberately.
  let drift = ps_fbm(p * 2.1 + vec3<f32>(4.0, 9.0, 2.0)) - 0.5;
  land = land * vec3<f32>(1.0 + drift * 0.22, 1.0 + drift * 0.04, 1.0 - drift * 0.20);
  // Beach: a narrow band on the land side of the waterline.
  land = mix(${v3(PAL.sand)}, land, smoothstep(0.0008, 0.010, dist));

  // ── water ───────────────────────────────────────────────────────────────
  // Depth from the same field. The reference's shelf hugs every coast because
  // its shallow band is depth-driven, not a separately placed ring.
  let depth = clamp(-dist / 0.055, 0.0, 1.0);   // shelf hugs the shore; open water is one deep tone
  // Beer-Lambert instead of a linear mix — the reference's water model. Its colour
  // "is the *shortfall* of the light that made it through — red first, then
  // green — so the tint follows the path length" (water.fragment.wgsl,
  // WATER_ABSORB). exp(ln(deep/shallow) * path) hits the SAME two fitted
  // endpoints, but the midtones travel the multiplicative path between them:
  // through saturated glacial teal, where the linear mix cut a grey chord.
  // depth*depth stays as the path proxy the shelf width was fitted with.
  var water = ${v3(PAL.shallow)} * exp(${absorbWgsl} * (depth * depth));
  water = water * (0.90 + 0.16 * ps_fbm(p * 30.0));

  // ── shoreline ───────────────────────────────────────────────────────────
  let onLand = smoothstep(-0.0012, 0.0012, dist);
  var col = mix(water, land, onLand);
  // Foam sits ON the waterline, both sides, and is thinner than the sand band.
  // WIDTH VARIES ALONG THE COAST. At a fixed 0.0035 it was a constant-width
  // stroke with static lace inside it — a sticker outline, not surf. The band
  // now breathes between 0.0024 and 0.0046 on a slow field, so it thickens in
  // bays and thins on points the way real surf does.
  let foamHalfWidth = 0.0024 + 0.0022 * ps_vnoise(p * 7.0);
  let foam = (1.0 - smoothstep(0.0, foamHalfWidth, abs(dist))) * (0.55 + 0.45 * ps_vnoise(p * 90.0));
  // 0.5 -> 0.35: at half strength this line was the brightest continuous thing
  // in most frames, which is not what a coast should win.
  col = mix(col, ${v3(PAL.foam)}, foam * 0.35);

  // ── ice ─────────────────────────────────────────────────────────────────
  // Caps at the poles and snow on the highest ground, both with a noisy edge.
  let capEdge = abs(p.y) + (blotch - 0.5) * 0.10;
  let cap = smoothstep(0.905, 0.975, capEdge);
  let ice = cap;   // polar caps only — snow on ridges read as white smears

  col = mix(col, ${v3(PAL.ice)} * (0.94 + 0.10 * grain), ice);

  // ── normal ──────────────────────────────────────────────────────────────
  // Relief is shaded, not displaced. The gradient is taken in the tangent plane
  // by central differences; on a unit sphere any two vectors orthogonal to p
  // will do, and building them from the least-aligned axis avoids the pole
  // degeneracy that a fixed up-vector would have.
  // The LOW-FREQUENCY relief is real geometry now — the sphere is displaced by
  // ps_relief on the CPU and its normals recomputed — so perturbing by the same
  // field here would shade every hill twice. What is left for the shader is the
  // sub-vertex grain, which at a 0.64-unit vertex spacing the mesh cannot carry.
  let du = ps_fbm(normalize(p + t1 * e) * 26.0) - ps_fbm(normalize(p - t1 * e) * 26.0);
  let dv = ps_fbm(normalize(p + t2 * e) * 26.0) - ps_fbm(normalize(p - t2 * e) * 26.0);
  // Waves need their own, much smaller epsilon: sampled at the relief's step the
  // 38-per-radian bands alias into noise instead of resolving as crests.
  let we = 0.00028;
  let wu = ps_waves(normalize(p + t1 * we)) - ps_waves(normalize(p - t1 * we));
  let wv = ps_waves(normalize(p + t2 * we)) - ps_waves(normalize(p - t2 * we));
  let wgrad = (t1 * wu + t2 * wv) / (2.0 * we);
  // grad is the TANGENTIAL gradient of the relief, in height per radian —
  // dividing by 2e is what makes it a derivative rather than a raw difference.
  // The previous form folded an extra 0.0016 into the same expression and came
  // out at a normal tilt of about 1.5 degrees, which is why the terrain rendered
  // as one flat sheet no matter how the albedo was tuned. At a relief gradient
  // near 6 per radian, BUMP = 0.10 gives roughly a 30 degree tilt on a slope.
  let grad = (t1 * du + t2 * dv) / (2.0 * e);
  let BUMP = mix(0.010, 0.020, onLand);
  // Waves fade out at the shoreline, where the shelf is shallow and calm, and
  // die entirely on land.
  let waveAmp = (1.0 - onLand) * (1.0 - ice) * smoothstep(0.0, 0.02, -dist) * 0.00060;
  let geomN = normalize(meshN);
  let perturbedN = normalize(geomN - grad * BUMP - wgrad * waveAmp);
  // ON WATER, the specular is shown a normal PULLED BACK toward the geometric
  // one. The wave perturbation here is static — the forward pass has no clock —
  // so what it gives the sun lobe is not moving water, it is fixed dirty
  // texture: measured, the glare patch was near-neutral (saturation 0.11) and
  // marbled. The animated sparkle now lives in the post pass, so the forward
  // pass's whole job on water is ONE broad clean sheen. Land is untouched; its
  // bump is real relief.
  let bumped = normalize(mix(perturbedN, geomN, (1.0 - onLand) * 0.45));

  var out: PsSurface;
  out.albedo = col;
  // Ice overrides the water branch too: the polar caps sit mostly over OCEAN,
  // and with the gates keyed on onLand alone the cap kept water's gloss, F0 and
  // wave normals — a sheet of shiny water painted white. (codex 5.6 finding #3)
  // Water roughness 0.27 -> 0.60. At 0.27 the specular lobe is narrow enough
  // that, with F0 pushed as high as it is below, the sun's reflection clips: the
  // glint measured a solid (255,255,255) over 3.3% of the frame against the
  // reference's (199,206,197) peak, which is explicitly NOT clipped. A rougher
  // sheet spreads the same energy over a wider, softer patch — which is what the
  // reference's broad glare actually is.
  // 0.60 -> 0.46: with the water-patch geometry carrying the live sparkle,
  // the painted sheet's job is to CONTINUE the glare past the patch rim, and at
  // 0.60 the character gap between the two made the rim readable as a line.
  // The coherent-blob risk 0.60 was guarding against needed F0 0.17; at 0.030
  // a 0.46 lobe is a broad soft sheen, not a hole of white.
  // Water 0.46 -> 0.56. The glare was measured at display luminance 251 out of
  // 255 — clipped flat — over 2.04% of the sea. A knee on the ALBEDO was the
  // obvious-looking fix and is the wrong one: the clipped value is the
  // SPECULAR, so kneeing albedo only darkens the sea and leaves the highlight
  // blown. The lever that reaches it is the lobe width — broader spreads the
  // same energy over more pixels and lands the peak under clipping.
  out.rough = mix(mix(0.56, 0.60, ice), mix(0.88, 0.55, ice), onLand);
  // Water F0 is pushed well above the physical 0.02. The reference's sun glint
  // is the LARGEST BRIGHT SHAPE in six of ten frames, and with the tonemap
  // compressing highlights as hard as Reinhard does, a physical dielectric
  // simply cannot produce that on screen.
  // ...and F0 comes down with it, 0.17 -> 0.055 -> 0.030. The first pair was
  // fitted when the planet was radius 26; at 36 the lit water covers far more
  // screen and the same settings turned the glare into a white hole.
  //
  // 0.030 is the handover. THE SUN GLINT NOW LIVES IN THE POST PASS
  // (psWaveNormal + a GGX lobe in space.wgsl), because it needs a normal that
  // -- no backticks in this comment: it lives inside surfaceWgsl's template
  // literal, and one would close the string.
  // MOVES and no clock reaches this pass. What stays here is the broad soft
  // sheen the reference also has — the sharp moving sparkle is added on top from
  // outside. Raising this again re-creates the coherent blob the wave normal was
  // introduced to break up.
  out.spec = mix(mix(0.030, 0.025, ice), mix(0.004, 0.022, ice), onLand);
  out.nrm = bumped;
  return out;
}
`;
}

/** Everything the graft needs to inject, in one string. */
/** Just the value-noise helpers (`ps_hash` / `ps_vnoise` / `ps_fbm`), for
 *  grafts that want noise without the whole planet field — the foam variant
 *  dissolves its edges with it. */
export function noiseModuleWgsl(): string {
  return NOISE_WGSL;
}

export function surfaceModuleWgsl(): string {
  return `${NOISE_WGSL}\n${landFieldWgsl()}\n${terrainHeightWgsl()}\n${surfaceWgsl()}`;
}
