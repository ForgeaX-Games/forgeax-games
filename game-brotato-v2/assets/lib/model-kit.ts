import {
  createBoxGeometry,
  createCapsuleGeometry,
  createConeGeometry,
  createCylinderGeometry,
  createSphereGeometry,
  createTorusGeometry,
  meshFromInterleaved,
} from '@forgeax/engine-geometry';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type {
  AssetGuid as AssetGuidType,
  AssetError,
  LocalEntityId,
  MeshAsset,
  MeshMaterialSlot,
  SceneAsset,
  SceneEntity,
  Submesh,
} from '@forgeax/engine-types';
import { type Result } from '@forgeax/engine-types';

export type PrimitiveShape =
  | {
      readonly kind: 'sphere';
      readonly radius: number;
      readonly widthSegments?: number;
      readonly heightSegments?: number;
    }
  | { readonly kind: 'box'; readonly width: number; readonly height: number; readonly depth: number }
  | { readonly kind: 'capsule'; readonly height: number; readonly radius: number }
  | {
      readonly kind: 'cylinder';
      readonly radiusTop: number;
      readonly radiusBottom: number;
      readonly height: number;
      readonly radialSegments?: number;
    }
  | {
      readonly kind: 'cone';
      readonly radius: number;
      readonly height: number;
      readonly radialSegments?: number;
    }
  | { readonly kind: 'torus'; readonly radius: number; readonly tube: number };

export interface ActorPart {
  readonly id: string;
  readonly shape: PrimitiveShape;
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly materialSlot: number;
}

export type LimbMotionKind = 'bob' | 'swing' | 'none';

export interface LimbMotion {
  readonly kind: LimbMotionKind;
  readonly axis: 'x' | 'y' | 'z';
  readonly idleAmplitude: number;
  readonly idleFrequency: number;
  readonly moveAmplitude: number;
  readonly moveFrequency: number;
  readonly phase: number;
}

export interface ActorLimb {
  readonly id: string;
  readonly parts: readonly ActorPart[];
  readonly anchor: readonly [number, number, number];
  readonly motion: LimbMotion;
}

export interface ActorRecipe {
  readonly id: string;
  readonly displayName: string;
  readonly materialSlots: readonly string[];
  readonly body: readonly ActorPart[];
  readonly limbs: readonly ActorLimb[];
  readonly rootScale: number;
  /** 根实体原点到脚底的距离；运行时会用它把脚底放到地面。 */
  readonly groundOffset: number;
}

/** The resolved form used by the shared mesh combiner. */
export interface ModelPart {
  readonly mesh: MeshAsset;
  readonly position: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly materialSlot?: number;
}

function createPrimitive(shape: PrimitiveShape): Result<MeshAsset, AssetError> {
  switch (shape.kind) {
    case 'sphere':
      return createSphereGeometry(shape.radius, shape.widthSegments ?? 16, shape.heightSegments ?? 12);
    case 'box':
      return createBoxGeometry(shape.width, shape.height, shape.depth);
    case 'capsule':
      return createCapsuleGeometry(shape.radius, shape.height);
    case 'cylinder':
      return createCylinderGeometry(
        shape.radiusTop,
        shape.radiusBottom,
        shape.height,
        shape.radialSegments ?? 16,
      );
    case 'cone':
      return createConeGeometry(shape.radius, shape.height, shape.radialSegments ?? 16);
    case 'torus':
      return createTorusGeometry(shape.radius, shape.tube);
  }
}

function resolvePart(part: ActorPart, offset: readonly [number, number, number] = [0, 0, 0]): ModelPart {
  const primitive = createPrimitive(part.shape);
  if (!primitive.ok) throw primitive.error;
  return {
    mesh: primitive.value,
    position: [
      (part.position[0] ?? 0) + (offset[0] ?? 0),
      (part.position[1] ?? 0) + (offset[1] ?? 0),
      (part.position[2] ?? 0) + (offset[2] ?? 0),
    ],
    ...(part.rotation === undefined ? {} : { rotation: part.rotation }),
    ...(part.scale === undefined ? {} : { scale: part.scale }),
    materialSlot: part.materialSlot,
  };
}

function rotateModelVector(
  vector: readonly [number, number, number],
  rotation: readonly [number, number, number],
): readonly [number, number, number] {
  let [x, y, z] = vector;
  const [rotationX, rotationY, rotationZ] = rotation;
  const sinX = Math.sin(rotationX ?? 0);
  const cosX = Math.cos(rotationX ?? 0);
  [y, z] = [y * cosX - z * sinX, y * sinX + z * cosX];
  const sinY = Math.sin(rotationY ?? 0);
  const cosY = Math.cos(rotationY ?? 0);
  [x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY];
  const sinZ = Math.sin(rotationZ ?? 0);
  const cosZ = Math.cos(rotationZ ?? 0);
  [x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ];
  return [x, y, z];
}

/** Merge raw procedural 12-float meshes while preserving material groups. */
export function combineModelParts(parts: readonly ModelPart[]): MeshAsset {
  if (parts.length === 0) throw new Error('Brotato actor mesh needs at least one model part');
  const groups = new Map<number, { vertices: number[]; indices: number[] }>();
  let maxMaterialSlot = 0;
  for (const part of parts) {
    if (part.mesh.vertices.length % 12 !== 0 || part.mesh.indices === undefined) {
      throw new Error('Brotato model parts must be procedural 12-float indexed meshes');
    }
    const materialSlot = Math.max(0, Math.floor(part.materialSlot ?? 0));
    maxMaterialSlot = Math.max(maxMaterialSlot, materialSlot);
    let group = groups.get(materialSlot);
    if (group === undefined) {
      group = { vertices: [], indices: [] };
      groups.set(materialSlot, group);
    }
    const scale = part.scale ?? [1, 1, 1];
    const rotation = part.rotation ?? [0, 0, 0];
    const vertexCount = part.mesh.vertices.length / 12;
    const vertexOffset = group.vertices.length / 8;
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const source = vertexIndex * 12;
      const position = rotateModelVector(
        [
          (part.mesh.vertices[source] ?? 0) * (scale[0] ?? 1),
          (part.mesh.vertices[source + 1] ?? 0) * (scale[1] ?? 1),
          (part.mesh.vertices[source + 2] ?? 0) * (scale[2] ?? 1),
        ],
        rotation,
      );
      const normal = rotateModelVector(
        [
          part.mesh.vertices[source + 3] ?? 0,
          part.mesh.vertices[source + 4] ?? 1,
          part.mesh.vertices[source + 5] ?? 0,
        ],
        rotation,
      );
      const normalLength = Math.hypot(normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 1) || 1;
      group.vertices.push(
        (position[0] ?? 0) + (part.position[0] ?? 0),
        (position[1] ?? 0) + (part.position[1] ?? 0),
        (position[2] ?? 0) + (part.position[2] ?? 0),
        (normal[0] ?? 0) / normalLength,
        (normal[1] ?? 0) / normalLength,
        (normal[2] ?? 0) / normalLength,
        part.mesh.vertices[source + 6] ?? 0,
        part.mesh.vertices[source + 7] ?? 0,
      );
    }
    for (const index of part.mesh.indices) group.indices.push(index + vertexOffset);
  }

  const vertices: number[] = [];
  const indices: number[] = [];
  const submeshes: Submesh[] = [];
  for (const [materialSlot, group] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    const indexOffset = indices.length;
    const vertexOffset = vertices.length / 8;
    const vertexCount = group.vertices.length / 8;
    for (const vertex of group.vertices) vertices.push(vertex);
    for (const index of group.indices) indices.push(index + vertexOffset);
    submeshes.push({
      indexOffset,
      indexCount: group.indices.length,
      vertexCount,
      topology: 'triangle-list',
      materialSlot,
    });
  }
  const merged = meshFromInterleaved(new Float32Array(vertices), new Uint32Array(indices));
  if (!merged.ok) throw merged.error;
  const materialSlots: MeshMaterialSlot[] = Array.from({ length: maxMaterialSlot + 1 }, (_, slot) => ({
    slotName: `slot-${slot}`,
  }));
  return { ...merged.value, submeshes, materialSlots };
}

/** Attach stable material defaults to a mesh's existing numeric slots. */
export function bindMaterialSlots(
  mesh: MeshAsset,
  materials: readonly AssetGuidType[],
  sourceKey: string,
): MeshAsset {
  if (materials.length === 0) throw new Error(`Brotato mesh ${sourceKey} needs one material slot`);
  const lastSlot = materials.length - 1;
  return {
    ...mesh,
    submeshes: mesh.submeshes.map((submesh) => ({
      ...submesh,
      materialSlot: Math.max(0, Math.min(lastSlot, submesh.materialSlot)),
    })),
    materialSlots: materials.map((defaultMaterial, index) => ({
      slotName: index === 0 ? 'primary' : `detail-${index}`,
      sourceKey: index === 0 ? sourceKey : `${sourceKey}:detail-${index}`,
      defaultMaterial,
    })),
  };
}

/** Resolve one recipe into the body mesh plus one local-space mesh per limb. */
export function buildActorMeshes(recipe: ActorRecipe): {
  readonly body: MeshAsset;
  readonly limbs: ReadonlyMap<string, MeshAsset>;
} {
  const body = combineModelParts(recipe.body.map((part) => resolvePart(part)));
  const limbs = new Map<string, MeshAsset>();
  for (const limb of recipe.limbs) {
    limbs.set(limb.id, combineModelParts(limb.parts.map((part) => resolvePart(part))));
  }
  return { body, limbs };
}

/** Bake body and anchored limbs into one mesh for high-count actors. */
export function buildActorMergedMesh(recipe: ActorRecipe): MeshAsset {
  const parts: ModelPart[] = recipe.body.map((part) => resolvePart(part));
  for (const limb of recipe.limbs) {
    for (const part of limb.parts) parts.push(resolvePart(part, limb.anchor));
  }
  return combineModelParts(parts);
}

function guidText(value: string): string {
  const parsed = AssetGuid.parse(value);
  if (!parsed.ok) throw parsed.error;
  return AssetGuid.format(parsed.value);
}

function transform(pos: readonly [number, number, number]): Readonly<Record<string, unknown>> {
  return { pos, scale: [1, 1, 1], quat: [0, 0, 0, 1] };
}

/** Build a scene whose authored root owns the body and all independently animated limbs. */
export function buildActorHierarchy(
  recipe: ActorRecipe,
  guids: {
    readonly bodyMesh: string;
    readonly limbMeshes: ReadonlyMap<string, string>;
    readonly materials: readonly string[];
  },
): SceneAsset {
  const materials = guids.materials.map((material) => guidText(material));
  const entities: SceneEntity[] = [
    {
      localId: 0 as LocalEntityId,
      components: {
        Name: { value: `${recipe.displayName} Root` },
        Transform: transform([0, 0, 0]),
      },
    },
    {
      localId: 1 as LocalEntityId,
      components: {
        Name: { value: `${recipe.displayName} Body` },
        Transform: transform([0, 0, 0]),
        ChildOf: { parent: 0 },
        MeshFilter: { assetHandle: guidText(guids.bodyMesh) },
        MeshRenderer: { materials },
      },
    },
  ];
  for (const [index, limb] of recipe.limbs.entries()) {
    const mesh = guids.limbMeshes.get(limb.id);
    if (mesh === undefined) throw new Error(`Brotato actor recipe is missing limb mesh ${limb.id}`);
    entities.push({
      localId: (index + 2) as LocalEntityId,
      components: {
        Name: { value: `${recipe.displayName} ${limb.id}` },
        Transform: transform(limb.anchor),
        ChildOf: { parent: 0 },
        MeshFilter: { assetHandle: guidText(mesh) },
        MeshRenderer: { materials },
      },
    });
  }
  return { kind: 'scene', entities };
}
