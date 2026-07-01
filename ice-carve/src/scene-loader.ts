import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { AssetRegistry } from '@forgeax/engine-runtime';
import { createBoxGeometry, createCylinderGeometry, createSphereGeometry, SceneInstance } from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { LocalNodeId, MaterialAsset, SceneAsset } from '@forgeax/engine-types';

const CYLINDER_GUID = 'c1111111-0000-5000-8000-000000000001';
const CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE_GUID = '95730fd2-9846-5f84-8658-0b3c971eb263';
const HANDLE_FIELD: Record<string, string> = { MeshFilter: 'assetHandle', MeshRenderer: 'material' };
const STRIP_COMPONENTS = new Set(['Collider']);

interface PackNode { localId: number; components: Record<string, Record<string, unknown>> }
interface PackAsset { guid: string; kind: string; payload: unknown; refs?: string[] }
export interface ScenePack { assets: PackAsset[] }

type Ctx = { world: World; assets: AssetRegistry };

/** Load scene.pack.json and instantiate into the world. */
export async function loadScenePack(ctx: Ctx): Promise<boolean> {
  try {
    const res = await fetch(new URL('../scene.pack.json', import.meta.url), { cache: 'no-store' });
    if (!res.ok) throw new Error(`scene.pack.json ${res.status}`);
    const pack = (await res.json()) as ScenePack;
    return (await instantiateScenePack(pack, ctx)) !== null;
  } catch (err) {
    console.warn('[ice-carve] scene pack unavailable:', err);
    return false;
  }
}

async function instantiateScenePack(pack: ScenePack, ctx: Ctx): Promise<{ nodes: PackNode[] } | null> {
  const { world, assets } = ctx;
  const sceneEntry = pack.assets.find((a) => a.kind === 'scene');
  if (!sceneEntry) return null;

  const scenePayload = sceneEntry.payload as { kind: 'scene'; entities?: PackNode[]; nodes?: PackNode[] };
  const rawNodes = scenePayload.entities ?? scenePayload.nodes ?? [];
  const refs = sceneEntry.refs ?? [];

  const ENTITY_REF_FIELDS: Record<string, string> = { ChildOf: 'parent', Entity: 'self' };
  const ENTITY_REF_ARRAY_FIELDS: Record<string, string> = { Children: 'entities', Skin: 'joints' };
  const oldToNew = new Map<number, number>();
  rawNodes.forEach((n, i) => oldToNew.set(n.localId, i));
  const remapId = (v: unknown): unknown =>
    typeof v === 'number' && oldToNew.has(v) ? oldToNew.get(v)! : v;

  const packNodes: PackNode[] = rawNodes.map((n, i) => {
    const components: Record<string, Record<string, unknown>> = {};
    for (const [name, data] of Object.entries(n.components)) {
      const single = ENTITY_REF_FIELDS[name];
      const arr = ENTITY_REF_ARRAY_FIELDS[name];
      if (single !== undefined && single in data) {
        components[name] = { ...data, [single]: remapId(data[single]) };
      } else if (arr !== undefined && Array.isArray((data as Record<string, unknown>)[arr])) {
        components[name] = { ...data, [arr]: ((data as Record<string, unknown>)[arr] as unknown[]).map(remapId) };
      } else {
        components[name] = data;
      }
    }
    return { localId: i, components };
  });

  for (const a of pack.assets) {
    if (a.kind !== 'material') continue;
    const g = AssetGuid.parse(a.guid);
    if (g.ok) assets.catalog<MaterialAsset>(g.value, a.payload as MaterialAsset);
  }
  // Builtin primitive meshes referenced by scene refs[] (cube / cylinder / sphere).
  const cubeG = AssetGuid.parse(CUBE_GUID);
  const cubeGeo = createBoxGeometry(1, 1, 1);
  if (cubeG.ok && cubeGeo.ok) assets.catalog(cubeG.value, cubeGeo.value);
  const cylG = AssetGuid.parse(CYLINDER_GUID);
  const cylGeo = createCylinderGeometry(0.5, 0.5, 1, 18);
  if (cylG.ok && cylGeo.ok) assets.catalog(cylG.value, cylGeo.value);
  const sphereG = AssetGuid.parse(SPHERE_GUID);
  const sphereGeo = createSphereGeometry(0.5, 16, 12);
  if (sphereG.ok && sphereGeo.ok) assets.catalog(sphereG.value, sphereGeo.value);

  const sceneAsset: SceneAsset = {
    kind: 'scene',
    entities: packNodes.map((n) => {
      const components: Record<string, Record<string, unknown>> = {};
      for (const [name, data] of Object.entries(n.components)) {
        if (STRIP_COMPONENTS.has(name)) continue;
        const hf = HANDLE_FIELD[name];
        const resolved: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(data)) {
          resolved[field] = (hf === field && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < refs.length)
            ? refs[value]
            : value;
        }
        if (name === 'MeshRenderer' && 'material' in resolved) {
          const single = resolved['material'];
          delete resolved['material'];
          resolved['materials'] = single === undefined || single === null ? [] : [single];
        }
        components[name] = resolved;
      }
      return { localId: n.localId as LocalNodeId, components };
    }),
  };

  const sceneGuid = AssetGuid.parse(sceneEntry.guid);
  if (!sceneGuid.ok) return null;
  assets.catalog<SceneAsset>(sceneGuid.value, sceneAsset);
  const handleRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
  if (!handleRes.ok) {
    console.error('[ice-carve] scene loadByGuid failed:', handleRes.error);
    return null;
  }
  const sceneHandle = world.allocSharedRef('SceneAsset', handleRes.value);
  const instRes = assets.instantiate<SceneAsset>(sceneHandle, world);
  if (!instRes.ok) {
    const err = instRes.error as { code?: string; hint?: string; detail?: unknown };
    console.error('[ice-carve] scene instantiate failed:', err.code, err.hint ?? '', err.detail ?? '');
    return null;
  }
  const root = instRes.value;
  const sceneInst = world.get(root, SceneInstance);
  if (!sceneInst.ok) {
    console.error('[ice-carve] SceneInstance lookup failed:', sceneInst.error);
    return null;
  }
  void sceneInst.value.mapping as unknown as ArrayLike<EntityHandle>;
  console.info('[ice-carve] scene pack instantiated OK');
  return { nodes: packNodes };
}
