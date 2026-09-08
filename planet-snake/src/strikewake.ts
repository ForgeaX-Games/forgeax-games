// The water a strike throws — two sheets peeling off the lane it tore open.
//
// WHY
//
// Coilstrike's wind-up reads (the body visibly winds into a coil), and its
// release reads as motion, but the release had NO MASS: a burst of spray and
// nothing else. Compare the reference's Sweep, which is the same event with the mass
// present — "a crescent of slush rises out of the ground ahead of the player and
// runs outward, ploughing a channel and throwing berms to either side" — and
// their note on why it is drawn the way it is: "a carve's wall of snow and a
// bent wave of slush are the same object", so both come out of one section
// integral on different spines.
//
// This is that object for a strike. The spine is the lane the head just tore
// through, which the trail already records exactly; the section is a tube lifted
// off the surface and thrown outward. Two of them, one either side, because
// water displaced by something moving fast goes sideways and up, not backwards.
//
// THE ONE DECISION
//
// The sheets are built from the TRAIL, not from the strike's start and end. A
// strike is ballistic but the lane it cuts is still whatever the snake's own
// path was — including the last of the coil's curve, which the body is still
// unwinding through as the strike leaves. Sampling the trail means the thrown
// water bends where the strike bent and cannot drift off the furrow the wake is
// carving under it. Drawing it as a straight ribbon between two endpoints would
// be right only for a strike fired from a standstill in a straight line, which
// is the one case the player never actually gets.

import type { World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import { createRibbon, type Ribbon, type RibbonSpineSample } from './ribbon';

export type V3 = [number, number, number];

/** Rings along one sheet. */
const COLS = 40;
/** How far behind the head the sheet reaches, in radians of arc. */
const SPAN = 9 / 36;
/** Peak lift of the crest, world units. Taller than the snake: at the distance
 *  this game frames from, water thrown only as high as the body reads as a
 *  ripple rather than as displaced mass — the same argument the reference makes for
 *  its 2.15 m crescent. */
const CREST = 1.9;
/** Lateral throw at the crest, world units. */
const FLARE = 1.25;
/** Section radius at the base of the sheet. */
const THICK = 0.30;
/** Seconds the sheet lives after the strike ends. */
const LINGER = 0.55;

export interface StrikeWake {
  /**
   * `t` is 0..1 through the strike, then keeps climbing past 1 through the
   * linger. `sample(arcBack)` returns the trail point that far behind the head.
   */
  update(
    headDir: readonly number[], headFwd: readonly number[], t: number,
    sample: (arcBack: number) => V3, groundRadius: (d: V3) => number,
    /** 1 over water, 0 inland. A strike on dry ground throws DUST, which the
     *  particle field already does — what it must not do is raise sheets of
     *  water off a sand dune. */
    wet: number,
  ): void;
  hide(): void;
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

export function createStrikeWake(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  ring: number,
  boundRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
): StrikeWake | undefined {
  const sheets: Ribbon[] = [];
  for (let i = 0; i < 2; i++) {
    const r = createRibbon(world, renderer, material, COLS, ring, boundRadius, components, meshFromInterleaved);
    if (!r) return undefined;
    sheets.push(r);
  }
  const spine: RibbonSpineSample[] = Array.from({ length: COLS }, () => ({
    dir: [0, 0, 1] as V3, fwd: [1, 0, 0] as V3, radius: 0, lift: 0, u: 0, w: 1,
  }));
  let hidden = true;

  return {
    hide() {
      if (hidden) return;
      hidden = true;
      for (const s of sheets) s.hide();
    },

    update(headDir, headFwd, t, sample, groundRadius, wet) {
      const w = Math.min(1, Math.max(0, wet));
      if (t <= 0 || t >= 1 + LINGER || w < 0.15) { this.hide(); return; }
      hidden = false;
      // Rises fast, falls slowly — thrown water goes up in an instant and comes
      // down over the rest of the second.
      const rise = Math.min(1, t / 0.22);
      const fall = 1 - Math.max(0, (t - 0.35) / (0.65 + LINGER));
      const amp = Math.max(0, rise * fall) * w;

      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? 1 : -1;
        for (let c = 0; c < COLS; c++) {
          const u = c / (COLS - 1);
          // Along the lane: 0 at the head, SPAN behind it.
          const p = sample(u * SPAN);
          const q = sample(Math.min(SPAN, u * SPAN + 0.01));
          let fx = p[0] - q[0], fy = p[1] - q[1], fz = p[2] - q[2];
          const d0 = fx * p[0] + fy * p[1] + fz * p[2];
          fx -= p[0] * d0; fy -= p[1] * d0; fz -= p[2] * d0;
          const fl = Math.hypot(fx, fy, fz) || 1;
          const fwd: V3 = [fx / fl, fy / fl, fz / fl];
          const side3 = norm(cross(p, fwd));

          // The sheet swells just behind the head and dies out along the lane:
          // a crest, not a ridge running the whole way back.
          const along = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
          const lat = (FLARE / 36) * along * amp * sgn;
          const ca = Math.cos(lat), sa = Math.sin(lat);
          const dir = norm([
            p[0] * ca + side3[0] * sa,
            p[1] * ca + side3[1] * sa,
            p[2] * ca + side3[2] * sa,
          ]);

          const e = spine[c]!;
          e.dir = dir;
          e.fwd = fwd;
          e.lift = groundRadius(dir) - boundRadius + CREST * along * amp;
          e.radius = THICK * along * amp;
          e.w = amp;
          e.u = 0;
        }
        sheets[side]!.update(spine, COLS, boundRadius);
      }
    },
  };
}
