/**
 * Bevy-style free-camera motion shared by the template's FPS view.
 *
 * The controller owns velocity and speed semantics; the gameplay loop still
 * owns position, collision bounds, shooting, and reset. Keeping this small
 * pure seam makes the feature easy to inspect without creating a second ECS
 * camera or input owner.
 */
export const FREE_CAMERA_WALK_SPEED = 3;
export const FREE_CAMERA_RUN_SPEED = 9;
export const FREE_CAMERA_FRICTION = 25;
export const FREE_CAMERA_SCROLL_FACTOR = 0.1;

export type FreeCameraState = {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  walkSpeed: number;
  runSpeed: number;
};

export function createFreeCameraState(): FreeCameraState {
  return {
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    walkSpeed: FREE_CAMERA_WALK_SPEED,
    runSpeed: FREE_CAMERA_RUN_SPEED,
  };
}

export function resetFreeCamera(state: FreeCameraState): void {
  state.velocityX = 0;
  state.velocityY = 0;
  state.velocityZ = 0;
  state.walkSpeed = FREE_CAMERA_WALK_SPEED;
  state.runSpeed = FREE_CAMERA_RUN_SPEED;
}

export function stepFreeCamera(
  state: FreeCameraState,
  dt: number,
  desiredDirection: readonly [number, number, number],
  running: boolean,
  wheelDelta: number,
): readonly [number, number, number] {
  if (wheelDelta !== 0) {
    const factor = 1 + wheelDelta * FREE_CAMERA_SCROLL_FACTOR;
    state.walkSpeed = Math.max(0.1, state.walkSpeed * factor);
    state.runSpeed = Math.max(0.1, state.runSpeed * factor);
  }
  const speed = running ? state.runSpeed : state.walkSpeed;
  const desiredX = (desiredDirection[0] ?? 0) * speed;
  const desiredY = (desiredDirection[1] ?? 0) * speed;
  const desiredZ = (desiredDirection[2] ?? 0) * speed;
  const decay = Math.exp(-FREE_CAMERA_FRICTION * dt);
  state.velocityX = state.velocityX * decay + desiredX * (1 - decay);
  state.velocityY = state.velocityY * decay + desiredY * (1 - decay);
  state.velocityZ = state.velocityZ * decay + desiredZ * (1 - decay);
  return [state.velocityX * dt, state.velocityY * dt, state.velocityZ * dt];
}
