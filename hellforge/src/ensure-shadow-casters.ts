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
//
// Pass shape dual-read: c0 / Pack-v1 engines use `shader` + top-level `tags`;
// newer engines use `program.module` + `renderState.tags`. Blind `p.program.module`
// throws `Cannot read properties of undefined (reading 'module')` on c0.

import { MeshRenderer } from '@forgeax/engine-render';
import { resolveAssetHandle } from '@forgeax/engine-assets-runtime';
import type { World } from '@forgeax/engine-ecs';
import type { MaterialAsset, MaterialPass } from '@forgeax/engine-types';

type PassLike = {
  name?: string;
  program?: { module?: string } | null;
  shader?: string;
  tags?: { LightMode?: string };
  queue?: number;
  renderState?: {
    tags?: { LightMode?: string };
    queue?: number;
    blend?: unknown;
  };
};

function passShaderId(p: PassLike): string {
  return p.program?.module ?? p.shader ?? '';
}

function passLightMode(p: PassLike): string | undefined {
  return p.renderState?.tags?.LightMode ?? p.tags?.LightMode;
}

function passQueue(p: PassLike): number {
  return p.renderState?.queue ?? p.queue ?? 0;
}

function makeShadowCasterPass(existing: readonly PassLike[]): MaterialPass {
  const useShaderShape = existing.some((p) => typeof p.shader === 'string')
    || existing.every((p) => p.program == null);
  if (useShaderShape) {
    return {
      name: 'ShadowCaster',
      shader: 'forgeax::default-shadow-caster',
      tags: { LightMode: 'ShadowCaster' },
      passKind: 'shadow-caster',
      queue: 2000,
    } as unknown as MaterialPass;
  }
  return {
    name: 'ShadowCaster',
    program: { module: 'forgeax::default-shadow-caster' },
    renderState: { tags: { LightMode: 'ShadowCaster' }, queue: 2000 },
  } as unknown as MaterialPass;
}

function needsShadowCaster(mat: MaterialAsset): boolean {
  const passes = (mat.passes ?? []) as PassLike[];
  if (passes.length === 0) return false;
  if (passes.some((p) => p.name === 'ShadowCaster' || passLightMode(p) === 'ShadowCaster')) {
    return false;
  }
  if (passes.some((p) => passShaderId(p).includes('skin'))) {
    return false;
  }
  if (passes.some((p) => passQueue(p) >= 3000 || p.renderState?.blend !== undefined)) {
    return false;
  }
  return passes.some((p) => p.name === 'Forward' || passLightMode(p) === 'Forward');
}

function inject(mat: MaterialAsset): void {
  // Mutate in place — shared MaterialAsset is the registry payload; extract
  // re-reads passes each frame / on dirty. Avoid reallocating every prop.
  const existing = (mat.passes ?? []) as PassLike[];
  const next = [...existing, makeShadowCasterPass(existing)];
  (mat as unknown as { passes: MaterialPass[] }).passes = next as MaterialPass[];
}

/** Patch every MeshRenderer material currently in the world. Returns count patched. */
export function ensureShadowCasters(world: World): number {
  const seen = new Set<number>();
  let patched = 0;
  const query = world.query({ with: [MeshRenderer] }).unwrap();
  for (const row of query) {
    const mr = world.get(row.entity, MeshRenderer);
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
  return patched;
}
