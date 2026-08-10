import type { EntityHandle } from '@forgeax/engine-ecs';
import type { PickHit } from '@forgeax/engine-picking';

export type GameplayAimPlayer = { readonly x: number; readonly z: number };

export type GameplayAimRay = ArrayLike<number>;

/** Resolve a top-down shot from the authoritative pick point or ground ray. */
export function resolveShotDirection(args: {
  readonly player: GameplayAimPlayer;
  readonly playerEntity: EntityHandle;
  readonly hit: PickHit | undefined;
  readonly hitIsPlayerBodyPart?: boolean;
  readonly ray: GameplayAimRay | undefined;
}): { readonly x: number; readonly z: number } | undefined {
  let aimX: number;
  let aimZ: number;
  if (
    args.hit !== undefined &&
    args.hit.entity !== args.playerEntity &&
    args.hitIsPlayerBodyPart !== true
  ) {
    aimX = args.hit.point[0] as number;
    aimZ = args.hit.point[2] as number;
  } else {
    const ray = args.ray;
    const rayDirectionY = ray?.[4] as number | undefined;
    if (ray === undefined || rayDirectionY === undefined || Math.abs(rayDirectionY) <= 1e-6) {
      return undefined;
    }
    const distance = -(ray[1] as number) / rayDirectionY;
    if (!Number.isFinite(distance) || distance < 0) return undefined;
    aimX = (ray[0] as number) + (ray[3] as number) * distance;
    aimZ = (ray[2] as number) + (ray[5] as number) * distance;
  }

  const dx = aimX - args.player.x;
  const dz = aimZ - args.player.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-3) return undefined;
  return { x: dx / length, z: dz / length };
}
