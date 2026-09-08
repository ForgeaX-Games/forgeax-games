// Skill 5 — Sweep (裂地). A crescent of thrown ground rises ahead of the snake
// and runs outward, ploughing a channel and throwing berms to either side.
//
// THE ONE DECISION: THE CURVATURE IS FIXED
//
// This is the whole shape of the effect: the crescent's radius is a
// CONSTANT, not the distance the wave has travelled. "Using that as the radius
// makes the wave an arc of a circle centred on the caster, and ten metres out
// the crescent is twenty metres wide — a ridge in the terrain rather than
// something thrown. A wave front has a curvature of its own that has nothing to
// do with how far it has run, so the arc keeps its shape and TRANSLATES, and
// only its span opens up as the ends spread."
//
// THE CHANNEL IS NOT A DECAL
//
// Also theirs: "each frame the live crest writes brushes into the terrain state
// buffer at the position the mesh is actually drawing, so the mark and the wave
// cannot disagree." Our store is src/deform.ts and the brushes go in from the
// same loop that places the crest, for exactly that reason.
//
// And the brushes are spent PER WORLD UNIT TRAVELLED, not per second. A patch of
// ground sits under the brush for (2 * radius / travelled) frames, so cutting
// per unit makes the trench the same depth at any frame rate and at any point on
// the wave's decaying speed curve. Per-second brushing digs a deep pit where the
// wave is slow and a scratch where it is fast, which is backwards.

import type { World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import type { DeformStore } from './deform';
import { createRibbon, type Ribbon, type RibbonSpineSample } from './ribbon';

export type V3 = [number, number, number];

/** Spine samples across the crescent. */
const COLS = 48;
/** Curvature radius, world units. FIXED — see the header. */
const CURVE = 9.0;
/** Half-angle of the arc at cast and at full spread, radians. */
const ARC0 = 0.52;
const ARC1 = 0.96;
/** Seconds from cast to fully collapsed. */
const LIFE = 2.4;
/** Peak crest height at the centre, world units. Taller than the snake: at the
 *  distance this game frames from, a crest the height of the relief the terrain
 *  already has does not read as thrown mass, it reads as a dune. */
const PEAK = 3.2;
/** How far the wave runs before the arc has fully opened, world units. */
const SPREAD_OVER = 22;

export interface Sweep {
  readonly active: boolean;
  /** Unit direction of the crest's midpoint, for hit tests and lights. */
  readonly mid: V3;
  /** Current crest height, world units. 0 once collapsed. */
  readonly height: number;
  /** Walk the live crest: unit direction + local crest height. */
  forEachCrest(step: number, fn: (dir: V3, amp: number) => void): void;
  /** A point on the trough the crest is cutting, at parameter u across the arc.
   *  Slightly BEHIND the crest, like the brushes: the channel is what the wave
   *  has already passed over, not what it is about to. */
  troughAt(u: number, out: V3): V3;
  /** 0..1 envelope — how much wave there is right now. */
  readonly env: number;
  trigger(origin: V3, aim: V3): void;
  update(
    dt: number,
    groundRadius: (d: V3) => number,
    /** 1 over open water, 0 on dry ground. The crest cuts EARTH; over sea it
     *  troughs the water sheet instead, and that heals. */
    wetAt: (d: V3) => number,
    deform: DeformStore | undefined,
    emit: ((at: V3, vel: V3) => void) | undefined,
    light: ((at: V3, radius: number, colour: V3, intensity: number) => void) | undefined,
  ): void;
  cancel(): void;
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
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const bell = (x: number): number => Math.sin(clamp01(x) * Math.PI);

export function createSweep(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  ring: number,
  boundRadius: number,
  planetRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
): Sweep | undefined {
  const crest: Ribbon | undefined = createRibbon(
    world, renderer, material, COLS, ring, boundRadius, components, meshFromInterleaved,
  );
  if (!crest) return undefined;

  const spine: RibbonSpineSample[] = Array.from({ length: COLS }, () => ({
    dir: [0, 0, 1] as V3, fwd: [1, 0, 0] as V3, radius: 0, lift: 0, u: 0, w: 1,
    aspect: 1, roll: 0,
  }));
  /** Live crest directions + amplitudes, for hit tests without recomputing. */
  const crestDir: V3[] = Array.from({ length: COLS }, () => [0, 0, 1] as V3);
  const crestAmp = new Float64Array(COLS);

  let live = false;
  let t = 0;
  let reach = 0;
  let heightNow = 0;
  let envNow = 0;
  let arcNow = ARC0;
  let brushOwed = 0;
  let sprayOwed = 0;
  let hidden = true;
  /** Origin and travel direction, and the frame they define. */
  const org: V3 = [0, 0, 1];
  let fwd: V3 = [1, 0, 0];
  let side: V3 = [0, 1, 0];
  const midDir: V3 = [0, 0, 1];

  const end = (): void => {
    live = false; t = 0; reach = 0; heightNow = 0;
    if (!hidden) { crest.hide(); hidden = true; }
  };

  /** Point on the arc at parameter u, as a unit direction.
   *
   *  On a sphere the "circle centre one curvature radius behind the leading
   *  point" is a point on the sphere, and the arc is the set of directions one
   *  CURVE of arc-length away from it. Everything else follows theirs exactly. */
  const arcPoint = (u: number, arc: number, ahead: number, out: V3): V3 => {
    // Centre: `ahead - CURVE` of arc from the origin, along fwd.
    const ac = (ahead - CURVE) / planetRadius;
    const cc = Math.cos(ac), sc = Math.sin(ac);
    const kx = org[0] * cc + fwd[0] * sc;
    const ky = org[1] * cc + fwd[1] * sc;
    const kz = org[2] * cc + fwd[2] * sc;
    // Outward radial at this angle around the centre, built in the centre's own
    // tangent plane from the travel direction and its side.
    const th = (u - 0.5) * 2 * arc;
    const cs = Math.cos(th), sn = Math.sin(th);
    // Transport fwd/side to the centre by projecting and renormalising — over
    // these distances that is indistinguishable from parallel transport and it
    // never degenerates.
    let fx = fwd[0], fy = fwd[1], fz = fwd[2];
    const fd = fx * kx + fy * ky + fz * kz;
    fx -= kx * fd; fy -= ky * fd; fz -= kz * fd;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    const sx = ky * fz - kz * fy;
    const sy = kz * fx - kx * fz;
    const sz = kx * fy - ky * fx;
    const rx = fx * cs + sx * sn;
    const ry = fy * cs + sy * sn;
    const rz = fz * cs + sz * sn;
    // Walk CURVE of arc from the centre along that radial.
    const bc = Math.cos(CURVE / planetRadius), bs = Math.sin(CURVE / planetRadius);
    out[0] = kx * bc + rx * bs;
    out[1] = ky * bc + ry * bs;
    out[2] = kz * bc + rz * bs;
    const ol = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= ol; out[1] /= ol; out[2] /= ol;
    return out;
  };

  const p0: V3 = [0, 0, 1];
  const p1: V3 = [0, 0, 1];

  return {
    get active() { return live; },
    get mid() { return midDir; },
    get height() { return heightNow; },
    get env() { return envNow; },

    troughAt(u, out) {
      arcPoint(u, arcNow, reach - 1.4, out);
      return out;
    },

    forEachCrest(step, fn) {
      if (!live || heightNow < 0.2) return;
      for (let c = 0; c < COLS; c += Math.max(1, step)) {
        if (crestAmp[c]! < 0.15) continue;
        fn(crestDir[c]!, crestAmp[c]!);
      }
    },

    trigger(origin, aim) {
      const o = norm([origin[0], origin[1], origin[2]]);
      org[0] = o[0]; org[1] = o[1]; org[2] = o[2];
      let f = norm([aim[0], aim[1], aim[2]]);
      const d = f[0] * o[0] + f[1] * o[1] + f[2] * o[2];
      f = norm([f[0] - o[0] * d, f[1] - o[1] * d, f[2] - o[2] * d]);
      fwd = f;
      side = norm(cross(o, f));
      t = 0;
      // Born a little ahead, so the snake is never inside it.
      reach = 2.4;
      brushOwed = 0; sprayOwed = 0;
      live = true;
    },

    update(dt, groundRadius, wetAt, deform, emit, light) {
      if (!live) return;
      t += dt;
      const life01 = t / LIFE;
      if (life01 >= 1) { end(); return; }

      // Speed decays: the wave is LAUNCHED, not driven. That is most of what
      // makes it read as something thrown rather than something being pushed.
      const speed = 16.0 * Math.exp(-t * 1.15) + 2.0;
      const travelled = speed * dt;
      reach += travelled;

      // Rise fast, hold, fall. The fall is quadratic to exactly zero so the last
      // frame of the wave is flat rather than a step.
      const rise = smooth01(t / 0.26);
      const fall = 1 - clamp01((life01 - 0.55) / 0.45);
      const env = rise * fall * fall;
      envNow = env;

      // A wave SPREADS as it runs: the arc opens and the crest thins, so the
      // same mass covers more ground.
      const spread = clamp01((reach - 2.4) / SPREAD_OVER);
      const arc = ARC0 + (ARC1 - ARC0) * spread;
      arcNow = arc;
      const height = PEAK * env / (1 + spread * 0.45);
      heightNow = height;

      if (env <= 0.004) {
        if (!hidden) { crest.hide(); hidden = true; }
      } else {
        hidden = false;
        for (let c = 0; c < COLS; c++) {
          const u = c / (COLS - 1);
          arcPoint(u, arc, reach, p0);
          arcPoint(Math.min(1, u + 0.02), arc, reach, p1);
          crestDir[c]![0] = p0[0]; crestDir[c]![1] = p0[1]; crestDir[c]![2] = p0[2];

          // Along the crest, for the ring frame.
          let tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2];
          const td = tx * p0[0] + ty * p0[1] + tz * p0[2];
          tx -= p0[0] * td; ty -= p0[1] * td; tz -= p0[2] * td;
          const tl = Math.hypot(tx, ty, tz) || 1;

          // Horns taper to nothing. The bell is on `u` rather than on the angle
          // so the two ends close symmetrically however wide the arc has opened,
          // and the sheet degenerates onto its own spine there rather than
          // ending on a cut edge.
          const amp = height * bell(u);
          crestAmp[c] = amp;

          const e = spine[c]!;
          e.dir = [p0[0], p0[1], p0[2]];
          e.fwd = [tx / tl, ty / tl, tz / tl];
          // SUNK, so the base of the wall meets the trench floor it is cutting
          // rather than floating on the undisturbed surface.
          e.lift = groundRadius(e.dir) - boundRadius + amp * 0.5 - 0.22;
          e.radius = amp * 0.5;
          // A BANK, not a pipe: wide across the direction of travel and shallow
          // through it. Rolled forward so the face leans over the channel — as
          // close as a swept tube gets to their crest curling over itself, and
          // without it a crest lying on a hill field is indistinguishable from
          // the hill field.
          e.aspect = 2.3;
          e.roll = -(0.48 + 0.30 * bell(u) * (0.45 + 0.55 * rise));
          e.w = clamp01(env * 1.4);
          // Foam along the whole leading edge, heaviest at the centre.
          e.u = clamp01(0.16 + 0.30 * bell(u));

          if (c === (COLS >> 1)) {
            midDir[0] = p0[0]; midDir[1] = p0[1]; midDir[2] = p0[2];
          }
        }
        crest.update(spine, COLS, boundRadius);

        // Light rides the middle of the crest, LOW, so it grazes the channel it
        // is cutting rather than lighting it from above.
        if (light) {
          const r = groundRadius(midDir) + height * 0.55;
          light([midDir[0] * r, midDir[1] * r, midDir[2] * r], 12, [0.42, 0.74, 1.0], 15 * env);
        }
      }

      // ---- the channel and its berms ------------------------------------
      if (deform && env >= 0.05) {
        brushOwed += travelled;
        // One rank of brushes every 0.5 units of advance. Denser just re-cuts
        // the same trench; sparser leaves it scalloped.
        if (brushOwed >= 0.5) {
          const k = Math.min(brushOwed, 1.4);
          brushOwed = 0;
          const N = 13;
          for (let i = 0; i < N; i++) {
            const u = i / (N - 1);
            const w = bell(u);
            if (w < 0.06) continue;
            // Slightly BEHIND the crest: the channel is what the wave has
            // already passed over, not what it is about to.
            arcPoint(u, arc, reach - 0.9, p0);
            // ONLY ON DRY GROUND. The store is permanent by design — a channel
            // you ploughed is still there when you come back — and that is right
            // for earth and catastrophic for sea: a crest crossing a bay was
            // trenching the SEABED forever, and since terrainHeight reads the
            // store, the water depth and the coastline moved with it. Over water
            // the wave's mark belongs on the sheet, where the dents already put
            // it and where it closes over. The 0.35 is the same threshold the
            // dents use, so the two hand over at exactly one line.
            if (wetAt(p0) >= 0.35) continue;
            arcPoint(Math.min(1, u + 0.02), arc, reach - 0.9, p1);
            const along: V3 = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
            deform.brush(
              [p0[0], p0[1], p0[2]],
              0.9,
              0.62 * k * env * w,   // channel
              0.40 * k * env * w,   // berms at the rim
              along,
              // Long axis ALONG the arc, so the trench is continuous rather
              // than a row of round pits.
              2.6,
            );
          }
        }
      }

      // ---- spray off the crest ------------------------------------------
      if (emit && env >= 0.08) {
        sprayOwed += travelled * 26;
        let n = sprayOwed | 0;
        if (n > 0) {
          sprayOwed -= n;
          if (n > 40) n = 40;
          for (let q = 0; q < n; q++) {
            const u = Math.random();
            const w = bell(u);
            if (w < 0.12) continue;
            arcPoint(u, arc, reach + (Math.random() - 0.2) * 1.2, p0);
            const amp = height * w;
            const r = groundRadius(p0) + amp * (0.55 + 0.6 * Math.random());
            // Outward from the arc's centre — the direction the crest is
            // running — thrown forward and up off its front.
            arcPoint(Math.min(1, u + 0.02), arc, reach, p1);
            const tanX = p1[0] - p0[0], tanY = p1[1] - p0[1], tanZ = p1[2] - p0[2];
            let ox = p0[1] * tanZ - p0[2] * tanY;
            let oy = p0[2] * tanX - p0[0] * tanZ;
            let oz = p0[0] * tanY - p0[1] * tanX;
            const ol = Math.hypot(ox, oy, oz) || 1;
            ox /= ol; oy /= ol; oz /= ol;
            const out = 2.0 + Math.random() * 4.5;
            const up = 2.4 + Math.random() * 4.0 + amp * 1.6;
            emit(
              [p0[0] * r, p0[1] * r, p0[2] * r],
              [ox * out + p0[0] * up, oy * out + p0[1] * up, oz * out + p0[2] * up],
            );
          }
        }
      }
    },

    cancel() { end(); },
  };
}
