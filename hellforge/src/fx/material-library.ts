import { AssetGuid } from '@forgeax/engine/pack/guid';
import type { GameHost } from '@forgeax/engine/app';
import type { MaterialAsset, MaterialValue } from '@forgeax/engine/types';

export const FX_MATERIAL_GUIDS = {
  "hellforge::fire_bolt": "96609630-726b-4564-9713-000000000001",
  "hellforge::portal_vortex": "96609630-726b-4564-9713-000000000002",
  "hellforge::frost_fang": "96609630-726b-4564-9713-000000000003",
  "hellforge::frost_impact": "96609630-726b-4564-9713-000000000004",
  "hellforge::frost_slow": "96609630-726b-4564-9713-000000000005",
  "hellforge::move_click": "96609630-726b-4564-9713-000000000006",
  "sprite-premult": "96609630-726b-4564-9713-000000000007",
  "sprite-additive": "96609630-726b-4564-9713-000000000008"
} as const;

export type FxMaterialLibrary = {
  create(shader: string, values: Record<string, MaterialValue | null>, blend?: 'premult' | 'additive'): MaterialAsset;
};

/** GUID-loaded roots own the build-published shader contract; children override values.
 * The SDK text-pack route does not currently emit material-cook/4 receipts. */
export function createFxMaterial(
  shader: string, values: Record<string, MaterialValue | null>, blend: 'premult' | 'additive' = 'premult',
): MaterialAsset {
  const key = (shader === 'hellforge::sprite' ? 'sprite-' + blend : shader) as keyof typeof FX_MATERIAL_GUIDS;
  const guid = FX_MATERIAL_GUIDS[key];
  if (!guid) throw new Error('Unknown Hellforge material: ' + key);
  const parsed = AssetGuid.parse(guid);
  if (!parsed.ok) throw parsed.error;
  return { kind: 'material', parent: parsed.value, values };
}

export async function loadFxMaterials(assets: GameHost['assets']): Promise<FxMaterialLibrary> {
  await Promise.all(Object.entries(FX_MATERIAL_GUIDS).map(async ([name, id]) => {
    const parsed = AssetGuid.parse(id);
    if (!parsed.ok) throw parsed.error;
    const result = await assets.loadByGuid<MaterialAsset>(parsed.value);
    if (!result.ok) throw new Error('Hellforge FX material failed: ' + name + ': ' + String(result.error));
  }));
  return { create: createFxMaterial };
}
