import { FixedUpdate, Time, Update, type World } from '@forgeax/engine-ecs';
import { M2_BUILD_ID } from '../config/arena.ts';
import { CAMERA_RIG_RESOURCE_KEY, type CameraRig } from '../config/camera-rig.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';
import { MOVEMENT } from '../config/movement.ts';
import { Health, Player, PlayerMotion, SpawnMarker, WeaponSlot } from '../ecs/components.ts';
import { Transform } from '@forgeax/engine-scene';
import type { DevHud, DevHudWeaponSnapshot } from './dev-hud.ts';
import { WEAPON_PROFILES } from '../../assets/lib/weapons/index.ts';
import { COMBAT_STATE_KEY, type CombatState } from '../systems/combat-system.ts';
import { DIRECTOR_STATE_KEY, secondsToNextBatch, tierAt, type DirectorState } from '../spawn/director.ts';
import { TARGET_LINES_STATE_KEY, type TargetLineState } from './target-lines.ts';
import { countLiveEnemies } from '../runtime/enemy.ts';

export const DEV_HUD_SYSTEM_NAME = 'brotato-v2/debug-hud';
export const DEBUG_HUD_SNAPSHOT_KEY = 'BrotatoV2DebugSnapshot';

export function installDevHudSystem(world: World, hud: DevHud): () => void {
  const samples: Array<{ age: number; fps: number }> = [];
  world
    .addSystem(Update, {
      name: DEV_HUD_SYSTEM_NAME,
      after: [FixedUpdate],
      queries: [
        { read: [Transform], with: [SpawnMarker] },
      ],
      fn: (world, [markers]) => {
        const delta = Math.max(0, world.getResource(Time).delta);
        const instantaneousFps = delta > 0 ? 1 / delta : 0;
        for (const sample of samples) sample.age += delta;
        samples.push({ age: 0, fps: instantaneousFps });
        while ((samples[0]?.age ?? 0) > 0.5) samples.shift();
        const fps = samples.length === 0
          ? 0
          : samples.reduce((sum, sample) => sum + sample.fps, 0) / samples.length;
        const clock = world.getResource<DebugClockState>(DEBUG_CLOCK_KEY);
        const players = world.query({ read: [Transform, PlayerMotion, Health], with: [Player] });
        const player = players.ok ? [...players.value][0] : undefined;
        const playerTransform = player?.get(Transform);
        const playerMotion = player?.get(PlayerMotion);
        const playerHealth = player?.get(Health);
        const rig = world.hasResource(CAMERA_RIG_RESOURCE_KEY)
          ? world.getResource<CameraRig>(CAMERA_RIG_RESOURCE_KEY)
          : undefined;
        const combat = world.hasResource(COMBAT_STATE_KEY)
          ? world.getResource<CombatState>(COMBAT_STATE_KEY)
          : undefined;
        const director = world.hasResource(DIRECTOR_STATE_KEY)
          ? world.getResource<DirectorState>(DIRECTOR_STATE_KEY)
          : undefined;
        const targetLines = world.hasResource(TARGET_LINES_STATE_KEY)
          ? world.getResource<TargetLineState>(TARGET_LINES_STATE_KEY)
          : undefined;
        const weaponQuery = world.query({ read: [WeaponSlot] });
        const weapons: DevHudWeaponSnapshot[] = [];
        if (weaponQuery.ok) {
          for (const row of weaponQuery.value) {
            const slot = row.get(WeaponSlot);
            const profile = slot.profileIndex === 0 ? WEAPON_PROFILES.spear : WEAPON_PROFILES.axe;
            const target = targetLines?.lines.find((line) => line.slotIndex === slot.slotIndex);
            weapons.push({
              slotIndex: slot.slotIndex,
              name: profile.displayName,
              shape: profile.shape,
              range: profile.range,
              arcDegrees: profile.arcDegrees,
              cooldown: profile.cooldown,
              cooldownRemaining: slot.cooldown,
              targetId: target?.targetId,
              kills: combat?.kills[slot.slotIndex] ?? 0,
            });
          }
          weapons.sort((left, right) => left.slotIndex - right.slotIndex);
        }
        const snapshot = {
          fps,
          frameMs: delta * 1000,
          // Keep the total live ECS count visible. SceneInstance anchors and
          // the calibration gizmo are real runtime ownership/entities and are
          // useful when checking M1 lifecycle changes.
          entities: world.inspect().entityCount,
          enemies: countLiveEnemies(world),
          phase: clock.paused ? `PAUSED · STEP ${clock.fixedTicks}` : combat?.phase === 'defeated' ? 'ARENA · DEFEATED' : 'ARENA · PLAYING',
          build: M2_BUILD_ID,
          playerPos: playerTransform === undefined
            ? undefined
            : [playerTransform.pos[0] ?? 0, playerTransform.pos[2] ?? 0] as [number, number],
          playerSpeed: playerMotion === undefined
            ? undefined
            : Math.hypot(playerMotion.velocityX, playerMotion.velocityZ) / MOVEMENT.maxSpeed,
          playerHealth: playerHealth?.current,
          playerMaxHealth: playerHealth?.max,
          weapons,
          viewExtent: rig === undefined
            ? undefined
            : [rig.visibleWidth, rig.visibleDepth] as [number, number],
          spawnLive: countLiveEnemies(world),
          spawnPending: [...markers].length,
          spawnTier: director === undefined ? undefined : tierAt(director.elapsed),
          spawnNextIn: director === undefined ? undefined : secondsToNextBatch(director),
          spawnSkipped: director?.skipped,
          spawnRelax: director === undefined
            ? undefined
            : [director.relax1, director.relax2, director.relax3, director.fallback] as [number, number, number, number],
        } as const;
        world.insertResource(DEBUG_HUD_SNAPSHOT_KEY, snapshot);
        hud.setVisible(clock.hudVisible);
        hud.update(snapshot);
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, DEV_HUD_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
  };
}
