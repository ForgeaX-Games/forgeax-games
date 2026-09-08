import { Camera } from '@forgeax/engine-render';
import { World } from '@forgeax/engine-ecs';
import { describe, expect, it } from 'vitest';
import { Dying, Enemy, Player, WeaponSlot } from '../ecs/components.ts';
import { countEnemySlots, countLiveEnemies } from '../runtime/enemy.ts';

function registeredWorld(): World {
  const world = new World();
  world.components.register(Enemy).unwrap();
  world.components.register(Dying).unwrap();
  return world;
}

describe('Brotato v2 enemy-count policy', () => {
  it('counts active, available, and total enemy slots separately', () => {
    const world = registeredWorld();
    for (let index = 0; index < 3; index += 1) world.spawn({ component: Enemy, data: { active: 1 } });
    for (let index = 0; index < 2; index += 1) world.spawn({ component: Enemy, data: { active: 0 } });
    expect(countEnemySlots(world)).toEqual({ live: 3, available: 2, capacity: 5 });
  });

  it('excludes dying entities from live and available while retaining capacity', () => {
    const world = registeredWorld();
    const active = [
      world.spawn({ component: Enemy, data: { active: 1 } }).unwrap(),
      world.spawn({ component: Enemy, data: { active: 1 } }).unwrap(),
      world.spawn({ component: Enemy, data: { active: 1 } }).unwrap(),
    ];
    const available = [
      world.spawn({ component: Enemy, data: { active: 0 } }).unwrap(),
      world.spawn({ component: Enemy, data: { active: 0 } }).unwrap(),
    ];
    world.addComponent(active[0]!, { component: Dying, data: { ttl: 0.2, total: 0.2 } }).unwrap();
    world.addComponent(available[0]!, { component: Dying, data: { ttl: 0.2, total: 0.2 } }).unwrap();
    expect(countEnemySlots(world)).toEqual({ live: 2, available: 1, capacity: 5 });
  });

  it('keeps countLiveEnemies sourced from countEnemySlots', () => {
    const world = registeredWorld();
    world.spawn({ component: Enemy, data: { active: 1 } });
    expect(countLiveEnemies(world)).toBe(countEnemySlots(world).live);
  });

  it('does not count non-enemy entities', () => {
    const world = registeredWorld();
    world.components.register(Player).unwrap();
    world.components.register(WeaponSlot).unwrap();
    world.components.register(Camera).unwrap();
    world.spawn({ component: Player, data: {} });
    world.spawn({ component: WeaponSlot, data: {} });
    world.spawn({ component: Camera, data: {} });
    expect(countEnemySlots(world)).toEqual({ live: 0, available: 0, capacity: 0 });
  });

  it('returns zero counts for an empty world', () => {
    expect(countEnemySlots(registeredWorld())).toEqual({ live: 0, available: 0, capacity: 0 });
  });
});
