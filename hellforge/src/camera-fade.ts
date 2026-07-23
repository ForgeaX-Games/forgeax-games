/**
 * Foreground blocker prop fade — pure helpers + driver for ARPG visibility.
 *
 * When spring-arm contraction cannot keep the player readable, fade authored
 * foreground blocker props (whole prop). Material alpha is applied via a
 * caller-supplied `setAlpha` hook so the module stays free of WebGPU / engine
 * coupling (and of inventing engine material APIs).
 *
 * Screen/XZ overlap is tested as XZ AABB overlap (unit-testable without a
 * GPU). Occlusion after contraction is approximated by a ray (eye → player)
 * vs the blocker extruded AABB.
 */

import { rayAabbHitT, type ProbeBlocker } from './camera-probe';

export type FadeBlockerId = string;

/** XZ axis-aligned rectangle (world metres). */
export type FadeAabb2 = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type FadeBlockerEntry = {
  readonly blockerId: FadeBlockerId;
  /** Scene entity local ids / handles registered for this blocker prop. */
  readonly entityLocalIds: readonly number[];
  readonly aabb: FadeAabb2;
  /** Extruded world-Y height for occlusion ray (default 3.2). */
  readonly height: number;
};

export type NamedEntity = {
  readonly localId: number;
  readonly name: string;
};

/** Weight ramp toward transparent while occluding (1/s) — snappy for readability. */
export const FADE_IN_RATE = 10;
/** Weight ramp toward opaque when clear (1/s). */
export const FADE_OUT_RATE = 5;
/**
 * Minimum applied scale/alpha at full fade weight. Near-zero so scale-Y hide
 * actually clears the silhouette (engine cannot do real material alpha yet).
 */
export const FADE_MIN_ALPHA = 0.02;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Overlap area of `inner` relative to its own area, clamped to [0, 1]. */
export function xzAabbOverlapAmount(a: FadeAabb2, b: FadeAabb2): number {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minZ = Math.max(a.minZ, b.minZ);
  const maxZ = Math.min(a.maxZ, b.maxZ);
  const ow = maxX - minX;
  const od = maxZ - minZ;
  if (ow <= 0 || od <= 0) return 0;
  const aArea = Math.max(1e-8, (a.maxX - a.minX) * (a.maxZ - a.minZ));
  return clamp01((ow * od) / aArea);
}

/**
 * Smooth fade weight in [0, 1]. `overlap > 0` ramps in; otherwise ramps out.
 * No hard toggles — rate-limited by FADE_IN_RATE / FADE_OUT_RATE.
 */
export function fadeWeight(overlap: number, dt: number, prev: number): number {
  const target = overlap > 0 ? 1 : 0;
  if (dt <= 0) return clamp01(prev);
  if (target > prev) return clamp01(prev + FADE_IN_RATE * dt);
  if (target < prev) return clamp01(prev - FADE_OUT_RATE * dt);
  return clamp01(prev);
}

/** Map material fade weight → display alpha (1 = opaque). */
export function fadeWeightToAlpha(weight: number): number {
  const w = clamp01(weight);
  return 1 - w * (1 - FADE_MIN_ALPHA);
}

/** Player footprint AABB on XZ (capsule approximated as a square). */
export function playerCapsuleAabb(px: number, pz: number, radius: number): FadeAabb2 {
  return {
    minX: px - radius,
    maxX: px + radius,
    minZ: pz - radius,
    maxZ: pz + radius,
  };
}

/**
 * Map a pack entity Name to a blocker id when the name is a prop tile for that
 * blocker (`Hut1_Roof__t0` → `Hut1`). Skips torch/NPC helpers that merely
 * contain the label as a substring prefix of another token.
 */
export function blockerIdFromEntityName(
  name: string,
  blockerIds: readonly FadeBlockerId[],
): FadeBlockerId | null {
  for (const id of blockerIds) {
    if (name === id) return id;
    if (name.startsWith(`${id}_`)) return id;
  }
  return null;
}

/** Hut / mountain / quality-room occluder labels we fade by default. */
export function isCampForegroundFadeLabel(label: string): boolean {
  return /^(Hut|Mountain|SlagRidge|Doorframe|Antechamber_(wall|corner|pillar))/i.test(
    label,
  );
}

export function buildCampFadeRegistry(
  blockers: readonly ProbeBlocker[],
  namedEntities: readonly NamedEntity[],
): Map<FadeBlockerId, FadeBlockerEntry> {
  const aabbById = new Map<FadeBlockerId, { aabb: FadeAabb2; height: number }>();
  for (const b of blockers) {
    if (b.type !== 'aabb' || !b.label) continue;
    if (!isCampForegroundFadeLabel(b.label)) continue;
    const minX = Math.min(b.min[0], b.max[0]);
    const maxX = Math.max(b.min[0], b.max[0]);
    const minZ = Math.min(b.min[1], b.max[1]);
    const maxZ = Math.max(b.min[1], b.max[1]);
    aabbById.set(b.label, {
      aabb: { minX, maxX, minZ, maxZ },
      height: b.probeHeight ?? 3.2,
    });
  }
  const blockerIds = [...aabbById.keys()];
  const entitiesById = new Map<FadeBlockerId, number[]>();
  for (const e of namedEntities) {
    const id = blockerIdFromEntityName(e.name, blockerIds);
    if (!id) continue;
    const list = entitiesById.get(id);
    if (list) list.push(e.localId);
    else entitiesById.set(id, [e.localId]);
  }
  const out = new Map<FadeBlockerId, FadeBlockerEntry>();
  for (const [id, meta] of aabbById) {
    out.set(id, {
      blockerId: id,
      entityLocalIds: entitiesById.get(id) ?? [],
      aabb: meta.aabb,
      height: meta.height,
    });
  }
  return out;
}

export type FadeNeedInput = {
  readonly eye: readonly [number, number, number];
  readonly playerPos: readonly [number, number, number];
};

/**
 * Blockers whose extruded AABB still intersects the eye→player segment after
 * spring-arm contraction. Player need NOT stand inside the blocker footprint —
 * camera parked behind a hut with the player outside is the common case.
 */
export function selectBlockersNeedingFade(
  entries: readonly FadeBlockerEntry[],
  input: FadeNeedInput,
): Set<FadeBlockerId> {
  const needs = new Set<FadeBlockerId>();
  const dx = input.playerPos[0]! - input.eye[0]!;
  const dy = input.playerPos[1]! - input.eye[1]!;
  const dz = input.playerPos[2]! - input.eye[2]!;
  for (const e of entries) {
    const box = {
      minX: e.aabb.minX,
      maxX: e.aabb.maxX,
      minY: 0,
      maxY: e.height,
      minZ: e.aabb.minZ,
      maxZ: e.aabb.maxZ,
    };
    const t = rayAabbHitT(
      input.eye[0]!, input.eye[1]!, input.eye[2]!,
      dx, dy, dz,
      box,
    );
    if (t !== null) needs.add(e.blockerId);
  }
  return needs;
}

export type FadeDriver = {
  update(needsFade: ReadonlySet<FadeBlockerId>, dt: number): void;
  weight(id: FadeBlockerId): number;
};

/**
 * Per-blocker weight state → alpha via `setAlpha(id, alpha)` where alpha=1 is
 * fully opaque. Callers own material instance / scale-Y apply.
 */
export function createFadeDriver(opts: {
  readonly blockerIds: readonly FadeBlockerId[];
  readonly setAlpha: (blockerId: FadeBlockerId, alpha: number) => void;
}): FadeDriver {
  const weights = new Map<FadeBlockerId, number>();
  for (const id of opts.blockerIds) weights.set(id, 0);

  return {
    update(needsFade, dt) {
      for (const id of opts.blockerIds) {
        const prev = weights.get(id) ?? 0;
        const next = fadeWeight(needsFade.has(id) ? 1 : 0, dt, prev);
        weights.set(id, next);
        opts.setAlpha(id, fadeWeightToAlpha(next));
      }
    },
    weight(id) {
      return weights.get(id) ?? 0;
    },
  };
}
