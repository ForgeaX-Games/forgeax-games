/**
 * Visual effects: explosions, trails, advanced bullet system.
 *
 * Bullet Types:
 *  0 = Normal (straight line)
 *  1 = Homing (tracks nearest enemy)
 *  2 = Spread (fan pattern, slightly slower)
 *  3 = Laser (ultra fast, narrow, piercing)
 *  4 = Plasma (slow, big, piercing + AOE)
 *
 * // 让子弹也有自己的个性~ ♪
 */
import { Transform, MeshFilter, MeshRenderer } from '@forgeax/engine-runtime';
import { defineComponent, type EntityHandle } from '@forgeax/engine-ecs';
import type { World } from '@forgeax/engine-ecs';
import type { Geo, Mat } from './setup';

export const Particle = defineComponent('Particle', {
  velX: 'f32', velY: 'f32', velZ: 'f32', life: 'f32', maxLife: 'f32',
});
export const Trail = defineComponent('Trail', { life: 'f32' });

/**
 * Bullet component — extended with type/homing/pierce
 *  bulletType: 0=normal 1=homing 2=spread 3=laser 4=plasma
 *  homing: 0 or 1 — whether this bullet tracks enemies
 *  pierce: how many enemies it can pass through (0 = destroyed on hit)
 */
export const Bullet = defineComponent('Bullet', {
  dirX: 'f32', dirZ: 'f32', speed: 'f32', isEnemy: 'u8',
  bulletType: 'u8', homing: 'u8', pierce: 'u8', life: 'f32',
});

// ── Explosions ──────────────────────────────────────────────────────────

export function spawnExplosion(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, n: number, list: EntityHandle[],
) {
  const mats = [mat.expW, mat.expO, mat.expO, mat.expR];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 6;
    const s = 0.2 + Math.random() * 0.5;
    const life = 0.3 + Math.random() * 0.7;
    const e = world.spawn(
      { component: Transform, data: { posX: x, posY: Math.random() * 0.5, posZ: z, scaleX: s, scaleY: s, scaleZ: s } },
      { component: MeshFilter, data: { assetHandle: geo.particle } },
      { component: MeshRenderer, data: { materials: [mats[Math.floor(Math.random() * mats.length)]!] } },
      { component: Particle, data: { velX: Math.cos(a) * sp, velY: 1 + Math.random() * 4, velZ: Math.sin(a) * sp, life, maxLife: life } },
    ).unwrap();
    list.push(e);
  }
}

// ── Thruster Trails ─────────────────────────────────────────────────────

export function spawnTrail(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, list: EntityHandle[],
) {
  const s = 0.07 + Math.random() * 0.05;
  const e = world.spawn(
    { component: Transform, data: { posX: x + (Math.random() - 0.5) * 0.1, posY: -0.04, posZ: z, scaleX: s, scaleY: s, scaleZ: s } },
    { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
    { component: MeshRenderer, data: { materials: [Math.random() > 0.4 ? mat.trailA : mat.trailB] } },
    { component: Trail, data: { life: 0.25 + Math.random() * 0.15 } },
  ).unwrap();
  list.push(e);
}

// ── Bullet Spawners ─────────────────────────────────────────────────────

/** Standard bullet (type 0) — straight, fast */
export function spawnBullet(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, dirZ: number, enemy: boolean, list: EntityHandle[],
  dirX: number = 0,
) {
  const speed = enemy ? 11 : 28;
  const s = enemy ? 1.3 : 0.9;
  const e = world.spawn(
    { component: Transform, data: { posX: x, posZ: z, scaleX: s, scaleY: s, scaleZ: s * 1.8 } },
    { component: MeshFilter, data: { assetHandle: geo.bullet } },
    { component: MeshRenderer, data: { materials: [enemy ? mat.bulletE : mat.bullet] } },
    { component: Bullet, data: { dirX, dirZ, speed, isEnemy: enemy ? 1 : 0, bulletType: 0, homing: 0, pierce: 0, life: 4 } },
  ).unwrap();
  list.push(e);
}

/** Homing missile (type 1) — slower but tracks nearest enemy */
export function spawnHomingMissile(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, list: EntityHandle[],
) {
  const e = world.spawn(
    { component: Transform, data: { posX: x, posZ: z, scaleX: 0.7, scaleY: 0.7, scaleZ: 1.4 } },
    { component: MeshFilter, data: { assetHandle: geo.coneSm } },
    { component: MeshRenderer, data: { materials: [mat.puShield] } }, // blue glow
    { component: Bullet, data: { dirX: 0, dirZ: -1, speed: 16, isEnemy: 0, bulletType: 1, homing: 1, pierce: 0, life: 3.5 } },
  ).unwrap();
  list.push(e);
}

/** Spread bullet (type 2) — same as normal but slightly different visual */
export function spawnSpreadBullet(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, dirX: number, dirZ: number, list: EntityHandle[],
) {
  const e = world.spawn(
    { component: Transform, data: { posX: x, posZ: z, scaleX: 0.7, scaleY: 0.7, scaleZ: 1.2 } },
    { component: MeshFilter, data: { assetHandle: geo.bullet } },
    { component: MeshRenderer, data: { materials: [mat.puTriple] } }, // gold
    { component: Bullet, data: { dirX, dirZ, speed: 22, isEnemy: 0, bulletType: 2, homing: 0, pierce: 0, life: 3 } },
  ).unwrap();
  list.push(e);
}

/** Laser shot (type 3) — ultra fast, narrow, pierces 1 enemy */
export function spawnLaserShot(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, list: EntityHandle[],
) {
  const e = world.spawn(
    { component: Transform, data: { posX: x, posZ: z, scaleX: 0.3, scaleY: 0.3, scaleZ: 2.5 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.neonCyan] } }, // cyan laser
    { component: Bullet, data: { dirX: 0, dirZ: -1, speed: 45, isEnemy: 0, bulletType: 3, homing: 0, pierce: 1, life: 2 } },
  ).unwrap();
  list.push(e);
}

/** Plasma ball (type 4) — slow, big, pierces 3, AOE on timeout */
export function spawnPlasma(
  world: World, geo: Geo, mat: Mat,
  x: number, z: number, list: EntityHandle[],
) {
  const e = world.spawn(
    { component: Transform, data: { posX: x, posZ: z, scaleX: 1.4, scaleY: 1.4, scaleZ: 1.4 } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.neonPurple] } }, // purple plasma
    { component: Bullet, data: { dirX: 0, dirZ: -1, speed: 10, isEnemy: 0, bulletType: 4, homing: 0, pierce: 3, life: 4 } },
  ).unwrap();
  list.push(e);
}
