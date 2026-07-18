/**
 * MarsCraft -> forgeax-engine — FlatMeshCache (shared flat XZ-plane geometry)
 * =============================================================================
 * A tiny per-world cache of flat, horizontal (normal +Y) meshes used by the
 * overlay/aura VFX systems (BuffAuraSystem, StatefulAbilityVfxSystem): filled
 * discs/fans (marker circle/diamond), annulus rings (foot rings, burst rings),
 * and squashed ellipses (eye/lens outlines). Local space, centered at origin —
 * callers place + scale via Transform.
 *
 * SSOT: the Three.js source built these ad-hoc per effect (CircleGeometry /
 * RingGeometry / ShapeGeometry). forgeax has no scene-graph geometry factory in
 * these game systems, so we mint them once via `meshFromInterleaved` (8-float
 * interleaved: pos3 + normal3 + uv2) and share the handle by shape+params key.
 */

import type { World } from '@forgeax/engine-ecs';
import { type Handle } from '@forgeax/engine-runtime';
import { type MeshAsset } from '@forgeax/engine-assets-runtime';
import { meshFromInterleaved } from '@forgeax/engine-geometry';

export class FlatMeshCache {
  private readonly _world: World;
  private readonly _cache = new Map<string, Handle<'MeshAsset', 'shared'>>();

  constructor(world: World) { this._world = world; }

  /** Filled disc/fan of `sides` (4 = diamond, 16 = circle, 24 = smooth), radius in world units. */
  disc(radius: number, sides: number): Handle<'MeshAsset', 'shared'> {
    return this.ellipse(radius, radius, sides);
  }

  /** Filled ellipse/fan with independent X (`rx`) and Z (`rz`) radii — a lens/eye body. */
  ellipse(rx: number, rz: number, sides: number): Handle<'MeshAsset', 'shared'> {
    const key = `ell:${rx.toFixed(3)}:${rz.toFixed(3)}:${sides}`;
    const c = this._cache.get(key);
    if (c) return c;
    const vc = 1 + sides;
    const inter = new Float32Array(vc * 8);
    const put = (i: number, x: number, z: number): void => {
      const b = i * 8;
      inter[b] = x; inter[b + 1] = 0; inter[b + 2] = z;
      inter[b + 3] = 0; inter[b + 4] = 1; inter[b + 5] = 0;
      inter[b + 6] = x / (rx * 2) + 0.5; inter[b + 7] = z / (rz * 2) + 0.5;
    };
    put(0, 0, 0);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      put(1 + s, Math.cos(a) * rx, Math.sin(a) * rz);
    }
    const idx: number[] = [];
    for (let s = 0; s < sides; s++) idx.push(0, 1 + s, 1 + ((s + 1) % sides));
    const h = this._world.allocSharedRef('MeshAsset', meshFromInterleaved(inter, new Uint16Array(idx)) as MeshAsset);
    this._cache.set(key, h);
    return h;
  }

  /** Flat annulus (inner..outer) of `seg` segments in the XZ plane. */
  ring(inner: number, outer: number, seg: number): Handle<'MeshAsset', 'shared'> {
    const key = `ring:${inner.toFixed(3)}:${outer.toFixed(3)}:${seg}`;
    const c = this._cache.get(key);
    if (c) return c;
    const inter = new Float32Array(seg * 2 * 8);
    const put = (i: number, x: number, z: number): void => {
      const b = i * 8;
      inter[b] = x; inter[b + 1] = 0; inter[b + 2] = z;
      inter[b + 3] = 0; inter[b + 4] = 1; inter[b + 5] = 0;
      inter[b + 6] = x / (outer * 2) + 0.5; inter[b + 7] = z / (outer * 2) + 0.5;
    };
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      put(s * 2, Math.cos(a) * inner, Math.sin(a) * inner);
      put(s * 2 + 1, Math.cos(a) * outer, Math.sin(a) * outer);
    }
    const idx: number[] = [];
    for (let s = 0; s < seg; s++) {
      const i0 = s * 2, i1 = s * 2 + 1, j0 = ((s + 1) % seg) * 2, j1 = ((s + 1) % seg) * 2 + 1;
      idx.push(i0, i1, j0);
      idx.push(j0, i1, j1);
    }
    const h = this._world.allocSharedRef('MeshAsset', meshFromInterleaved(inter, new Uint16Array(idx)) as MeshAsset);
    this._cache.set(key, h);
    return h;
  }
}
