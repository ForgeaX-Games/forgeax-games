import { HANDLE_CYLINDER } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { vec3, quat } from '@forgeax/engine-math';
import type { PhysicsWorld } from '@forgeax/engine-physics';
import {
  Materials,
  MeshFilter,
  MeshRenderer,
  PointLight,
  Visibility,
  VisibilityStateValue,
} from '@forgeax/engine-render';
import { ChildOf, Name, Transform } from '@forgeax/engine-scene';
import type { MeshAsset } from '@forgeax/engine-types';
import type { Weapon } from './weapons';
type V = [number, number, number];

/** Crossed tapered flame lobes and eight fine spark streaks, shared by all muzzles. */
export function muzzleMesh(): MeshAsset {
  const vertices: number[] = [],
    indices: number[] = [];
  const triangle = (a: V, b: V, c: V) => {
    const offset = vertices.length / 12;
    for (const p of [a, b, c]) vertices.push(...p, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    indices.push(offset, offset + 1, offset + 2);
  };
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4,
      cx = Math.cos(angle),
      cy = Math.sin(angle);
    const length = i % 2 ? 0.18 : 0.28;
    triangle(
      [-0.016 * cy, 0.016 * cx, 0],
      [0.016 * cy, -0.016 * cx, 0],
      [cx * 0.035, cy * 0.035, -length],
    );
    triangle(
      [cx * 0.05, cy * 0.05, -0.09],
      [cx * 0.05 - 0.0015 * cy, cy * 0.05 + 0.0015 * cx, -0.09],
      [cx * 0.105, cy * 0.105, -0.25 - i * 0.008],
    );
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
    aabb: new Float32Array([-0.11, -0.11, -0.32, 0.11, 0.11, 0]),
    submeshes: [
      {
        indexOffset: 0,
        indexCount: indices.length,
        vertexCount: count,
        topology: 'triangle-list',
        materialSlot: 0,
      },
    ],
    materialSlots: [{ slotName: 'MuzzleFlame' }],
  };
}

/** Cosmetic cases use swept Rapier rays for bounce; no colliders to block gameplay shots. */
export function createShotEffects(world: World, camera: EntityHandle) {
  const brass = world.internSharedRef(
    'MaterialAsset',
    Materials.standard({
      baseColor: [0.65, 0.38, 0.09, 1],
      metallic: 0.92,
      roughness: 0.21,
      castShadow: false,
    }),
  );
  world
    .spawn(
      { component: Name, data: { value: 'Weapon_SurfaceFill' } },
      { component: ChildOf, data: { parent: camera } },
      { component: Transform, data: { pos: [0.4, 0.32, -0.42] } },
      {
        component: PointLight,
        data: { color: [0.73, 0.83, 1], intensity: 1.6, range: 1.5 },
      },
    )
    .unwrap();
  const light = world
    .spawn(
      { component: Name, data: { value: 'Weapon_MuzzleLight' } },
      { component: ChildOf, data: { parent: camera } },
      { component: Transform, data: { pos: [0.1, -0.1, -0.5] } },
      {
        component: PointLight,
        data: { color: [1, 0.43, 0.12], intensity: 0, range: 4 },
      },
    )
    .unwrap();
  const cases = Array.from({ length: 24 }, (_, i) => ({
    entity: world
      .spawn(
        { component: Name, data: { value: `Weapon_Casing_${i}` } },
        { component: Transform, data: { scale: [0, 0, 0] } },
        { component: Visibility, data: { state: VisibilityStateValue.hidden } },
        { component: MeshFilter, data: { assetHandle: HANDLE_CYLINDER } },
        { component: MeshRenderer, data: { materials: [brass] } },
      )
      .unwrap(),
    pos: [0, 0, 0] as V,
    velocity: [0, 0, 0] as V,
    until: 0,
    born: 0,
    scale: [0.009, 0.025, 0.009] as V,
    seed: i,
  }));
  let eye: V = [0, 1.62, 0],
    yaw = 0,
    pitch = 0,
    cursor = 0,
    flashUntil = 0,
    selected = '';
  const pending: { at: number; asset: string; shotgun: boolean }[] = [];
  const emit = (now: number, shotgun: boolean) => {
    const c = cases[cursor++ % cases.length],
      side = 0.2 + (c.seed % 3) * 0.008;
    c.pos = [
      eye[0] + Math.cos(yaw) * side - Math.sin(yaw) * 0.3,
      eye[1] - 0.12 + Math.sin(pitch) * 0.3,
      eye[2] - Math.sin(yaw) * side - Math.cos(yaw) * 0.3,
    ];
    const force = 1.5 + (c.seed % 5) * 0.16;
    c.velocity = [
      Math.cos(yaw) * force,
      1.4 + (c.seed % 4) * 0.17,
      -Math.sin(yaw) * force,
    ];
    world.set(c.entity, Visibility, { state: VisibilityStateValue.visible });
    c.born = now;
    c.until = now + 2.6;
    c.scale = shotgun ? [0.014, 0.033, 0.014] : [0.008, 0.024, 0.008];
  };
  return {
    shot(w: Weapon, now: number) {
      flashUntil = now + 0.055;
      if (w.reloadStyle !== 'revolver')
        pending.push({
          at: now + (w.asset === 'm870' ? 0.18 : w.asset === 'l96' ? 0.22 : 0),
          asset: w.asset,
          shotgun: w.family === 'shotgun',
        });
    },
    revolver(now: number, count: number) {
      for (let i = 0; i < count; i++)
        pending.push({
          at: now + 0.55 + i * 0.012,
          asset: 'model10',
          shotgun: false,
        });
    },
    update(
      now: number,
      dt: number,
      view: V,
      y: number,
      p: number,
      asset: string,
    ) {
      eye = view;
      yaw = y;
      pitch = p;
      selected = asset;
      world.set(light, PointLight, { intensity: now < flashUntil ? 8 : 0 });
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i].at <= now) {
          const e = pending.splice(i, 1)[0];
          if (e.asset === selected) emit(now, e.shotgun);
        }
      const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
      for (const c of cases) {
        if (!c.until) continue;
        if (now >= c.until) {
          world.set(c.entity, Transform, { scale: [0, 0, 0] });
          world.set(c.entity, Visibility, {
            state: VisibilityStateValue.hidden,
          });
          c.until = 0;
          continue;
        }
        // Game dt is bounded by the caller; swept segments prevent fast case tunnelling.
        c.velocity[1] -= 9.81 * dt;
        const delta = c.velocity.map((v) => v * dt) as V,
          distance = Math.hypot(...delta);
        const hit =
          distance > 0
            ? physics?.raycast(
                vec3.create(...c.pos),
                vec3.create(...(delta.map((v) => v / distance) as V)),
                distance + 0.008,
                0x0001fffd,
              )
            : null;
        if (hit) {
          const dot = c.velocity.reduce(
            (sum, v, i) => sum + v * hit.normal[i],
            0,
          );
          for (let i = 0; i < 3; i++) {
            c.pos[i] = hit.point[i] + hit.normal[i] * 0.01;
            c.velocity[i] = (c.velocity[i] - 1.35 * dot * hit.normal[i]) * 0.65;
          }
        } else for (let i = 0; i < 3; i++) c.pos[i] += delta[i];
        const q = quat.create(),
          age = now - c.born;
        quat.fromEuler(q, age * 11 + c.seed, age * 7, age * 5, 'XYZ');
        world.set(c.entity, Transform, { pos: c.pos, quat: q, scale: c.scale });
      }
    },
  };
}
