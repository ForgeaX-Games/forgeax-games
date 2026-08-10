// Hellforge FX — custom shader materials + a pooled particle system.
//
// Shaders (registered once against the engine ShaderRegistry):
//   hellforge::fire_bolt     — the Fire Bolt projectile body (living flame)
//   hellforge::portal_vortex — swirling portal discs (cave / return portal)
//   hellforge::frost_fang    — Frost Fang crystal core / trail body
//   hellforge::frost_impact  — collision-aligned frost impact flash
//   hellforge::frost_slow    — persistent slow-status marker disc
//   hellforge::move_click    — short-lived forged magma inward-chevron cue
//   hellforge::sprite        — PR8 uber sprite shader (fx/sprite.ts)
//
// Particles: tiny manually-integrated ECS entities (sphere/cube + emissive
// standard material), pooled in a JS array. Modes:
//   'shrink' — uniform scale eases to 0 over life (hit bursts, gibs)
//   'rise'   — slow upward drift + shrink (campfire embers, portal motes)
//
// Sprites (PR8 T1): textured HANDLE_QUAD billboard particles (flipbook +
// distortion + erosion) live in fx/sprite.ts (SpriteSystem); FxSystem owns
// the combined FX_MAX_PARTICLES ceiling across both pools and the executor
// 'sprite' port.
//
// All amplitudes stay modest (see cow-survivor's ACES white-wash lessons):
// emissive intensity ≤ 2, premultiplied-alpha blend on custom shaders.

import {
  Transform,
} from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
  Materials,
} from '@forgeax/engine-render';
import {
  type MaterialAsset,
} from '@forgeax/engine-types';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';

import fireBoltShader from './shaders/fire-bolt.wgsl';
import portalShader from './shaders/portal-vortex.wgsl';
import frostFangShader from './shaders/frost-fang.wgsl';
import frostImpactShader from './shaders/frost-impact.wgsl';
import frostSlowShader from './shaders/frost-slow.wgsl';
import moveClickShader from './shaders/move-click.wgsl';
import { registerMaterialShaderDual } from './register-material-shader';
import { FxLifecycleTracker, type FxLifecycleSnapshot } from './fx-lifecycle';
import {
  EffectExecutor,
  type EffectHandle,
  type FxSpawnLease,
} from './fx/executor';
import type { EffectDef, SpriteDef } from './fx/effect-def';
import { SpriteSystem, type SpriteHandle, type SpriteSpawnOpts } from './fx/sprite';
import { combatBeat } from './fx/defs';

export type MatHandle = Handle<'MaterialAsset', 'shared'>;
export type { FxLifecycleSnapshot } from './fx-lifecycle';
export type { EffectHandle } from './fx/executor';

/** Shared Frost Fang material handles (one set — no per-projectile materials). */
export interface FrostVfxHandles {
  projectile: MatHandle;
  impact: MatHandle;
  slow: MatHandle;
}

/** Persistent sprite handles for a projectile flight body (PR8); 0 = inert. */
export interface BodyVfx {
  primary: SpriteHandle;
  glow: SpriteHandle;
}

/** Persistent sprite handles for a loot beam (PR8 T7); 0 = inert. */
export interface LootBeamVfx {
  beam: SpriteHandle;
  glow: SpriteHandle;
}

/** Persistent decal handles for the finisher telegraph (PR8 T6); 0 = inert. */
export interface NovaTelegraphVfx {
  ring: SpriteHandle;
  fill: SpriteHandle;
  center: SpriteHandle;
}

/** Projectile flight presentation style (body sheet / tint per skill). */
export type FlightStyle = 'magma' | 'frost' | 'arc' | 'slag';

const FLIGHT_STYLES: Record<FlightStyle, {
  color: FxColor;
  bodySheet: string;
  bodySize: number;
  bodyFps: number;
  bodyDistort: number;
  glowSize: number;
  trailSize: number;
  trailEndSize: number;
  trailLife: number;
  /** HDR tint multiplier — bloom needs headroom at ARPG camera distance. */
  tintMul: number;
}> = {
  magma: {
    // Tall flame TONGUE is the body (never a round frame): the composite
    // reads as a moving flame mass with the 33 Hz tongue trail behind it.
    color: 'fire', bodySheet: 'fireball', bodySize: 1.35, bodyFps: 5, bodyDistort: 0.09,
    glowSize: 0.4, trailSize: 0.55, trailEndSize: 0.22, trailLife: 0.5, tintMul: 1.5,
  },
  frost: {
    color: 'ice', bodySheet: 'shard', bodySize: 0.95, bodyFps: 6, bodyDistort: 0,
    glowSize: 0.4, trailSize: 0.36, trailEndSize: 0.14, trailLife: 0.38, tintMul: 1.3,
  },
  arc: {
    // Jagged bolt sheet at high fps = crackling lightning core, not a smear.
    color: 'lightning', bodySheet: 'bolt', bodySize: 0.9, bodyFps: 14, bodyDistort: 0,
    glowSize: 0.5, trailSize: 0.34, trailEndSize: 0.12, trailLife: 0.26, tintMul: 1.4,
  },
  slag: {
    // Slaglord volley — a heavy molten GLOB: the 16-frame impact flipbook
    // churns like bubbling slag (never the player's sleek flame tongue),
    // bigger body, darker scorch-adjacent tint so hostile ordnance reads
    // "not yours" at a glance.
    color: 'fire', bodySheet: 'impact', bodySize: 1.6, bodyFps: 12, bodyDistort: 0.05,
    glowSize: 0.55, trailSize: 0.7, trailEndSize: 0.3, trailLife: 0.6, tintMul: 1.7,
  },
};

/** Registered ambient flame fixture (PR8 T3) — re-ignited after pool drains. */
interface AmbientFireFixture {
  x: number; y: number; z: number;
  scale: number;
  kind: 'campfire' | 'torch';
}

/** Slow-status marker: sprite decal (Play) or legacy mesh (Edit fallback). */
interface SlowMarkerEntity {
  e?: EntityHandle;
  sprite?: SpriteHandle;
}

/** Expanding ground ping for click-to-move (entity scale + intensity fade). */
interface MoveClickMarker {
  e: EntityHandle;
  age: number;
  life: number;
  x: number;
  z: number;
  slot: number;
}

const FIRE_BOLT_SHADER_ID = 'hellforge::fire_bolt';
const PORTAL_SHADER_ID = 'hellforge::portal_vortex';
const FROST_FANG_SHADER_ID = 'hellforge::frost_fang';
const FROST_IMPACT_SHADER_ID = 'hellforge::frost_impact';
const FROST_SLOW_SHADER_ID = 'hellforge::frost_slow';
const MOVE_CLICK_SHADER_ID = 'hellforge::move_click';
const MOVE_CLICK_MAX = 6;
/** Short, quiet ping — forged magma chevrons, not a big expanding ring. */
const MOVE_CLICK_LIFE = 0.55;

type ShaderParams = { baseColor: number[]; metallic: number; roughness: number };

export type FxColor = 'fire' | 'ice' | 'lightning' | 'blood' | 'gold' | 'shadow' | 'heal';

/**
 * Combined particle ceiling — geometric particles + sprite one-shots +
 * persistent sprites (PR8 T1). Plan §4 L4: 320 by default; raised 320→512 by
 * human retune 2026-07-27 after first footage ("particle counts too low") —
 * L4's retune-after-footage clause. First probe (headless MCP browser,
 * non-reference): 10-bolt spam moved median +0.4 ms, p95 +0.1 ms — the
 * reference-machine 1080p/720p dump is still owed at T8 and rides this PR.
 */
export const FX_MAX_PARTICLES = 512;

/** Ground-residue decal height — clears z-fighting vs floor tiles (PR8 T3). */
const GROUND_DECAL_Y = 0.045;

/** Loot beam cap (PR8 T7) — beams bypass the FX_MAX_PARTICLES gate; keep bounded. */
const MAX_LOOT_BEAMS = 24;

/** Emissive palette — base colour + intensity (HDR tint source for sprites). */
const FX_PALETTE: Record<FxColor, { c: [number, number, number]; i: number }> = {
  fire:      { c: [1.0, 0.32, 0.06], i: 1.4 },
  ice:       { c: [0.45, 0.80, 1.0], i: 1.4 },
  lightning: { c: [0.80, 0.60, 1.0], i: 1.8 },
  blood:     { c: [0.75, 0.08, 0.08], i: 0.9 },
  gold:      { c: [1.0, 0.80, 0.25], i: 1.5 },
  shadow:    { c: [0.45, 0.25, 0.70], i: 1.2 },
  heal:      { c: [0.90, 0.25, 0.25], i: 1.6 },
};

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
  private fireBoltParams: ShaderParams | null = null;
  private frostHandles: FrostVfxHandles | null = null;
  private frostParams: ShaderParams[] = [];
  private portalMats: Array<{ mat: MatHandle; params: ShaderParams }> = [];
  /** Slow-status marker entities keyed by Monster.id. */
  private slowMarkers = new Map<string, SlowMarkerEntity>();
  /** Short-lived move-command rings (click ground). */
  private moveClicks: MoveClickMarker[] = [];
  /** Pooled materials + params (one slot per concurrent ping). */
  private moveClickPool: Array<{ mat: MatHandle; params: ShaderParams }> = [];
  private moveClickFree: number[] = [];
  /** true = c0/Pack-v1 pass shape (`shader` + `paramValues`). */
  private customPassShaderShape = false;
  /** Pure counts for __hf / tests (entities stay in this class). */
  readonly lifecycle = new FxLifecycleTracker();
  /** Declarative EffectDef runner (PR2b T2). Spawns via burst/pop/rise. */
  private readonly executor: EffectExecutor;
  /** Textured billboard sprite pool (PR8 T1); inert when registry missing. */
  private readonly sprites: SpriteSystem;
  // Campfire ember emitter state.
  private emberTimer = 0;
  private smokeTimer = 1.5;
  private emberAt: { x: number; y: number; z: number } | null = null;
  /** Ambient flame fixtures (campfire + den torches) for re-ignite (PR8 T3). */
  private readonly ambientFires: AmbientFireFixture[] = [];
  /** Live loot beams — capped at MAX_LOOT_BEAMS (PR8 T7). */
  private lootBeamCount = 0;

  constructor(private world: World, app?: unknown) {
    this.executor = new EffectExecutor({
      burst: (x, y, z, color, count, speed) => this.burst(x, y, z, color, count, speed),
      pop: (x, y, z, color, size) => this.pop(x, y, z, color, size),
      rise: (x, y, z, color, count, spread) => this.rise(x, y, z, color, count, spread),
      sprite: (x, y, z, color, count, speed, def) => this.spriteBurst(x, y, z, color, count, speed, def),
    });
    // Note: burst/pop/rise return FxSpawnLease; executor tracks them for release.
    // Combined ceiling: geometric particles + sprites share FX_MAX_PARTICLES.
    this.sprites = new SpriteSystem(world, app, () =>
      this.particles.length + this.sprites.count() + this.sprites.persistentCount() < FX_MAX_PARTICLES);

    this.mats = {} as Record<FxColor, MatHandle>;
    for (const [name, p] of Object.entries(FX_PALETTE) as [FxColor, { c: [number, number, number]; i: number }][]) {
      this.mats[name] = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: [p.c[0], p.c[1], p.c[2], 1], roughness: 0.4, metallic: 0,
        emissive: p.c, emissiveIntensity: p.i,
      }));
    }

    // ── custom shaders (graceful fallback to plain emissive if unavailable) ──
    // c0 engines expect MaterialPass.shader + paramValues; newer engines use
    // program.module + values. Blind Pack-v2 shape makes move-click / FX mats
    // allocate but never paint → click guidance looks "removed".
    const probePass = Materials.standard({
      baseColor: [1, 1, 1, 1],
      roughness: 0.5,
      metallic: 0,
    }).passes?.[0] as { shader?: string; program?: unknown } | undefined;
    this.customPassShaderShape = typeof probePass?.shader === 'string';

    const mkCustomMat = (shaderId: string, params: ShaderParams): MatHandle => {
      if (this.customPassShaderShape) {
        return world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{
            name: 'Forward',
            shader: shaderId,
            tags: { LightMode: 'Forward' },
            queue: 3000,
            passKind: 'forward',
            renderState: FX_RENDER_STATE,
          }],
          paramValues: params as never,
        } as unknown as MaterialAsset);
      }
      return world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
        kind: 'material',
        passes: [{
          name: 'Forward',
          program: { module: shaderId },
          renderState: { ...FX_RENDER_STATE, tags: { LightMode: 'Forward' }, queue: 3000 },
        }],
        // Restated on the asset because safeRegister below always loses the
        // race: vite-plugin-shader registers these ids from the manifest with
        // an empty paramSchema before game code runs. Extract/record prefer the
        // asset's own `parameters`, so this is what actually sizes the UBO —
        // otherwise the shader reads the standard-PBR payload, which only
        // happens to line up for these three fields.
        parameters: FX_PARAM_SCHEMA as never,
        values: params as never,
      });
    };

    // Dual API: current Engine installMaterialArtifact, Engine c0 registerMaterialShader.
    const FX_PARAM_SCHEMA = [
      { name: 'baseColor', type: 'color' as const },
      { name: 'metallic', type: 'f32' as const },
      { name: 'roughness', type: 'f32' as const },
    ];
    const safeRegister = (id: string, source: string): boolean =>
      registerMaterialShaderDual(app, id, { source, paramSchema: FX_PARAM_SCHEMA }, 'hellforge/fx');
    try {
      const registered = [
        safeRegister(FIRE_BOLT_SHADER_ID, fireBoltShader.wgsl),
        safeRegister(PORTAL_SHADER_ID, portalShader.wgsl),
        safeRegister(FROST_FANG_SHADER_ID, frostFangShader.wgsl),
        safeRegister(FROST_IMPACT_SHADER_ID, frostImpactShader.wgsl),
        safeRegister(FROST_SLOW_SHADER_ID, frostSlowShader.wgsl),
        safeRegister(MOVE_CLICK_SHADER_ID, moveClickShader.wgsl),
      ].every(Boolean);
      if (!registered) {
        this.frostHandles = null;
        this.frostParams = [];
        this.moveClickPool = [];
        this.moveClickFree = [];
      } else {
        const fbParams: ShaderParams = { baseColor: [1.0, 0.18, 0.03, 1], metallic: 0, roughness: 1.35 };
        this.fireBoltMat = mkCustomMat(FIRE_BOLT_SHADER_ID, fbParams);
        this.fireBoltParams = fbParams;

        const mkFrost = (shader: string, tint: [number, number, number], intensity: number): MatHandle => {
          const params: ShaderParams = {
            baseColor: [tint[0], tint[1], tint[2], 1],
            metallic: 0,
            roughness: intensity,
          };
          this.frostParams.push(params);
          return mkCustomMat(shader, params);
        };
        this.frostHandles = {
          projectile: mkFrost(FROST_FANG_SHADER_ID, [0.42, 0.78, 1.0], 1.15),
          impact: mkFrost(FROST_IMPACT_SHADER_ID, [0.55, 0.88, 1.0], 1.20),
          slow: mkFrost(FROST_SLOW_SHADER_ID, [0.35, 0.72, 1.0], 0.95),
        };
        // Pooled move-click mats — independent intensity fade per concurrent ping.
        for (let i = 0; i < MOVE_CLICK_MAX; i++) {
          const params: ShaderParams = {
            // Ember / magma — matches Hellforge HUD gold+crimson (not neon green).
            baseColor: [1.0, 0.42, 0.12, 1],
            metallic: 0,
            roughness: 0.9,
          };
          const mat = mkCustomMat(MOVE_CLICK_SHADER_ID, params);
          this.moveClickPool.push({ mat, params });
          this.moveClickFree.push(i);
        }
      }
    } catch (e) {
      console.warn('[hellforge/fx] custom-shader setup failed; falling back to emissive:', (e as Error).message);
      this.frostHandles = null;
      this.frostParams = [];
      this.moveClickPool = [];
      this.moveClickFree = [];
    }

    // If custom move-click pool never filled (shader registry missing / setup
    // threw), seed emissive magma slabs so click-to-move guidance still reads.
    if (this.moveClickPool.length === 0) {
      for (let i = 0; i < MOVE_CLICK_MAX; i++) {
        const params: ShaderParams = {
          baseColor: [1.0, 0.42, 0.12, 1],
          metallic: 0,
          roughness: 0.9,
        };
        const mat = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
          'MaterialAsset',
          Materials.standard({
            baseColor: [1.0, 0.42, 0.12, 1],
            roughness: 0.45,
            metallic: 0.05,
            emissive: [1.0, 0.35, 0.08],
            emissiveIntensity: 1.8,
          }),
        );
        this.moveClickPool.push({ mat, params });
        this.moveClickFree.push(i);
      }
    }
  }

  /** Fire Bolt body material (custom shader) — null when unavailable. */
  fireBoltMaterial(): MatHandle | null { return this.fireBoltMat; }

  /**
   * Frost Fang VFX materials (custom shaders). Null in Edit / when the shader
   * registry is unavailable — callers must fall back to emissive ice mats.
   */
  frostVfx(): FrostVfxHandles | null { return this.frostHandles; }

  /** Mint a portal material with its own tint; time is fed by tick(). */
  portalMaterial(tint: [number, number, number]): MatHandle | null {
    if (!this.fireBoltMat) return null;   // shader registry unavailable
    const params: ShaderParams = { baseColor: [tint[0], tint[1], tint[2], 1], metallic: 0, roughness: 1.0 };
    const mat = this.customPassShaderShape
      ? this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{
            name: 'Forward',
            shader: PORTAL_SHADER_ID,
            tags: { LightMode: 'Forward' },
            queue: 3000,
            passKind: 'forward',
            renderState: FX_RENDER_STATE,
          }],
          paramValues: params as never,
        } as unknown as MaterialAsset)
      : this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{
            name: 'Forward',
            program: { module: PORTAL_SHADER_ID },
            renderState: { ...FX_RENDER_STATE, tags: { LightMode: 'Forward' }, queue: 3000 },
          }],
          values: params as never,
        });
    this.portalMats.push({ mat, params });
    return mat;
  }

  /** Plain emissive material for a palette colour (monster gibs, bolts...). */
  colorMaterial(color: FxColor): MatHandle { return this.mats[color]; }

  /**
   * Where the campfire ember column rises from (set once at boot) — also
   * registers the campfire flame body (PR8 T3 2-layer flipbook flame).
   */
  setCampfire(x: number, y: number, z: number): void {
    this.emberAt = { x, y, z };
    this.addAmbientFire(x, y, z, { scale: 1.15, kind: 'campfire' });
  }

  // ── ambient fire (PR8 T3) ────────────────────────────────────────────────
  // Persistent flame fixtures (campfire + den torches/braziers) on the sprite
  // primitive. Registered once at area build; re-ignited after clearTransient
  // drains the sprite pool (combat-run / area reset).

  /** Den torch/brazier flame — register + ignite (call once per fixture). */
  addAmbientFire(
    x: number, y: number, z: number,
    opts: { scale?: number; kind?: 'campfire' | 'torch' } = {},
  ): void {
    const fixture: AmbientFireFixture = {
      x, y, z,
      scale: opts.scale ?? 1,
      kind: opts.kind ?? 'torch',
    };
    this.ambientFires.push(fixture);
    this.igniteFixture(fixture);
  }

  /**
   * Flame body + hot core + coal glow on persistent sprites — cylindrical
   * (Y-locked) billboards so the flame reads from every azimuth.
   */
  private igniteFixture(f: AmbientFireFixture): void {
    const fireTint = this.spriteTint('fire');
    const hotTint: readonly [number, number, number, number] = [
      fireTint[0] * 1.4, fireTint[1] * 1.4, fireTint[2] * 1.4, 1,
    ];
    this.sprites.spawnPersistent({
      pos: [f.x, f.y, f.z],
      sheet: 'flame', blend: 'additive', billboard: 2,
      size: 0.95 * f.scale, fps: 7, distort: 0.08, tint: fireTint, loop: true,
    });
    if (f.kind === 'campfire') {
      this.sprites.spawnPersistent({
        pos: [f.x, f.y - 0.05 * f.scale, f.z],
        sheet: 'flame', blend: 'additive', billboard: 2,
        size: 0.55 * f.scale, fps: 9, distort: 0.05, tint: hotTint, loop: true,
      });
    }
    this.sprites.spawnPersistent({
      pos: [f.x, f.y - 0.22 * f.scale, f.z],
      sheet: 'glow', blend: 'additive', billboard: 1,
      size: (f.kind === 'campfire' ? 0.85 : 0.4) * f.scale, tint: fireTint, loop: true,
    });
  }

  // ── particle spawns ──────────────────────────────────────────────────────

  /** Exactly-once lease that despawns the entities spawned into `owned`. */
  private makeLease(owned: EntityHandle[]): FxSpawnLease {
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const e of owned) {
          for (let i = this.particles.length - 1; i >= 0; i--) {
            if (this.particles[i]!.e !== e) continue;
            this.world.despawn(this.particles[i]!.e);
            this.particles.splice(i, 1);
            break;
          }
        }
        owned.length = 0;
        this.lifecycle.setParticles(this.particles.length);
      },
    };
  }

  private spawnParticle(
    x: number, y: number, z: number, s: number, color: FxColor,
    vx: number, vy: number, vz: number, gy: number, life: number,
    mode: 'shrink' | 'rise' | 'pop', shape: 'cube' | 'sphere' = 'sphere',
  ): EntityHandle | null {
    // Combined hard cap with the sprite pool — never flood the world.
    if (this.particles.length + this.sprites.count() + this.sprites.persistentCount() >= FX_MAX_PARTICLES) return null;
    const spawned = this.world.spawn(
      { component: Transform, data: { pos: [x, y, z], scale: [s, s, s] } },
      { component: MeshFilter, data: { assetHandle: shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [this.mats[color]] } },
    );
    if (!spawned.ok) return null;
    const e = spawned.value as EntityHandle;
    this.particles.push({ e, age: 0, life, vx, vy, vz, gy, mode, s0: s, x, y, z });
    return e;
  }

  /** Radial burst at a hit point (projectile impact, melee hit). */
  burst(x: number, y: number, z: number, color: FxColor, count = 6, speed = 3.2): FxSpawnLease {
    const owned: EntityHandle[] = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const up = 1.0 + Math.random() * 2.2;
      const e = this.spawnParticle(
        x, y, z, 0.07 + Math.random() * 0.07, color,
        Math.cos(ang) * speed * (0.4 + Math.random() * 0.6),
        up,
        Math.sin(ang) * speed * (0.4 + Math.random() * 0.6),
        -7, 0.4 + Math.random() * 0.3, 'shrink',
      );
      if (e) owned.push(e);
    }
    return this.makeLease(owned);
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
  pop(x: number, y: number, z: number, color: FxColor, size = 0.4): FxSpawnLease {
    const owned: EntityHandle[] = [];
    const e = this.spawnParticle(x, y, z, size, color, 0, 0, 0, 0, 0.16, 'pop');
    if (e) owned.push(e);
    return this.makeLease(owned);
  }

  /** Soft rising motes (level-up, portal ambience, campfire embers). */
  rise(x: number, y: number, z: number, color: FxColor, count = 5, spread = 0.5): FxSpawnLease {
    const owned: EntityHandle[] = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const e = this.spawnParticle(
        x + Math.cos(ang) * r, y, z + Math.sin(ang) * r,
        0.05 + Math.random() * 0.05, color,
        (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4,
        0.8, 0.8 + Math.random() * 0.7, 'rise',
      );
      if (e) owned.push(e);
    }
    return this.makeLease(owned);
  }

  // ── sprite wrappers (PR8 T1 — textured billboard primitive) ─────────────

  /** HDR sprite tint from the palette (rgb × intensity feeds bloom > 1.2). */
  private spriteTint(color: FxColor): readonly [number, number, number, number] {
    const p = FX_PALETTE[color];
    return [p.c[0] * p.i, p.c[1] * p.i, p.c[2] * p.i, 1];
  }

  /** Exactly-once lease that kills the leased sprite particles. */
  private spriteLease(owned: EntityHandle[]): FxSpawnLease {
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const e of owned) this.sprites.kill(e);
        owned.length = 0;
      },
    };
  }

  /**
   * Sprite emitter presentation (EffectDef kind 'sprite'): radial spread like
   * burst(), shaped by the SpriteDef — or a flat stationary ground decal when
   * `def.decal` is set (PR8 T3 residue layer). Per-particle life defaults to
   * just under the executor's DEFAULT_LIFE.sprite so the lease is only a
   * backstop; longer-lived particles (decals) override via `def.life`.
   */
  spriteBurst(
    x: number, y: number, z: number,
    color: FxColor, count = 6, speed = 3.2, def: SpriteDef,
  ): FxSpawnLease {
    const owned: EntityHandle[] = [];
    const tint = this.spriteTint(color);
    // Ground-residue route: flat premult quad clamped to ground height — the
    // def plays at projectile height, scorch belongs on the floor (T3).
    if (def.decal) {
      for (let i = 0; i < count; i++) {
        const e = this.sprites.spawnDecal(x, GROUND_DECAL_Y, z, {
          pos: [x, GROUND_DECAL_Y, z],
          sheet: def.sheet,
          blend: def.blend ?? 'premult',
          size: def.size ?? 1,
          life: def.life ?? 2.5,
          fps: def.fps ?? 0,
          loop: def.loop ?? false,
          distort: def.distort ?? 0,
          tint,
          fadeOutFrac: def.fadeOutFrac ?? 0.5,
        });
        if (e) owned.push(e);
      }
      return this.spriteLease(owned);
    }
    const billboard = def.billboard === 'none' ? 0 : def.billboard === 'cylindrical' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const e = this.sprites.spawn({
        pos: [x, y, z],
        vel: [
          Math.cos(ang) * speed * (0.4 + Math.random() * 0.6),
          1.0 + Math.random() * 2.2,
          Math.sin(ang) * speed * (0.4 + Math.random() * 0.6),
        ],
        gy: def.gy ?? -7,
        life: def.life ?? 0.9,
        size: def.size ?? 0.3,
        endSize: def.endSize,
        sheet: def.sheet,
        blend: def.blend ?? 'additive',
        billboard,
        fps: def.fps ?? 0,
        loop: def.loop ?? false,
        distort: def.distort ?? 0,
        tint,
        fadeOutFrac: def.fadeOutFrac,
      });
      if (e) owned.push(e);
    }
    return this.spriteLease(owned);
  }

  /** Ground residue decal (scorch) — flat premult quad, erosion-faded. */
  spriteDecal(
    x: number, y: number, z: number,
    color: FxColor, def: SpriteDef,
    opts: { size?: number; life?: number } = {},
  ): FxSpawnLease {
    const owned: EntityHandle[] = [];
    const e = this.sprites.spawnDecal(x, y, z, {
      pos: [x, y, z],
      sheet: def.sheet,
      blend: def.blend ?? 'premult',
      size: opts.size ?? def.size ?? 1,
      life: opts.life ?? 2.5,
      fps: def.fps ?? 0,
      loop: def.loop ?? false,
      distort: def.distort ?? 0,
      tint: this.spriteTint(color),
      fadeOutFrac: def.fadeOutFrac ?? 0.5,
    });
    if (e) owned.push(e);
    return this.spriteLease(owned);
  }

  /**
   * Sustained sprite (campfire flame body…) — never auto-dies; the caller
   * owns the handle. 0 = spawn failed (shader registry unavailable / capped).
   */
  spritePersistent(
    x: number, y: number, z: number,
    color: FxColor, def: SpriteDef,
    opts: { size?: number; tint?: readonly [number, number, number, number] } = {},
  ): SpriteHandle {
    const billboard = def.billboard === 'none' ? 0 : def.billboard === 'cylindrical' ? 2 : 1;
    return this.sprites.spawnPersistent({
      pos: [x, y, z],
      sheet: def.sheet,
      blend: def.blend ?? 'additive',
      billboard,
      size: opts.size ?? def.size ?? 1,
      fps: def.fps ?? 0,
      distort: def.distort ?? 0,
      tint: opts.tint ?? this.spriteTint(color),
      loop: true,
    });
  }

  /** Exactly-once persistent sprite release (owner cleanup). */
  releaseSprite(h: SpriteHandle): void {
    this.sprites.release(h);
  }

  /**
   * Persistent-decal surface for satellite FX systems (G2-A enemy under-rings).
   * Narrowed 3-method adapter over SpriteSystem so consumers stay
   * implementation-agnostic and unit-testable, and can't touch the wider FX
   * surface (spawn/tick/clear); absent from fx stubs in tests (rings degrade
   * to off).
   */
  persistentDecalSurface(): {
    spawnPersistentDecal(x: number, y: number, z: number, opts: SpriteSpawnOpts): SpriteHandle;
    move(h: SpriteHandle, x: number, y: number, z: number): void;
    release(h: SpriteHandle): void;
  } {
    const sprites = this.sprites;
    return {
      spawnPersistentDecal: (x, y, z, opts) => sprites.spawnPersistentDecal(x, y, z, opts),
      move: (h, x, y, z) => sprites.move(h, x, y, z),
      release: (h) => sprites.release(h),
    };
  }

  // ── Projectile flight presentation (PR8 T3/T4/T5) ────────────────────────

  /**
   * Flight body — persistent primary sheet + hot glow core following the
   * projectile (body layer). Handles are 0 when the sprite registry is
   * unavailable (Edit mode): move/release stay safe no-ops.
   */
  flightBody(style: FlightStyle, x: number, y: number, z: number): BodyVfx {
    const s = FLIGHT_STYLES[style];
    const tint = this.scaledTint(s.color, s.tintMul);
    const primary = this.sprites.spawnPersistent({
      pos: [x, y, z],
      sheet: s.bodySheet,
      blend: 'additive',
      billboard: 1,
      size: s.bodySize,
      fps: s.bodyFps,
      distort: s.bodyDistort,
      tint,
      loop: true,
    });
    const glow = this.sprites.spawnPersistent({
      pos: [x, y, z],
      sheet: 'glow',
      blend: 'additive',
      billboard: 1,
      size: s.glowSize,
      // Glow rides at reduced intensity — an accent at the head, never the
      // dominant read (a full-strength round glow is what made the bolt a ball).
      tint: this.scaledTint(s.color, s.tintMul * 0.65),
      loop: true,
    });
    return { primary, glow };
  }

  /** Follow the projectile root (body layer; trail drips separately). */
  moveFlightBody(body: BodyVfx, x: number, y: number, z: number): void {
    this.sprites.move(body.primary, x, y, z);
    this.sprites.move(body.glow, x, y, z);
  }

  /** Exactly-once body cleanup (projectile kill / expiry). */
  releaseFlightBody(body: BodyVfx): void {
    this.sprites.release(body.primary);
    this.sprites.release(body.glow);
  }

  /**
   * Single trail drip (trail layer — L4: one trail per skill). A small lick
   * that hangs where the projectile passed and erodes out. Rate-limited by
   * the caller (per-projectile timer); capped by the combined 512 gate.
   */
  flightTrailPuff(style: FlightStyle, x: number, y: number, z: number): void {
    const s = FLIGHT_STYLES[style];
    this.sprites.spawn({
      pos: [x + (Math.random() - 0.5) * 0.12, y + (Math.random() - 0.5) * 0.12, z + (Math.random() - 0.5) * 0.12],
      vel: [(Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3],
      life: s.trailLife,
      size: s.trailSize,
      endSize: s.trailEndSize,
      sheet: s.bodySheet,
      blend: 'additive',
      billboard: 1,
      fps: s.bodyFps,
      distort: s.bodyDistort > 0 ? s.bodyDistort * 0.7 : 0,
      tint: this.scaledTint(s.color, s.tintMul),
      fadeOutFrac: 0.35,
    });
  }

  /** Palette tint × style multiplier (HDR headroom for bloom at distance). */
  private scaledTint(color: FxColor, mul: number): readonly [number, number, number, number] {
    const t = this.spriteTint(color);
    return [t[0] * mul, t[1] * mul, t[2] * mul, 1];
  }

  // ── Inferno Nova finisher helpers (PR8 T6) ───────────────────────────────
  // Ring + scorch live OUTSIDE the def (PR2a L7 caps nova at 3 emitters).

  /** Additive shock ring expanding over the blast radius (decal, ~0.55s). */
  novaShockRing(x: number, z: number, radius: number): void {
    this.sprites.spawnDecal(x, GROUND_DECAL_Y, z, {
      pos: [x, GROUND_DECAL_Y, z],
      sheet: 'ring',
      blend: 'additive',
      size: 0.7,
      endSize: radius * 2.4,
      life: 0.55,
      tint: this.spriteTint('fire'),
      fadeOutFrac: 0.25,
    });
  }

  /** Ground scorch after the blast (~4s erosion fade). */
  novaScorch(x: number, z: number, radius: number): void {
    this.sprites.spawnDecal(x, GROUND_DECAL_Y, z, {
      pos: [x, GROUND_DECAL_Y, z],
      sheet: 'scorch',
      blend: 'premult',
      size: radius * 0.95,
      life: 4.0,
      tint: this.spriteTint('fire'),
      fadeOutFrac: 0.6,
    });
  }

  /**
   * Finisher target telegraph (PR8 T6 / UI-style cue) — replaces the legacy
   * solid orange block: a fiery danger ring at the exact blast edge ('ring'
   * sheet edge sits at 0.39·size), a faint premult interior wash, and a hot
   * center pulse. All three are persistent decals — the persistent flicker
   * animates them for free; release at fire/cancel.
   */
  novaTelegraph(x: number, z: number, radius: number): NovaTelegraphVfx {
    const hot = this.scaledTint('fire', 1.5);
    const ring = this.sprites.spawnPersistentDecal(x, GROUND_DECAL_Y, z, {
      pos: [x, GROUND_DECAL_Y, z],
      sheet: 'ring',
      blend: 'additive',
      size: radius / 0.39,
      tint: hot,
      loop: true,
    });
    const fill = this.sprites.spawnPersistentDecal(x, GROUND_DECAL_Y - 0.005, z, {
      pos: [x, GROUND_DECAL_Y - 0.005, z],
      sheet: 'glow',
      blend: 'premult',
      size: radius * 2.1,
      tint: [hot[0], hot[1], hot[2], 0.16],
      loop: true,
    });
    const center = this.sprites.spawnPersistentDecal(x, GROUND_DECAL_Y + 0.01, z, {
      pos: [x, GROUND_DECAL_Y + 0.01, z],
      sheet: 'glow',
      blend: 'additive',
      size: 0.55,
      tint: hot,
      loop: true,
    });
    return { ring, fill, center };
  }

  /** Follow the (clamped) cursor while the finisher is being aimed. */
  moveNovaTelegraph(vfx: NovaTelegraphVfx, x: number, z: number): void {
    this.sprites.move(vfx.ring, x, GROUND_DECAL_Y, z);
    this.sprites.move(vfx.fill, x, GROUND_DECAL_Y - 0.005, z);
    this.sprites.move(vfx.center, x, GROUND_DECAL_Y + 0.01, z);
  }

  /** Exactly-once telegraph cleanup (fire / cancel / reset). */
  releaseNovaTelegraph(vfx: NovaTelegraphVfx): void {
    this.sprites.release(vfx.ring);
    this.sprites.release(vfx.fill);
    this.sprites.release(vfx.center);
  }

  /** Windup charge drip — hot motes converging on the caster (~10 Hz). */
  novaChargePuff(x: number, y: number, z: number): void {
    const ox = (Math.random() - 0.5) * 2.0;
    const oz = (Math.random() - 0.5) * 2.0;
    this.sprites.spawn({
      pos: [x + ox, y + Math.random() * 0.4, z + oz],
      vel: [-ox * 2.2, 0.9 + Math.random() * 0.6, -oz * 2.2],
      life: 0.4,
      size: 0.45,
      endSize: 0.12,
      sheet: 'glow',
      blend: 'additive',
      billboard: 1,
      // HDR-hot tint (scaledTint 1.5) so the windup reads at ARPG distance.
      tint: this.scaledTint('fire', 1.5),
      fadeOutFrac: 0.4,
    });
  }

  // ── Loot beams (PR8 T7) ──────────────────────────────────────────────────

  /**
   * Rarity loot beam — persistent cylindrical 'beam' pillar (the sheet's 1:4
   * aspect reads tall at uniform scale) + legendary base glow. 0 handles when
   * the sprite registry is unavailable or the beam cap is reached.
   *
   * The beam quad is centre-pivot and the sheet is bottom-bright — anchor at
   * tall/2 so the bright base sits on the ground, matching the mesh pillar.
   *
   * Beams are persistent sprites that bypass the combined-512 gate, and item
   * drops never expire — an uncapped beam class could starve all combat VFX
   * once persistentCount ≥ FX_MAX_PARTICLES (bag full → beams accumulate).
   * MAX_LOOT_BEAMS keeps the bypass bounded (the gate cap itself was raised
   * 320→512 by human retune 2026-07-27).
   */
  lootBeam(x: number, z: number, tint: readonly [number, number, number, number], opts: { tall?: number; glowSize?: number } = {}): LootBeamVfx {
    if (this.lootBeamCount >= MAX_LOOT_BEAMS) return { beam: 0, glow: 0 };
    const tall = opts.tall ?? 2.2;
    const beam = this.sprites.spawnPersistent({
      pos: [x, tall / 2, z],
      sheet: 'beam',
      blend: 'additive',
      billboard: 2,
      size: tall,
      tint,
      loop: true,
    });
    if (!beam) return { beam: 0, glow: 0 };
    this.lootBeamCount++;
    const glow = opts.glowSize
      ? this.sprites.spawnPersistent({
        pos: [x, 0.15, z],
        sheet: 'glow',
        blend: 'additive',
        billboard: 1,
        size: opts.glowSize,
        tint,
        loop: true,
      })
      : 0;
    return { beam, glow };
  }

  /** Exactly-once loot beam cleanup (pickup / area reset). */
  releaseLootBeam(vfx: LootBeamVfx): void {
    if (vfx.beam && this.lootBeamCount > 0) this.lootBeamCount--;
    this.sprites.release(vfx.beam);
    this.sprites.release(vfx.glow);
  }

  /**
   * Play a declarative EffectDef through the pooled executor (PR2b T2/T3).
   * Returns null when the def exceeds its budget. Existing burst/pop/rise
   * call sites are unchanged.
   */
  playEffect(def: EffectDef, x: number, y: number, z: number): EffectHandle | null {
    return this.executor.play(def, { x, y, z });
  }

  /** Frost Fang cast readability cue — thin playEffect wrapper (cast + cast-rise). */
  frostCastCue(x: number, y: number, z: number): void {
    this.playEffect(combatBeat('frost', ['cast', 'cast-rise']), x, y, z);
  }

  /**
   * Frost Fang impact flash + residue (T4). `crit` kept for call-site
   * signature; EffectDef owns non-crit defaults (data-model SSOT).
   */
  frostImpact(x: number, y: number, z: number, _crit = false): void {
    this.playEffect(
      combatBeat('frost', ['impact', 'impact-burst', 'impact-glow', 'impact-residue']),
      x, y, z,
    );
  }

  /**
   * Shatter node shards — call only when resolveSkill emitted shatter-shards.
   * `count` gates whether to play; particle counts come from frostDef.
   */
  shatterFragments(x: number, y: number, z: number, count: number): void {
    if (count <= 0) return;
    this.playEffect(combatBeat('frost', ['shatter-burst', 'shatter-pop']), x, y + 0.2, z);
  }

  /**
   * Sync a slow-status marker to gameplay state for monster `id`.
   * PR8 T4 reskin: a premult frost-glow sprite decal (primitive) with the
   * legacy emissive disc kept as the Edit-mode fallback. When `active` is
   * false the marker despawns; when true it follows (x,z).
   */
  syncSlowStatus(
    id: string,
    active: boolean,
    x: number,
    z: number,
    until: number,
  ): void {
    if (!active) {
      this.endSlowStatus(id);
      return;
    }
    this.lifecycle.beginSlow(id, until);
    const y = 0.08;
    const existing = this.slowMarkers.get(id);
    if (existing) {
      if (existing.sprite) {
        this.sprites.move(existing.sprite, x, y, z);
      } else if (existing.e) {
        this.world.set(existing.e, Transform, {
          pos: [x, y, z],
          scale: [1.35, 0.08, 1.35],
        });
      }
      return;
    }
    // Sprite decal path (Play mode).
    const handle = this.sprites.spawnPersistentDecal(x, y, z, {
      pos: [x, y, z],
      sheet: 'glow',
      blend: 'premult',
      size: 1.35,
      tint: this.spriteTint('ice'),
      loop: true,
    });
    if (handle) {
      this.slowMarkers.set(id, { sprite: handle });
      return;
    }
    // Edit-mode fallback — legacy emissive disc.
    const mat = this.frostHandles?.slow ?? this.mats.ice;
    const spawned = this.world.spawn(
      { component: Transform, data: { pos: [x, y, z], scale: [1.35, 0.08, 1.35] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    if (!spawned.ok) return;
    this.slowMarkers.set(id, { e: spawned.value as EntityHandle });
  }

  /** Despawn one slow marker (target death). */
  endSlowStatus(id: string): void {
    const m = this.slowMarkers.get(id);
    if (m) {
      if (m.sprite) this.sprites.release(m.sprite);
      if (m.e) this.world.despawn(m.e);
      this.slowMarkers.delete(id);
    }
    this.lifecycle.endSlow(id);
  }

  /**
   * Move-command cue: four inward forged chevrons with magma/ember glow.
   * Flat CUBE decal (local XZ) so arrows stay readable; raised vs ground z-fight.
   */
  moveClickCue(x: number, z: number): void {
    while (this.moveClicks.length >= MOVE_CLICK_MAX || this.moveClickFree.length === 0) {
      const old = this.moveClicks.shift();
      if (!old) break;
      this.world.despawn(old.e);
      this.moveClickFree.push(old.slot);
    }
    const y = 0.14;
    const slot = this.moveClickFree.pop();
    const pooled = slot !== undefined ? this.moveClickPool[slot] : undefined;
    const mat = pooled?.mat ?? this.mats.gold;
    if (pooled) {
      pooled.params.metallic = this.elapsed;
      pooled.params.roughness = 0.9;
    }
    // Thin horizontal slab; shader paints chevrons in local XZ.
    const spawned = this.world.spawn(
      { component: Transform, data: { pos: [x, y, z], scale: [0.7, 0.02, 0.7] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    if (!spawned.ok) {
      if (slot !== undefined) this.moveClickFree.push(slot);
      return;
    }
    this.moveClicks.push({
      e: spawned.value as EntityHandle,
      age: 0,
      life: MOVE_CLICK_LIFE,
      x,
      z,
      slot: slot ?? -1,
    });
  }

  /** Publish projectile count from SkillSystem into the lifecycle snapshot. */
  noteProjectiles(n: number): void {
    this.lifecycle.setProjectiles(n);
  }

  debugCounts(): FxLifecycleSnapshot & { sprites: number } {
    this.lifecycle.setParticles(this.particles.length);
    const sprites = this.sprites.count() + this.sprites.persistentCount();
    return {
      projectiles: this.lifecycle.projectiles,
      particles: this.particles.length,
      sprites,
      slowMarkers: this.slowMarkers.size,
      effects: this.lifecycle.projectiles + this.particles.length + sprites + this.slowMarkers.size,
    };
  }

  /** PR2b pool / budget counters for `__hf` probe dumps (T5 stress). */
  executorStats() {
    return this.executor.stats();
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  tick(dt: number): void {
    this.elapsed += dt;
    // Feed wall-clock time into the custom shaders. The paramValues object is
    // held BY REFERENCE by the material asset (cow-survivor does the same) —
    // mutating `.metallic` here is what the renderer uploads next frame.
    if (this.fireBoltParams) this.fireBoltParams.metallic = this.elapsed;
    for (const p of this.frostParams) p.metallic = this.elapsed;
    for (const p of this.portalMats) p.params.metallic = this.elapsed;

    // Campfire ambience (PR8) — sprite ember sparks + an occasional premult
    // smoke wisp on textured primitives (the geometric rise() trickle retired).
    if (this.emberAt) {
      this.emberTimer -= dt;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.22 + Math.random() * 0.2;
        const { x, y, z } = this.emberAt;
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.4;
        this.sprites.spawn({
          pos: [x + Math.cos(ang) * r, y, z + Math.sin(ang) * r],
          vel: [(Math.random() - 0.5) * 0.5, 1.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5],
          gy: 1.2,
          life: 1.0 + Math.random() * 0.8,
          size: 0.1,
          endSize: 0.03,
          sheet: 'spark',
          blend: 'additive',
          billboard: 1,
          tint: this.scaledTint('fire', 1.5),
          fadeOutFrac: 0.3,
        });
      }
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 1.8 + Math.random() * 1.6;
        this.sprites.spawn({
          pos: [this.emberAt.x, this.emberAt.y + 0.3, this.emberAt.z],
          vel: [(Math.random() - 0.5) * 0.3, 0.55 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3],
          gy: 0.6,
          life: 2.6,
          size: 0.5,
          endSize: 1.15,
          sheet: 'smoke',
          blend: 'premult',
          billboard: 1,
          fps: 5,
          loop: true,
          tint: [0.45, 0.42, 0.48, 0.45],
          fadeOutFrac: 0.5,
        });
      }
    }

    // EffectDef sub-emitter ages / auto-release (presentation already in particles[]).
    this.executor.tick(dt);

    // Move-click chevrons — slight inward settle + fade (quiet command ping).
    for (let i = this.moveClicks.length - 1; i >= 0; i--) {
      const m = this.moveClicks[i]!;
      m.age += dt;
      if (m.age >= m.life) {
        this.world.despawn(m.e);
        if (m.slot >= 0) this.moveClickFree.push(m.slot);
        this.moveClicks.splice(i, 1);
        continue;
      }
      const t = m.age / m.life;
      // Start a hair larger, ease slightly inward (arrows "confirm"), then hold.
      const settle = t < 0.25 ? 1 - t * 0.28 : 0.93;
      const s = 0.7 * settle;
      this.world.set(m.e, Transform, {
        pos: [m.x, 0.14, m.z],
        scale: [s, 0.02, s],
      });
      const pooled = m.slot >= 0 ? this.moveClickPool[m.slot] : undefined;
      if (pooled) {
        pooled.params.metallic = this.elapsed;
        // Hold readable for most of life, then soft fade.
        const fade = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        pooled.params.roughness = 0.9 * Math.max(0, fade);
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
    // Sprite particles integrate + feed flipbook/erosion/distortion params.
    this.sprites.tick(dt, this.elapsed);
    // Live particle entities remain the lifecycle SSOT; executor bookkeeping
    // is orthogonal (instance/trail peaks via executor.stats()).
    this.lifecycle.setParticles(this.particles.length);
  }

  count(): number { return this.particles.length; }

  /** Despawn transient particles + status markers (combat-run / area reset). */
  clearTransient(): void {
    this.executor.releaseAll();
    for (const p of this.particles) this.world.despawn(p.e);
    this.particles.length = 0;
    this.sprites.clear();
    // PR8 T3 — ambient flames are scene fixtures, not combat spam: re-ignite.
    for (const f of this.ambientFires) this.igniteFixture(f);
    // Sprite-based slow markers died in sprites.clear(); mesh fallbacks despawn here.
    for (const m of this.slowMarkers.values()) if (m.e) this.world.despawn(m.e);
    this.slowMarkers.clear();
    for (const m of this.moveClicks) this.world.despawn(m.e);
    this.moveClicks.length = 0;
    this.moveClickFree = this.moveClickPool.map((_, i) => i);
    this.lifecycle.clearAll();
    this.emberTimer = 0;
    this.smokeTimer = 1.5;
  }
}
