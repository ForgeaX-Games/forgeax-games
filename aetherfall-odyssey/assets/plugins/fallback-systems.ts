import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { inState } from '@forgeax/engine-state';
import { Transform } from '@forgeax/engine-scene';
import { GameplayInput, PlayerMotion } from './components/gameplay';
import { GameState } from './gameplay-state';
import { ORBIT_INITIAL_PITCH, ORBIT_INITIAL_YAW, ORBIT_RADIUS, orbitPose } from './camera-orbit';
import type { VideoTexturePanel } from './video-texture-panel';
import type { WorldScoreTextHandle } from './world-score-text';

type FallbackSystemsArgs = {
  readonly world: World;
  readonly camera: EntityHandle;
  readonly player: EntityHandle | undefined;
  readonly initX: number;
  readonly initZ: number;
  readonly getMode: () => 'topdown' | 'orbit' | 'fps' | 'pan';
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
};

/** Keep camera/asset overlays inspectable when a host scene omits the Player node. */
export function installFallbackSystems(args: FallbackSystemsArgs): void {
  if (args.player !== undefined) return;
  args.world.addSystem(Update, {
    name: 'game-camera-fallback',
    runIf: inState(GameState, 'Play'),
    queries: [],
    fn: () => {
      if (args.getMode() !== 'orbit') return;
      const transform = args.player === undefined ? undefined : args.world.get(args.player, Transform);
      const motion = args.player === undefined ? undefined : args.world.get(args.player, PlayerMotion);
      if (transform?.ok !== true || motion?.ok !== true) return;
      const input = args.player === undefined ? undefined : args.world.get(args.player, GameplayInput);
      if (input?.ok !== true) return;
      const pose = orbitPose([transform.value.pos[0] ?? args.initX, motion.value.jumpY + 1.05, (transform.value.pos[2] ?? args.initZ) - 2.4], ORBIT_INITIAL_YAW + input.value.lookYaw, ORBIT_INITIAL_PITCH + input.value.lookPitch, ORBIT_RADIUS);
      args.world.set(args.camera, Transform, { pos: pose.pos, quat: pose.quat });
    },
  }).unwrap();
  args.world.addSystem(Update, {
    name: 'game-world-score-text-fallback',
    runIf: inState(GameState, 'Play'),
    queries: [],
    after: ['game-camera-fallback'],
    fn: () => {
      args.worldScoreText?.step(args.world.getResource(Time).delta, args.camera);
      args.videoTexturePanel?.step(args.camera);
    },
  }).unwrap();
}
