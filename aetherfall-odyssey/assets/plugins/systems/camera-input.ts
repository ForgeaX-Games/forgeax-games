import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { InputSnapshot } from '@forgeax/engine-input';
import { inState } from '@forgeax/engine-state';
import type { ViewMode } from '../hud';
import { zoomPerspectiveFov } from '../camera-zoom';
import { CameraRig, GameplayInput } from '../components/gameplay';
import { GameState } from '../gameplay-state';
import { GAME_DEFAULT_GAMEPLAY_CONFIG, type GameplayConfig } from '../resources/gameplay';

export type CameraInputSystemContext = {
  readonly world: World;
  readonly player: EntityHandle;
  readonly camera: EntityHandle;
  readonly readInput: () => InputSnapshot;
  readonly getMode: () => ViewMode;
  readonly setPerspectiveFov: (fov: number) => void;
};

/** Camera-only input policy. Pose and camera policy live in ECS CameraRig/Camera. */
export function installCameraInputSystem(ctx: CameraInputSystemContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-camera-input',
    runIf: inState(GameState, 'Play'),
    after: ['game-input-actions'],
    queries: [],
    fn: () => {
      const dt = ctx.world.getResource(Time).delta;
      const config = ctx.world.getResource<GameplayConfig>(GAME_DEFAULT_GAMEPLAY_CONFIG);
      const snap = ctx.readInput();
      const arrowUp = snap.action('arrowUp').isPressed();
      const arrowDown = snap.action('arrowDown').isPressed();
      const arrowLeft = snap.action('arrowLeft').isPressed();
      const arrowRight = snap.action('arrowRight').isPressed();
      const rig = ctx.world.get(ctx.camera, CameraRig);
      if (!rig.ok) return;
      const mode = ctx.getMode();

      if (mode === 'pan') {
        const panXInput = (arrowRight ? 1 : 0) - (arrowLeft ? 1 : 0);
        const panZInput = (arrowDown ? 1 : 0) - (arrowUp ? 1 : 0);
        if (panXInput !== 0 || panZInput !== 0) {
          const length = Math.hypot(panXInput, panZInput) || 1;
          const nextPanX = Math.max(-config.movement.bound, Math.min(config.movement.bound, rig.value.panX + (panXInput / length) * config.camera.panSpeed * dt));
          const nextPanZ = Math.max(-config.movement.bound + config.camera.topDownOffsetZ, Math.min(config.movement.bound + config.camera.topDownOffsetZ, rig.value.panZ + (panZInput / length) * config.camera.panSpeed * dt));
          ctx.world.set(ctx.camera, CameraRig, { panX: nextPanX, panZ: nextPanZ });
        }
        if (snap.mouse.wheelDelta !== 0) {
          const nextHalfHeight = Math.max(config.camera.panHalfHeightMin, Math.min(config.camera.panHalfHeightMax, rig.value.panHalfHeight + snap.mouse.wheelDelta * 0.5));
          ctx.world.set(ctx.camera, CameraRig, { panHalfHeight: nextHalfHeight });
        }
      }
      if ((mode === 'fps' || mode === 'orbit') && snap.mouse.wheelDelta !== 0) {
        const nextFov = zoomPerspectiveFov(rig.value.perspectiveFov, snap.mouse.wheelDelta);
        ctx.world.set(ctx.camera, CameraRig, { perspectiveFov: nextFov });
        ctx.setPerspectiveFov(nextFov);
      }

      // Keyboard fallback for embedded previews where pointer-lock is unavailable.
      if (mode === 'fps' || mode === 'orbit') {
        const turn = 2.4;
        const input = ctx.world.get(ctx.player, GameplayInput);
        if (!input.ok) return;
        let lookYaw = input.value.lookYaw;
        let lookPitch = input.value.lookPitch;
        if (arrowLeft) lookYaw += turn * dt;
        if (arrowRight) lookYaw -= turn * dt;
        if (arrowUp) lookPitch = Math.min(1.2, lookPitch + turn * 0.6 * dt);
        if (arrowDown) lookPitch = Math.max(-1.2, lookPitch - turn * 0.6 * dt);
        ctx.world.set(ctx.player, GameplayInput, { lookYaw, lookPitch });
      }
    },
  }).unwrap();
}
