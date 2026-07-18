/**
 * MarsCraft -> forgeax-engine — resource fields (Milestone M7)
 * =============================================================================
 * Spawns the harvestable resource entities the economy operates on:
 *   - one entity per `map.minerals[]` — a `Mineral` component + a blue crystal
 *     cluster model (a few tinted box/cone shards built from the cached unit
 *     primitives, approach (A) child-entity model like units);
 *   - one entity per `map.geysers[]` — a `Geyser` component + a green/yellow
 *     vespene geyser model (a squat base + emissive gas plume cones).
 *
 * Each is a parent entity carrying the engine `Transform` (placed on the terrain
 * via `heightAt`) + a `Faction` (neutral) + a `Selectable` tag so the M4 picker
 * can target it for a `harvest` order, and child model parts via `ChildOf`.
 *
 * If `map.minerals` / `map.geysers` are empty (a blueprint that didn't run
 * `generateResources`), they are derived from `map.bases`/`baseLocations` using
 * the SAME arc layout as `shared/mapgen` `mineralArc` so the field still appears
 * around each base. (For the red-canyon preset the map already carries them.)
 */

import {
  Transform, MeshFilter, MeshRenderer, ChildOf, quat,
  type Handle, type MaterialAsset,
} from '@forgeax/engine-runtime';
import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Mineral, Geyser, Faction, Selectable,
  geyserCurrentWorkers, geyserAssignedWorkers,
  PLAYER_ID, RACE,
} from '../components';
import type { UnitPrimitives, TintFn } from './unit-models';

// ── resource placement geometry (mirrors shared/mapgen resources.ts) ──────────

export interface ResourcePoint { x: number; z: number; amount: number; }

/** Map shape the spawner reads (subset of MapConfig). */
export interface ResourceMap {
  minerals?: ResourcePoint[];
  geysers?: ResourcePoint[];
  baseLocations?: { x: number; z: number }[];
  bases?: Array<{
    ccX: number; ccZ: number;
    mineralArcX: number; mineralArcZ: number;
    mineralCount: number; mineralRadius: number; mineralAmount: number;
    geysers: Array<{ x: number; z: number; amount: number }>;
  }>;
}

/** Default amounts when deriving from baseLocations alone (no `bases` table). */
const DEFAULT_MINERAL_AMOUNT = 1500;
const DEFAULT_GEYSER_AMOUNT = 2500;
const DEFAULT_MINERAL_COUNT = 8;
const DEFAULT_MINERAL_RADIUS = 5;

/**
 * Source `mineralArc`: minerals along an arc around (arcX,arcZ), convex face
 * toward (ccX,ccZ). Ported verbatim so a derived field matches the map preset.
 */
function mineralArc(
  ccX: number, ccZ: number, arcX: number, arcZ: number,
  count: number, radius: number, amount: number, spread = Math.PI * 0.52,
): ResourcePoint[] {
  const out: ResourcePoint[] = [];
  const a0 = Math.atan2(arcX - ccX, arcZ - ccZ);
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const a = a0 - spread / 2 + t * spread;
    out.push({ x: arcX + Math.sin(a) * radius, z: arcZ + Math.cos(a) * radius, amount });
  }
  return out;
}

/** Resolve the mineral / geyser point lists, deriving from bases when empty. */
function resolveResourcePoints(map: ResourceMap): { minerals: ResourcePoint[]; geysers: ResourcePoint[] } {
  let minerals = map.minerals ?? [];
  let geysers = map.geysers ?? [];

  if (minerals.length === 0 && geysers.length === 0) {
    const dm: ResourcePoint[] = [];
    const dg: ResourcePoint[] = [];
    if (map.bases && map.bases.length > 0) {
      for (const b of map.bases) {
        dm.push(...mineralArc(b.ccX, b.ccZ, b.mineralArcX, b.mineralArcZ, b.mineralCount, b.mineralRadius, b.mineralAmount));
        for (const g of b.geysers) dg.push({ x: g.x, z: g.z, amount: g.amount });
      }
    } else if (map.baseLocations && map.baseLocations.length > 0) {
      // No bases table: derive an arc just outside each base location.
      for (const loc of map.baseLocations) {
        const arcZ = loc.z - 6; // arc south of the base, convex toward it
        dm.push(...mineralArc(loc.x, loc.z, loc.x, arcZ, DEFAULT_MINERAL_COUNT, DEFAULT_MINERAL_RADIUS, DEFAULT_MINERAL_AMOUNT));
        dg.push({ x: loc.x + 5, z: loc.z + 3, amount: DEFAULT_GEYSER_AMOUNT });
      }
    }
    minerals = dm;
    geysers = dg;
  }

  return { minerals, geysers };
}

// ── model part helper (approach A child entities, like unit-models) ───────────

const _q = quat.create();

interface Part {
  prim: Handle<'MeshAsset', 'shared'>;
  color: [number, number, number];
  pos: [number, number, number];
  scale: [number, number, number];
  rot?: [number, number, number];
  metallic?: number;
  roughness?: number;
}

function spawnParts(world: World, parent: EntityHandle, parts: Part[], tint: TintFn): void {
  for (const p of parts) {
    const mat = tint(p.color, { metallic: p.metallic ?? 0.1, roughness: p.roughness ?? 0.5 });
    if (p.rot) quat.fromEuler(_q, p.rot[0], p.rot[1], p.rot[2], 'XYZ');
    world.spawn(
      {
        component: Transform,
        data: {
          pos: [p.pos[0], p.pos[1], p.pos[2]],
          quat: p.rot ? [_q[0], _q[1], _q[2], _q[3]] : [0, 0, 0, 1],
          scale: [p.scale[0], p.scale[1], p.scale[2]],
        },
      },
      { component: MeshFilter, data: { assetHandle: p.prim } },
      { component: MeshRenderer, data: { materials: [mat] } },
      { component: ChildOf, data: { parent } },
    );
  }
}

/** Blue crystal cluster — a handful of angled box shards + a tall cone spire. */
function mineralParts(prims: UnitPrimitives): Part[] {
  const crystal: [number, number, number] = [0.30, 0.62, 0.95];
  const crystalDeep: [number, number, number] = [0.16, 0.40, 0.78];
  const opts = { metallic: 0.0, roughness: 0.25 };
  const shard = (x: number, z: number, h: number, rx: number, rz: number, deep = false): Part => ({
    prim: prims.box, color: deep ? crystalDeep : crystal,
    pos: [x, h / 2, z], scale: [0.45, h, 0.45], rot: [rx, 0, rz], ...opts,
  });
  return [
    shard(0, 0, 1.7, 0.0, 0.0),
    shard(0.6, 0.2, 1.2, 0.0, 0.32, true),
    shard(-0.55, -0.15, 1.3, 0.0, -0.28),
    shard(0.15, -0.6, 1.0, 0.30, 0.0, true),
    shard(-0.25, 0.55, 0.9, -0.26, 0.0),
    { prim: prims.cone, color: crystal, pos: [0, 1.7, 0], scale: [0.5, 0.8, 0.5], ...opts },
  ];
}

/** Vespene geyser — a dark rocky base ring + 3 emissive green gas plumes. */
function geyserParts(prims: UnitPrimitives): Part[] {
  const rock: [number, number, number] = [0.22, 0.20, 0.16];
  const gas: [number, number, number] = [0.45, 0.95, 0.35];
  const plume = (x: number, z: number, h: number): Part => ({
    prim: prims.cone, color: gas, pos: [x, h / 2 + 0.3, z], scale: [0.5, h, 0.5],
    metallic: 0, roughness: 1, // emissive-ish: bright + flat
  });
  return [
    { prim: prims.cylinder, color: rock, pos: [0, 0.3, 0], scale: [2.4, 0.6, 2.4], metallic: 0.1, roughness: 0.9 },
    { prim: prims.cylinder, color: rock, pos: [0, 0.55, 0], scale: [1.4, 0.5, 1.4], metallic: 0.1, roughness: 0.9 },
    plume(0, 0, 1.4),
    plume(0.55, 0.35, 1.0),
    plume(-0.45, -0.3, 1.1),
  ];
}

export interface ResourceSpawnResult {
  minerals: EntityHandle[];
  geysers: EntityHandle[];
}

/**
 * Spawn an entity per mineral patch + per geyser, with a model + components.
 * Returns the spawned entities so the HarvestSystem / verify hooks can target
 * them. `tint` mints materials from the lit base; `heightAt` sits them on terrain.
 */
export function spawnResourceFields(
  world: World,
  prims: UnitPrimitives,
  tint: TintFn,
  map: ResourceMap,
  heightAt: (x: number, z: number) => number,
): ResourceSpawnResult {
  const { minerals, geysers } = resolveResourcePoints(map);
  const out: ResourceSpawnResult = { minerals: [], geysers: [] };

  for (const m of minerals) {
    const y = heightAt(m.x, m.z);
    const res = world.spawn(
      { component: Transform, data: { pos: [m.x, y, m.z] } },
      { component: Mineral, data: { amount: m.amount, maxAmount: m.amount, currentHarvester: -1 } },
      { component: Faction, data: { playerId: PLAYER_ID.NEUTRAL, race: RACE.TERRAN, color: 0x4aa0ff } },
      { component: Selectable, data: { selected: false, selectionRadius: 1.2, priority: 0 } },
    );
    if (!res.ok) continue;
    spawnParts(world, res.value, mineralParts(prims), tint);
    out.minerals.push(res.value);
  }

  for (const g of geysers) {
    const y = heightAt(g.x, g.z);
    const res = world.spawn(
      { component: Transform, data: { pos: [g.x, y, g.z] } },
      { component: Geyser, data: { amount: g.amount, maxAmount: g.amount, hasRefinery: false, refineryEntity: -1 } },
      { component: Faction, data: { playerId: PLAYER_ID.NEUTRAL, race: RACE.TERRAN, color: 0x4ad06a } },
      { component: Selectable, data: { selected: false, selectionRadius: 1.6, priority: 0 } },
    );
    if (!res.ok) continue;
    // Initialise the Set companions (source CGeyser ctor created empty Sets).
    geyserCurrentWorkers.set(res.value, new Set<number>());
    geyserAssignedWorkers.set(res.value, new Set<number>());
    spawnParts(world, res.value, geyserParts(prims), tint);
    out.geysers.push(res.value);
  }

  return out;
}
