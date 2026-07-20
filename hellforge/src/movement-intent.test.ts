import { describe, expect, test } from 'bun:test';
import type { InteractionRef } from './content-ids';
import {
  createInteractionRegistry,
  INTERACTION_KIND_PRIORITY,
  pickInteractionAt,
  reduceIntent,
  tickTargetIntent,
  wasdVectorFromKeys,
  type InteractionCandidate,
  type MovementIntent,
} from './movement-intent';

describe('reduceIntent', () => {
  test('WASD vector replaces point intent', () => {
    let intent: MovementIntent = { kind: 'point', world: [3, 4] };
    intent = reduceIntent(intent, { op: 'set-vector', x: 1, z: 0 });
    expect(intent).toEqual({ kind: 'vector', x: 1, z: 0 });
  });

  test('WASD vector replaces target intent', () => {
    let intent: MovementIntent = { kind: 'target', target: { kind: 'monster', id: 'm-1' } };
    intent = reduceIntent(intent, { op: 'set-vector', x: 0, z: -1 });
    expect(intent).toEqual({ kind: 'vector', x: 0, z: -1 });
  });

  test('opening a major panel clears intent', () => {
    let intent: MovementIntent = { kind: 'point', world: [1, 2] };
    intent = reduceIntent(intent, { op: 'clear' });
    expect(intent).toEqual({ kind: 'none' });
  });

  test('release-vector clears only vector intent', () => {
    expect(reduceIntent({ kind: 'vector', x: 1, z: 0 }, { op: 'release-vector' }))
      .toEqual({ kind: 'none' });
    expect(reduceIntent({ kind: 'point', world: [0, 1] }, { op: 'release-vector' }))
      .toEqual({ kind: 'point', world: [0, 1] });
  });
});

describe('wasdVectorFromKeys', () => {
  test('W maps to -Z unit vector', () => {
    expect(wasdVectorFromKeys({ KeyW: true })).toEqual({ x: 0, z: -1 });
  });

  test('D maps to +X', () => {
    expect(wasdVectorFromKeys({ KeyD: true })).toEqual({ x: 1, z: 0 });
  });

  test('no keys → null', () => {
    expect(wasdVectorFromKeys({})).toBeNull();
  });
});

describe('tickTargetIntent', () => {
  test('target interaction fires once at range then clears', () => {
    let fired = 0;
    const registry = createInteractionRegistry({
      getMonster: (id) => id === 'm-1' ? { x: 2, z: 0, radius: 0.5 } : null,
      getNpc: () => null,
      getLoot: () => null,
      getExit: () => null,
      listCandidates: () => [],
      onMonsterInRange: () => { fired++; return 'ok'; },
      onNpcInteract: () => 'ok',
      onLootInteract: () => 'ok',
      onExitInteract: () => 'ok',
      frostCastRange: 3,
    });
    let intent: MovementIntent = { kind: 'target', target: { kind: 'monster', id: 'm-1' } };
    const far = tickTargetIntent(intent, [10, 0], registry);
    expect(far.fired).toBe(false);
    expect(far.intent.kind).toBe('target');

    const near = tickTargetIntent(intent, [0.5, 0], registry);
    expect(near.fired).toBe(true);
    expect(near.result).toBe('ok');
    expect(near.intent).toEqual({ kind: 'none' });
    expect(fired).toBe(1);
  });

  test('stale target despawn clears intent', () => {
    const registry = createInteractionRegistry({
      getMonster: () => null,
      getNpc: () => null,
      getLoot: () => null,
      getExit: () => null,
      listCandidates: () => [],
      onMonsterInRange: () => 'ok',
      onNpcInteract: () => 'ok',
      onLootInteract: () => 'ok',
      onExitInteract: () => 'ok',
    });
    const out = tickTargetIntent(
      { kind: 'target', target: { kind: 'monster', id: 'gone' } },
      [0, 0],
      registry,
    );
    expect(out.intent).toEqual({ kind: 'none' });
    expect(out.fired).toBe(false);
  });

  test('ECS handle reuse cannot redirect an old interaction (stable string id)', () => {
    // Registry keys by InteractionRef.id string — not EntityHandle.
    // Spawning a new monster that reuses an ECS handle must not satisfy old id.
    const live = new Map<string, { x: number; z: number; radius: number }>();
    live.set('m-old', { x: 1, z: 0, radius: 0.4 });
    const registry = createInteractionRegistry({
      getMonster: (id) => live.get(id) ?? null,
      getNpc: () => null,
      getLoot: () => null,
      getExit: () => null,
      listCandidates: () => [],
      onMonsterInRange: (id) => (id === 'm-old' ? 'ok' : 'failed'),
      onNpcInteract: () => 'ok',
      onLootInteract: () => 'ok',
      onExitInteract: () => 'ok',
      frostCastRange: 5,
    });
    const ref: InteractionRef = { kind: 'monster', id: 'm-old' };
    expect(registry.resolve(ref)?.valid).toBe(true);

    // Despawn old; "reuse" handle by spawning m-new at same coords — old ref stays invalid.
    live.delete('m-old');
    live.set('m-new', { x: 1, z: 0, radius: 0.4 });
    expect(registry.resolve(ref)).toBeNull();
    const out = tickTargetIntent({ kind: 'target', target: ref }, [0, 0], registry);
    expect(out.intent).toEqual({ kind: 'none' });
  });

  test('failed cast keeps target for retry', () => {
    const registry = createInteractionRegistry({
      getMonster: () => ({ x: 1, z: 0, radius: 0.5 }),
      getNpc: () => null,
      getLoot: () => null,
      getExit: () => null,
      listCandidates: () => [],
      onMonsterInRange: () => 'failed',
      onNpcInteract: () => 'ok',
      onLootInteract: () => 'ok',
      onExitInteract: () => 'ok',
      frostCastRange: 5,
    });
    const intent: MovementIntent = { kind: 'target', target: { kind: 'monster', id: 'm-1' } };
    const out = tickTargetIntent(intent, [0, 0], registry);
    expect(out.fired).toBe(true);
    expect(out.result).toBe('failed');
    expect(out.intent.kind).toBe('target');
  });
});

describe('pickInteractionAt priority', () => {
  test('monster/NPC/loot/exit hit priority is deterministic on equal distance', () => {
    const origin = [0, 0] as const;
    const candidates: InteractionCandidate[] = [
      { ref: { kind: 'exit', id: 'cinderwatch-to-reach' }, position: [1, 0], pickRadius: 2 },
      { ref: { kind: 'loot', id: 'l-1' }, position: [1, 0], pickRadius: 2 },
      { ref: { kind: 'npc', id: 'npc-cinderwarden-veyra' }, position: [1, 0], pickRadius: 2 },
      { ref: { kind: 'monster', id: 'm-1' }, position: [1, 0], pickRadius: 2 },
    ];
    expect(pickInteractionAt(origin, 3, candidates)).toEqual({ kind: 'monster', id: 'm-1' });
    expect(INTERACTION_KIND_PRIORITY.monster).toBeLessThan(INTERACTION_KIND_PRIORITY.npc);
    expect(INTERACTION_KIND_PRIORITY.npc).toBeLessThan(INTERACTION_KIND_PRIORITY.loot);
    expect(INTERACTION_KIND_PRIORITY.loot).toBeLessThan(INTERACTION_KIND_PRIORITY.exit);
  });

  test('closer lower-priority beats farther higher-priority', () => {
    const candidates: InteractionCandidate[] = [
      { ref: { kind: 'monster', id: 'far' }, position: [3, 0], pickRadius: 5 },
      { ref: { kind: 'loot', id: 'near' }, position: [1, 0], pickRadius: 5 },
    ];
    expect(pickInteractionAt([0, 0], 5, candidates)).toEqual({ kind: 'loot', id: 'near' });
  });
});
