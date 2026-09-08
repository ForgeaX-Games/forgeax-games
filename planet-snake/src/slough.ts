// Skill 1 — Slough (蛇蜕). The snake tears out of its own body and leaves it
// lying on the world, complete, still shaped like it.
//
// THE ONE DECISION
//
// The skin is not a spawned copy. It is the SAME SPINE the living body was
// drawn from — the resampled ring array, frozen at the moment of the tap —
// handed to a second swept tube while the live snake carries on from the head
// end. The skin and the body's history therefore cannot disagree: the skin lies
// exactly in the sinuous line the powdered ground would show, wave for wave,
// because it IS that line. A skin conjured as separate geometry would sooner or
// later be caught lying — half a body-width off the furrow the wake carved, or
// arched where the body was flat — and the whole illusion of "that WAS me" dies
// on that centimetre.
//
// THREE CLOCKS (the shape the reference's Bloom argues for)
//
//   the PEEL      fast, 0.9 s. A bright seam runs head-to-tail. This is the one
//                 moment the effect is allowed a highlight, and the one moment
//                 it declares a light.
//   the SKIN      quasi-static, 16 s. It does not fade — it DESICCATES: albedo
//                 drains toward parchment, it goes translucent, and it slumps
//                 (radius eases down, cross-section flattens onto the surface).
//                 It never animates its spine again; dead stillness is what
//                 sells "empty".
//   the FLAKING   slow, the last 4 s. Particles come off along the spine, then
//                 the tube retires by writing radius 0 — the same collapse the
//                 ribbon already uses to close a tail and that the reference uses to
//                 release a strand. No despawn pop, no cross-dissolve.
//
// WHY THE MESH IS REWRITTEN EVERY FRAME FOR A THING THAT NEVER MOVES
//
// The forward pass has no clock. Drying-out and the travelling seam are
// per-frame values, so they ride in the vertex data: `u` (uv.y) carries the seam
// and `w` (tangent.w) carries remaining life. Both are free channels the skin
// variant is the only consumer of. It costs one 1.3k-vertex upload a frame,
// which is a tenth of the water patch's.

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import { createRibbon, type Ribbon, type RibbonSpineSample } from './ribbon';

export type V3 = [number, number, number];

/** Seconds the seam takes to run the whole body. */
const PEEL = 0.9;
/** Seconds the skin lies there in total, peel included. */
const LIFE = 16;
/** Seconds of flaking at the end, inside LIFE. */
const FLAKE = 4;
/** The skin is not lethal to the player for this long — long enough to clear it
 *  on the shed burst. It is lethal to BOTS from the first frame. */
const ARM = 1.2;
/** Seconds bots treat the skin's head as the player. */
const DECOY = 6;

export interface Slough {
  /** True while a skin is lying on the world. */
  readonly alive: boolean;
  /** Seconds since the tap. */
  readonly age: number;
  /** Unit direction of the skin's head — what a decoyed bot steers at. */
  readonly headDir: V3;
  /**
   * Walk the live rings, so a bot's avoidance list can see the WHOLE skin.
   *
   * It previously got one point — the head — while `hits` killed on any ring.
   * A bot that swerves around a metre of husk and then drives into the other
   * fifteen is not avoiding anything; it is being ambushed by geometry it was
   * never shown. Every hazard a bot can die on has to be a hazard it can see.
   */
  forEachRing(step: number, fn: (dir: V3) => void): void;
  /** Is the skin still pretending to be the player? */
  readonly decoying: boolean;
  /**
   * Freeze `count` spine samples into a skin. The samples are COPIED — the
   * caller's array is live and will be overwritten on the next body rebuild.
   */
  shed(samples: readonly RibbonSpineSample[], count: number, surfaceRadius: number): void;
  /** Advance the clocks and rewrite the mesh. */
  update(dt: number): void;
  /**
   * Does `dir` touch the skin? `cos` is the hit threshold as a dot product.
   * `forPlayer` applies the arming delay — you get a moment to get clear of
   * something that was your own body a second ago.
   */
  hits(dir: readonly number[], cos: number, forPlayer: boolean): boolean;
  /** Where the seam is right now, or undefined once the peel is over. */
  seamPoint(): V3 | undefined;
  /**
   * A point on the seam and a velocity peeling away from it, for the flakes the
   * tear throws. Returns false once the peel is over.
   *
   * The seam is a MOVING RING, so the flakes have to come off where it is at
   * this instant and fly outward from the body's own axis — shed skin does not
   * puff off a point, it splits along a line and the line travels. Emitting from
   * a fixed burst at the head would put every flake in the wrong place within a
   * tenth of a second.
   */
  seamFlake(out: { at: V3; vel: V3 }, k: number): boolean;
  /** Drop the skin (game over / restart). */
  clear(): void;
}

export function createSlough(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  cols: number,
  ring: number,
  boundRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
): Slough | undefined {
  const ribbon: Ribbon | undefined = createRibbon(
    world, renderer, material, cols, ring, boundRadius, components, meshFromInterleaved,
  );
  if (!ribbon) return undefined;

  // The frozen spine. Allocated once; `shed` copies into it.
  const spine: RibbonSpineSample[] = Array.from({ length: cols }, () => ({
    dir: [0, 0, 1] as V3,
    fwd: [1, 0, 0] as V3,
    radius: 0,
    lift: 0,
    u: 0,
    w: 1,
  }));
  /** Radii as shed, so the slump can scale them without compounding. */
  const radius0 = new Float64Array(cols);
  let n = 0;
  let surfR = 0;
  let age = 0;
  let live = false;
  const seam: V3 = [0, 0, 1];

  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const write = (): void => {
    // Seam position as a fraction along the body, 0 at the head.
    const peel = Math.min(1, age / PEEL);
    // Remaining life, 1 fresh -> 0 gone. The skin reads this as dryness.
    const life = 1 - smooth(LIFE - FLAKE, LIFE, age);
    // Slump: the section eases down and the whole thing settles as it dries.
    const slump = 1 - 0.18 * (1 - life);
    // Retirement: the last stretch collapses the radius to nothing.
    const close = 1 - smooth(LIFE - 0.55, LIFE, age);

    for (let c = 0; c < n; c++) {
      const e = spine[c]!;
      const t = c / Math.max(1, n - 1);
      // The seam is a narrow bright band travelling head to tail. Written into
      // uv.y because the forward pass cannot be told the time any other way.
      const d = Math.abs(t - peel);
      // Band width as a fraction of the body. 0.085 was about two rings on a
      // 26-segment snake — a highlight nobody can see is the same as no
      // highlight, and this is the ONE moment the effect gets one.
      e.u = age >= PEEL ? 0 : Math.max(0, 1 - d / 0.16);
      e.w = life;
      e.radius = radius0[c]! * slump * close;
    }
    ribbon.update(spine, n, surfR);
  };

  return {
    get alive() { return live; },
    get age() { return age; },
    get headDir() { return spine[0]!.dir; },
    get decoying() { return live && age < DECOY; },

    shed(samples, count, surfaceRadius) {
      n = Math.max(2, Math.min(count, cols));
      surfR = surfaceRadius;
      for (let c = 0; c < n; c++) {
        const s = samples[Math.min(c, count - 1)]!;
        const e = spine[c]!;
        // COPIED, not referenced: the caller's array is the live body's own and
        // is rewritten every frame. Aliasing it would make the skin follow the
        // snake, which is the one thing it must never do.
        e.dir = [s.dir[0], s.dir[1], s.dir[2]];
        e.fwd = [s.fwd[0], s.fwd[1], s.fwd[2]];
        e.lift = s.lift ?? 0;
        radius0[c] = s.radius;
        e.radius = s.radius;
        e.u = 0;
        e.w = 1;
      }
      age = 0;
      live = true;
      write();
    },

    update(dt) {
      if (!live) return;
      age += dt;
      if (age >= LIFE) { live = false; ribbon.hide(); return; }
      write();
    },

    forEachRing(step, fn) {
      if (!live) return;
      for (let c = 0; c < n; c += Math.max(1, step)) {
        const e = spine[c]!;
        if (e.radius < 0.12) continue;
        fn(e.dir);
      }
    },

    hits(dir, cos, forPlayer) {
      if (!live) return false;
      if (forPlayer && age < ARM) return false;
      // Skip rings whose radius has collapsed — a skin in its last half second
      // is not a wall.
      for (let c = 0; c < n; c++) {
        const e = spine[c]!;
        if (e.radius < 0.12) continue;
        if (dir[0]! * e.dir[0] + dir[1]! * e.dir[1] + dir[2]! * e.dir[2] > cos) return true;
      }
      return false;
    },

    seamFlake(out, k) {
      if (!live || age >= PEEL) return false;
      const t = Math.min(1, age / PEEL);
      const c = Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
      const e = spine[c]!;
      const r = surfR + (e.lift ?? 0);
      out.at[0] = e.dir[0] * r; out.at[1] = e.dir[1] * r; out.at[2] = e.dir[2] * r;
      // Outward from the body's axis, in the plane of the surface, plus a lift.
      // The ring's own frame is (dir, fwd), so its side is their cross product.
      const sx = e.dir[1] * e.fwd[2] - e.dir[2] * e.fwd[1];
      const sy = e.dir[2] * e.fwd[0] - e.dir[0] * e.fwd[2];
      const sz = e.dir[0] * e.fwd[1] - e.dir[1] * e.fwd[0];
      const a = k * 2.399963229728653;
      const co = Math.cos(a) * 3.4, up = (0.55 + 0.45 * Math.sin(a * 1.7)) * 3.0;
      out.vel[0] = sx * co + e.dir[0] * up;
      out.vel[1] = sy * co + e.dir[1] * up;
      out.vel[2] = sz * co + e.dir[2] * up;
      return true;
    },

    seamPoint() {
      if (!live || age >= PEEL) return undefined;
      const t = Math.min(1, age / PEEL);
      const c = Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
      const e = spine[c]!;
      const r = surfR + (e.lift ?? 0);
      seam[0] = e.dir[0] * r; seam[1] = e.dir[1] * r; seam[2] = e.dir[2] * r;
      return seam;
    },

    clear() {
      if (!live) return;
      live = false;
      age = 0;
      ribbon.hide();
    },
  };
}

/** Handle so the caller can park the entity if it ever needs to. */
export type SloughEntity = EntityHandle;
