import type { World } from '@forgeax/engine-ecs';

export const GAME_DEFAULT_GAMEPLAY_CONFIG = 'gameDefaultGameplayConfig';
export const GAME_DEFAULT_COMMAND_COUNTERS = 'gameDefaultCommandCounters';
export const GAME_DEFAULT_MATERIAL_ELAPSED_ORIGIN = 'gameDefaultMaterialElapsedOrigin';
export const GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE = 50;

export type GameplayCommandCounters = {
  spawned: number;
  despawned: number;
};

export type GameplayConfig = {
  readonly movement: {
    readonly speed: number;
    readonly bound: number;
    readonly playerY: number;
    readonly jumpVelocity: number;
    readonly gravity: number;
  };
  readonly camera: {
    readonly topDownY: number;
    readonly topDownOffsetZ: number;
    readonly follow: number;
    readonly eyeHeight: number;
    readonly panSpeed: number;
    readonly panHalfHeightMin: number;
    readonly panHalfHeightMax: number;
    readonly topQuaternion: readonly [number, number, number, number];
  };
  readonly projectile: {
    readonly radius: number;
    readonly halfHeight: number;
    readonly speed: number;
    readonly life: number;
    readonly shootCooldown: number;
  };
};

export type DefaultGameplayConfigArgs = {
  readonly playerY: number;
  readonly topQuaternion: readonly [number, number, number, number];
  readonly bulletRadius: number;
  readonly bulletHalfHeight: number;
};

export function installGameplayConfig(world: World, config: GameplayConfig): void {
  world.insertResource(GAME_DEFAULT_GAMEPLAY_CONFIG, config);
}

export function installDefaultGameplayConfig(world: World, args: DefaultGameplayConfigArgs): void {
  installGameplayConfig(world, {
    movement: { speed: 6, bound: 22, playerY: args.playerY, jumpVelocity: 6.5, gravity: 18 },
    camera: {
      topDownY: 13,
      topDownOffsetZ: 9,
      follow: 8,
      eyeHeight: 0.55,
      panSpeed: 8,
      panHalfHeightMin: 3,
      panHalfHeightMax: 14,
      topQuaternion: args.topQuaternion,
    },
    projectile: {
      radius: args.bulletRadius,
      halfHeight: args.bulletHalfHeight,
      speed: 24,
      life: 1.5,
      shootCooldown: 0.18,
    },
  });
}

export function installGameplayCommandCounters(world: World): void {
  world.insertResource<GameplayCommandCounters>(GAME_DEFAULT_COMMAND_COUNTERS, { spawned: 0, despawned: 0 });
}

export function recordGameplayCommand(world: World, kind: keyof GameplayCommandCounters): void {
  const counters = world.getResource<GameplayCommandCounters>(GAME_DEFAULT_COMMAND_COUNTERS);
  world.insertResource(GAME_DEFAULT_COMMAND_COUNTERS, { ...counters, [kind]: counters[kind] + 1 });
}

export function resetGameplayCommandCounters(world: World): void {
  world.insertResource<GameplayCommandCounters>(GAME_DEFAULT_COMMAND_COUNTERS, { spawned: 0, despawned: 0 });
}
