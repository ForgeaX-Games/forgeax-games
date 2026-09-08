import { FixedTime, FixedUpdate, type CommandBuffer, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { WEAPON_PROFILES } from '../../assets/lib/weapons/index.ts';
import { COMBAT, type CombatPhase } from '../config/combat.ts';
import { SPAWN } from '../config/spawn.ts';
import { applyDamage } from '../combat/damage.ts';
import { resolveCircleOverlaps, type CollisionCircle } from '../combat/collision.ts';
import { assignTargets } from '../combat/targeting.ts';
import { isCooldownReady, tickCooldown } from '../combat/timing.ts';
import { Dying, Enemy, EnemyBrain, Health, HitFlash, Player, PlayerMotion, SpawnMarker, SwingState, WeaponSlot } from '../ecs/components.ts';
import { DEFAULT_SPAWN_SEED, DIRECTOR_STATE_KEY, resetDirector, type DirectorState } from '../spawn/director.ts';
import type { CombatAssets } from '../runtime/combat-assets.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';
import { STRESS } from '../config/stress.ts';
import { STRESS_STATE_KEY } from '../stress/state.ts';
import type { StressState } from './stress-system.ts';
import { DAMAGE_TEXT_EVENTS_KEY, type DamageTextEvents } from './damage-text-system.ts';
import { TARGET_LINES_STATE_KEY, type TargetLineState } from '../debug/target-lines.ts';

interface WeaponEntry {
  readonly entity: EntityHandle;
  readonly slotIndex: number;
  readonly profileIndex: number;
  readonly cooldown: number;
  readonly slotAngle: number;
  readonly aimYaw: number;
}

export const COMBAT_STATE_KEY = 'BrotatoV2CombatState';
export const COMBAT_SYSTEM_NAME = 'brotato-v2/combat';

export interface CombatState {
  phase: CombatPhase;
  elapsed: number;
  kills: readonly [number, number];
  resetRequested: boolean;
  resetSeed?: number;
}

export function createCombatState(): CombatState {
  return { phase: 'playing', elapsed: 0, kills: [0, 0], resetRequested: false, resetSeed: undefined };
}

function slotProfile(slot: { readonly profileIndex: number }) {
  return slot.profileIndex === 0 ? WEAPON_PROFILES.spear : WEAPON_PROFILES.axe;
}

function weaponPosition(playerX: number, playerZ: number, facing: number, slotAngle: number): readonly [number, number] {
  return [
    playerX + Math.sin(facing + slotAngle) * COMBAT.weapons.ringRadius,
    playerZ + Math.cos(facing + slotAngle) * COMBAT.weapons.ringRadius,
  ];
}

function setPlayerFlash(
  world: World,
  player: EntityHandle,
  assets: CombatAssets,
  flash: boolean,
  originals: Map<EntityHandle, readonly number[]>,
): void {
  for (const child of world.iterDescendants(player)) {
    const renderer = world.get(child, MeshRenderer);
    if (!renderer.ok) continue;
    if (!originals.has(child)) originals.set(child, [...renderer.value.materials]);
    const original = originals.get(child) ?? [];
    world.set(child, MeshRenderer, {
      materials: flash ? original.map(() => assets.hitFlashMaterial) : original,
    });
  }
}

function clearDeployment(world: World, commands: CommandBuffer, state: CombatState, seed: number): void {
  const enemies = world.query({ read: [Transform], with: [Enemy] });
  if (enemies.ok) for (const row of enemies.value) commands.despawn(row.entity);
  const markers = world.query({ read: [Transform], with: [SpawnMarker] });
  if (markers.ok) for (const row of markers.value) commands.despawn(row.entity);
  const director = world.getResource<DirectorState>(DIRECTOR_STATE_KEY);
  resetDirector(director, seed);
  state.phase = 'playing';
  state.elapsed = 0;
  state.kills = [0, 0];
  state.resetRequested = false;
}

function resetRun(
  world: World,
  commands: CommandBuffer,
  playerRow: { mut: (component: typeof Transform | typeof Health | typeof PlayerMotion) => any },
  weapons: Iterable<WeaponEntry>,
  state: CombatState,
): void {
  clearDeployment(world, commands, state, state.resetSeed ?? DEFAULT_SPAWN_SEED);
  const transform = playerRow.mut(Transform);
  const health = playerRow.mut(Health);
  const motion = playerRow.mut(PlayerMotion);
  transform.pos[0] = 0;
  transform.pos[1] = 0;
  transform.pos[2] = 0;
  motion.inputX = 0;
  motion.inputZ = 0;
  motion.velocityX = 0;
  motion.velocityZ = 0;
  health.current = COMBAT.player.maxHealth;
  health.max = COMBAT.player.maxHealth;
  health.invulnerability = 0;
  state.resetSeed = undefined;
  for (const weapon of weapons) {
    world.set(weapon.entity, WeaponSlot, { cooldown: 0, swingPhase: 0 }).unwrap();
    world.set(weapon.entity, SwingState, { active: 0, hitApplied: 0, attackYaw: weapon.aimYaw }).unwrap();
  }
}

export function installCombatSystem(world: World, player: EntityHandle, assets: CombatAssets): () => void {
  const state = world.hasResource(COMBAT_STATE_KEY)
    ? world.getResource<CombatState>(COMBAT_STATE_KEY)
    : createCombatState();
  world.insertResource(COMBAT_STATE_KEY, state);
  if (!world.hasResource(TARGET_LINES_STATE_KEY)) world.insertResource<TargetLineState>(TARGET_LINES_STATE_KEY, { lines: [] });
  if (!world.hasResource(DAMAGE_TEXT_EVENTS_KEY)) world.insertResource<DamageTextEvents>(DAMAGE_TEXT_EVENTS_KEY, { pending: [] });
  const playerOriginalMaterials = new Map<EntityHandle, readonly number[]>();
  let playerFlashTimer = 0;
  let playerIsFlashing = false;
  const setPlayerFlashIfNeeded = (flash: boolean): void => {
    if (flash === playerIsFlashing) return;
    playerIsFlashing = flash;
    setPlayerFlash(world, player, assets, flash, playerOriginalMaterials);
  };

  world
    .addSystem(FixedUpdate, {
      name: COMBAT_SYSTEM_NAME,
      after: ['brotato-v2/player-movement'],
      queries: [
        { write: [Transform, Health, PlayerMotion], with: [Player] },
        { write: [Transform, Health, Enemy, EnemyBrain, HitFlash, MeshRenderer], without: [Dying] },
        { write: [Transform, WeaponSlot, SwingState] },
      ],
      fn: (world, [players, enemies, weapons], commands) => {
        const clock = world.hasResource(DEBUG_CLOCK_KEY)
          ? world.getResource<DebugClockState>(DEBUG_CLOCK_KEY)
          : undefined;
        if (clock !== undefined && !clock.fixedActive) return;
        const dt = Math.max(0, world.getResource(FixedTime).delta);
        const playerRow = [...players][0];
        if (playerRow === undefined) return;
        const state = world.getResource<CombatState>(COMBAT_STATE_KEY);
        const stress = world.hasResource(STRESS_STATE_KEY)
          ? world.getResource<StressState>(STRESS_STATE_KEY)
          : undefined;
        const godMode = stress?.active === true;
        const targetLines = world.getResource<TargetLineState>(TARGET_LINES_STATE_KEY);
        targetLines.lines.length = 0;
        const damageEvents = world.getResource<DamageTextEvents>(DAMAGE_TEXT_EVENTS_KEY);
        let damageTextCount = 0;
        const queueDamageText = (event: { amount: number; x: number; z: number }): void => {
          if (godMode && damageTextCount >= STRESS.damageTextBudget) return;
          damageEvents.pending.push(event);
          damageTextCount += 1;
        };
        const playerTransform = playerRow.mut(Transform);
        const playerHealth = playerRow.mut(Health);
        const playerMotion = playerRow.mut(PlayerMotion);
        playerHealth.invulnerability = Math.max(0, playerHealth.invulnerability - dt);
        playerFlashTimer = Math.max(0, playerFlashTimer - dt);

        const weaponRows: WeaponEntry[] = [];
        for (const row of weapons) {
          const slot = row.mut(WeaponSlot);
          slot.cooldown = tickCooldown(slot.cooldown, dt);
          weaponRows.push({
            entity: row.entity,
            slotIndex: slot.slotIndex,
            profileIndex: slot.profileIndex,
            cooldown: slot.cooldown,
            slotAngle: slot.slotAngle,
            aimYaw: slot.aimYaw,
          });
        }
        weaponRows.sort((left, right) => left.slotIndex - right.slotIndex);
        if (state.resetRequested) {
          resetRun(world, commands, playerRow, weaponRows, state);
          setPlayerFlashIfNeeded(false);
          targetLines.lines.length = 0;
          damageEvents.pending.length = 0;
          return;
        }

        if (state.phase === 'defeated') {
          playerMotion.inputX = 0;
          playerMotion.inputZ = 0;
          playerMotion.velocityX = 0;
          playerMotion.velocityZ = 0;
          for (const row of weaponRows) {
            world.set(row.entity, WeaponSlot, { cooldown: row.cooldown }).unwrap();
            world.set(row.entity, SwingState, { active: 0 }).unwrap();
          }
          setPlayerFlashIfNeeded(playerFlashTimer > 0);
          return;
        }

        const playerX = playerTransform.pos[0] ?? 0;
        const playerZ = playerTransform.pos[2] ?? 0;
        const facing = playerMotion.facing;
        const enemyIds: number[] = [];
        const enemyXs: number[] = [];
        const enemyZs: number[] = [];
        const enemyHealth: number[] = [];
        const activeEnemyBodies: CollisionCircle[] = [];
        const playerCollisionRadius = COMBAT.player.collisionRadius;
        const enemyCollisionRadius = COMBAT.enemy.collisionRadius;
        const playerEnemyDistance = playerCollisionRadius + enemyCollisionRadius;

        const moveStartedAt = godMode ? performance.now() : 0;
        for (const row of enemies) {
          const enemy = row.mut(Enemy);
          if (enemy.active <= 0) continue;
          const transform = row.mut(Transform);
          const brain = row.mut(EnemyBrain);
          const flash = row.mut(HitFlash);
          const wasFlashing = flash.ttl > 0;
          flash.ttl = Math.max(0, flash.ttl - dt);
          if (wasFlashing && flash.ttl <= 0) {
            world.set(row.entity, MeshRenderer, {
              materials: [assets.potatoBodyMaterial, assets.potatoSproutMaterial, assets.tomatoEyeMaterial],
            });
          }
          brain.attackCooldown = tickCooldown(brain.attackCooldown, dt);
          brain.birthClock = Math.min(SPAWN.birth.popSec, brain.birthClock + dt);
          if (brain.birthClock < SPAWN.birth.popSec) continue;
          const enemyX = transform.pos[0] ?? 0;
          const enemyZ = transform.pos[2] ?? 0;
          const dx = playerX - enemyX;
          const dz = playerZ - enemyZ;
          const distance = Math.hypot(dx, dz);
          if (distance > Number.EPSILON) {
            const travel = Math.min(
              Math.max(0, distance - playerEnemyDistance),
              brain.speed * dt,
            );
            const step = travel / distance;
            transform.pos[0] = enemyX + dx * step;
            transform.pos[2] = enemyZ + dz * step;
            const yaw = Math.atan2(dx, dz);
            transform.quat[1] = Math.sin(yaw / 2);
            transform.quat[3] = Math.cos(yaw / 2);
          }
          activeEnemyBodies.push({
            x: transform.pos[0] ?? 0,
            z: transform.pos[2] ?? 0,
            radius: enemyCollisionRadius,
          });
        }
        if (stress?.active === true) stress.phaseMs.move = performance.now() - moveStartedAt;

        const collideStartedAt = godMode ? performance.now() : 0;
        resolveCircleOverlaps(
          activeEnemyBodies,
          { x: playerX, z: playerZ, radius: playerCollisionRadius },
          COMBAT.enemy.collisionIterations,
        );
        if (stress?.active === true) stress.phaseMs.collide = performance.now() - collideStartedAt;

        const combatStartedAt = godMode ? performance.now() : 0;
        let activeEnemyIndex = 0;
        for (const row of enemies) {
          const enemy = row.mut(Enemy);
          if (enemy.active <= 0) continue;
          const brain = row.mut(EnemyBrain);
          if (brain.birthClock < SPAWN.birth.popSec) continue;
          const body = activeEnemyBodies[activeEnemyIndex];
          activeEnemyIndex += 1;
          if (body === undefined) continue;
          const transform = row.mut(Transform);
          const health = row.mut(Health);
          transform.pos[0] = body.x;
          transform.pos[2] = body.z;
          const movedX = body.x;
          const movedZ = body.z;
          const movedDistance = Math.hypot(playerX - movedX, playerZ - movedZ);
          if (movedDistance <= playerEnemyDistance && brain.attackCooldown <= 0 && playerHealth.invulnerability <= 0 && !godMode) {
            const result = applyDamage(playerHealth.current, COMBAT.enemy.contactDamage);
            playerHealth.current = result.current;
            playerHealth.invulnerability = COMBAT.player.invulnerabilitySeconds;
            playerFlashTimer = 0.22;
            brain.attackCooldown = COMBAT.enemy.attackCooldown;
            if (result.applied > 0) queueDamageText({ amount: result.applied, x: playerX, z: playerZ });
          }
          enemyIds.push(row.entity);
          enemyXs.push(movedX);
          enemyZs.push(movedZ);
          enemyHealth.push(health.current);
        }

        if (playerHealth.current <= 0) {
          state.phase = 'defeated';
          setPlayerFlashIfNeeded(true);
          return;
        }
        setPlayerFlashIfNeeded(playerFlashTimer > 0 && Math.floor(playerFlashTimer * 18) % 2 === 0);

        const assignments = assignTargets({
          enemyIds,
          enemyXs,
          enemyZs,
          enemyHealth,
          enemyRadius: COMBAT.enemy.collisionRadius,
          playerX,
          playerZ,
          playerFacing: facing,
          slots: weaponRows.map((row) => ({
            profile: slotProfile(row),
            slotAngle: row.slotAngle,
            ready: isCooldownReady(row.cooldown),
          })),
          ringRadius: COMBAT.weapons.ringRadius,
        });
        for (const assignment of assignments) {
          const row = weaponRows[assignment.slotIndex];
          if (row === undefined) continue;
          const liveSlot = world.get(row.entity, WeaponSlot);
          if (!liveSlot.ok || !isCooldownReady(liveSlot.value.cooldown)) continue;
          const profile = slotProfile(row);
          world.set(row.entity, WeaponSlot, { aimYaw: assignment.aimYaw });
          if (assignment.hits.length === 0) {
            world.set(row.entity, WeaponSlot, { swingPhase: 0 });
            world.set(row.entity, SwingState, { active: 0 });
            continue;
          }
          world.set(row.entity, WeaponSlot, { cooldown: profile.cooldown, swingPhase: 0 });
          world.set(row.entity, SwingState, { active: 1, hitApplied: 1, attackYaw: assignment.aimYaw });
          const [weaponX, weaponZ] = weaponPosition(playerX, playerZ, facing, row.slotAngle);
          const targetId = assignment.hits[0];
          const targetIndex = targetId === undefined ? -1 : enemyIds.indexOf(targetId);
          if (targetId !== undefined && targetIndex >= 0) {
            targetLines.lines.push({
              slotIndex: assignment.slotIndex,
              weaponX,
              weaponZ,
              targetId,
              targetX: enemyXs[targetIndex] ?? weaponX,
              targetZ: enemyZs[targetIndex] ?? weaponZ,
            });
          }
          for (const hitId of assignment.hits) {
            const hitIndex = enemyIds.indexOf(hitId);
            if (hitIndex < 0) continue;
            for (const enemyRow of enemies) {
              if (enemyRow.entity !== hitId) continue;
              const health = enemyRow.mut(Health);
              const result = applyDamage(health.current, profile.damage);
              health.current = result.current;
              if (result.applied <= 0) break;
              const flash = enemyRow.mut(HitFlash);
              flash.ttl = result.killed ? SPAWN.death.ttlSec : 0.16;
              world.set(enemyRow.entity, MeshRenderer, {
                materials: [assets.hitFlashMaterial, assets.hitFlashMaterial, assets.hitFlashMaterial],
              });
              queueDamageText({ amount: result.applied, x: enemyXs[hitIndex] ?? 0, z: enemyZs[hitIndex] ?? 0 });
              if (result.killed) {
                // M4: 材料掉落挂这里，不要挂在 despawn。
                commands.addComponent(enemyRow.entity, {
                  component: Dying,
                  data: { ttl: SPAWN.death.ttlSec, total: SPAWN.death.ttlSec },
                });
                const kills = [...state.kills] as [number, number];
                kills[assignment.slotIndex] = (kills[assignment.slotIndex] ?? 0) + 1;
                state.kills = kills;
              }
              break;
            }
          }
        }
        if (stress?.active === true) stress.phaseMs.combat = performance.now() - combatStartedAt;
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(FixedUpdate, COMBAT_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
    world.removeResource(COMBAT_STATE_KEY);
  };
}
