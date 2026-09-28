import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import {
  ChildOf,
  Name,
  Transform,
  worldGetSceneInstanceState,
} from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
  Materials,
  Visibility,
  VisibilityStateValue,
} from '@forgeax/engine-render';
import type {
  MaterialAsset,
  MeshAsset,
  SceneAsset,
} from '@forgeax/engine-types';
import type { StreetAssets } from '../street';
import { ASSET_GUIDS } from './asset-guids';

const materialCaches = [
  new WeakMap<MaterialAsset, MaterialAsset>(),
  new WeakMap<MaterialAsset, MaterialAsset>(),
] as const;

export type V = [number, number, number];
export type Part = {
  entity: EntityHandle;
  pos: V;
  quat: [number, number, number, number];
};
export type Model = { root: EntityHandle; parts: Map<string, Part> };
/** Keep the official import/Pack/loadByGuid path; GLB node names identify articulated meshes. */
export async function loadModel(
  world: World,
  assets: StreetAssets,
  id: string,
  parent?: EntityHandle,
  castShadow = false,
): Promise<Model> {
  const materialCache = materialCaches[castShadow ? 1 : 0];
  const authoredSchema = new URLSearchParams(globalThis.location?.search ?? '')
    .get('perfMaterials') === 'authored';
  const guid = AssetGuid.parse(ASSET_GUIDS[id]);
  if (!guid.ok) throw new Error(`Invalid scene GUID: ${id}`);
  const loaded = await assets.loadByGuid<SceneAsset>(guid.value);
  if (!loaded.ok || !loaded.value)
    throw new Error(`Could not load ${id}: ${loaded.error?.code}`);
  const root = world
    .spawn(
      { component: Transform, data: { pos: [0, -50, 0] } },
      {
        component: Visibility,
        data: {
          state:
            parent === undefined
              ? VisibilityStateValue.visible
              : VisibilityStateValue.hidden,
        },
      },
      ...(parent === undefined
        ? []
        : [{ component: ChildOf, data: { parent } }]),
    )
    .unwrap();
  const instance = assets.instantiate(
    world.allocSharedRef('SceneAsset', loaded.value),
    world,
    root,
  );
  if (!instance.ok || instance.value === undefined)
    throw new Error(`Could not instantiate ${id}`);
  const state = worldGetSceneInstanceState(world, instance.value).unwrap();
  const parts = new Map<string, Part>();
  for (const entity of state.entityToLocalId.keys()) {
    const filter = world.get(entity, MeshFilter);
    if (filter.ok) {
      const mesh = world.sharedRefs.resolve<'MeshAsset', MeshAsset>(
        filter.value.assetHandle,
      );
      if (mesh.ok && mesh.value.materialSlots) {
        const materials = [];
        for (const slot of mesh.value.materialSlots) {
          if (!slot.defaultMaterial) continue;
          const material = await assets.loadByGuid<MaterialAsset>(
            slot.defaultMaterial,
          );
          if (!material.ok || !material.value)
            throw new Error(`Could not load ${id}/${slot.slotName}`);
          // This pinned importer emits the legacy forward-only program. Use the current
          // standard material contract while preserving the GLB's values and texture GUIDs.
          let runtime = materialCache.get(material.value);
          if (!runtime) {
            const standard = Materials.standard({
              baseColor: [1, 1, 1, 1],
              castShadow,
              ...(/LC_cloth|LC_couplet/.test(slot.slotName)
                ? { renderState: { cullMode: 'none' as const } }
                : {}),
            });
            runtime = {
              // The registered standard Shader owns the complete parameter schema.
              // Re-declaring it here makes this pinned renderer derive/hash it per
              // mesh per frame. Keep identical values, color space and passes;
              // use the public registry fallback instead. The URL flag is A/B only.
              kind: standard.kind,
              ...(authoredSchema ? { parameters: standard.parameters } : {}),
              passes: [
                standard.passes![0],
                ...standard.passes!.filter(
                  (p) => castShadow && p.name === 'shadow-caster',
                ),
              ],
              colorSpace: material.value.colorSpace,
              values: {
                ...standard.values,
                ...material.value.values,
                ...(/WetAsphalt|WetPaving/.test(slot.slotName)
                  ? { clearcoat: 0.65, clearcoatRoughness: 0.06 }
                  : {}),
              },
            };
            materialCache.set(material.value, runtime);
          }
          materials.push(world.internSharedRef('MaterialAsset', runtime));
        }
        if (materials.length) world.set(entity, MeshRenderer, { materials });
      }
    }
    const name = world.get(entity, Name);
    if (!name.ok) continue;
    const role = name.value.value.split('__')[1]?.replace(/\.\d+$/, '');
    if (!role) continue;
    const transform = world.get(entity, Transform).unwrap();
    parts.set(role, {
      entity,
      pos: [...transform.pos] as V,
      quat: [...transform.quat] as Part['quat'],
    });
  }
  return { root, parts };
}
/** Delta rotation is composed with the authored pivot, preserving glTF axis conversion. */
export function pose(
  world: World,
  model: Model,
  role: string,
  offset: V = [0, 0, 0],
  rotation: V = [0, 0, 0],
) {
  const part = model.parts.get(role);
  if (!part) return;
  const [x, y, z] = rotation.map((a) => a / 2),
    sx = Math.sin(x),
    cx = Math.cos(x),
    sy = Math.sin(y),
    cy = Math.cos(y),
    sz = Math.sin(z),
    cz = Math.cos(z);
  const a = [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
  const b = part.quat;
  world.set(part.entity, Transform, {
    pos: part.pos.map((v, i) => v + offset[i]) as V,
    quat: [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ],
  });
}
export function animateEnemy(
  world: World,
  model: Model,
  now: number,
  moving: boolean,
  hit: number,
  death: number,
) {
  const step = moving ? Math.sin(now * 5.8) * 0.21 : 0;
  pose(world, model, 'LEG_L', [0, 0, 0], [step, 0, 0]);
  pose(world, model, 'LEG_R', [0, 0, 0], [-step, 0, 0]);
  pose(world, model, 'ARM_L', [0, 0, 0], [-step * 0.5, 0, 0.03]);
  pose(world, model, 'ARM_R', [0, 0, 0], [step * 0.5, 0, -0.03]);
  pose(
    world,
    model,
    'HEAD',
    [0, 0, 0],
    [hit * 0.25, Math.sin(now * 0.8) * 0.07, 0],
  );
  pose(
    world,
    model,
    'TORSO',
    [0, Math.sin(now * 2) * 0.004, hit * 0.02],
    [hit * 0.08, 0, 0],
  );
  // Death tips the complete model at its foot pivot; physics is removed separately.
  world.set(model.root, Transform, {
    scale: [1, 1, 1],
    quat: [Math.sin(death * 0.72), 0, 0, Math.cos(death * 0.72)],
  });
}
