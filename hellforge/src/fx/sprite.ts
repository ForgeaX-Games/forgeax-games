// SpriteSystem — textured billboard sprite particles (PR8 T1).
//
// The renderable primitive the particle box was missing (plan §0): HANDLE_QUAD
// entities driven by the hellforge::sprite uber shader (flipbook UV animation
// + spherical/cylindrical billboarding + UV-noise distortion + alpha-erosion
// fade), additive or premultiplied-alpha blend, procedural sheets from
// fx/textures.ts uploaded as TextureAsset (contact-shadow.ts precedent).
//
// Pooling: one material per LIVE sprite (its params object is retained and
// mutated per tick — the sanctioned upload route, same as fx.ts metallic-time);
// dead sprites return their material+params to a per-(sheet|blend) free list.
// tick() performs no per-frame allocations.

import {
  Transform,
} from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
  Materials,
} from '@forgeax/engine-render';
import {
  quat,
} from '@forgeax/engine-runtime';
import { HANDLE_QUAD } from '@forgeax/engine-assets-runtime';
import { unwrapHandle } from '@forgeax/engine-types';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle, MaterialAsset, TextureAsset } from '@forgeax/engine-types';

import spriteShader from '../shaders/sprite.wgsl';
import { registerMaterialShaderDual } from '../register-material-shader';
import { erosionAt, frameAt } from './sprite-anim';
import { spriteSheetById, type SpriteSheetSpec } from './textures';

export type SpriteBlend = 'additive' | 'premult';
/** Opaque persistent-sprite token; 0 is never a live handle. */
export type SpriteHandle = number;

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type TexHandle = Handle<'TextureAsset', 'shared'>;

const SPRITE_SHADER_ID = 'hellforge::sprite';

/** Registration ABI — declaration order is the binding/UBO layout (see wgsl). */
const SPRITE_PARAM_SCHEMA = [
  { name: 'baseColor', type: 'color' },
  { name: 'frame', type: 'f32' },
  { name: 'frames', type: 'f32' },
  { name: 'cols', type: 'f32' },
  { name: 'rows', type: 'f32' },
  { name: 'billboard', type: 'f32' },
  { name: 'distort', type: 'f32' },
  { name: 'time', type: 'f32' },
  { name: 'erosion', type: 'f32' },
  { name: 'blendFrames', type: 'f32' },
  { name: 'sheet', type: 'texture2d' },
  { name: 'noise', type: 'texture2d' },
] as const;

/**
 * Same ABI restated on the MaterialAsset, in `MaterialParameter` vocabulary
 * ('texture', not 'texture2d'). Required: vite-plugin-shader registers
 * hellforge::sprite from the manifest with an empty paramSchema before game
 * code runs, so `registerSpriteShader` below loses the race and its schema is
 * swallowed as 'already registered'. Extract/record prefer an asset-declared
 * `parameters` over the registry, so this is what actually binds the sheets
 * and writes the sprite UBO — without it the material reads the standard-PBR
 * payload (alpha pinned to 1, billboard 0) and draws as an opaque quad.
 */
const SPRITE_MATERIAL_PARAMETERS = SPRITE_PARAM_SCHEMA.map((e) => ({
  name: e.name,
  type: e.type === 'texture2d' ? 'texture' : e.type,
}));

/**
 * Idempotent hellforge::sprite registration (safeRegister pattern of
 * fx.ts — 'already registered' is swallowed). Dual API: current Engine
 * `installMaterialArtifact`, Engine c0 `registerMaterialShader`. Returns
 * false when the shader registry is unavailable (Edit mode) → SpriteSystem
 * stays inert.
 */
export function registerSpriteShader(app: unknown): boolean {
  return registerMaterialShaderDual(
    app,
    SPRITE_SHADER_ID,
    { source: spriteShader.wgsl, paramSchema: SPRITE_PARAM_SCHEMA },
    'hellforge/fx',
  );
}

/** Additive one/one (glow layers) + premult one/one-minus-src-alpha (residue). */
const SPRITE_RENDER_STATES: Record<SpriteBlend, {
  depthWriteEnabled: false;
  depthCompare: 'less';
  cullMode: 'none';
  blend: {
    color: { srcFactor: 'one'; dstFactor: 'one' | 'one-minus-src-alpha'; operation: 'add' };
    alpha: { srcFactor: 'one'; dstFactor: 'one' | 'one-minus-src-alpha'; operation: 'add' };
  };
}> = {
  additive: {
    depthWriteEnabled: false,
    depthCompare: 'less',
    cullMode: 'none',
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    },
  },
  premult: {
    depthWriteEnabled: false,
    depthCompare: 'less',
    cullMode: 'none',
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  },
};

/** Live param object — held BY REFERENCE by the material asset. */
interface SpriteParams {
  baseColor: number[];
  frame: number;
  frames: number;
  cols: number;
  rows: number;
  billboard: number;
  distort: number;
  time: number;
  erosion: number;
  blendFrames: number;
  sheet: unknown;
  noise: unknown;
}

interface MatSlot {
  readonly key: string;
  readonly mat: MatHandle;
  readonly params: SpriteParams;
}

export interface SpriteSpawnOpts {
  pos: readonly [number, number, number];
  vel?: readonly [number, number, number];
  /** Gravity (negative) or buoyancy (positive). */
  gy?: number;
  /** Seconds; one-shots only. */
  life?: number;
  /** World width of the unit quad at spawn. */
  size: number;
  /** Scale lerp target over life (one-shots; default = size). */
  endSize?: number;
  /** Sheet registry id (fx/textures.ts). */
  sheet: string;
  blend?: SpriteBlend;
  /** 0 = Transform as-is, 1 = spherical, 2 = cylindrical (Y-locked). */
  billboard?: 0 | 1 | 2;
  fps?: number;
  loop?: boolean;
  /** UV-noise distortion strength (0 = off; sane 0.02-0.10). */
  distort?: number;
  /** HDR rgb + master opacity. */
  tint?: readonly [number, number, number, number];
  /**
   * Persistent intensity modulation. Default `flicker` (fast torch-like).
   * `breath` = slow luminous pulse for enemy under-rings / markers.
   */
  pulse?: 'flicker' | 'breath';
  /** Erosion fade start as a fraction of life (one-shots). */
  fadeOutFrac?: number;
  /** Lerp to the next flipbook frame by fract(frame). */
  blendFrames?: boolean;
  /** World orientation — only meaningful with billboard 0 (decals). */
  quat?: readonly [number, number, number, number];
}

interface SpriteParticle {
  e: EntityHandle;
  age: number;
  life: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  gy: number;
  s0: number;
  s1: number;
  fps: number;
  frames: number;
  loop: boolean;
  fadeOutFrac: number;
  /** Per-sprite distortion-time offset so copies don't wobble in lockstep. */
  seed: number;
  /** Tint alpha at spawn — the flicker/breath multiplies this, never replaces it. */
  alpha0: number;
  /** Spawn RGB — breath multiplies these; flicker leaves them alone. */
  rgb0: readonly [number, number, number];
  pulse: 'flicker' | 'breath';
  slot: MatSlot;
}

/** Flat-on-ground orientation for decals (contact-shadow.ts:111-113 precedent). */
const FLAT_QUAT = ((): readonly [number, number, number, number] => {
  const q = quat.create();
  quat.fromAxisAngle(q, [1, 0, 0], -Math.PI / 2);
  return [q[0]!, q[1]!, q[2]!, q[3]!];
})();

export class SpriteSystem {
  private readonly ok: boolean;
  /** true = c0/Pack-v1 pass shape (`shader` + `paramValues`). */
  private readonly customPassShaderShape: boolean;
  private particles: SpriteParticle[] = [];
  private readonly persistentByHandle = new Map<SpriteHandle, SpriteParticle>();
  private nextHandle = 1;
  private readonly sheetTex = new Map<string, TexHandle>();
  private readonly matFree = new Map<string, MatSlot[]>();
  private readonly warnedSheets = new Set<string>();

  constructor(
    private world: World,
    app: unknown,
    /**
     * Combined-cap gate for ONE-SHOT spawns (FxSystem injects the
     * geometric-particle headroom). Persistent sprites bypass it — they are
     * deliberate scene fixtures (campfire flames), not combat spam.
     */
    private canSpawn: () => boolean = () => true,
  ) {
    this.ok = registerSpriteShader(app);
    // Same probe as fx.ts custom mats — blind program/values leaves every
    // sprite (enemy rings, telegraph, loot beams…) invisible on c0.
    const probePass = Materials.standard({
      baseColor: [1, 1, 1, 1],
      roughness: 0.5,
      metallic: 0,
    }).passes?.[0] as { shader?: string } | undefined;
    this.customPassShaderShape = typeof probePass?.shader === 'string';
  }

  /** Shader registry unavailable / bad sheet id → spawn no-ops (Edit safe). */
  available(): boolean { return this.ok; }

  // ── spawns ─────────────────────────────────────────────────────────────

  /** One-shot sprite particle. Null when capped / unavailable. */
  spawn(opts: SpriteSpawnOpts): EntityHandle | null {
    if (!this.canSpawn()) return null;
    const p = this.spawnOne(opts);
    if (!p) return null;
    this.particles.push(p);
    return p.e;
  }

  /**
   * Sustained sprite (campfire flame body…): animates but never moves or
   * auto-dies. `release` is exactly-once. 0 = spawn failed.
   */
  spawnPersistent(opts: SpriteSpawnOpts): SpriteHandle {
    const p = this.spawnOne({ ...opts, loop: true });
    if (!p) return 0;
    const h = this.nextHandle++;
    this.persistentByHandle.set(h, p);
    return h;
  }

  /** Exactly-once persistent release; unknown/stale handle is a no-op. */
  release(h: SpriteHandle): void {
    const p = this.persistentByHandle.get(h);
    if (!p) return;
    this.persistentByHandle.delete(h);
    this.world.despawn(p.e);
    this.releaseSlot(p.slot);
  }

  /**
   * Move a persistent sprite (PR8 T3 projectile-body follow). The flipbook /
   * distortion params keep animating; only the anchor changes. No-op for
   * unknown handles (0 = spawn failed, already released).
   */
  move(h: SpriteHandle, x: number, y: number, z: number): void {
    const p = this.persistentByHandle.get(h);
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    this.world.set(p.e, Transform, { pos: [x, y, z] });
  }

  /** Early despawn of a one-shot (FxSpawnLease dispose path). */
  kill(e: EntityHandle): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (this.particles[i]!.e !== e) continue;
      this.world.despawn(e);
      this.releaseSlot(this.particles[i]!.slot);
      this.particles.splice(i, 1);
      return;
    }
  }

  /** Ground decal — flat quad (billboard 0), premult by default (scorch). */
  spawnDecal(x: number, y: number, z: number, opts: SpriteSpawnOpts): EntityHandle | null {
    return this.spawn({
      ...opts,
      pos: [x, y, z],
      billboard: 0,
      blend: opts.blend ?? 'premult',
      quat: opts.quat ?? FLAT_QUAT,
    });
  }

  /** Persistent ground decal (PR8 T4 slow-status disc) — release via `release`. */
  spawnPersistentDecal(x: number, y: number, z: number, opts: SpriteSpawnOpts): SpriteHandle {
    return this.spawnPersistent({
      ...opts,
      pos: [x, y, z],
      billboard: 0,
      blend: opts.blend ?? 'premult',
      quat: opts.quat ?? FLAT_QUAT,
    });
  }

  private spawnOne(opts: SpriteSpawnOpts): SpriteParticle | null {
    if (!this.ok) return null;
    const spec = spriteSheetById(opts.sheet);
    if (!spec) {
      if (!this.warnedSheets.has(opts.sheet)) {
        this.warnedSheets.add(opts.sheet);
        console.warn(`[hellforge/fx] unknown sprite sheet "${opts.sheet}" — spawn skipped`);
      }
      return null;
    }
    const slot = this.acquireSlot(spec, opts.blend ?? 'additive', opts);
    if (!slot) return null;
    const [x, y, z] = opts.pos;
    const spawned = this.world.spawn(
      {
        component: Transform,
        data: {
          pos: [x, y, z],
          ...(opts.quat ? { quat: [...opts.quat] as [number, number, number, number] } : {}),
          scale: [opts.size, opts.size, opts.size],
        },
      },
      { component: MeshFilter, data: { assetHandle: HANDLE_QUAD } },
      { component: MeshRenderer, data: { materials: [slot.mat] } },
    );
    if (!spawned.ok) {
      this.releaseSlot(slot);
      return null;
    }
    const e = spawned.value as EntityHandle;
    const [vx, vy, vz] = opts.vel ?? [0, 0, 0];
    return {
      e,
      age: 0,
      life: Math.max(0.05, opts.life ?? 0.9),
      x, y, z, vx, vy, vz,
      gy: opts.gy ?? 0,
      s0: opts.size,
      s1: opts.endSize ?? opts.size,
      fps: opts.fps ?? 0,
      frames: spec.frames,
      loop: opts.loop ?? false,
      fadeOutFrac: opts.fadeOutFrac ?? 0.6,
      seed: Math.random() * 64,
      alpha0: opts.tint?.[3] ?? 1,
      rgb0: [
        opts.tint?.[0] ?? 1,
        opts.tint?.[1] ?? 1,
        opts.tint?.[2] ?? 1,
      ],
      pulse: opts.pulse ?? 'flicker',
      slot,
    };
  }

  // ── per-frame ──────────────────────────────────────────────────────────

  tick(dt: number, elapsed: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.world.despawn(p.e);
        this.releaseSlot(p.slot);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // Ground clamp for falling sprites (fx.ts:580 precedent).
      if (p.gy < 0 && p.y < 0.03) { p.y = 0.03; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; }
      const t = p.age / p.life;
      const s = p.s0 + (p.s1 - p.s0) * t;
      this.world.set(p.e, Transform, {
        pos: [p.x, p.y, p.z],
        scale: [s, s, s],
      });
      p.slot.params.frame = frameAt(p.age + (p.loop ? p.seed : 0), p.fps, p.frames, p.loop);
      p.slot.params.erosion = erosionAt(p.age, p.life, p.fadeOutFrac);
      p.slot.params.time = elapsed + p.seed;
    }
    for (const p of this.persistentByHandle.values()) {
      p.age += dt;
      // Looping flipbooks start at a per-sprite phase — 31 torches breathing
      // in lockstep read as mechanical, not as fire.
      p.slot.params.frame = frameAt(p.age + p.seed, p.fps, p.frames, true);
      p.slot.params.time = elapsed + p.seed;
      if (p.pulse === 'breath') {
        // Slow luminous breath (~0.37 Hz) — RGB + alpha rise/fall together.
        const wave = 0.5 + 0.5 * Math.sin(elapsed * 2.35 + p.seed);
        const rgbMul = 0.68 + 0.32 * wave;
        p.slot.params.baseColor[0] = p.rgb0[0] * rgbMul;
        p.slot.params.baseColor[1] = p.rgb0[1] * rgbMul;
        p.slot.params.baseColor[2] = p.rgb0[2] * rgbMul;
        p.slot.params.baseColor[3] = p.alpha0 * (0.52 + 0.48 * wave);
      } else {
        // Intensity flicker (incommensurate sines, same family as the point-light
        // flicker) — persistent alpha was constant, which read as stiff. It
        // multiplies the spawn tint alpha so deliberate low-alpha fixtures
        // (telegraph fill, residue) keep their level.
        p.slot.params.baseColor[3] = p.alpha0 *
          (0.84 + 0.16 * Math.sin(elapsed * 9.7 + p.seed) * Math.sin(elapsed * 5.3 + p.seed * 1.7));
      }
      // erosion stays 0 — persistent sprites never auto-fade.
    }
  }

  /** Despawn every one-shot + persistent sprite (owner cleanup for Stop→Play). */
  clear(): void {
    for (const p of this.particles) {
      this.world.despawn(p.e);
      this.releaseSlot(p.slot);
    }
    this.particles.length = 0;
    for (const p of this.persistentByHandle.values()) {
      this.world.despawn(p.e);
      this.releaseSlot(p.slot);
    }
    this.persistentByHandle.clear();
  }

  count(): number { return this.particles.length; }
  persistentCount(): number { return this.persistentByHandle.size; }

  // ── texture + material pooling ─────────────────────────────────────────

  private textureFor(spec: SpriteSheetSpec): TexHandle {
    const cached = this.sheetTex.get(spec.id);
    if (cached) return cached;
    const { width, height, data } = spec.generate();
    const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const tex = this.world.allocSharedRef<'TextureAsset', TextureAsset>('TextureAsset', {
      kind: 'texture',
      width,
      height,
      format: 'rgba8unorm',
      data,
      colorSpace: 'linear',
      mipmap: true,
      mipLevelCount,
    });
    this.sheetTex.set(spec.id, tex);
    return tex;
  }

  private acquireSlot(spec: SpriteSheetSpec, blend: SpriteBlend, opts: SpriteSpawnOpts): MatSlot | null {
    const key = `${spec.id}|${blend}`;
    const free = this.matFree.get(key);
    const slot = free?.pop() ?? this.allocSlot(spec, blend, key);
    if (!slot) return null;
    // (Re)initialise per-spawn params; frame/erosion/time are per-tick.
    const tint = opts.tint ?? [1, 1, 1, 1];
    slot.params.baseColor[0] = tint[0];
    slot.params.baseColor[1] = tint[1];
    slot.params.baseColor[2] = tint[2];
    slot.params.baseColor[3] = tint[3];
    slot.params.frame = 0;
    slot.params.billboard = opts.billboard ?? 1;
    slot.params.distort = opts.distort ?? 0;
    slot.params.erosion = 0;
    slot.params.time = 0;
    slot.params.blendFrames = opts.blendFrames === false ? 0 : 1;
    return slot;
  }

  private allocSlot(spec: SpriteSheetSpec, blend: SpriteBlend, key: string): MatSlot | null {
    // The noise sheet is bound ALWAYS — declared textures must be bound even
    // when distort = 0 (the engine has no per-slot texture fallback here).
    const noise = spriteSheetById('noise')!;
    const params: SpriteParams = {
      baseColor: [1, 1, 1, 1],
      frame: 0,
      frames: spec.frames,
      cols: spec.cols,
      rows: spec.rows,
      billboard: 1,
      distort: 0,
      time: 0,
      erosion: 0,
      blendFrames: 1,
      sheet: unwrapHandle(this.textureFor(spec)),
      noise: unwrapHandle(this.textureFor(noise)),
    };
    const passCommon = {
      name: 'Forward' as const,
      renderState: { ...SPRITE_RENDER_STATES[blend], tags: { LightMode: 'Forward' }, queue: 3000 },
    };
    const mat = this.customPassShaderShape
      ? this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{
            ...passCommon,
            shader: SPRITE_SHADER_ID,
            tags: { LightMode: 'Forward' },
            queue: 3000,
            passKind: 'forward',
          }],
          paramValues: params as never,
        } as unknown as MaterialAsset)
      : this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{
            ...passCommon,
            program: { module: SPRITE_SHADER_ID },
          }],
          parameters: SPRITE_MATERIAL_PARAMETERS as never,
          values: params as never,
        });
    return { key, mat, params };
  }

  private releaseSlot(slot: MatSlot): void {
    let free = this.matFree.get(slot.key);
    if (!free) {
      free = [];
      this.matFree.set(slot.key, free);
    }
    free.push(slot);
  }
}
