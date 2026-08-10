import { defineSystem, Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { pick, viewportToWorld } from '@forgeax/engine-picking';
import type { InputSnapshot } from '@forgeax/engine-input';
import type { HudHandle, ViewMode } from './hud';
import { GameplayInput, PlayerBodyPart, PlayerMotion } from './components/gameplay';
import { resolveShotDirection } from './gameplay-aim';
import { GAMEPAD_LOOK_DEADZONE } from './resources/input';

export { GAMEPAD_LOOK_DEADZONE } from './resources/input';

export type GameplayInputContext = {
  world: World;
  player: EntityHandle;
  camera: EntityHandle;
  canvas: HTMLCanvasElement;
  hud: HudHandle;
  readInput: () => InputSnapshot;
  getMode: () => ViewMode;
  getPlayerPosition: () => { x: number; z: number };
};

export const CAMERA_LOOK_MOUSE_SENSITIVITY = 0.0022;
export const GAMEPAD_LOOK_RADIANS_PER_SECOND = 2.4;
export const CAMERA_LOOK_PITCH_LIMIT = 1.2;
const CAMERA_LOOK_MAX_DELTA_SECONDS = 0.1;

export type CameraLookSource = 'none' | 'mouse' | 'keyboard' | 'gamepad';

export type CameraLookResult = {
  readonly source: CameraLookSource;
  readonly lookYaw: number;
  readonly lookPitch: number;
};

export type CameraLookArgs = {
  readonly snapshot: InputSnapshot;
  readonly mode: ViewMode;
  readonly deltaSeconds: number;
  readonly lookYaw: number;
  readonly lookPitch: number;
};

const clampPitch = (pitch: number): number =>
  Math.max(-CAMERA_LOOK_PITCH_LIMIT, Math.min(CAMERA_LOOK_PITCH_LIMIT, pitch));

/** Resolve camera look with active mouse, then keyboard, then gamepad priority. */
export function resolveCameraLook(args: CameraLookArgs): CameraLookResult {
  const unchanged = (source: CameraLookSource = 'none'): CameraLookResult => ({
    source,
    lookYaw: args.lookYaw,
    lookPitch: args.lookPitch,
  });
  if (args.mode !== 'fps' && args.mode !== 'orbit') return unchanged();

  const mouse = args.snapshot.mouse.movementDelta;
  if (args.snapshot.mouse.pointerLocked && (mouse.x !== 0 || mouse.y !== 0)) {
    return {
      source: 'mouse',
      lookYaw: args.lookYaw - mouse.x * CAMERA_LOOK_MOUSE_SENSITIVITY,
      lookPitch: clampPitch(
        args.lookPitch - mouse.y * CAMERA_LOOK_MOUSE_SENSITIVITY,
      ),
    };
  }

  const keyboardActive =
    args.snapshot.action('arrowLeft').isPressed() ||
    args.snapshot.action('arrowRight').isPressed() ||
    args.snapshot.action('arrowUp').isPressed() ||
    args.snapshot.action('arrowDown').isPressed();
  if (keyboardActive) return unchanged('keyboard');

  const stick = args.snapshot.getVector(
    'lookLeft',
    'lookRight',
    'lookUp',
    'lookDown',
    { deadzone: GAMEPAD_LOOK_DEADZONE },
  );
  if (stick.x === 0 && stick.y === 0) return unchanged();
  const dt = Number.isFinite(args.deltaSeconds)
    ? Math.max(0, Math.min(CAMERA_LOOK_MAX_DELTA_SECONDS, args.deltaSeconds))
    : 0;
  return {
    source: 'gamepad',
    lookYaw: args.lookYaw - stick.x * GAMEPAD_LOOK_RADIANS_PER_SECOND * dt,
    // Standard axis 3 is positive downward; down lowers gameplay pitch.
    lookPitch: clampPitch(
      args.lookPitch - stick.y * GAMEPAD_LOOK_RADIANS_PER_SECOND * dt,
    ),
  };
}

export type ExplorationInputDevice = 'keyboard' | 'gamepad';

export interface ExplorationInputDeviceTracker {
  update(snapshot: InputSnapshot): ExplorationInputDevice;
  current(): ExplorationInputDevice;
  reset(): void;
}

const KEYBOARD_ACTIVITY_KEYS = [
  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'e', 'E', 'r', 'R',
  'Shift', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
] as const;
const GAMEPAD_ACTIVITY_BUTTONS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
] as const;

/** Track only observed activity; device capability alone never changes copy. */
export function createExplorationInputDeviceTracker(): ExplorationInputDeviceTracker {
  let device: ExplorationInputDevice = 'keyboard';
  return {
    update(snapshot) {
      let gamepadEdge = false;
      let gamepadHeld = false;
      for (let slot = 0; slot < 4; slot += 1) {
        const pad = snapshot.gamepad(slot);
        if (!pad.connected || !pad.standardMapping) continue;
        gamepadEdge ||= GAMEPAD_ACTIVITY_BUTTONS.some((button) => pad.justPressed(button));
        gamepadHeld ||= GAMEPAD_ACTIVITY_BUTTONS.some((button) => pad.button(button));
        gamepadHeld ||= ([0, 1, 2, 3] as const).some(
          (axis) => Math.abs(pad.axis(axis)) >= 0.2,
        );
      }
      const keyboardEdge = KEYBOARD_ACTIVITY_KEYS.some((key) =>
        snapshot.keyboard.justPressed(key),
      ) || snapshot.mouse.justPressed(0) || snapshot.mouse.justPressed(1) ||
        snapshot.mouse.justPressed(2) || snapshot.mouse.wheelDelta !== 0 ||
        snapshot.mouse.movementDelta.x !== 0 ||
        snapshot.mouse.movementDelta.y !== 0 || snapshot.pointerEvents.length > 0;
      const keyboardHeld = KEYBOARD_ACTIVITY_KEYS.some((key) =>
        snapshot.keyboard.down(key),
      ) || snapshot.mouse.button(0) || snapshot.mouse.button(1) ||
        snapshot.mouse.button(2);

      if (gamepadEdge) device = 'gamepad';
      else if (keyboardEdge) device = 'keyboard';
      else if (gamepadHeld) device = 'gamepad';
      else if (keyboardHeld) device = 'keyboard';
      return device;
    },
    current: () => device,
    reset: () => { device = 'keyboard'; },
  };
}

/** Install the input-to-intent systems shared by all three camera views. */
export function installGameplayInput(ctx: GameplayInputContext): void {
  const gameLook = defineSystem({
    name: 'game-look',
    queries: [] as const,
    after: ['input-frame-start-scan'],
    fn: () => {
      const snap = ctx.readInput();
      const mode = ctx.getMode();
      if (mode !== 'fps' && mode !== 'orbit') return;
      const input = ctx.world.get(ctx.player, GameplayInput);
      if (!input.ok) return;
      const resolved = resolveCameraLook({
        snapshot: snap,
        mode,
        deltaSeconds: ctx.world.getResource(Time).delta,
        lookYaw: input.value.lookYaw,
        lookPitch: input.value.lookPitch,
      });
      if (resolved.source === 'mouse' || resolved.source === 'gamepad') {
        ctx.world.set(ctx.player, GameplayInput, {
          lookYaw: resolved.lookYaw,
          lookPitch: resolved.lookPitch,
        });
      }
      ctx.hud.setLockStatus(snap.mouse.pointerLocked
        ? '🎮 Locked · mouse look · ESC releases'
        : '👍 Click canvas to lock mouse');
    },
  });
  ctx.world.addSystem(Update, gameLook);

  const gamePickShoot = defineSystem({
    name: 'game-pick-shoot',
    queries: [] as const,
    after: ['input-frame-start-scan'],
    fn: () => {
      const snap = ctx.readInput();
      for (const ev of snap.pointerEvents) {
        if (ev.phase !== 'down' || ev.pointerType !== 'mouse') continue;
        if (ctx.getMode() === 'fps' || (ctx.getMode() === 'orbit' && snap.mouse.pointerLocked)) {
          if (snap.mouse.pointerLocked) ctx.world.set(ctx.player, GameplayInput, { wantShoot: 1 });
          continue;
        }
        const player = ctx.getPlayerPosition();
        const hit = pick(ctx.world, ctx.camera, ev.x, ev.y, ctx.canvas.width, ctx.canvas.height);
        const ray = viewportToWorld(
          ctx.world,
          ctx.camera,
          ev.x,
          ev.y,
          ctx.canvas.width,
          ctx.canvas.height,
        );
        const hitIsPlayerBodyPart =
          hit !== undefined &&
          (hit.entity === ctx.player || ctx.world.get(hit.entity, PlayerBodyPart).ok);
        const direction = resolveShotDirection({
          player,
          playerEntity: ctx.player,
          hit,
          hitIsPlayerBodyPart,
          ray,
        });
        if (direction === undefined) continue;
        ctx.world.set(ctx.player, GameplayInput, {
          shotDirX: direction.x,
          shotDirZ: direction.z,
          shotDirValid: 1,
          wantShoot: 1,
        });
        ctx.world.set(ctx.player, PlayerMotion, { faceX: direction.x, faceZ: direction.z });
      }
    },
  });
  ctx.world.addSystem(Update, gamePickShoot);
}
