import type { World } from '@forgeax/engine-ecs';
import type { MeshAsset } from '@forgeax/engine-types';
import { Transform, Name } from '@forgeax/engine-scene';
import {
  Fog,
  Materials,
  MeshFilter,
  MeshRenderer,
  PointLight,
  SpotLight,
  ReflectionProbe,
} from '@forgeax/engine-render';
import { CITY_COLLIDERS } from './city-collision';
type V = [number, number, number];
const fract = (n: number) => n - Math.floor(n);
const random = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

/** Shared immutable crossed ribbons; only 48 rain-cell transforms move. */
function rainMesh(): MeshAsset {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 160; i++) {
    const x = (random(i * 3) - 0.5) * 3.2,
      z = (random(i * 3 + 1) - 0.5) * 3.2,
      height = random(i + 321) * 4,
      length = 0.25 + random(i * 3 + 2) * 0.42;
    for (let axis = 0; axis < 2; axis++) {
      const start = vertices.length / 12;
      for (const [side, h] of [
        [0, 0],
        [-0.0045, length * 0.45],
        [0, length],
        [0.0045, length * 0.45],
      ])
        vertices.push(
          x + h * 0.12 + (axis === 0 ? side : 0),
          h + height,
          z + (axis === 1 ? side : 0),
          axis === 0 ? 0 : 1,
          0,
          axis === 0 ? 1 : 0,
          0.5 + side * 40,
          h / length,
          1,
          0,
          0,
          1,
        );
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const data = new Float32Array(vertices),
    count = data.length / 12;
  const attr = (offset: number, size: number) =>
    Float32Array.from(
      { length: count * size },
      (_, i) => data[Math.floor(i / size) * 12 + offset + (i % size)],
    );
  return {
    kind: 'mesh',
    vertices: data,
    indices: new Uint16Array(indices),
    attributes: {
      position: attr(0, 3),
      normal: attr(3, 3),
      uv: attr(6, 2),
      tangent: attr(8, 4),
    },
    aabb: new Float32Array([-1.7, 0, -1.7, 1.8, 4.7, 1.7]),
    submeshes: [
      {
        indexOffset: 0,
        indexCount: indices.length,
        vertexCount: count,
        topology: 'triangle-list',
        materialSlot: 0,
      },
    ],
    materialSlots: [{ slotName: 'Rain' }],
  };
}
/** Thin expanding surface rings, shared across a bounded splash pool. */
function splashMesh(): MeshAsset {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i * Math.PI) / 10;
    for (const r of [0.91, 1])
      vertices.push(
        Math.cos(a) * r,
        0,
        Math.sin(a) * r,
        0,
        1,
        0,
        i / 20,
        r,
        1,
        0,
        0,
        1,
      );
    const n = (i + 1) % 20;
    indices.push(i * 2, i * 2 + 1, n * 2 + 1, i * 2, n * 2 + 1, n * 2);
  }
  const data = new Float32Array(vertices),
    count = data.length / 12;
  const attr = (offset: number, size: number) =>
    Float32Array.from(
      { length: count * size },
      (_, i) => data[Math.floor(i / size) * 12 + offset + (i % size)],
    );
  return {
    kind: 'mesh',
    vertices: data,
    indices: new Uint16Array(indices),
    attributes: {
      position: attr(0, 3),
      normal: attr(3, 3),
      uv: attr(6, 2),
      tangent: attr(8, 4),
    },
    aabb: new Float32Array([-1, -0.002, -1, 1, 0.002, 1]),
    submeshes: [
      {
        indexOffset: 0,
        indexCount: indices.length,
        vertexCount: count,
        topology: 'triangle-list',
        materialSlot: 0,
      },
    ],
    materialSlots: [{ slotName: 'Splash' }],
  };
}
/** Conservative roof/cover clipping still allows rain outside when viewed from indoors. */
export function rainFloorAt(x: number, z: number): number {
  let floor = 0.08;
  for (const p of CITY_COLLIDERS)
    if (
      Math.abs(x - p.center[0]) < p.size[0] / 2 + 1.8 &&
      Math.abs(z - p.center[2]) < p.size[2] / 2 + 1.8
    )
      floor = Math.max(floor, p.center[1] + p.size[1] / 2 + 0.08);
  return floor;
}
export function createRainNight(world: World) {
  world
    .spawn(
      { component: Name, data: { value: 'RainNight_Fog' } },
      {
        component: Fog,
        data: {
          color: [0.035, 0.047, 0.058],
          density: 0.011,
          heightFalloff: 0.08,
          maxOpacity: 0.68,
        },
      },
    )
    .unwrap();
  const lamps: [V, V, number, number][] = [
    [[-3.3, 2.65, -10.5], [1, 0.57, 0.25], 19, 8],
    [[3, 2.65, -18], [1, 0.64, 0.34], 18, 8],
    [[3.1, 2.65, -31.4], [1, 0.61, 0.29], 34, 10],
    [[13.2, 2.65, -53], [1, 0.56, 0.23], 30, 9],
    [[30.8, 2.65, -51.6], [1, 0.67, 0.38], 34, 9],
    [[-12, 3, -44], [0.31, 0.54, 0.65], 22, 9],
    [[20, 3, -44], [1, 0.52, 0.2], 26, 10],
    [[27, 3, -65], [0.3, 0.5, 0.58], 20, 9],
  ];
  for (const [pos, color, intensity, range] of lamps)
    world
      .spawn(
        { component: Transform, data: { pos } },
        { component: Name, data: { value: 'RainNight_ShopLight' } },
        { component: PointLight, data: { color, intensity, range } },
      )
      .unwrap();
  for (const [i, pos] of (
    [
      [0, 6, -10],
      [8, 6, -38],
      [8, 6, -63],
    ] as V[]
  ).entries())
    world
      .spawn(
        { component: Transform, data: { pos } },
        { component: Name, data: { value: 'RainNight_StreetLight' } },
        {
          component: SpotLight,
          data: {
            direction: [0.05, -1, -0.08],
            color: [1, 0.75, 0.45],
            intensity: 72,
            range: 15,
            innerConeDeg: 30,
            outerConeDeg: 60,
            castShadow: i === 0,
            mapSize: 1024,
            farPlane: 18,
            depthBias: 0.001,
            normalBias: 0.025,
          },
        },
      )
      .unwrap();
  const mesh = world.allocSharedRef('MeshAsset', rainMesh());
  const material = world.internSharedRef(
    'MaterialAsset',
    Materials.unlit([0.58, 0.69, 0.78, 0.42], {
      castShadow: false,
      queue: 3000,
      renderState: {
        cullMode: 'none',
        depthWriteEnabled: false,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        },
      },
    }),
  );
  const cells = Array.from({ length: 48 }, (_, i) => ({
    entity: world
      .spawn(
        { component: Name, data: { value: `RainNight_Rain_${i}` } },
        { component: Transform, data: { pos: [0, -50, 0] } },
        { component: MeshFilter, data: { assetHandle: mesh } },
        { component: MeshRenderer, data: { materials: [material] } },
      )
      .unwrap(),
    x: 0,
    z: 0,
    floor: 0,
    phase: random(i + 701),
  }));
  const ring = world.allocSharedRef('MeshAsset', splashMesh());
  const splashes = Array.from({ length: 24 }, (_, i) =>
    world
      .spawn(
        { component: Name, data: { value: `RainNight_Splash_${i}` } },
        { component: Transform, data: { pos: [0, -50, 0] } },
        { component: MeshFilter, data: { assetHandle: ring } },
        { component: MeshRenderer, data: { materials: [material] } },
      )
      .unwrap(),
  );
  let gridX = Infinity,
    gridZ = Infinity,
    probesCreated = 0;
  return {
    update(now: number, eye: V) {
      if (probesCreated < 3 && now > 4 + probesCreated * 8) {
        const probePositions: V[] = [
          [0, 1.7, -16],
          [8, 1.7, -47],
          [28, 1.7, -62],
        ];
        world
          .spawn(
            { component: Name, data: { value: 'RainNight_Reflection' } },
            {
              component: Transform,
              data: { pos: probePositions[probesCreated] },
            },
            {
              component: ReflectionProbe,
              data: {
                halfExtents: [17, 7, 23],
                resolution: 128,
                updateIntent: 0,
                intensity: 1.3,
              },
            },
          )
          .unwrap();
        probesCreated++;
      }
      const gx = Math.floor(eye[0] / 4),
        gz = Math.floor(eye[2] / 4);
      if (gx !== gridX || gz !== gridZ) {
        gridX = gx;
        gridZ = gz;
        cells.forEach((c, i) => {
          c.x = (gx + (i % 6) - 2) * 4;
          c.z = (gz + Math.floor(i / 6) - 3) * 4;
          c.floor = rainFloorAt(c.x, c.z);
        });
      }
      splashes.forEach((entity, i) => {
        const x = (gx - 1) * 4 + random(i + 90) * 12,
          z = (gz - 2) * 4 + random(i + 170) * 16;
        const floor = rainFloorAt(x, z),
          phase = fract(now * 2.6 + random(i + 29));
        const size = floor < 0.5 && phase < 0.8 ? 0.035 + phase * 0.17 : 0;
        world.set(entity, Transform, {
          pos: [x, floor - 0.074, z],
          scale: [size, 1, size],
        });
      });
      for (const c of cells) {
        const range = Math.max(3, 10 - c.floor),
          y = c.floor + fract(c.phase - (now * 16) / range) * range;
        const scale = Math.hypot(c.x - eye[0], c.z - eye[2]) < 3.5 ? 0 : 1;
        world.set(c.entity, Transform, {
          pos: [c.x, y, c.z],
          scale: [scale, scale, scale],
        });
      }
    },
  };
}
