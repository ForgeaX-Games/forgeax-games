// Hellforge FX — custom shader materials + a pooled particle system.
//
// Shaders (registered once against the engine ShaderRegistry):
//   hellforge::fire_bolt     — the Fire Bolt projectile body (living flame)
//   hellforge::portal_vortex — swirling portal discs (cave / return portal)
//
// Particles: tiny manually-integrated ECS entities (sphere/cube + emissive
// standard material), pooled in a JS array. Modes:
//   'shrink' — uniform scale eases to 0 over life (hit bursts, gibs)
//   'rise'   — slow upward drift + shrink (campfire embers, portal motes)
//
// All amplitudes stay modest (see cow-survivor's ACES white-wash lessons):
// emissive intensity ≤ 2, premultiplied-alpha blend on custom shaders.

import {
  Transform, MeshFilter, MeshRenderer, Materials,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';

import fireBoltShader from './shaders/fire-bolt.wgsl';
import portalShader from './shaders/portal-vortex.wgsl';

export type MatHandle = Handle<'MaterialAsset', 'shared'>;

const FIRE_BOLT_SHADER_ID = 'hellforge::fire_bolt';
const PORTAL_SHADER_ID = 'hellforge::portal_vortex';

export type FxColor = 'fire' | 'ice' | 'lightning' | 'blood' | 'gold' | 'shadow' | 'heal';

interface Particle {
  e: EntityHandle;
  age: number;
  life: number;
  vx: number; vy: number; vz: number;
  gy: number;              // gravity (negative) or buoyancy (positive)
  mode: 'shrink' | 'rise' | 'pop';
  s0: number;              // spawn scale
  x: number; y: number; z: number;
}

/** Premultiplied-alpha render state for custom-shader FX (occlude, not sum). */
const FX_RENDER_STATE = {
  depthWriteEnabled: false,
  depthCompare: 'less' as const,
  cullMode: 'none' as const,
  blend: {
    color: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
    alpha: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
  },
};

export class FxSystem {
  private particles: Particle[] = [];
  private mats: Record<FxColor, MatHandle>;
  private elapsed = 0;
  // Custom-shader materials + their live param objects (metallic = time).
  private fireBoltMat: MatHandle | null = null;
  private fireBoltParams: { baseColor: number[]; metallic: number; roughness: number } | null = null;
  private portalMats: Array<{ mat: MatHandle; params: { baseColor: number[]; metallic: number; roughness: number } }> = [];
  // Campfire ember emitter state.
  private emberTimer = 0;
  private emberAt: { x: number; y: number; z: number } | null = null;

  constructor(private world: World, app?: unknown) {
    const palette: Record<FxColor, { c: [number, number, number]; i: number }> = {
      fire:      { c: [1.0, 0.32, 0.06], i: 1.4 },
      ice:       { c: [0.45, 0.80, 1.0], i: 1.4 },
      lightning: { c: [0.80, 0.60, 1.0], i: 1.8 },
      blood:     { c: [0.75, 0.08, 0.08], i: 0.9 },
      gold:      { c: [1.0, 0.80, 0.25], i: 1.5 },
      shadow:    { c: [0.45, 0.25, 0.70], i: 1.2 },
      heal:      { c: [0.90, 0.25, 0.25], i: 1.6 },
    };
    this.mats = {} as Record<FxColor, MatHandle>;
    for (const [name, p] of Object.entries(palette) as [FxColor, { c: [number, number, number]; i: number }][]) {
      this.mats[name] = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: [p.c[0], p.c[1], p.c[2], 1], roughness: 0.4, metallic: 0,
        emissive: p.c, emissiveIntensity: p.i,
      }));
    }

    // ── custom shaders (graceful fallback to plain emissive if unavailable) ──
    const renderer = (app as {
      renderer?: {
        shader?: {
          registerMaterialShader: (id: string, entry: {
            source: string;
            paramSchema: Array<{ name: string; type: 'color' | 'f32' }>;
            bindingLayout: [];
          }) => void;
        } | null;
      };
    } | undefined)?.renderer;
    if (renderer?.shader) {
      const safeRegister = (id: string, source: string): void => {
        try {
          renderer.shader!.registerMaterialShader(id, {
            source,
            paramSchema: [
              { name: 'baseColor', type: 'color' },
              { name: 'metallic', type: 'f32' },
              { name: 'roughness', type: 'f32' },
            ],
            bindingLayout: [],
          });
        } catch (e) {
          const msg = (e as Error).message ?? '';
          if (!msg.includes('already registered')) {
            console.warn(`[hellforge/fx] registerMaterialShader(${id}) threw:`, msg);
          }
        }
      };
      try {
        safeRegister(FIRE_BOLT_SHADER_ID, fireBoltShader.wgsl);
        safeRegister(PORTAL_SHADER_ID, portalShader.wgsl);
        const fbParams = { baseColor: [1.0, 0.18, 0.03, 1], metallic: 0, roughness: 1.35 };
        this.fireBoltMat = this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{ name: 'Forward', shader: FIRE_BOLT_SHADER_ID, tags: { LightMode: 'Forward' }, queue: 3000, renderState: FX_RENDER_STATE }],
          paramValues: fbParams as never,
        });
        this.fireBoltParams = fbParams;
      } catch (e) {
        console.warn('[hellforge/fx] custom-shader setup failed; falling back to emissive:', (e as Error).message);
      }
    }
  }

  /** Fire Bolt body material (custom shader) — null when unavailable. */
  fireBoltMaterial(): MatHandle | null { return this.fireBoltMat; }

  /** Mint a portal material with its own tint; time is fed by tick(). */
  portalMaterial(tint: [number, number, number]): MatHandle | null {
    if (!this.fireBoltMat) return null;   // shader registry unavailable
    const params = { baseColor: [tint[0], tint[1], tint[2], 1], metallic: 0, roughness: 1.0 };
    const mat = this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
      kind: 'material',
      passes: [{ name: 'Forward', shader: PORTAL_SHADER_ID, tags: { LightMode: 'Forward' }, queue: 3000, renderState: FX_RENDER_STATE }],
      paramValues: params as never,
    });
    this.portalMats.push({ mat, params });
    return mat;
  }

  /** Plain emissive material for a palette colour (monster gibs, bolts...). */
  colorMaterial(color: FxColor): MatHandle { return this.mats[color]; }

  /** Where the campfire ember column rises from (set once at boot). */
  setCampfire(x: number, y: number, z: number): void { this.emberAt = { x, y, z }; }

  // ── particle spawns ──────────────────────────────────────────────────────

  private spawnParticle(
    x: number, y: number, z: number, s: number, color: FxColor,
    vx: number, vy: number, vz: number, gy: number, life: number,
    mode: 'shrink' | 'rise' | 'pop', shape: 'cube' | 'sphere' = 'sphere',
  ): void {
    if (this.particles.length > 320) return;    // hard cap — never flood the world
    const spawned = this.world.spawn(
      { component: Transform, data: { pos: [x, y, z], scale: [s, s, s] } },
      { component: MeshFilter, data: { assetHandle: shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [this.mats[color]] } },
    );
    if (!spawned.ok) return;
    this.particles.push({ e: spawned.value as EntityHandle, age: 0, life, vx, vy, vz, gy, mode, s0: s, x, y, z });
  }

  /** Radial burst at a hit point (projectile impact, melee hit). */
  burst(x: number, y: number, z: number, color: FxColor, count = 6, speed = 3.2): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const up = 1.0 + Math.random() * 2.2;
      this.spawnParticle(
        x, y, z, 0.07 + Math.random() * 0.07, color,
        Math.cos(ang) * speed * (0.4 + Math.random() * 0.6),
        up,
        Math.sin(ang) * speed * (0.4 + Math.random() * 0.6),
        -7, 0.4 + Math.random() * 0.3, 'shrink',
      );
    }
  }

  /** Death gibs — chunkier, redder, fall to the ground. */
  gibs(x: number, y: number, z: number, color: FxColor = 'blood', count = 9): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * 2.6;
      this.spawnParticle(
        x, y + 0.3, z, 0.09 + Math.random() * 0.1, color,
        Math.cos(ang) * sp, 2.4 + Math.random() * 2.4, Math.sin(ang) * sp,
        -9.5, 0.55 + Math.random() * 0.35, 'shrink', 'cube',
      );
    }
  }

  /** Impact flash — one emissive orb that pops (expands + dies in ~0.15 s).
   *  The single-frame-scale punch is what sells a hit; particles alone read
   *  as decoration. Layer this UNDER burst() on every meaningful impact. */
  pop(x: number, y: number, z: number, color: FxColor, size = 0.4): void {
    this.spawnParticle(x, y, z, size, color, 0, 0, 0, 0, 0.16, 'pop');
  }

  /** Soft rising motes (level-up, portal ambience, campfire embers). */
  rise(x: number, y: number, z: number, color: FxColor, count = 5, spread = 0.5): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.spawnParticle(
        x + Math.cos(ang) * r, y, z + Math.sin(ang) * r,
        0.05 + Math.random() * 0.05, color,
        (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4,
        0.8, 0.8 + Math.random() * 0.7, 'rise',
      );
    }
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  tick(dt: number): void {
    this.elapsed += dt;
    // Feed wall-clock time into the custom shaders. The paramValues object is
    // held BY REFERENCE by the material asset (cow-survivor does the same) —
    // mutating `.metallic` here is what the renderer uploads next frame.
    if (this.fireBoltParams) this.fireBoltParams.metallic = this.elapsed;
    for (const p of this.portalMats) p.params.metallic = this.elapsed;

    // Campfire embers — a steady trickle.
    if (this.emberAt) {
      this.emberTimer -= dt;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.22 + Math.random() * 0.2;
        this.rise(this.emberAt.x, this.emberAt.y, this.emberAt.z, 'fire', 2, 0.45);
      }
    }

    // Integrate particles.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.world.despawn(p.e);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.mode === 'shrink' && p.y < 0.03) { p.y = 0.03; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; }
      const t = p.age / p.life;
      const s = p.mode === 'rise' ? p.s0 * (1 - t * 0.7)
        : p.mode === 'pop' ? p.s0 * (0.5 + t * 2.2)     // rapid expand, dies young
        : p.s0 * (1 - t * t);
      this.world.set(p.e, Transform, {
        pos: [p.x, p.y, p.z],
        scale: [s, s, s],
      });
    }
  }

  count(): number { return this.particles.length; }
}
