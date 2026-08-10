import type { PhysicsWorld } from '@forgeax/engine-physics';
import { vec3 } from '@forgeax/engine-math';
import { quat } from '@forgeax/engine-math';
import { World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { describe, expect, it, vi } from 'vitest';
import {
  ORBIT_COLLISION_CLEARANCE,
  ORBIT_PROBE_ORIGIN_OFFSET,
  ORBIT_RADIUS,
  aetherfallOrbitPose,
  orbitFocus,
  orbitRadius,
} from '../assets/plugins/camera-orbit';
import {
  ORBIT_COLLISION_RELEASE_EPSILON,
  createOrbitCollisionStabilizer,
  installOrbitCollisionStabilizerSystem,
} from '../assets/plugins/camera-controller';
import { GameplayInput, PlayerMotion } from '../assets/plugins/components/gameplay';

vi.mock('../assets/plugins/depth-of-field', () => ({
  DEPTH_OF_FIELD_ID: 'depth-of-field',
  installDepthOfField: vi.fn(),
}));
vi.mock('../assets/plugins/atmospheric-fog', () => ({
  ATMOSPHERIC_FOG_ID: 'atmospheric-fog',
  installAtmosphericFog: vi.fn(),
}));
vi.mock('../assets/plugins/chromatic-aberration', () => ({
  CHROMATIC_ABERRATION_ID: 'chromatic-aberration',
  installChromaticAberration: vi.fn(),
}));

type OrbitPhysics = Pick<PhysicsWorld, 'raycast'>;

function boxHitTime(
  origin: Float32Array,
  direction: Float32Array,
  maxDistance: number,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): number | undefined {
  let entry = 0;
  let exit = maxDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const component = direction[axis]!;
    if (Math.abs(component) < 1e-6) {
      if (origin[axis]! < min[axis]! || origin[axis]! > max[axis]!) return undefined;
      continue;
    }
    const first = (min[axis]! - origin[axis]!) / component;
    const second = (max[axis]! - origin[axis]!) / component;
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return undefined;
  }
  return entry <= maxDistance && exit >= 0 ? Math.max(0, entry) : undefined;
}

function projectedNdc(
  camera: readonly [number, number, number],
  target: readonly [number, number, number],
  point: readonly [number, number, number],
): readonly [number, number] {
  const forwardRaw = target.map((value, index) => value - camera[index]!) as [number, number, number];
  const forwardLength = Math.hypot(...forwardRaw);
  const forward = forwardRaw.map((value) => value / forwardLength) as [number, number, number];
  const rightRaw: [number, number, number] = [-forward[2], 0, forward[0]];
  const rightLength = Math.hypot(...rightRaw);
  const right = rightRaw.map((value) => value / rightLength) as [number, number, number];
  const up: [number, number, number] = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const relative = point.map((value, index) => value - camera[index]!) as [number, number, number];
  const depth = relative.reduce((sum, value, index) => sum + value * forward[index]!, 0);
  const horizontal = relative.reduce((sum, value, index) => sum + value * right[index]!, 0);
  const vertical = relative.reduce((sum, value, index) => sum + value * up[index]!, 0);
  const verticalTangent = Math.tan(0.74 / 2);
  return [horizontal / (depth * verticalTangent * (16 / 9)), vertical / (depth * verticalTangent)];
}

function distance3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function quaternionAngularDistance(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  const dot = Math.abs(
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2] +
    left[3] * right[3],
  );
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}

describe('Aetherfall v12 orbit framing', () => {
  it('stages the complete Fox, stepping route, and Shrine B crystal across three readable zones', () => {
    const pose = aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.75,
      playerZ: 0,
      lookYaw: 0,
      lookPitch: 0,
    });
    // Exact source GLB bounds after the shipped 0.012 scale, +90deg Y
    // rotation, and child offset. Eight corners prove the whole Fox is safe.
    const foxCorners: [number, number][] = [];
    for (const x of [-1.057, 0.799]) {
      for (const y of [-0.002, 0.947]) {
        for (const z of [-0.151, 0.151]) {
          foxCorners.push([...projectedNdc(pose.pos, pose.target, [x, y, z])]);
        }
      }
    }
    const foxMinX = Math.min(...foxCorners.map(([x]) => x));
    const foxMaxX = Math.max(...foxCorners.map(([x]) => x));
    const foxMinY = Math.min(...foxCorners.map(([, y]) => y));
    const foxMaxY = Math.max(...foxCorners.map(([, y]) => y));
    expect(foxMinX).toBeGreaterThan(-0.75);
    expect(foxMaxX).toBeLessThan(-0.05);
    expect(foxMinY).toBeGreaterThan(-0.8);
    expect(foxMaxY).toBeLessThan(-0.15);

    const route = [
      projectedNdc(pose.pos, pose.target, [-0.55, 0.08, -1.5]),
      projectedNdc(pose.pos, pose.target, [0.35, 0.09, -2.75]),
      projectedNdc(pose.pos, pose.target, [-0.2, 0.09, -3.75]),
      projectedNdc(pose.pos, pose.target, [0, 0.1, -4.85]),
    ];
    for (let index = 1; index < route.length; index += 1) {
      expect(route[index]![1]).toBeGreaterThan(route[index - 1]![1]);
    }
    for (const [x] of route) {
      expect(x).toBeGreaterThan(-0.5);
      expect(x).toBeLessThan(0.05);
    }
    expect(route[0]![1]).toBeLessThan(foxMaxY);
    expect(route.at(-1)![1]).toBeGreaterThan(foxMaxY);

    const crystal = projectedNdc(pose.pos, pose.target, [6.1, 2.55, -6.3]);
    expect(crystal[0]).toBeGreaterThan(0.2);
    expect(crystal[0]).toBeLessThan(0.65);
    expect(crystal[1]).toBeGreaterThan(0.2);
    expect(crystal[1]).toBeLessThan(0.55);
    expect(crystal[0] - route.at(-1)![0]).toBeGreaterThan(0.5);
    expect(crystal[1] - route.at(-1)![1]).toBeGreaterThan(0.45);
    expect(orbitRadius(pose.pos, pose.target)).toBeCloseTo(ORBIT_RADIUS, 5);
  });

  it('aims across the route so the character occupies the lower-left instead of dead centre', () => {
    expect(orbitFocus(3, 0.75, -4)).toEqual([4.6, 1.85, -4.7]);
  });

  it('keeps the interactive Last Light crystal readable at the real objective sample', () => {
    const pose = aetherfallOrbitPose({
      playerX: 2.78,
      playerY: 0.71,
      playerZ: -16.35,
      lookYaw: 0,
      lookPitch: 0,
    });
    const player = projectedNdc(pose.pos, pose.target, [2.78, 0.95, -16.35]);
    const crystal = projectedNdc(pose.pos, pose.target, [1.8, 1.55, -16.4]);
    expect(player[0]).toBeGreaterThan(-0.65);
    expect(player[0]).toBeLessThan(-0.1);
    expect(player[1]).toBeGreaterThan(-0.65);
    expect(player[1]).toBeLessThan(-0.15);
    expect(crystal[0]).toBeGreaterThan(-0.7);
    expect(crystal[0]).toBeLessThan(0.1);
    expect(crystal[1]).toBeGreaterThan(-0.4);
    expect(crystal[1]).toBeLessThan(0.15);
    expect(crystal[1]).toBeGreaterThan(player[1]);
  });

  it('pulls the camera in front of a wall while preserving physical clearance', () => {
    const raycast = vi.fn<OrbitPhysics['raycast']>(() => ({
      entity: 99,
      point: vec3.create(0, 0, 0),
      normal: vec3.create(0, 0, 1),
      timeOfImpact: 1.5,
    }));
    const pose = aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.75,
      playerZ: -12,
      lookYaw: 0,
      lookPitch: 0,
      physics: { raycast },
      playerEntity: 7,
    });

    expect(raycast).toHaveBeenCalledTimes(5);
    expect(pose.radius).toBeCloseTo(
      ORBIT_PROBE_ORIGIN_OFFSET + 1.5 - ORBIT_COLLISION_CLEARANCE,
      5,
    );
    expect(orbitRadius(pose.pos, pose.target)).toBeCloseTo(pose.radius, 5);
  });

  it('does not treat the followed player as an architectural obstruction', () => {
    const raycast = vi.fn<OrbitPhysics['raycast']>(() => ({
      entity: 7,
      point: vec3.create(0, 0, 0),
      normal: vec3.create(0, 1, 0),
      timeOfImpact: 0,
    }));
    const pose = aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.75,
      playerZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      physics: { raycast },
      playerEntity: 7,
    });

    expect(pose.radius).toBe(ORBIT_RADIUS);
  });

  it('escapes the gate-side tower instead of accepting a full-frame masonry close-up', () => {
    const calls: number[] = [];
    const raycast = vi.fn<OrbitPhysics['raycast']>((origin, direction, maxDistance) => {
      // Conservative screen-facing mass for the gate's right tower/post. The
      // authored shoulder crosses it as the player enters at z=-12.71; the
      // route-centre candidate starts camera-side and looks through the gate.
      const timeOfImpact = boxHitTime(
        origin,
        direction,
        maxDistance,
        [0.08, 0, -13.05],
        [1.7, 4, -12.55],
      );
      calls.push(timeOfImpact ?? -1);
      return timeOfImpact === undefined
        ? undefined
        : {
            entity: 99,
            point: vec3.create(0, 0, 0),
            normal: vec3.create(0, 0, 1),
            timeOfImpact,
          };
    });
    const pose = aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.71,
      playerZ: -12.71,
      lookYaw: 0,
      lookPitch: 0,
      physics: { raycast },
      playerEntity: 7,
    });

    expect(calls[0]).toBeGreaterThanOrEqual(0);
    expect(calls[1]).toBe(-1);
    expect(raycast).toHaveBeenCalledTimes(2);
    expect(pose.strategy).toBe('route-centre');
    expect(pose.radius).toBe(ORBIT_RADIUS);
  });
});

describe('orbit collision temporal stability', () => {
  it('stabilizes around the authored lateral focus and keeps orientation coherent', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: { jumpY: 0.75 } },
      { component: GameplayInput, data: {} },
    ).unwrap();
    const camera = world.spawn({ component: Transform, data: {} }).unwrap();
    let blocked = true;
    const raycast = vi.fn<OrbitPhysics['raycast']>(() => blocked
      ? {
          entity: 99,
          point: vec3.create(0, 0, 0),
          normal: vec3.create(0, 0, 1),
          timeOfImpact: 1.5,
        }
      : undefined);
    world.insertResource('PhysicsWorld', { raycast } as OrbitPhysics);
    const handle = installOrbitCollisionStabilizerSystem({
      world,
      camera,
      player,
      getMode: () => 'orbit',
    });

    world.update(1 / 60).unwrap();
    blocked = false;
    world.update(1 / 60).unwrap();
    const snapshot = handle.snapshot();
    const expectedFocus = orbitFocus(0, 0.75, 0);
    expect(snapshot).toBeDefined();
    expect(snapshot!.target[0]).toBeCloseTo(expectedFocus[0], 6);
    expect(snapshot!.target[1]).toBeCloseTo(expectedFocus[1], 6);
    expect(snapshot!.target[2]).toBeCloseTo(expectedFocus[2], 6);
    const radius = orbitRadius(snapshot!.pos, snapshot!.target);
    expect(radius).toBeGreaterThan(ORBIT_PROBE_ORIGIN_OFFSET + 1.5 - ORBIT_COLLISION_CLEARANCE);
    expect(radius).toBeLessThan(ORBIT_RADIUS);
    const expectedRotation = quat.fromLookAt(
      quat.create(),
      snapshot!.pos,
      snapshot!.target,
      [0, 1, 0],
    );
    const actualRotation = world.get(camera, Transform).unwrap().quat;
    for (let index = 0; index < 4; index += 1) {
      expect(actualRotation[index]).toBeCloseTo(expectedRotation[index]!, 5);
    }
  });

  it('smooths a route-centre to authored-shoulder direction switch', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: { jumpY: 0.75 } },
      { component: GameplayInput, data: {} },
    ).unwrap();
    const camera = world.spawn({ component: Transform, data: {} }).unwrap();
    let routeCentre = true;
    let probe = 0;
    const raycast = vi.fn<OrbitPhysics['raycast']>(() => {
      if (!routeCentre) return undefined;
      probe += 1;
      return probe % 2 === 1
        ? {
            entity: 99,
            point: vec3.create(0, 0, 0),
            normal: vec3.create(0, 0, 1),
            timeOfImpact: 1.5,
          }
        : undefined;
    });
    world.insertResource('PhysicsWorld', { raycast } as OrbitPhysics);
    const handle = installOrbitCollisionStabilizerSystem({
      world,
      camera,
      player,
      getMode: () => 'orbit',
    });

    world.update(1 / 60).unwrap();
    const route = handle.snapshot()!;
    routeCentre = false;
    world.update(1 / 60).unwrap();
    const transitioning = handle.snapshot()!;
    const authored = orbitFocus(0, 0.75, 0);
    expect(route.target[0]).toBeCloseTo(0, 6);
    expect(transitioning.target[0]).toBeGreaterThan(route.target[0]);
    expect(transitioning.target[0]).toBeLessThan(authored[0]);
    expect(transitioning.pos).not.toEqual(aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.75,
      playerZ: 0,
      lookYaw: 0,
      lookPitch: 0,
    }).pos);
    expect(transitioning.pos.every(Number.isFinite)).toBe(true);
    expect(transitioning.quat.every(Number.isFinite)).toBe(true);
  });

  it('smooths a threshold-adjacent route-centre to shorter authored-shoulder composition', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: { jumpY: 0.75 } },
      { component: GameplayInput, data: {} },
    ).unwrap();
    const camera = world.spawn({ component: Transform, data: {} }).unwrap();
    let thresholdAdjacent = false;
    let openingProbe = 0;
    const raycast = vi.fn<OrbitPhysics['raycast']>(() => {
      if (thresholdAdjacent) {
        return {
          entity: 99,
          point: vec3.create(0, 0, 0),
          normal: vec3.create(0, 0, 1),
          timeOfImpact: 4.31,
        };
      }
      openingProbe += 1;
      return openingProbe % 2 === 1
        ? {
            entity: 99,
            point: vec3.create(0, 0, 0),
            normal: vec3.create(0, 0, 1),
            timeOfImpact: 1.5,
          }
        : undefined;
    });
    const physics = { raycast } as OrbitPhysics;
    world.insertResource('PhysicsWorld', physics);
    const handle = installOrbitCollisionStabilizerSystem({
      world,
      camera,
      player,
      getMode: () => 'orbit',
    });

    world.update(1 / 60).unwrap();
    const route = handle.snapshot()!;
    thresholdAdjacent = true;
    const desired = aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.75,
      playerZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      physics,
      playerEntity: player,
    });
    expect(desired.strategy).toBe('authored-shoulder');
    expect(desired.radius).toBeCloseTo(4.21, 6);
    expect(distance3(route.target, desired.target)).toBeCloseTo(1.812, 3);

    world.update(1 / 60).unwrap();
    const transitioning = handle.snapshot()!;
    expect(distance3(route.target, transitioning.target)).toBeGreaterThan(0);
    expect(distance3(route.target, transitioning.target)).toBeLessThan(
      distance3(route.target, desired.target),
    );
    expect(distance3(route.pos, transitioning.pos)).toBeGreaterThan(0);
    expect(distance3(route.pos, transitioning.pos)).toBeLessThan(
      distance3(route.pos, desired.pos),
    );
    expect(orbitRadius(transitioning.pos, transitioning.target)).toBeGreaterThan(
      desired.radius,
    );
    expect(quaternionAngularDistance(route.quat, transitioning.quat)).toBeGreaterThan(0);
    expect(quaternionAngularDistance(route.quat, transitioning.quat)).toBeLessThan(
      quaternionAngularDistance(route.quat, desired.quat),
    );
    expect(transitioning.quat.every(Number.isFinite)).toBe(true);

    world.update(1 / 60).unwrap();
    const continuing = handle.snapshot()!;
    expect(distance3(continuing.target, desired.target)).toBeGreaterThan(0);
    expect(distance3(continuing.target, desired.target)).toBeLessThan(
      distance3(transitioning.target, desired.target),
    );
    expect(distance3(continuing.pos, desired.pos)).toBeGreaterThan(0);
    expect(distance3(continuing.pos, desired.pos)).toBeLessThan(
      distance3(transitioning.pos, desired.pos),
    );
    expect(quaternionAngularDistance(continuing.quat, desired.quat)).toBeGreaterThan(0);
    expect(quaternionAngularDistance(continuing.quat, desired.quat)).toBeLessThan(
      quaternionAngularDistance(transitioning.quat, desired.quat),
    );
  });

  it('contracts immediately when a closer obstruction appears within the same strategy', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: { jumpY: 0.75 } },
      { component: GameplayInput, data: {} },
    ).unwrap();
    const camera = world.spawn({ component: Transform, data: {} }).unwrap();
    let blocked = false;
    const raycast = vi.fn<OrbitPhysics['raycast']>(() => blocked
      ? {
          entity: 99,
          point: vec3.create(0, 0, 0),
          normal: vec3.create(0, 0, 1),
          timeOfImpact: 2.1,
        }
      : undefined);
    const physics = { raycast } as OrbitPhysics;
    world.insertResource('PhysicsWorld', physics);
    const handle = installOrbitCollisionStabilizerSystem({
      world,
      camera,
      player,
      getMode: () => 'orbit',
    });

    world.update(1 / 60).unwrap();
    expect(orbitRadius(handle.snapshot()!.pos, handle.snapshot()!.target)).toBeCloseTo(8.4, 6);
    blocked = true;
    const desired = aetherfallOrbitPose({
      playerX: 0,
      playerY: 0.75,
      playerZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      physics,
      playerEntity: player,
    });
    expect(desired.strategy).toBe('authored-shoulder');

    world.update(1 / 60).unwrap();
    expect(handle.snapshot()!.target).toEqual(desired.target);
    expect(handle.snapshot()!.pos).toEqual(desired.pos);
    expect(orbitRadius(handle.snapshot()!.pos, handle.snapshot()!.target)).toBeCloseTo(2, 6);
  });

  it('drops transition history outside Orbit and reacquires the authored pose', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: { jumpY: 0.75 } },
      { component: GameplayInput, data: {} },
    ).unwrap();
    const camera = world.spawn({ component: Transform, data: {} }).unwrap();
    let mode: 'orbit' | 'fps' = 'orbit';
    const handle = installOrbitCollisionStabilizerSystem({
      world,
      camera,
      player,
      getMode: () => mode,
    });

    world.update(1 / 60).unwrap();
    mode = 'fps';
    world.update(1 / 60).unwrap();
    expect(handle.snapshot()).toBeUndefined();
    world.set(player, Transform, { pos: [5, 0.75, -3] }).unwrap();
    mode = 'orbit';
    world.update(1 / 60).unwrap();
    const reacquired = handle.snapshot()!;
    const desired = aetherfallOrbitPose({
      playerX: 5,
      playerY: 0.75,
      playerZ: -3,
      lookYaw: 0,
      lookPitch: 0,
      playerEntity: player,
    });
    expect(reacquired.target).toEqual(desired.target);
    expect(reacquired.pos).toEqual(desired.pos);
  });

  it('contracts immediately for safety and restores monotonically without a release hard cut', () => {
    const stabilizer = createOrbitCollisionStabilizer();
    expect(stabilizer.step([0, 0, 8.4], 1 / 60)).toEqual([0, 0, 8.4]);

    const obstructed = stabilizer.step([0, 0, 2], 1 / 60);
    expect(obstructed).toEqual([0, 0, 2]);

    const recovered: number[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      recovered.push(Math.hypot(...stabilizer.step([0, 0, 8.4], 1 / 60)));
    }
    expect(recovered[0]).toBeGreaterThan(2);
    expect(recovered[0]).toBeLessThan(8.4);
    for (let index = 1; index < recovered.length; index += 1) {
      expect(recovered[index]).toBeGreaterThan(recovered[index - 1]!);
      expect(recovered[index]).toBeLessThan(8.4);
    }
  });

  it('holds a finite stable offset across invalid samples and collision-edge noise', () => {
    const stabilizer = createOrbitCollisionStabilizer();
    stabilizer.step([0, 0, 2], 1 / 60);
    const invalid = stabilizer.step([Number.NaN, Number.POSITIVE_INFINITY, 0], Number.NaN);
    expect(invalid.every(Number.isFinite)).toBe(true);
    expect(invalid).toEqual([0, 0, 2]);

    const nearEdge = [
      stabilizer.step([0, 0, 2 + ORBIT_COLLISION_RELEASE_EPSILON / 2], 1 / 60),
      stabilizer.step([0, 0, 2 + ORBIT_COLLISION_RELEASE_EPSILON / 3], 1 / 60),
      stabilizer.step([0, 0, 2 + ORBIT_COLLISION_RELEASE_EPSILON / 2], 1 / 60),
    ];
    expect(nearEdge).toEqual([[0, 0, 2], [0, 0, 2], [0, 0, 2]]);
  });

  it('resets its lease across camera-mode changes so Orbit resumes at the authored radius', () => {
    const stabilizer = createOrbitCollisionStabilizer();
    stabilizer.step([0, 0, 1.5], 1 / 60);
    stabilizer.reset();
    expect(stabilizer.step([0, 0, 8.4], 1 / 60)).toEqual([0, 0, 8.4]);
  });
});
