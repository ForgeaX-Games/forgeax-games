import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { CharacterController, Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { Materials, MeshFilter, MeshRenderer, SceneInstance } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { Handle, MaterialAsset } from '@forgeax/engine-runtime';
import type { SceneAsset } from '@forgeax/engine-types';
import { Rotatable } from './rotating-target';
import { ScoringTarget } from './scoring-target';
import { cloneWithClearcoat } from './clearcoat-material';

export type MatHandle = Handle<'MaterialAsset', 'shared'>;
export type GameContext = {
  world: World;
  assets?: import('@forgeax/engine-assets-runtime').AssetRegistry;
};
export type PackNode = {
  localId: number;
  components: Record<string, Record<string, unknown>>;
};
export type LoadedScene = {
  mapping: ReadonlyMap<number, EntityHandle>;
  nodes: PackNode[];
};
export type ScenePhysics = {
  props: Array<{ e: EntityHandle; materials: readonly MatHandle[]; clearcoat?: boolean }>;
  animatedMaterial?: { e: EntityHandle; mat: MatHandle };
};

export const SCENE_GUID = '20f6fb31-28f2-4238-a425-3d200506c10b';
export const PLAYER_Y = 0.75;

type NestedSceneAsset = Pick<SceneAsset, 'entities' | 'mounts'>;

function normalizeComponents(raw: unknown): Record<string, Record<string, unknown>> {
  const components: Record<string, Record<string, unknown>> = {};
  if (typeof raw !== 'object' || raw === null) return components;
  for (const [name, fields] of Object.entries(raw)) {
    if (typeof fields === 'object' && fields !== null) {
      components[name] = { ...(fields as Record<string, unknown>) };
    }
  }
  return components;
}

function remapNestedNode(node: NestedSceneAsset['entities'][number], offset: number): PackNode {
  const components = normalizeComponents(node.components);
  for (const [name, fields] of Object.entries(components)) {
    if (name === 'ChildOf' && typeof fields.parent === 'number') {
      fields.parent += offset;
    }
  }
  return { localId: node.localId + offset, components };
}

/**
 * Expand authored nested SceneAsset members into the same localId view used by
 * gameplay. The ECS mapping is already a flattened parent window; mirroring
 * that offset here keeps Name-based gameplay (physics, scoring, reset) on the
 * public asset path instead of adding a second scene traversal in main.ts.
 */
async function expandNestedNodes(
  assets: NonNullable<GameContext['assets']>,
  asset: NestedSceneAsset,
  offset = 0,
  ancestors = new Set<string>(),
): Promise<PackNode[]> {
  const nodes = asset.entities.map((node) => remapNestedNode(node, offset));
  for (const mount of asset.mounts ?? []) {
    if (mount.components !== undefined) {
      nodes.push({
        localId: offset + mount.localId,
        components: normalizeComponents(mount.components),
      });
    }
    if (typeof mount.source !== 'string') {
      throw new Error(`Nested SceneAsset mount ${mount.localId} has no resolved GUID`);
    }
    const guid = AssetGuid.parse(mount.source);
    if (!guid.ok) throw new Error(`Nested SceneAsset mount GUID is invalid: ${mount.source}`);
    const key = mount.source.toLowerCase();
    if (ancestors.has(key)) throw new Error(`Nested SceneAsset cycle detected at ${mount.source}`);
    const child = await assets.loadByGuid<SceneAsset>(guid.value);
    if (!child.ok) throw new Error(`Nested SceneAsset load failed: ${child.error.code}`);
    ancestors.add(key);
    nodes.push(...await expandNestedNodes(assets, child.value, offset + mount.memberFirst, ancestors));
    ancestors.delete(key);
  }
  return nodes;
}

export async function expandLoadedScene(
  assets: NonNullable<GameContext['assets']>,
  authored: SceneAsset,
  loaded: LoadedScene,
): Promise<LoadedScene> {
  const nestedNodes = await expandNestedNodes(assets, authored);
  return nestedNodes.length === loaded.nodes.length && loaded.nodes.every((node, i) => node.localId === nestedNodes[i]?.localId)
    ? loaded
    : { ...loaded, nodes: nestedNodes };
}

export async function loadScene(ctx: GameContext): Promise<LoadedScene | null> {
  if (!ctx.assets) return null;
  const guid = AssetGuid.parse(SCENE_GUID);
  if (!guid.ok) return null;
  const loaded = await ctx.assets.loadByGuid<SceneAsset>(guid.value);
  if (!loaded.ok) return null;
  const handle = ctx.world.allocSharedRef('SceneAsset', loaded.value);
  const instance = ctx.assets.instantiate<SceneAsset>(handle, ctx.world);
  if (!instance.ok) return null;
  const scene = ctx.world.get(instance.value, SceneInstance);
  if (!scene.ok) return null;
  const nodes = await expandNestedNodes(ctx.assets, loaded.value);
  const mapping = new Map<number, EntityHandle>();
  const mappingArray = scene.value.mapping as unknown as { [index: number]: number };
  for (const node of nodes) {
    const entity = mappingArray[node.localId];
    if (entity !== undefined && entity !== 0xffffffff && entity !== 0) {
      mapping.set(node.localId, entity as EntityHandle);
    }
  }
  return { mapping, nodes };
}

export function loadedFromHost(world: World, ctx: BootstrapContext): LoadedScene | null {
  const root = ctx.defaultSceneRoot;
  if (root === undefined || ctx.defaultScene === undefined) return null;
  const scene = world.get(root, SceneInstance);
  if (!scene.ok) return null;
  const mapping = new Map<number, EntityHandle>();
  const mappingArray = scene.value.mapping as unknown as { length: number; [index: number]: number };
  for (let localId = 0; localId < mappingArray.length; localId++) {
    const entity = mappingArray[localId];
    if (entity !== undefined && entity !== 0xffffffff && entity !== 0) {
      mapping.set(localId, entity as EntityHandle);
    }
  }
  return { mapping, nodes: ctx.defaultScene.entities as unknown as PackNode[] };
}

export function spawnFallbackScene(ctx: GameContext): void {
  const material = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
    baseColor: [0.48, 0.62, 0.35, 1], roughness: 0.95, metallic: 0,
  }));
  ctx.world.spawn(
    { component: Transform, data: { pos: [0, -0.1, 0], scale: [24, 0.2, 24] } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [material] } },
  );
}

export function spawnGroundCollider(ctx: GameContext): void {
  ctx.world.spawn(
    { component: Transform, data: { pos: [0, -5, 0] } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtents: [60, 5, 60], friction: 0.9, restitution: 0 } },
  );
}

export function setupPlayerRoot(ctx: GameContext, entity: EntityHandle): void {
  ctx.world.addComponent(entity, { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } });
  ctx.world.addComponent(entity, { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: 0.3, halfHeight: 0.4 } });
  ctx.world.addComponent(entity, { component: CharacterController, data: {} });
}

export function attachScenePhysics(ctx: GameContext, loaded: LoadedScene): ScenePhysics {
  const { world } = ctx;
  const props: ScenePhysics['props'] = [];
  let animatedMaterial: ScenePhysics['animatedMaterial'];
  const materialsOf = (entity: EntityHandle): readonly MatHandle[] => {
    const renderer = world.get(entity, MeshRenderer);
    const materials = renderer.ok ? renderer.value.materials : undefined;
    return materials === undefined || materials.length === 0
      ? [0 as MatHandle]
      : [...materials] as MatHandle[];
  };
  for (const node of loaded.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    const entity = loaded.mapping.get(node.localId);
    if (entity === undefined || !name) continue;
    const authoredTransform = (node.components.Transform ?? {}) as { pos?: number[]; scale?: number[] };
    const liveTransform = world.get(entity, Transform);
    const scale = liveTransform.ok ? liveTransform.value.scale : authoredTransform.scale;
    const hx = (scale?.[0] ?? 1) * 0.5;
    const hy = (scale?.[1] ?? 1) * 0.5;
    const hz = (scale?.[2] ?? 1) * 0.5;
    const sphereRadius = scale?.[0] ?? 1;
    const box = (restitution: number) => world.addComponent(entity, { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtents: [hx, hy, hz], restitution, friction: 0.7 } });
    const sphere = (restitution: number) => world.addComponent(entity, { component: Collider, data: { shape: ColliderShapeValue.sphere, radius: sphereRadius, restitution, friction: 0.6 } });
    const dynamic = () => world.addComponent(entity, { component: RigidBody, data: { type: RigidBodyTypeValue.dynamic, mass: 1, linearDamping: 0.05, angularDamping: 0.1, ccdEnabled: true } });
    const staticBody = () => world.addComponent(entity, { component: RigidBody, data: { type: RigidBodyTypeValue.static } });
    switch (name) {
      case 'Ground': break;
      case 'TreeTrunk': staticBody(); box(0.2); break;
      case 'TreeCanopy': staticBody(); sphere(0.2); break;
      case 'RedBox': dynamic(); box(0.25); props.push({ e: entity, materials: materialsOf(entity) }); world.addComponent(entity, { component: ScoringTarget, data: { points: 10 } }); break;
      case 'BlueBall': {
        dynamic();
        sphere(0.55);
        const authoredMat = materialsOf(entity)[0] ?? (0 as MatHandle);
        const clearcoatMat = cloneWithClearcoat(world, authoredMat);
        const mat = clearcoatMat ?? authoredMat;
        if (clearcoatMat !== undefined) world.set(entity, MeshRenderer, { materials: [clearcoatMat] });
        props.push({ e: entity, materials: [mat], clearcoat: clearcoatMat !== undefined });
        world.addComponent(entity, { component: ScoringTarget, data: { points: 15 } });
        break;
      }
      case 'YellowPillar':
        dynamic();
        box(0.2);
        world.addComponent(entity, { component: Rotatable, data: { speed: 0.3 } });
        const materials = materialsOf(entity);
        props.push({ e: entity, materials });
        animatedMaterial = { e: entity, mat: materials[0] ?? (0 as MatHandle) };
        world.addComponent(entity, { component: ScoringTarget, data: { points: 10 } });
        break;
      case 'BouncyBall': dynamic(); sphere(0.92); props.push({ e: entity, materials: materialsOf(entity) }); world.addComponent(entity, { component: ScoringTarget, data: { points: 25 } }); break;
      case 'NestedTarget':
        dynamic();
        box(0.25);
        props.push({ e: entity, materials: materialsOf(entity) });
        world.addComponent(entity, { component: ScoringTarget, data: { points: 20 } });
        break;
      default:
        if (name.startsWith('Crate')) { dynamic(); box(0.1); props.push({ e: entity, materials: materialsOf(entity) }); world.addComponent(entity, { component: ScoringTarget, data: { points: 5 } }); }
        break;
    }
  }
  return animatedMaterial === undefined ? { props } : { props, animatedMaterial };
}
