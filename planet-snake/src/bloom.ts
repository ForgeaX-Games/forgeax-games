// Skill 4 — Bloom (涌泉). A targeted eruption, and the only skill in this game
// that refuses to work on land.
//
// The reference blows a column of powder and water out of a drift; ours blows
// one out of the sea, which is the same event with one of its three clocks changed —
// see THE CRATER below, because that change is the whole of the adaptation.
//
// THREE CLOCKS, and that is the design
//
//   the column   fast. Up in a third of a second, held for a beat, then it
//                COLLAPSES BACK DOWN ITS OWN AXIS rather than fading — the mass
//                goes back where it came from. Fading it out would say the water
//                stopped existing; running the height back down says it fell.
//   the crater   instant.
//   the fallout  slow. Three and a half seconds, and it is what the player is
//                actually looking at for most of the skill. Their line, and it
//                is the one worth keeping: "a burst with no fallout is a flash;
//                a burst with fallout is weather."
//
// THE CRATER — the one place this is NOT a port
//
// the reference's crater is instant AND PERMANENT: a brush into the snow height
// field that is still there a minute later, and half of why their Bloom feels
// like it happened. Ours cannot be, and should not be. Water does not hold a
// hole. So the crater here is instant and CLOSING: the sheet is driven down and
// a rim thrown up at the moment of the burst, and then the sea takes about a
// second to heal over it. A permanent dent in the sea would be the single most
// wrong thing this effect could do — it would say the ocean is a solid.
//
// THE COLUMN LEANS
//
// Theirs, verbatim, and it is worth more than it sounds: "a perfectly vertical
// cylinder of water reads as a rendered primitive no matter what is on it, and
// two degrees of drift with a little sway takes that away completely." A fresh
// lean each cast, so two Blooms in the same place are not the same object twice.
//
// THE BURST IS ONE EVENT
//
// The crater, the thrown ring and the light spike all fire on the frame the
// column reaches the surface, not at trigger time. They are the same event, so
// they happen at the same instant or they read as three effects that happen to
// overlap.

import type { World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import { createRibbon, type Ribbon, type RibbonSpineSample } from './ribbon';

export type V3 = [number, number, number];

/** Rings along the column. */
const COLS = 34;
/** Full height at peak, world units. The snake is about 1.2 wide; this has to
 *  stand well clear of it or the eruption reads as a splash. */
const HEIGHT = 9.5;
/** Radius at the widest, world units.
 *
 *  An eruption is a MASS of material leaving the water and the aspect ratio is
 *  most of what says so — but the ratio also decides whether the profile below
 *  reads as a SILHOUETTE or as lumps. the reference's column is about eight times as
 *  tall as it is wide, and at that ratio the waist, the flare and the broad
 *  foot are subtle changes down a plume. At 1.25 on a 7-unit column ours was
 *  under three to one, and the identical profile came out as a stack of balls.
 *  Taller and finer; the mass now comes from the height. */
const GIRTH = 0.95;
/** Seconds from cast to the column being gone. */
const LIFE = 1.75;
/** Seconds of fallout after that. */
const FALLOUT = 3.4;
/** World radius of the crater in the sheet. */
export const BLOOM_R = 3.2;
/** How long the sea takes to close over. */
const HEAL = 1.1;

export interface Bloom {
  readonly active: boolean;
  /** Unit direction of the target, valid while active. */
  readonly at: V3;
  /** 0..1 crater drive for the water sheet — rises instantly, heals away. */
  readonly crater: number;
  /** True on the single frame the burst fires. */
  readonly burst: boolean;
  /** Column height right now, world units. 0 once it has collapsed. */
  readonly top: number;
  trigger(target: V3, surfaceRadius: number): void;
  update(
    dt: number,
    groundRadius: (d: V3) => number,
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
/** Peaks at 1 in the middle, 0 at both ends — the waist term. */
const bell = (x: number): number => {
  const t = clamp01(x);
  return Math.sin(t * Math.PI);
};

export function createBloom(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  ring: number,
  boundRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
): Bloom | undefined {
  const tube: Ribbon | undefined = createRibbon(
    world, renderer, material, COLS, ring, boundRadius, components, meshFromInterleaved,
  );
  if (!tube) return undefined;

  const spine: RibbonSpineSample[] = Array.from({ length: COLS }, () => ({
    dir: [0, 0, 1] as V3, fwd: [1, 0, 0] as V3, radius: 0, lift: 0, u: 0, w: 1,
    aspect: 1, roll: 0,
  }));

  let live = false;
  let t = 0;
  let fired = false;
  let burstNow = false;
  let topNow = 0;
  let surfR = 0;
  const centre: V3 = [0, 0, 1];
  /** Tangent frame at the target, so the lean has somewhere to lean. */
  let e1: V3 = [1, 0, 0];
  let e2: V3 = [0, 1, 0];
  let leanA = 0;
  let leanB = 0;
  let curtainOwed = 0;
  let hidden = true;

  const end = (): void => {
    live = false; t = 0; fired = false; burstNow = false; topNow = 0;
    if (!hidden) { tube.hide(); hidden = true; }
  };

  /** The instant of the burst: a hard ring of thrown water. */
  const throwRing = (emit: (at: V3, vel: V3) => void): void => {
    const base = surfR;
    for (let k = 0; k < 150; k++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Biased toward the RIM, because that is where the mass leaves.
      const r = 0.6 + Math.sqrt(Math.random()) * 2.4;
      const up = 7.0 + Math.random() * 10.0;
      const out = 2.2 + Math.random() * 6.5;
      const ox = e1[0] * ca + e2[0] * sa;
      const oy = e1[1] * ca + e2[1] * sa;
      const oz = e1[2] * ca + e2[2] * sa;
      emit(
        [centre[0] * (base + 0.2) + ox * r, centre[1] * (base + 0.2) + oy * r, centre[2] * (base + 0.2) + oz * r],
        [ox * out + centre[0] * up, oy * out + centre[1] * up, oz * out + centre[2] * up],
      );
    }
  };

  /**
   * The fallout curtain.
   *
   * Fine, slow, and emitted HIGH over a WIDE disc so it drifts down through the
   * frame rather than sitting in a cone over the crater. This is the part that
   * lasts; the column is over in under two seconds and this runs for three and
   * a half behind it.
   */
  const curtain = (dt: number, emit: (at: V3, vel: V3) => void): void => {
    const k = smooth01((t - 0.25) / 0.5) * (1 - smooth01((t - 0.9) / (FALLOUT * 0.9)));
    if (k <= 0.01) return;
    curtainOwed += dt * 150 * k;
    let n = curtainOwed | 0;
    if (n <= 0) return;
    curtainOwed -= n;
    if (n > 26) n = 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 5.4;
      const h = 3.2 + Math.random() * 6.0;
      const ox = e1[0] * Math.cos(a) + e2[0] * Math.sin(a);
      const oy = e1[1] * Math.cos(a) + e2[1] * Math.sin(a);
      const oz = e1[2] * Math.cos(a) + e2[2] * Math.sin(a);
      emit(
        [centre[0] * (surfR + h) + ox * r, centre[1] * (surfR + h) + oy * r, centre[2] * (surfR + h) + oz * r],
        // Barely moving. This is meant to hang and settle, not to fly.
        [(Math.random() - 0.5) * 1.1 - centre[0] * 0.6,
         (Math.random() - 0.5) * 1.1 - centre[1] * 0.6,
         (Math.random() - 0.5) * 1.1 - centre[2] * 0.6],
      );
    }
  };

  return {
    get active() { return live; },
    get at() { return centre; },
    get burst() { return burstNow; },
    get top() { return topNow; },
    get crater() {
      if (!live || !fired) return 0;
      // Instant, then the sea closes. Nothing about this is permanent — see the
      // header: a lasting dent in the sea would say the ocean is a solid.
      return 1 - smooth01((t - 0.10) / HEAL);
    },

    trigger(target, surfaceRadius) {
      centre[0] = target[0]; centre[1] = target[1]; centre[2] = target[2];
      surfR = surfaceRadius;
      const ax: V3 = Math.abs(centre[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
      e1 = norm(cross(centre, ax));
      e2 = cross(centre, e1);
      // A different lean each cast, so two Blooms in the same place are not the
      // same object twice.
      const a = Math.random() * Math.PI * 2;
      leanA = Math.cos(a) * 0.16;
      leanB = Math.sin(a) * 0.16;
      t = 0; fired = false; burstNow = false; curtainOwed = 0;
      live = true;
    },

    update(dt, groundRadius, emit, light) {
      if (!live) return;
      burstNow = false;
      t += dt;
      if (t >= LIFE + FALLOUT) { end(); return; }

      // ---- the burst ----------------------------------------------------
      // Fires ONCE, on the frame the column reaches the surface, not at trigger
      // time — the crater, the thrown ring and the light spike are the same
      // event and have to happen at the same instant.
      if (!fired && t >= 0.10) {
        fired = true;
        burstNow = true;
        if (emit) throwRing(emit);
      }

      // ---- the column ---------------------------------------------------
      // Rise, hold, collapse. The collapse runs the HEIGHT back down rather
      // than fading the alpha, so the column withdraws into the sea.
      const rise = smooth01((t - 0.10) / 0.34);
      const drop = 1 - smooth01((t - 0.95) / 0.80);
      const env = rise * drop;
      topNow = HEIGHT * env;

      if (env <= 0.002) {
        if (!hidden) { tube.hide(); hidden = true; }
      } else {
        hidden = false;
        const sway = Math.sin(t * 3.1) * 0.12;
        for (let c = 0; c < COLS; c++) {
          const u = c / (COLS - 1);
          // Column 0 is the HEAD, so u runs downward — same convention as every
          // other swept tube here, where u is "distance behind the leading edge".
          const h = 1 - u;
          const lean = h * h;
          const offA = (leanA + sway) * lean * topNow * 0.5;
          const offB = (leanB - sway * 0.6) * lean * topNow * 0.5;
          const r = surfR + topNow * h;
          const p = norm([
            centre[0] * r + e1[0] * offA + e2[0] * offB,
            centre[1] * r + e1[1] * offA + e2[1] * offB,
            centre[2] * r + e1[2] * offA + e2[2] * offB,
          ]);
          const e = spine[c]!;
          e.dir = p;
          e.lift = r - surfR;
          // Along the column. Radially outward at the head, which IS parallel to
          // the sphere normal — the frame that would normally build the ring
          // degenerates there, and the guard for it lives in ribbon.ts.
          e.fwd = [centre[0], centre[1], centre[2]];
          // Flared head, waisted middle, broad foot: the mass at the top has had
          // the longest to spread and the least holding it together.
          const shape =
            0.42 + 0.58 * bell(clamp01(h * 1.15))
            + 0.55 * smooth01((h - 0.72) / 0.28)
            + 0.75 * (1 - smooth01(h / 0.22));
          // The ripple is halved for the same reason as the girth: at a low
          // aspect ratio a 20% radius wobble is a visible bulge per period.
          e.radius = GIRTH * shape * env * (0.94 + 0.11 * Math.sin(u * 9 + t * 6));
          e.aspect = 1;
          e.roll = 0;
          e.w = clamp01(env * 1.5);
          // Foam: the head is where it is coming apart, the foot is where it is
          // grinding against the rim it threw up. the reference's own numbers here
          // are 0.30 + 0.55 + 0.4, which saturate to solid white on OUR ribbon
          // material — theirs weights foam differently. Scaled to leave the
          // water colour visible underneath, because a column with no colour in
          // it is a white shape and could be made of anything.
          e.u = clamp01(0.10 + 0.34 * smooth01((h - 0.55) / 0.45)
            + 0.26 * (1 - smooth01(h / 0.18)));
        }
        tube.update(spine, COLS, surfR);

        // Two lights, and the split is the point: one down IN the crater and one
        // riding the head. The crater one is what lights the rim and the fallout
        // around the base, and it is the reason this reads as a hole full of
        // light rather than as a bright column standing on dark water.
        if (light) {
          const rr = surfR + 0.35;
          light([centre[0] * rr, centre[1] * rr, centre[2] * rr], 13, [0.44, 0.78, 1.0], 24 * env);
          const hr = surfR + topNow * 0.92;
          light([centre[0] * hr, centre[1] * hr, centre[2] * hr], 9, [0.55, 0.82, 1.0], 10 * env);
        }
      }

      if (emit) curtain(dt, emit);
    },

    cancel() { end(); },
  };
}
