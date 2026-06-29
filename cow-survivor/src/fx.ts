// Visual feedback effects: kill debris, screen shake, and chain-lightning
// arcs — all WORLD-SPACE only (floating text is DOM, see hud.ts).
//
// Particle architecture
// ─────────────────────
// One `Particle` struct per visual entity. The renderer entity has no rigid
// body — we manually integrate position each frame in `tickDebris`. A
// `mode` field selects how each particle animates:
//
//   • 'uniform-shrink' — uniform scale that shrinks toward 0 (gibs, splash)
//   • 'uniform-hold'   — uniform scale held constant (shatter chunks)
//   • 'bolt'           — preserves the SPAWN non-uniform scale (thin long
//                        cube), then layers a "flicker" animation:
//                          bright → dim → bright → dim → fade
//                        so the bolt visibly pulses instead of just shrinking
//   • 'orb-pulse'      — scale starts at s0, jumps to 1.4·s0, settles to 0
//                        — used for the "node" energy ball at each chain
//                        target.
//
// This is the FIX for "the chain lightning wasn't visible": the old version
// stamped a uniform s on every particle every frame, which destroyed the
// long cube's non-uniform shape (turning every lightning segment into a
// small cube) within a single frame.
//
// Death FX (one helper per `deathFx` variant in enemies.ts):
//   • burst      — generic short outward fling of small spheres (gibs)
//   • spark      — vertical light pillar + upward motes (explode/wisp)
//   • dissipate  — slow drifting fog motes (poison cloud)
//   • shatter    — chunky cubes that fall + tumble (stone bull)
//   • splash     — flat ring of low-flying motes (boss / split)
//
// Chain-lightning FX:
//   • lightningArc  — main 5-segment zigzag bolt between two points
//   • lightningSpark— bright orb pulse at a hit target
//   • lightningFork — short side-arc fork branching off the middle of a bolt

import {
  Transform, MeshFilter, MeshRenderer, Materials,
  HANDLE_SPHERE, HANDLE_CUBE, type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';

import lightningShader from './shaders/lightning.wgsl';
import shockwaveShader from './shaders/shockwave.wgsl';
import torchFlameShader from './shaders/torch-flame.wgsl';
import runeGlowShader from './shaders/rune-glow.wgsl';
import fireballShader from './shaders/explosion-fireball.wgsl';
import fireTrailShader from './shaders/fire-trail.wgsl';
import iceShardShader from './shaders/ice-shard.wgsl';
import { effectAttachPrefixes, type EffectAssets, type EffectAsset } from './effects';
import { ParticleSystem, type ParticleEmitter } from './particles';

const LIGHTNING_SHADER_ID = 'cow_survivor::lightning';
const SHOCKWAVE_SHADER_ID = 'cow_survivor::shockwave';
const TORCH_FLAME_SHADER_ID = 'cow_survivor::torch_flame';
const RUNE_GLOW_SHADER_ID = 'cow_survivor::rune_glow';
const FIREBALL_SHADER_ID = 'cow_survivor::explosion_fireball';
const FIRE_TRAIL_SHADER_ID = 'cow_survivor::fire_trail';
const ICE_SHARD_SHADER_ID = 'cow_survivor::ice_shard';

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type Ctx = Parameters<GameEntry>[0];

export type FxColor = 'gold' | 'red' | 'cyan' | 'magenta' | 'green' | 'purple' | 'white';

type ParticleMode = 'uniform-shrink' | 'uniform-hold' | 'bolt' | 'orb-pulse';

interface Particle {
  e: Entity;
  age: number;
  life: number;
  // motion
  vx: number; vy: number; vz: number;
  // gravity (zero for floaters and bolts)
  gx: number; gy: number; gz: number;
  // animation mode (see file header)
  mode: ParticleMode;
  // initial scale tuple — for 'bolt' we keep these as the BASE, then modulate
  // brightness/scale by a flicker function; for uniform modes only sx is read
  s0x: number; s0y: number; s0z: number;
}

export class FxSystem {
  private particles: Particle[] = [];
  /** Color → material handle. Built once. Indexed by FxColor. */
  private mats: Record<FxColor, MatHandle>;
  // Shake state
  private shakeTime = 0;
  private shakeMag = 0;
  // T3 — custom shader materials (always-on-allocated; mutated per-frame).
  private lightningMat: MatHandle | null = null;
  private lightningParams: { baseColor: number[]; metallic: number; roughness: number } | null = null;
  private shockwavePool: Array<{
    mat: MatHandle;
    params: { baseColor: number[]; metallic: number; roughness: number };
  }> = [];
  private shockwaveCursor = 0;
  /** Active shockwave instances — entity + lifetime tracker. */
  private shockwaves: Array<{ e: Entity; slot: number; age: number; life: number; baseSx: number; baseSz: number; baseSy: number }> = [];
  // Scene-effect materials (torch-flame, rune-glow): one shared material per
  // asset, mutated each frame so `metallic` carries wall-clock time. Used
  // by attachSceneEffects() to swap into scene entities at level load.
  private sceneEffectMats: Record<string, {
    mat: MatHandle;
    params: { baseColor: number[]; metallic: number; roughness: number };
    asset: EffectAsset;
  }> = {};
  // E1+ — shared per-weapon-type bullet materials (single material per
  // type, all bullets of that type share + flicker in sync).
  private bulletMats: { fire?: MatHandle; ice?: MatHandle } = {};
  private bulletMatParams: Array<{ baseColor: number[]; metallic: number; roughness: number }> = [];
  // E1+ — explosion fireball pool (sphere, per-instance progress mutated
  // each frame).
  private fireballPool: Array<{
    mat: MatHandle;
    params: { baseColor: number[]; metallic: number; roughness: number };
  }> = [];
  private fireballCursor = 0;
  private fireballs: Array<{ e: Entity; slot: number; age: number; life: number }> = [];
  // Wall-clock fed into the lightning shader's noise/flicker (paramValues
  // are material-level so all bolts share the same time → they all flicker
  // in sync, which reads as ONE storm rather than separate bolts).
  private elapsed = 0;

  // P1: engine-native instanced particle system. ONE emitter per visual
  // role; emits multiple particles per call. Far cheaper than the
  // per-particle `addParticle` path that spawns a fresh ECS entity each
  // time (which choked under chain-lightning + explosion combos).
  private particleSys: ParticleSystem;
  private emFire!: ParticleEmitter;       // explosion / fire-bullet hot core
  private emSmoke!: ParticleEmitter;      // explosion outer puffs
  private emSpark!: ParticleEmitter;      // chain-lightning + shatter sparks
  private emIce!: ParticleEmitter;        // ice bullet trail + ice death
  private emDebris!: ParticleEmitter;     // generic kill debris (red/gold)
  private emReady = false;

  constructor(private ctx: Ctx, private effects: EffectAssets = {}) {
    const palette: Record<FxColor, [number, number, number]> = {
      gold:    [1.0, 0.75, 0.25],
      red:     [1.0, 0.30, 0.30],
      cyan:    [0.45, 0.90, 1.0],
      magenta: [0.95, 0.40, 1.0],
      green:   [0.45, 1.0, 0.40],
      purple:  [0.85, 0.55, 1.0],
      white:   [1.0, 1.0, 1.0],
    };
    this.mats = {} as Record<FxColor, MatHandle>;
    for (const [name, c] of Object.entries(palette) as [FxColor, [number, number, number]][]) {
      // Emissive intensity per fx colour. Previous 30/14/10 multiplied by
      // the per-channel baseColor sent (R, G, B) past 30 in every channel
      // → ACES Narkowicz tonemap saturated all three to ~1.0 → every fx
      // colour rendered as pure white at the core, with bloom further
      // washing the surround. Dropping to 2.0/1.5/1.2 keeps the emissive
      // distinctly colourful while still bright enough to halo via the
      // bloom pass (bloomThreshold=1.0 picks up anything ≥ 1 luminance).
      const intensity =
        name === 'purple' || name === 'white' ? 2.0
        : name === 'cyan' || name === 'magenta' ? 1.5
        : 1.2;
      const m = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: [c[0], c[1], c[2], 1], roughness: 0.4, metallic: 0,
        emissive: c, emissiveIntensity: intensity,
      }));
      this.mats[name] = m;
    }

    // T3 / E1 — register custom shader materials (lightning + shockwave).
    // Initial paramValues + pool size come from the loaded .fx.json assets
    // when present (passed in via the constructor); fall back to baked-in
    // defaults so a missing file still yields working visuals.
    const renderer = (ctx.app as unknown as {
      renderer: {
        shader: {
          registerMaterialShader: (id: string, entry: { source: string; paramSchema: Array<{ name: string; type: 'color' | 'f32' }>; bindingLayout: [] }) => void;
        } | null;
      };
    }).renderer;
    if (renderer?.shader) {
      // The vite-plugin-shader pre-registers each *.wgsl + *.wgsl.meta.json
      // pair into the engine ShaderRegistry at boot, so calling
      // registerMaterialShader for the same id throws 'already registered'.
      // We swallow that error (the shader is available either way) and
      // keep going to the MaterialAsset creation below — the previous
      // outer try/catch let one duplicate-register crash kill the entire
      // FX pipeline.
      const safeRegister = (id: string, source: string): void => {
        try {
          renderer.shader!.registerMaterialShader(id, {
            source,
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
            console.warn(`[fx] registerMaterialShader(${id}) threw:`, msg);
          }
        }
      };
      // Additive render-state for emissive FX (no depth write so the cube
      // footprint doesn't occlude the ground; ADDITIVE color blend so the
      // glow stacks on top of whatever's behind without any alpha occlusion).
      const TRANSPARENT_STATE = {
        depthWriteEnabled: false,
        depthCompare: 'less' as const,
        cullMode: 'none' as const,
        blend: {
          // PREMULTIPLIED ALPHA (was pure-additive one+one). Additive let
          // overlapping lightning/shockwave/FX SUM past 1.0 and ACES clamped
          // the result to white during dense combat. Premult makes overlaps
          // OCCLUDE instead of SUM, capping brightness so nothing washes the
          // fireball white.
          color: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
          alpha: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
        },
      };
      // SEPARATE render state for bullet bodies. The fire-trail / ice-shard
      // shaders are applied to actual moving projectiles, NOT particle
      // bursts. Under continuous fire, 3-6 bullets pile up in flight along
      // the same firing direction. The top-down survivor camera fore-
      // shortens the firing axis, so consecutive bullets in flight overlap
      // heavily in SCREEN SPACE — under the additive blend above, each
      // overlapping bullet ADDS its emissive RGB to the same pixel, so
      // a 4-bullet pile-up produces 4× the per-bullet amp → ACES tonemap
      // pushes the result red → orange → yellow → white as the pile-up
      // grows along the stream from muzzle to leading bullet.
      //
      // Use PREMULTIPLIED ALPHA blend for bullet bodies instead. Each
      // bullet writes (rgb*amp, amp); the dst factor `one-minus-src-alpha`
      // OCCLUDES previous bullets at the same pixel instead of summing
      // them. The frontmost (or last-drawn) bullet at a pixel wins,
      // exactly like an opaque material — but the alpha=amp still gives
      // a soft falloff at cube edges so the bullet reads as a flame
      // instead of a hard cube silhouette.
      const BULLET_STATE = {
        depthWriteEnabled: false,
        depthCompare: 'less' as const,
        cullMode: 'none' as const,
        blend: {
          color: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
          alpha: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const, operation: 'add' as const },
        },
      };
      try {
        safeRegister(LIGHTNING_SHADER_ID, lightningShader.wgsl);
        safeRegister(SHOCKWAVE_SHADER_ID, shockwaveShader.wgsl);
        // ── lightning material (single shared instance) ─────────────────
        const lDefault = this.effects['lightning-bolt']?.params
          ?? { baseColor: [0.95, 0.85, 1.0], metallic: 0, roughness: 1.4 };
        const lParams = { baseColor: [...lDefault.baseColor], metallic: lDefault.metallic, roughness: lDefault.roughness };
        // engine e53f4616: `assets.register` is gone → mint an inline shared
        // material handle directly via `world.allocSharedRef` (no Result; never
        // fails). Same for every register call below.
        this.lightningMat = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
          kind: 'material',
          passes: [{ name: 'Forward', shader: LIGHTNING_SHADER_ID, tags: { LightMode: 'Forward' }, queue: 3000, renderState: TRANSPARENT_STATE }],
          paramValues: lParams as never,
        });
        this.lightningParams = lParams;
        // ── shockwave pool ──────────────────────────────────────────────
        const sDefault = this.effects['shockwave-ring']?.params
          ?? { baseColor: [1.0, 0.75, 0.25], metallic: 1.0, roughness: 4.0 };
        const poolSize = this.effects['shockwave-ring']?.poolSize ?? 16;
        for (let i = 0; i < poolSize; i++) {
          const sParams = { baseColor: [...sDefault.baseColor], metallic: 1.0, roughness: sDefault.roughness };
          const sMat = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
            kind: 'material',
            passes: [{ name: 'Forward', shader: SHOCKWAVE_SHADER_ID, tags: { LightMode: 'Forward' }, queue: 3000, renderState: TRANSPARENT_STATE }],
            paramValues: sParams as never,
          });
          this.shockwavePool.push({ mat: sMat, params: sParams });
        }
        // ── E1 scene-effect shaders + materials (one shared per asset) ──
        // Scene effects use BULLET_STATE (premultiplied alpha) instead of
        // TRANSPARENT_STATE (pure-additive `src=one, dst=one`). The pure-
        // additive blend accumulates RGB across overlapping draws — and the
        // AltarRune1+AltarRune2 (and Decor_SteleRune*) slabs at level1's
        // (0,0,0) area overlap heavily at the player spawn footprint, so 3-4
        // rune slabs add up to ~4× per-slab brightness, post-ACES landing at
        // bright PURPLE/WHITE (~RGB 165,121,206 even with a dim per-pixel
        // shader output). Premult alpha occludes instead of summing, so the
        // visible peak matches the single-slab shader output (~RGB 50,27,96)
        // — a subtle deep-purple pulse that no longer competes with the
        // fire bullet visually.
        const sceneShaderRegs: Array<[string, { wgsl: string; hash: string }, string]> = [
          [TORCH_FLAME_SHADER_ID, torchFlameShader, 'torch-flame'],
          [RUNE_GLOW_SHADER_ID, runeGlowShader, 'rune-glow'],
        ];
        for (const [shaderId, mod, assetKey] of sceneShaderRegs) {
          const asset = this.effects[assetKey];
          if (!asset) continue;
          safeRegister(shaderId, mod.wgsl);
          const params = {
            baseColor: [...asset.params.baseColor],
            metallic: 0,
            roughness: asset.params.roughness,
          };
          const mat = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
            kind: 'material',
            passes: [{ name: 'Forward', shader: shaderId, tags: { LightMode: 'Forward' }, queue: 3000, renderState: BULLET_STATE }],
            paramValues: params as never,
          });
          this.sceneEffectMats[assetKey] = { mat, params, asset };
        }
        // ── E1+ explosion-fireball pool ────────────────────────────────
        const fbAsset = this.effects['explosion-fireball'];
        if (fbAsset) {
          safeRegister(FIREBALL_SHADER_ID, fireballShader.wgsl);
          for (let i = 0; i < fbAsset.poolSize; i++) {
            const params = {
              baseColor: [...fbAsset.params.baseColor],
              metallic: 1.0,
              roughness: fbAsset.params.roughness,
            };
            const mat = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
              kind: 'material',
              passes: [{ name: 'Forward', shader: FIREBALL_SHADER_ID, tags: { LightMode: 'Forward' }, queue: 3000, renderState: TRANSPARENT_STATE }],
              paramValues: params as never,
            });
            this.fireballPool.push({ mat, params });
          }
        }
        // ── E1+ shared bullet materials (fire / ice) ───────────────────
        // Use BULLET_STATE (premultiplied alpha) instead of TRANSPARENT_STATE
        // (additive). Under continuous fire, multiple bullets pile up along
        // the firing axis; the top-down camera foreshortens them onto
        // overlapping screen pixels. Additive blend would sum each bullet's
        // emissive at those pixels, producing the red → orange → yellow →
        // white gradient the user kept reporting (each bullet adds another
        // ×amp to the same pixel, eventually saturating ACES to white).
        // Alpha-blend OCCLUDES instead of sums, so each bullet renders its
        // own colour independently regardless of how many are in flight.
        for (const [shaderId, mod, assetKey, target] of [
          [FIRE_TRAIL_SHADER_ID, fireTrailShader, 'fire-trail', 'fire'],
          [ICE_SHARD_SHADER_ID,  iceShardShader,  'ice-shard',  'ice'],
        ] as const) {
          const asset = this.effects[assetKey];
          if (!asset) continue;
          safeRegister(shaderId, mod.wgsl);
          const params = {
            baseColor: [...asset.params.baseColor],
            metallic: 0,
            roughness: asset.params.roughness,
          };
          const mat = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
            kind: 'material',
            passes: [{ name: 'Forward', shader: shaderId, tags: { LightMode: 'Forward' }, queue: 3000, renderState: BULLET_STATE }],
            paramValues: params as never,
          });
          this.bulletMats[target] = mat;
          this.bulletMatParams.push(params);
        }
      } catch (e) {
        console.warn('[fx] custom-shader register failed; lightning/shockwave fall back to plain emissive:', (e as Error).message);
      }
    }

    // P1: engine-native instanced particle emitters. Each emitter is ONE
    // ECS entity carrying Instances{transforms} + cow_survivor::particle
    // material. The shader handles soft circular falloff + per-instance
    // jitter; we just integrate motion + repack mat4s on the CPU.
    try {
      this.particleSys = new ParticleSystem(ctx);
      // Intensity targets: peak amp = intensity × 0.6 × jitter(0.85..1.15)
      // per particle (see particle.wgsl). With additive blend a cluster
      // of K overlapping particles sums to K × peak; to keep K=3-4 from
      // saturating ACES, individual peak should be ≤ 1.0. So:
      //   intensity 1.5..2.5 → per-particle peak 0.9..1.5 (mostly < 1)
      // → 3 overlapping = 2.7..4.5 = solid colour with bloom halo,
      // 5 overlapping = 4.5..7.5 = white-hot core (intended for the
      // densest part of a fireball).
      this.emFire   = this.particleSys.emitter('fx-fire',   { capacity: 96, geometry: 'sphere', baseColor: [1.0, 0.30, 0.06], intensity: 0.8 });
      this.emSmoke  = this.particleSys.emitter('fx-smoke',  { capacity: 48, geometry: 'sphere', baseColor: [0.30, 0.22, 0.30], intensity: 0.5 });
      this.emSpark  = this.particleSys.emitter('fx-spark',  { capacity: 96, geometry: 'cube',   baseColor: [1.0, 0.55, 0.20],  intensity: 0.8 });
      this.emIce    = this.particleSys.emitter('fx-ice',    { capacity: 80, geometry: 'cube',   baseColor: [0.30, 0.65, 1.0],  intensity: 0.8 });
      this.emDebris = this.particleSys.emitter('fx-debris', { capacity: 96, geometry: 'cube',   baseColor: [0.9, 0.6, 0.25],   intensity: 0.7 });
      this.emReady = true;
    } catch (e) {
      console.warn('[fx] particle system init failed:', (e as Error).message);
      this.particleSys = null as never;
    }
  }

  /** E1+ get the shared bullet material for a weapon family. weapons.ts
   *  uses this in place of the standard emissive material when the shader
   *  is registered; returns undefined → fall back to standard PBR. */
  bulletMaterial(family: 'fire' | 'ice'): MatHandle | undefined {
    return this.bulletMats[family];
  }

  // ─── P2: explosion as a particle burst ──────────────────────────────────
  /**
   * Trigger a full explosion at (x, y, z): hot fire core + outward sparks +
   * upward smoke puffs + ground shockwave. Replaces the previous single-
   * sphere fireball mesh with a cluster of 60+ instanced particles for a
   * proper "burst" feel.
   *
   * `radius` controls outward velocity range and shockwave size — pass the
   * weapon's AoE radius (~2 for grenade, ~7 for boss death) and the visual
   * scales.
   */
  explosion(x: number, y: number, z: number, radius: number = 2.4): void {
    if (this.emReady) {
      const fireCount = Math.min(40, Math.round(radius * 14));
      const smokeCount = Math.min(16, Math.round(radius * 6));
      const sparkCount = Math.min(28, Math.round(radius * 10));
      // Hot core: fast-outward orange motes that pop bright then die.
      for (let i = 0; i < fireCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const upTilt = Math.random() * 1.0 - 0.2;
        const speed = 4 + Math.random() * radius * 3.5;
        this.emFire.emit({
          px: x + Math.cos(ang) * 0.2 * radius,
          py: y + 0.1 + Math.random() * 0.3,
          pz: z + Math.sin(ang) * 0.2 * radius,
          vx: Math.cos(ang) * speed,
          vy: upTilt * speed * 0.6,
          vz: Math.sin(ang) * speed,
          gy: -3.5,
          drag: 1.6,
          size: 0.18 + Math.random() * 0.18 + radius * 0.04,
          life: 0.45 + Math.random() * 0.25,
          fadeMode: 'pop',
        });
      }
      // Smoke: slower, drift up + outward, fades over a longer window.
      for (let i = 0; i < smokeCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * radius * 0.8;
        this.emSmoke.emit({
          px: x + Math.cos(ang) * 0.1,
          py: y + 0.15 + Math.random() * 0.4,
          pz: z + Math.sin(ang) * 0.1,
          vx: Math.cos(ang) * speed,
          vy: 1.5 + Math.random() * 1.5,
          vz: Math.sin(ang) * speed,
          gy: 0.5,
          drag: 0.6,
          size: 0.45 + Math.random() * 0.4,
          life: 0.9 + Math.random() * 0.5,
          fadeMode: 'pop',
        });
      }
      // Sharp white sparks: very fast outward little cube shards with
      // gravity + fast life. Adds the "crack" texture inside the fireball.
      for (let i = 0; i < sparkCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 5.5 + Math.random() * radius * 4.5;
        const upTilt = Math.random() * 1.4;
        this.emSpark.emit({
          px: x, py: y + 0.2, pz: z,
          vx: Math.cos(ang) * speed,
          vy: upTilt * speed * 0.6,
          vz: Math.sin(ang) * speed,
          gy: -8.0,
          drag: 0.4,
          size: 0.07 + Math.random() * 0.06,
          life: 0.35 + Math.random() * 0.25,
          rotY: Math.random() * Math.PI,
          rotVel: (Math.random() - 0.5) * 12,
          sxR: 0.3, syR: 0.3, szR: 1.4,    // elongated like sparks
          fadeMode: 'shrink',
        });
      }
    }
    // No ground shockwave on explosion. The previous cube-disc geometry
    // (8m+ wide thin slab) consistently read as a "rectangular block on
    // the ground" to the user despite the shader being a thin
    // additive ring under transparent renderState — the alpha=0 fragments
    // outside the band cleanly multiply to vec4(0,0,0,0), but Apple
    // WebGPU's tile-deferred composite path still rasterizes the
    // FOOTPRINT in a way that bleeds dimly visible tint. The 80+ fire/
    // smoke/spark particles already convey "explosive blast" without
    // needing a separate ground ring; drop the call.
    void radius;
  }

  /** P4: chain-lightning hit sparks. Bright purple-white burst + a tiny
   *  upward whisper of motes. Cheap; safe to call on every chain target. */
  chainSparks(x: number, z: number, y: number = 1.0): void {
    if (!this.emReady) return;
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      const upTilt = 0.3 + Math.random() * 1.4;
      this.emSpark.emit({
        px: x, py: y, pz: z,
        vx: Math.cos(ang) * speed,
        vy: upTilt * speed * 0.5,
        vz: Math.sin(ang) * speed,
        gy: -6.0,
        drag: 1.2,
        size: 0.08 + Math.random() * 0.06,
        life: 0.22 + Math.random() * 0.18,
        rotY: Math.random() * Math.PI,
        rotVel: (Math.random() - 0.5) * 16,
        sxR: 0.25, syR: 0.25, szR: 1.6,
        fadeMode: 'shrink',
      });
    }
  }

  /** P3: per-frame bullet trail emit. Call from weapons.ts when a fire/
   *  ice bullet is in flight. Particles are biased BACKWARD relative to
   *  bullet velocity so the trail extends behind the bullet instead of
   *  clustering at the head (the old random-drift version had every
   *  particle linger near the bullet position, additively blending into
   *  a white blob over ~0.4s of accumulation). One particle per call;
   *  caller throttles to every other frame. */
  bulletTrail(x: number, y: number, z: number, vx: number, vy: number, vz: number, family: 'fire' | 'ice'): void {
    if (!this.emReady) return;
    const em = family === 'fire' ? this.emFire : this.emIce;
    // Backward direction in world space (opposite of velocity, unit-ish).
    const sp = Math.hypot(vx, vy, vz) || 1;
    const bx = -vx / sp, by = -vy / sp, bz = -vz / sp;
    // Emit ONE particle this frame, biased to drift backward + sideways.
    const sidewaysJitter = 0.4;
    em.emit({
      // Spawn slightly behind the bullet so the head stays clear.
      px: x + bx * 0.15 + (Math.random() - 0.5) * 0.04,
      py: y + by * 0.15 + (Math.random() - 0.5) * 0.04,
      pz: z + bz * 0.15 + (Math.random() - 0.5) * 0.04,
      // Particle velocity = backward + small perpendicular spread.
      vx: bx * (1.5 + Math.random() * 1.5) + (Math.random() - 0.5) * sidewaysJitter,
      vy: by * (1.5 + Math.random() * 1.5) + (family === 'fire' ? 0.3 + Math.random() * 0.4 : -0.3 - Math.random() * 0.3),
      vz: bz * (1.5 + Math.random() * 1.5) + (Math.random() - 0.5) * sidewaysJitter,
      gy: family === 'fire' ? 0.5 : -2.0,
      drag: 1.5,
      size: family === 'fire' ? 0.18 + Math.random() * 0.06 : 0.12 + Math.random() * 0.05,
      // Shorter life so the trail extends only ~3-4m behind the bullet
      // (not the previous 8m blob).
      life: 0.18 + Math.random() * 0.10,
      fadeMode: family === 'fire' ? 'pop' : 'shrink',
      ...(family === 'ice' ? { rotY: Math.random() * Math.PI, rotVel: (Math.random() - 0.5) * 6, sxR: 0.7, syR: 1.2, szR: 0.5 } : {}),
    });
  }

  /** P4: enemy death burst. `kind` selects color/shape. Replaces the old
   *  per-particle ECS spawn path for kill FX with a single instanced
   *  emitter draw. */
  deathBurst(x: number, z: number, y: number = 0.6, color: FxColor = 'red'): void {
    if (!this.emReady) return;
    // Pick the closest emitter for the requested color. Per-call hue
    // tinting would need a unique emitter per color — we collapse to 4
    // physical emitters and tint via emitter choice.
    const em =
      color === 'cyan' || color === 'white' ? this.emSpark
      : color === 'purple' || color === 'magenta' ? this.emSpark
      : color === 'green' ? this.emSmoke      // poison cloud reuse
      : this.emDebris;                         // gold/red default
    const count = 14;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 4.5;
      const upTilt = 0.4 + Math.random() * 1.6;
      em.emit({
        px: x, py: y, pz: z,
        vx: Math.cos(ang) * speed,
        vy: upTilt * speed * 0.5,
        vz: Math.sin(ang) * speed,
        gy: -8.0,
        drag: 1.0,
        size: 0.10 + Math.random() * 0.08,
        life: 0.40 + Math.random() * 0.30,
        rotY: Math.random() * Math.PI,
        rotVel: (Math.random() - 0.5) * 14,
        sxR: 0.5, syR: 0.5, szR: 1.0,
        fadeMode: 'shrink',
      });
    }
  }

  // ─── P2 / E1+ explosion-fireball legacy path ────────────────────────────
  // Kept callable so old call sites (main.ts grenade) still work, but it
  // now just delegates to the new particle-based explosion(). The old
  // sphere+shockwave entity pair is no longer used.

  /** E1+ spawn an expanding fireball at (x, y, z). Replaces / complements
   *  the previous cube-debris explosion. The mesh is a sphere whose
   *  scale = the explosion radius; the shader animates the lifetime
   *  progress so the fireball grows + roils + fades. */
  explosionFireball(x: number, y: number, z: number, radius: number = 2.4, lifetime: number = 0.45): void {
    if (this.fireballPool.length === 0) return;
    const slot = this.fireballCursor % this.fireballPool.length;
    this.fireballCursor += 1;
    const pool = this.fireballPool[slot]!;
    pool.params.metallic = 0;            // progress = 0 (just born)
    const d = radius;                    // sphere mesh has unit-radius * 0.5? scale=2*radius for visual size
    const e = this.ctx.world.spawn(
      { component: Transform, data: { posX: x, posY: y, posZ: z, scaleX: d, scaleY: d, scaleZ: d } },
      { component: MeshFilter, data: { assetHandle: HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [pool.mat] } },
    ).unwrap();
    this.fireballs.push({ e, slot, age: 0, life: lifetime });
  }
  attachSceneEffects(
    nodes: ReadonlyArray<{ localId: number; components: Record<string, Record<string, unknown>> }>,
    mapping: ReadonlyMap<number, Entity>,
  ): number {
    const { world } = this.ctx;
    let count = 0;
    for (const node of nodes) {
      const name = (node.components.Name as { value?: string } | undefined)?.value;
      if (!name) continue;
      for (const slot of Object.values(this.sceneEffectMats)) {
        const prefixes = effectAttachPrefixes(slot.asset);
        const hit = prefixes.some((p) => name.startsWith(p));
        if (!hit) continue;
        const e = mapping.get(node.localId);
        if (e === undefined) continue;
        const setRes = world.set(e, MeshRenderer, { materials: [slot.mat] });
        if (setRes.ok) count += 1;
      }
    }
    return count;
  }

  // ─── primitive spawn helpers ────────────────────────────────────────────
  /** Spawn one particle entity (no rigid body). Internal helper. The
   *  optional `matOverride` swaps in a custom material handle (T3 lightning
   *  bolt halo replaces the plain 'purple' emissive material). */
  private addParticle(
    shape: 'sphere' | 'cube',
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    color: FxColor,
    vx: number, vy: number, vz: number,
    gy: number,
    life: number,
    mode: ParticleMode,
    quatY?: number,
    matOverride?: MatHandle,
  ): void {
    const mat = matOverride ?? this.mats[color];
    const handle = shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE;
    const data: Record<string, number> = {
      posX: x, posY: y, posZ: z, scaleX: sx, scaleY: sy, scaleZ: sz,
    };
    if (quatY !== undefined) {
      const h = quatY * 0.5;
      data.quatX = 0; data.quatY = Math.sin(h); data.quatZ = 0; data.quatW = Math.cos(h);
    }
    const e = this.ctx.world.spawn(
      { component: Transform, data },
      { component: MeshFilter, data: { assetHandle: handle } },
      { component: MeshRenderer, data: { materials: [mat] } },
    ).unwrap();
    this.particles.push({
      e, age: 0, life,
      vx, vy, vz, gx: 0, gy, gz: 0,
      mode,
      s0x: sx, s0y: sy, s0z: sz,
    });
  }

  // ─── death FX ────────────────────────────────────────────────────────────

  /** Generic outward gib burst — small fast spheres, short life. (gibs) */
  burst(x: number, y: number, z: number, count: number = 6, color: FxColor = 'red'): void {
    // P4: route generic burst through the instanced particle path. Picks
    // an emitter by color so the cluster takes on a recognisable tint
    // (gold for boss, cyan for spark monsters, red/orange for cows).
    if (this.emReady) {
      const em =
        color === 'cyan' || color === 'magenta' || color === 'white'      ? this.emSpark
        : color === 'purple'                                              ? this.emSpark
        : color === 'green'                                               ? this.emSmoke
        : color === 'gold'                                                ? this.emDebris
        : color === 'red'                                                 ? this.emFire
        : this.emDebris;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 3.5 + Math.random() * 5;
        const upTilt = 0.6 + Math.random() * 1.6;
        em.emit({
          px: x, py: y + 0.3, pz: z,
          vx: Math.cos(ang) * speed,
          vy: upTilt * speed * 0.55,
          vz: Math.sin(ang) * speed,
          gy: -10.0,
          drag: 1.0,
          size: 0.10 + Math.random() * 0.08,
          life: 0.40 + Math.random() * 0.30,
          rotY: Math.random() * Math.PI,
          rotVel: (Math.random() - 0.5) * 12,
          sxR: 0.5, syR: 0.5, szR: 1.0,
          fadeMode: 'shrink',
        });
      }
      return;
    }
    // Fallback: legacy per-particle ECS path if particles aren't ready
    // (e.g. shader registration failed at boot).
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 5;
      const r = 0.12 + Math.random() * 0.08;
      this.addParticle('sphere',
        x, y + 0.4, z, r, r, r, color,
        Math.cos(ang) * sp, 4 + Math.random() * 4, Math.sin(ang) * sp,
        -16, 0.8 + Math.random() * 0.4, 'uniform-hold');
    }
  }

  /** Electric / soul-fire pillar — central beam + upward motes. */
  spark(x: number, z: number, color: FxColor): void {
    this.addParticle('cube',
      x, 1.2, z, 0.18, 1.5, 0.18, color,
      0, 4, 0, -2, 0.6, 'uniform-shrink');
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
      const r0 = 0.2 + Math.random() * 0.2;
      const ox = Math.cos(ang) * r0;
      const oz = Math.sin(ang) * r0;
      const sz = 0.10 + Math.random() * 0.06;
      this.addParticle('sphere',
        x + ox, 0.4, z + oz, sz, sz, sz, color,
        ox * 1.5, 6 + Math.random() * 3, oz * 1.5,
        -4, 0.8 + Math.random() * 0.3, 'uniform-shrink');
    }
  }

  /** Slow drifting fog motes — toxiccow's poison. */
  dissipate(x: number, z: number, color: FxColor, _radius: number = 1.4): void {
    const motes = 14;
    for (let i = 0; i < motes; i++) {
      const ang = (i / motes) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 1.5 + Math.random() * 1.2;
      const r = 0.22 + Math.random() * 0.18;
      this.addParticle('sphere',
        x, 0.5 + Math.random() * 0.4, z, r, r, r, color,
        Math.cos(ang) * sp, 0.5 + Math.random() * 0.8, Math.sin(ang) * sp,
        0, 1.2 + Math.random() * 0.6, 'uniform-shrink');
    }
  }

  /** Heavy chunks that fall + tumble — stone bull. */
  shatter(x: number, z: number, color: FxColor): void {
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      const sz = 0.18 + Math.random() * 0.16;
      this.addParticle('cube',
        x, 0.8, z, sz, sz, sz, color,
        Math.cos(ang) * sp, 5 + Math.random() * 3, Math.sin(ang) * sp,
        -22, 1.4 + Math.random() * 0.4, 'uniform-hold');
    }
  }

  /** Wide flat ring spreading outward — boss death + split. */
  splash(x: number, z: number, color: FxColor, count: number = 16): void {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 8 + Math.random() * 4;
      const sz = 0.16 + Math.random() * 0.10;
      this.addParticle('sphere',
        x, 0.3, z, sz, sz, sz, color,
        Math.cos(ang) * sp, 1.0, Math.sin(ang) * sp,
        -8, 0.7 + Math.random() * 0.3, 'uniform-shrink');
    }
  }

  // ─── CHAIN LIGHTNING ─────────────────────────────────────────────────────
  //
  // Three layered effects fired together by main.ts when a chain bolt jumps:
  //
  //   1. lightningArc  — the main jagged 5-segment bolt between the two
  //                      points, plus a brighter WHITE inner core overlaid
  //                      on every segment so the bolt has a hot center +
  //                      purple glow halo. Each segment is a long thin cube
  //                      ('bolt' mode) that PRESERVES its non-uniform scale
  //                      and flickers in brightness over its lifetime.
  //   2. lightningFork — 1-2 short side-arcs branching off the bolt at
  //                      random points, kicked outward at random angle.
  //                      These are also 'bolt' mode but with shorter life.
  //   3. lightningSpark— a rapidly pulsing orb at the hit point (where the
  //                      next chain originates), 'orb-pulse' mode.

  /** Main bolt rendered as a POLYLINE — first sample N+1 jittered vertices
   *  along the A→B segment (endpoints fixed), then each "segment" is a
   *  thin cube whose CENTER is the midpoint of (Vi, Vi+1) and whose YAW
   *  points from Vi to Vi+1. This guarantees segments share endpoints and
   *  read as ONE continuous jagged bolt — fixing the old "broken into
   *  parallel sticks" look caused by per-segment center-offsetting with a
   *  shared yaw.
   *
   *  Layers per call:
   *   • outer purple halo polyline (chunky, flickers)
   *   • inner white core polyline  (thin, brilliant, same path)
   *   • 2 short fork branches off random interior vertices
   */
  lightningArc(x1: number, z1: number, x2: number, z2: number, _color: FxColor = 'purple', y: number = 1.2): void {
    const dx = x2 - x1, dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return;
    const perpX = -dz / length;
    const perpZ = dx / length;

    // 1) sample N+1 vertices along the line. Endpoints are exact; interior
    //    vertices get a perpendicular zigzag + a small vertical arch so the
    //    bolt curves up like a real arc instead of being a flat line.
    const N = 6;                                  // segment count
    const VX = new Array<number>(N + 1);
    const VY = new Array<number>(N + 1);
    const VZ = new Array<number>(N + 1);
    const jitter = Math.min(0.55, length * 0.10); // perpendicular amplitude
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const cx = x1 + dx * t;
      const cz = z1 + dz * t;
      // endpoints: zero offset so the bolt touches the bullet + the target
      if (i === 0 || i === N) {
        VX[i] = cx; VZ[i] = cz; VY[i] = y;
        continue;
      }
      // alternating perpendicular sign with random jiggle — looks chaotic
      const sign = (i % 2 === 0) ? 1 : -1;
      const mag = jitter * (0.6 + Math.random() * 0.7);
      VX[i] = cx + perpX * sign * mag;
      VZ[i] = cz + perpZ * sign * mag;
      // sin arch peaks in the middle (0..1..0)
      const arch = Math.sin(t * Math.PI);
      VY[i] = y + arch * 0.45 + (Math.random() - 0.5) * 0.08;
    }

    // 2) lay down both outer halo + inner core for each Vi→Vi+1 segment.
    // Halo thickness + lifetime come from the lightning-bolt effect asset
    // (asset's scale.x/y = halo thickness, scale.z = length multiplier per
    // segment, spawn.lifetime = bolt fade).
    const la = this.effects['lightning-bolt'];
    const haloThick = la?.scale[0] ?? 0.22;
    const lengthMul = la?.scale[2] ?? 1.06;
    const boltLife = la?.lifetime ?? 0.40;
    for (let i = 0; i < N; i++) {
      const ax = VX[i]!, ay = VY[i]!, az = VZ[i]!;
      const bx = VX[i + 1]!, by = VY[i + 1]!, bz = VZ[i + 1]!;
      const ex = bx - ax, ey = by - ay, ez = bz - az;
      const segLen = Math.hypot(ex, ey, ez);
      if (segLen < 0.001) continue;
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      const mz = (az + bz) * 0.5;
      // yaw of THIS segment (atan2 of horizontal projection)
      const segYaw = Math.atan2(ex, ez);
      // T3 — outer halo upgraded to a custom shader material (cow_survivor::
      // lightning) that runs noise+flicker per fragment, fed by global
      // elapsed time. Falls back to the 'purple' standard material when the
      // shader couldn't register (no GPU / dawn-node smoke path).
      this.addParticle('cube',
        mx, my, mz,
        haloThick, haloThick, segLen * lengthMul,
        'purple',
        0, 0, 0, 0,
        boltLife, 'bolt', segYaw,
        this.lightningMat ?? undefined);
      // inner core — thin brilliant white (kept on standard emissive so the
      // bolt always has a SOLID center even when the noisy halo dims).
      this.addParticle('cube',
        mx, my, mz,
        haloThick * 0.4, haloThick * 0.4, segLen * lengthMul,
        'white',
        0, 0, 0, 0,
        boltLife, 'bolt', segYaw);
    }

    // 3) two short fork arcs branching off random INTERIOR vertices,
    //    kicked roughly perpendicular at a random angle. Each fork is
    //    rendered the same way (vertex pair → midpoint cube) so it stays
    //    visually consistent with the main bolt.
    for (let f = 0; f < 2; f++) {
      const vi = 1 + Math.floor(Math.random() * (N - 1));
      const ax = VX[vi]!, ay = VY[vi]!, az = VZ[vi]!;
      // base direction = perpendicular to the bolt, ±90° with ±40° jitter
      const baseYaw = Math.atan2(dx, dz);
      const side = (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      const forkAng = baseYaw + side + (Math.random() - 0.5) * 0.7;
      const forkLen = 0.55 + Math.random() * 0.7;
      const bx = ax + Math.sin(forkAng) * forkLen;
      const bz = az + Math.cos(forkAng) * forkLen;
      const by = ay + (Math.random() - 0.3) * 0.25;
      const ex = bx - ax, ey = by - ay, ez = bz - az;
      const len = Math.hypot(ex, ey, ez);
      if (len < 0.001) continue;
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      const mz = (az + bz) * 0.5;
      this.addParticle('cube',
        mx, my, mz,
        0.09, 0.09, len,
        'white',
        0, 0, 0, 0,
        0.25, 'bolt', forkAng);
    }
  }

  /** Bright orb at a chain target — pulses out then collapses, plus a
   *  small purple shockwave ring on the ground so each chain hit reads as
   *  a real impact (T3). */
  lightningSpark(x: number, z: number, y: number = 1.0): void {
    // P4: instanced sparks — bright purple-white shower at the strike
    // point. ~14 cube shards radiating outward. The bolt + this burst
    // together replace the old (orb + halo + ground ring) combo, which
    // burned through the 16-slot shockwave pool.
    this.chainSparks(x, z, y);
  }

  // ─── T3 shockwave ───────────────────────────────────────────────────────
  // Spawn an expanding glowing ring on the ground at (x, z). Used by grenade
  // detonations + boss death to give the explosion real "weight" — replaces
  // the previous "12 gold gibs" debris. The ring is a Y-flat cube (a thin
  // disc) with a custom WGSL shader (shockwave.wgsl) that paints a
  // smoothstep ring expanding from radius 0 to 1 over `lifetime` seconds.
  shockwave(
    x: number, z: number,
    color: FxColor = 'gold',
    radius?: number,
    lifetime?: number,
    sharpness?: number,
  ): void {
    if (this.shockwavePool.length === 0) return; // shader unavailable
    // Defaults pulled from the shockwave-ring effect asset when present
    // (lifetime + base radius from spawn.lifetime/scale; sharpness from
    // params.roughness). Callers can still override per-spawn (kill =
    // small ring, boss death = large ring).
    const a = this.effects['shockwave-ring'];
    const defLife = a?.lifetime ?? 0.55;
    const defRadius = a ? a.scale[0] * 0.5 : 4.5;       // scale.x is full diameter
    const defSharp = a?.params.roughness ?? 4.0;
    const r = radius ?? defRadius;
    const lf = lifetime ?? defLife;
    const sh = sharpness ?? defSharp;
    const slot = this.shockwaveCursor % this.shockwavePool.length;
    this.shockwaveCursor += 1;
    const pool = this.shockwavePool[slot]!;

    const palette: Record<FxColor, [number, number, number]> = {
      gold:    [1.0, 0.75, 0.25],
      red:     [1.0, 0.25, 0.20],
      cyan:    [0.45, 0.90, 1.0],
      magenta: [1.0, 0.40, 1.0],
      green:   [0.45, 1.0, 0.40],
      purple:  [0.85, 0.55, 1.0],
      white:   [1.0, 1.0, 1.0],
    };
    const c = palette[color];
    pool.params.baseColor = [c[0], c[1], c[2]];
    pool.params.metallic = 0;          // progress = 0 (just spawned)
    pool.params.roughness = sh;

    const sx = r * 2;
    const sz = r * 2;
    const baseScaleY = a?.scale[1] ?? 0.12;
    const sy = baseScaleY;
    const yPos = a?.yPos ?? 0.06;
    const e = this.ctx.world.spawn(
      { component: Transform, data: { posX: x, posY: yPos, posZ: z, scaleX: sx, scaleY: sy, scaleZ: sz } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [pool.mat] } },
    ).unwrap();
    this.shockwaves.push({ e, slot, age: 0, life: lf, baseSx: sx, baseSy: sy, baseSz: sz });
  }

  // ─── per-frame integration ──────────────────────────────────────────────
  tickDebris(dt: number): void {
    const { world } = this.ctx;
    // T3 — drive the shared lightning material's `time` slot off our wall
    // clock. paramValues is mutated by-reference; the next extract -> snapshot
    // -> record cycle picks it up automatically (custom-shader demo pattern).
    this.elapsed += dt;
    if (this.lightningParams) this.lightningParams.metallic = this.elapsed;
    // P1: tick all particle emitters — integrates motion + repacks the
    // Instances mat4 array + uploads via world.set per emitter.
    if (this.emReady) this.particleSys.tick(dt);
    // E1 — scene-effect materials (torch flame, rune glow) also need
    // wall-clock time fed in to drive their animations.
    for (const slot of Object.values(this.sceneEffectMats)) {
      slot.params.metallic = this.elapsed;
    }
    // E1+ — shared bullet materials (fire-trail, ice-shard) drive their
    // flicker/refraction off the same wall clock; all in-flight bullets
    // of a family share the material (collective shimmer reads as one
    // swarm rather than independent specks).
    for (const p of this.bulletMatParams) p.metallic = this.elapsed;

    // E1+ — fireball lifetime tick (sphere instance per blast).
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const fb = this.fireballs[i]!;
      fb.age += dt;
      const k = Math.min(1, fb.age / fb.life);
      this.fireballPool[fb.slot]!.params.metallic = k;
      if (fb.age >= fb.life) {
        world.despawn(fb.e);
        this.fireballs.splice(i, 1);
      }
    }

    // T3 — shockwave lifetime tick. Each active wave advances its slot's
    // `progress` (metallic param) and is despawned at age >= life.
    for (let si = this.shockwaves.length - 1; si >= 0; si--) {
      const sw = this.shockwaves[si]!;
      sw.age += dt;
      const k = Math.min(1, sw.age / sw.life);
      this.shockwavePool[sw.slot]!.params.metallic = k;
      if (sw.age >= sw.life) {
        world.despawn(sw.e);
        this.shockwaves.splice(si, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age > p.life) {
        world.despawn(p.e);
        this.particles.splice(i, 1);
        continue;
      }
      // motion integration (only for particles with non-zero velocity)
      const hasMotion = p.vx !== 0 || p.vy !== 0 || p.vz !== 0 || p.gy !== 0;
      let nx = 0, ny = 0, nz = 0;
      if (hasMotion) {
        p.vy += p.gy * dt;
        const tr = world.get(p.e, Transform);
        if (!tr.ok) continue;
        nx = tr.value.posX + p.vx * dt;
        ny = tr.value.posY + p.vy * dt;
        nz = tr.value.posZ + p.vz * dt;
        if (ny < 0.05) { ny = 0.05; p.vy *= -0.5; p.vx *= 0.6; p.vz *= 0.6; }
      }
      // animation curve (depends on mode)
      const t = p.age / p.life;     // 0..1
      let sx = p.s0x, sy = p.s0y, sz = p.s0z;
      switch (p.mode) {
        case 'uniform-hold':
          // no scale change
          break;
        case 'uniform-shrink': {
          const k = Math.max(0.05, 1 - t);
          sx = p.s0x * k; sy = sx; sz = sx;
          break;
        }
        case 'bolt': {
          // Flicker scale on the BARS (sx/sy = thickness; sz = length stays).
          // Two-pulse pattern: bright→dim→bright→fade, with a final shrink.
          // pulse: triangle wave over t, scaled by overall fade.
          const flicker = 0.55 + 0.45 * Math.abs(Math.cos(t * Math.PI * 3));
          const fade = Math.max(0, 1 - t * t);  // soft quadratic fade-out
          const thickK = flicker * fade;
          sx = p.s0x * Math.max(0.15, thickK);
          sy = p.s0y * Math.max(0.15, thickK);
          // keep length basically constant until the very end, then fade out
          sz = p.s0z * (t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15);
          if (sz < 0.001) sz = 0.001;
          break;
        }
        case 'orb-pulse': {
          // 0→0.3: expand to 1.4×, 0.3→1: contract toward 0
          let k: number;
          if (t < 0.3) k = 1 + (t / 0.3) * 0.4;
          else k = 1.4 * (1 - (t - 0.3) / 0.7);
          k = Math.max(0.05, k);
          sx = p.s0x * k; sy = p.s0y * k; sz = p.s0z * k;
          break;
        }
      }
      // write Transform — partial set keeps quat from spawn intact
      if (hasMotion) {
        world.set(p.e, Transform, {
          posX: nx, posY: ny, posZ: nz,
          scaleX: sx, scaleY: sy, scaleZ: sz,
        });
      } else {
        world.set(p.e, Transform, {
          scaleX: sx, scaleY: sy, scaleZ: sz,
        });
      }
    }
  }

  /** Trigger a screen shake. New shake replaces if larger. */
  shake(mag: number, sec: number = 0.18): void {
    if (mag > this.shakeMag || this.shakeTime < sec * 0.5) {
      this.shakeMag = mag;
      this.shakeTime = sec;
    }
  }

  /** Per-frame: returns the camera offset (dx, dy, dz) and ticks shake decay. */
  tickShake(dt: number): { dx: number; dy: number; dz: number } {
    if (this.shakeTime <= 0) return { dx: 0, dy: 0, dz: 0 };
    this.shakeTime -= dt;
    const t = Math.max(0, this.shakeTime);
    const m = this.shakeMag * t;
    return {
      dx: (Math.random() - 0.5) * m,
      dy: (Math.random() - 0.5) * m,
      dz: (Math.random() - 0.5) * m,
    };
  }
}
