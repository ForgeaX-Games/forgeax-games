// Grass fringe — the blades that break the planet's silhouette.
//
// Every one of the 10 reference frames has it, and it is what stops the planet
// reading as a bare ball. Measured off the frames (silhouette circle fitted per
// frame, R = 590 px):
//   protrusion beyond the silhouette   p50 12 px, p90 31 px, max 83 px (f04)
//   silhouette spike pitch             8.8-27 px
//   blade base width                   p50 4.5 px, aspect L/W 3.3-4.9
//   lean off the sphere normal         |p50| 17 deg, |p90| 35 deg, random azimuth
//   lit blade sRGB (161,177,103) vs ground (77,84,49) — 2.2x brighter, yellower
//   NO root-to-tip gradient (tip 152,171,103 vs root 158,170,102)
//   at night: pure black silhouettes (17,15,10)
// Converted at R=590 px : 26 world units, that is ~0.53 world units of blade at
// p50 and ~1.37 at p90, on a ~0.39-unit pitch, ~0.20 units wide at the base.
//
// NOT shell fur, which is how the reference does its hood rim. Concentric shells are
// exactly edge-on at a sphere's limb — precisely where this has to read — and 22
// shells over a radius-26 sphere at a 4 mm strand pitch is over a million
// alpha-tested triangles. Instanced blades also give per-blade lean, which the
// fur path cannot express (its droop is one global vector).
//
// The absence of a root-to-tip gradient is worth stating: the reference's fur applies
// selfAO = 0.16 + 0.84*depth^2, which would be wrong here and is deliberately
// not carried over.

import type { EntityHandle, World } from '@forgeax/engine-ecs';

export type V3 = [number, number, number];

export interface GrassOptions {
  planetRadius: number;
  /** Blades to scatter. Instanced, so this is a fill-rate decision, not a draw-call one. */
  count: number;
  /** Only scatter where this returns true — keeps grass off the water. */
  keep?: (dir: V3) => boolean;
  /** Terrain height at a direction. The surface is displaced, so blades planted
   *  at one constant radius would sink into every hill. */
  heightAt?: (dir: V3) => number;
  /** Scatter as usual but do not spawn the patches. This is the ONLY way to get
   *  a grass-free frame for comparison, and comparison is the only way to know
   *  which pixels in a frame ARE grass — a colour window over a fixed box looks
   *  like it samples blades and actually samples the khaki ground, which is how
   *  a full round of "grass" measurements came back describing the terrain.
   *
   *  A runtime toggle was tried first and does NOT work: clearing a patch's
   *  Instances from outside the update loop returns `{ok:true}` and the frame
   *  comes back byte-identical, so it lies twice over. The scatter still runs
   *  here so the global RNG is consumed identically and every other object in
   *  the deterministic scene lands in the same place. */
  spawn?: boolean;
}

/**
 * One tapered blade, crossed and double-sided: 4 quads / 8 triangles / 16
 * vertices. Double-sided because the engine culls back faces by default
 * (pipeline-spec.ts:399) and a blade must read from whichever side the camera
 * happens to be on; crossed so it never disappears when viewed edge-on.
 */
function bladeInterleaved(): { verts: Float32Array; indices: Uint16Array } {
  // Side-by-side against the reference showed the first pass reading as fat
  // triangular shards. The reference blade is a long thin sliver with a sharp
  // tip — narrow the root and take the tip almost to a point.
  const BASE_HALF = 0.048;
  const TIP_HALF = 0.006;
  const V: number[] = [];
  const I: number[] = [];

  const quad = (ax: number, az: number, flip: boolean): void => {
    // Blade lies in the plane spanned by (ax,0,az) and +Y, growing to y = 1.
    const nx = flip ? az : -az;
    const nz = flip ? -ax : ax;
    const base = V.length / 8;
    const corners: [number, number, number, number, number][] = [
      [-BASE_HALF * ax, 0, -BASE_HALF * az, 0, 0],
      [BASE_HALF * ax, 0, BASE_HALF * az, 1, 0],
      [TIP_HALF * ax, 1, TIP_HALF * az, 1, 1],
      [-TIP_HALF * ax, 1, -TIP_HALF * az, 0, 1],
    ];
    for (const [x, y, z, u, v] of corners) V.push(x, y, z, nx, 0.35, nz, u, v);
    if (flip) I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const s = Math.SQRT1_2;
  quad(1, 0, false); quad(1, 0, true);
  quad(s, s, false); quad(s, s, true);

  return { verts: new Float32Array(V), indices: new Uint16Array(I) };
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export interface GrassPatches {
  entities: EntityHandle[];
  /** Each patch's instance buffer, kept so a caller can put it back after
   *  clearing it. Toggling the grass off and on is the only way to isolate
   *  which pixels in a frame ARE grass: a colour/brightness window over a fixed
   *  box looks like it samples blades and actually samples the khaki ground,
   *  which is how a whole round of "grass" measurements came back describing
   *  the terrain. */
  chunks: Float32Array[];
}

export function installGrass(
  world: World,
  material: number,
  opts: GrassOptions,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any; Instances: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
): GrassPatches {
  const { verts, indices } = bladeInterleaved();
  const mesh = meshFromInterleaved(verts, indices);

  // Frustum culling transforms MeshAsset.aabb by the ENTITY world matrix and is
  // blind to where the instances actually land (render-system-extract.ts). The
  // mesh's own AABB is one blade at the origin, so every blade would be culled
  // the moment the origin left the frustum. Overriding it with the sphere the
  // blades cover is the honest bound — it is genuinely where this draw puts
  // geometry. (Same failure mode cost an hour on the snake ribbon.)
  const R = opts.planetRadius + 3.5;
  (mesh as { aabb: Float32Array }).aabb = new Float32Array([-R, -R, -R, R, R, R]);

  const handle = world.allocSharedRef('MeshAsset', mesh) as number;

  const transforms = new Float32Array(opts.count * 16);
  let written = 0;
  let degenerate = 0;
  // Rejection-sample so grass lands on land only; cap the attempts so a bad
  // predicate degrades to sparse grass instead of hanging the boot.
  for (let attempt = 0; attempt < opts.count * 8 && written < opts.count; attempt++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    const n: V3 = [rr * Math.cos(th), u, rr * Math.sin(th)];
    if (opts.keep && !opts.keep(n)) continue;

    // Tangent frame, then a random azimuth inside it.
    const ref: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t1 = norm(cross(n, ref));
    const t2 = cross(n, t1);
    const az = Math.random() * Math.PI * 2;
    const dir: V3 = [
      t1[0] * Math.cos(az) + t2[0] * Math.sin(az),
      t1[1] * Math.cos(az) + t2[1] * Math.sin(az),
      t1[2] * Math.cos(az) + t2[2] * Math.sin(az),
    ];

    // Lean. The measured quantiles (|p50| 17 deg, |p90| 35 deg) came from
    // blades seen against the silhouette, which under-samples the ones lying
    // nearly tangential — and the reference plainly has many of those, some
    // almost flat to the surface. Widening to 72 deg with a square-root skew
    // keeps the median near the measurement while restoring the flat ones that
    // give the fringe its scattered, wind-blown read.
    // 40 degrees and 1.23, not 72 and 1.9, and the numbers come from the
    // measurement THIS FILE already records at the top: |p50| 17 deg, |p90| 35.
    // The old pair gives p50 19 (fine) and p90 59 (not) — a long tail of blades
    // lying almost flat on the ground, which at this camera distance reads as
    // scattered splinters rather than as a fringe. The new pair lands on 17 and
    // 35 exactly.
    const lean = (40 * Math.PI / 180) * Math.pow(Math.random(), 1.23);
    const cl = Math.cos(lean), sl = Math.sin(lean);
    const up = norm([n[0] * cl + dir[0] * sl, n[1] * cl + dir[1] * sl, n[2] * cl + dir[2] * sl]);
    // `right` is built against the blade's own azimuth, NOT against the surface
    // normal. up lies in the plane spanned by n and dir, so cross(up, n) shrinks
    // to zero exactly as the lean goes to zero — and `lean` is r^1.9, which puts
    // a large share of blades near zero. norm() of that near-zero vector is
    // ±Infinity or NaN, the instance matrix is poisoned, and the fragment stage
    // renders whatever undefined happens to be: individual blades came out pure
    // red, magenta or green against a scene made of khaki and teal.
    //
    // cross(up, dir) = cos(lean) * cross(n, dir), which is only degenerate at a
    // 90 degree lean — and the lean is capped at 72.
    const right = norm(cross(up, dir));
    const fwd = cross(right, up);

    // Length spread. The earlier 0.40 + 1.45*r^1.7 put the median at 0.85 and
    // the p90 at 1.61 world units, against the spec's 379-sample protrusion fit
    // of 0.020 of the planet radius = 0.52 here. Rendered, that read as fur:
    // long bright streaks lying across the whole disc rather than a fringe.
    // p50 0.48 / p90 0.93 keeps the silhouette spikes and drops the mat.
    const len = 0.22 + 0.85 * Math.pow(Math.random(), 1.7);
    const wid = 0.7 + 0.7 * Math.random();
    const groundR = opts.planetRadius + (opts.heightAt ? opts.heightAt(n) : 0);
    const p: V3 = [n[0] * groundR, n[1] * groundR, n[2] * groundR];

    // Never let a non-finite value reach the instance buffer. A poisoned matrix
    // is invisible at the call site and only shows up as garbage pixels many
    // frames later, which is exactly how the bug above survived this long.
    if (!Number.isFinite(right[0] + up[0] + fwd[0] + len + wid)) { degenerate++; continue; }

    const o = written * 16;
    transforms[o] = right[0] * wid; transforms[o + 1] = right[1] * wid; transforms[o + 2] = right[2] * wid; transforms[o + 3] = 0;
    transforms[o + 4] = up[0] * len; transforms[o + 5] = up[1] * len; transforms[o + 6] = up[2] * len; transforms[o + 7] = 0;
    transforms[o + 8] = fwd[0] * wid; transforms[o + 9] = fwd[1] * wid; transforms[o + 10] = fwd[2] * wid; transforms[o + 11] = 0;
    transforms[o + 12] = p[0]; transforms[o + 13] = p[1]; transforms[o + 14] = p[2]; transforms[o + 15] = 1;
    written++;
  }

  if (degenerate > 0) {
    console.warn(`[planet-snake] grass: dropped ${degenerate} degenerate blades`);
  }
  if (written === 0) {
    console.warn('[planet-snake] grass: keep() rejected every sample — no blades placed');
    return { entities: [], chunks: [] };
  }

  // The ECS backs an `array<f32>` field with a BufferPool slot capped at
  // 262144 bytes (buffer-pool.ts:135-136), so ONE entity holds at most
  // 262144/64 = 4096 instances. Overshooting does not throw at the call site;
  // it routes a structured error through `World.write (Instances.transforms)`
  // and the component simply never lands, which presents as no grass at all.
  // Splitting into patches is therefore a hard requirement, not an optimisation.
  const PER_PATCH = 3000;
  const entities: EntityHandle[] = [];
  const chunks: Float32Array[] = [];
  const doSpawn = opts.spawn !== false;
  for (let start = 0; start < written; start += PER_PATCH) {
    const n = Math.min(PER_PATCH, written - start);
    // slice(), not subarray(): the column copies from the payload's own buffer,
    // so hand it an exact-size array starting at offset 0.
    const chunk = transforms.slice(start * 16, (start + n) * 16);
    chunks.push(chunk);
    if (!doSpawn) continue;
    entities.push(
      world
        .spawn(
          { component: components.Transform, data: { pos: [0, 0, 0] } },
          { component: components.MeshFilter, data: { assetHandle: handle } },
          { component: components.MeshRenderer, data: { materials: [material] } },
          { component: components.Instances, data: { transforms: chunk } },
        )
        .unwrap() as EntityHandle,
    );
  }
  console.log(doSpawn
    ? `[planet-snake] grass: ${written} blades in ${entities.length} patches`
    : `[planet-snake] grass: SUPPRESSED (?nograss) — ${written} blades scattered, none spawned`);
  return { entities, chunks };
}
