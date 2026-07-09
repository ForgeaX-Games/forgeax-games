/**
 * MarsCraft -> forgeax-engine — RallyPointRenderer (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/RallyPointRenderer.ts`: for each SELECTED
 * building with a rally point, draw a world-space line from the building to the
 * rally point + a small flag at the rally end, colored by rally type (normal =
 * green, resource = blue, attack = red). The source used THREE.Line + a flag
 * Group; a forgeax game has no line primitive, so the line is a thin stretched
 * box (rotated to face the rally) and the flag is a thin cylinder pole + a box
 * flag — same read. Rebuilt (throttled) only when the selected-rally set changes.
 *
 * ⚠️ ECS: this is UI-ish world geometry, spawned/despawned OUTSIDE any query loop
 * (own throttled tick); dead-pruned via the selection set each rebuild.
 */

import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer, quat,
  type Handle,
} from '@forgeax/engine-runtime';
import { Building, NO_ENTITY } from '../components';
import type { SelectionHandle } from './selection';
import type { UnitPrimitives } from '../world/unit-models';

type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

const rawId = (e: EntityHandle): number => e as unknown as number;
const REBUILD_INTERVAL = 0.15; // s
const POLE_H = 1.8;
const COLOR: Record<string, [number, number, number]> = {
  normal:   [0.0, 1.0, 0.53],
  resource: [0.27, 0.67, 1.0],
  attack:   [1.0, 0.27, 0.27],
};

export interface RallyRendererDeps {
  selection: SelectionHandle;
  heightAt: (x: number, z: number) => number;
  prims: UnitPrimitives;
  tint: TintFn;
}

export interface RallyRendererHandle {
  /** Count of rally markers currently drawn (verify). */
  active(): number;
}

const _q = quat.create();

export class RallyRenderer implements RallyRendererHandle {
  readonly name = 'RallyRenderer';
  private _world!: World;
  private readonly _deps: RallyRendererDeps;
  private _timer = 0;
  private _sig = '';
  private readonly _marks: EntityHandle[] = [];
  private readonly _matCache = new Map<string, Handle<'MaterialAsset', 'shared'>>();

  constructor(deps: RallyRendererDeps) { this._deps = deps; }

  install(world: World): RallyRendererHandle {
    this._world = world;
    world.addSystem({
      name: this.name, queries: [], resources: ['Time'],
      fn: () => {
        this._timer += world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (this._timer < REBUILD_INTERVAL) return;
        this._timer = 0;
        this._rebuild();
      },
    });
    return this;
  }

  private _mat(type: string): Handle<'MaterialAsset', 'shared'> {
    const c = this._matCache.get(type);
    if (c) return c;
    const m = this._deps.tint(COLOR[type] ?? COLOR.normal, { metallic: 0, roughness: 1 });
    this._matCache.set(type, m);
    return m;
  }

  private _rebuild(): void {
    const world = this._world;
    // collect selected buildings that carry a rally point.
    type Rally = { bx: number; bz: number; rx: number; rz: number; type: string };
    const rallies: Rally[] = [];
    let sig = '';
    for (const e of this._deps.selection.getSelected()) {
      const b = world.get(e, Building);
      if (!b.ok || !b.value.hasRally) continue;
      const t = world.get(e, Transform);
      if (!t.ok) continue;
      const type = b.value.rallyResourceEntity !== NO_ENTITY ? 'resource'
        : b.value.rallyAttackEntity !== NO_ENTITY ? 'attack' : 'normal';
      const r: Rally = { bx: t.value.pos[0], bz: t.value.pos[2], rx: b.value.rallyX, rz: b.value.rallyZ, type };
      rallies.push(r);
      sig += `${rawId(e)}:${r.rx.toFixed(1)},${r.rz.toFixed(1)},${type};`;
    }
    if (sig === this._sig) return;
    this._sig = sig;

    // despawn old marks.
    for (const m of this._marks) if (world.get(m, Transform).ok) world.despawn(m);
    this._marks.length = 0;

    for (const r of rallies) this._spawnRally(r.bx, r.bz, r.rx, r.rz, r.type);
  }

  private _spawnRally(bx: number, bz: number, rx: number, rz: number, type: string): void {
    const world = this._world;
    const { heightAt, prims } = this._deps;
    const mat = this._mat(type);
    const by = heightAt(bx, bz) + 0.3, ry = heightAt(rx, rz) + 0.05;
    const dx = rx - bx, dz = rz - bz;
    const len = Math.hypot(dx, dz);
    if (len > 0.5) {
      // line = thin box from building→rally, rotated Y to face the direction.
      const ang = Math.atan2(dx, dz);
      quat.fromEuler(_q, 0, (ang * 180) / Math.PI, 0, 'XYZ');
      const midY = (by + ry) / 2;
      const line = world.spawn(
        { component: Transform, data: {
          pos: [(bx + rx) / 2, midY, (bz + rz) / 2],
          quat: [_q[0], _q[1], _q[2], _q[3]],
          scale: [0.07, 0.07, len],
        } },
        { component: MeshFilter, data: { assetHandle: prims.box } },
        { component: MeshRenderer, data: { materials: [mat] } },
      );
      if (line.ok) this._marks.push(line.value);
    }
    // flag pole (thin tall cylinder) at the rally point.
    const pole = world.spawn(
      { component: Transform, data: { pos: [rx, ry + POLE_H / 2, rz], scale: [0.06, POLE_H, 0.06] } },
      { component: MeshFilter, data: { assetHandle: prims.cylinder } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    if (pole.ok) this._marks.push(pole.value);
    // flag (small box near the pole top).
    const flag = world.spawn(
      { component: Transform, data: { pos: [rx + 0.18, ry + POLE_H - 0.2, rz], scale: [0.36, 0.24, 0.02] } },
      { component: MeshFilter, data: { assetHandle: prims.box } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    if (flag.ok) this._marks.push(flag.value);
  }

  active(): number { return this._marks.length; }
}
