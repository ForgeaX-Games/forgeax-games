import { FixedUpdate, Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Camera } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { inState } from '@forgeax/engine-state';
import type { AnimatedMaterialTarget } from '../animated-target-material';
import { resetAnimatedMaterial, stepAnimatedMaterial } from '../animated-target-material';
import type { DebugAxesHandle } from '../debug-axes';
import { stepRotatingTargets } from '../rotating-target';
import { CameraRig } from '../components/gameplay';
import { GameState } from '../gameplay-state';

export type PresentationSystemsContext = {
  readonly world: World;
  readonly camera: EntityHandle;
  readonly debugAxes: DebugAxesHandle;
  readonly animatedMaterial: AnimatedMaterialTarget | undefined;
  readonly assetEvidenceMode: boolean;
  readonly materialElapsedOriginKey: string;
  readonly initX: number;
  readonly initZ: number;
  readonly topDownY: number;
  readonly topDownOffsetZ: number;
  readonly topQuaternion: readonly [number, number, number, number];
};

/** Keeps authored motion/debug/reset camera concerns out of bootstrap assembly. */
export function installPresentationSystems(ctx: PresentationSystemsContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-rotating-targets',
    runIf: inState(GameState, 'Play'),
    after: [FixedUpdate],
    queries: [],
    fn: () => {
      if (!ctx.assetEvidenceMode) stepRotatingTargets(ctx.world, ctx.world.getResource(Time).delta);
      if (ctx.animatedMaterial !== undefined && !ctx.assetEvidenceMode) {
        const elapsed = ctx.world.getResource(Time).elapsed - ctx.world.getResource<number>(ctx.materialElapsedOriginKey);
        stepAnimatedMaterial(ctx.world, ctx.animatedMaterial, elapsed);
      }
    },
  }).unwrap();
  ctx.world.addSystem(Update, {
    name: 'game-debug-axes',
    runIf: inState(GameState, 'Play'),
    after: ['game-rotating-targets'],
    queries: [],
    fn: () => ctx.debugAxes.draw(),
  }).unwrap();
  ctx.world.addSystem(Update, {
    name: 'game-reset-camera',
    runIf: inState(GameState, 'Reset'),
    queries: [],
    after: ['transitionStates'],
    before: [FixedUpdate],
    fn: () => {
      ctx.world.set(ctx.camera, Transform, { pos: [ctx.initX, ctx.topDownY, ctx.initZ + ctx.topDownOffsetZ], quat: ctx.topQuaternion });
      ctx.world.set(ctx.camera, CameraRig, { followX: ctx.initX, followZ: ctx.initZ + ctx.topDownOffsetZ, panX: ctx.initX, panZ: ctx.initZ + ctx.topDownOffsetZ });
      ctx.world.set(ctx.camera, Camera, { projection: 0 });
    },
  }).unwrap();
}

export function resetPresentationMaterial(world: World, key: string, animatedMaterial: AnimatedMaterialTarget | undefined): void {
  world.insertResource(key, world.getResource(Time).elapsed);
  if (animatedMaterial !== undefined) resetAnimatedMaterial(world, animatedMaterial);
}
