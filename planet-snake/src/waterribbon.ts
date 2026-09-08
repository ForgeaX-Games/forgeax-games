// Skill 3 — Ribbon (水鞭). A held, continuous stream of water pouring from the
// snake's head, describing arcs and figure-eights broadside to the camera, and
// thrown when the key comes up.
//
// This is a port of the reference's spell 2,
// which replaces the Maelstrom that used to sit on E. The Maelstrom was a good
// picture of a place; this is a thing you do with your hands, and that turns out
// to be what the key wanted all along.
//
// THE ONE DECISION, and it is theirs verbatim
//
// The ribbon is a RECORD OF WHERE ITS TIP HAS BEEN, not a shape recomputed each
// frame from where the snake is now. That is the whole of it. Swing the camera
// and the water does not swing with it — the tip goes, and the body follows a
// fraction of a second later, trailing through the arc the tip drew. It is also
// why letting go does not despawn anything: the tip stops being driven, the tail
// keeps retiring, and the ribbon eats itself from behind.
//
// Everything else follows from that. A shape recomputed per frame has no
// momentum and cannot be thrown, only teleported.
//
// WHY A FIGURE-EIGHT
//
// Not decoration. Bent water reads as bent when it doubles back on itself, and a
// tip driven only by the direction of travel draws a straight line. The
// Lissajous runs in the CAMERA's own right/up plane so the pattern is always
// broadside to the viewer however the planet has rolled underneath — the same
// argument the reference makes, and it matters more here because our camera swings
// around a sphere rather than sitting behind a walking character.
//
// Two extra harmonics, both incommensurate with the fundamental and with each
// other: a pure 2:1 Lissajous closes on itself every cycle, so the tip retraces
// the identical path forever and the ribbon lies on top of its own previous
// pass, which reads as a flat repeating sign.
//
// WHAT THE SPHERE CHANGES
//
// Three things, all in the physics rather than the shape:
//   - gravity points at the planet centre, not down a fixed axis;
//   - the ground is a radius per direction, not a height per (x, z);
//   - a ribbon thrown into the air can end up pointing straight up, where the
//     swept tube's usual frame (the sphere normal) is parallel to the spine and
//     degenerates. The guard for that lives in ribbon.ts, where the frame is
//     built.
//
// NO LIGHT — also theirs, also deliberate. The other two skills are events (a
// body tearing out of its own skin, a coil detonating) and light coming out of
// them reads as the energy doing the work. Bent water is just water being moved;
// a glow under it says the water is luminous, which nothing about it suggests.

import type { World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import { createRibbon, type Ribbon, type RibbonSpineSample } from './ribbon';

export type V3 = [number, number, number];

/** Live spine samples. */
const SAMPLES = 48;
/** World units of tip travel between committed samples. */
const STEP = 0.26;
/** Seconds a sample survives once the body has been thrown. */
const TAIL_LIFE = 1.25;
/** Tube radius at the fat part of the body, world units. The snake's own body
 *  radius is 0.62; a stream noticeably finer than the animal that is throwing
 *  it is what keeps it reading as water rather than as a second snake. */
const RADIUS = 0.52;
/**
 * How much wider the section is than it is thick — the reason this reads as a
 * ribbon and not a hose. See the note on `aspect` in ribbon.ts.
 */
const SECTION_ASPECT = 1.55;
/** How far ahead of the head the pattern is centred, world units — along the
 *  SNAKE'S OWN HEADING, not the camera's.
 *
 *  the reference reaches out along the camera forward because its camera looks
 *  horizontally out of a character's eyes, so "forward" and "out in front of
 *  the caster" are the same direction. Ours looks DOWN at a planet: measured,
 *  reaching along it put the pattern's centre four units underground, the
 *  ground clamp pinned the tip to the surface for the entire hold, and the
 *  release splashed on its first frame — the whole thrown body drained in 0.22
 *  seconds. The swing still happens in the camera's plane (that is what keeps
 *  it broadside); only the reach changed. */
// Cut from 4.5 for the reason the reference names about its own throw: "a nine metre
// ribbon seen end-on is nine metres of nothing". Our camera trails the snake, so
// "ahead of the head" and "straight away from the viewer" are the same
// direction — measured, the body stayed a full 48 samples and 21 units the whole
// time while visibly shrinking to a stub, because it was pointing down the
// barrel. The pattern belongs ABOVE and just ahead, in the plane the camera is
// actually looking through.
const REACH = 2.0;
/** How high above the ground the pattern is centred, world units. High enough
 *  that the bottom of the swing only OCCASIONALLY reaches down and drags —
 *  something permanently in contact with the ground stops reading as held in
 *  the air, and a trace scored every cycle turns into a ploughed furrow. */
const HEIGHT = 3.4;
/** Lissajous half-extents, world units: broad across, shallower up. */
const SWING_A = 4.6;
const SWING_B = 2.5;
/** Speed the thrown head builds to, world units a second. The snake cruises at
 *  about 7, so this plainly outruns it without leaving the screen. */
const THROW_SPEED = 21;
/** How fast the head turns onto the aim after release, 1/s. Unhurried on
 *  purpose: snapping the velocity onto the aim makes the body a straight line
 *  immediately, and a straight line is the least legible thing this can do. */
const THROW_STEER = 5.5;
/** Pull toward the planet centre, world units per second squared. */
const GRAVITY = 18;
/** Seconds the head steers onto the aim before it is left to fall. */
const STEER_FOR = 0.30;

export interface WaterRibbon {
  readonly active: boolean;
  readonly held: boolean;
  readonly thrown: boolean;
  /** True once a thrown body has burst — the frame the kill radius applies. */
  readonly splashed: boolean;
  /** Where it burst, world space. Only meaningful while `splashed`. */
  readonly splashAt: V3;
  /** 0..1, how much ribbon there is. Never a switch. */
  readonly blend: number;
  trigger(head: V3): void;
  /** The key came up: the body is THROWN, along `aim`. */
  release(aim: V3): void;
  update(
    dt: number,
    clock: number,
    /** Head position, world space (not a unit direction). */
    head: V3,
    /** Unit heading of the snake's head — where "out in front" is. */
    headFwd: readonly number[],
    camRight: readonly number[],
    camUp: readonly number[],
    /** World radius of the ground under a unit direction. */
    groundRadius: (d: V3) => number,
    /** Called for each droplet the body sheds: position and velocity, world. */
    emit: ((at: V3, vel: V3) => void) | undefined,
  ): void;
  /** Walk the live body for hit tests: world point + section radius. */
  forEachPoint(step: number, fn: (at: V3, radius: number) => void): void;
  /** Drop it (death / restart) without throwing anything. */
  cancel(): void;
  /** Live numbers, so "it looks short" can be checked instead of argued. */
  debug(): {
    on: boolean; held: boolean; thrown: boolean; splashed: boolean;
    alt: number; throwT: number; n: number; len: number;
    blend: number; foamAvg: number; foamMax: number; tipSpd: number;
  };
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** Frame-rate-independent exponential approach. */
const expDamp = (a: number, b: number, rate: number, dt: number): number =>
  b + (a - b) * Math.exp(-rate * dt);

export function createWaterRibbon(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  ring: number,
  boundRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
  /** Sphere radius the lift is measured from. */
  surfaceRadius: number,
): WaterRibbon | undefined {
  const tube: Ribbon | undefined = createRibbon(
    world, renderer, material, SAMPLES + 1, ring, boundRadius, components, meshFromInterleaved,
  );
  if (!tube) return undefined;

  // Ring buffer of committed tip positions, newest at `head`.
  const px = new Float64Array(SAMPLES);
  const py = new Float64Array(SAMPLES);
  const pz = new Float64Array(SAMPLES);
  /**
   * How fast the tip was moving when each sample was laid.
   *
   * This is the body's thickness variation, and it is the one source of it that
   * is neither periodic nor random. A stream of water conserves mass: where it
   * moved fast it is stretched thin, where it slowed at the end of a swing it
   * bunches. Reading the commit-time speed back as a radius means the ribbon is
   * thick and thin in the places the MOTION put it, so no two passes through the
   * same figure-eight look alike.
   */
  const spd = new Float64Array(SAMPLES);
  let headIdx = 0;
  let count = 0;

  const spine: RibbonSpineSample[] = Array.from({ length: SAMPLES + 1 }, () => ({
    dir: [0, 0, 1] as V3, fwd: [1, 0, 0] as V3, radius: 0, lift: 0, u: 0, w: 1,
    aspect: SECTION_ASPECT, roll: 0,
  }));

  let live = false;
  let heldNow = false;
  let thrownNow = false;
  let splashedNow = false;
  const splashPt: V3 = [0, 0, 1];
  let blendNow = 0;
  let phase = 0;
  let throwT = 0;
  let retireOwed = 0;
  let shedOwed = 0;
  let hidden = true;
  /** 0 none, 1 the release shear, 2 the impact fan. Fired inside update(),
   *  which is the only place the emit callback exists. */
  let pendingBurst = 0;
  const tip: V3 = [0, 0, 1];
  const vel: V3 = [0, 0, 0];
  const aimDir: V3 = [0, 0, 1];

  const push = (x: number, y: number, z: number): void => {
    headIdx = (headIdx + 1) % SAMPLES;
    if (count < SAMPLES) count++;
    px[headIdx] = x; py[headIdx] = y; pz[headIdx] = z;
    spd[headIdx] = Math.hypot(vel[0], vel[1], vel[2]);
  };

  /** Append the tip once it has moved a full step. */
  const commit = (): void => {
    if (count === 0) { push(tip[0], tip[1], tip[2]); return; }
    const dx = tip[0] - px[headIdx]!;
    const dy = tip[1] - py[headIdx]!;
    const dz = tip[2] - pz[headIdx]!;
    if (dx * dx + dy * dy + dz * dz >= STEP * STEP) push(tip[0], tip[1], tip[2]);
  };

  /**
   * Resolve the spine into the tube.
   *
   * Column 0 is the LIVE TIP, not the newest committed sample, and the
   * distinction is worth the extra branch. Samples are committed every 0.26
   * units of travel, so a body drawn only from committed samples has a head that
   * advances in 0.26-unit jumps — several frames of the tip standing still
   * followed by one of it teleporting forward. That stutter is at the leading
   * edge, which is the part the eye is locked onto.
   */
  const write = (clock: number, groundRadius: (d: V3) => number): void => {
    const n = Math.min(count + 1, SAMPLES + 1);
    if (n < 3) { if (!hidden) { tube.hide(); hidden = true; } return; }
    hidden = false;

    let ax = tip[0], ay = tip[1], az = tip[2];
    let dist = 0;
    const twist = clock * 2.4;

    for (let j = 0; j < n; j++) {
      const i = (headIdx - (j - 1) + SAMPLES * 2) % SAMPLES;
      const x = j === 0 ? tip[0] : px[i]!;
      const y = j === 0 ? tip[1] : py[i]!;
      const z = j === 0 ? tip[2] : pz[i]!;

      let fx = ax - x, fy = ay - y, fz = az - z;
      let fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-5) {
        // The tip can sit arbitrarily close to the sample behind it — right
        // after a commit it sits exactly on it — so a degenerate segment here is
        // normal and must not produce a NaN tangent.
        const k = (headIdx - j + SAMPLES * 2) % SAMPLES;
        fx = ax - px[k]!; fy = ay - py[k]!; fz = az - pz[k]!;
        fl = Math.hypot(fx, fy, fz) || 1;
      } else if (j > 0) {
        dist += fl;
      }
      const e = spine[j]!;
      e.fwd = [fx / fl, fy / fl, fz / fl];

      const r = Math.hypot(x, y, z) || 1;
      e.dir = [x / r, y / r, z / r];
      e.lift = r - surfaceRadius;

      const u = j / (n - 1);
      // A pointed head, a shoulder just behind it, and a continuous taper all
      // the way to nothing. NO PLATEAU: a constant radius over any part of the
      // body is the definition of a cylinder; a stream tapers everywhere and the
      // only question is how fast.
      // Flattened and foamed where it is skimming the ground: water running
      // over a surface spreads across it rather than staying round.
      const clear = r - groundRadius(e.dir);
      const ground = 1 - clamp01((clear - 0.06) / 0.9);
      const profile = smooth01(u / 0.10) * (1 - u) ** 1.05;
      // Thickness from the speed the tip had when this sample was laid.
      // 0.016, not the reference's 0.055, because our tip is much faster: their
      // swing is 1.7 m wide, ours is 4.6 units, on the same spring. MEASURED at
      // 0.030 the average tip speed was 21-42 and the term sat PINNED at its
      // 0.55 floor down the entire body — the one source of thickness variation
      // that is neither periodic nor random was doing nothing at all.
      const st = 1.35 - spd[i]! * 0.016;
      const stretch = st < 0.55 ? 0.55 : st > 1.35 ? 1.35 : st;
      e.radius = RADIUS * profile * stretch * blendNow;

      // The section rolls as it goes, which turns the broad face over along the
      // body. That is what makes it read as a ribbon of water rather than as an
      // extruded shape.
      e.roll = twist + dist * 1.35;
      // Spreads where it drags, but only somewhat: at 0.9 the section went to
      // nearly three times as wide as it was thick and the whole thing read as
      // a sheet of cling film rather than as a stream.
      e.aspect = SECTION_ASPECT * (1 + 0.35 * ground);
      // Alpha rides the fade channel (the spout graft reads tangent.w), so the
      // ribbon can arrive and drain without the mesh being rebuilt around it.
      e.w = blendNow * (0.86 + 0.14 * (1 - u));
      // FOAM, into uv.y — the ribbon graft's only other input. Three sources,
      // and they are the three places a real stream turns white: the head, which
      // is tearing through the air; anywhere it is dragging on the ground; and
      // anywhere the motion has stretched it thin, because that is where a
      // stream tears. All three are already computed here.
      e.u = clamp01(
        (1 - smooth01(u / 0.16)) * 0.55
        + ground * 0.5
        + (1 - stretch) * 0.45,
      );

      ax = x; ay = y; az = z;
    }
    // Columns past the live body collapse onto the tail so it closes.
    for (let j = n; j < SAMPLES + 1; j++) spine[j]!.radius = 0;
    tube.update(spine, SAMPLES + 1, surfaceRadius);
  };

  const end = (): void => {
    live = false; heldNow = false; thrownNow = false; splashedNow = false;
    blendNow = 0; count = 0; headIdx = 0; throwT = 0; phase = 0;
    if (!hidden) { tube.hide(); hidden = true; }
  };

  return {
    get active() { return live; },
    get held() { return heldNow; },
    get thrown() { return thrownNow; },
    get splashed() { return splashedNow; },
    get splashAt() { return splashPt; },
    get blend() { return blendNow; },

    trigger(head) {
      if (live) { heldNow = true; return; }
      live = true; heldNow = true; thrownNow = false; splashedNow = false;
      count = 0; headIdx = 0; throwT = 0; phase = 0; blendNow = 0;
      tip[0] = head[0]; tip[1] = head[1]; tip[2] = head[2];
      vel[0] = 0; vel[1] = 0; vel[2] = 0;
    },

    release(aim) {
      if (!heldNow) return;
      heldNow = false;
      thrownNow = true;
      splashedNow = false;
      throwT = 0;
      const a = norm([aim[0], aim[1], aim[2]]);
      aimDir[0] = a[0]; aimDir[1] = a[1]; aimDir[2] = a[2];
      pendingBurst = 1;
    },

    update(dt, clock, head, headFwd, camRight, camUp, groundRadius, emit) {
      if (!live) return;

      // A thrown body does not thin out while it is still flying — it is all
      // still there, travelling. It only gives out once it has spent itself.
      // A thrown body does not thin out while it is still FLYING — it is all
      // still there, travelling. It gives out when it lands, and only then.
      const want = heldNow ? 1 : thrownNow ? (splashedNow ? 0 : 1) : 0;
      blendNow = expDamp(blendNow, want, heldNow ? 5.5 : 3.4, dt);

      const h = Math.min(dt, 1 / 60);

      if (heldNow) {
        phase += dt * 2.55;
        // Fundamental plus one incommensurate harmonic on each axis — see the
        // header. Recognisably a figure-eight, never twice the same one.
        const a = Math.sin(phase) * SWING_A + Math.sin(phase * 0.41 + 1.7) * SWING_A * 0.26;
        const b = Math.sin(phase * 2 + 0.4) * SWING_B + Math.sin(phase * 0.73 + 0.2) * SWING_B * 0.28;

        const up = norm([head[0], head[1], head[2]]);
        const tx = head[0] + headFwd[0]! * REACH + camRight[0]! * a + camUp[0]! * b + up[0] * HEIGHT;
        const ty = head[1] + headFwd[1]! * REACH + camRight[1]! * a + camUp[1]! * b + up[1] * HEIGHT;
        const tz = head[2] + headFwd[2]! * REACH + camRight[2]! * a + camUp[2]! * b + up[2] * HEIGHT;

        // A critically-damped spring, stiff and close to critical. The spring is
        // what makes the water heavy: at these rates the tip overshoots a fast
        // swing and comes back, which is what a mass on the end of an arc does
        // and exactly what a direct assignment would throw away. Slacker than
        // this and the tip spends each cycle catching up in a straight line and
        // then turning hard at the ends, which squares off the loops.
        const k = 210;
        const c = 2 * Math.sqrt(k) * 0.92;
        vel[0] += (k * (tx - tip[0]) - c * vel[0]) * h;
        vel[1] += (k * (ty - tip[1]) - c * vel[1]) * h;
        vel[2] += (k * (tz - tip[2]) - c * vel[2]) * h;
        tip[0] += vel[0] * h; tip[1] += vel[1] * h; tip[2] += vel[2] * h;

        // Never let the tip bore into the ground; it skims it instead.
        const d = norm(tip);
        const g = groundRadius(d) + 0.12;
        const rr = Math.hypot(tip[0], tip[1], tip[2]);
        if (rr < g) {
          tip[0] = d[0] * g; tip[1] = d[1] * g; tip[2] = d[2] * g;
          const vr = vel[0] * d[0] + vel[1] * d[1] + vel[2] * d[2];
          if (vr < 0) {
            vel[0] -= d[0] * vr * 1.25; vel[1] -= d[1] * vr * 1.25; vel[2] -= d[2] * vr * 1.25;
          }
        }
        commit();
      } else {
        // ---- thrown: same point, same velocity, different force -------------
        if (thrownNow && count > 0 && !splashedNow) {
          throwT += dt;
          // The velocity direction TURNS toward the aim rather than being
          // replaced by it, so the head curves out of whatever part of the
          // figure-eight it was in and the tail carries that swing out with it.
          //
          // AND IT STOPS. the reference's own note says this is "fast enough to be
          // committed inside a fifth of a second", and their flight is over
          // before it could matter. Ours lasts seconds, and left running it
          // re-points the velocity at the aim EVERY frame — which means it
          // cancels whatever gravity has accumulated, every frame, forever.
          // Measured: the tip climbed 3.7 -> 13.0 units over 2.8 s and never
          // came down, so the throw was a fountain and `splashed` was false on
          // every throw ever made. Steering is for leaving the swing on a
          // curve; after that the water is just falling.
          if (throwT < STEER_FOR) {
            const kk = 1 - Math.exp(-THROW_STEER * h);
            const sp = Math.hypot(vel[0], vel[1], vel[2]);
            vel[0] += (aimDir[0] * sp - vel[0]) * kk;
            vel[1] += (aimDir[1] * sp - vel[1]) * kk;
            vel[2] += (aimDir[2] * sp - vel[2]) * kk;
          }

          // Thrust for the first third of a second, then drag takes over and it
          // coasts. Accelerating rather than starting at speed is what makes it
          // read as being SENT — the eye catches the head building pace.
          const thrust = throwT < STEER_FOR * 2 ? 62 * Math.exp(-throwT * 3.0) : 0;
          vel[0] += aimDir[0] * thrust * h;
          vel[1] += aimDir[1] * thrust * h;
          vel[2] += aimDir[2] * thrust * h;
          const gdir = norm(tip);
          vel[0] -= gdir[0] * GRAVITY * h;
          vel[1] -= gdir[1] * GRAVITY * h;
          vel[2] -= gdir[2] * GRAVITY * h;

          const s2 = Math.hypot(vel[0], vel[1], vel[2]);
          if (s2 > 0.001) {
            // Much lighter than the reference's 0.55 base. Theirs is a flat throw
            // across a field and drag is what stops it running forever; ours is
            // lobbed, and at 0.55 the body bled its speed at the top of the arc
            // and hung there draining — a fountain, not a throw.
            const drag = Math.min(1, (0.16 + s2 * s2 * 0.0009) * h);
            vel[0] -= vel[0] * drag; vel[1] -= vel[1] * drag; vel[2] -= vel[2] * drag;
          }
          if (s2 > THROW_SPEED) {
            const cc = THROW_SPEED / s2;
            vel[0] *= cc; vel[1] *= cc; vel[2] *= cc;
          }
          tip[0] += vel[0] * h; tip[1] += vel[1] * h; tip[2] += vel[2] * h;

          // A thrown body of water that meets the ground does not keep going.
          // Clamping the head to the surface and letting it carry on makes a
          // released ribbon slither across the ground like a snake — the one
          // reading this must not have, in this game more than any other. It
          // BURSTS: the head stops dead where it hit and the rest of the body
          // pours into that point over the next third of a second.
          const d2 = norm(tip);
          const g2 = groundRadius(d2) + 0.05;
          if (Math.hypot(tip[0], tip[1], tip[2]) < g2) {
            tip[0] = d2[0] * g2; tip[1] = d2[1] * g2; tip[2] = d2[2] * g2;
            splashedNow = true;
            splashPt[0] = tip[0]; splashPt[1] = tip[1]; splashPt[2] = tip[2];
            pendingBurst = 2;
            vel[0] = 0; vel[1] = 0; vel[2] = 0;
          } else {
            // Same commit path as the held ribbon: the body is the record of
            // where the head has been, before and after release alike.
            commit();
          }
        } else if (thrownNow) {
          throwT += dt;
        }

        // Backstop. A body thrown straight up over a hill it never clears, or
        // out over deep water on a planet that curves away under it, would
        // otherwise coast until the drain caught up — which is the failure this
        // rate change just fixed, arriving by another door. Land it.
        if (thrownNow && !splashedNow && throwT > 3.0) {
          const d3 = norm(tip);
          const g3 = groundRadius(d3) + 0.05;
          tip[0] = d3[0] * g3; tip[1] = d3[1] * g3; tip[2] = d3[2] * g3;
          splashedNow = true;
          splashPt[0] = tip[0]; splashPt[1] = tip[1]; splashPt[2] = tip[2];
          pendingBurst = 2;
          vel[0] = 0; vel[1] = 0; vel[2] = 0;
        }

        // The tail drains from behind. While the head is still flying and
        // committing samples this only holds the body to a fixed length; once
        // the head stops, the drain eats the ribbon. The rate climbs with time
        // so the skill always terminates.
        retireOwed += dt;
        // MEASURED, and this was the whole throw being wasted. At `1 + throwT *
        // 0.9` the body drained in 1.1 s while a lobbed throw needs 2.3 s to
        // come down — so `splashed` was false on every single throw, and the
        // impact fan, the burst kill and the entire "it bursts where it lands"
        // half of the skill had never once fired. The same shape of bug as the
        // Maelstrom's reach: machinery that is correct and never runs.
        //
        // So the airborne body barely drains at all; landing is what ends it,
        // and the 7.0 is what pours the rest into the impact.
        const rate = splashedNow ? 7.0 : 0.30 + throwT * 0.22;
        const per = TAIL_LIFE / SAMPLES / rate;
        while (retireOwed >= per && count > 0) { retireOwed -= per; count--; }
      }

      if (!heldNow && (count < 3 || blendNow < 0.02)) { end(); return; }

      write(clock, groundRadius);

      // ---- the two one-off events -----------------------------------------
      if (emit && pendingBurst !== 0 && count >= 3) {
        const fan = pendingBurst;
        pendingBurst = 0;
        if (fan === 1) {
          // A SHEAR off the whole body at the moment of release. Not a puff at
          // the head: the water that does not go with the throw is the water
          // along its outside, and it leaves everywhere at once.
          for (let q = 0; q < 60; q++) {
            const j = 1 + ((Math.random() * (count - 2)) | 0);
            const i = (headIdx - j + SAMPLES * 2) % SAMPLES;
            const sp2 = 4 + Math.random() * 9;
            emit(
              [px[i]! + (Math.random() - 0.5) * 0.4,
               py[i]! + (Math.random() - 0.5) * 0.4,
               pz[i]! + (Math.random() - 0.5) * 0.4],
              [aimDir[0] * sp2 + (Math.random() - 0.5) * 3,
               aimDir[1] * sp2 + (Math.random() - 0.5) * 3,
               aimDir[2] * sp2 + (Math.random() - 0.5) * 3],
            );
          }
        } else {
          // The impact fan, deliberately WIDE AND LOW. A vertical burst reads
          // as an explosion; water meeting a surface at a shallow angle mostly
          // goes sideways, and the ring of it skating outward is the thing that
          // says "liquid" rather than "impact effect".
          const up = norm([splashPt[0], splashPt[1], splashPt[2]]);
          const ax: V3 = Math.abs(up[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
          const t1 = norm([
            up[1] * ax[2] - up[2] * ax[1],
            up[2] * ax[0] - up[0] * ax[2],
            up[0] * ax[1] - up[1] * ax[0],
          ]);
          const t2: V3 = [
            up[1] * t1[2] - up[2] * t1[1],
            up[2] * t1[0] - up[0] * t1[2],
            up[0] * t1[1] - up[1] * t1[0],
          ];
          for (let q = 0; q < 170; q++) {
            const ang = Math.random() * Math.PI * 2;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const out = 3.5 + Math.random() * 9;
            const lift = 1.6 + Math.random() * 5.0;
            emit(
              [splashPt[0] + (t1[0] * ca + t2[0] * sa) * 0.25 + up[0] * 0.1,
               splashPt[1] + (t1[1] * ca + t2[1] * sa) * 0.25 + up[1] * 0.1,
               splashPt[2] + (t1[2] * ca + t2[2] * sa) * 0.25 + up[2] * 0.1],
              [(t1[0] * ca + t2[0] * sa) * out + up[0] * lift,
               (t1[1] * ca + t2[1] * sa) * out + up[1] * lift,
               (t1[2] * ca + t2[2] * sa) * out + up[2] * lift],
            );
          }
        }
      }

      // Droplets shed off the BODY, not the tip: a stream under this much
      // lateral acceleration loses water all the way along its outside, and
      // emitting only at the head puts a comet trail behind a shape that is not
      // a comet.
      if (emit && count >= 4 && blendNow > 0.2) {
        shedOwed += dt * 150 * blendNow;
        let nEmit = shedOwed | 0;
        if (nEmit > 0) {
          shedOwed -= nEmit;
          if (nEmit > 22) nEmit = 22;
          for (let q = 0; q < nEmit; q++) {
            const j = 1 + ((Math.random() * (count - 2)) | 0);
            const i = (headIdx - j + SAMPLES * 2) % SAMPLES;
            const ip = (i + 1) % SAMPLES;
            // Local velocity of the body, from the spine's own spacing.
            const bx = (px[i]! - px[ip]!) * 12;
            const by = (py[i]! - py[ip]!) * 12;
            const bz = (pz[i]! - pz[ip]!) * 12;
            const up = norm([px[i]!, py[i]!, pz[i]!]);
            emit(
              [px[i]! + (Math.random() - 0.5) * 0.25,
               py[i]! + (Math.random() - 0.5) * 0.25,
               pz[i]! + (Math.random() - 0.5) * 0.25],
              [bx * 0.5 + (Math.random() - 0.5) * 1.8 + up[0] * 1.2,
               by * 0.5 + (Math.random() - 0.5) * 1.8 + up[1] * 1.2,
               bz * 0.5 + (Math.random() - 0.5) * 1.8 + up[2] * 1.2],
            );
          }
        }
      }
    },

    forEachPoint(step, fn) {
      if (!live || blendNow < 0.2) return;
      const n = Math.min(count, SAMPLES);
      for (let j = 0; j < n; j += Math.max(1, step)) {
        const i = (headIdx - j + SAMPLES * 2) % SAMPLES;
        const u = j / Math.max(1, n - 1);
        const rad = RADIUS * smooth01(u / 0.10) * (1 - u) ** 1.05 * blendNow;
        if (rad < 0.06) continue;
        fn([px[i]!, py[i]!, pz[i]!], rad);
      }
    },

    cancel() { end(); },

    debug() {
      let L = 0;
      const n = Math.min(count, SAMPLES);
      for (let j = 1; j < n; j++) {
        const a = (headIdx - (j - 1) + SAMPLES * 2) % SAMPLES;
        const b = (headIdx - j + SAMPLES * 2) % SAMPLES;
        L += Math.hypot(px[a]! - px[b]!, py[a]! - py[b]!, pz[a]! - pz[b]!);
      }
      let bad = 0;
      for (let j = 0; j < Math.max(1, n); j++) {
        const e = spine[j]!;
        if (!Number.isFinite(e.dir[0]) || !Number.isFinite(e.lift ?? 0)
          || !Number.isFinite(e.radius) || !Number.isFinite(e.fwd[0])) bad++;
      }
      (globalThis as Record<string, unknown>).__ribbonBad = bad;
      let fSum = 0, fMax = 0, sSum = 0;
      const m = Math.max(1, n);
      for (let j = 0; j < m; j++) {
        const f = spine[j]!.u ?? 0;
        fSum += f; if (f > fMax) fMax = f;
        sSum += spd[(headIdx - j + SAMPLES * 2) % SAMPLES]!;
      }
      return {
        on: live, held: heldNow, thrown: thrownNow, splashed: splashedNow,
        alt: +(Math.hypot(tip[0], tip[1], tip[2]) - surfaceRadius).toFixed(2),
        throwT: +throwT.toFixed(2), n,
        len: +L.toFixed(2), blend: +blendNow.toFixed(2),
        foamAvg: +(fSum / m).toFixed(2), foamMax: +fMax.toFixed(2),
        tipSpd: +(sSum / m).toFixed(1),
      };
    },
  };
}
