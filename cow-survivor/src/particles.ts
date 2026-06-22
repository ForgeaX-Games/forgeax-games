// particles.ts — engine-native instanced particle system.
//
// Architecture:
//   - ONE ECS entity per emitter (e.g. one for "fire-bullet trails", one
//     for "explosion bursts") carrying:
//       Transform   (kept at identity — particles live in world space)
//       MeshFilter  (HANDLE_SPHERE for round motes, HANDLE_CUBE for shards)
//       MeshRenderer(materials = [particle material with cow_survivor::particle])
//       Instances   { transforms: Float32Array(capacity * 16) }
//   - Each "particle" is one column-major mat4 in `transforms` covering
//     16 floats. The vertex shader reads it via @builtin(instance_index)
//     through the engine's `instances[i].localFromInstance` storage buffer
//     (engine wires the Instances component up at the record stage).
//   - We integrate position / velocity / rotation on the CPU each frame,
//     re-pack each particle's mat4 into the array, then call
//     world.set(e, Instances, { transforms }) so the GPU buffer refreshes.
//   - Dead particles (age >= life) get a degenerate (all-zero) matrix so
//     their geometry collapses to the origin and contributes nothing on
//     the rasterizer.
//
// Why not one ECS entity per particle (the previous fx.addParticle path)?
//   For 60 particles per blast × multiple blasts per second × per-bullet
//   trails, the per-entity ChildOf bookkeeping + 60 individual draw calls
//   choke the world.spawn path. Instances collapses 60 draws to 1.

import {
  Transform, MeshFilter, MeshRenderer, Instances,
  HANDLE_SPHERE, HANDLE_CUBE, type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';

// Trigger vite-plugin-shader registration by importing the .wgsl source
// (the .wgsl.meta.json sidecar declares materialShaderIdentifier =
// 'cow_survivor::particle' so the plugin pre-registers it into the engine
// ShaderRegistry as a side effect of this import). Even though we don't
// reference the imported `particleShader` value directly, the import is
// required so the registry has the entry by the time `register<MaterialAsset>`
// for this shader runs.
import particleShader from './shaders/particle.wgsl';
void particleShader;

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type Ctx = Parameters<GameEntry>[0];

const PARTICLE_SHADER_ID = 'cow_survivor::particle';

// Render state shared by every particle emitter — PREMULTIPLIED ALPHA blend.
//
// Previously this was pure-ADDITIVE (`src=one, dst=one`): every particle ADDS
// its emissive RGB onto whatever is behind it. That looks great for a few
// sparks, but explosion() emits 40+ overlapping fire particles in a tight
// radius, and 40 × per-particle brightness SUMS far past 1.0 → the ACES
// tonemap then clamps the saturated result to YELLOW-WHITE. Worse, as the
// kill-count climbs more particle clusters overlap → the whole screen ramps
// brighter and washes toward white (the user-reported "越来越亮然后发白").
// It also piled white onto the red fire bullets when an explosion happened on
// top of one — the fireball looked like it "turned white".
//
// Premultiplied alpha (`src=one, dst=one-minus-src-alpha`) makes overlapping
// particles OCCLUDE instead of SUM: the on-screen brightness of a cluster is
// capped at the brightest single particle, so no runaway accumulation and no
// white-out. depthWriteEnabled=false so the particle quads don't punch the
// depth buffer.
const PARTICLE_RENDER_STATE = {
  depthWriteEnabled: false,
  depthCompare: 'less' as const,
  cullMode: 'none' as const,
  blend: {
    color: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
    alpha: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
  },
};

// ────────────────────────────────────────────────────────────────────────
// Per-particle CPU state. We preallocate `capacity` of these in a flat
// Structure-of-Arrays-ish object array so JIT can keep them in shapes.
interface ParticleSlot {
  alive: boolean;
  age: number;
  life: number;
  // Position
  px: number; py: number; pz: number;
  // Velocity
  vx: number; vy: number; vz: number;
  // Constant gravity (gy is what most callers care about — 0 for floating
  // sparks, negative for falling debris, positive for upward smoke).
  gy: number;
  // Drag — velocity *= (1 - drag*dt) each frame. 0 for ballistic, ~3 for
  // "puffs out and stops".
  drag: number;
  // Base size at spawn. The visible scale fades with age (see fadeMode).
  size: number;
  // Yaw (Y rotation in radians) — used by elongated cube particles
  // (lightning segments, ice shards) so they orient along their velocity.
  rotY: number;
  rotVel: number;
  // Per-axis scale ratio relative to `size` (sx*size, sy*size, sz*size).
  // Sphere particles use 1/1/1; lightning segments use 0.2/0.2/1.6 so
  // they read as long thin bolts.
  sxR: number; syR: number; szR: number;
  // Fade curve. 'shrink': scale = size * (1 - age/life). 'pop':
  // scale = size * smoothstep(0, 0.1, age/life) * (1 - smoothstep(0.4, 1.0, age/life))
  // — quick grow-in then slow fade-out (good for explosion cores).
  fadeMode: 'shrink' | 'pop' | 'hold-then-shrink';
}

// ────────────────────────────────────────────────────────────────────────
// Per-emitter state.

export interface EmitterOpts {
  capacity: number;
  geometry: 'sphere' | 'cube';
  baseColor: [number, number, number];
  intensity: number;             // shader 'roughness' uniform → brightness
}

export interface ParticleInit {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  gy?: number;
  drag?: number;
  size: number;
  life: number;
  rotY?: number;
  rotVel?: number;
  sxR?: number; syR?: number; szR?: number;
  fadeMode?: 'shrink' | 'pop' | 'hold-then-shrink';
}

// Well-defined "hide" matrix for dead particle slots. All vertex positions
// collapse to (0, -1000, 0, 1) — a single point far below the floor with
// w=1 so clip-space division is well-defined (rather than NaN from the
// all-zero matrix that produces vec4(0,0,0,0)). All vertices map to the
// same point → triangles degenerate → no rasterization. With w=1 the GPU
// can clip cleanly outside the view frustum instead of flickering a
// "ghost shadow" at the camera focal point.
//   col 0..2: zero (scale = 0)
//   col 3:    (0, -1000, 0, 1)  translation + homogeneous w=1
const HIDE_MAT4 = (() => {
  const m = new Float32Array(16);
  m[12] = 0;
  m[13] = -1000;
  m[14] = 0;
  m[15] = 1;
  return m;
})();

export class ParticleEmitter {
  readonly capacity: number;
  readonly entity: Entity;
  private particles: ParticleSlot[];
  private transforms: Float32Array;
  private cursor = 0;
  private params: { baseColor: number[]; metallic: number; roughness: number };
  private elapsed = 0;
  // The world.set call to update transforms is a hot path; cache the
  // payload object so we don't re-allocate it 60+ times per frame.
  private setPayload: { transforms: Float32Array };

  constructor(private ctx: Ctx, opts: EmitterOpts, materialHandle: MatHandle, paramsRef: { baseColor: number[]; metallic: number; roughness: number }) {
    this.capacity = opts.capacity;
    this.params = paramsRef;
    this.particles = new Array(opts.capacity);
    for (let i = 0; i < opts.capacity; i++) {
      this.particles[i] = {
        alive: false, age: 0, life: 1,
        px: 0, py: 0, pz: 0,
        vx: 0, vy: 0, vz: 0,
        gy: 0, drag: 0,
        size: 1, rotY: 0, rotVel: 0,
        sxR: 1, syR: 1, szR: 1,
        fadeMode: 'shrink',
      };
    }
    this.transforms = new Float32Array(opts.capacity * 16);
    // Initial: all particles dead → all-zero matrices → no triangles
    // emitted. The engine still uploads the buffer once at spawn though,
    // so we leave it zeroed out.
    this.setPayload = { transforms: this.transforms };

    const handle = opts.geometry === 'sphere' ? HANDLE_SPHERE : HANDLE_CUBE;
    // Emitter entity Transform = scale 0 below the floor. Our particle
    // material's `vs_main` IGNORES `meshes[0].worldFromLocal` and reads
    // only `instances[i].localFromInstance`, so the entity Transform does
    // NOT affect alive particles — but the engine's SHADOW PASS uses its
    // own generic vertex shader (`entityWorld * instanceLocal * pos`),
    // which would project the entity's 1m sphere/cube AT ITS WORLD ORIGIN
    // into the shadow map → a phantom 1-2m square shadow at world (0,0,0)
    // that lands on the ground right where the player spawns. Collapsing
    // the entity to scale 0 + y=-2000 means the shadow pass either clips
    // the degenerate geometry outside the frustum or writes zero area.
    this.entity = ctx.world.spawn(
      { component: Transform,    data: { posX: 0, posY: -2000, posZ: 0, scaleX: 0, scaleY: 0, scaleZ: 0 } },
      { component: MeshFilter,   data: { assetHandle: handle } },
      { component: MeshRenderer, data: { materials: [materialHandle] } },
      { component: Instances,    data: { transforms: this.transforms } },
    ).unwrap();
    // Initialize every slot to the hide-mat4 (degenerate-but-well-defined
    // matrix below the floor). Without this, the freshly-spawned entity
    // uploads the all-zero buffer for one frame; the vertex shader
    // multiplies by an all-zero mat4, gets vec4(0,0,0,0) in clip space
    // (w=0 → GPU behaviour undefined), and renders a flickering "ghost
    // shadow" at the camera's focal point. See HIDE_MAT4 below.
    for (let i = 0; i < opts.capacity; i++) {
      const off = i * 16;
      for (let k = 0; k < 16; k++) this.transforms[off + k] = HIDE_MAT4[k]!;
    }
  }

  /** Spawn one particle into a free slot (or recycle the oldest). */
  emit(init: ParticleInit): void {
    let slot = -1;
    // First try to find a dead slot.
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.cursor + i) % this.capacity;
      if (!this.particles[idx]!.alive) { slot = idx; break; }
    }
    // All alive → recycle the oldest by advancing cursor.
    if (slot === -1) { slot = this.cursor; }
    this.cursor = (slot + 1) % this.capacity;

    const p = this.particles[slot]!;
    p.alive = true;
    p.age = 0;
    p.life = init.life;
    p.px = init.px; p.py = init.py; p.pz = init.pz;
    p.vx = init.vx; p.vy = init.vy; p.vz = init.vz;
    p.gy = init.gy ?? 0;
    p.drag = init.drag ?? 0;
    p.size = init.size;
    p.rotY = init.rotY ?? 0;
    p.rotVel = init.rotVel ?? 0;
    p.sxR = init.sxR ?? 1; p.syR = init.syR ?? 1; p.szR = init.szR ?? 1;
    p.fadeMode = init.fadeMode ?? 'shrink';
  }

  /** Advance all particles + repack transforms. Call once per frame. */
  tick(dt: number): void {
    this.elapsed += dt;
    let anyAlive = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i]!;
      if (!p.alive) {
        // Park dead particles at origin with zero scale so they emit no
        // triangles. Cheap because most slots stay dead.
        const off = i * 16;
        for (let k = 0; k < 16; k++) this.transforms[off + k] = HIDE_MAT4[k]!;
        continue;
      }
      anyAlive = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        const off = i * 16;
        for (let k = 0; k < 16; k++) this.transforms[off + k] = HIDE_MAT4[k]!;
        continue;
      }
      // Integrate motion (Euler).
      p.vy += p.gy * dt;
      if (p.drag > 0) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rotY += p.rotVel * dt;

      // Compute scale from fade curve.
      const t = p.age / p.life;
      let fade: number;
      switch (p.fadeMode) {
        case 'shrink':
          fade = 1 - t;
          break;
        case 'pop': {
          // smoothstep grow 0..0.1, hold to 0.4, smoothstep shrink to 1.
          const grow = t < 0.1 ? (t / 0.1) * (t / 0.1) * (3 - 2 * (t / 0.1)) : 1;
          const shrink = t > 0.4
            ? 1 - (((t - 0.4) / 0.6) * ((t - 0.4) / 0.6) * (3 - 2 * ((t - 0.4) / 0.6)))
            : 1;
          fade = grow * shrink;
          break;
        }
        case 'hold-then-shrink':
          fade = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
          break;
      }
      const s = p.size * Math.max(0, fade);
      const sx = s * p.sxR, sy = s * p.syR, sz = s * p.szR;

      // Build column-major mat4 (rotation about Y + uniform-ish scale +
      // translation). The mat4 layout in `transforms` follows engine
      // convention: 16 floats, columns 0..3, each column is 4 floats.
      const cy = Math.cos(p.rotY), siY = Math.sin(p.rotY);
      const off = i * 16;
      // Column 0: scale-X · ( cosY, 0, -sinY, 0 )
      this.transforms[off + 0] = sx * cy;
      this.transforms[off + 1] = 0;
      this.transforms[off + 2] = -sx * siY;
      this.transforms[off + 3] = 0;
      // Column 1: scale-Y · ( 0, 1, 0, 0 )
      this.transforms[off + 4] = 0;
      this.transforms[off + 5] = sy;
      this.transforms[off + 6] = 0;
      this.transforms[off + 7] = 0;
      // Column 2: scale-Z · ( sinY, 0, cosY, 0 )
      this.transforms[off + 8] = sz * siY;
      this.transforms[off + 9] = 0;
      this.transforms[off + 10] = sz * cy;
      this.transforms[off + 11] = 0;
      // Column 3: translation (px, py, pz, 1)
      this.transforms[off + 12] = p.px;
      this.transforms[off + 13] = p.py;
      this.transforms[off + 14] = p.pz;
      this.transforms[off + 15] = 1;
    }

    // Drive the shared shader's wall-clock uniform regardless of liveness
    // so paramValues stays in sync — it's the same param object shared by
    // every particle in the emitter (per-instance variation already comes
    // from instance_index in the shader).
    this.params.metallic = this.elapsed;

    // Engine reads world.get(e, Instances).transforms once per frame.
    // world.set marks the slot dirty + queues a buffer.writeBuffer.
    this.ctx.world.set(this.entity, Instances, this.setPayload);
    void anyAlive;
  }

  /** Despawn the emitter entity. Call at level teardown. */
  dispose(): void {
    this.ctx.world.despawn(this.entity);
  }
}

// ────────────────────────────────────────────────────────────────────────
// ParticleSystem — collection of named emitters sharing the registered
// material-shader. `register` allocates a separate MaterialAsset per
// emitter so colors / intensities stay independent (param mutations on
// one emitter don't leak to another).

export class ParticleSystem {
  private emitters = new Map<string, ParticleEmitter>();
  private shaderRegistered = false;

  constructor(private ctx: Ctx) {}

  /** Lazily register the particle material-shader. The vite-plugin-shader
   *  pre-registers via the .meta.json sidecar at module load when the
   *  manifest scan picks up the new file. If the plugin missed it (newly-
   *  added .wgsl, dev-server hot-reload edge), fall back to manually
   *  invoking ShaderRegistry.registerMaterialShader with the imported
   *  WGSL source — same path the FX system uses for its custom shaders. */
  private ensureShader(): void {
    if (this.shaderRegistered) return;
    this.shaderRegistered = true;
    const renderer = (this.ctx.app as unknown as {
      renderer: {
        shader: {
          registerMaterialShader: (id: string, entry: { source: string; paramSchema: Array<{ name: string; type: 'color' | 'f32' }>; bindingLayout: [] }) => void;
        } | null;
      };
    }).renderer;
    if (!renderer?.shader) return;
    try {
      renderer.shader.registerMaterialShader(PARTICLE_SHADER_ID, {
        source: particleShader.wgsl,
        paramSchema: [
          { name: 'baseColor', type: 'color' },
          { name: 'metallic',  type: 'f32' },
          { name: 'roughness', type: 'f32' },
        ],
        bindingLayout: [],
      });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!msg.includes('already registered')) {
        console.warn(`[particles] registerMaterialShader fallback threw:`, msg);
      }
    }
  }

  /** Create (or fetch) a named emitter. Subsequent calls with the same
   *  name return the same emitter — caller can re-emit() into it. */
  emitter(name: string, opts: EmitterOpts): ParticleEmitter {
    this.ensureShader();
    const existing = this.emitters.get(name);
    if (existing) return existing;
    const params = {
      baseColor: [...opts.baseColor] as number[],
      metallic: 0,                              // wall-clock seconds
      roughness: opts.intensity,                // brightness multiplier
    };
    // engine e53f4616: `assets.register` is gone → mint an inline shared
    // material handle directly via `world.allocSharedRef` (never fails).
    const matHandle = this.ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
      kind: 'material',
      passes: [{
        name: 'Forward',
        shader: PARTICLE_SHADER_ID,
        tags: { LightMode: 'Forward' },
        queue: 3000,
        renderState: PARTICLE_RENDER_STATE,
      }],
      paramValues: params as never,
    });
    const em = new ParticleEmitter(this.ctx, opts, matHandle, params);
    this.emitters.set(name, em);
    return em;
  }

  /** Tick every registered emitter once. */
  tick(dt: number): void {
    for (const em of this.emitters.values()) em.tick(dt);
  }
}
