// Instanced particle bursts.
//
// WHY THIS SHAPE
//
// The engine ships `vfx` / `vfx-compiler`, but they are CPU scaffolding: a
// definition format, a cook step and a `ParticleSimulation` that produces a
// `ParticleRenderBatch`. There is no GPU executor and no RenderFeature that
// draws that batch, so nothing in that package puts a pixel on screen. What the
// engine DOES have is `Instances`, the per-entity transform array the grass
// already draws through — one mesh, one draw call, N matrices.
//
// So the split is: simulate on the CPU (a few hundred particles is nothing),
// and let instancing do the drawing. Each particle's whole per-instance state
// travels in its transform — the basis carries the billboard orientation and
// the scale carries the fade — so no extra vertex stream and no custom shader
// are needed.
//
// The buffer cap is the hard constraint: `BufferPool` tops out at 262144 bytes
// for an `array<f32>` field (buffer-pool.ts:135), so ONE entity holds at most
// 262144/64 = 4096 instances. Overshooting does not throw at the call site — it
// routes a structured error through `World.write` and the component silently
// never lands, which presents as no particles at all. That is the same trap the
// grass fell into, so CAP is checked here rather than discovered later.
//
// NOT a trail. An earlier wake-puff system dropped a fading sphere every few
// units of arc and read as debris following the snake; it was removed on
// request. These are event bursts: they fire on a pickup, live under a second,
// and leave nothing behind.

import type { EntityHandle, World } from '@forgeax/engine-ecs';

export type V3 = [number, number, number];

const CAP = 4096;

interface Particle {
  pos: V3;
  vel: V3;
  born: number;
  life: number;
  size: number;
  spin: number;
}

export interface Bursts {
  /** Grains alive this frame — the number to compare against a reference. */
  live(): number;
  /** Throw `count` particles outward from a point on the sphere.
   *
   *  `bias` skews the launch direction — pass the snake's BACKWARD tangent and
   *  the cone becomes a rooster tail thrown behind it instead of an even puff,
   *  which is what the reference's spray does at speed
   *  (reference frame f09). `spread` scales the cone. */
  emit(at: V3, radius: number, count: number, now: number, tint: number,
       bias?: V3, speedScale?: number): void;
  /**
   * Emit ONE grain with an explicit velocity.
   *
   * `emit` builds its own cone, which is right for a burst thrown out of a
   * point. It is wrong for anything whose motion is already described by a
   * curve — the Maelstrom's helices carry their own tangential velocity, and
   * handing that straight to a grain is what makes the spray swirl without the
   * particle field knowing what a vortex is.
   */
  emitAt(at: V3, radius: number, vel: V3, now: number, tint: number): void;
  /** Integrate and re-upload. Call once per frame with the camera position. */
  update(now: number, dt: number, camPos: V3, planetRadius: number): void;
  /** Park everything (game over / restart). */
  clear(): void;
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

/**
 * One camera-facing quad, crossed so it never vanishes edge-on if the billboard
 * basis degenerates. Layout is the factory's 8-float interleaved form
 * (position, normal, uv) that meshFromInterleaved expands to the runtime 12.
 */
function quadInterleaved(crossed: boolean): { verts: Float32Array; indices: Uint16Array } {
  const V: number[] = [];
  const I: number[] = [];
  const face = (ax: number, az: number) => {
    const base = V.length / 8;
    const corners: [number, number, number, number, number][] = [
      [-0.5 * ax, -0.5, -0.5 * az, 0, 0],
      [0.5 * ax, -0.5, 0.5 * az, 1, 0],
      [0.5 * ax, 0.5, 0.5 * az, 1, 1],
      [-0.5 * ax, 0.5, -0.5 * az, 0, 1],
    ];
    for (const [x, y, z, u, v] of corners) V.push(x, y, z, 0, 0, 1, u, v);
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    I.push(base, base + 2, base + 1, base, base + 3, base + 2);   // double-sided
  };
  face(1, 0);
  // The crossed second face is insurance for an OPAQUE sprite whose billboard
  // basis degenerates. An alpha-blended grain must not have it: the two discs
  // cross at right angles, and where they overlap the coverage doubles — a
  // bright X sitting inside every puff, which is exactly the "stamp" read the
  // soft edge exists to remove.
  if (crossed) face(0, 1);
  return { verts: new Float32Array(V), indices: new Uint16Array(I) };
}

/**
 * A parked instance matrix: zero basis, w = 1.
 *
 * NOT an all-zero matrix. Zero in the w slot puts every vertex of the quad at
 * INFINITY, and the primitive renders as a sliver clear across the screen
 * instead of disappearing. One parked burst entity painted a comb of pale
 * blade-shaped slivers over 91% of the frame; because they look exactly like
 * grass seen close up they were read as the grass fringe through a whole
 * session of colour measurements, which is why those measurements would not
 * respond to the grass albedo.
 *
 * With w = 1 the vertices collapse to the local origin instead: zero-area
 * triangles at the planet centre, which is both invisible and inside the sphere.
 */
function parked(): Float32Array {
  const m = new Float32Array(16);
  m[15] = 1;
  return m;
}

export function installBursts(
  world: World,
  material: number,
  boundRadius: number,
  // biome-ignore lint/suspicious/noExplicitAny: engine component tokens
  components: { Transform: any; MeshFilter: any; MeshRenderer: any; Instances: any },
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
  opts?: {
    /** Draw a single quad instead of the crossed pair — required for
     *  alpha-blended grains, see quadInterleaved. Default true (crossed). */
    crossed?: boolean;
    /** Grain size range in world units. Default the pickup spark's. */
    size?: readonly [number, number];
    /** Lifetime range in seconds. Default the pickup spark's. */
    life?: readonly [number, number];
  },
): Bursts | undefined {
  const { verts, indices } = quadInterleaved(opts?.crossed !== false);
  const sizeLo = opts?.size?.[0] ?? 0.13;
  const sizeHi = opts?.size?.[1] ?? 0.33;
  const lifeLo = opts?.life?.[0] ?? 0.70;
  const lifeHi = opts?.life?.[1] ?? 1.20;
  const mesh = meshFromInterleaved(verts, indices);
  // Frustum culling transforms the MESH's aabb by the ENTITY matrix and never
  // looks at where the instances actually are, so the bound has to be the whole
  // sphere the bursts can cover. (The grass and the ribbon both learned this the
  // expensive way — a one-quad aabb culls every instance the moment the entity
  // origin leaves the frustum.)
  const R = boundRadius;
  (mesh as { aabb: Float32Array }).aabb = new Float32Array([-R, -R, -R, R, R, R]);

  const handle = world.allocSharedRef('MeshAsset', mesh) as number;
  const transforms = new Float32Array(CAP * 16);
  const pool: Particle[] = [];

  const entity = world
    .spawn(
      { component: components.Transform, data: { pos: [0, 0, 0] } },
      { component: components.MeshFilter, data: { assetHandle: handle } },
      { component: components.MeshRenderer, data: { materials: [material] } },
      { component: components.Instances, data: { transforms: parked() } },
    )
    .unwrap() as EntityHandle;

  let live = 0;

  return {
    live() { return live; },
    emit(at, radius, count, now, tint, bias, speedScale) {
      const up = norm(at);
      const bx = bias ? bias[0] : 0, by = bias ? bias[1] : 0, bz = bias ? bias[2] : 0;
      const vs = speedScale ?? 1;
      const ref: V3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const t1 = norm(cross(up, ref));
      const t2 = cross(up, t1);
      for (let i = 0; i < count; i++) {
        if (pool.length >= CAP) break;
        // Cone outward from the surface: mostly up, splayed sideways.
        const az = Math.random() * Math.PI * 2;
        // Splay range widened, and it matters more than it looks: with `bias`
        // set to the snake's backward tangent at 0.85, a narrow cone put every
        // grain on one line hugging the body — measured with a dye pass, the
        // whole effect was a red thread down the tail. The reference is "soft
        // out-of-focus specks SCATTERED behind the runner, not a tight jet".
        const splay = 0.5 + Math.random() * 1.5;
        const speed = 1.6 + Math.random() * 4.4;
        const dir: V3 = [
          up[0] + (t1[0] * Math.cos(az) + t2[0] * Math.sin(az)) * splay + bx,
          up[1] + (t1[1] * Math.cos(az) + t2[1] * Math.sin(az)) * splay + by,
          up[2] + (t1[2] * Math.cos(az) + t2[2] * Math.sin(az)) * splay + bz,
        ];
        const d = norm(dir);
        pool.push({
          pos: [up[0] * radius, up[1] * radius, up[2] * radius],
          vel: [d[0] * speed * vs, d[1] * speed * vs, d[2] * speed * vs],
          born: now,
          life: lifeLo + Math.random() * (lifeHi - lifeLo),
          size: (sizeLo + Math.random() * (sizeHi - sizeLo)) * (0.85 + tint * 0.3),
          spin: (Math.random() - 0.5) * 6,
        });
      }
    },

    emitAt(at, radius, vel, now, tint) {
      if (pool.length >= CAP) return;
      const up = norm(at);
      pool.push({
        pos: [up[0] * radius, up[1] * radius, up[2] * radius],
        vel: [vel[0], vel[1], vel[2]],
        born: now,
        life: lifeLo + Math.random() * (lifeHi - lifeLo),
        size: (sizeLo + Math.random() * (sizeHi - sizeLo)) * (0.85 + tint * 0.3),
        spin: (Math.random() - 0.5) * 6,
      });
    },

    update(now, dt, camPos, planetRadius) {
      // Integrate, retiring dead particles by swap-remove so the array stays
      // dense and the write below is one contiguous upload.
      for (let i = pool.length - 1; i >= 0; i--) {
        const p = pool[i]!;
        if (now - p.born >= p.life) {
          pool[i] = pool[pool.length - 1]!;
          pool.pop();
          continue;
        }
        // Gravity toward the planet centre, plus drag. Radial gravity is what
        // makes a burst on a sphere arc back down instead of drifting flat.
        const r = Math.hypot(p.pos[0], p.pos[1], p.pos[2]) || 1;
        const g = 11 * dt;
        p.vel[0] += (-p.pos[0] / r) * g;
        p.vel[1] += (-p.pos[1] / r) * g;
        p.vel[2] += (-p.pos[2] / r) * g;
        const drag = Math.max(0, 1 - 1.6 * dt);
        p.vel[0] *= drag; p.vel[1] *= drag; p.vel[2] *= drag;
        p.pos[0] += p.vel[0] * dt;
        p.pos[1] += p.vel[1] * dt;
        p.pos[2] += p.vel[2] * dt;
        // Floor: never sink below the surface, so a burst piles up rather than
        // disappearing into the planet.
        const rr = Math.hypot(p.pos[0], p.pos[1], p.pos[2]) || 1;
        if (rr < planetRadius) {
          const s = planetRadius / rr;
          p.pos[0] *= s; p.pos[1] *= s; p.pos[2] *= s;
          p.vel[0] *= 0.35; p.vel[1] *= 0.35; p.vel[2] *= 0.35;
        }
      }

      const n = Math.min(pool.length, CAP);
      if (n === 0) {
        if (live !== 0) {
          world.set(entity, components.Instances, { transforms: parked() });
          live = 0;
        }
        return;
      }

      for (let i = 0; i < n; i++) {
        const p = pool[i]!;
        const age = (now - p.born) / p.life;
        // Fade by SHRINKING. There is no per-instance alpha channel in the
        // transform, and adding one would mean a custom vertex stream; scaling
        // to nothing reads the same on a small emissive sprite.
        const s = p.size * Math.max(0, 1 - age * age);
        // Billboard: face the camera, with a per-particle roll so a burst does
        // not look like a sheet of identical stamps.
        const fwd = norm([camPos[0] - p.pos[0], camPos[1] - p.pos[1], camPos[2] - p.pos[2]]);
        const refv: V3 = Math.abs(fwd[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const rgt0 = norm(cross(refv, fwd));
        const up0 = cross(fwd, rgt0);
        const c = Math.cos(p.spin * (now - p.born)), sn = Math.sin(p.spin * (now - p.born));
        const rgt: V3 = [rgt0[0] * c + up0[0] * sn, rgt0[1] * c + up0[1] * sn, rgt0[2] * c + up0[2] * sn];
        const upv: V3 = [-rgt0[0] * sn + up0[0] * c, -rgt0[1] * sn + up0[1] * c, -rgt0[2] * sn + up0[2] * c];
        const o = i * 16;
        transforms[o] = rgt[0] * s; transforms[o + 1] = rgt[1] * s; transforms[o + 2] = rgt[2] * s; transforms[o + 3] = 0;
        transforms[o + 4] = upv[0] * s; transforms[o + 5] = upv[1] * s; transforms[o + 6] = upv[2] * s; transforms[o + 7] = 0;
        transforms[o + 8] = fwd[0] * s; transforms[o + 9] = fwd[1] * s; transforms[o + 10] = fwd[2] * s; transforms[o + 11] = 0;
        transforms[o + 12] = p.pos[0]; transforms[o + 13] = p.pos[1]; transforms[o + 14] = p.pos[2]; transforms[o + 15] = 1;
      }
      // slice(), not subarray(): the ECS column copies from the payload's own
      // buffer, so it has to be an exact-size array starting at offset 0.
      world.set(entity, components.Instances, { transforms: transforms.slice(0, n * 16) });
      live = n;
    },

    clear() {
      pool.length = 0;
      if (live !== 0) {
        world.set(entity, components.Instances, { transforms: parked() });
        live = 0;
      }
    },
  };
}
