import { MeshRenderer } from '@forgeax/engine-render';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { inState } from '@forgeax/engine-state';
import type { GameplayAudio } from '../gameplay-audio';
import type { GameplayChangeDetectionHandle } from '../change-detection';
import type { ChromaticAberrationHandle } from '../chromatic-aberration';
import { recordTargetProfileHit, targetProfilePoints, type TargetProfileLoop } from '../target-profile-loop';
import type { SpriteAtlasLoop } from '../sprite-atlas-loop';
import type { VfxHitLoop } from '../vfx-hit-loop';
import type { HitStreakHandle } from '../hit-streak';
import type { WorldScoreTextHandle } from '../world-score-text';
import type { MatHandle } from '../scene-runtime';
import { activeScoringTargetEntities, scoringPoints, type ScoringTargetQuery, ScoringTarget } from '../scoring-target';
import { GameState } from '../gameplay-state';
import { HitFlash, Projectile } from '../components/gameplay';

export type TargetFeedbackSystemContext = {
  readonly world: World;
  readonly targetQuery: ScoringTargetQuery;
  readonly projectileEntities: () => readonly EntityHandle[];
  readonly targetProfile: TargetProfileLoop | undefined;
  readonly onProfileHit?: () => void;
  readonly spriteAtlasLoop: SpriteAtlasLoop | undefined;
  readonly onAtlasHit?: () => void;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly onFontScore?: () => void;
  readonly onVideoHit?: () => void;
  readonly onFbxHit?: (entity: EntityHandle) => void;
  readonly changeDetection: GameplayChangeDetectionHandle;
  readonly damageTarget: (entity: EntityHandle, points: number) => void;
  readonly spawnPopup: (text: string, x: number, y: number, z: number) => void;
  readonly gameplayAudio: GameplayAudio | undefined;
  readonly vfxHitLoop: VfxHitLoop;
  readonly triggerFlash: (entity?: EntityHandle) => void;
  readonly materialsForCurrentMesh: (entity: EntityHandle, flashing: boolean) => readonly MatHandle[];
  readonly chromaticAberration: ChromaticAberrationHandle;
  readonly hitStreak: HitStreakHandle | undefined;
};

/** Resolves projectile hits and owns the transient HitFlash component lifecycle. */
export function installTargetFeedbackSystem(ctx: TargetFeedbackSystemContext): void {
  const hitRadiusSquared = 0.9 * 0.9;
  ctx.world.addSystem(Update, {
    name: 'game-target-feedback',
    runIf: inState(GameState, 'Play'),
    after: ['game-projectile-simulation'],
    queries: [],
    fn: () => {
      const dt = ctx.world.getResource(Time).delta;
      for (const projectileEntity of ctx.projectileEntities()) {
        const projectileTransform = ctx.world.get(projectileEntity, Transform);
        const projectile = ctx.world.get(projectileEntity, Projectile);
        if (!projectileTransform.ok || !projectile.ok) continue;
        for (const entity of activeScoringTargetEntities(ctx.world, ctx.targetQuery)) {
          const target = ctx.world.get(entity, ScoringTarget);
          if (!target.ok || target.value.slot >= 32) continue;
          const mask = 1 << target.value.slot;
          if ((projectile.value.hitMask & mask) !== 0) continue;
          const transform = ctx.world.get(entity, Transform);
          if (!transform.ok) continue;
          const fx = transform.value.pos[0] ?? 0;
          const fy = transform.value.pos[1] ?? 0;
          const fz = transform.value.pos[2] ?? 0;
          const dx = (projectileTransform.value.pos[0] ?? 0) - fx;
          const dy = (projectileTransform.value.pos[1] ?? 0) - fy;
          const dz = (projectileTransform.value.pos[2] ?? 0) - fz;
          if (dx * dx + dy * dy + dz * dz >= hitRadiusSquared) continue;
          const hitMask = projectile.value.hitMask | mask;
          ctx.world.set(projectileEntity, Projectile, { hitMask });
          if (ctx.spriteAtlasLoop?.recordHit(projectileEntity)) ctx.onAtlasHit?.();
          if (recordTargetProfileHit(ctx.targetProfile, entity)) ctx.onProfileHit?.();
          const basePoints = scoringPoints(ctx.world, entity);
          const impactScale = Math.max(1, projectile.value.impactScale);
          const points = basePoints === undefined
            ? undefined
            : Math.round(targetProfilePoints(ctx.targetProfile, basePoints) * impactScale);
          if (points !== undefined) {
            const award = ctx.hitStreak?.recordHit(points) ?? { points, hits: 0, multiplier: 1 };
            ctx.changeDetection.recordHit(entity, award.points);
            ctx.damageTarget(entity, award.points);
            ctx.spawnPopup('+' + award.points, fx, fy + 0.8, fz);
            if (ctx.worldScoreText?.snapshot().fontSource === 'ttf-plugin' && ctx.spriteAtlasLoop?.active !== true) ctx.onFontScore?.();
            ctx.onVideoHit?.();
            ctx.onFbxHit?.(entity);
            ctx.gameplayAudio?.triggerHit();
            ctx.vfxHitLoop.trigger();
          }
          const flash = ctx.world.get(entity, HitFlash);
          if (!flash.ok || flash.value.remaining <= 0) ctx.triggerFlash(entity);
        }
      }
      for (const entity of activeScoringTargetEntities(ctx.world, ctx.targetQuery)) {
        const flash = ctx.world.get(entity, HitFlash);
        if (!flash.ok || flash.value.remaining <= 0) continue;
        const remaining = flash.value.remaining - dt;
        if (remaining <= 0) {
          ctx.world.set(entity, MeshRenderer, { materials: [...ctx.materialsForCurrentMesh(entity, false)] });
          ctx.world.set(entity, HitFlash, { remaining: 0 });
        } else {
          ctx.world.set(entity, HitFlash, { remaining });
        }
      }
      const intensity = ctx.chromaticAberration.snapshot().intensity;
      if (intensity > 0) ctx.chromaticAberration.setIntensity(Math.max(0, intensity - dt * 0.14));
    },
  }).unwrap();
}
