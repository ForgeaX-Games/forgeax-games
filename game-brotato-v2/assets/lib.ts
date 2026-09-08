import { createBoxGeometry, meshFromInterleaved } from '@forgeax/engine-geometry';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type {
  AssetGuid as AssetGuidType,
  EquirectAsset,
  LocalEntityId,
  MeshAsset,
  SceneAsset,
  SceneEntity,
  TextureAsset,
} from '@forgeax/engine-types';
import { ARENA } from '../src/config/arena.ts';
export {
  bindMaterialSlots,
  buildActorHierarchy,
  buildActorMergedMesh,
  buildActorMeshes,
  combineModelParts,
  type ActorLimb,
  type ActorPart,
  type ActorRecipe,
  type LimbMotion,
  type LimbMotionKind,
  type ModelPart,
  type PrimitiveShape,
} from './lib/model-kit.ts';
import { combineModelParts, type ModelPart } from './lib/model-kit.ts';
import type { WeaponProfile } from './lib/weapons/types.ts';

export interface ArenaSceneGuids {
  readonly meshArenaFloor: AssetGuidType;
  readonly meshArenaTileA: AssetGuidType;
  readonly meshArenaTileB: AssetGuidType;
  readonly meshArenaWall: AssetGuidType;
  readonly materialArenaFloor: AssetGuidType;
  readonly materialArenaTileA: AssetGuidType;
  readonly materialArenaTileB: AssetGuidType;
  readonly materialArenaWall: AssetGuidType;
  readonly equirectSky: AssetGuidType;
  readonly equirectBackground: AssetGuidType;
}

function formatGuid(value: AssetGuidType): string {
  return AssetGuid.format(value);
}

/** A tiny deterministic texture used by the wall material's emissive mask. */
export function createGlowMaskTexture(): TextureAsset {
  const data = new Uint8Array(4 * 4 * 4);
  const colors: readonly (readonly [number, number, number, number])[] = [
    [255, 255, 255, 255],
    [104, 196, 255, 255],
  ];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const color = colors[(x + y) % colors.length] ?? colors[0];
      const offset = (y * 4 + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
  return {
    kind: 'texture',
    width: 4,
    height: 4,
    format: 'rgba8unorm-srgb',
    data,
    colorSpace: 'srgb',
    mipmap: false,
  };
}

/** A 1 x 1 neutral linear HDR source keeps the template binary-free. */
export function createSkyEquirect(): EquirectAsset {
  const one = [0x00, 0x3c]; // little-endian IEEE 754 binary16(1.0)
  return {
    kind: 'equirect',
    width: 1,
    height: 1,
    format: 'rgba16float',
    data: Uint8Array.from([...one, ...one, ...one, ...one]),
    colorSpace: 'linear',
  };
}

/** A separate dark neutral environment keeps the arena background charcoal without dimming IBL. */
export function createArenaBackgroundEquirect(): EquirectAsset {
  const darkGray = [0x00, 0x28]; // little-endian IEEE 754 binary16(0.03125)
  const one = [0x00, 0x3c]; // little-endian IEEE 754 binary16(1.0)
  return {
    kind: 'equirect',
    width: 1,
    height: 1,
    format: 'rgba16float',
    data: Uint8Array.from([...darkGray, ...darkGray, ...darkGray, ...one]),
    colorSpace: 'linear',
  };
}


function node(
  localId: number,
  name: string,
  mesh: AssetGuidType,
  material: AssetGuidType,
  pos: readonly [number, number, number],
  quat: readonly [number, number, number, number] = [0, 0, 0, 1],
): SceneEntity {
  return {
    localId: localId as LocalEntityId,
    components: {
      Name: { value: name },
      Transform: { pos, scale: [1, 1, 1], quat },
      MeshFilter: { assetHandle: formatGuid(mesh) },
      MeshRenderer: { materials: [formatGuid(material)] },
    },
  };
}

/** Build the 11-entity arena scene; grid tiles remain two batched mesh nodes. */
export function createArenaScene(guids: ArenaSceneGuids): SceneAsset {
  const entities: SceneEntity[] = [
    node(0, 'Arena Floor', guids.meshArenaFloor, guids.materialArenaFloor, [0, -0.28, 0]),
    {
      localId: 1 as LocalEntityId,
      components: {
        Name: { value: 'Arena Sun' },
        Transform: { pos: [0, 16, 0], scale: [1, 1, 1], quat: [0, 0, 0, 1] },
        DirectionalLight: {
          direction: [-0.45, -1, -0.32],
          color: [0.72, 0.88, 1],
          intensity: 3.2,
          castShadow: true,
          cascadeCount: 2,
          mapSize: 1024,
          shadowDistance: 42,
          depthBias: 0.008,
          normalBias: 0.08,
          pcfKernelSize: 3,
        },
      },
    },
    {
      localId: 2 as LocalEntityId,
      components: {
        Name: { value: 'Arena Ambient' },
        Skylight: { equirect: formatGuid(guids.equirectSky), color: [0.7, 0.82, 1], intensity: 0.28 },
      },
    },
    {
      localId: 3 as LocalEntityId,
      components: {
        Name: { value: 'Arena Rim Light' },
        Transform: { pos: [12, 8, 10], scale: [1, 1, 1], quat: [0, 0, 0, 1] },
        PointLight: { color: [0.08, 0.62, 1], intensity: 82, range: 14 },
      },
    },
    {
      localId: 4 as LocalEntityId,
      components: {
        Name: { value: 'Arena Skybox' },
        SkyboxBackground: { equirect: formatGuid(guids.equirectBackground), mode: 0 },
      },
    },
    node(5, 'Arena Tile Field A', guids.meshArenaTileA, guids.materialArenaTileA, [0, 0, 0]),
    node(6, 'Arena Tile Field B', guids.meshArenaTileB, guids.materialArenaTileB, [0, 0, 0]),
  ];
  const walls: readonly [string, readonly [number, number, number], readonly [number, number, number, number]][] = [
    ['North Wall', [0, ARENA.wall.y, -ARENA.wall.offset], [0, 0, 0, 1]],
    ['South Wall', [0, ARENA.wall.y, ARENA.wall.offset], [0, 0, 0, 1]],
    ['West Wall', [-ARENA.wall.offset, ARENA.wall.y, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2]],
    ['East Wall', [ARENA.wall.offset, ARENA.wall.y, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2]],
  ];
  for (const [index, [name, pos, quat]] of walls.entries()) {
    entities.push(node(index + 7, name, guids.meshArenaWall, guids.materialArenaWall, pos, quat));
  }
  return { kind: 'scene', entities };
}

export interface ArenaGeometrySet {
  readonly floor: MeshAsset;
  readonly tileA: MeshAsset;
  readonly tileB: MeshAsset;
  readonly wall: MeshAsset;
}

/** Build the four-bar ground wireframe used to calibrate the camera footprint. */
export function createViewCalibrationGeometry(): MeshAsset {
  const horizontal = createBoxGeometry(25, 0.035, 0.045);
  const vertical = createBoxGeometry(0.045, 0.035, 25);
  if (!horizontal.ok) throw horizontal.error;
  if (!vertical.ok) throw vertical.error;
  const half = 25 / 2;
  const parts: ModelPart[] = [
    { mesh: horizontal.value, position: [0, 0, -half], materialSlot: 0 },
    { mesh: horizontal.value, position: [0, 0, half], materialSlot: 0 },
    { mesh: vertical.value, position: [-half, 0, 0], materialSlot: 0 },
    { mesh: vertical.value, position: [half, 0, 0], materialSlot: 0 },
  ];
  return combineModelParts(parts);
}

/** Build a flat, transparent attack footprint in the weapon's local +Z direction. */
export function createAttackRangeGeometry(profile: WeaponProfile): MeshAsset {
  const points: Array<readonly [number, number]> = [];
  if (profile.shape === 'thrust') {
    const halfWidth = (profile.thrustWidth ?? 0.5) / 2;
    points.push([-halfWidth, 0], [halfWidth, 0], [halfWidth, profile.range], [-halfWidth, profile.range]);
  } else {
    points.push([0, 0]);
    const halfArc = (profile.arcDegrees * Math.PI) / 360;
    const segments = 18;
    for (let index = 0; index <= segments; index += 1) {
      const angle = -halfArc + (index / segments) * halfArc * 2;
      points.push([Math.sin(angle) * profile.range, Math.cos(angle) * profile.range]);
    }
  }

  const vertices: number[] = [];
  for (const [x, z] of points) vertices.push(x, 0.018, z, 0, 1, 0, 0.5, 0.5);
  const indices: number[] = [];
  if (profile.shape === 'thrust') {
    indices.push(0, 1, 2, 0, 2, 3);
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      indices.push(0, index + 1, index);
    }
  }
  const mesh = meshFromInterleaved(new Float32Array(vertices), new Uint32Array(indices));
  if (!mesh.ok) throw mesh.error;
  return {
    ...mesh.value,
    submeshes: [{
      indexOffset: 0,
      indexCount: indices.length,
      vertexCount: points.length,
      topology: 'triangle-list',
      materialSlot: 0,
    }],
    materialSlots: [{ slotName: 'attack-range' }],
  };
}

/** Create the floor, 40 x 40 checkerboard, and wall geometry. */
export function createArenaGeometry(): ArenaGeometrySet {
  const floor = createBoxGeometry(ARENA.floor.width, ARENA.floor.height, ARENA.floor.depth);
  const tile = createBoxGeometry(ARENA.tile.width, ARENA.tile.height, ARENA.tile.depth);
  const wall = createBoxGeometry(ARENA.wall.width, ARENA.wall.height, ARENA.wall.depth);
  if (!floor.ok) throw floor.error;
  if (!tile.ok) throw tile.error;
  if (!wall.ok) throw wall.error;
  const fieldA: ModelPart[] = [];
  const fieldB: ModelPart[] = [];
  const centerColumn = (ARENA.grid.columns - 1) / 2;
  const centerRow = (ARENA.grid.rows - 1) / 2;
  for (let row = 0; row < ARENA.grid.rows; row += 1) {
    for (let column = 0; column < ARENA.grid.columns; column += 1) {
      const target = (row + column) % 2 === 0 ? fieldA : fieldB;
      target.push({
        mesh: tile.value,
        position: [
          (column - centerColumn) * ARENA.tile.spacing,
          -0.02,
          (row - centerRow) * ARENA.tile.spacing,
        ],
      });
    }
  }
  return {
    floor: floor.value,
    tileA: combineModelParts(fieldA),
    tileB: combineModelParts(fieldB),
    wall: wall.value,
  };
}
