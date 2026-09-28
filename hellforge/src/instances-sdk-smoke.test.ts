import { expect, test } from 'bun:test';
import { World } from '@forgeax/engine/ecs';
import { Instances } from '@forgeax/engine/render';

function instanceTransforms(offset: number): Float32Array {
  const transforms = new Float32Array(32);
  for (const base of [0, 16]) {
    transforms[base] = 1;
    transforms[base + 5] = 1;
    transforms[base + 10] = 1;
    transforms[base + 15] = 1;
  }
  transforms[16 + 12] = offset;
  return transforms;
}

test('Engine 0.1.38 stores, updates, and cleans Instances transforms', () => {
  const world = new World();
  const initial = instanceTransforms(1.25);
  const entity = world
    .spawn({ component: Instances, data: { transforms: initial } })
    .unwrap();

  const stored = world.get(entity, Instances).unwrap();
  expect(stored.transforms).not.toBe(initial);
  expect(Array.from(stored.transforms)).toEqual(Array.from(initial));

  const updated = instanceTransforms(4.5);
  world.set(entity, Instances, { transforms: updated }).unwrap();
  const afterUpdate = world.get(entity, Instances).unwrap();
  expect(afterUpdate.transforms).not.toBe(updated);
  expect(afterUpdate.transforms.length).toBe(32);
  expect(afterUpdate.transforms[16 + 12]).toBe(4.5);

  world.removeComponent(entity, Instances).unwrap();
  expect(world.hasComponent(entity, Instances)).toBe(false);
  world.despawn(entity).unwrap();
  expect(world.inspect().entityCount).toBe(0);
});
