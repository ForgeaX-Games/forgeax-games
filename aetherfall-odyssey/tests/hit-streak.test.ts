import { describe, expect, it, vi } from 'vitest';
import { World } from '@forgeax/engine-ecs';
import type { HudHandle } from '../assets/plugins/hud';
import { createHitStreak, HitStreak } from '../assets/plugins/hit-streak';

describe('game-default hit streak', () => {
  it('awards a growing multiplier and resets through the player component', () => {
    const world = new World();
    const player = world.spawn().unwrap();
    const setComboStatus = vi.fn();
    const hud = { setComboStatus } as unknown as HudHandle;
    const streak = createHitStreak(world, player, hud);

    expect(streak).toBeDefined();
    expect(world.get(player, HitStreak).unwrap()).toMatchObject({ hits: 0, elapsed: 0, multiplier: 1 });
    expect(streak!.recordHit(10)).toEqual({ points: 10, hits: 1, multiplier: 1 });
    expect(streak!.recordHit(10)).toEqual({ points: 13, hits: 2, multiplier: 1.25 });
    expect(streak!.snapshot()).toMatchObject({ hits: 2, elapsed: 1.65, multiplier: 1.25, state: 'active' });
    expect(setComboStatus).toHaveBeenLastCalledWith('Combo x1.25 · 2 hits · 1.6s', 'active');

    streak!.reset();

    expect(streak!.snapshot()).toEqual({ hits: 0, elapsed: 0, multiplier: 1, state: 'ready' });
    expect(setComboStatus).toHaveBeenLastCalledWith('Combo ready · chain hits for a bonus', 'ready');
  });
});
