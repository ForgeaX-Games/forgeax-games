import { FixedTime, World } from '@forgeax/engine-ecs';
import { describe, expect, it } from 'vitest';
import { SPAWN } from '../config/spawn.ts';
import { Dying } from '../ecs/components.ts';
import { installDeathSystem } from '../systems/death-system.ts';

describe('Brotato v2 enemy death lifecycle', () => {
  it('despawns a defeated enemy after the authored 0.2 second window', () => {
    const world = new World();
    const lease = world.components.register(Dying).unwrap();
    const enemy = world.spawn({ component: Dying, data: { ttl: SPAWN.death.ttlSec, total: SPAWN.death.ttlSec } }).unwrap();
    const removeDeath = installDeathSystem(world);

    for (let tick = 0; tick < 11; tick += 1) {
      expect(world.update(1 / 60).ok).toBe(true);
    }
    expect(world.get(enemy, Dying).ok).toBe(true);
    expect(world.getResource<typeof FixedTime>(FixedTime).tick).toBe(11);

    expect(world.update(1 / 60).ok).toBe(true);
    expect(world.get(enemy, Dying).ok).toBe(true);
    expect(world.update(1 / 60).ok).toBe(true);
    expect(world.get(enemy, Dying).ok).toBe(false);

    removeDeath();
    lease.dispose();
  });
});
