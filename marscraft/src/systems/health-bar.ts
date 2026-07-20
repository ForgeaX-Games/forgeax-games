/**
 * MarsCraft -> forgeax-engine — health bars (Milestone M6)
 * =============================================================================
 * Port of `web/systems/HealthBarSystem.ts`, simplified for forgeax. The source
 * rendered SC2-style pip bars (bg + fill + shield + energy + pips + border) as
 * THREE sprites in a fog-immune overlay scene, billboarded to the camera.
 *
 * This port keeps the gameplay-meaningful behaviour and simplifies the visuals:
 *   - per unit: a two-quad bar (dark BACKGROUND quad + colored FILL quad), both
 *     `ChildOf` the unit so they track its position automatically.
 *   - FILL width = hp/maxHp (local scale[0] of the fill quad); colored
 *     green -> yellow -> red by hp ratio (source HP gradient).
 *   - shown when: selected OR recently damaged (<3s) OR hp not full — matching the
 *     source `shouldShow`. Hidden otherwise (scale collapsed to 0).
 *
 * SIMPLIFICATIONS (noted per the brief):
 *   - NOT per-frame billboarded to the camera. The quads carry a FIXED local
 *     orientation tilted to face the RTS camera (faces +Z, pitched back ~camera
 *     pitch) so they read correctly from the default vantage — "a flat bar facing
 *     !-camera is acceptable for now". True billboarding (per-frame yaw/pitch to
 *     the camera) is a later polish pass.
 *   - No shield / energy / pips / construction-progress / garrison sub-bars, no
 *     fog/cloak visibility gating (fog is M10) — only the HP bar. Faction tint of
 *     the bar is dropped in favour of the universal HP gradient (clearer at a
 *     glance); NOTE.
 *   - Unlit look via the shared PBR material under the strong Skylight (roughness
 *     1 / metallic 0), same approximation the selection rings use.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer, ChildOf,
  quat,
  type Handle, type MaterialAsset,
} from '@forgeax/engine-runtime';
import { type MeshAsset } from '@forgeax/engine-assets-runtime';
import { createPlaneGeometry } from '@forgeax/engine-geometry';
import { Health, Selectable, Renderable } from '../components';
import type { TintFn } from '../world/unit-models';

/** Bar geometry (world units at scale 1). */
const BAR_WIDTH = 1.0;
const BAR_HEIGHT = 0.14;
/** Height above the unit base (added to modelSize). */
const BAR_Y_OFFSET = 0.45;
/** Seconds a bar stays visible after taking damage (source SHOW_DURATION). */
const SHOW_DURATION = 3.0;
/** Fixed bar pitch toward the RTS camera (camera pitches down ~0.92 rad). */
const BAR_PITCH = 0.92;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

interface BarAssets {
  quad: Handle<'MeshAsset', 'shared'>;
  bg: Handle<'MaterialAsset', 'shared'>;
  green: Handle<'MaterialAsset', 'shared'>;
  yellow: Handle<'MaterialAsset', 'shared'>;
  red: Handle<'MaterialAsset', 'shared'>;
}

interface BarGroup {
  bgEntity: EntityHandle;
  fillEntity: EntityHandle;
  /** Last colour bucket applied to the fill (0 green / 1 yellow / 2 red). */
  colorBucket: number;
}

export interface HealthBarDeps {
  /** Tint fn (closes over the PBR base GUID). */
  tint: TintFn;
}

export class HealthBarSystem {
  private _world!: World;
  private _gameTime = 0;
  private _assets: BarAssets | null = null;
  private _bars = new Map<number, BarGroup>();
  private _qPitch = quat.create();

  constructor(private deps: HealthBarDeps) {}

  install(world: World): void {
    this._world = world;
    quat.fromAxisAngle(this._qPitch, [1, 0, 0], -BAR_PITCH); // tilt to face camera
    world.addSystem({
      name: 'mc-health-bar',
      queries: [{ with: [Entity, Transform, Health] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time').dt;
        this._gameTime += dt;
        const assets = this._ensureAssets();
        if (!assets) return;

        const batches = qr[0] as unknown as Batch[];
        const aliveIds = new Set<number>();

        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const entity = b.Entity.self[i] as EntityHandle;
            const id = entity as unknown as number;
            const hp = b.Health.hp[i] as number;
            const maxHp = b.Health.maxHp[i] as number;
            const isDead = !!b.Health.isDead[i];
            if (isDead || maxHp <= 0) continue;
            aliveIds.add(id);

            const ratio = Math.max(0, Math.min(1, hp / maxHp));
            const lastDmg = b.Health.lastDamageTime[i] as number;

            // show? selected OR recently damaged OR hp not full
            const sel = world.get(entity, Selectable);
            const selected = sel.ok && !!sel.value.selected;
            const recentlyDamaged = (this._gameTime - lastDmg) < SHOW_DURATION;
            const notFull = hp < maxHp;
            const show = selected || recentlyDamaged || notFull;

            let group = this._bars.get(id);
            if (!group) {
              if (!show) continue; // don't spawn a bar until first needed
              const created = this._createBar(entity, assets);
              if (!created) continue;
              group = created;
              this._bars.set(id, group);
            }
            this._updateBar(group, assets, show, ratio);
          }
        }

        // prune bars whose unit vanished (death-system despawns the unit; its
        // ChildOf bars are orphaned — despawn them here).
        if (this._bars.size > aliveIds.size) {
          for (const [id, g] of Array.from(this._bars)) {
            if (!aliveIds.has(id)) {
              if (world.get(g.bgEntity, Transform).ok) world.despawn(g.bgEntity);
              if (world.get(g.fillEntity, Transform).ok) world.despawn(g.fillEntity);
              this._bars.delete(id);
            }
          }
        }
      },
    });
  }

  /**
   * Despawn a unit's health bars SYNCHRONOUSLY (called by the death-system in the
   * same call, BEFORE it despawns the unit). Clearing the bars' ChildOf first +
   * despawning them while the parent is still alive avoids the 1-frame dangling
   * ChildOf→dead-unit that `propagateTransforms` flags as hierarchy-broken (the
   * old late `_bars.size > aliveIds.size` cleanup ran a frame after the unit was
   * already gone → orphan window → console-error storm on mass deaths).
   */
  notifyDespawned(entity: EntityHandle): void {
    const id = entity as unknown as number;
    const g = this._bars.get(id);
    if (!g) return;
    const w = this._world;
    for (const be of [g.bgEntity, g.fillEntity]) {
      if (w.get(be, ChildOf).ok) w.removeComponent(be, ChildOf);
      if (w.get(be, Transform).ok) w.despawn(be);
    }
    this._bars.delete(id);
  }

  private _ensureAssets(): BarAssets | null {
    if (this._assets) return this._assets;
    // createPlaneGeometry is XY-facing (a vertical quad); we keep it vertical and
    // pitch it toward the camera. 1x1 plane scaled per-unit.
    const geo = createPlaneGeometry(1, 1, 1, 1);
    if (!geo.ok) {
      console.error('[marscraft] health-bar quad geometry failed:', geo.error.code);
      return null;
    }
    const quad = this._world.allocSharedRef('MeshAsset', geo.value as MeshAsset);
    this._assets = {
      quad,
      bg: this.deps.tint([0.06, 0.06, 0.06], { metallic: 0, roughness: 1 }),
      green: this.deps.tint([0.15, 0.9, 0.2], { metallic: 0, roughness: 1 }),
      yellow: this.deps.tint([0.95, 0.85, 0.1], { metallic: 0, roughness: 1 }),
      red: this.deps.tint([0.95, 0.18, 0.12], { metallic: 0, roughness: 1 }),
    };
    return this._assets;
  }

  /** y offset above this unit (model half-height + BAR_Y_OFFSET). */
  private _barY(entity: EntityHandle): number {
    const r = this._world.get(entity, Renderable);
    const half = r.ok ? r.value.size * 0.5 : 0.5;
    return half + BAR_Y_OFFSET;
  }

  private _createBar(entity: EntityHandle, assets: BarAssets): BarGroup | null {
    const y = this._barY(entity);
    const q = this._qPitch;

    // background quad (full width).
    const bgRes = this._world.spawn(
      {
        component: Transform,
        data: {
          pos: [0, y, 0],
          quat: [q[0], q[1], q[2], q[3]],
          scale: [BAR_WIDTH, BAR_HEIGHT, 1],
        },
      },
      { component: MeshFilter, data: { assetHandle: assets.quad } },
      { component: MeshRenderer, data: { materials: [assets.bg] } },
      { component: ChildOf, data: { parent: entity } },
    );
    if (!bgRes.ok) return null;

    // fill quad (slightly in front; width scaled by hp ratio, left-anchored is
    // approximated by centering — a centered shrink reads fine at this size).
    const fillRes = this._world.spawn(
      {
        component: Transform,
        data: {
          pos: [0, y, 0.01],
          quat: [q[0], q[1], q[2], q[3]],
          scale: [BAR_WIDTH, BAR_HEIGHT * 0.8, 1],
        },
      },
      { component: MeshFilter, data: { assetHandle: assets.quad } },
      { component: MeshRenderer, data: { materials: [assets.green] } },
      { component: ChildOf, data: { parent: entity } },
    );
    if (!fillRes.ok) {
      this._world.despawn(bgRes.value);
      return null;
    }

    return { bgEntity: bgRes.value, fillEntity: fillRes.value, colorBucket: -1 };
  }

  private _updateBar(group: BarGroup, assets: BarAssets, show: boolean, ratio: number): void {
    const world = this._world;
    if (!show) {
      world.set(group.bgEntity, Transform, { scale: [0, 0, 0] });
      world.set(group.fillEntity, Transform, { scale: [0, 0, 0] });
      return;
    }
    // restore bg scale
    world.set(group.bgEntity, Transform, { scale: [BAR_WIDTH, BAR_HEIGHT, 1] });
    // fill width by hp ratio
    world.set(group.fillEntity, Transform, { scale: [BAR_WIDTH * ratio, BAR_HEIGHT * 0.8, 1] });

    // color bucket: green >0.5, yellow >0.25, red otherwise
    const bucket = ratio > 0.5 ? 0 : ratio > 0.25 ? 1 : 2;
    if (bucket !== group.colorBucket) {
      const mat = bucket === 0 ? assets.green : bucket === 1 ? assets.yellow : assets.red;
      world.set(group.fillEntity, MeshRenderer, { materials: [mat] });
      group.colorBucket = bucket;
    }
  }
}
