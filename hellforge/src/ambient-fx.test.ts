import { describe, expect, test } from 'bun:test';
import { Instances, Materials } from '@forgeax/engine/render';
import { AmbientFx } from './ambient-fx';

// The repository-wide engine mock predates Materials.unlit. Keep this test
// focused on the ECS Instances contract without changing the shared mock.
const materialSurface = Materials as unknown as {
  unlit?: (...args: unknown[]) => unknown;
};
materialSurface.unlit ??= () => ({});

interface ComponentInput {
  readonly component: unknown;
  readonly data: unknown;
}

interface SpawnRecord {
  readonly entity: number;
  readonly components: readonly ComponentInput[];
}

interface InstanceWrite {
  readonly entity: number;
  readonly transforms: Float32Array;
}

class StubWorld {
  private nextEntity = 1;
  readonly spawns: SpawnRecord[] = [];
  readonly writes: InstanceWrite[] = [];
  readonly despawns: number[] = [];

  spawn(...components: ComponentInput[]) {
    const entity = this.nextEntity++;
    this.spawns.push({ entity, components });
    return { ok: true as const, value: entity };
  }

  set(
    entity: number,
    _component: unknown,
    data: { readonly transforms: Float32Array },
  ) {
    this.writes.push({ entity, transforms: data.transforms });
    return { ok: true as const, value: undefined, unwrap: () => undefined };
  }

  despawn(entity: number): void {
    this.despawns.push(entity);
  }

  allocSharedRef(_kind: string, payload: unknown): unknown {
    return payload;
  }

  internSharedRef(_kind: string, payload: unknown): unknown {
    return payload;
  }
}

function instancePayloads(world: StubWorld): Float32Array[] {
  return world.spawns.map((spawn) => {
    const input = spawn.components.find((entry) => entry.component === Instances);
    if (!input) throw new Error('ambient layer is missing Instances');
    return (input.data as { transforms: Float32Array }).transforms;
  });
}

describe('AmbientFx ECS instances', () => {
  test('keeps layer counts and transforms in World-owned Instances', () => {
    const world = new StubWorld();
    const fx = new AmbientFx(world as never);

    expect(instancePayloads(world).map((transforms) => transforms.length)).toEqual([16, 16, 16]);

    fx.setArea('den');
    world.writes.length = 0;
    fx.configure(1, 'snow');

    expect(fx.count()).toBe(280);
    expect(world.writes.map((write) => write.transforms.length / 16)).toEqual([77, 33, 170]);
    for (const write of world.writes) {
      expect([...write.transforms].every(Number.isFinite)).toBe(true);
    }

    world.writes.length = 0;
    fx.tick(0.25, 10, -4);
    expect(world.writes.map((write) => write.transforms.length / 16)).toEqual([77, 33, 170]);
  });

  test('despawns every layer exactly once', () => {
    const world = new StubWorld();
    const fx = new AmbientFx(world as never);
    const entities = world.spawns.map((spawn) => spawn.entity);

    fx.dispose();
    fx.dispose();

    expect(world.despawns).toEqual(entities);
    expect(fx.count()).toBe(0);
  });
});
