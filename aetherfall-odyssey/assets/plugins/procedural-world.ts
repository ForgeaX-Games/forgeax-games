import type { BootstrapContext } from "@forgeax/engine-app";
import {
  Time,
  Update,
  type ComponentData,
  type EntityHandle,
  type World,
} from "@forgeax/engine-ecs";
import { computeTangentVec4 } from "@forgeax/engine-geometry";
import {
  Instances,
  Materials,
  MeshFilter,
  MeshRenderer,
  type Renderer,
} from "@forgeax/engine-render";
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from "@forgeax/engine-physics";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import { Transform } from "@forgeax/engine-scene";
import type {
  Handle,
  MaterialAsset,
  MeshAsset,
  TextureAsset,
} from "@forgeax/engine-types";
import { unwrapHandle } from "@forgeax/engine-types";
import {
  explorationWorldStage,
  type ExplorationSnapshot,
  type ExplorationWorldStage,
  type MemoryTempleId,
} from "./exploration-state";
import {
  EXPLORATION_ROUTE_FOOTPRINTS,
  LAST_LIGHT_CAUSEWAY,
  LAST_LIGHT_TERRACE,
  LAST_LIGHT_TERRACE_COLLIDER,
} from "./environment-layout";
import type { RouteFootprint } from "./environment-layout";
import {
  throwAfterFailedRollback,
  type ResidualCleanupOwner,
} from "./world-installation-lifecycle";

type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];
type SharedAssetHandle = Handle<string, "shared">;

export type ProceduralInstanceTransform = {
  readonly pos: Vec3;
  readonly scale: Vec3;
  readonly yaw: number;
};

export type ProceduralWorldHandle = ResidualCleanupOwner & {
  readonly spawnedEntities: number;
  readonly setExplorationSnapshot: (snapshot: ExplorationSnapshot) => void;
};

export type ExplorationLandmarkVisualState = {
  readonly stage: ExplorationWorldStage;
  readonly templeScales: readonly Vec3[];
  readonly templeOrbitalEnabled: readonly boolean[];
  readonly templeOrbitalRadii: readonly number[];
  readonly templeOrbitalSpeeds: readonly number[];
  readonly templeOrbitalStretches: readonly number[];
  readonly beaconScale: Vec3;
  readonly beaconOrbitalEnabled: boolean;
  readonly beaconOrbitalAnchor: "beacon" | "sanctuary";
  readonly beaconOrbitalRadius: number;
  readonly beaconOrbitalSpeed: number;
  readonly beaconOrbitalScale: number;
  readonly sanctuarySignalEnabled: boolean;
};

type MeshParts = {
  readonly positions: Vec3[];
  readonly normals: Vec3[];
  readonly uvs: Vec2[];
  readonly indices: number[];
};

const TAU = Math.PI * 2;
const LAST_LIGHT_CAUSEWAY_STATIONS = [
  { z: -1.72, halfWidth: 0.95 },
  { z: -1.05, halfWidth: 1.02 },
  { z: -0.35, halfWidth: 0.93 },
  { z: 0.35, halfWidth: 1.04 },
  { z: 1.05, halfWidth: 0.97 },
  { z: 1.72, halfWidth: 0.92 },
] as const;
const BASALT_TEXTURE_GUID = "019fdbfe-1f8f-789a-b4a6-6f7fd01d9d30";
const RUIN_STONE_TEXTURE_GUID = "019fdc09-0de2-7f35-bdc7-fd23f7c3b1ad";
const BASALT_NORMAL_GUID = "019fdc9e-cb3c-728f-99c9-e86264c7f81f";
const BASALT_METALLIC_ROUGHNESS_GUID = "019fdc9e-cb3d-73d2-b4cb-49548f7709f1";
const BASALT_AO_GUID = "019fdc9e-cb3d-73d2-b4cb-495572c581e8";
const RUIN_NORMAL_GUID = "019fdc9e-cb3d-73d2-b4cb-49566bd679eb";
const RUIN_METALLIC_ROUGHNESS_GUID = "019fdc9e-cb3d-73d2-b4cb-49573fa611b4";
const RUIN_AO_GUID = "019fdc9e-cb3d-73d2-b4cb-49588a965d0c";

export const PROCEDURAL_MATERIAL_IDENTITY = {
  ground: {
    baseColor: [0.22, 0.28, 0.24, 1] as const,
    roughness: 0.84,
    metallic: 0.04,
    occlusionStrength: 0.92,
  },
  cliff: {
    baseColor: [0.12, 0.17, 0.22, 1] as const,
    roughness: 0.96,
    metallic: 0.03,
    occlusionStrength: 0.96,
  },
  ruin: {
    baseColor: [0.39, 0.3, 0.22, 1] as const,
    roughness: 0.76,
    metallic: 0.04,
    occlusionStrength: 0.88,
  },
  route: {
    baseColor: [0.48, 0.43, 0.32, 1] as const,
    roughness: 0.62,
    metallic: 0.05,
    occlusionStrength: 0.82,
  },
} as const;

const TEMPLE_IDS: readonly MemoryTempleId[] = [
  "memory-temple-1",
  "memory-temple-2",
  "memory-temple-3",
];
const TEMPLE_DORMANT_SCALES: readonly Vec3[] = [
  [0.44, 0.25, 0.44],
  [0.26, 0.5, 0.26],
  [0.3, 0.34, 0.48],
];
const TEMPLE_ACTIVE_SCALES: readonly Vec3[] = [
  [0.24, 0.14, 0.24],
  [0.14, 0.28, 0.14],
  [0.17, 0.19, 0.27],
];
const TEMPLE_ORBITAL_RADII = [0.72, 0.86, 0.98] as const;
const TEMPLE_ORBITAL_SPEEDS = [0.36, 0.52, 0.68] as const;
const TEMPLE_ORBITAL_STRETCHES = [1.35, 1.75, 2.1] as const;

export function explorationLandmarkVisualState(
  snapshot: ExplorationSnapshot,
): ExplorationLandmarkVisualState {
  const activated = new Set(snapshot.activatedTempleIds);
  const stage = explorationWorldStage(snapshot);
  const beaconVisual =
    stage === "beacon-ready"
      ? {
          scale: [1.02, 1.34, 1.02] as Vec3,
          enabled: true,
          anchor: "beacon" as const,
          radius: 1.12,
          speed: 0.72,
          orbitalScale: 0.17,
        }
      : stage === "beacon-attuned"
        ? {
            scale: [0.62, 1.9, 0.62] as Vec3,
            enabled: true,
            anchor: "beacon" as const,
            radius: 0.58,
            speed: 1.18,
            orbitalScale: 0.13,
          }
        : stage === "sanctuary-returned"
          ? {
              scale: [0.46, 0.58, 0.46] as Vec3,
              enabled: true,
              anchor: "sanctuary" as const,
              radius: 0.86,
              speed: 0.52,
              orbitalScale: 0.15,
            }
          : {
              scale: [0.3, 0.36, 0.3] as Vec3,
              enabled: false,
              anchor: "beacon" as const,
              radius: 1.12,
              speed: 0.72,
              orbitalScale: 0,
            };
  return {
    stage,
    templeScales: TEMPLE_IDS.map((id, index) =>
      activated.has(id)
        ? TEMPLE_ACTIVE_SCALES[index]!
        : TEMPLE_DORMANT_SCALES[index]!,
    ),
    templeOrbitalEnabled: TEMPLE_IDS.map((id) => activated.has(id)),
    templeOrbitalRadii: TEMPLE_ORBITAL_RADII,
    templeOrbitalSpeeds: TEMPLE_ORBITAL_SPEEDS,
    templeOrbitalStretches: TEMPLE_ORBITAL_STRETCHES,
    beaconScale: beaconVisual.scale,
    beaconOrbitalEnabled: beaconVisual.enabled,
    beaconOrbitalAnchor: beaconVisual.anchor,
    beaconOrbitalRadius: beaconVisual.radius,
    beaconOrbitalSpeed: beaconVisual.speed,
    beaconOrbitalScale: beaconVisual.orbitalScale,
    sanctuarySignalEnabled: stage === "sanctuary-returned",
  };
}

export function landmarkPulseScale(
  base: number,
  elapsed: number,
  phaseOffset = 0,
): number {
  if (
    !Number.isFinite(base) ||
    !Number.isFinite(elapsed) ||
    !Number.isFinite(phaseOffset)
  )
    return 0;
  return Math.max(
    0,
    base * (1 + Math.sin(elapsed * 2.35 + phaseOffset) * 0.075),
  );
}

export function packProceduralInstanceTransforms(
  instances: readonly ProceduralInstanceTransform[],
): Float32Array {
  const transforms = new Float32Array(instances.length * 16);
  for (let index = 0; index < instances.length; index += 1) {
    const { pos, scale, yaw } = instances[index]!;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const offset = index * 16;
    transforms.set(
      [
        cosine * scale[0],
        0,
        -sine * scale[0],
        0,
        0,
        scale[1],
        0,
        0,
        sine * scale[2],
        0,
        cosine * scale[2],
        0,
        pos[0],
        pos[1],
        pos[2],
        1,
      ],
      offset,
    );
  }
  return transforms;
}

export function proceduralInstanceBatchAabb(
  localAabb: Float32Array,
  instances: readonly ProceduralInstanceTransform[],
): Float32Array {
  if (localAabb.length !== 6 || instances.length === 0)
    return new Float32Array(localAabb);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const { pos, scale, yaw } of instances) {
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    for (const x of [localAabb[0]!, localAabb[3]!] as const) {
      for (const y of [localAabb[1]!, localAabb[4]!] as const) {
        for (const z of [localAabb[2]!, localAabb[5]!] as const) {
          const scaledX = x * scale[0];
          const scaledZ = z * scale[2];
          const worldX = pos[0] + cosine * scaledX + sine * scaledZ;
          const worldY = pos[1] + y * scale[1];
          const worldZ = pos[2] - sine * scaledX + cosine * scaledZ;
          minX = Math.min(minX, worldX);
          minY = Math.min(minY, worldY);
          minZ = Math.min(minZ, worldZ);
          maxX = Math.max(maxX, worldX);
          maxY = Math.max(maxY, worldY);
          maxZ = Math.max(maxZ, worldZ);
        }
      }
    }
  }
  return new Float32Array([minX, minY, minZ, maxX, maxY, maxZ]);
}

function meshAsset(parts: MeshParts): MeshAsset {
  const vertices = new Float32Array(parts.positions.length * 12);
  const positions = new Float32Array(parts.positions.length * 3);
  const normals = new Float32Array(parts.normals.length * 3);
  const uvs = new Float32Array(parts.uvs.length * 2);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < parts.positions.length; index += 1) {
    const position = parts.positions[index]!;
    const normal = parts.normals[index]!;
    const uv = parts.uvs[index]!;
    positions.set(position, index * 3);
    normals.set(normal, index * 3);
    uvs.set(uv, index * 2);
    minX = Math.min(minX, position[0]);
    minY = Math.min(minY, position[1]);
    minZ = Math.min(minZ, position[2]);
    maxX = Math.max(maxX, position[0]);
    maxY = Math.max(maxY, position[1]);
    maxZ = Math.max(maxZ, position[2]);
  }
  const indices = new Uint16Array(parts.indices);
  const tangents = computeTangentVec4(positions, normals, uvs, indices);
  for (let index = 0; index < parts.positions.length; index += 1) {
    vertices.set(
      [
        positions[index * 3] ?? 0,
        positions[index * 3 + 1] ?? 0,
        positions[index * 3 + 2] ?? 0,
        normals[index * 3] ?? 0,
        normals[index * 3 + 1] ?? 1,
        normals[index * 3 + 2] ?? 0,
        uvs[index * 2] ?? 0,
        uvs[index * 2 + 1] ?? 0,
        tangents[index * 4] ?? 1,
        tangents[index * 4 + 1] ?? 0,
        tangents[index * 4 + 2] ?? 0,
        tangents[index * 4 + 3] ?? 1,
      ],
      index * 12,
    );
  }
  return {
    kind: "mesh",
    vertices,
    attributes: {
      position: positions,
      normal: normals,
      uv: uvs,
      tangent: tangents,
    },
    indices,
    submeshes: [
      {
        indexOffset: 0,
        indexCount: indices.length,
        vertexCount: parts.positions.length,
        topology: "triangle-list",
      },
    ],
    aabb: new Float32Array([minX, minY, minZ, maxX, maxY, maxZ]),
  };
}

export function islandMesh(): MeshAsset {
  const positions: Vec3[] = [[0, 0.015, 0]];
  const normals: Vec3[] = [[0, 1, 0]];
  const uvs: Vec2[] = [[0, 0]];
  const indices: number[] = [];
  const segments = 48;
  const rings = [3.2, 7.3, 11.7];
  for (let ring = 0; ring < rings.length; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU;
      const edgeNoise =
        ring === rings.length - 1
          ? Math.sin(angle * 5.0) * 0.75 + Math.sin(angle * 11.0 + 1.3) * 0.38
          : Math.sin(angle * 4.0 + ring) * 0.16;
      const radius = rings[ring]! + edgeNoise;
      const height =
        ring === 0
          ? 0.01
          : ring === 1
            ? Math.sin(angle * 3.0) * 0.035
            : -0.04 - Math.abs(Math.sin(angle * 4.0)) * 0.08;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 2.0;
      positions.push([x, height, z]);
      normals.push([0, 1, 0]);
      uvs.push([x / 3.5, z / 3.5]);
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, 1 + ((segment + 1) % segments), 1 + segment);
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const inner = 1 + ring * segments;
    const outer = inner + segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = inner + segment;
      const b = inner + next;
      const c = outer + segment;
      const d = outer + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  const outerStart = 1 + (rings.length - 1) * segments;
  const sideStart = positions.length;
  for (let segment = 0; segment < segments; segment += 1) {
    const top = positions[outerStart + segment]!;
    const angle = (segment / segments) * TAU;
    const outward: Vec3 = [Math.cos(angle), 0.12, Math.sin(angle)];
    positions.push(top, [
      top[0] * 0.82,
      -3.2 - Math.sin(angle * 3.0) * 0.45,
      top[2] * 0.82 - 0.35,
    ]);
    normals.push(outward, outward);
    uvs.push([segment / 6, 0], [segment / 6, 1]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const topA = sideStart + segment * 2;
    const bottomA = topA + 1;
    const topB = sideStart + next * 2;
    const bottomB = topB + 1;
    indices.push(topA, topB, bottomA, topB, bottomB, bottomA);
  }
  return meshAsset({ positions, normals, uvs, indices });
}

/** A shallow, worn route stone whose buried skirt removes the floating-cube read. */
export function steppingStoneMesh(): MeshAsset {
  const positions: Vec3[] = [[0, 0.035, 0]];
  const normals: Vec3[] = [[0, 1, 0]];
  const uvs: Vec2[] = [[0.5, 0.5]];
  const indices: number[] = [];
  const outline = [
    [-0.68, -0.5],
    [-0.34, -0.57],
    [0.08, -0.53],
    [0.55, -0.56],
    [0.74, -0.36],
    [0.78, -0.04],
    [0.7, 0.38],
    [0.38, 0.52],
    [-0.04, 0.49],
    [-0.49, 0.54],
    [-0.73, 0.34],
    [-0.77, 0.05],
    [-0.72, -0.24],
    [-0.61, -0.43],
  ] as const satisfies readonly Vec2[];
  const segments = outline.length;
  const topRing: Vec3[] = [];
  const bottomRing: Vec3[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * TAU;
    const [x, z] = outline[segment]!;
    const topY =
      0.012 + Math.sin(angle * 3 + 0.6) * 0.045 + Math.sin(angle * 7) * 0.018;
    const top: Vec3 = [x, topY, z];
    const bottom: Vec3 = [
      x * 0.96,
      -1.04 - Math.sin(angle * 4 + 0.2) * 0.08,
      z * 0.96,
    ];
    topRing.push(top);
    bottomRing.push(bottom);
    positions.push(top);
    normals.push([0, 1, 0]);
    uvs.push([x * 0.46 + 0.5, z * 0.46 + 0.5]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, 1 + ((segment + 1) % segments), 1 + segment);
  }
  const sideStart = positions.length;
  for (let segment = 0; segment < segments; segment += 1) {
    const top = topRing[segment]!;
    const bottom = bottomRing[segment]!;
    const inverseLength = 1 / Math.hypot(top[0], 0.2, top[2]);
    const normal: Vec3 = [
      top[0] * inverseLength,
      0.2 * inverseLength,
      top[2] * inverseLength,
    ];
    positions.push(top, bottom);
    normals.push(normal, normal);
    uvs.push([segment / 4, 0], [segment / 4, 1]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const topA = sideStart + segment * 2;
    const bottomA = topA + 1;
    const topB = sideStart + next * 2;
    const bottomB = topB + 1;
    indices.push(topA, topB, bottomA, topB, bottomB, bottomA);
  }
  return meshAsset({ positions, normals, uvs, indices });
}

/**
 * Unit-length authored route surface. Runtime instances scale and rotate this
 * continuous strip over each semantic route footprint, covering the repeated
 * stepping-stone read while leaving the authored collision entities intact.
 */
export function wornRouteRibbonMesh(): MeshAsset {
  const widths = [0.84, 0.93, 0.88, 0.97, 1, 0.92, 0.96, 0.89, 0.86] as const;
  const heights = [
    0.028, 0.038, 0.031, 0.045, 0.036, 0.041, 0.03, 0.039, 0.026,
  ] as const;
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: Vec2[] = [];
  const indices: number[] = [];
  for (let station = 0; station < widths.length; station += 1) {
    const z = -1 + (station / (widths.length - 1)) * 2;
    const width = widths[station]!;
    const y = heights[station]!;
    positions.push([-width, y, z], [width, y, z]);
    normals.push([0, 1, 0], [0, 1, 0]);
    uvs.push([0, station / 2], [1, station / 2]);
  }
  for (let station = 0; station < widths.length - 1; station += 1) {
    const left = station * 2;
    const nextLeft = left + 2;
    indices.push(left, nextLeft, left + 1, left + 1, nextLeft, nextLeft + 1);
  }
  for (const side of [-1, 1] as const) {
    const sideStart = positions.length;
    const normal: Vec3 = [side, 0.08, 0];
    for (let station = 0; station < widths.length; station += 1) {
      const z = -1 + (station / (widths.length - 1)) * 2;
      const x = widths[station]! * side;
      positions.push([x, heights[station]!, z], [x * 0.96, -0.18, z]);
      normals.push(normal, normal);
      uvs.push([station / 2, 0], [station / 2, 1]);
    }
    for (let station = 0; station < widths.length - 1; station += 1) {
      const top = sideStart + station * 2;
      const nextTop = top + 2;
      if (side < 0)
        indices.push(top, top + 1, nextTop, nextTop, top + 1, nextTop + 1);
      else indices.push(top, nextTop, top + 1, nextTop, nextTop + 1, top + 1);
    }
  }
  for (const end of [-1, 1] as const) {
    const station = end < 0 ? 0 : widths.length - 1;
    const width = widths[station]!;
    const y = heights[station]!;
    const z = end;
    const start = positions.length;
    positions.push(
      [-width, y, z],
      [width, y, z],
      [-width * 0.96, -0.18, z],
      [width * 0.96, -0.18, z],
    );
    const normal: Vec3 = [0, 0.08, end];
    normals.push(normal, normal, normal, normal);
    uvs.push([0, 0], [1, 0], [0, 1], [1, 1]);
    if (end < 0)
      indices.push(
        start,
        start + 1,
        start + 2,
        start + 1,
        start + 3,
        start + 2,
      );
    else
      indices.push(
        start,
        start + 2,
        start + 1,
        start + 1,
        start + 2,
        start + 3,
      );
  }
  return meshAsset({ positions, normals, uvs, indices });
}

export type RouteRibbonJunction = {
  readonly center: Vec2;
  readonly radius: number;
};

export type RouteRibbonSegment = RouteFootprint & {
  readonly sourceIndex: number;
};

export const ROUTE_RIBBON_JUNCTIONS: readonly RouteRibbonJunction[] = [
  { center: [0, -2.65], radius: 1.55 },
  { center: [-0.75, -8.15], radius: 1.45 },
] as const;

/** Clip route centerlines to the outside of junction discs before instancing. */
export function buildRouteRibbonLayout(
  footprints: readonly RouteFootprint[],
  junctions: readonly RouteRibbonJunction[] = ROUTE_RIBBON_JUNCTIONS,
): {
  readonly segments: readonly RouteRibbonSegment[];
  readonly junctions: readonly RouteRibbonJunction[];
} {
  const segments: RouteRibbonSegment[] = [];
  for (let sourceIndex = 0; sourceIndex < footprints.length; sourceIndex += 1) {
    const footprint = footprints[sourceIndex]!;
    const dx = footprint.end[0] - footprint.start[0];
    const dz = footprint.end[1] - footprint.start[1];
    const lengthSquared = dx * dx + dz * dz;
    let intervals: Array<readonly [number, number]> = [[0, 1]];
    for (const junction of junctions) {
      const offsetX = footprint.start[0] - junction.center[0];
      const offsetZ = footprint.start[1] - junction.center[1];
      const b = 2 * (offsetX * dx + offsetZ * dz);
      const c =
        offsetX * offsetX +
        offsetZ * offsetZ -
        junction.radius * junction.radius;
      const discriminant = b * b - 4 * lengthSquared * c;
      if (lengthSquared <= 1e-8 || discriminant <= 0) continue;
      const root = Math.sqrt(discriminant);
      const insideStart = Math.max(0, (-b - root) / (2 * lengthSquared));
      const insideEnd = Math.min(1, (-b + root) / (2 * lengthSquared));
      if (insideEnd <= insideStart) continue;
      const next: Array<readonly [number, number]> = [];
      for (const [start, end] of intervals) {
        if (insideEnd <= start || insideStart >= end) {
          next.push([start, end]);
          continue;
        }
        if (insideStart - start > 1e-5)
          next.push([start, Math.min(end, insideStart)]);
        if (end - insideEnd > 1e-5)
          next.push([Math.max(start, insideEnd), end]);
      }
      intervals = next;
    }
    for (const [startT, endT] of intervals) {
      if ((endT - startT) * Math.sqrt(lengthSquared) <= 0.05) continue;
      segments.push({
        sourceIndex,
        start: [
          footprint.start[0] + dx * startT,
          footprint.start[1] + dz * startT,
        ],
        end: [footprint.start[0] + dx * endT, footprint.start[1] + dz * endT],
        halfWidth: footprint.halfWidth,
      });
    }
  }
  return { segments, junctions };
}

function routeJunctionMesh(): MeshAsset {
  const segments = 24;
  const positions: Vec3[] = [[0, 0.04, 0]];
  const normals: Vec3[] = [[0, 1, 0]];
  const uvs: Vec2[] = [[0.5, 0.5]];
  const indices: number[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * TAU;
    const radius = 0.96 + Math.sin(segment * 2.7) * 0.025;
    positions.push([Math.cos(angle) * radius, 0.018, Math.sin(angle) * radius]);
    normals.push([0, 1, 0]);
    uvs.push([Math.cos(angle) * 0.5 + 0.5, Math.sin(angle) * 0.5 + 0.5]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
  }
  const sideStart = positions.length;
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * TAU;
    const radius = 0.96 + Math.sin(segment * 2.7) * 0.025;
    const normal: Vec3 = [Math.cos(angle), 0.08, Math.sin(angle)];
    positions.push(
      [Math.cos(angle) * radius, 0.018, Math.sin(angle) * radius],
      [Math.cos(angle) * radius * 0.97, -0.18, Math.sin(angle) * radius * 0.97],
    );
    normals.push(normal, normal);
    uvs.push([segment / segments, 0], [segment / segments, 1]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const top = sideStart + segment * 2;
    const nextTop = sideStart + next * 2;
    indices.push(top, top + 1, nextTop, nextTop, top + 1, nextTop + 1);
  }
  return meshAsset({ positions, normals, uvs, indices });
}

export function heroTerraceTopContains(
  localX: number,
  localZ: number,
): boolean {
  const normalizedX = Math.abs(localX) / LAST_LIGHT_TERRACE.radiusX;
  const normalizedZ = Math.abs(localZ) / LAST_LIGHT_TERRACE.radiusZ;
  return (
    normalizedX ** LAST_LIGHT_TERRACE.superellipsePower +
      normalizedZ ** LAST_LIGHT_TERRACE.superellipsePower <=
    1
  );
}

/**
 * A low, tapered observatory terrace with a rounded-stone footprint. The top
 * uses a sixth-power superellipse rather than an ellipse so the aligned static
 * cuboid remains wholly backed by visible geometry, including at its corners.
 */
export function heroTerraceMesh(): MeshAsset {
  const positions: Vec3[] = [[0, 0, 0]];
  const normals: Vec3[] = [[0, 1, 0]];
  const uvs: Vec2[] = [[0, 0]];
  const indices: number[] = [];
  const segments = 32;
  const topRing: Vec3[] = [];
  const bottomRing: Vec3[] = [];

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * TAU;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const superellipseX =
      Math.sign(cosine) *
      Math.abs(cosine) ** (2 / LAST_LIGHT_TERRACE.superellipsePower);
    const superellipseZ =
      Math.sign(sine) *
      Math.abs(sine) ** (2 / LAST_LIGHT_TERRACE.superellipsePower);
    const edgeScale =
      1 + (Math.sin(angle * 5 + 0.7) + Math.sin(angle * 11 + 1.9) + 2) * 0.015;
    const top: Vec3 = [
      superellipseX * LAST_LIGHT_TERRACE.radiusX * edgeScale,
      0,
      superellipseZ * LAST_LIGHT_TERRACE.radiusZ * edgeScale,
    ];
    const bottom: Vec3 = [
      top[0] * 0.86,
      -2.12 - (Math.sin(angle * 3 + 0.4) + 1) * 0.11,
      top[2] * 0.86,
    ];
    topRing.push(top);
    bottomRing.push(bottom);
    positions.push(top);
    normals.push([0, 1, 0]);
    uvs.push([top[0] / 3.5, top[2] / 3.5]);
  }

  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, 1 + ((segment + 1) % segments), 1 + segment);
  }

  const sideStart = positions.length;
  for (let segment = 0; segment < segments; segment += 1) {
    const top = topRing[segment]!;
    const bottom = bottomRing[segment]!;
    const nx = top[0] / LAST_LIGHT_TERRACE.radiusX;
    const nz = top[2] / LAST_LIGHT_TERRACE.radiusZ;
    const inverseLength = 1 / Math.hypot(nx, 0.18, nz);
    const sideNormal: Vec3 = [
      nx * inverseLength,
      0.18 * inverseLength,
      nz * inverseLength,
    ];
    positions.push(top, bottom);
    normals.push(sideNormal, sideNormal);
    uvs.push([segment / 5, 0], [segment / 5, 1]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const topA = sideStart + segment * 2;
    const bottomA = topA + 1;
    const topB = sideStart + next * 2;
    const bottomB = topB + 1;
    indices.push(topA, topB, bottomA, topB, bottomB, bottomA);
  }

  const bottomCenter = positions.length;
  positions.push([0, -2.23, 0]);
  normals.push([0, -1, 0]);
  uvs.push([0, 0]);
  const bottomStart = positions.length;
  for (const bottom of bottomRing) {
    positions.push(bottom);
    normals.push([0, -1, 0]);
    uvs.push([bottom[0] / 3.5, bottom[2] / 3.5]);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(
      bottomCenter,
      bottomStart + segment,
      bottomStart + ((segment + 1) % segments),
    );
  }

  return meshAsset({ positions, normals, uvs, indices });
}

export function lastLightCausewayTopContains(
  localX: number,
  localZ: number,
): boolean {
  if (!Number.isFinite(localX) || !Number.isFinite(localZ)) return false;
  const first = LAST_LIGHT_CAUSEWAY_STATIONS[0]!;
  const last =
    LAST_LIGHT_CAUSEWAY_STATIONS[LAST_LIGHT_CAUSEWAY_STATIONS.length - 1]!;
  if (localZ < first.z || localZ > last.z) return false;
  for (
    let index = 0;
    index < LAST_LIGHT_CAUSEWAY_STATIONS.length - 1;
    index += 1
  ) {
    const start = LAST_LIGHT_CAUSEWAY_STATIONS[index]!;
    const end = LAST_LIGHT_CAUSEWAY_STATIONS[index + 1]!;
    if (localZ > end.z) continue;
    const t = (localZ - start.z) / (end.z - start.z);
    const halfWidth = start.halfWidth + (end.halfWidth - start.halfWidth) * t;
    return Math.abs(localX) <= halfWidth;
  }
  return false;
}

/** Visible stone underlay for the physical route between island and terrace. */
export function lastLightCausewayMesh(): MeshAsset {
  const topRing: Vec3[] = [
    ...LAST_LIGHT_CAUSEWAY_STATIONS.map((station): Vec3 => [
      station.halfWidth,
      0,
      station.z,
    ]),
    ...[...LAST_LIGHT_CAUSEWAY_STATIONS]
      .reverse()
      .map((station): Vec3 => [-station.halfWidth, 0, station.z]),
  ];
  const positions: Vec3[] = [[0, 0, 0], ...topRing];
  const normals: Vec3[] = [[0, 1, 0], ...topRing.map((): Vec3 => [0, 1, 0])];
  const uvs: Vec2[] = [
    [0, 0],
    ...topRing.map((point): Vec2 => [point[0] / 2, point[2] / 2]),
  ];
  const indices: number[] = [];
  for (let index = 0; index < topRing.length; index += 1) {
    indices.push(0, 1 + ((index + 1) % topRing.length), 1 + index);
  }

  const sideStart = positions.length;
  for (let index = 0; index < topRing.length; index += 1) {
    const current = topRing[index]!;
    const next = topRing[(index + 1) % topRing.length]!;
    const dx = next[0] - current[0];
    const dz = next[2] - current[2];
    const inverseLength = 1 / Math.hypot(dz, 0.14, -dx);
    const outward: Vec3 = [
      dz * inverseLength,
      0.14 * inverseLength,
      -dx * inverseLength,
    ];
    positions.push(current, [current[0] * 0.88, -0.64, current[2] * 0.98]);
    normals.push(outward, outward);
    uvs.push([index / 3, 0], [index / 3, 1]);
  }
  for (let index = 0; index < topRing.length; index += 1) {
    const next = (index + 1) % topRing.length;
    const topA = sideStart + index * 2;
    const bottomA = topA + 1;
    const topB = sideStart + next * 2;
    const bottomB = topB + 1;
    indices.push(topA, topB, bottomA, topB, bottomB, bottomA);
  }
  return meshAsset({ positions, normals, uvs, indices });
}

function irregularStackMesh(
  segments: number,
  rings: readonly { y: number; radius: number; x?: number; z?: number }[],
  seed: number,
): MeshAsset {
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: Vec2[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring < rings.length; ring += 1) {
    const spec = rings[ring]!;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU;
      const wobble =
        1 +
        Math.sin(angle * 3 + seed * 1.91 + ring * 0.73) * 0.11 +
        Math.sin(angle * 7 + seed) * 0.045;
      const radius = spec.radius * wobble;
      const x = (spec.x ?? 0) + Math.cos(angle) * radius;
      const z = (spec.z ?? 0) + Math.sin(angle) * radius;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      positions.push([x, spec.y + Math.sin(angle * 5 + seed) * 0.025, z]);
      normals.push([nx, 0.18, nz]);
      uvs.push([
        (segment / segments) * 2,
        ring / Math.max(1, rings.length - 1),
      ]);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const current = ring * segments;
    const nextRing = current + segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(current + segment, current + next, nextRing + segment);
      indices.push(current + next, nextRing + next, nextRing + segment);
    }
  }
  const bottom = positions.length;
  positions.push([0, rings[0]!.y, 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0.5]);
  const top = positions.length;
  positions.push([0, rings[rings.length - 1]!.y, 0]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 0.5]);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(bottom, segment, next);
    const topRing = (rings.length - 1) * segments;
    indices.push(top, topRing + next, topRing + segment);
  }
  return meshAsset({ positions, normals, uvs, indices });
}

function crystalMesh(): MeshAsset {
  return irregularStackMesh(
    7,
    [
      { y: -0.55, radius: 0.34 },
      { y: 0.22, radius: 0.55 },
      { y: 0.72, radius: 0.28 },
      { y: 1.15, radius: 0.03 },
    ],
    7.4,
  );
}

function makeFallbackTexture(size: number): TextureAsset {
  const pixels = new Uint8Array(size * size * 4);
  const heightAt = (x: number, y: number): number => {
    const u = ((((x % size) + size) % size) / size) * TAU;
    const v = ((((y % size) + size) % size) / size) * TAU;
    return (
      0.52 +
      Math.sin(u * 2 + Math.sin(v * 3)) * 0.16 +
      Math.cos(v * 3 - Math.sin(u * 2)) * 0.13 +
      Math.sin((u + v) * 7) * 0.045
    );
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const height = heightAt(x, y);
      const shade = Math.max(0, Math.min(1, height));
      const moss = Math.max(0, height - 0.64) * 0.45;
      pixels[offset] = Math.round(43 + shade * 42 - moss * 12);
      pixels[offset + 1] = Math.round(49 + shade * 41 + moss * 34);
      pixels[offset + 2] = Math.round(57 + shade * 45 + moss * 8);
      pixels[offset + 3] = 255;
    }
  }
  return {
    kind: "texture",
    width: size,
    height: size,
    format: "rgba8unorm-srgb",
    data: pixels,
    colorSpace: "srgb",
    mipmap: true,
  };
}

async function authoredTextureHandle(
  world: World,
  host: BootstrapContext | undefined,
  guidText: string,
  label: string,
): Promise<Handle<"TextureAsset", "shared"> | undefined> {
  const guid = AssetGuid.parse(guidText);
  if (!guid.ok || host?.assets === undefined) return undefined;
  const loaded = await host.assets.loadByGuid<TextureAsset>(guid.value);
  if (!loaded.ok) {
    console.warn(
      `[aetherfall] ${label} texture unavailable: ${loaded.error.code} — ${loaded.error.hint}`,
    );
    return undefined;
  }
  return world.allocSharedRef("TextureAsset", loaded.value);
}

async function textureHandle(
  world: World,
  renderer: Renderer,
  texture: TextureAsset,
): Promise<Handle<"TextureAsset", "shared"> | undefined> {
  const handle = world.allocSharedRef("TextureAsset", texture);
  try {
    const uploaded = await renderer.store.uploadTexture(handle, texture, {
      bytes: texture.data,
      width: texture.width,
      height: texture.height,
      mime: "image/png",
      colorSpace: texture.colorSpace,
      mipmap: texture.mipmap,
    });
    if (uploaded.ok) return handle;
    world.sharedRefs.release(handle).unwrap();
    return undefined;
  } catch (error) {
    world.sharedRefs.release(handle).unwrap();
    throw error;
  }
}

function authoredEntity(
  world: World,
  loaded:
    | {
        readonly nodes: readonly {
          readonly localId: number;
          readonly components: Record<string, unknown>;
        }[];
        readonly mapping: ReadonlyMap<number, EntityHandle>;
      }
    | null
    | undefined,
  name: string,
): EntityHandle | undefined {
  const node = loaded?.nodes.find(
    (candidate) =>
      (candidate.components.Name as { value?: string } | undefined)?.value ===
      name,
  );
  return node === undefined ? undefined : loaded?.mapping.get(node.localId);
}

function spawnRenderable(
  world: World,
  mesh: Handle<"MeshAsset", "shared">,
  material: Handle<"MaterialAsset", "shared">,
  pos: Vec3,
  scale: Vec3,
  yaw = 0,
): EntityHandle {
  const half = yaw * 0.5;
  return world
    .spawn(
      {
        component: Transform,
        data: { pos, quat: [0, Math.sin(half), 0, Math.cos(half)], scale },
      },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
    )
    .unwrap();
}

function spawnInstancedRenderable(
  world: World,
  mesh: Handle<"MeshAsset", "shared">,
  material: Handle<"MaterialAsset", "shared">,
  instances: readonly ProceduralInstanceTransform[],
): EntityHandle {
  return world
    .spawn(
      {
        component: Transform,
        data: { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
      {
        component: Instances,
        data: { transforms: packProceduralInstanceTransforms(instances) },
      },
    )
    .unwrap();
}

export function spawnStaticCollider(
  world: World,
  pos: Vec3,
  scale: Vec3,
  halfExtents: Vec3,
  yaw = 0,
): EntityHandle {
  const half = yaw * 0.5;
  return world
    .spawn(
      {
        component: Transform,
        data: { pos, quat: [0, Math.sin(half), 0, Math.cos(half)], scale },
      },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      {
        component: Collider,
        data: {
          shape: ColliderShapeValue.cuboid,
          halfExtents,
          friction: 0.82,
          restitution: 0,
        },
      },
    )
    .unwrap();
}

/** Replace the graybox surface with a deterministic, textured exploration set. */
export async function createProceduralWorld(args: {
  readonly world: World;
  readonly host: BootstrapContext | undefined;
  readonly loaded:
    | {
        readonly nodes: readonly {
          readonly localId: number;
          readonly components: Record<string, unknown>;
        }[];
        readonly mapping: ReadonlyMap<number, EntityHandle>;
      }
    | null
    | undefined;
}): Promise<ProceduralWorldHandle | undefined> {
  const { world, host, loaded } = args;
  const renderer = host?.renderer;
  if (renderer === undefined) return undefined;

  const ownedSharedHandles: SharedAssetHandle[] = [];
  const spawned: EntityHandle[] = [];
  const rollbackSteps: Array<{
    readonly rollback: () => void;
    readonly retainedSharedHandles: SharedAssetHandle[];
    restored: boolean;
  }> = [];
  let animationSystemInstalled = false;
  const cleanup = (): void => {
    const errors: unknown[] = [];
    if (animationSystemInstalled) {
      try {
        const result = world.removeSystem(
          Update,
          "aetherfall-landmark-animation",
        );
        if (result.ok) animationSystemInstalled = false;
        else errors.push(result.error);
      } catch (error) {
        errors.push(error);
      }
    }
    for (let index = spawned.length - 1; index >= 0; index -= 1) {
      const entity = spawned[index]!;
      try {
        if (!world.get(entity, Transform).ok) {
          spawned.splice(index, 1);
          continue;
        }
        const result = world.despawn(entity);
        if (result.ok) spawned.splice(index, 1);
        else errors.push(result.error);
      } catch (error) {
        try {
          if (!world.get(entity, Transform).ok) spawned.splice(index, 1);
        } catch {
          // Retain ownership for a later retry when liveness cannot be observed.
        }
        errors.push(error);
      }
    }
    for (let index = rollbackSteps.length - 1; index >= 0; index -= 1) {
      const step = rollbackSteps[index]!;
      if (!step.restored) {
        try {
          step.rollback();
          step.restored = true;
        } catch (error) {
          errors.push(error);
          continue;
        }
      }
      for (
        let handleIndex = step.retainedSharedHandles.length - 1;
        handleIndex >= 0;
        handleIndex -= 1
      ) {
        try {
          const result = world.sharedRefs.release(
            step.retainedSharedHandles[handleIndex]!,
          );
          if (result.ok) step.retainedSharedHandles.splice(handleIndex, 1);
          else errors.push(result.error);
        } catch (error) {
          errors.push(error);
        }
      }
      if (step.retainedSharedHandles.length === 0)
        rollbackSteps.splice(index, 1);
    }
    for (let index = ownedSharedHandles.length - 1; index >= 0; index -= 1) {
      try {
        const result = world.sharedRefs.release(ownedSharedHandles[index]!);
        if (result.ok) ownedSharedHandles.splice(index, 1);
        else errors.push(result.error);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(errors, "Procedural world cleanup failed");
  };
  const cleanupOwner: ResidualCleanupOwner = {
    label: "procedural world",
    hasPending: () =>
      animationSystemInstalled ||
      spawned.length > 0 ||
      rollbackSteps.length > 0 ||
      ownedSharedHandles.length > 0,
    dispose: cleanup,
  };
  const ownSharedHandle = <Target extends string>(
    handle: Handle<Target, "shared">,
  ): Handle<Target, "shared"> => {
    ownedSharedHandles.push(handle);
    return handle;
  };
  const registerRestoration = (
    handles: readonly SharedAssetHandle[],
    rollback: () => void,
  ): void => {
    const step = {
      rollback,
      retainedSharedHandles: [] as SharedAssetHandle[],
      restored: false,
    };
    rollbackSteps.push(step);
    for (const handle of handles) {
      world.sharedRefs.retain(handle).unwrap();
      step.retainedSharedHandles.push(handle);
    }
  };

  try {
    const textureResults = await Promise.allSettled([
      authoredTextureHandle(world, host, BASALT_TEXTURE_GUID, "basalt"),
      authoredTextureHandle(world, host, RUIN_STONE_TEXTURE_GUID, "ruin stone"),
      authoredTextureHandle(world, host, BASALT_NORMAL_GUID, "basalt normal"),
      authoredTextureHandle(
        world,
        host,
        BASALT_METALLIC_ROUGHNESS_GUID,
        "basalt metallic roughness",
      ),
      authoredTextureHandle(
        world,
        host,
        BASALT_AO_GUID,
        "basalt ambient occlusion",
      ),
      authoredTextureHandle(world, host, RUIN_NORMAL_GUID, "ruin normal"),
      authoredTextureHandle(
        world,
        host,
        RUIN_METALLIC_ROUGHNESS_GUID,
        "ruin metallic roughness",
      ),
      authoredTextureHandle(
        world,
        host,
        RUIN_AO_GUID,
        "ruin ambient occlusion",
      ),
    ]);
    for (const result of textureResults) {
      if (result.status === "fulfilled" && result.value !== undefined)
        ownedSharedHandles.push(result.value);
    }
    const rejectedTexture = textureResults.find(
      (result) => result.status === "rejected",
    );
    if (rejectedTexture?.status === "rejected") throw rejectedTexture.reason;
    const [
      importedStoneTexture,
      ruinTexture,
      basaltNormal,
      basaltMetallicRoughness,
      basaltAo,
      ruinNormal,
      ruinMetallicRoughness,
      ruinAo,
    ] = textureResults.map((result) =>
      result.status === "fulfilled" ? result.value : undefined,
    );
    const stoneTexture =
      importedStoneTexture ??
      (await textureHandle(world, renderer, makeFallbackTexture(128)));
    if (importedStoneTexture === undefined && stoneTexture !== undefined)
      ownedSharedHandles.push(stoneTexture);
    const groundIdentity = PROCEDURAL_MATERIAL_IDENTITY.ground;
    const stoneMaterial = ownSharedHandle(
      world.allocSharedRef<"MaterialAsset", MaterialAsset>(
        "MaterialAsset",
        Materials.standard({
          baseColor: [...groundIdentity.baseColor],
          roughness: groundIdentity.roughness,
          metallic: groundIdentity.metallic,
          ...(stoneTexture === undefined
            ? {}
            : { baseColorTexture: unwrapHandle(stoneTexture) }),
          ...(basaltNormal === undefined
            ? {}
            : { normalTexture: unwrapHandle(basaltNormal) }),
          ...(basaltMetallicRoughness === undefined
            ? {}
            : {
                metallicRoughnessTexture: unwrapHandle(basaltMetallicRoughness),
              }),
          ...(basaltAo === undefined
            ? {}
            : {
                occlusionTexture: unwrapHandle(basaltAo),
                occlusionStrength: groundIdentity.occlusionStrength,
              }),
        }),
      ),
    );
    const cliffIdentity = PROCEDURAL_MATERIAL_IDENTITY.cliff;
    const cliffMaterial = ownSharedHandle(
      world.allocSharedRef<"MaterialAsset", MaterialAsset>(
        "MaterialAsset",
        Materials.standard({
          baseColor: [...cliffIdentity.baseColor],
          roughness: cliffIdentity.roughness,
          metallic: cliffIdentity.metallic,
          ...(stoneTexture === undefined
            ? {}
            : { baseColorTexture: unwrapHandle(stoneTexture) }),
          ...(basaltNormal === undefined
            ? {}
            : { normalTexture: unwrapHandle(basaltNormal) }),
          ...(basaltMetallicRoughness === undefined
            ? {}
            : {
                metallicRoughnessTexture: unwrapHandle(basaltMetallicRoughness),
              }),
          ...(basaltAo === undefined
            ? {}
            : {
                occlusionTexture: unwrapHandle(basaltAo),
                occlusionStrength: cliffIdentity.occlusionStrength,
              }),
        }),
      ),
    );
    const ruinIdentity = PROCEDURAL_MATERIAL_IDENTITY.ruin;
    const ruinMaterial = ownSharedHandle(
      world.allocSharedRef<"MaterialAsset", MaterialAsset>(
        "MaterialAsset",
        Materials.standard({
          baseColor: [...ruinIdentity.baseColor],
          roughness: ruinIdentity.roughness,
          metallic: ruinIdentity.metallic,
          ...(ruinTexture === undefined
            ? {}
            : { baseColorTexture: unwrapHandle(ruinTexture) }),
          ...(ruinNormal === undefined
            ? {}
            : { normalTexture: unwrapHandle(ruinNormal) }),
          ...(ruinMetallicRoughness === undefined
            ? {}
            : {
                metallicRoughnessTexture: unwrapHandle(ruinMetallicRoughness),
              }),
          ...(ruinAo === undefined
            ? {}
            : {
                occlusionTexture: unwrapHandle(ruinAo),
                occlusionStrength: ruinIdentity.occlusionStrength,
              }),
        }),
      ),
    );
    const routeIdentity = PROCEDURAL_MATERIAL_IDENTITY.route;
    const routeMaterial = ownSharedHandle(
      world.allocSharedRef<"MaterialAsset", MaterialAsset>(
        "MaterialAsset",
        Materials.standard({
          baseColor: [...routeIdentity.baseColor],
          roughness: routeIdentity.roughness,
          metallic: routeIdentity.metallic,
          emissive: [0.012, 0.027, 0.025],
          emissiveIntensity: 0.16,
          ...(ruinTexture === undefined
            ? {}
            : { baseColorTexture: unwrapHandle(ruinTexture) }),
          ...(ruinNormal === undefined
            ? {}
            : { normalTexture: unwrapHandle(ruinNormal) }),
          ...(ruinMetallicRoughness === undefined
            ? {}
            : {
                metallicRoughnessTexture: unwrapHandle(ruinMetallicRoughness),
              }),
          ...(ruinAo === undefined
            ? {}
            : {
                occlusionTexture: unwrapHandle(ruinAo),
                occlusionStrength: routeIdentity.occlusionStrength,
              }),
        }),
      ),
    );
    const crystalMaterials = [
      [0.035, 0.22, 0.62] as const,
      [0.58, 0.045, 0.24] as const,
      [0.68, 0.27, 0.035] as const,
    ].map((color) =>
      ownSharedHandle(
        world.allocSharedRef<"MaterialAsset", MaterialAsset>(
          "MaterialAsset",
          Materials.standard({
            baseColor: [color[0], color[1], color[2], 1],
            roughness: 0.24,
            metallic: 0.16,
            emissive: color,
            emissiveIntensity: 1.15,
            castShadow: false,
          }),
        ),
      ),
    );

    const island = islandMesh();
    const heroTerrace = heroTerraceMesh();
    const lastLightCauseway = lastLightCausewayMesh();
    const steppingStone = steppingStoneMesh();
    const routeRibbon = wornRouteRibbonMesh();
    const routeJunction = routeJunctionMesh();
    const rocks = [
      irregularStackMesh(
        9,
        [
          { y: -0.75, radius: 0.8 },
          { y: -0.1, radius: 1 },
          { y: 0.5, radius: 0.7 },
          { y: 0.86, radius: 0.4 },
        ],
        2.7,
      ),
      irregularStackMesh(
        10,
        [
          { y: -0.7, radius: 0.72 },
          { y: -0.2, radius: 1.08 },
          { y: 0.28, radius: 0.84 },
          { y: 0.72, radius: 0.5 },
          { y: 0.96, radius: 0.34 },
        ],
        5.2,
      ),
      irregularStackMesh(
        11,
        [
          { y: -0.82, radius: 0.9 },
          { y: -0.08, radius: 0.84 },
          { y: 0.38, radius: 0.96 },
          { y: 0.74, radius: 0.62 },
          { y: 0.9, radius: 0.44 },
        ],
        8.9,
      ),
    ] as const;
    const crystal = crystalMesh();
    const islandHandle = ownSharedHandle(
      world.allocSharedRef("MeshAsset", island),
    );
    const crystalHandle = ownSharedHandle(
      world.allocSharedRef("MeshAsset", crystal),
    );
    const steppingStoneHandle = ownSharedHandle(
      world.allocSharedRef("MeshAsset", steppingStone),
    );
    renderer.store.ensureResident?.(islandHandle, island);
    renderer.store.ensureResident?.(crystalHandle, crystal);
    renderer.store.ensureResident?.(steppingStoneHandle, steppingStone);

    const staticInstanceBatches = new Map<
      string,
      {
        readonly mesh: MeshAsset;
        readonly material: Handle<"MaterialAsset", "shared">;
        readonly instances: ProceduralInstanceTransform[];
      }
    >();
    const queueStaticInstance = (
      key: string,
      mesh: MeshAsset,
      material: Handle<"MaterialAsset", "shared">,
      pos: Vec3,
      scale: Vec3,
      yaw = 0,
    ): void => {
      const existing = staticInstanceBatches.get(key);
      const instance = { pos, scale, yaw };
      if (existing === undefined) {
        staticInstanceBatches.set(key, {
          mesh,
          material,
          instances: [instance],
        });
      } else {
        existing.instances.push(instance);
      }
    };
    const ground = authoredEntity(world, loaded, "Ground");
    const oldGroundMesh =
      ground === undefined ? undefined : world.get(ground, MeshFilter);
    const oldGroundRenderer =
      ground === undefined ? undefined : world.get(ground, MeshRenderer);
    const oldGroundMaterials = oldGroundRenderer?.ok
      ? [...oldGroundRenderer.value.materials]
      : undefined;
    const oldGroundTransform =
      ground === undefined ? undefined : world.get(ground, Transform);
    const oldGroundTransformData:
      ComponentData<typeof Transform.schema>["data"] | undefined =
      oldGroundTransform?.ok
        ? {
            pos: Array.from(oldGroundTransform.value.pos),
            quat: Array.from(oldGroundTransform.value.quat),
            scale: Array.from(oldGroundTransform.value.scale),
            world: Array.from(oldGroundTransform.value.world),
          }
        : undefined;
    if (ground !== undefined) {
      registerRestoration(
        [
          ...(oldGroundMesh?.ok ? [oldGroundMesh.value.assetHandle] : []),
          ...(oldGroundMaterials ?? []),
        ],
        () => {
          if (oldGroundMesh?.ok)
            world
              .set(ground, MeshFilter, {
                assetHandle: oldGroundMesh.value.assetHandle,
              })
              .unwrap();
          else if (world.get(ground, MeshFilter).ok)
            world.removeComponent(ground, MeshFilter).unwrap();
          if (oldGroundMaterials !== undefined)
            world
              .set(ground, MeshRenderer, { materials: oldGroundMaterials })
              .unwrap();
          else if (world.get(ground, MeshRenderer).ok)
            world.removeComponent(ground, MeshRenderer).unwrap();
          if (oldGroundTransformData !== undefined)
            world.set(ground, Transform, oldGroundTransformData).unwrap();
          else if (world.get(ground, Transform).ok)
            world.removeComponent(ground, Transform).unwrap();
        },
      );
      world.set(ground, MeshFilter, { assetHandle: islandHandle });
      world.set(ground, MeshRenderer, { materials: [stoneMaterial] });
      world.set(ground, Transform, {
        pos: [0, 0, 0],
        quat: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
    }

    const routeNames = [
      "StonePath01",
      "StonePath02",
      "StonePath03",
      "StormBridgeDeckA",
      "StormBridgeDeckB",
      "StormBridgeDeckC",
    ] as const;
    for (const name of routeNames) {
      const entity = authoredEntity(world, loaded, name);
      if (entity === undefined) continue;
      const meshState = world.get(entity, MeshFilter);
      const rendererState = world.get(entity, MeshRenderer);
      if (!meshState.ok || !rendererState.ok) continue;
      const oldMaterials = [...rendererState.value.materials];
      registerRestoration(
        [meshState.value.assetHandle, ...oldMaterials],
        () => {
          world
            .set(entity, MeshFilter, {
              assetHandle: meshState.value.assetHandle,
            })
            .unwrap();
          world.set(entity, MeshRenderer, { materials: oldMaterials }).unwrap();
        },
      );
      world.set(entity, MeshFilter, { assetHandle: steppingStoneHandle });
      world.set(entity, MeshRenderer, { materials: [routeMaterial] });
    }
    const routeLayout = buildRouteRibbonLayout(EXPLORATION_ROUTE_FOOTPRINTS);
    for (const route of routeLayout.segments) {
      const dx = route.end[0] - route.start[0];
      const dz = route.end[1] - route.start[1];
      const length = Math.hypot(dx, dz);
      queueStaticInstance(
        "opening-route-ribbon",
        routeRibbon,
        routeMaterial,
        [
          (route.start[0] + route.end[0]) * 0.5,
          0.105,
          (route.start[1] + route.end[1]) * 0.5,
        ],
        [route.halfWidth * 0.82, 1, length * 0.5],
        Math.atan2(dx, dz),
      );
    }
    for (const junction of routeLayout.junctions) {
      queueStaticInstance(
        "opening-route-junction",
        routeJunction,
        routeMaterial,
        [junction.center[0], 0.105, junction.center[1]],
        [junction.radius, 1, junction.radius],
      );
    }

    for (const node of loaded?.nodes ?? []) {
      const name =
        (node.components.Name as { value?: string } | undefined)?.value ?? "";
      const replaceEntirely =
        /(Tree.*(?:Trunk|Canopy)|LuminousTree.*(?:Trunk|Canopy)|Sanctuary(?:Return|ReturnRing|Island(?:Shelf|Core)|Cliff)|ForestRuin.*Low|ShrineAArch|ShrineBSpire|ShrineCObelisk|StormBridgePylon|PathMarker|Shrine.*Waystone|RuinArch|BeaconObservatoryIsland|AncientObservatoryDome|ObservatoryAperture|ObservatoryColumn|LastLightBeacon(?:Crown)?)/.test(
          name,
        );
      if (!replaceEntirely) continue;
      const entity = loaded?.mapping.get(node.localId);
      if (entity === undefined) continue;
      const meshRenderer = world.get(entity, MeshRenderer);
      if (!meshRenderer.ok) continue;
      const collider = world.get(entity, Collider);
      const rigidBody = world.get(entity, RigidBody);
      const oldRenderer: ComponentData<typeof MeshRenderer.schema> = {
        component: MeshRenderer,
        data: { materials: [...meshRenderer.value.materials] },
      };
      const oldCollider: ComponentData<typeof Collider.schema> | undefined =
        collider.ok
          ? {
              component: Collider,
              data: {
                shape: collider.value.shape,
                halfExtents: Array.from(collider.value.halfExtents),
                radius: collider.value.radius,
                halfHeight: collider.value.halfHeight,
                friction: collider.value.friction,
                restitution: collider.value.restitution,
                density: collider.value.density,
                isSensor: collider.value.isSensor,
                collisionGroups: collider.value.collisionGroups,
                solverGroups: collider.value.solverGroups,
              },
            }
          : undefined;
      const oldRigidBody: ComponentData<typeof RigidBody.schema> | undefined =
        rigidBody.ok
          ? {
              component: RigidBody,
              data: {
                type: rigidBody.value.type,
                mass: rigidBody.value.mass,
                linearDamping: rigidBody.value.linearDamping,
                angularDamping: rigidBody.value.angularDamping,
                gravityScale: rigidBody.value.gravityScale,
                ccdEnabled: rigidBody.value.ccdEnabled,
              },
            }
          : undefined;
      registerRestoration(meshRenderer.value.materials, () => {
        if (!world.get(entity, MeshRenderer).ok)
          world.addComponent(entity, oldRenderer).unwrap();
        if (oldCollider !== undefined && !world.get(entity, Collider).ok)
          world.addComponent(entity, oldCollider).unwrap();
        if (oldRigidBody !== undefined && !world.get(entity, RigidBody).ok)
          world.addComponent(entity, oldRigidBody).unwrap();
      });
      world.removeComponent(entity, MeshRenderer).unwrap();
      if (collider.ok) world.removeComponent(entity, Collider).unwrap();
      if (rigidBody.ok) world.removeComponent(entity, RigidBody).unwrap();
    }

    const rockSpecs: readonly [number, number, number, number, number][] = [
      [-10.2, 1.4, 1.2, 1.5, 0.2],
      [-8.8, 0.6, -3.2, 0.9, -0.8],
      [-10.4, 0.2, -7.2, 1.25, 0.5],
      [9.8, 0.7, 1.7, 1.3, -0.4],
      [10.4, 0.1, -3.4, 0.85, 0.9],
      [9.6, 0.25, -8.3, 1.15, 0.3],
      [-7.8, 0.1, -10.4, 0.72, -0.2],
      [7.7, 0.2, -11.2, 0.9, 0.7],
      [-4.8, 0.05, 5.8, 0.65, 0.1],
      [5.2, 0.05, 5.4, 0.75, -0.5],
      [-11.1, -0.4, -12.9, 2.2, 0.2],
      [11.4, -0.6, -14.2, 2.5, -0.4],
    ];
    for (let index = 0; index < rockSpecs.length; index += 1) {
      const [x, y, z, scale, yaw] = rockSpecs[index]!;
      const rockIndex = index % rocks.length;
      queueStaticInstance(
        `cliff-rock-${rockIndex}`,
        rocks[rockIndex]!,
        cliffMaterial,
        [x, y, z],
        [scale, scale * 1.15, scale],
        yaw,
      );
      spawned.push(
        spawnStaticCollider(
          world,
          [x, y, z],
          [scale, scale * 1.15, scale],
          [0.68, 0.72, 0.68],
          yaw,
        ),
      );
      if (scale > 1.2) {
        const companionIndex = (index + 1) % rocks.length;
        const companionPos: Vec3 = [x + scale * 0.55, y + 0.2, z - scale * 0.2];
        const companionScale: Vec3 = [scale * 0.55, scale * 0.72, scale * 0.7];
        queueStaticInstance(
          `stone-rock-${companionIndex}`,
          rocks[companionIndex]!,
          stoneMaterial,
          companionPos,
          companionScale,
          yaw + 1.1,
        );
        spawned.push(
          spawnStaticCollider(
            world,
            companionPos,
            companionScale,
            [0.68, 0.72, 0.68],
            yaw + 1.1,
          ),
        );
      }
    }
    // The authored environment owns the Last Light silhouette. Procedural
    // geometry remains only as the visible and physical traversal underlay.
    queueStaticInstance(
      "hero-terrace",
      heroTerrace,
      ruinMaterial,
      LAST_LIGHT_TERRACE.position,
      [1, 1, 1],
      0,
    );
    queueStaticInstance(
      "last-light-causeway",
      lastLightCauseway,
      routeMaterial,
      [
        LAST_LIGHT_CAUSEWAY.position[0],
        LAST_LIGHT_CAUSEWAY.position[1] + LAST_LIGHT_CAUSEWAY.halfExtents[1],
        LAST_LIGHT_CAUSEWAY.position[2],
      ],
      [1, 1, 1],
      LAST_LIGHT_CAUSEWAY.yaw,
    );
    spawned.push(
      spawnStaticCollider(
        world,
        LAST_LIGHT_TERRACE_COLLIDER.position,
        [1, 1, 1],
        LAST_LIGHT_TERRACE_COLLIDER.halfExtents,
        LAST_LIGHT_TERRACE_COLLIDER.yaw,
      ),
    );
    const beaconCrystalEntity = spawnRenderable(
      world,
      crystalHandle,
      crystalMaterials[2]!,
      [1.8, 1.55, -16.4],
      [0.46, 0.58, 0.46],
      0.12,
    );
    spawned.push(beaconCrystalEntity);

    // The return point is now a low ceremonial stone circle behind the opening
    // camera instead of a large orange primitive covering the foreground.
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * TAU;
      const rockIndex = index % rocks.length;
      queueStaticInstance(
        `stone-rock-${rockIndex}`,
        rocks[rockIndex]!,
        stoneMaterial,
        [Math.cos(angle) * 1.05, -0.28, 3.1 + Math.sin(angle) * 0.82],
        [0.14, 0.1, 0.14],
        angle,
      );
    }

    // Each draw batch owns the exact bounds of its own instance set. Reusing
    // one mesh-wide union across materials/regions kept unrelated cliff and
    // stone draws alive whenever any copy entered the view or a shadow cascade.
    for (const batch of staticInstanceBatches.values()) {
      if (batch.mesh.aabb === undefined)
        throw new Error(
          "[aetherfall] procedural batch mesh is missing its required AABB",
        );
      const batchMesh: MeshAsset = {
        ...batch.mesh,
        aabb: proceduralInstanceBatchAabb(batch.mesh.aabb, batch.instances),
      };
      const meshHandle = ownSharedHandle(
        world.allocSharedRef("MeshAsset", batchMesh),
      );
      renderer.store.ensureResident?.(meshHandle, batchMesh);
      spawned.push(
        spawnInstancedRenderable(
          world,
          meshHandle,
          batch.material,
          batch.instances,
        ),
      );
    }

    const coreNames = [
      "ShrineAMemoryCore",
      "ShrineBMemoryCore",
      "ShrineCMemoryCore",
    ] as const;
    const coreEntities: {
      readonly entity: EntityHandle;
      readonly landmarkIndex: number;
    }[] = [];
    for (let index = 0; index < coreNames.length; index += 1) {
      const entity = authoredEntity(world, loaded, coreNames[index]!);
      if (entity === undefined) continue;
      coreEntities.push({ entity, landmarkIndex: index });
      const oldMesh = world.get(entity, MeshFilter);
      const oldRenderer = world.get(entity, MeshRenderer);
      const oldTransform = world.get(entity, Transform);
      const oldTransformData:
        ComponentData<typeof Transform.schema>["data"] | undefined =
        oldTransform.ok
          ? {
              pos: Array.from(oldTransform.value.pos),
              quat: Array.from(oldTransform.value.quat),
              scale: Array.from(oldTransform.value.scale),
              world: Array.from(oldTransform.value.world),
            }
          : undefined;
      const oldMaterials = oldRenderer.ok
        ? [...oldRenderer.value.materials]
        : undefined;
      registerRestoration(
        [
          ...(oldMesh.ok ? [oldMesh.value.assetHandle] : []),
          ...(oldMaterials ?? []),
        ],
        () => {
          if (oldMesh.ok)
            world
              .set(entity, MeshFilter, {
                assetHandle: oldMesh.value.assetHandle,
              })
              .unwrap();
          else if (world.get(entity, MeshFilter).ok)
            world.removeComponent(entity, MeshFilter).unwrap();
          if (oldMaterials !== undefined)
            world
              .set(entity, MeshRenderer, { materials: oldMaterials })
              .unwrap();
          else if (world.get(entity, MeshRenderer).ok)
            world.removeComponent(entity, MeshRenderer).unwrap();
          if (oldTransformData !== undefined)
            world.set(entity, Transform, oldTransformData).unwrap();
          else if (world.get(entity, Transform).ok)
            world.removeComponent(entity, Transform).unwrap();
        },
      );
      world.set(entity, MeshFilter, { assetHandle: crystalHandle });
      world.set(entity, MeshRenderer, {
        materials: [crystalMaterials[index]!],
      });
      world.set(entity, Transform, { scale: TEMPLE_DORMANT_SCALES[index]! });
    }

    type OrbitalShard = {
      readonly entity: EntityHandle;
      readonly center: EntityHandle;
      readonly landmarkIndex: number;
      readonly phase: number;
      readonly radius: number;
      readonly height: number;
    };
    const orbitalShards: OrbitalShard[] = [];
    for (const core of coreEntities) {
      const { entity: coreEntity, landmarkIndex } = core;
      for (let shardIndex = 0; shardIndex < 2; shardIndex += 1) {
        const shard = spawnRenderable(
          world,
          crystalHandle,
          crystalMaterials[landmarkIndex]!,
          [0, -20, 0],
          [0.12, 0.2, 0.12],
          shardIndex * Math.PI,
        );
        orbitalShards.push({
          entity: shard,
          center: coreEntity,
          landmarkIndex,
          phase: shardIndex * Math.PI + landmarkIndex * 0.73,
          radius: 0.78 + landmarkIndex * 0.07,
          height: 0.16 + shardIndex * 0.22,
        });
        spawned.push(shard);
      }
    }
    for (let shardIndex = 0; shardIndex < 3; shardIndex += 1) {
      const shard = spawnRenderable(
        world,
        crystalHandle,
        crystalMaterials[2]!,
        [0, -20, 0],
        [0, 0, 0],
        shardIndex * 2.1,
      );
      orbitalShards.push({
        entity: shard,
        center: beaconCrystalEntity,
        landmarkIndex: 3,
        phase: (shardIndex / 3) * TAU,
        radius: 1.12,
        height: 0.12 + shardIndex * 0.18,
      });
      spawned.push(shard);
    }

    let currentVisual = explorationLandmarkVisualState({
      version: 1,
      phase: "exploring",
      activatedTempleIds: [],
      beaconUnlocked: false,
      beaconAttuned: false,
      returnedToSanctuary: false,
      interactionCount: 0,
    });
    world
      .addSystem(Update, {
        name: "aetherfall-landmark-animation",
        queries: [],
        after: ["aetherfall-exploration-hud"],
        before: ["propagateTransforms"],
        fn: () => {
          const elapsed = world.getResource(Time).elapsed;
          for (const shard of orbitalShards) {
            const center = world.get(shard.center, Transform);
            if (!center.ok) continue;
            const beaconShard = shard.landmarkIndex === 3;
            const enabled = beaconShard
              ? currentVisual.beaconOrbitalEnabled
              : (currentVisual.templeOrbitalEnabled[shard.landmarkIndex] ??
                false);
            const speed = beaconShard
              ? currentVisual.beaconOrbitalSpeed
              : (currentVisual.templeOrbitalSpeeds[shard.landmarkIndex] ??
                0.46);
            const angle = elapsed * speed + shard.phase;
            const baseScale = enabled
              ? beaconShard
                ? currentVisual.beaconOrbitalScale
                : 0.12
              : 0;
            const pulse = landmarkPulseScale(baseScale, elapsed, shard.phase);
            const half = angle * 0.5;
            const radius = beaconShard
              ? currentVisual.beaconOrbitalRadius
              : (currentVisual.templeOrbitalRadii[shard.landmarkIndex] ??
                shard.radius);
            const stretch = beaconShard
              ? 1.65
              : (currentVisual.templeOrbitalStretches[shard.landmarkIndex] ??
                1.65);
            const centerPosition =
              beaconShard && currentVisual.beaconOrbitalAnchor === "sanctuary"
                ? ([0, 0.18, 3.1] as const)
                : center.value.pos;
            world.set(shard.entity, Transform, {
              pos: [
                (centerPosition[0] ?? 0) + Math.cos(angle) * radius,
                (centerPosition[1] ?? 0) +
                  shard.height +
                  Math.sin(elapsed * 1.7 + shard.phase) * 0.12,
                (centerPosition[2] ?? 0) + Math.sin(angle) * radius,
              ],
              quat: [0, Math.sin(half), 0, Math.cos(half)],
              scale: [pulse, pulse * stretch, pulse],
            });
          }
        },
      })
      .unwrap();
    animationSystemInstalled = true;

    return {
      spawnedEntities: spawned.length,
      setExplorationSnapshot: (snapshot) => {
        const visual = explorationLandmarkVisualState(snapshot);
        currentVisual = visual;
        for (const core of coreEntities) {
          const scale = visual.templeScales[core.landmarkIndex];
          if (scale !== undefined) world.set(core.entity, Transform, { scale });
        }
        world.set(beaconCrystalEntity, Transform, {
          scale: visual.beaconScale,
        });
      },
      ...cleanupOwner,
    };
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      const cleanupErrors =
        cleanupError instanceof AggregateError
          ? cleanupError.errors
          : [cleanupError];
      throwAfterFailedRollback({
        primary: error,
        rollbackErrors: cleanupErrors,
        residualCleanup: cleanupOwner,
        message: "Procedural world installation and rollback failed",
      });
    }
    throw error;
  }
}
