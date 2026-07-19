/**
 * MarsCraft -> forgeax-engine — splash / area resolver + batch-hit tracker (M6)
 * =============================================================================
 * Port of `web/systems/SplashResolver.ts` + `web/systems/BatchHitTracker.ts`.
 *
 * `resolveArea` finds enemy targets inside an AoE shape (circle / cone / line)
 * with per-target falloff, edge-to-edge (subtracting target radius). The geometry
 * is 1:1 with the source; the only adaptation is that candidates come from a
 * pre-built `CombatTarget[]` snapshot (see combat-registry.ts) rather than a live
 * `world.query` / SpatialGrid (forgeax has no ad-hoc World query). Filter / sort /
 * limit are ported faithfully (sort/filter are used by the M9 missile-barrage
 * path; circle/cone/line all carry them).
 *
 * `resolveAreaDamage` glues `resolveArea` (find) + `resolveDamage` (apply) so all
 * three combat call sites (instant splash, projectile splash, future ability AoE)
 * share one loop — exactly as the source merged them.
 *
 * `BatchHitTracker` tracks per-volley per-target hit counts for decaying-damage
 * salvos (Thor missile barrage, M9). Ported verbatim.
 */

import { type World } from '@forgeax/engine-ecs';
import { resolveDamage } from './damage-resolver';
import type { CombatTarget } from './combat-registry';
import { isHostileTarget } from './combat-registry';
import type { SplashShape, DamageType } from '../data/weapons';
import type { CombatTypeCode } from '../components';

// ── BatchHitTracker (verbatim port) ──────────────────────────────────────────

/**
 * Tracks, per volley, how many times each target was hit — so a salvo of N
 * projectiles can apply a decaying-damage table on the same target. One instance
 * per volley; shared by reference across that volley's projectiles.
 */
export class BatchHitTracker {
  private _hitCounts = new Map<number, number>();

  /** Record a hit; return this target's 0-based hit index for the volley. */
  recordHit(target: number): number {
    const count = this._hitCounts.get(target) ?? 0;
    this._hitCounts.set(target, count + 1);
    return count;
  }

  /** Damage multiplier for a hit index from a falloff table (clamped to last). */
  static getFalloff(hitIndex: number, falloffTable: readonly number[]): number {
    if (falloffTable.length === 0) return 1.0;
    return falloffTable[Math.min(hitIndex, falloffTable.length - 1)];
  }
}

// ── Area resolver ────────────────────────────────────────────────────────────

export interface AreaHit {
  entity: import('@forgeax/engine-ecs').EntityHandle;
  /** Falloff factor 0..1 (1 = full damage). */
  falloff: number;
  /** Edge distance to center. */
  distance: number;
}

export interface AreaParams {
  shape: SplashShape;
  /** circle/cone R, line L (world units). */
  radius: number;
  /** Falloff steps inner->outer; empty -> [1.0, 0.5, 0.25]. */
  falloff?: number[];
  /** cone angle (degrees). */
  angle?: number;
  /** line width. */
  width?: number;
  /** cone/line direction source X (attacker). */
  directionX?: number;
  /** cone/line direction source Z (attacker). */
  directionZ?: number;
}

const DEFAULT_FALLOFF = [1.0, 0.5, 0.25];

/** Falloff factor for a 0..1 ratio over a falloff step table. */
function falloffFactor(ratio: number, falloff: number[]): number {
  const steps = falloff.length;
  if (steps === 0) return 0;
  const idx = Math.min(Math.floor(ratio * steps), steps - 1);
  return falloff[idx];
}

/**
 * Find all hostile targets inside the AoE shape, with per-target falloff.
 *
 * @param candidates per-frame snapshot (combat-registry.ts)
 * @param centerX/centerZ AoE center
 * @param sourcePlayerId attacker player (excludes own + neutral)
 * @param params shape parameters
 * @param excludeEntity optional already-hit primary target (raw entity id)
 */
export function resolveArea(
  candidates: readonly CombatTarget[],
  centerX: number,
  centerZ: number,
  sourcePlayerId: number,
  params: AreaParams,
  excludeEntity?: number,
): AreaHit[] {
  if (params.radius <= 0) return [];
  const falloff = (params.falloff && params.falloff.length > 0) ? params.falloff : DEFAULT_FALLOFF;
  const results: AreaHit[] = [];

  switch (params.shape) {
    case 'circle':
      resolveCircle(candidates, centerX, centerZ, params.radius, falloff, sourcePlayerId, excludeEntity, results);
      break;
    case 'cone':
      resolveCone(
        candidates, params.directionX ?? centerX, params.directionZ ?? centerZ,
        centerX, centerZ, params.radius, params.angle ?? 90, falloff,
        sourcePlayerId, excludeEntity, results,
      );
      break;
    case 'line':
      resolveLine(
        candidates, params.directionX ?? centerX, params.directionZ ?? centerZ,
        centerX, centerZ, params.radius, params.width ?? 1, falloff,
        sourcePlayerId, excludeEntity, results,
      );
      break;
  }
  return results;
}

function valid(t: CombatTarget, sourcePlayerId: number, excludeEntity?: number): boolean {
  if (excludeEntity !== undefined && (t.entity as unknown as number) === excludeEntity) return false;
  return isHostileTarget(t, sourcePlayerId);
}

function resolveCircle(
  cands: readonly CombatTarget[],
  cx: number, cz: number, radius: number, falloff: number[],
  sourcePlayerId: number, excludeEntity: number | undefined, results: AreaHit[],
): void {
  for (const t of cands) {
    if (!valid(t, sourcePlayerId, excludeEntity)) continue;
    const dx = t.x - cx;
    const dz = t.z - cz;
    const centerDist = Math.sqrt(dx * dx + dz * dz);
    const edgeDist = Math.max(0, centerDist - t.radius);
    if (edgeDist > radius) continue;
    const factor = falloffFactor(edgeDist / radius, falloff);
    if (factor <= 0) continue;
    results.push({ entity: t.entity, falloff: factor, distance: edgeDist });
  }
}

function resolveCone(
  cands: readonly CombatTarget[],
  ax: number, az: number, tx: number, tz: number,
  radius: number, angleDeg: number, falloff: number[],
  sourcePlayerId: number, excludeEntity: number | undefined, results: AreaHit[],
): void {
  const halfAngle = (angleDeg / 2) * Math.PI / 180;
  const dirX = tx - ax;
  const dirZ = tz - az;
  const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (dirLen < 0.001) return;
  const ndx = dirX / dirLen;
  const ndz = dirZ / dirLen;

  for (const t of cands) {
    if (!valid(t, sourcePlayerId, excludeEntity)) continue;
    const ex = t.x - ax;
    const ez = t.z - az;
    const centerDist = Math.sqrt(ex * ex + ez * ez);
    const edgeDist = Math.max(0, centerDist - t.radius);
    if (edgeDist > radius) continue;

    if (centerDist < 0.001) {
      const factor = falloffFactor(0, falloff);
      if (factor > 0) results.push({ entity: t.entity, falloff: factor, distance: 0 });
      continue;
    }

    const dot = (ex * ndx + ez * ndz) / centerDist;
    const centerAngle = Math.acos(Math.min(1, Math.max(-1, dot)));
    const angularRadius = t.radius < centerDist ? Math.asin(t.radius / centerDist) : Math.PI * 0.5;
    if (centerAngle - angularRadius > halfAngle) continue;

    const factor = falloffFactor(edgeDist / radius, falloff);
    if (factor <= 0) continue;
    results.push({ entity: t.entity, falloff: factor, distance: edgeDist });
  }
}

function resolveLine(
  cands: readonly CombatTarget[],
  ax: number, az: number, tx: number, tz: number,
  length: number, width: number, falloff: number[],
  sourcePlayerId: number, excludeEntity: number | undefined, results: AreaHit[],
): void {
  let dirX = tx - ax;
  let dirZ = tz - az;
  const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (dirLen < 0.001) return;
  dirX /= dirLen;
  dirZ /= dirLen;
  const halfWidth = width / 2;

  for (const t of cands) {
    if (!valid(t, sourcePlayerId, excludeEntity)) continue;
    const ex = t.x - ax;
    const ez = t.z - az;
    const proj = ex * dirX + ez * dirZ;
    if (proj < -t.radius || proj > length + t.radius) continue;
    const perpDist = Math.abs(ex * (-dirZ) + ez * dirX);
    const edgePerpDist = Math.max(0, perpDist - t.radius);
    if (edgePerpDist > halfWidth) continue;
    const lateralRatio = halfWidth > 0 ? edgePerpDist / halfWidth : 0;
    const factor = falloffFactor(lateralRatio, falloff);
    if (factor <= 0) continue;
    results.push({ entity: t.entity, falloff: factor, distance: edgePerpDist });
  }
}

// ── Unified area damage (find + apply) ───────────────────────────────────────

export interface AreaDamageResult {
  hitCount: number;
  totalDamage: number;
  hits: AreaHit[];
}

/**
 * Find hostiles in the AoE then apply `baseDamage * falloff` to each through the
 * unified damage pipeline. Mirrors source `resolveAreaDamage`.
 */
export function resolveAreaDamage(
  world: World,
  candidates: readonly CombatTarget[],
  centerX: number,
  centerZ: number,
  sourcePlayerId: number,
  areaParams: AreaParams,
  baseDamage: number,
  damageType: DamageType,
  gameTime: number,
  attackerY?: number,
  attackerCombatType?: CombatTypeCode,
  excludeEntity?: number,
): AreaDamageResult {
  const hits = resolveArea(candidates, centerX, centerZ, sourcePlayerId, areaParams, excludeEntity);
  let totalDamage = 0;
  for (const hit of hits) {
    const r = resolveDamage(
      world, hit.entity,
      baseDamage * hit.falloff, 1, damageType,
      gameTime, attackerY, 0, 0, attackerCombatType,
    );
    totalDamage += r.actualDamage;
  }
  return { hitCount: hits.length, totalDamage, hits };
}
