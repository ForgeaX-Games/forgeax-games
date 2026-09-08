import { ChildOf, Transform } from '@forgeax/engine-scene';
import { describe, expect, it } from 'vitest';
import { type EntityHandle, World } from '@forgeax/engine-ecs';
import { PlayerMotion, SwingState, WeaponSlot, RangeIndicator } from '../ecs/components.ts';
import { installSwingAnimationSystem } from '../systems/swing-anim-system.ts';

function transform() {
  return {
    pos: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    quat: [0, 0, 0, 1] as [number, number, number, number],
  };
}

function yaw(world: World, entity: EntityHandle): number {
  const rotation = world.get(entity, Transform).unwrap().quat;
  return 2 * Math.atan2(rotation[1] ?? 0, rotation[3] ?? 1);
}

describe('Brotato v2 swing animation', () => {
  it('keeps spear and axe attack angles fixed throughout the swing', () => {
    const world = new World();
    const leases = [Transform, ChildOf, PlayerMotion, WeaponSlot, SwingState, RangeIndicator]
      .map((component) => world.components.register(component).unwrap());
    const player = world.spawn(
      { component: Transform, data: transform() },
      { component: PlayerMotion, data: { inputX: 0, inputZ: 0, velocityX: 0, velocityZ: 0, facing: 0.2 } },
    ).unwrap();
    const weapons = [0, 1].map((profileIndex) => world.spawn(
      { component: Transform, data: transform() },
      { component: WeaponSlot, data: { slotIndex: profileIndex, profileIndex, cooldown: 2, slotAngle: 0, swingPhase: 0, aimYaw: 0 } },
      { component: SwingState, data: { active: 1, hitApplied: 1, attackYaw: 0.9 } },
      { component: ChildOf, data: { parent: player } },
    ).unwrap());
    installSwingAnimationSystem(world);

    expect(world.update(0.01).ok).toBe(true);
    const initial = weapons.map((weapon) => yaw(world, weapon));
    expect(world.update(0.2).ok).toBe(true);
    const during = weapons.map((weapon) => yaw(world, weapon));

    expect(during[0]).toBeCloseTo(initial[0], 6);
    expect(during[1]).toBeCloseTo(initial[1], 6);
    for (const lease of leases.reverse()) lease.dispose();
  });
});
