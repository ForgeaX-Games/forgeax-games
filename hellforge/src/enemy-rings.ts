// Enemy under-rings (N4 G2-A) — persistent pale-violet ground markers under
// living monsters, the low-risk carrier for enemy readability in combat.
//
// Readability contract of the N4 lighting pass: the camp stays cool and dim —
// we never raise ambient light; monsters read via their own emissive parts
// plus this calm marker ring at their feet. Uses a dedicated sharp
// `enemy_marker` sheet (thin stroke + soft halo) tinted pale violet, with a
// slow breath pulse on the sprite path — not the warm ragged nova `ring`.
//
// Pooling: one persistent decal per living monster, capped at MAX_ENEMY_RINGS
// (same budget class as loot beams). Exhaustion skips silently — no crash,
// no stealing from other FX systems.
//
// Zone-agnostic (camp + den share it) and it touches no lighting/exposure/
// material knobs. Pure + injectable: the only dependency is a minimal
// persistent-decal surface (real: FxSystem.persistentDecalSurface()).

import type { MonsterKind } from './monsters';
import type { SpriteHandle, SpriteSpawnOpts } from './fx/sprite';

/** Opaque live under-ring token (0 is never a live handle — sprite.ts rule). */
export type EnemyRingHandle = SpriteHandle;

/**
 * Minimal persistent-decal surface the pool drives. Real implementation:
 * FxSystem.persistentDecalSurface() (fx.ts) — a narrowed view of SpriteSystem.
 */
export interface EnemyRingDecalSurface {
  spawnPersistentDecal(x: number, y: number, z: number, opts: SpriteSpawnOpts): SpriteHandle;
  move(h: SpriteHandle, x: number, y: number, z: number): void;
  release(h: SpriteHandle): void;
}

/** Per-kind ring look. `radius` is the ground radius the stroke sits on. */
export interface EnemyRingSpec {
  /** HDR pale-violet tint — B-hot glow, readable on cool camp lighting. */
  readonly tint: readonly [number, number, number, number];
  readonly radius: number;
}

/** Ring pool cap — same budget class as loot beams (fx.ts MAX_LOOT_BEAMS). */
export const MAX_ENEMY_RINGS = 24;

/**
 * Ground-decal layer height — sits just ABOVE the fx main decal layer
 * (GROUND_DECAL_Y = 0.045, shared by telegraph rings / scorch / shock rings):
 * co-planar additive quads under depthCompare 'less' would carve holes into
 * each other where a telegraph overlaps an under-ring.
 */
/** Sit clearly above camp mesh + telegraph layer (0.045) to avoid z-fight bury. */
export const ENEMY_RING_DECAL_Y = 0.085;

/**
 * Peak stroke of `enemy_marker` / `ring` sheets sits at 0.78·half → world
 * radius ≈ 0.39·size (same convention as novaTelegraph).
 */
export const ENEMY_RING_STROKE_FRAC = 0.39;

/**
 * Per-kind table. Pale violet glow; tight radii so the marker hugs the feet
 * instead of reading as a soft blob. Boss biggest/hottest.
 */
export const ENEMY_RING_SPECS: Record<MonsterKind, EnemyRingSpec> = {
  imp:         { tint: [0.78, 0.48, 1.45, 1], radius: 0.52 },
  ashwalker:   { tint: [0.74, 0.46, 1.40, 1], radius: 0.62 },
  charred:     { tint: [0.76, 0.47, 1.42, 1], radius: 0.58 },
  flamecaller: { tint: [0.82, 0.50, 1.52, 1], radius: 0.62 },
  slaglord:    { tint: [0.95, 0.55, 1.72, 1], radius: 1.20 },
};

/** Live under-ring pool — handles are opaque; logic stays pure/injectable. */
export interface EnemyRings {
  /** Spawn a ring under a new monster; null when the pool is exhausted. */
  acquire(kind: MonsterKind, x: number, z: number): EnemyRingHandle | null;
  /** Keep the ring under the monster (knockback + chase both land here). */
  follow(h: EnemyRingHandle, x: number, z: number): void;
  /** Exactly-once cleanup (death / despawn); unknown handle: silent no-op. */
  release(h: EnemyRingHandle): void;
  readonly activeCount: number;
}

export function createEnemyRings(deps: EnemyRingDecalSurface): EnemyRings {
  const active = new Set<EnemyRingHandle>();
  return {
    acquire(kind, x, z) {
      if (active.size >= MAX_ENEMY_RINGS) return null;
      const spec = ENEMY_RING_SPECS[kind];
      const h = deps.spawnPersistentDecal(x, ENEMY_RING_DECAL_Y, z, {
        pos: [x, ENEMY_RING_DECAL_Y, z],
        sheet: 'enemy_marker',
        blend: 'additive',
        size: spec.radius / ENEMY_RING_STROKE_FRAC,
        tint: spec.tint,
        loop: true,
        pulse: 'breath',
      });
      if (!h) return null;
      active.add(h);
      return h;
    },
    follow(h, x, z) {
      if (!active.has(h)) return;
      deps.move(h, x, ENEMY_RING_DECAL_Y, z);
    },
    release(h) {
      if (!active.has(h)) return;
      active.delete(h);
      deps.release(h);
    },
    get activeCount() {
      return active.size;
    },
  };
}
