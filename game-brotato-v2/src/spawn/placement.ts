import { SPAWN, type SpawnPattern } from '../config/spawn.ts';
import type { Rng } from './rng.ts';

export interface PlacementContext {
  readonly playerX: number;
  readonly playerZ: number;
  readonly playerFacing?: number;
  readonly view: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly markerXs: readonly number[];
  readonly markerZs: readonly number[];
  readonly enemyXs: readonly number[];
  readonly enemyZs: readonly number[];
}

export interface PlacementResult {
  readonly x: number;
  readonly z: number;
  /** 0 = strict; 1/2/3 = progressively relaxed; 4 = deterministic fallback. */
  readonly relaxLevel: number;
}

interface Candidate {
  readonly x: number;
  readonly z: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function distanceSquared(leftX: number, leftZ: number, rightX: number, rightZ: number): number {
  const dx = leftX - rightX;
  const dz = leftZ - rightZ;
  return dx * dx + dz * dz;
}

function insideBounds(candidate: Candidate, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  return candidate.x >= minX && candidate.x <= maxX && candidate.z >= minZ && candidate.z <= maxZ;
}

function candidateInRing(rng: Rng, centerX: number, centerZ: number, minRadius: number, maxRadius: number): Candidate {
  const angle = rng.next() * Math.PI * 2;
  const radius = minRadius + rng.next() * Math.max(0, maxRadius - minRadius);
  return { x: centerX + Math.sin(angle) * radius, z: centerZ + Math.cos(angle) * radius };
}

function candidateInGroup(rng: Rng, anchor: Candidate): Candidate {
  const angle = rng.next() * Math.PI * 2;
  const radius = Math.sqrt(rng.next()) * SPAWN.placement.groupRadius;
  return { x: anchor.x + Math.sin(angle) * radius, z: anchor.z + Math.cos(angle) * radius };
}

function candidateOnEdge(rng: Rng, view: PlacementContext['view']): Candidate {
  const minX = view.minX + SPAWN.placement.viewInset;
  const maxX = view.maxX - SPAWN.placement.viewInset;
  const minZ = view.minZ + SPAWN.placement.viewInset;
  const maxZ = view.maxZ - SPAWN.placement.viewInset;
  switch (Math.floor(rng.next() * 4)) {
    case 0: return { x: minX, z: minZ + rng.next() * Math.max(0, maxZ - minZ) };
    case 1: return { x: maxX, z: minZ + rng.next() * Math.max(0, maxZ - minZ) };
    case 2: return { x: minX + rng.next() * Math.max(0, maxX - minX), z: minZ };
    default: return { x: minX + rng.next() * Math.max(0, maxX - minX), z: maxZ };
  }
}

function makeCandidate(
  rng: Rng,
  context: PlacementContext,
  pattern: SpawnPattern,
  anchor: Candidate | null,
  minRadius: number,
  maxRadius: number,
): Candidate {
  if (pattern === 'edge') return candidateOnEdge(rng, context.view);
  if (pattern === 'group' && anchor !== null) return candidateInGroup(rng, anchor);
  return candidateInRing(rng, context.playerX, context.playerZ, minRadius, maxRadius);
}

function validCandidate(
  candidate: Candidate,
  context: PlacementContext,
  pattern: SpawnPattern,
  minRadius: number,
  maxRadius: number,
  level: number,
): boolean {
  const arenaLimit = SPAWN.placement.arenaHalfExtent - SPAWN.placement.arenaInset;
  if (!insideBounds(candidate, -arenaLimit, arenaLimit, -arenaLimit, arenaLimit)) return false;
  const viewMinX = context.view.minX + SPAWN.placement.viewInset;
  const viewMaxX = context.view.maxX - SPAWN.placement.viewInset;
  const viewMinZ = context.view.minZ + SPAWN.placement.viewInset;
  const viewMaxZ = context.view.maxZ - SPAWN.placement.viewInset;
  if (level < 3 && !insideBounds(candidate, viewMinX, viewMaxX, viewMinZ, viewMaxZ)) return false;

  const playerDistance = Math.sqrt(distanceSquared(candidate.x, candidate.z, context.playerX, context.playerZ));
  if (playerDistance < minRadius) return false;
  if (pattern !== 'edge' && playerDistance > maxRadius) return false;

  const markerDistance = pattern === 'apart'
    ? SPAWN.placement.apartSeparation
    : SPAWN.placement.markerSeparation;
  if (level < 2) {
    for (let index = 0; index < context.markerXs.length; index += 1) {
      if (distanceSquared(candidate.x, candidate.z, context.markerXs[index] ?? 0, context.markerZs[index] ?? 0) < markerDistance * markerDistance) return false;
    }
  }
  if (level < 1) {
    for (let index = 0; index < context.enemyXs.length; index += 1) {
      if (distanceSquared(candidate.x, candidate.z, context.enemyXs[index] ?? 0, context.enemyZs[index] ?? 0) < SPAWN.placement.enemySeparation ** 2) return false;
    }
  }
  return true;
}

function fallbackCandidate(context: PlacementContext): Candidate {
  const facing = finite(context.playerFacing ?? 0, 0);
  const angle = facing + Math.PI;
  const distance = SPAWN.placement.maxRadius;
  const arenaLimit = SPAWN.placement.arenaHalfExtent - SPAWN.placement.arenaInset;
  return {
    x: clamp(finite(context.playerX, 0) + Math.sin(angle) * distance, -arenaLimit, arenaLimit),
    z: clamp(finite(context.playerZ, 0) + Math.cos(angle) * distance, -arenaLimit, arenaLimit),
  };
}

/** Deterministic rejection sampling with the documented relaxation ladder. */
export function samplePlacement(
  rng: Rng,
  context: PlacementContext,
  pattern: SpawnPattern,
  anchor: { readonly x: number; readonly z: number } | null,
): PlacementResult {
  const safeContext: PlacementContext = {
    ...context,
    playerX: finite(context.playerX, 0),
    playerZ: finite(context.playerZ, 0),
  };
  const groupAnchor = anchor === null ? null : { x: finite(anchor.x, 0), z: finite(anchor.z, 0) };
  for (let level = 0; level <= 3; level += 1) {
    const minRadius = level >= 2 ? SPAWN.placement.minRadiusRelaxed : SPAWN.placement.minRadius;
    const maxRadius = SPAWN.placement.maxRadius;
    for (let attempt = 0; attempt < SPAWN.placement.attemptsPerLevel; attempt += 1) {
      const candidate = makeCandidate(rng, safeContext, pattern, groupAnchor, minRadius, maxRadius);
      if (validCandidate(candidate, safeContext, pattern, minRadius, maxRadius, level)) {
        return { x: candidate.x, z: candidate.z, relaxLevel: level };
      }
    }
  }
  const fallback = fallbackCandidate(safeContext);
  return { x: fallback.x, z: fallback.z, relaxLevel: 4 };
}
