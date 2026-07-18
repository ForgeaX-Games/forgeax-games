// Inject ShadowCaster into opaque static MaterialAssets that only have Forward.
//
// URP CSM selects `{ LightMode: ['ShadowCaster'] }`. glTF bridge historically
// emitted Forward-only, so cooked camp/den props never wrote the shadow atlas
// even with DirectionalLight.castShadow=true. Engine toMaterialAsset now emits
// the pass for new cooks; this walk patches already-loaded shared materials
// so Play picks up the fix without a full re-import.
//
// Skips: skinned (pbr-skin), transparent (blend / queue≥3000), materials that
// already carry ShadowCaster.

import { MeshRenderer } from '@forgeax/engine-runtime';
import { createQueryState, queryRun, Entity } from '@forgeax/engine-ecs';
import { resolveAssetHandle } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { MaterialAsset, MaterialPassDescriptor } from '@forgeax/engine-types';

const SHADOW_CASTER_PASS: MaterialPassDescriptor = {
  name: 'ShadowCaster',
  shader: 'forgeax::default-shadow-caster',
  tags: { LightMode: 'ShadowCaster' },
  queue: 2000,
  passKind: 'shadow-caster',
};

function needsShadowCaster(mat: MaterialAsset): boolean {
  const passes = mat.passes;
  if (!passes || passes.length === 0) return false;
  if (passes.some((p) => p.name === 'ShadowCaster' || p.tags?.LightMode === 'ShadowCaster')) {
    return false;
  }
  if (passes.some((p) => typeof p.shader === 'string' && p.shader.includes('skin'))) {
    return false;
  }
  if (passes.some((p) => (p.queue ?? 0) >= 3000 || p.renderState?.blend !== undefined)) {
    return false;
  }
  return passes.some((p) => p.name === 'Forward' || p.tags?.LightMode === 'Forward');
}

function inject(mat: MaterialAsset): void {
  // Mutate in place — shared MaterialAsset is the registry payload; extract
  // re-reads passes each frame / on dirty. Avoid reallocating every prop.
  const next = [...(mat.passes ?? []), SHADOW_CASTER_PASS];
  (mat as unknown as { passes: MaterialPassDescriptor[] }).passes = next;
}

/** Patch every MeshRenderer material currently in the world. Returns count patched. */
export function ensureShadowCasters(world: World): number {
  const seen = new Set<number>();
  let patched = 0;
  const state = createQueryState({ with: [MeshRenderer, Entity] as const });
  queryRun(state, world, (bundle) => {
    const ents = bundle.Entity.self;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i] as EntityHandle | undefined;
      if (e === undefined) continue;
      const mr = world.get(e, MeshRenderer);
      if (!mr.ok) continue;
      const handles = mr.value.materials;
      if (!handles) continue;
      for (const h of handles) {
        if (h === undefined || h === 0) continue;
        const key = h as unknown as number;
        if (seen.has(key)) continue;
        seen.add(key);
        const res = resolveAssetHandle<MaterialAsset>(world, h as never);
        if (!res.ok) continue;
        if (!needsShadowCaster(res.value)) continue;
        inject(res.value);
        patched++;
      }
    }
  });
  return patched;
}
