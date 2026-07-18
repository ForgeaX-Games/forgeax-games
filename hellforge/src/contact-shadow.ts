// Soft contact shadow (radial alpha decal) — grounding for skinned characters.
//
// Why not only CSM: den lighting is torch-dominated, so directional shadow maps
// barely darken the floor; skinned GLBs also cannot use default-shadow-caster
// (18F vs 12F). Community ARPG practice (Diablo / PoE / mobile ARPGs) uses a
// soft translucent oval under feet as the readable ground contact, optionally
// layered with CSM when the key light is strong (camp moonlight).
//
// Implementation: procedural RGBA atlas + unlit alpha-blend quad (no Forward
// ShadowCaster — the decal must not cast onto itself).

import {
  MeshFilter,
  MeshRenderer,
  Transform,
  quat,
} from '@forgeax/engine-runtime';
import { HANDLE_QUAD } from '@forgeax/engine-assets-runtime';
import { unwrapHandle } from '@forgeax/engine-types';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle, MaterialAsset, TextureAsset } from '@forgeax/engine-types';

export type ContactShadowKit = {
  /** Spawn a soft disc at (x,z). `radius` is world half-extent of the quad. */
  spawn(x: number, z: number, radius: number): EntityHandle;
  move(e: EntityHandle, x: number, z: number, radius: number): void;
  disposeEntity(e: EntityHandle): void;
  dispose(): void;
};

const ATLAS = 64;

function buildSoftShadowRgba(size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = (size - 1) * 0.5;
  const rOuter = size * 0.48;
  const rInner = size * 0.10;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cx);
      let a = 0;
      if (d <= rInner) a = 140;
      else if (d < rOuter) {
        let t = (d - rInner) / (rOuter - rInner);
        t = t * t * (3 - 2 * t);
        a = Math.round(140 * (1 - t));
      }
      const o = (y * size + x) * 4;
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = a;
    }
  }
  return data;
}

const straightAlphaBlend = {
  color: {
    srcFactor: 'src-alpha' as const,
    dstFactor: 'one-minus-src-alpha' as const,
    operation: 'add' as const,
  },
  alpha: {
    srcFactor: 'one' as const,
    dstFactor: 'one-minus-src-alpha' as const,
    operation: 'add' as const,
  },
};

export function installContactShadows(world: World): ContactShadowKit {
  const data = buildSoftShadowRgba(ATLAS);
  const mipLevelCount = Math.floor(Math.log2(ATLAS)) + 1;
  const tex = world.allocSharedRef<'TextureAsset', TextureAsset>('TextureAsset', {
    kind: 'texture',
    width: ATLAS,
    height: ATLAS,
    format: 'rgba8unorm',
    data,
    colorSpace: 'linear',
    mipmap: true,
    mipLevelCount,
  });

  const mat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
    kind: 'material',
    passes: [
      {
        name: 'Forward',
        shader: 'forgeax::default-unlit',
        tags: { LightMode: 'Forward' },
        queue: 3000,
        passKind: 'forward',
        renderState: {
          blend: straightAlphaBlend,
          depthWriteEnabled: false,
        },
      },
    ],
    paramValues: {
      // Texture carries the soft alpha; tint keeps RGB black.
      baseColor: [0.02, 0.015, 0.01, 0.9],
      baseColorTexture: unwrapHandle(tex),
    },
  });

  const flatQ = quat.create();
  quat.fromAxisAngle(flatQ, [1, 0, 0], -Math.PI / 2);
  const q4: [number, number, number, number] = [flatQ[0]!, flatQ[1]!, flatQ[2]!, flatQ[3]!];

  const live = new Set<EntityHandle>();

  const spawn = (x: number, z: number, radius: number): EntityHandle => {
    const e = world.spawn(
      {
        component: Transform,
        data: {
          pos: [x, 0.025, z],
          quat: q4,
          scale: [radius * 2, radius * 2, radius * 2],
        },
      },
      { component: MeshFilter, data: { assetHandle: HANDLE_QUAD } },
      { component: MeshRenderer, data: { materials: [mat] } },
    ).unwrap() as EntityHandle;
    live.add(e);
    return e;
  };

  return {
    spawn,
    move(e, x, z, radius) {
      if (!live.has(e)) return;
      world.set(e, Transform, {
        pos: [x, 0.025, z],
        quat: q4,
        scale: [radius * 2, radius * 2, radius * 2],
      });
    },
    disposeEntity(e) {
      if (!live.has(e)) return;
      live.delete(e);
      try { world.despawn(e); } catch { /* */ }
    },
    dispose() {
      for (const e of live) {
        try { world.despawn(e); } catch { /* */ }
      }
      live.clear();
    },
  };
}

/** Approximate contact radius from a character scale / monster size. */
export function contactRadiusForScale(scale: number): number {
  return Math.max(0.35, Math.min(1.1, 0.48 * scale));
}
