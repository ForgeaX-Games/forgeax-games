import { describe, expect, test } from 'bun:test';
import type { DeepReadonly } from './deep-readonly';
import { deepClone, deepFreeze } from './deep-readonly';
import type { ActiveSkillId } from './content-ids';

describe('DeepReadonly', () => {
  test('mapped type preserves four-slot hotbar tuple', () => {
    type Hotbar = readonly [
      ActiveSkillId | null,
      ActiveSkillId | null,
      ActiveSkillId | null,
      ActiveSkillId | null,
    ];
    type Frozen = DeepReadonly<{ hotbar: Hotbar }>;
    const snap: Frozen = {
      hotbar: ['frost', null, null, null],
    };
    // Tuple length and indexed access must remain exact (not a plain array).
    const slot0: ActiveSkillId | null = snap.hotbar[0];
    const slot3: ActiveSkillId | null = snap.hotbar[3];
    expect(slot0).toBe('frost');
    expect(slot3).toBeNull();
    expect(snap.hotbar.length).toBe(4);
  });

  test('deepFreeze blocks nested mutation', () => {
    const obj = deepFreeze(deepClone({
      affixes: [{ stat: 'frostDmg', v: 0.1, label: '+10%' }],
      quests: { 'purge-slagdeep-hollow': { status: 'available' as const } },
    }));
    expect(() => {
      (obj.affixes[0] as { v: number }).v = 99;
    }).toThrow();
    expect(() => {
      (obj.quests['purge-slagdeep-hollow'] as { status: string }).status = 'completed';
    }).toThrow();
    expect(obj.affixes[0]!.v).toBe(0.1);
    expect(obj.quests['purge-slagdeep-hollow'].status).toBe('available');
  });
});
