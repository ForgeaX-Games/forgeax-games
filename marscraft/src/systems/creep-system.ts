/**
 * MarsCraft -> forgeax-engine — CreepSystem (Milestone M9 chunk 3)
 * =============================================================================
 * Port of the Three.js source `web/systems/CreepSystem.ts`. Zerg creep:
 *   - sources = complete/morphing Hatchery/Lair/Hive buildings + CreepTumor
 *     entities; each source grows its coverage radius over time
 *   - `isOnCreep(x,z)` = inside any source circle (feeds CreepHealingSystem +
 *     the movement creep-boost flag + the creep vision bonus)
 *   - Zerg ground units on creep get a +30% move flag + a vision bonus
 *
 * RENDER: a tinted flat disc per source (cylinder prim scaled flat), rebuilt only
 * when the radius changes past a threshold. The source's subdivided terrain-
 * conforming shader disc with edge fade is a renderer-detail seam (noted); the
 * coverage LOGIC is 1:1.
 *
 * ⚠️ ECS rules: qr[N] is Batch[]; sources rebuilt from query batches each refresh
 * (no ad-hoc world.query); disc spawn/despawn is OUTSIDE the query loop.
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer, ChildOf,
  type Handle,
} from '@forgeax/engine-runtime';
import { type MeshAsset } from '@forgeax/engine-assets-runtime';
import { meshFromInterleaved } from '@forgeax/engine-geometry';
import {
  Building, CreepTumor, Faction, Movement, UnitType,
  BUILDING_STATE, MOVE_TYPE, RACE, CREEP_TUMOR_MAX_RADIUS,
  buildingTypeId,
} from '../components';
import type { UnitPrimitives } from '../world/unit-models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;

/** Creep spread rate (units/sec). */
const CREEP_SPREAD_RATE = 0.5;
/** Max creep radius for a base. */
const CREEP_MAX_RADIUS = 20;
/** Initial radius for a newly-built base. */
const CREEP_INITIAL_RADIUS = 4;
/** Creep move-speed bonus flag (+30%, applied by MovementSystem). */
export const CREEP_SPEED_BONUS = 0.3;
/** Creep vision bonus (world units; SC2 ~+2 tiles * RANGE_SCALE 1.84). */
const CREEP_VISION_BONUS = 3.68;
/** Building typeIds that emit creep. */
const CREEP_SOURCE_BUILDINGS = new Set(['hatchery', 'lair', 'hive']);
/** Rebuild a disc only when the radius changed past this. */
const REBUILD_RADIUS_THRESHOLD = 0.5;
/** Source-list rebuild interval (sec). */
const SOURCE_CHECK_INTERVAL = 2.0;
/** Creep tint (packed 0xRRGGBB). */
const CREEP_COLOR: [number, number, number] = [0x55 / 255, 0x33 / 255, 0x88 / 255];

interface CreepSource {
  entity: EntityHandle;
  x: number; z: number;
  radius: number;
  playerId: number;
  isTumor: boolean;
}

type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

export interface CreepDeps {
  prims: UnitPrimitives;
  tint: TintFn;
  heightAt: (x: number, z: number) => number;
}

export interface CreepHandle {
  /** True if (x,z) lies on any creep source circle. */
  isOnCreep(x: number, z: number): boolean;
  /** Owning playerId of the creep at (x,z), or null. */
  getCreepOwner(x: number, z: number): number | null;
  /** Mark a base entity as a starting base (creep already at max radius). */
  markStartingBase(entity: EntityHandle): void;
  probe(): Array<Record<string, unknown>>;
}

export class CreepSystem implements CreepHandle {
  readonly name = 'CreepSystem';
  private _world!: World;
  private readonly _deps: CreepDeps;
  private _sources: CreepSource[] = [];
  private _sourceCheckTimer = SOURCE_CHECK_INTERVAL; // refresh on first tick
  private readonly _startingBases = new Set<number>();
  private readonly _discOf = new Map<number, { disc: EntityHandle; builtRadius: number }>();
  private _discMat: Handle<'MaterialAsset', 'shared'> | null = null;

  constructor(deps: CreepDeps) { this._deps = deps; }

  markStartingBase(entity: EntityHandle): void { this._startingBases.add(rawId(entity)); }

  install(world: World): CreepHandle {
    this._world = world;
    world.addSystem(Update, {
      name: this.name,
      queries: [
        { with: [Entity, Transform, Building, Faction] },   // base sources (query 0)
        { with: [Entity, Transform, CreepTumor, Faction] }, // tumor sources (query 1)
        { with: [Entity, Transform, Movement, UnitType] },  // creep-boost targets (query 2)
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;

        // 1. periodically rebuild the source list from the query batches.
        this._sourceCheckTimer += dt;
        if (this._sourceCheckTimer >= SOURCE_CHECK_INTERVAL) {
          this._sourceCheckTimer = 0;
          this._rebuildSources(qr[0] as unknown as Batch[], qr[1] as unknown as Batch[]);
        }

        // 2. grow source radii (bases: while complete; tumors: always).
        for (const src of this._sources) {
          if (src.isTumor) {
            src.radius = Math.min(CREEP_TUMOR_MAX_RADIUS, src.radius + CREEP_SPREAD_RATE * dt);
            const tr = world.get(src.entity, CreepTumor);
            if (tr.ok) world.set(src.entity, CreepTumor, { radius: src.radius });
          } else {
            const b = world.get(src.entity, Building);
            if (b.ok && b.value.state === BUILDING_STATE.COMPLETE) {
              src.radius = Math.min(CREEP_MAX_RADIUS, src.radius + CREEP_SPREAD_RATE * dt);
            }
          }
        }

        // 3. apply the creep speed/vision flag to Zerg ground units (query 2).
        this._applyCreepBonus(qr[2] as unknown as Batch[]);

        // 4. update disc visuals (spawn/despawn OUTSIDE the loops, here).
        this._updateVisuals(world);
      },
    });
    return this;
  }

  private _rebuildSources(baseBatches: Batch[], tumorBatches: Batch[]): void {
    const next: CreepSource[] = [];
    // bases
    for (const b of baseBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        const e = b.Entity.self[i] as EntityHandle;
        const tid = buildingTypeId.get(e) ?? '';
        if (!CREEP_SOURCE_BUILDINGS.has(tid)) continue;
        const state = b.Building.state[i] as number;
        if (state !== BUILDING_STATE.COMPLETE && state !== BUILDING_STATE.MORPHING) continue;
        const existing = this._sources.find((s) => rawId(s.entity) === rawId(e));
        if (existing) { next.push(existing); continue; }
        const isStarter = this._startingBases.has(rawId(e));
        next.push({
          entity: e,
          x: b.Transform.pos[i * 3] as number,
          z: b.Transform.pos[i * 3 + 2] as number,
          radius: isStarter ? CREEP_MAX_RADIUS : CREEP_INITIAL_RADIUS,
          playerId: b.Faction.playerId[i] as number,
          isTumor: false,
        });
      }
    }
    // tumors
    for (const b of tumorBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        const e = b.Entity.self[i] as EntityHandle;
        const existing = this._sources.find((s) => rawId(s.entity) === rawId(e));
        const radius = b.CreepTumor.radius[i] as number;
        if (existing) { existing.radius = radius; next.push(existing); continue; }
        next.push({
          entity: e,
          x: b.Transform.pos[i * 3] as number,
          z: b.Transform.pos[i * 3 + 2] as number,
          radius,
          playerId: b.Faction.playerId[i] as number,
          isTumor: true,
        });
      }
    }
    this._sources = next;
  }

  private _applyCreepBonus(batches: Batch[]): void {
    if (this._sources.length === 0) return;
    for (const b of batches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        if ((b.Movement.moveType[i] as number) !== MOVE_TYPE.GROUND) continue;
        if ((b.UnitType.race[i] as number) !== RACE.ZERG) continue;
        const onCreep = this.isOnCreep(b.Transform.pos[i * 3] as number, b.Transform.pos[i * 3 + 2] as number);
        b.Movement.creepBoosted[i] = onCreep;
        // vision bonus: visionRange = baseVisionRange (+bonus on creep).
        const baseVision = b.UnitType.baseVisionRange[i] as number;
        b.UnitType.visionRange[i] = onCreep ? baseVision + CREEP_VISION_BONUS : baseVision;
      }
    }
  }

  isOnCreep(x: number, z: number): boolean {
    for (const src of this._sources) {
      const dx = x - src.x, dz = z - src.z;
      if (dx * dx + dz * dz <= src.radius * src.radius) return true;
    }
    return false;
  }

  getCreepOwner(x: number, z: number): number | null {
    for (const src of this._sources) {
      const dx = x - src.x, dz = z - src.z;
      if (dx * dx + dz * dz <= src.radius * src.radius) return src.playerId;
    }
    return null;
  }

  private _discMaterial(): Handle<'MaterialAsset', 'shared'> {
    if (!this._discMat) this._discMat = this._deps.tint(CREEP_COLOR, { metallic: 0, roughness: 1 });
    return this._discMat;
  }

  private _updateVisuals(world: World): void {
    const active = new Set<number>();
    for (const src of this._sources) {
      if (src.radius < 1) continue;
      active.add(rawId(src.entity));
      const cached = this._discOf.get(rawId(src.entity));
      if (cached && Math.abs(cached.builtRadius - src.radius) < REBUILD_RADIUS_THRESHOLD) continue;
      if (cached && world.get(cached.disc, Transform).ok) world.despawn(cached.disc);
      // A flat disc floats over slopes/plateaus (the old bug: one cylinder at the
      // center's height). Build a TERRAIN-CONFORMING radial disc mesh whose every
      // vertex samples heightAt — so the creep hugs the surface across its radius.
      const mesh = this._buildCreepMesh(src.x, src.z, src.radius);
      if (!mesh) continue;
      const handle: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', mesh);
      const res = world.spawn(
        // vertices are in WORLD space already → identity transform.
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: handle } },
        { component: MeshRenderer, data: { materials: [this._discMaterial()] } },
      );
      if (res.ok) this._discOf.set(rawId(src.entity), { disc: res.value, builtRadius: src.radius });
    }
    // prune discs whose source vanished.
    for (const [id, cached] of [...this._discOf]) {
      if (!active.has(id)) {
        if (world.get(cached.disc, Transform).ok) world.despawn(cached.disc);
        this._discOf.delete(id);
      }
    }
  }

  /**
   * Build a terrain-conforming radial disc MeshAsset centred on (cx,cz) with the
   * given radius: a center vertex + RINGS×SPOKES grid, EVERY vertex sampled at
   * `heightAt(x,z) + eps` so the creep sheet follows the ground (plateaus, slopes)
   * instead of floating as one flat plane. Vertices are in WORLD space (the entity
   * uses an identity transform). 8-float interleaved layout (pos3+normal3+uv2),
   * normals ≈ up (flat-ish sheet reads fine under the lit material). Returns null
   * for a tiny radius.
   */
  private _buildCreepMesh(cx: number, cz: number, radius: number): MeshAsset | null {
    if (radius < 1) return null;
    const RINGS = 5;
    const SPOKES = 28;
    const eps = 0.08;
    const h = this._deps.heightAt;
    const vertCount = 1 + RINGS * SPOKES;
    const inter = new Float32Array(vertCount * 8);
    const put = (idx: number, x: number, z: number): void => {
      const b = idx * 8;
      inter[b + 0] = x; inter[b + 1] = h(x, z) + eps; inter[b + 2] = z;
      inter[b + 3] = 0; inter[b + 4] = 1; inter[b + 5] = 0; // normal up
      inter[b + 6] = (x - cx) / (radius * 2) + 0.5; inter[b + 7] = (z - cz) / (radius * 2) + 0.5;
    };
    put(0, cx, cz); // center
    for (let r = 0; r < RINGS; r++) {
      const rr = radius * ((r + 1) / RINGS);
      for (let s = 0; s < SPOKES; s++) {
        const a = (s / SPOKES) * Math.PI * 2;
        put(1 + r * SPOKES + s, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
      }
    }
    const idx: number[] = [];
    // inner fan (center → ring 0)
    for (let s = 0; s < SPOKES; s++) {
      const a = 1 + s, b = 1 + ((s + 1) % SPOKES);
      idx.push(0, a, b);
    }
    // ring quads (two tris each)
    for (let r = 0; r < RINGS - 1; r++) {
      const base = 1 + r * SPOKES, next = 1 + (r + 1) * SPOKES;
      for (let s = 0; s < SPOKES; s++) {
        const sn = (s + 1) % SPOKES;
        idx.push(base + s, next + s, base + sn);
        idx.push(base + sn, next + s, next + sn);
      }
    }
    const indices = vertCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    return meshFromInterleaved(inter, indices) as MeshAsset;
  }

  probe(): Array<Record<string, unknown>> {
    return this._sources.map((s) => ({
      entity: rawId(s.entity),
      x: Number(s.x.toFixed(2)), z: Number(s.z.toFixed(2)),
      radius: Number(s.radius.toFixed(2)),
      playerId: s.playerId, isTumor: s.isTumor,
    }));
  }
}
