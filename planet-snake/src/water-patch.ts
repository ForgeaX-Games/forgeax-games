// Real water-surface geometry — a CPU-animated patch that follows the snake.
//
// WHY GEOMETRY, AND WHY ONLY A PATCH
//
// The ocean is the planet sphere with a water shading branch, and the forward
// pass has no clock — so the sea's NORMAL is frozen, and everything "moving"
// about the water is added by the post pass, which runs AFTER the tonemap and
// can only add display-space brightness. Three things are structurally out of
// reach from there: a specular that lives in HDR and goes through the real
// tonemap, waves with an actual silhouette/parallax, and refraction. Those need
// the forward pass to see a moving surface.
//
// The one channel this game has for per-frame data into the forward pass is the
// snake's own body path: build vertices on the CPU and push them through the
// game-to-engine bridge (see ribbon.ts, which proved every part of it — the
// seed-AABB contract, the residency failures, the 12-float layout). A patch
// of ~2.7k vertices at ~130KB/frame is the same order of traffic as the bots'
// tubes. The FULL sphere at wave resolution would be hundreds of thousands of
// vertices re-uploaded per frame; the far field and the limb keep the painted
// water, which is exactly the region where crests are subpixel anyway.
//
// The patch's material is the same `ps_surface` graft the planet uses (variant
// 'forgeax::planet-snake-water'), so its albedo comes from the SAME field the
// painted water is coloured by — the patch matches the sea around it by
// construction, not by tuning. The variant differs in exactly three ways:
// roughness/F0 are those of a moving water surface (the painted sheet's 0.60
// exists to hide a frozen normal's coherent glare), the normal is the CPU wave
// normal arriving as the mesh normal, and fragments over land are discarded so
// the painted beach/foam line stays authoritative at the coast.
//
// The wave model is the SAME three directional trains as the post pass's
// psWaveH (space.wgsl) — same headings, wavenumbers and speeds — so the post's
// sparkle and this geometry describe one sea rather than two superimposed ones.
//
// WHAT THE SNAKE DOES TO IT
//
// The swell alone is ambient: it would look identical with the snake parked.
// the reference's field is deformed by the rider — its deformSim buffer carries a
// depression channel and a SEPARATE displaced-mass channel, "the channel that
// separates a trail with berms from a flat footprint decal", splatted along the
// path and relaxed over time. Ours is the water version of the same shape: a
// trough carved along the trail with a raised bow wave either side of it,
// scaled by SPEED so a boost visibly digs harder, and healing with age because
// water closes over.
//
// It is carried by the same wake polyline the post pass reads
// (`buildWakeSamples`), through the same soft-min the WGSL `wakeField` uses, so
// the foam painted in the post pass sits exactly on the trough this carves
// rather than drifting a metre off it.

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import { updateMesh } from './engine-bridge';
import { landField } from './surface';

type V3 = [number, number, number];

/** position(3) + normal(3) + uv(2) + tangent(4) — meshFromInterleaved's
 *  runtime layout, same as ribbon.ts. */
const FLOATS_PER_VERTEX = 12;

/** Verts per side. 64x64 = 4096 verts, 7938 tris, ~200KB per frame upload.
 *
 *  Raised from 52 together with a tighter HALF, and the reason is the wake, not
 *  the swell: vertex spacing sets the STEEPEST slope the sheet can hold, and a
 *  trough the grid cannot resolve stays a shallow dish however deep it is
 *  driven — which is what "the water still isn't affected by the movement"
 *  looked like. 0.22 rad over 64 verts is 0.0069 rad a quad, so the trough
 *  (half-width 0.032 rising to 0.055) spans 5 to 8 of them. */
// Raised with HALF below, so the sheet covers more sea WITHOUT coarsening it:
// 96 over 0.27 rad is 0.29 world units a vertex, which is what 64 over 0.152
// was. The cost is 2.2x the vertices, and this is the one mesh in the game
// whose size is decided by what has to FIT on it rather than by how it looks.
const N = 96;
/** Patch half-angle in radians — 0.22 rad is 7.9 world units at radius 36. */
// Angular, so a bigger planet would silently make the same 64x64 grid cover
// more world area and coarsen every wave on it. Held at ~7.9 WORLD units, which
// is what this resolution was tuned against and what Bloom's reach is bounded
// by: 0.22 rad at R=36 is 0.152 rad at R=52.
// A the reference-scale crater is about ten units across with its rim. At 0.152 rad
// the sheet was 7.9 units wide in total, so a dent could not fit inside its own
// surface: faded at the edge it vanished (0.64% of the screen), and not faded
// it tore a hole where the sheet ended and the flat painted sea began. The
// patch has to be bigger than the biggest thing that happens on it.
const HALF = 0.27;
/** So the post pass can gate the dents by where the sheet actually is. */
export const PATCH_HALF = 0.27;
/** The sheet floats this far above the painted water.
 *
 *  INVARIANT: HOVER > sum(TRAIN_A). A wave trough sits HOVER - sum(TRAIN_A)
 *  above the painted sea, and at the first value (0.03 against an amplitude sum
 *  of 0.071) every trough SANK BELOW it — the painted water then occluded the
 *  live sheet and the holes rendered as flat grey polygons with visible
 *  triangle edges drifting over the sea. Isolated by capturing the same frozen
 *  pose with ?nospace=1 (patch on, holes present) against ?nowater=1 (patch
 *  off, clean). The step is still subpixel from play distance. */
const HOVER = 0.13;
/** Re-exported so the post pass's water band can accept the sheet as well as
 *  the painted sea — see SpaceCamera.waterLift. */
export const WATER_LIFT = HOVER;

// The trains — keep in lockstep with psWaveH in space.wgsl.
const D1: V3 = [0.31, 0.12, -0.94];
const D2: V3 = [-0.77, 0.35, 0.53];
const D3: V3 = [0.62, -0.2, 0.75];
const TRAIN_K = [130, 95, 62];
const TRAIN_W = [1.9, 1.45, 1.05];
/** World-unit amplitudes. Their SUM is the trough depth HOVER has to clear.
 *
 *  Cut ~35% from 0.030/0.024/0.017. This is the AMBIENT chop, and it was the
 *  larger half of "too much noise, tiring to look at" — it covers the whole
 *  sheet at all times, whereas the wake below is the part that actually says
 *  something. Lowering the background and leaving the wake alone keeps the sea
 *  responsive to the snake while calming what the eye has to sit in. */
const TRAIN_A = [0.020, 0.016, 0.011];

/** Trough half-width in world units at the head, and how much it opens with age.
 *  These are the same values `wakeField` uses for the visible foam. A fresh
 *  1.24-unit-wide body now cuts a 1.24-unit-wide wake; the oldest visible part
 *  opens only to 1.68 units instead of swelling to 3.10 before edge variation. */
const WAKE_HALF_WIDTH_START = 0.62;
const WAKE_HALF_WIDTH_GROWTH = 0.22;
/** World-unit trough depth and bow-wave height at speed 1. Both scale with
 *  speed, so a boost visibly digs harder.
 *
 *  Fitted by cranking BERM to 0.60 first, which proved the path was live and
 *  showed the shape clearly (two ridges with shadowed inner faces) — at the
 *  0.055 it started from, the deformation was real but too small to read at
 *  play distance, which is indistinguishable from "not working". The ceiling
 *  is the post pass's water band: a crest that rides higher than the band's
 *  outer edge loses its sky reflection and goes dark, so BERM * maxSpeed has to
 *  stay inside the window space.wgsl opens (0.26). */
const WAKE_DEPTH = 0.165;
/** DENTS — the shared way a skill deforms the sea.
 *
 *  Four slots, each (centre, radius, depth, rim, drive). Bloom takes one;
 *  Sweep takes three spread along its crest, because the crest is an ARC
 *  seventeen units across and one disc under its middle would leave the horns
 *  ploughing nothing.
 *
 *  THE PROFILE IS DUPLICATED IN src/space.wgsl AND MUST STAY IN STEP. The post
 *  pass cannot see these vertices, and it has to know where the sheet went for
 *  two separate reasons — see the note there. If one moves the other has to.
 *
 *  Depths here are REAL (over a unit), not the 0.13 the first version managed.
 *  That version was bounded by two things and both are now lifted in the
 *  shader: the sheet could not sink past the sea painted 0.118 beneath it, and
 *  anything rising more than 0.30 fell out of the window the post pass accepts
 *  and went dark. */
const DENT_SLOTS = 4;
export const DENT_FLOATS = DENT_SLOTS * 8;
const WAKE_BERM = 0.13;

export interface WaterPatch {
  entity: EntityHandle;
  /** Debug A/B: force the hand-over channel flat (pre-fix behaviour). */
  seamTest(on: boolean): boolean;
  /**
   * Rebuild the sheet centred under `anchor` (unit dir) at time `clock`.
   *
   * `wake` is buildWakeSamples()'s flat [worldX,worldY,worldZ,age] x N — w >=
   * 1.5 marks an unused slot. Water only needs direction, so this consumer
   * normalises xyz; land keeps the radius to respect terrain relief. `speed` is
   * the snake's speed as a multiple of its cruise speed, which is what makes a
   * boost dig a visibly deeper trough.
   */
  update(
    anchor: readonly number[], clock: number, wake?: Float32Array, speed?: number,
    /** Bloom's crater: unit direction of the eruption and a 0..1 drive that the
     *  skill itself heals to zero over about a second.
     *
     *  A THIRD height contributor beside the swell and the wake, entering
     *  through the same per-term structure so the sea has one shape rather than
     *  three superimposed ones. Transient BY CONSTRUCTION: the caller owns the
     *  healing, because water does not hold a hole and a permanent dent in the
     *  sea would say the ocean is a solid. */
    /** DENT_FLOATS of (cx,cy,cz,radius, depth,rim,drive,_) x DENT_SLOTS. */
    dents?: Float32Array,
  ): void;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** d/dx of smooth(a, b, x). The wake has to shade, and shading needs the SLOPE
 *  of the profile, not just its height — a displaced surface whose normals stay
 *  flat reads as a texture no matter how far the vertices moved. */
const smoothD = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return (6 * t * (1 - t)) / (b - a);
};

export function createWaterPatch(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  /** The painted water's radius — PLANET_R + 0.05, the displaced sphere's base. */
  baseRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
): WaterPatch | undefined {
  // Isolation switch, same contract as ?noribbon / ?nograss.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nowater')) {
    return undefined;
  }

  const vertexCount = N * N;
  const quads = (N - 1) * (N - 1);
  const indices = new Uint16Array(quads * 6);
  let k = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const d = a + N;
      const e = d + 1;
      // Winding mirrors ribbon.ts: with e2 = cross(anchor, e1) the (+x, +y)
      // step pair is right-handed about the outward normal, and this order
      // puts the front face outside under the engine default (cull back, ccw).
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = b; indices[k++] = e; indices[k++] = d;
    }
  }

  // Seed geometry — the ribbon's AABB contract, restated for a grid: the mesh's
  // local AABB is derived from THESE positions and updateMesh never touches it,
  // so the seed must span the whole sphere the patch will ever slide over. Each
  // grid ROW collapses to one Fibonacci-scattered point: every triangle above
  // has two vertices in the same row, so the seed rasterises nothing, while the
  // row points still touch all six faces of the bounding box.
  const seed = new Float32Array(vertexCount * 8);
  const seedR = baseRadius + 1.5;
  for (let j = 0; j < N; j++) {
    const y = 1 - (2 * (j + 0.5)) / N;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = j * 2.399963229728653;
    const px = Math.cos(th) * rr;
    const pz = Math.sin(th) * rr;
    for (let i = 0; i < N; i++) {
      const b = (j * N + i) * 8;
      seed[b] = px * seedR; seed[b + 1] = y * seedR; seed[b + 2] = pz * seedR;
      seed[b + 3] = px; seed[b + 4] = y; seed[b + 5] = pz;
      seed[b + 6] = i / (N - 1); seed[b + 7] = j / (N - 1);
    }
  }
  const mesh = meshFromInterleaved(seed, indices);
  const handle = world.allocSharedRef('MeshAsset', mesh) as number;

  const entity = world
    .spawn(
      { component: components.Transform, data: { pos: [0, 0, 0] } },
      { component: components.MeshFilter, data: { assetHandle: handle } },
      { component: components.MeshRenderer, data: { materials: [material] } },
    )
    .unwrap() as EntityHandle;

  const verts = new Float32Array(vertexCount * FLOATS_PER_VERTEX);

  // Push contract copied from ribbon.ts: residency takes a frame or two, a
  // catch-all that stays quiet forever is how a dead update loop hid for two
  // sessions.
  let pushFailures = 0;
  let reported = false;
  const push = (): void => {
    try {
      if (!updateMesh(renderer, handle, verts, indices)) {
        if (!reported) {
          reported = true;
          console.warn('[planet-snake] water patch: dynamic mesh upload unavailable — keeping the resident seed mesh');
        }
        return;
      }
      pushFailures = 0;
    } catch (e) {
      pushFailures++;
      if (pushFailures === 8 && !reported) {
        reported = true;
        console.error('[planet-snake] water patch: updateMesh keeps failing —', (e as Error)?.message ?? e);
      }
    }
  };

  // Parallel-transported tangent frame. Rebuilt from a fixed axis it would snap
  // whenever the anchor crossed the axis-select boundary; carried frame-to-frame
  // it stays continuous, and the grid never visibly reorients because the wave
  // field is evaluated in world direction, not in grid space.
  let e1x = 1, e1y = 0, e1z = 0;

  /** Debug: write the channel flat, reproducing the pre-fix material step.
   *  The seam only shows where the sun's glare crosses the boundary, so an
   *  A/B at one instant is the only honest way to see whether it is gone. */
  let seamTest = false;

  return {
    seamTest(on: boolean) { seamTest = on; return seamTest; },
    entity,
    update(anchor, clock, wake, speed, dents) {
      const wk = wake;
      // Segment count: pairs of CONSECUTIVE live samples. A slot with w >= 1.5
      // is the "unused" sentinel buildWakeSamples writes before the trail is
      // long enough, and reading past it would drag the wake to the origin.
      let nSeg = 0;
      if (wk) {
        const n4 = (wk.length / 4) | 0;
        for (let i = 0; i + 1 < n4; i++) {
          if (wk[i * 4 + 3]! > 1.5 || wk[i * 4 + 7]! > 1.5) break;
          nSeg = i + 1;
        }
      }
      // Cruise digs a visible trough; a boost digs about twice as deep.
      const spd = Math.min(2.2, Math.max(0, speed ?? 1));
      const dn = dents;
      let ax = anchor[0] ?? 0, ay = anchor[1] ?? 1, az = anchor[2] ?? 0;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;

      // Re-orthogonalise the carried e1 against the new anchor.
      const dotEA = e1x * ax + e1y * ay + e1z * az;
      e1x -= ax * dotEA; e1y -= ay * dotEA; e1z -= az * dotEA;
      let el = Math.hypot(e1x, e1y, e1z);
      if (el < 1e-4) {
        // Degenerate only if the anchor swung a right angle in one frame; pick
        // the least-aligned axis and continue.
        if (Math.abs(ax) < 0.9) { e1x = 1; e1y = 0; e1z = 0; } else { e1x = 0; e1y = 1; e1z = 0; }
        const d2 = e1x * ax + e1y * ay + e1z * az;
        e1x -= ax * d2; e1y -= ay * d2; e1z -= az * d2;
        el = Math.hypot(e1x, e1y, e1z);
      }
      e1x /= el; e1y /= el; e1z /= el;
      const e2x = ay * e1z - az * e1y;
      const e2y = az * e1x - ax * e1z;
      const e2z = ax * e1y - ay * e1x;

      const t = clock;
      const dir: V3 = [0, 0, 0];
      for (let j = 0; j < N; j++) {
        const gy = (j / (N - 1)) * 2 - 1;
        for (let i = 0; i < N; i++) {
          const gx = (i / (N - 1)) * 2 - 1;
          const du = gx * HALF;
          const dv = gy * HALF;
          // Chord offset then normalize — exact enough at 0.26 rad.
          let dx = ax + e1x * du + e2x * dv;
          let dy = ay + e1y * du + e2y * dv;
          let dz = az + e1z * du + e2z * dv;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;

          // Per-vertex tangent plane (for the analytic normal).
          const de1 = e1x * dx + e1y * dy + e1z * dz;
          let t1x = e1x - dx * de1, t1y = e1y - dy * de1, t1z = e1z - dz * de1;
          const t1l = Math.hypot(t1x, t1y, t1z) || 1;
          t1x /= t1l; t1y /= t1l; t1z /= t1l;
          const t2x = dy * t1z - dz * t1y;
          const t2y = dz * t1x - dx * t1z;
          const t2z = dx * t1y - dy * t1x;

          // Amplitude envelope: die toward the shore (the shelf is calm and the
          // fragment discard needs a quiet boundary) and toward the patch rim
          // (where the sheet has to meet the painted flat water without a lip).
          dir[0] = dx; dir[1] = dy; dir[2] = dz;
          const f = landField(dir);
          const shore = 1 - smooth(-0.045, -0.008, f);
          // Rim fade spans the outer half of the patch. Two narrower fades
          // (0.74, then 0.60) both left a readable straight edge where the
          // sun's glare crossed the boundary — the seam is a specular-character
          // step (live broken HDR sparkle inside, painted sheen outside), so
          // the geometry has to hand over as gradually as the budget allows,
          // and the material gap is narrowed from both sides in surface.ts /
          // terrain-material.ts as well.
          const rim = 1 - smooth(0.5, 0.95, Math.hypot(gx, gy));
          const amp = shore * rim;

          let h = 0, g1 = 0, g2 = 0;
          if (amp > 0.002) {
            for (let w = 0; w < 3; w++) {
              const D = w === 0 ? D1 : w === 1 ? D2 : D3;
              const th2 = TRAIN_K[w]! * (dx * D[0] + dy * D[1] + dz * D[2]) - TRAIN_W[w]! * t;
              const s = Math.sin(th2);
              const c = Math.cos(th2) * TRAIN_A[w]! * TRAIN_K[w]! * amp;
              h += TRAIN_A[w]! * s * amp;
              g1 += c * (D[0] * t1x + D[1] * t1y + D[2] * t1z);
              g2 += c * (D[0] * t2x + D[1] * t2y + D[2] * t2z);
            }
          }

          // ── the snake's own wake, as GEOMETRY ────────────────────────────
          // Exact segment distance plus softly blended age, matching wakeField
          // in space.wgsl. Distance stays metric while age crosses segment
          // boundaries smoothly, so the painted foam remains on the trough.
          if (nSeg > 0 && amp > 0.002) {
            let acc = 0, accAge = 0, sqx = 0, sqy = 0, sqz = 0;
            let best = Number.POSITIVE_INFINITY;
            for (let k2 = 0; k2 < nSeg; k2++) {
              const o = k2 * 4;
              let ax2 = wk![o]!, ay2 = wk![o + 1]!, az2 = wk![o + 2]!;
              let bx2 = wk![o + 4]!, by2 = wk![o + 5]!, bz2 = wk![o + 6]!;
              const al2 = Math.hypot(ax2, ay2, az2) || 1;
              const bl2 = Math.hypot(bx2, by2, bz2) || 1;
              ax2 /= al2; ay2 /= al2; az2 /= al2;
              bx2 /= bl2; by2 /= bl2; bz2 /= bl2;
              const abx = bx2 - ax2, aby = by2 - ay2, abz = bz2 - az2;
              const den = Math.max(abx * abx + aby * aby + abz * abz, 1e-8);
              let u = ((dx - ax2) * abx + (dy - ay2) * aby + (dz - az2) * abz) / den;
              u = u < 0 ? 0 : u > 1 ? 1 : u;
              let qx = ax2 + abx * u, qy = ay2 + aby * u, qz = az2 + abz * u;
              const ql = Math.hypot(qx, qy, qz) || 1;
              qx /= ql; qy /= ql; qz /= ql;
              const dd = Math.hypot(dx - qx, dy - qy, dz - qz);
              const wgt = Math.exp(-dd * 40);
              if (dd < best) best = dd;
              acc += wgt;
              accAge += wgt * (wk![o + 3]! + (wk![o + 7]! - wk![o + 3]!) * u);
              sqx += wgt * qx; sqy += wgt * qy; sqz += wgt * qz;
            }
            if (acc > 4e-11) {
              const age = Math.min(1, Math.max(0, accAge / acc));
              // Widens behind the snake the way a boat's wake opens out.
              const halfW = (WAKE_HALF_WIDTH_START + WAKE_HALF_WIDTH_GROWTH * age) / baseRadius;
              const dn = best / halfW;
              if (dn < 1.9) {
                // the reference's depression profile: a flat-ish floor and a fast
                // shoulder, NOT a Gaussian — "a boot compresses a floor, it
                // does not dimple". Here the floor is the flattened water the
                // body has just pushed through.
                const core = 1 - smooth(0.42, 1.0, dn);
                // The displaced mass, as its own term. This is the difference
                // between a wake and a dent painted on flat water: the trough
                // has to throw up a bow wave, and it is that raised edge that
                // catches the sun and gives the wake a silhouette.
                const rd = (dn - 1.04) * 3.4;
                const ring = Math.exp(-rd * rd);
                // Heals with age, because water closes over — the reason this
                // reads as water and the reference's equivalent reads as snow is
                // almost entirely in how fast this term goes to zero.
                const heal = (1 - age) * (1 - age);
                const drive = spd * heal * amp;
                // The bow wave SATURATES with speed while the trough does not.
                // Two reasons and they agree: a hull's bow wave stops growing
                // once it is throwing spray rather than lifting water, and a
                // crest that rides above the post pass's water band loses its
                // sky reflection and turns dark.
                const driveB = Math.min(spd, 1.5) * heal * amp;
                // Analytic slope of the same profile, so the trough SHADES —
                // without it the geometry moves and the lighting does not, and
                // the whole thing reads as a texture again.
                const dCore = -smoothD(0.42, 1.0, dn);
                const dRing = -2 * rd * 3.4 * ring;
                let hWake = WAKE_BERM * ring * driveB - WAKE_DEPTH * core * drive;
                let dH = (WAKE_BERM * dRing * driveB - WAKE_DEPTH * dCore * drive) / halfW;
                // The sheet may never sink below the painted sea it floats on:
                // the painted water would occlude it and the hole renders as a
                // flat grey polygon. The trough therefore bottoms out at the
                // ambient sea level, which is also what a real wake does — the
                // water it displaced has nowhere further to go.
                //
                // HEIGHT AND SLOPE ARE SCALED TOGETHER. Clamping the height
                // alone left flat water carrying the normal of a 40-degree face
                // pointing away from both sun and sky, and deep water with F0
                // 0.048 shades that NEARLY BLACK — jagged black shards floating
                // beside the snake, whose outline was the clamp's contour.
                // Slope ceiling. Deep water's albedo is (0.008, 0.080, 0.122)
                // and its F0 is 0.048, so a face tilted away from both sun and
                // sky shades NEARLY BLACK — and the post pass's sky reflection
                // cannot rescue it, because that term is built from the post's
                // own analytic wave normal and knows nothing about this
                // geometry. Capping the tilt near 22 degrees keeps every face
                // catching something. Erring toward a shallower NORMAL than the
                // geometry is the safe direction; the opposite is what put
                // black shards on the sea.
                const dMax = 0.40 * baseRadius;
                if (dH > dMax) dH = dMax; else if (dH < -dMax) dH = -dMax;

                const floorH = -(HOVER - 0.012);
                if (h + hWake < floorH && hWake < -1e-6) {
                  const k = (floorH - h) / hWake;
                  hWake *= k; dH *= k;
                }
                h += hWake;
                // d(best)/d(tangent) is the unit vector from the trail toward
                // this vertex, projected into the tangent plane.
                let cx = dx - sqx / acc, cy = dy - sqy / acc, cz = dz - sqz / acc;
                const cl = Math.hypot(cx, cy, cz);
                if (cl > 1e-5) {
                  cx /= cl; cy /= cl; cz /= cl;
                  g1 += dH * (cx * t1x + cy * t1y + cz * t1z);
                  g2 += dH * (cx * t2x + cy * t2y + cz * t2z);
                }
              }
            }
          }

          // ── Bloom's crater ────────────────────────────────────────────
          // A hole with a thrown rim. The hole is bounded by the same floor the
          // whole sheet obeys — 0.118 units is all there is between the sheet
          // and the sea painted under it — so the DEPTH has to come from the
          // rim, exactly as it did for the vortex before it. The rim is kept
          // under 0.25 for a second reason: the post pass accepts the sheet
          // inside a 0.30 window around its rest height, and anything that
          // climbs out of that window loses its glints and its foam and goes
          // dark, which is the most expensive way to draw a highlight.
          // ── dents: what the skills have pushed the sea into ───────────
          let dentDown = 0;
          if (dn) {
            // FADE THE DENT OUT BEFORE THE SHEET'S OWN EDGE, and match the same
            // curve in src/space.wgsl.
            //
            // The sheet is a patch ~8 units across; a dent that is still going
            // when the patch stops leaves a cliff between the sheet's rim and
            // the flat painted sea beyond it, and you see straight past it.
            // Measured as a torn black wedge on the far side of the crater. The
            // post pass gate alone did not fix it — that stops the SHADING from
            // following a dent out of the patch, and this is the geometry not
            // following it either. Both, or neither works.
            const cAnchor = Math.min(1, Math.max(-1, dx * ax + dy * ay + dz * az));
            const edgeFade = 1 - smooth(Math.cos(HALF * 0.94), Math.cos(HALF * 0.66), cAnchor);
            for (let q2 = 0; q2 < DENT_SLOTS; q2++) {
              const o2 = q2 * 8;
              const drive = dn[o2 + 6]!;
              if (drive <= 0.002) continue;
              const rad = dn[o2 + 3]!;
              if (rad <= 0.001) continue;
              const cx2 = dn[o2]!, cy2 = dn[o2 + 1]!, cz2 = dn[o2 + 2]!;
              const cc = Math.min(1, Math.max(-1, dx * cx2 + dy * cy2 + dz * cz2));
              const qq = (Math.acos(cc) * baseRadius) / rad;
              if (qq > 2.6) continue;
              const depth = dn[o2 + 4]!, rimH = dn[o2 + 5]!;
              // A FLAT FLOOR AND A FAST SHOULDER, not a Gaussian — the reference's
              // own rule for this shape: "a boot compresses a floor, it does
              // not dimple". A smooth bowl over the full radius reads as a
              // gentle swell at this camera distance, which is what the first
              // version of this looked like.
              const hole = qq < 1 ? (1 - qq * qq * qq) * depth : 0;
              const rq2 = (qq - 1.25) / 0.5;
              const rim2 = Math.exp(-rq2 * rq2) * rimH;
              const dr = drive * edgeFade;
              h += (rim2 - hole) * dr;
              // How far this point has been pushed BELOW the rest sheet, which
              // is what the floor clamp has to make room for.
              dentDown += hole * dr;
              // Analytic slope, so the walls of the hole and the lip of the rim
              // catch the light instead of being a shape the shading does not
              // know is there.
              let ox2 = dx - cx2, oy2 = dy - cy2, oz2 = dz - cz2;
              const on2 = dx * ox2 + dy * oy2 + dz * oz2;
              ox2 -= dx * on2; oy2 -= dy * on2; oz2 -= dz * on2;
              const ol2 = Math.hypot(ox2, oy2, oz2);
              if (ol2 > 1e-5) {
                ox2 /= ol2; oy2 /= ol2; oz2 /= ol2;
                const dHole = qq < 1 ? 3 * qq * qq * depth : 0;
                const dRim = rim2 * (-2 * rq2 / 0.5);
                const dH3 = ((dHole + dRim) * dr * baseRadius) / rad;
                g1 += dH3 * (ox2 * t1x + oy2 * t1y + oz2 * t1z);
                g2 += dH3 * (ox2 * t2x + oy2 * t2y + oz2 * t2z);
              }
            }
          }

          // The painted sea is a hard floor for the SUM — but the floor MOVES
          // with a dent. The post pass drops the radius it paints the sea at by
          // the same depression this vertex has (the duplicated profile), so
          // there is nothing to punch through inside a crater. Without this the
          // hole would still be capped at 0.118 units, which is a tenth of a
          // snake and is exactly why the first version of this was invisible.
          const floorH = -(HOVER - 0.012) - dentDown;
          if (h < floorH) h = floorH;

          // Height-field normal on a sphere: n = dir - grad_tangential / r.
          const inv = 1 / baseRadius;
          let nx = dx - (t1x * g1 + t2x * g2) * inv;
          let ny = dy - (t1y * g1 + t2y * g2) * inv;
          let nz = dz - (t1z * g1 + t2z * g2) * inv;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;

          const r = baseRadius + HOVER + h;
          const b = (j * N + i) * FLOATS_PER_VERTEX;
          verts[b] = dx * r; verts[b + 1] = dy * r; verts[b + 2] = dz * r;
          verts[b + 3] = nx; verts[b + 4] = ny; verts[b + 5] = nz;
          verts[b + 6] = i / (N - 1); verts[b + 7] = j / (N - 1);
          verts[b + 8] = t1x; verts[b + 9] = t1y; verts[b + 10] = t1z;
          // tangent.w carries the SAME envelope the geometry uses, so the
          // material hands over to the painted sea on exactly the line the
          // waves die on.
          //
          // Fading the amplitude alone never closed this seam — two earlier
          // attempts (0.74, then 0.60) are recorded above. It cannot: the step
          // is not in the height field, it is in the SHADING MODEL. The patch
          // runs roughness 0.38 / F0 0.048 and the painted sea runs 0.56 /
          // 0.030, so wherever the sun's glare crossed the boundary the eye got
          // a straight edge hundreds of pixels long between live sparkle and
          // flat sheen — and a straight edge is the one thing open water never
          // has. terrain-material.ts reads this channel and lerps both back.
          verts[b + 11] = seamTest ? 1 : amp;
        }
      }
      push();
    },
  };
}
