import { describe, expect, it } from 'vitest';
import { World } from '@forgeax/engine-ecs';
import { MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { Rotatable } from '../assets/plugins/rotating-target';
import { recordTargetProfileHit, resetTargetProfile, toggleTargetProfile, type TargetProfileLoop } from '../assets/plugins/target-profile-loop';

function state(world: World, originalRotationSpeed: number | null): TargetProfileLoop {
  const entity = world.spawn(
    { component: Transform, data: {} },
    { component: MeshRenderer, data: { materials: [] } },
  ).unwrap();
  if (originalRotationSpeed !== null) world.addComponent(entity, { component: Rotatable, data: { speed: originalRotationSpeed } }).unwrap();
  return {
    entity,
    originalMaterials: [],
    profileMaterials: [],
    profile: {
      kind: 'game-default-target-profile',
      version: 1,
      title: 'Precision target',
      scoreMultiplier: 2,
      rotationSpeed: 0.18,
      baseColor: [0.12, 0.68, 1, 1],
    },
    originalRotationSpeed,
    active: 'original',
    precisionHits: 0,
    swaps: 0,
  };
}

describe('game-default target profile motion', () => {
  it('adds and removes profile-driven rotation when the target had no motion', () => {
    const world = new World();
    const target = state(world, null);

    toggleTargetProfile(world, target);
    expect(world.get(target.entity, Rotatable).unwrap().speed).toBeCloseTo(0.18);

    toggleTargetProfile(world, target);
    expect(world.get(target.entity, Rotatable).ok).toBe(false);
  });

  it('restores an authored rotation speed through the same reset owner', () => {
    const world = new World();
    const target = state(world, 0.3);

    toggleTargetProfile(world, target);
    expect(world.get(target.entity, Rotatable).unwrap().speed).toBeCloseTo(0.18);
    resetTargetProfile(world, target);
    expect(world.get(target.entity, Rotatable).unwrap().speed).toBeCloseTo(0.3);
    expect(target.active).toBe('original');
  });

  it('counts only a real hit on the active profile target and clears it on reset', () => {
    const world = new World();
    const target = state(world, null);

    toggleTargetProfile(world, target);
    expect(recordTargetProfileHit(target, target.entity)).toBe(true);
    expect(target.precisionHits).toBe(1);
    resetTargetProfile(world, target);
    expect(target.precisionHits).toBe(0);
    expect(recordTargetProfileHit(target, target.entity)).toBe(false);
  });
});
