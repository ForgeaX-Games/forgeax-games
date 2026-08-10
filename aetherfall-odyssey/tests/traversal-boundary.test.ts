import { describe, expect, it, vi } from 'vitest';
import { World } from '@forgeax/engine-ecs';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { Transform } from '@forgeax/engine-scene';
import { FreeCameraMotion, PlayerMotion } from '../assets/plugins/components/gameplay';
import { LAST_LIGHT_TERRACE_COLLIDER } from '../assets/plugins/environment-layout';
import {
  MAIN_ISLAND_SUPPORTS,
  TRAVERSAL_RECOVERY_Y,
  createTraversalFloorColliders,
  installTraversalBoundary,
  isTraversalSupportPoint,
  removeOversizedTemplateGround,
  stepTraversalRecovery,
  type TraversalRecoveryState,
} from '../assets/plugins/traversal-boundary';

describe('Aetherfall diegetic traversal boundary', () => {
  it('keeps every mission landmark and the visible Last Light route on supported ground', () => {
    const missionPoints = [
      [0, 0],
      [0, 3.1],
      [-6.2, -4.9],
      [6.1, -6.3],
      [-2.6, -11.2],
      [0, -12.8],
      [0, -14.2],
      [1.8, -16.8],
    ] as const;
    for (const [x, z] of missionPoints) expect(isTraversalSupportPoint(x, z)).toBe(true);
    for (let z = -10; z >= -17; z -= 0.05) {
      expect(isTraversalSupportPoint(0, z), `route gap at z=${z.toFixed(2)}`).toBe(true);
    }
    expect(isTraversalSupportPoint(15, 0)).toBe(false);
    expect(isTraversalSupportPoint(0, -22)).toBe(false);
    expect(isTraversalSupportPoint(Number.NaN, 0)).toBe(false);
    const terrace = LAST_LIGHT_TERRACE_COLLIDER;
    expect(isTraversalSupportPoint(
      terrace.position[0] + terrace.halfExtents[0],
      terrace.position[2] + terrace.halfExtents[2],
    )).toBe(true);
    expect(isTraversalSupportPoint(
      terrace.position[0],
      terrace.position[2] - terrace.halfExtents[2] - 0.01,
    )).toBe(false);
  });

  it('removes only the exact 120 by 120 template floor', () => {
    const world = new World();
    const template = world.spawn(
      { component: Transform, data: { pos: [0, -5, 0] } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtents: [60, 5, 60] } },
    ).unwrap();
    const authored = world.spawn(
      { component: Transform, data: { pos: [0, -1.15, -15.6] } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtents: [0.5, 0.5, 0.5] } },
    ).unwrap();
    expect(removeOversizedTemplateGround(world)).toBe(1);
    expect(world.get(template, Collider).ok).toBe(false);
    expect(world.get(authored, Collider).ok).toBe(true);
  });

  it('creates only horizontal floor colliders whose farthest corners stay inside the shoreline', () => {
    const world = new World();
    const entities = createTraversalFloorColliders(world);
    expect(entities).toHaveLength(MAIN_ISLAND_SUPPORTS.length);
    for (const entity of entities) {
      const transform = world.get(entity, Transform).unwrap();
      const collider = world.get(entity, Collider).unwrap();
      const body = world.get(entity, RigidBody).unwrap();
      expect(collider.shape).toBe(ColliderShapeValue.cuboid);
      expect(collider.halfExtents[1]).toBeCloseTo(0.3);
      expect(transform.pos[1]).toBeCloseTo(-0.3);
      expect(body.type).toBe(RigidBodyTypeValue.static);
    }
    for (const support of MAIN_ISLAND_SUPPORTS.slice(0, 4)) {
      expect(Math.hypot(support.halfExtents[0], support.halfExtents[2])).toBeLessThan(10.57);
    }
  });

  it('recovers a real fall to the last deep-safe ECS pose without resetting mission state', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [2, 0.75, -3] } },
      { component: PlayerMotion, data: { faceX: 1, faceZ: 0, jumpY: 0.75, freeY: 0.75, velocityY: 0, grounded: 1, shootCooldown: 0.12 } },
      { component: FreeCameraMotion, data: { velocityX: 2, velocityY: -3, velocityZ: 4, walkSpeed: 3, runSpeed: 9 } },
    ).unwrap();
    const state: TraversalRecoveryState = { lastSafePosition: [0, 0.75, 0], recoveries: 0, recovered: false };
    expect(stepTraversalRecovery({ world, player, physics: undefined, state, cameraMode: 'orbit' })).toBe(false);
    expect(state.lastSafePosition).toEqual([2, 0.75, -3]);

    world.set(player, Transform, { pos: [14, TRAVERSAL_RECOVERY_Y - 0.1, -2] });
    expect(stepTraversalRecovery({ world, player, physics: undefined, state, cameraMode: 'orbit' })).toBe(true);
    expect(Array.from(world.get(player, Transform).unwrap().pos)).toEqual([2, 0.75, -3]);
    expect(world.get(player, PlayerMotion).unwrap().velocityY).toBe(0);
    expect(world.get(player, FreeCameraMotion).unwrap().velocityZ).toBe(0);
    expect(state.recoveries).toBe(1);
    expect(state.recovered).toBe(true);

    expect(stepTraversalRecovery({ world, player, physics: undefined, state, cameraMode: 'orbit' })).toBe(false);
    expect(state.recoveries).toBe(1);
    expect(state.recovered).toBe(false);
  });

  it('orders recovery after character movement and before mission interaction', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: {} },
      { component: FreeCameraMotion, data: {} },
    ).unwrap();
    installTraversalBoundary({ world, player, physics: undefined, initialPosition: [0, 0.75, 0], getMode: () => 'orbit' });
    const update = world.scheduleData().find((schedule) => schedule.name === 'Update');
    const system = update?.systems.find((candidate) => candidate.name === 'aetherfall-traversal-recovery');
    expect(system?.after).toEqual(['game-player-movement']);
    expect(system?.before).toEqual(['aetherfall-exploration-interaction', 'propagateTransforms']);
  });

  it('records only grounded non-FPS poses as recovery anchors', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [2, 2.4, -3] } },
      { component: PlayerMotion, data: { grounded: 0 } },
      { component: FreeCameraMotion, data: {} },
    ).unwrap();
    const state: TraversalRecoveryState = { lastSafePosition: [0, 0.75, 0], recoveries: 0, recovered: false };

    expect(stepTraversalRecovery({ world, player, physics: undefined, state, cameraMode: 'orbit' })).toBe(false);
    expect(state.lastSafePosition).toEqual([0, 0.75, 0]);

    world.set(player, PlayerMotion, { grounded: 1 });
    expect(stepTraversalRecovery({ world, player, physics: undefined, state, cameraMode: 'fps' })).toBe(false);
    expect(state.lastSafePosition).toEqual([0, 0.75, 0]);

    world.set(player, Transform, { pos: [2, 0.75, -3] });
    expect(stepTraversalRecovery({ world, player, physics: undefined, state, cameraMode: 'orbit' })).toBe(false);
    expect(state.lastSafePosition).toEqual([2, 0.75, -3]);
  });

  it('exposes and resets the public recovery snapshot without leaking supports', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: {} },
      { component: FreeCameraMotion, data: {} },
    ).unwrap();
    const handle = installTraversalBoundary({
      world,
      player,
      physics: undefined,
      initialPosition: [0, 0.75, 0],
      getMode: () => 'orbit',
    });

    expect(handle.snapshot()).toEqual({
      lastSafePosition: [0, 0.75, 0],
      recoveries: 0,
      recovered: false,
    });
    handle.reset();
    expect(handle.snapshot()).toEqual({
      lastSafePosition: [0, 0.75, 0],
      recoveries: 0,
      recovered: false,
    });
    expect(
      world.scheduleData()
        .find((schedule) => schedule.name === 'Update')
        ?.systems.some((system) => system.name === 'aetherfall-traversal-recovery'),
    ).toBe(true);

    const supports = [...handle.supportColliders];
    const firstDispose = handle.dispose();
    const secondDispose = handle.dispose();
    expect(firstDispose).toMatchObject({
      ok: true,
      complete: true,
      attempted: supports.length + 1,
      remaining: 0,
      failures: [],
    });
    expect(secondDispose).toMatchObject({
      ok: true,
      complete: true,
      attempted: 0,
      remaining: 0,
      failures: [],
    });
    for (const support of supports) expect(world.get(support, Collider).ok).toBe(false);
    expect(
      world.scheduleData()
        .find((schedule) => schedule.name === 'Update')
        ?.systems.some((system) => system.name === 'aetherfall-traversal-recovery'),
    ).toBe(false);
  });

  it('continues after a structured collider cleanup failure and retries only the remainder', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: {} },
      { component: FreeCameraMotion, data: {} },
    ).unwrap();
    const handle = installTraversalBoundary({
      world,
      player,
      physics: undefined,
      initialPosition: [0, 0.75, 0],
      getMode: () => 'orbit',
    });
    const failedSupport = handle.supportColliders[1]!;
    const originalDespawn = world.despawn.bind(world);
    let injectFailure = true;
    const despawnSpy = vi.spyOn(world, 'despawn').mockImplementation((entity) => {
      if (entity === failedSupport && injectFailure) {
        injectFailure = false;
        return {
          ok: false,
          error: {
            code: 'injected-cleanup-failure',
            hint: 'retry the failed support',
          },
        } as never;
      }
      return originalDespawn(entity);
    });

    const first = handle.dispose();
    expect(first).toMatchObject({
      ok: false,
      complete: false,
      attempted: handle.supportColliders.length + 1,
      remaining: 1,
      failures: [{
        target: `support-collider:${failedSupport}`,
        kind: 'result',
        code: 'injected-cleanup-failure',
      }],
    });
    expect(world.get(failedSupport, Collider).ok).toBe(true);
    for (const support of handle.supportColliders) {
      if (support !== failedSupport) expect(world.get(support, Collider).ok).toBe(false);
    }

    const second = handle.dispose();
    expect(second).toMatchObject({
      ok: true,
      complete: true,
      attempted: 1,
      remaining: 0,
      failures: [],
    });
    expect(despawnSpy).toHaveBeenCalledTimes(handle.supportColliders.length + 1);
    despawnSpy.mockRestore();
  });

  it('collects a thrown system cleanup failure while still clearing every support', () => {
    const world = new World();
    const player = world.spawn(
      { component: Transform, data: { pos: [0, 0.75, 0] } },
      { component: PlayerMotion, data: {} },
      { component: FreeCameraMotion, data: {} },
    ).unwrap();
    const handle = installTraversalBoundary({
      world,
      player,
      physics: undefined,
      initialPosition: [0, 0.75, 0],
      getMode: () => 'orbit',
    });
    const originalRemoveSystem = world.removeSystem.bind(world);
    const removeSpy = vi.spyOn(world, 'removeSystem')
      .mockImplementationOnce(() => { throw new Error('injected system cleanup throw'); })
      .mockImplementation(originalRemoveSystem);

    const first = handle.dispose();
    expect(first).toMatchObject({
      ok: false,
      complete: false,
      attempted: handle.supportColliders.length + 1,
      remaining: 1,
      failures: [{
        target: 'recovery-system',
        kind: 'throw',
        code: 'cleanup-threw',
        message: 'injected system cleanup throw',
      }],
    });
    for (const support of handle.supportColliders) {
      expect(world.get(support, Collider).ok).toBe(false);
    }

    expect(handle.dispose()).toMatchObject({
      ok: true,
      complete: true,
      attempted: 1,
      remaining: 0,
    });
    expect(handle.dispose()).toMatchObject({ attempted: 0, complete: true });
    expect(removeSpy).toHaveBeenCalledTimes(2);
    removeSpy.mockRestore();
  });
});
