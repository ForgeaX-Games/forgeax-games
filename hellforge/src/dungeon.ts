// Hellforge dungeon — 熔渣深窟 Slagdeep Hollow, the Act 1 dungeon.
//
// The dungeon is now an EDITABLE SCENE: its static geometry lives in
// `assets/scenes/slagdeep-hollow.pack.json` (click it in the editor), baked by
// `bun scripts/bake-dungeon.ts` from src/dungeon-layout.ts at the fixed
// DUNGEON_SEED. At runtime this class re-runs the same layout for the
// walkability grid + monster spawns (deterministic — always matches the
// baked geometry) and instantiates the pack under a root entity placed at
// DUNGEON_ORIGIN, far past the camera far plane so camp and den never
// render together. Entering/leaving is a player teleport — no engine
// scene switch, no full-rebuild renderer bug.
//
// If the baked pack fails to load (missing/renamed), the same geometry is
// spawned directly from the layout as a fallback, so the game never breaks.

import {
  Transform, MeshFilter, MeshRenderer, Materials,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle, SceneAsset } from '@forgeax/engine-types';

import {
  ANTECHAMBER_SCENE_GUID,
  buildAntechamberLayout,
} from './antechamber-layout';
import type { ProbeBlocker } from './camera-probe';
import {
  CELL, CELLS, DUNGEON_SCENE_GUID, DUNGEON_SEED, generateLayout, quatY,
  type DungeonLayout, type GeoKind,
} from './dungeon-layout';
import type { MonsterKind } from './monsters';

type MatHandle = Handle<'MaterialAsset', 'shared'>;

export { DUNGEON_ORIGIN, denMountainRingOrigin } from './dungeon-origin';
import { DUNGEON_ORIGIN } from './dungeon-origin';

export interface MonsterSpawn { kind: MonsterKind; x: number; z: number }

export class Dungeon {
  private layout: DungeonLayout;
  /** Layout seed — matches AreaDef generated source / baked pack (Task 4.2). */
  readonly layoutSeed: number;
  /** World-space entry pad (where the player appears when entering). */
  entry = { x: 0, z: 0 };
  /** World-space boss-room centre. */
  bossAt = { x: 0, z: 0 };
  monsterSpawns: MonsterSpawn[] = [];
  roomCount = 0;
  /** World-space fire fixtures (torch flames / braziers) — light-pool seats. */
  firePoints: Array<{ x: number; y: number; z: number }> = [];
  /**
   * World-space camera probe / fade blockers for the boss antechamber
   * (doorframe + walls / corners / pillars; pack-local AABBs shifted by
   * DUNGEON_ORIGIN + bossAt).
   */
  antechamberProbeBlockers: ProbeBlocker[] = [];

  constructor(private world: World, layoutSeed: number = DUNGEON_SEED) {
    this.layoutSeed = layoutSeed;
    this.layout = generateLayout(layoutSeed);
    this.roomCount = this.layout.roomCount;
    this.entry = { x: this.layout.entry.x + DUNGEON_ORIGIN.x, z: this.layout.entry.z + DUNGEON_ORIGIN.z };
    this.bossAt = { x: this.layout.bossAt.x + DUNGEON_ORIGIN.x, z: this.layout.bossAt.z + DUNGEON_ORIGIN.z };
    this.monsterSpawns = this.layout.monsterSpawns.map((s) => ({
      kind: s.kind as MonsterKind,
      x: s.x + DUNGEON_ORIGIN.x,
      z: s.z + DUNGEON_ORIGIN.z,
    }));
    // Seat point above the emissive mesh (flame tip +0.45, brazier bowl +0.75)
    // so a light parked there sits OUTSIDE the mesh — a shadow-casting light
    // inside its own fixture geometry would be fully occluded by it.
    this.firePoints = this.layout.geometry
      .filter((g) => g.kind === 'flame' || g.kind === 'brazier')
      .map((g) => ({
        x: g.x + DUNGEON_ORIGIN.x,
        y: g.kind === 'flame' ? g.y + 0.45 : g.y + 0.75,
        z: g.z + DUNGEON_ORIGIN.z,
      }));

    // PR1 quality room — same seed/footprint as bake-antechamber.ts.
    const ante = buildAntechamberLayout({
      widthM: this.layout.bossSize.w,
      depthM: this.layout.bossSize.h,
      doorTowardX: this.layout.entry.x - this.layout.bossAt.x,
      doorTowardZ: this.layout.entry.z - this.layout.bossAt.z,
    });
    const ox = this.bossAt.x;
    const oz = this.bossAt.z;
    for (const s of ante.lightSeats) {
      this.firePoints.push({ x: s.x + ox, y: s.y, z: s.z + oz });
    }
    this.antechamberProbeBlockers = ante.probeBlockers.map((b) => {
      if (b.type !== 'aabb') return b;
      return {
        ...b,
        min: [b.min[0] + ox, b.min[1] + oz] as const,
        max: [b.max[0] + ox, b.max[1] + oz] as const,
      };
    });
  }

  /**
   * Materialize the dungeon visuals: instantiate the baked scene pack under
   * a root at DUNGEON_ORIGIN; fall back to spawning from the layout when
   * the pack can't be loaded. Also loads the boss antechamber pack at bossAt
   * (PR1 quality room on the den approach path). Call once at boot.
   */
  async installGeometry(assets?: {
    loadByGuid<T>(guid: unknown): Promise<{ ok: boolean; value?: T; error?: { code?: string } }>;
    instantiate<T>(h: Handle<'SceneAsset', 'shared'>, w: World, parent?: EntityHandle):
      { ok: boolean; value?: unknown; error?: { code?: string } };
  }): Promise<'pack' | 'fallback'> {
    let denMode: 'pack' | 'fallback' = 'fallback';
    if (assets) {
      try {
        const g = AssetGuid.parse(DUNGEON_SCENE_GUID);
        if (g.ok) {
          const res = await assets.loadByGuid<SceneAsset>(g.value);
          if (res.ok && res.value) {
            const rootRes = this.world.spawn(
              { component: Transform, data: { pos: [DUNGEON_ORIGIN.x, 0, DUNGEON_ORIGIN.z], scale: [1, 1, 1] } },
            );
            if (rootRes.ok) {
              const handle = this.world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', res.value);
              const inst = assets.instantiate<SceneAsset>(handle, this.world, rootRes.value as EntityHandle);
              if (inst.ok) {
                console.log('[hellforge] den geometry: baked scene pack (slagdeep-hollow)');
                denMode = 'pack';
              }
            }
          }
        }
      } catch (err) {
        console.warn('[hellforge] baked den pack failed — runtime fallback:', (err as Error).message);
      }
    }
    if (denMode === 'fallback') {
      this.spawnGeometryFallback();
      console.log('[hellforge] den geometry: runtime fallback spawn');
    }
    await this.installAntechamber(assets);
    return denMode;
  }

  /** Instantiate boss-antechamber.pack.json at world bossAt (slight Y lift vs greybox). */
  private async installAntechamber(assets?: {
    loadByGuid<T>(guid: unknown): Promise<{ ok: boolean; value?: T; error?: { code?: string } }>;
    instantiate<T>(h: Handle<'SceneAsset', 'shared'>, w: World, parent?: EntityHandle):
      { ok: boolean; value?: unknown; error?: { code?: string } };
  }): Promise<void> {
    if (!assets) return;
    try {
      const g = AssetGuid.parse(ANTECHAMBER_SCENE_GUID);
      if (!g.ok) return;
      const res = await assets.loadByGuid<SceneAsset>(g.value);
      if (!res.ok || !res.value) {
        console.warn('[hellforge] antechamber pack missing — quality room skipped');
        return;
      }
      // +0.01 Y: sit kit floors/walls just above slagdeep greybox to avoid z-fight.
      const rootRes = this.world.spawn({
        component: Transform,
        data: {
          pos: [this.bossAt.x, 0.01, this.bossAt.z],
          scale: [1, 1, 1],
        },
      });
      if (!rootRes.ok) return;
      const handle = this.world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', res.value);
      const inst = assets.instantiate<SceneAsset>(handle, this.world, rootRes.value as EntityHandle);
      if (inst.ok) {
        console.log('[hellforge] den geometry: boss antechamber pack at boss approach');
      } else {
        console.warn('[hellforge] antechamber instantiate failed');
      }
    } catch (err) {
      console.warn('[hellforge] antechamber pack failed:', (err as Error).message);
    }
  }

  /** World-space walkability (small square footprint so hugging walls works). */
  walkable(wx: number, wz: number): boolean {
    for (const [ox, oz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]] as const) {
      const cx = Math.floor((wx + ox - DUNGEON_ORIGIN.x) / CELL + CELLS / 2);
      const cy = Math.floor((wz + oz - DUNGEON_ORIGIN.z) / CELL + CELLS / 2);
      if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
      if (!this.layout.walk[cy * CELLS + cx]) return false;
    }
    return true;
  }

  /** True when a world point is anywhere inside the dungeon's grid bounds. */
  contains(wx: number, wz: number): boolean {
    return Math.abs(wx - DUNGEON_ORIGIN.x) < (CELLS / 2 + 2) * CELL
        && Math.abs(wz - DUNGEON_ORIGIN.z) < (CELLS / 2 + 2) * CELL;
  }

  /** Grid cell for a world point, or null if outside the den grid. */
  worldToCell(wx: number, wz: number): { cx: number; cy: number } | null {
    const cx = Math.floor((wx - DUNGEON_ORIGIN.x) / CELL + CELLS / 2);
    const cy = Math.floor((wz - DUNGEON_ORIGIN.z) / CELL + CELLS / 2);
    if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return null;
    return { cx, cy };
  }

  /** Walkability of a single grid cell (no footprint pad). */
  isWalkCell(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
    return !!this.layout.walk[cy * CELLS + cx];
  }

  /** World XZ of a grid cell centre (navigation path waypoints). */
  cellToWorld(cx: number, cy: number): readonly [number, number] {
    return [
      (cx - CELLS / 2 + 0.5) * CELL + DUNGEON_ORIGIN.x,
      (cy - CELLS / 2 + 0.5) * CELL + DUNGEON_ORIGIN.z,
    ];
  }

  /** Raw walk grid (CELLS×CELLS) — automap reads this read-only. */
  getWalkGrid(): Uint8Array {
    return this.layout.walk;
  }

  /** Runtime geometry spawn from the layout (same primitives the bake writes). */
  private spawnGeometryFallback(): void {
    const mkMat = (color: [number, number, number, number], opts: { rough?: number; emissive?: [number, number, number]; ei?: number } = {}) =>
      this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: color, roughness: opts.rough ?? 0.9, metallic: 0.02,
        emissive: opts.emissive, emissiveIntensity: opts.ei ?? (opts.emissive ? 2 : 0),
      }));
    const mats: Record<GeoKind, MatHandle> = {
      floorA:    mkMat([0.16, 0.13, 0.14, 1]),
      floorB:    mkMat([0.13, 0.11, 0.13, 1]),
      wall:      mkMat([0.24, 0.17, 0.15, 1]),
      torchPost: mkMat([0.2, 0.13, 0.08, 1]),
      flame:     mkMat([1, 0.5, 0.12, 1], { emissive: [1, 0.45, 0.10], ei: 2.2 }),
      brazier:   mkMat([0.45, 0.08, 0.03, 1], { emissive: [1, 0.12, 0.03], ei: 1.2 }),
      rubble:    mkMat([0.30, 0.26, 0.25, 1]),
      bone:      mkMat([0.62, 0.56, 0.44, 1], { rough: 0.7 }),
      slag:      mkMat([0.40, 0.06, 0.02, 1], { rough: 0.5, emissive: [1, 0.10, 0.02], ei: 1.0 }),
      crate:     mkMat([0.45, 0.30, 0.18, 1], { rough: 0.85 }),
    };
    for (const g of this.layout.geometry) {
      const t: { pos: number[]; scale: number[]; quat?: number[] } = {
        pos: [g.x + DUNGEON_ORIGIN.x, g.y, g.z + DUNGEON_ORIGIN.z],
        scale: [g.sx, g.sy, g.sz],
      };
      if (g.rotY !== undefined) {
        const q = quatY(g.rotY);
        t.quat = [q[0], q[1], q[2], q[3]];
      }
      this.world.spawn(
        { component: Transform, data: t },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [mats[g.kind]] } },
      );
    }
  }
}
