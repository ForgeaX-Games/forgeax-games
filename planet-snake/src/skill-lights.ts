// The dynamic lights skills emit.
//
// a handful of slots, cleared at the top of the frame, declared into by whatever
// is casting, and whatever is still declared when the frame ends is what the
// scene is lit by. Nothing is retained, so a skill that stops updating stops
// lighting with no teardown path to get wrong.
//
// Their reason for centralising it is the one that matters here too: "a spell
// has to light the snow, the robe, the wake and the airborne spray out of one
// description, or it reads as a glow pasted over a scene rather than as a light
// in it." Ours has to light the water, the body, the props and the spray.
//
// WHY THIS IS ALMOST NOTHING
//
// the reference hand-rolls the pool because its materials are hand-written: four
// slots in two Float32Arrays, a `snowSpellLights` include, and every consumer
// material has to declare the uniforms. We do not need any of that. This engine
// has a first-class `PointLight` component (Transform + PointLight, joined by
// the render extract) which the stock PBR light loop already consumes — and
// every material in this game is a GRAFT of that stock shader, spliced into its
// composed source. The engine's `color` therefore already carries the point
// lights by the time our tail runs, for every variant at once: terrain, water,
// body, prop, spray. So the "pool" is entirely host-side bookkeeping.
//
// (This was nearly built the hard way. The project's own findings log had
// recorded "engine caps point lights at 1" — that entry is struck through:
// STATE.md 已证伪 #5 records point/spot have four slots under URP and it is the
// DIRECTIONAL count that is capped at one and silently dropped.)
//
// Slots are spawned once and parked, never created or destroyed at cast time:
// spawning an entity mid-frame to light a flash is how you get a hitch on the
// exact frame the player is looking at something.
//
// MEASURED, because the first three attempts to verify this all failed for
// reasons that had nothing to do with lighting:
//   - the engine's point budget is FOUR ENTITIES TOTAL, and a parked slot still
//     occupies one. A fifth light spawned alongside a full pool was reported
//     dropped by render-system-multi-light and never rendered. The pool
//     therefore owns the whole budget; anything else wanting a light goes
//     through it.
//   - a light declared through this pool only appears while the GAME LOOP RUNS.
//     Photo mode returns early from update, so two rounds of "point lights do
//     not reach grafted materials" were measuring a frame in which commit() had
//     never been called. The frozen branch now ticks the pool for that reason.
// With those two understood, one declared light lifts the frame mean by 30 and
// pools correctly on the water, the body and the wake foam at once.

import type { EntityHandle, World } from '@forgeax/engine-ecs';

export type V3 = [number, number, number];

/** Slots. Four is the engine's URP budget for point lights; three skills that
 *  can overlap plus one for the game's own use fits inside it. */
const SLOTS = 4;

/** Where a parked slot sits: the planet centre, inside the sphere, where its
 *  range cannot reach any surface. Intensity 0 alone is not enough — a light at
 *  a real position still costs the loop a distance test per pixel. */
/** Where a parked slot sits — far outside the planet, where its range reaches
 *  nothing. Intensity 0 would do on its own; the distance is belt and braces. */
const PARK: V3 = [0, 0, 1e4];

export interface SkillLights {
  /** Drop last frame's declarations. Call once, before any skill updates. */
  begin(): void;
  /**
   * Declare a light for THIS frame. Returns false when the pool is full, which
   * the caller is free to ignore — a skill that cannot get a light should still
   * work, just unlit.
   */
  add(pos: V3, radius: number, color: V3, intensity: number): boolean;
  /** Push the declarations to the ECS. Call once, after every skill updated. */
  commit(): void;
}

export function installSkillLights(
  world: World,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; PointLight: any },
  /** Slot count override. The engine's budget is FOUR point lights TOTAL and a
   *  parked zero-intensity slot still consumes one — measured: with four parked
   *  slots spawned first, a fifth light was reported "dropped" by
   *  render-system-multi-light and never rendered. So the pool owns the whole
   *  budget by default, and anything else that wants a light has to go through
   *  it. Overridable only so a diagnostic can free the budget. */
  slots = SLOTS,
): SkillLights {
  const entities: EntityHandle[] = [];
  for (let i = 0; i < slots; i++) {
    entities.push(
      world
        .spawn(
          { component: components.Transform, data: { pos: PARK } },
          { component: components.PointLight, data: { color: [1, 1, 1], intensity: 0, range: 1 } },
        )
        .unwrap() as EntityHandle,
    );
  }

  // Staged declarations, written in place. No allocation per frame.
  const pos = new Float64Array(SLOTS * 3);
  const col = new Float64Array(SLOTS * 3);
  const rad = new Float64Array(SLOTS);
  const inten = new Float64Array(SLOTS);
  let count = 0;
  // How many slots were live last frame, so parking only writes the ones that
  // actually changed. `world.set` on a light is cheap but not free, and this
  // runs every frame for the whole session.
  let livePrev = 0;

  return {
    begin() {
      count = 0;
    },

    add(p, radius, c, intensity) {
      if (count >= slots || intensity <= 0 || radius <= 0) return false;
      const o = count * 3;
      pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
      col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
      rad[count] = radius;
      inten[count] = intensity;
      count++;
      return true;
    },

    commit() {
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        // FULL payload. `world.set` replaces the component, and a Transform
        // written with only `pos` lands with a zero quaternion — measured: a
        // light spawned lit and then moved this way stopped lighting anything,
        // while the identical light spawned in place worked. Every other
        // world.set(Transform) in this game passes pos AND quat; this one was
        // the exception and it was silently wrong.
        world.set(entities[i]!, components.Transform, {
          pos: [pos[o]!, pos[o + 1]!, pos[o + 2]!],
          quat: [0, 0, 0, 1],
        });
        world.set(entities[i]!, components.PointLight, {
          color: [col[o]!, col[o + 1]!, col[o + 2]!],
          intensity: inten[i]!,
          range: rad[i]!,
        });
      }
      // Park what was live last frame and is not any more.
      for (let i = count; i < livePrev; i++) {
        world.set(entities[i]!, components.PointLight, {
          color: [1, 1, 1], intensity: 0, range: 1,
        });
        world.set(entities[i]!, components.Transform, { pos: PARK, quat: [0, 0, 0, 1] });
      }
      livePrev = count;
    },
  };
}
