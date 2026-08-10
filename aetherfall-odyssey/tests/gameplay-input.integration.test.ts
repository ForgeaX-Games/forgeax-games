import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { Update, World, type EntityHandle } from '@forgeax/engine-ecs';
import {
  deriveActionStates,
  snapshotFromSample,
  type GamepadSlotSample,
  type InputBackendSample,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { quat } from '@forgeax/engine-math';
import { Camera, MeshFilter, MeshRenderer, perspective } from '@forgeax/engine-render';
import { propagateTransforms, Transform } from '@forgeax/engine-scene';
import { describe, expect, it } from 'vitest';
import { GameplayInput, PlayerMotion } from '../assets/plugins/components/gameplay';
import {
  CAMERA_LOOK_MOUSE_SENSITIVITY,
  CAMERA_LOOK_PITCH_LIMIT,
  GAMEPAD_LOOK_DEADZONE,
  GAMEPAD_LOOK_RADIANS_PER_SECOND,
  createExplorationInputDeviceTracker,
  installGameplayInput,
  resolveCameraLook,
} from '../assets/plugins/gameplay-input';
import { GAME_DEFAULT_INPUT_MAP } from '../assets/plugins/resources/input';

const WIDTH = 1600;
const HEIGHT = 900;

function pointerSnapshot(x: number, y: number): InputSnapshot {
  const sample: InputBackendSample = {
    downKeys: new Set(),
    upKeys: new Set(),
    buttons: [false, false, false],
    movementX: 0,
    movementY: 0,
    wheelDelta: 0,
    focused: true,
    pointerLocked: false,
  };
  return snapshotFromSample({
    ...sample,
    capabilities: { gamepad: false, pointer: true },
    mouseX: x,
    mouseY: y,
    pointerEvents: [{ pointerId: 1, phase: 'down', x, y, pressure: 1, pointerType: 'mouse' }],
  });
}

function lookSnapshot(args: {
  readonly axisX?: number;
  readonly axisY?: number;
  readonly standardMapping?: boolean;
  readonly pointerLocked?: boolean;
  readonly mouseX?: number;
  readonly mouseY?: number;
  readonly keys?: readonly string[];
} = {}): InputSnapshot {
  const sample: InputBackendSample = {
    downKeys: new Set(args.keys ?? []),
    upKeys: new Set(),
    buttons: [false, false, false],
    movementX: args.mouseX ?? 0,
    movementY: args.mouseY ?? 0,
    wheelDelta: 0,
    focused: true,
    pointerLocked: args.pointerLocked ?? false,
    capabilities: { gamepad: true, pointer: true },
    gamepads: [{
      index: 0,
      standardMapping: args.standardMapping ?? true,
      pressed: new Set(),
      justPressed: new Set(),
      justReleased: new Set(),
      buttonValues: new Map(),
      axes: [0, 0, args.axisX ?? 0, args.axisY ?? 0],
    }],
  };
  return snapshotFromSample(
    sample,
    deriveActionStates(sample, GAME_DEFAULT_INPUT_MAP),
    GAME_DEFAULT_INPUT_MAP,
  );
}

function makeWorld(): {
  world: World;
  player: EntityHandle;
  camera: EntityHandle;
} {
  const world = new World();
  const pitch = -Math.atan2(13, 9);
  const cameraRotation = quat.fromAxisAngle(quat.create(), [1, 0, 0], pitch);
  const camera = world
    .spawn(
      { component: Transform, data: { pos: [0, 13, 9], quat: cameraRotation } },
      { component: Camera, data: perspective({ fov: Math.PI / 3, aspect: WIDTH / HEIGHT }) },
    )
    .unwrap();
  const player = world
    .spawn(
      { component: Transform, data: { pos: [2, 0.75, 1] } },
      { component: GameplayInput, data: {} },
      { component: PlayerMotion, data: {} },
    )
    .unwrap();
  world
    .spawn(
      { component: Transform, data: { pos: [0, -0.1, 0], scale: [24, 0.2, 24] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: {} },
    )
    .unwrap();
  world.addSystem(Update, { name: 'input-frame-start-scan', queries: [], fn: () => {} }).unwrap();
  return { world, player, camera };
}

describe('game-default gameplay input integration', () => {
  it('maps the standard right stick through one explicit radial deadzone', () => {
    expect(GAME_DEFAULT_INPUT_MAP.filter((entry) => entry.action.startsWith('look'))).toEqual([
      { action: 'lookLeft', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 2, sign: -1 }] },
      { action: 'lookRight', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 2, sign: 1 }] },
      { action: 'lookUp', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 3, sign: -1 }] },
      { action: 'lookDown', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 3, sign: 1 }] },
    ]);
    expect(lookSnapshot({ axisX: GAMEPAD_LOOK_DEADZONE }).getVector(
      'lookLeft', 'lookRight', 'lookUp', 'lookDown', { deadzone: GAMEPAD_LOOK_DEADZONE },
    )).toEqual({ x: 0, y: 0 });
  });

  it('applies standard right-stick yaw/pitch with dt, Y-down convention, and pitch clamp', () => {
    const yaw = resolveCameraLook({
      snapshot: lookSnapshot({ axisX: 1 }),
      mode: 'orbit',
      deltaSeconds: 0.1,
      lookYaw: 0,
      lookPitch: 0,
    });
    expect(yaw.source).toBe('gamepad');
    expect(yaw.lookYaw).toBeCloseTo(-GAMEPAD_LOOK_RADIANS_PER_SECOND * 0.1, 6);
    expect(yaw.lookPitch).toBe(0);

    const down = resolveCameraLook({
      snapshot: lookSnapshot({ axisY: 1 }),
      mode: 'fps',
      deltaSeconds: 0.1,
      lookYaw: 0,
      lookPitch: -1.1,
    });
    expect(down.lookPitch).toBe(-CAMERA_LOOK_PITCH_LIMIT);
  });

  it('gives active mouse then keyboard priority over a same-frame right stick', () => {
    const mouse = resolveCameraLook({
      snapshot: lookSnapshot({ axisX: 1, pointerLocked: true, mouseX: 10 }),
      mode: 'orbit',
      deltaSeconds: 0.1,
      lookYaw: 0,
      lookPitch: 0,
    });
    expect(mouse.source).toBe('mouse');
    expect(mouse.lookYaw).toBeCloseTo(-10 * CAMERA_LOOK_MOUSE_SENSITIVITY, 6);

    const keyboard = resolveCameraLook({
      snapshot: lookSnapshot({ axisX: 1, keys: ['ArrowRight'] }),
      mode: 'orbit',
      deltaSeconds: 0.1,
      lookYaw: 0.5,
      lookPitch: 0.25,
    });
    expect(keyboard).toEqual({ source: 'keyboard', lookYaw: 0.5, lookPitch: 0.25 });
  });

  it('ignores non-standard pads and all right-stick look outside Orbit/FPS', () => {
    const nonStandard = resolveCameraLook({
      snapshot: lookSnapshot({ axisX: 1, standardMapping: false }),
      mode: 'fps',
      deltaSeconds: 0.1,
      lookYaw: 0.5,
      lookPitch: 0.25,
    });
    expect(nonStandard).toEqual({ source: 'none', lookYaw: 0.5, lookPitch: 0.25 });
    for (const mode of ['topdown', 'pan'] as const) {
      expect(resolveCameraLook({
        snapshot: lookSnapshot({ axisX: 1 }),
        mode,
        deltaSeconds: 0.1,
        lookYaw: 0.5,
        lookPitch: 0.25,
      })).toEqual({ source: 'none', lookYaw: 0.5, lookPitch: 0.25 });
    }
  });

  it('drives Orbit look from a standard pad without requiring pointer lock', () => {
    const { world, player, camera } = makeWorld();
    const snapshot = lookSnapshot({ axisX: 1 });
    installGameplayInput({
      world,
      player,
      camera,
      canvas: { width: WIDTH, height: HEIGHT } as HTMLCanvasElement,
      hud: { setLockStatus: () => {} } as never,
      readInput: () => snapshot,
      getMode: () => 'orbit',
      getPlayerPosition: () => ({ x: 2, z: 1 }),
    });

    world.update(0.1).unwrap();
    const input = world.get(player, GameplayInput).unwrap();
    expect(input.lookYaw).toBeCloseTo(-GAMEPAD_LOOK_RADIANS_PER_SECOND * 0.1, 6);
    expect(input.lookPitch).toBe(0);
  });

  it('tracks the last active keyboard or standard gamepad without capability-only switching', () => {
    const tracker = createExplorationInputDeviceTracker();
    const sample = (overrides: Partial<InputBackendSample> = {}): InputSnapshot =>
      snapshotFromSample({
        downKeys: new Set(),
        upKeys: new Set(),
        buttons: [false, false, false],
        movementX: 0,
        movementY: 0,
        wheelDelta: 0,
        focused: true,
        pointerLocked: false,
        capabilities: { gamepad: true, pointer: true },
        ...overrides,
      });
    const pad = (overrides: Partial<GamepadSlotSample> = {}): GamepadSlotSample => ({
      index: 0,
      standardMapping: true,
      pressed: new Set(),
      justPressed: new Set(),
      justReleased: new Set(),
      buttonValues: new Map(),
      axes: [0, 0, 0, 0],
      ...overrides,
    });

    expect(tracker.update(sample())).toBe('keyboard');
    expect(tracker.update(sample({
      gamepads: [pad({ standardMapping: false, axes: [0.7, 0, 0, 0] })],
    }))).toBe('keyboard');
    expect(tracker.update(sample({ gamepads: [pad({ axes: [0.7, 0, 0, 0] })] }))).toBe('gamepad');
    expect(tracker.update(sample())).toBe('gamepad');
    expect(tracker.update(sample({ downKeys: new Set(['e']) }))).toBe('keyboard');
    tracker.reset();
    expect(tracker.current()).toBe('keyboard');
  });

  it('maps standard left-stick press to sprint without activating non-standard pads', () => {
    const sample = (standardMapping: boolean): InputBackendSample => ({
      downKeys: new Set(),
      upKeys: new Set(),
      buttons: [false, false, false],
      movementX: 0,
      movementY: 0,
      wheelDelta: 0,
      focused: true,
      pointerLocked: false,
      capabilities: { gamepad: true, pointer: false },
      gamepads: [{
        index: 0,
        standardMapping,
        pressed: new Set([10]),
        justPressed: new Set([10]),
        justReleased: new Set(),
        buttonValues: new Map([[10, 1]]),
        axes: [0, 0, 0, 0],
      }],
    });
    const freeRun = (standardMapping: boolean) =>
      deriveActionStates(sample(standardMapping), GAME_DEFAULT_INPUT_MAP)
        .find((state) => state.action === 'freeRun');

    expect(freeRun(true)).toMatchObject({
      pressed: true,
      justPressed: true,
      strength: 1,
    });
    expect(freeRun(false)).toMatchObject({
      pressed: false,
      justPressed: false,
      strength: 0,
    });
  });

  it('keeps distinct ground clicks distinct after picking the shared ground mesh', () => {
    const { world, player, camera } = makeWorld();
    let snapshot = pointerSnapshot(1100, 225);
    installGameplayInput({
      world,
      player,
      camera,
      canvas: { width: WIDTH, height: HEIGHT } as HTMLCanvasElement,
      hud: { setLockStatus: () => {} } as never,
      readInput: () => snapshot,
      getMode: () => 'topdown',
      getPlayerPosition: () => ({ x: 2, z: 1 }),
    });

    propagateTransforms(world);
    world.update(0).unwrap();
    const first = world.get(player, GameplayInput).unwrap();

    snapshot = pointerSnapshot(700, 650);
    propagateTransforms(world);
    world.update(0).unwrap();
    const second = world.get(player, GameplayInput).unwrap();

    expect(first.shotDirValid).toBe(1);
    expect(second.shotDirValid).toBe(1);
    expect(
      Math.hypot(first.shotDirX - second.shotDirX, first.shotDirZ - second.shotDirZ),
    ).toBeGreaterThan(0.1);
  });
});
