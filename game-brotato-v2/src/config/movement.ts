import { ARENA } from './arena.ts';

export const MOVEMENT = {
  /** M3 起改由属性系统驱动，M1 是基线常量。 */
  maxSpeed: 6.2,
  acceleration: 48,
  deceleration: 60,
  /** 朝向插值速率；越大转身越快。 */
  turnLambda: 14,
} as const;

export interface MovementState {
  readonly posX: number;
  readonly posZ: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly facing: number;
}

export interface MovementInput {
  readonly x: number;
  readonly z: number;
}

function moveTowards(current: number, target: number, distance: number): number {
  if (Math.abs(target - current) <= distance) return target;
  return current + Math.sign(target - current) * distance;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Pure fixed-step movement integrator used by the ECS system and unit tests. */
export function stepMovement(
  state: MovementState,
  input: MovementInput,
  dt: number,
  options: {
    readonly maxSpeed?: number;
    readonly acceleration?: number;
    readonly deceleration?: number;
    readonly turnLambda?: number;
    readonly arenaLimit?: number;
  } = {},
): MovementState {
  const maxSpeed = options.maxSpeed ?? MOVEMENT.maxSpeed;
  const acceleration = options.acceleration ?? MOVEMENT.acceleration;
  const deceleration = options.deceleration ?? MOVEMENT.deceleration;
  const turnLambda = options.turnLambda ?? MOVEMENT.turnLambda;
  const arenaLimit = options.arenaLimit ?? ARENA.limit;
  const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const inputX = Number.isFinite(input.x) ? input.x : 0;
  const inputZ = Number.isFinite(input.z) ? input.z : 0;
  const inputLength = Math.hypot(inputX, inputZ);
  const hasInput = inputLength > Number.EPSILON;
  const normalizedX = hasInput ? inputX / Math.max(1, inputLength) : 0;
  const normalizedZ = hasInput ? inputZ / Math.max(1, inputLength) : 0;
  const targetX = normalizedX * maxSpeed;
  const targetZ = normalizedZ * maxSpeed;
  const rate = (hasInput ? acceleration : deceleration) * delta;
  let velocityX = moveTowards(state.velocityX, targetX, rate);
  let velocityZ = moveTowards(state.velocityZ, targetZ, rate);
  let posX = state.posX + velocityX * delta;
  let posZ = state.posZ + velocityZ * delta;

  if (posX > arenaLimit) {
    posX = arenaLimit;
    if (velocityX > 0) velocityX = 0;
  } else if (posX < -arenaLimit) {
    posX = -arenaLimit;
    if (velocityX < 0) velocityX = 0;
  }
  if (posZ > arenaLimit) {
    posZ = arenaLimit;
    if (velocityZ > 0) velocityZ = 0;
  } else if (posZ < -arenaLimit) {
    posZ = -arenaLimit;
    if (velocityZ < 0) velocityZ = 0;
  }

  let facing = state.facing;
  if (hasInput) {
    const targetFacing = Math.atan2(normalizedX, normalizedZ);
    const alpha = 1 - Math.exp(-Math.max(0, turnLambda) * delta);
    facing += wrapAngle(targetFacing - facing) * alpha;
  }
  return { posX, posZ, velocityX, velocityZ, facing };
}
