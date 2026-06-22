/**
 * Power-up System — 道具掉落系统
 *
 * 击杀敌人后有概率掉落道具:
 * - 🛡️ Shield (蓝) — 吸收一次伤害
 * - 🔫 Triple (金) — 三连发 8 秒
 * - 💣 Bomb (红) — 清屏大爆炸
 * - 💚 Heal (绿) — 回复 1 HP
 *
 * // 给辛苦的飞行员一点点小礼物~ ♪
 */
import { Transform, MeshFilter, MeshRenderer } from '@forgeax/engine-runtime';
import { defineComponent, type EntityHandleHandle } from '@forgeax/engine-ecs';
import type { World } from '@forgeax/engine-ecs';
import type { Geo, Mat } from './setup';

export type PowerUpType = 'shield' | 'triple' | 'bomb' | 'heal';

export const PowerUp = defineComponent('PowerUp', {
  type: 'u8',  // 0=shield 1=triple 2=bomb 3=heal
  bobPhase: 'f32',
  speed: 'f32',
});

export const Obstacle = defineComponent('Obstacle', {
  speed: 'f32',
  hp: 'u8', // takes 2 hits to destroy
});

const TYPE_MAP: PowerUpType[] = ['shield', 'triple', 'bomb', 'heal'];
const DROP_CHANCE = 0.18; // 18% chance per kill

export function shouldDropPowerUp(): boolean {
  return Math.random() < DROP_CHANCE;
}

export function spawnPowerUp(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, list: EntityHandle[],
): EntityHandle {
  const typeIdx = Math.floor(Math.random() * 4);
  const mats = [mat.puShield, mat.puTriple, mat.puBomb, mat.puHeal];
  const e = world.spawn(
    { component: Transform, data: { posX: x, posY: 0.3, posZ: z, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 } },
    { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
    { component: MeshRenderer, data: { materials: [mats[typeIdx]!] } },
    { component: PowerUp, data: { type: typeIdx, bobPhase: Math.random() * 6.28, speed: 2.5 } },
  ).unwrap();
  list.push(e);
  return e;
}

export function getPowerUpType(typeIdx: number): PowerUpType {
  return TYPE_MAP[typeIdx] || 'shield';
}

export function spawnObstacle(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, list: EntityHandle[],
): { entity: EntityHandle; parts: EntityHandle[] } {
  // Floating asteroid/barrier — must be dodged or shot (2 hits)
  const s = 0.6 + Math.random() * 0.5;
  const entity = world.spawn(
    { component: Transform, data: { posX: x, posY: 0, posZ: z, scaleX: s, scaleY: s * 0.6, scaleZ: s } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.obstacle] } },
    { component: Obstacle, data: { speed: 3 + Math.random() * 2, hp: 2 } },
  ).unwrap();

  // Glow ring decoration
  const ring = world.spawn(
    { component: Transform, data: { posX: x, posY: 0, posZ: z, scaleX: s * 1.3, scaleY: 0.04, scaleZ: s * 1.3 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.obstacleGlow] } },
  ).unwrap();

  list.push(entity);
  return { entity, parts: [ring] };
}
