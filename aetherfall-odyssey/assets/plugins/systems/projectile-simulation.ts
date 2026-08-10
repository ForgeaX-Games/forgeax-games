import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { Layer, MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { SpriteAnimation, SpriteRegionOverride, SPRITE_PLAYBACK_MODE_LOOP } from '@forgeax/engine-render/authoring';
import { quat, type Handle } from '@forgeax/engine-runtime';
import type { InputSnapshot } from '@forgeax/engine-input';
import { inState } from '@forgeax/engine-state';
import type { CustomProjectileMesh } from '../custom-projectile-mesh';
import type { SpriteAtlasLoop } from '../sprite-atlas-loop';
import { GameState } from '../gameplay-state';
import { ChargeShot, GameplayInput, PlayerMotion, Projectile, type ProjectileVisual } from '../components/gameplay';
import { GAME_DEFAULT_GAMEPLAY_CONFIG, type GameplayConfig } from '../resources/gameplay';

export type ProjectileSimulationSystemContext = {
  readonly world: World;
  readonly root: EntityHandle;
  readonly readInput: () => InputSnapshot;
  readonly getMode: () => 'topdown' | 'orbit' | 'fps' | 'pan';
  readonly getProjectileVisual: () => ProjectileVisual;
  readonly customProjectile: CustomProjectileMesh | undefined;
  readonly spriteAtlasLoop: SpriteAtlasLoop | undefined;
  readonly projectileMesh: Handle<'MeshAsset', 'shared'>;
  readonly projectileMaterial: Handle<'MaterialAsset', 'shared'>;
  readonly handleQuad: Handle<'MeshAsset', 'shared'>;
  readonly projectileEntities: () => readonly EntityHandle[];
  readonly onSpawn: () => void;
  readonly onDespawn: () => void;
};

/** Spawns and advances projectiles from ECS-owned Projectile + Transform state. */
export function installProjectileSimulationSystem(ctx: ProjectileSimulationSystemContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-projectile-simulation',
    runIf: inState(GameState, 'Play'),
    after: ['game-player-movement'],
    queries: [],
    fn: (_world, _queryResults, commands) => {
      const dt = ctx.world.getResource(Time).delta;
      const config = ctx.world.getResource<GameplayConfig>(GAME_DEFAULT_GAMEPLAY_CONFIG);
      const snap = ctx.readInput();
      const playerTransform = ctx.world.get(ctx.root, Transform);
      const playerMotion = ctx.world.get(ctx.root, PlayerMotion);
      const gameplayInput = ctx.world.get(ctx.root, GameplayInput);
      const charge = ctx.world.get(ctx.root, ChargeShot);
      if (!playerTransform.ok || !playerMotion.ok || !gameplayInput.ok || !charge.ok) return;
      const px = playerTransform.value.pos[0] ?? 0;
      const pz = playerTransform.value.pos[2] ?? 0;
      const jumpY = playerMotion.value.jumpY;
      const freeY = playerMotion.value.freeY;
      const faceX = playerMotion.value.faceX;
      const faceZ = playerMotion.value.faceZ;
      let shootCd = playerMotion.value.shootCooldown - dt;
      const playerY = ctx.getMode() === 'fps' ? freeY : jumpY;
      const chargedFire = charge.value.release !== 0;
      const normalFire = charge.value.active === 0 && (snap.action('shoot').isPressed() || gameplayInput.value.wantShoot !== 0);
      const fire = (normalFire || chargedFire) && shootCd <= 0;
      ctx.world.set(ctx.root, GameplayInput, { wantShoot: 0 });
      if (fire) {
        shootCd = config.projectile.shootCooldown;
        let dirX = faceX;
        let dirY = 0;
        let dirZ = faceZ;
        let by = playerY + 0.15;
        if (ctx.getMode() === 'fps') {
          const cp = Math.cos(gameplayInput.value.lookPitch);
          dirX = -Math.sin(gameplayInput.value.lookYaw) * cp;
          dirY = Math.sin(gameplayInput.value.lookPitch);
          dirZ = -Math.cos(gameplayInput.value.lookYaw) * cp;
          by = freeY + config.camera.eyeHeight;
        } else if (gameplayInput.value.shotDirValid !== 0) {
          dirX = gameplayInput.value.shotDirX;
          dirZ = gameplayInput.value.shotDirZ;
        }
        ctx.world.set(ctx.root, GameplayInput, { shotDirValid: 0 });
        const bx = px + dirX * 0.6;
        const byy = by + dirY * 0.6;
        const bz = pz + dirZ * 0.6;
        const impactScale = chargedFire ? Math.max(1, charge.value.power) : 1;
        const shotScale = 1 + (impactScale - 1) * 0.6;
        const bulletQuat = quat.fromUnitVectors(quat.create(), [0, 1, 0], [dirX, dirY, dirZ]);
        const visual = ctx.getProjectileVisual();
        const useSprite = visual !== 'mesh' && ctx.customProjectile !== undefined;
        const atlasActive = ctx.spriteAtlasLoop?.active === true;
        const shotMesh = useSprite ? ctx.handleQuad : ctx.projectileMesh;
        const shotMaterial = atlasActive
          ? visual === 'sprite-lit'
            ? ctx.spriteAtlasLoop!.spriteLitMaterialHandle
            : ctx.spriteAtlasLoop!.spriteMaterialHandle
          : visual === 'sprite-lit'
            ? ctx.customProjectile!.spriteLitMaterialHandle
            : visual === 'sprite'
              ? ctx.customProjectile!.spriteMaterialHandle
              : ctx.projectileMaterial;
        const spriteAnimationComponents = atlasActive
          ? [
            { component: SpriteAnimation, data: { frameCount: ctx.spriteAtlasLoop!.frameCount, frameDuration: ctx.spriteAtlasLoop!.frameDuration, regions: new Float32Array(ctx.spriteAtlasLoop!.regions), playbackMode: SPRITE_PLAYBACK_MODE_LOOP } },
            { component: SpriteRegionOverride, data: { region: new Float32Array(ctx.spriteAtlasLoop!.regions.slice(0, 4)) } },
          ]
          : [];
        const entity = commands.spawn(
          { component: Transform, data: { pos: [bx, byy, bz], quat: [bulletQuat[0]!, bulletQuat[1]!, bulletQuat[2]!, bulletQuat[3]!], scale: [shotScale, shotScale, shotScale] } },
          { component: MeshFilter, data: { assetHandle: shotMesh } },
          { component: MeshRenderer, data: { materials: [shotMaterial] } },
          { component: Layer, data: { value: useSprite ? 100 : 0 } },
          { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic, ccdEnabled: true } },
          { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: config.projectile.radius, halfHeight: config.projectile.halfHeight, friction: 0, restitution: 0.6 } },
          { component: Projectile, data: { age: 0, velocityX: dirX * config.projectile.speed, velocityY: dirY * config.projectile.speed, velocityZ: dirZ * config.projectile.speed, impactScale } },
          ...spriteAnimationComponents,
        );
        if (atlasActive) ctx.spriteAtlasLoop?.track(entity);
        if (chargedFire) ctx.world.set(ctx.root, ChargeShot, { release: 0 });
        ctx.onSpawn();
      }
      for (const entity of ctx.projectileEntities()) {
        const transform = ctx.world.get(entity, Transform);
        const projectile = ctx.world.get(entity, Projectile);
        if (!transform.ok || !projectile.ok) continue;
        const age = projectile.value.age + dt;
        if (age > config.projectile.life) {
          ctx.spriteAtlasLoop?.untrack(entity);
          commands.despawn(entity);
          ctx.onDespawn();
          continue;
        }
        ctx.world.set(entity, Transform, {
          pos: [
            (transform.value.pos[0] ?? 0) + projectile.value.velocityX * dt,
            (transform.value.pos[1] ?? 0) + projectile.value.velocityY * dt,
            (transform.value.pos[2] ?? 0) + projectile.value.velocityZ * dt,
          ],
        });
        ctx.world.set(entity, Projectile, { age });
      }
      ctx.world.set(ctx.root, PlayerMotion, { shootCooldown: shootCd });
    },
  }).unwrap();
}
