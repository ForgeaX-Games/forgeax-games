import { describe, expect, test } from 'bun:test';
import { Instances } from '@forgeax/engine/render';
import { Name } from '@forgeax/engine/scene';
import batches from '../assets/scenes/slagdeep.instances.json';
import { installBakedInstances } from './baked-instances';

interface NamedRow {
  readonly entity: number;
}

interface ComponentWrite {
  readonly entity: number;
  readonly component: unknown;
  readonly data: { readonly transforms: Float32Array };
}

class StubWorld {
  readonly names: Map<number, string>;
  readonly adds: ComponentWrite[] = [];
  readonly removes: number[] = [];

  constructor(names: readonly string[]) {
    this.names = new Map(names.map((name, index) => [index + 1, name]));
  }

  query() {
    const rows: NamedRow[] = [...this.names.keys()].map((entity) => ({ entity }));
    return { ok: true as const, value: rows, unwrap: () => rows };
  }

  get(entity: number, _component: unknown) {
    return {
      ok: true as const,
      value: { value: this.names.get(entity) },
      unwrap: () => ({ value: this.names.get(entity) }),
    };
  }

  addComponent(
    entity: number,
    input: { readonly component: unknown; readonly data: { readonly transforms: Float32Array } },
  ) {
    this.adds.push({ entity, component: input.component, data: input.data });
    return { ok: true as const, value: undefined, unwrap: () => undefined };
  }

  hasComponent(entity: number, component: unknown): boolean {
    return component === Instances && this.adds.some((write) => write.entity === entity) &&
      !this.removes.includes(entity);
  }

  removeComponent(entity: number, _component: unknown) {
    this.removes.push(entity);
    return { ok: true as const, value: undefined, unwrap: () => undefined };
  }
}

describe('baked dungeon ECS instances', () => {
  test('binds authored matrices and removes the component on cleanup', () => {
    const world = new StubWorld(Object.keys(batches));
    const cleanup = installBakedInstances(world as never);

    expect(world.adds).toHaveLength(Object.keys(batches).length);
    expect(world.adds.every((write) => write.component === Instances)).toBe(true);
    expect(world.adds.every((write) => write.data.transforms.length > 0 && write.data.transforms.length % 16 === 0)).toBe(true);

    cleanup();
    cleanup();
    expect(world.removes).toHaveLength(world.adds.length);
  });

  test('rolls back partial bindings when a batch name is missing', () => {
    const world = new StubWorld(Object.keys(batches).slice(0, -1));

    expect(() => installBakedInstances(world as never)).toThrow(/Missing dungeon instance batches/);
    expect(world.removes).toHaveLength(world.adds.length);
  });
});
