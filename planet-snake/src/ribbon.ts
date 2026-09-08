// Swept-tube snake bodies.
//
// The reference footage does not have segmented snakes. Cross-section scans
// across the red snake in frame f08 give widths of 32/37/35/41/36 px at
// y=250/400/550/700/820 — a near-constant tube with a smooth unbroken
// silhouette and ONE continuous specular highlight sliding along it, not a
// highlight repeating per joint. Overlapping capsules cannot produce that: each
// capsule carries its own highlight and its own silhouette bulge.
//
// Technique from the reference's surf wake, which is a swept mesh and explicitly not
// a particle effect: a static lattice
// whose vertices are placed from a resampled spine, so a long body and a short
// one cost the same buffer. the reference places them in the vertex shader from a
// data texture; here the spine is at most a few dozen samples and the whole
// buffer is ~1200 floats, so placing them on the CPU and pushing the result
// through the game-to-engine bridge's dynamic mesh upload is cheaper in moving
// parts and avoids a custom material shader on the critical path.
//
// One thing the sphere makes easier than the reference's flat world: a swept tube
// normally needs a parallel-transported frame to stop the cross-section from
// spinning as the spine curves. On a planet the surface normal IS a stable
// frame — it never degenerates and never accumulates twist — so the ring is
// just (right, up) at each sample.

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import { updateMesh } from './engine-bridge';

/** position(3) + normal(3) + uv(2) + tangent(4) — the runtime layout that
 *  meshFromInterleaved expands to (geometry/src/box.ts:124-140). */
const FLOATS_PER_VERTEX = 12;

export type V3 = [number, number, number];

export interface RibbonSpineSample {
  /** Unit position on the sphere. */
  dir: V3;
  /** Unit tangent along travel, perpendicular to dir. */
  fwd: V3;
  /** World radius of the cross-section here. */
  radius: number;
  /** Extra height above the base surface radius at THIS sample. The terrain is
   *  displaced now, so a tube laid at one constant radius would bury itself in
   *  every hill and float over every valley. */
  lift?: number;
  /** Value written into tangent.w for this ring.
   *
   *  A FREE PER-VERTEX CHANNEL, and on a mesh that is rewritten every frame it
   *  is also the only way to animate anything in the forward pass — that pass
   *  has no clock and no updateMaterial, so a shed skin's drying-out and its
   *  travelling seam cannot come from a uniform. They ride here instead.
   *  Defaults to 1, which is what every existing consumer expects. */
  w?: number;
  /** Value written into uv.y for this ring. Defaults to the normalised position
   *  along the body; the caller overrides it to carry a HEAD MASK instead,
   *  because a tint keyed to normalised position cannot line up with a head
   *  whose size is fixed in world units — the two drift apart as the snake
   *  grows and the head reads as a stopper on a bottle neck. */
  u?: number;
  /**
   * How much wider the section is than it is thick. 1 (the default) is the
   * circular tube every snake body in this game wants.
   *
   * the reference's Ribbon spends a paragraph on why its own section is not round,
   * and it is the load-bearing decision of that whole effect: "a body of bent
   * water is not a hose... a circular section presents the same silhouette from
   * every direction, which is what makes it read as a cylinder." A flattened
   * section catches the light on its broad face and vanishes to an edge when it
   * turns side-on, and that changing silhouette is most of what separates
   * "a tube" from "water being bent".
   */
  aspect?: number;
  /**
   * Roll of the section about `fwd`, radians. Only meaningful with `aspect`.
   *
   * The broad face has to TURN OVER as it travels down the body — a flattened
   * section held at a constant angle is just a differently-shaped extrusion.
   * Rolling it is what a stream of water under lateral acceleration actually
   * does.
   */
  roll?: number;
}

export interface Ribbon {
  entity: EntityHandle;
  handle: number;
  /** Rewrite the tube from `count` spine samples and push it to the GPU. */
  update(samples: readonly RibbonSpineSample[], count: number, surfaceRadius: number): void;
  /** Park it off-planet (dead bots) without paying a rebuild. */
  hide(): void;
  /** Read back one ring's world positions — for diagnosing bad geometry. */
  debugRing(ci: number): number[];
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Build the static lattice + index buffer once. `cols` is the number of rings
 * along the body, `ring` the samples around each ring. The ring carries one
 * duplicated seam vertex so the UV can run 0..1 without wrapping backwards.
 */
export function createRibbon(
  world: World,
  renderer: Renderer | undefined,
  material: number,
  cols: number,
  ring: number,
  /** Radius of the sphere the tube slides over — becomes its local AABB. */
  boundRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
  /** Scale applied to the cross-section's SURFACE-NORMAL component. 1 is a
   *  circular tube; a small value flattens it into a band lying on the ground,
   *  which is how the deformation track is built out of the same lattice. */
  flatten = 1,
): Ribbon | undefined {
  // `?noribbon=1` builds nothing at all — the isolation switch for every swept
  // tube at once (player, bots, deformation track, berms, water wake). Bisecting
  // "which system is drawing that" by screenshot cost most of a session; one
  // gate at the factory answers it in a single reload.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('noribbon')) {
    return undefined;
  }
  const ringVerts = ring + 1;
  const vertexCount = cols * ringVerts;
  const quadCount = (cols - 1) * ring;
  const indices = new Uint16Array(quadCount * 6);

  let k = 0;
  for (let c = 0; c < cols - 1; c++) {
    for (let r = 0; r < ring; r++) {
      const a = c * ringVerts + r;
      const b = a + 1;
      const d = (c + 1) * ringVerts + r;
      const e = d + 1;
      // Winding: outward-facing with the engine default (cullMode 'back',
      // frontFace 'ccw' — pipeline-spec.ts:399-400). The ring advances from
      // `right` toward the surface normal, and (right, up, fwd) is right-handed,
      // which puts the front face on the outside for THIS order. The mirrored
      // order renders the tube's interior instead: the top wall gets culled and
      // only the flanks survive, which reads as two thin strips rather than as
      // an inside-out tube — a much less obvious symptom than it sounds.
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = b; indices[k++] = e; indices[k++] = d;
    }
  }

  // Seed geometry — and why it is spread PER RING rather than per vertex.
  //
  // `meshFromInterleaved` derives the mesh's local AABB from these positions
  // (geometry/src/box.ts:159 — "the cull + pick path can only read an AABB the
  // POD already holds") and `updateMesh` rewrites the GPU buffers WITHOUT
  // touching it, so the seed has to span the sphere the tube slides over or the
  // finished body is frustum-culled every frame: no error, nothing drawn.
  //
  // But the seed also DRAWS, and for longer than it looks: `updateMeshById`
  // returns silently when the mesh is not yet resident, so push()'s failure
  // counter never trips and there is no warning. Spread per VERTEX, the index
  // buffer stitches those scattered points into a lattice of long thin
  // triangles flung across the whole planet — a swath of pale blade-shaped
  // slivers that was mistaken in turn for grass, for particles and for the
  // water wake before a switch-by-switch bisect pinned it here.
  //
  // Spreading per RING gives both. Every triangle the index buffer builds is
  // (a, b, d) or (b, e, d) with two of its three vertices in the SAME ring —
  // so with a ring collapsed to a point, every triangle has zero area and
  // nothing rasterises, while the ring centres still touch all six faces of the
  // bounding box. Setting `.aabb` by hand afterwards does NOT work here (tried:
  // the body then never drew at all), so the bound has to come from the
  // positions the way the engine expects.
  const seed = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    const b = i * 8;
    // Fibonacci-ish spread over the ring index: cheap, and guarantees all six
    // box faces are touched.
    const ci = Math.floor(i / ringVerts);
    const t = (ci + 0.5) / Math.max(1, cols);
    const y = 1 - 2 * t;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ci * 2.399963229728653;
    seed[b] = Math.cos(th) * rr * boundRadius;
    seed[b + 1] = y * boundRadius;
    seed[b + 2] = Math.sin(th) * rr * boundRadius;
    seed[b + 3] = Math.cos(th) * rr; seed[b + 4] = y; seed[b + 5] = Math.sin(th) * rr;
    seed[b + 6] = (i % ringVerts) / ring;
    seed[b + 7] = ci / Math.max(1, cols - 1);
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

  // Live buffer, mutated in place every frame. Never reallocated — a per-frame
  // allocation here would be the one allocation in the render loop.
  const verts = new Float32Array(vertexCount * FLOATS_PER_VERTEX);

  const writeRing = (
    ci: number,
    centre: V3,
    right: V3,
    up: V3,
    fwd: V3,
    radius: number,
    u: number,
    w: number,
    aspect: number,
    roll: number,
  ): void => {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const ellip = aspect !== 1;
    for (let r = 0; r <= ring; r++) {
      const ang = (r / ring) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Section in the (right, up) plane. `flatten` is a factory-wide squash of
      // the surface-normal axis; `aspect` widens the other one per ring.
      let px = ca * aspect;
      let py = sa * flatten;
      // Outward normal. For a circle that is the position direction itself,
      // which is what every snake body in this game relies on; for an ellipse
      // (a cos, b sin) it is (b cos, a sin) normalised, and using the position
      // instead would light a flattened section as though it were round —
      // exactly the reading the flattening exists to destroy.
      let nu = ca;
      let nv = sa * flatten;
      if (ellip) {
        nu = flatten * ca;
        nv = aspect * sa;
        const nl = Math.hypot(nu, nv) || 1;
        nu /= nl; nv /= nl;
      }
      if (roll !== 0) {
        const qx = px * cr - py * sr;
        const qy = px * sr + py * cr;
        px = qx; py = qy;
        const mu = nu * cr - nv * sr;
        const mv = nu * sr + nv * cr;
        nu = mu; nv = mv;
      }
      const nx = right[0] * nu + up[0] * nv;
      const ny = right[1] * nu + up[1] * nv;
      const nz = right[2] * nu + up[2] * nv;
      const b = (ci * ringVerts + r) * FLOATS_PER_VERTEX;
      verts[b] = centre[0] + (right[0] * px + up[0] * py) * radius;
      verts[b + 1] = centre[1] + (right[1] * px + up[1] * py) * radius;
      verts[b + 2] = centre[2] + (right[2] * px + up[2] * py) * radius;
      verts[b + 3] = nx; verts[b + 4] = ny; verts[b + 5] = nz;
      verts[b + 6] = r / ring;
      verts[b + 7] = u;
      // Tangent runs along the spine, which is exactly the u direction of the
      // parameterisation — so it is the travel direction, no derivation needed.
      verts[b + 8] = fwd[0]; verts[b + 9] = fwd[1]; verts[b + 10] = fwd[2];
      verts[b + 11] = w;
    }
  };

  let hidden = false;
  // The handle must be resident before updateMesh works, and residency only
  // happens once the mesh has been through a frame. So the first call or two
  // legitimately fail — but a catch-all that swallows everything is exactly how
  // the dead-update-loop bug hid for two sessions. Report once, keep the reason.
  let pushFailures = 0;
  let reported = false;
  const push = (): void => {
    try {
      if (!updateMesh(renderer, handle, verts, indices)) {
        if (!reported) {
          reported = true;
          console.warn('[planet-snake] ribbon: dynamic mesh upload unavailable — keeping the resident seed mesh');
        }
        return;
      }
      pushFailures = 0;
    } catch (e) {
      pushFailures++;
      // Two or three misses while the mesh becomes resident is normal; a
      // persistent failure is a real bug and must not stay quiet.
      if (pushFailures === 8 && !reported) {
        reported = true;
        console.error('[planet-snake] ribbon: updateMesh keeps failing —', (e as Error)?.message ?? e);
      }
    }
  };

  return {
    entity,
    handle,
    // Diagnostic hook: the geometry is written on the CPU, so when the tube
    // looks wrong the fastest answer is to read the ring back rather than infer
    // it from the render.
    debugRing(ci: number): number[] {
      const out: number[] = [];
      for (let r = 0; r <= ring; r++) {
        const b = (ci * ringVerts + r) * FLOATS_PER_VERTEX;
        out.push(verts[b]!, verts[b + 1]!, verts[b + 2]!);
      }
      return out;
    },
    hide() {
      if (hidden) return;
      hidden = true;
      for (let i = 0; i < vertexCount; i++) verts[i * FLOATS_PER_VERTEX + 1] = -500;
      push();
    },
    update(samples, count, surfaceRadius) {
      hidden = false;
      const n = Math.max(2, Math.min(count, cols));
      for (let c = 0; c < cols; c++) {
        // Columns past the live spine collapse onto the tail sample, so a short
        // body degenerates instead of stretching the lattice.
        const s = samples[Math.min(c, n - 1)]!;
        const dir = s.dir;
        const rr = surfaceRadius + (s.lift ?? 0);
        const centre: V3 = [dir[0] * rr, dir[1] * rr, dir[2] * rr];
        // The sphere normal is the stable frame — see the header note.
        const up = dir;
        let right = norm(cross(s.fwd, up));
        // A ribbon thrown into the air can point straight up or straight down,
        // where fwd is parallel to the sphere normal and the cross product
        // degenerates to zero — a NaN frame and a ring of NaN vertices, which
        // takes the whole mesh with it. Snake bodies never hit this because
        // they lie on the surface; anything that leaves it does.
        if (!Number.isFinite(right[0]) || Math.abs(dot3(s.fwd, up)) > 0.999) {
          const alt: V3 = Math.abs(s.fwd[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
          right = norm(cross(s.fwd, alt));
        }
        const realUp = cross(right, s.fwd);
        // Collapse trailing duplicate columns to zero radius so the tail closes
        // instead of ending in an open cylinder mouth.
        const radius = c < n ? s.radius : 0;
        writeRing(c, centre, right, realUp, s.fwd, radius, s.u ?? c / Math.max(1, cols - 1), s.w ?? 1,
          s.aspect ?? 1, s.roll ?? 0);
      }
      push();
    },
  };
}
