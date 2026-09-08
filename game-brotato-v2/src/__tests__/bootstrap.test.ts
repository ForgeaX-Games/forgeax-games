import { createWorldContext, World } from '@forgeax/engine-ecs';
import { Camera, renderComponentsPlugin } from '@forgeax/engine-render';
import { scenePlugin, Transform } from '@forgeax/engine-scene';
import { describe, expect, it } from 'vitest';
import { bootstrapPlugin } from '../main.ts';

describe('Brotato v2 M0 bootstrap', () => {
  it('creates exactly one disposable fixed-angle camera', async () => {
    const world = new World();
    const context = await createWorldContext(world, [
      scenePlugin(),
      renderComponentsPlugin(),
      bootstrapPlugin,
    ]);
    const query = world.query({ read: [Camera], with: [Transform] }).unwrap();
    const cameras = [...query].map((row) => row.entity);
    expect(cameras).toHaveLength(1);
    expect(world.inspect().entityCount).toBe(1);
    await context.fiber.dispose();
    expect(world.get(cameras[0]!, Camera).ok).toBe(false);
  });
});
