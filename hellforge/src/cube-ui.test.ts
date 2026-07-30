import { describe, expect, test } from 'bun:test';
import { resolveForgeActions } from './cube-ui';
import type { ItemInstance } from './items';

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: overrides.instanceId ?? 'i-1',
    slot: overrides.slot ?? 'weapon',
    rarity: overrides.rarity ?? 'common',
    name: overrides.name ?? '试装',
    ilvl: overrides.ilvl ?? 2,
    reqLevel: overrides.reqLevel ?? 1,
    affixes: overrides.affixes ?? [{ stat: 'maxHp', v: 1, label: '+1' }],
    score: overrides.score ?? 1,
    legendary: overrides.legendary,
  };
}

const zero = { common: 0, magic: 0, rare: 0 };

describe('resolveForgeActions', () => {
  test('legendary locks all three with legendary reason', () => {
    const legend = item({ rarity: 'legendary', legendary: 'slag-staff' });
    const st = resolveForgeActions([legend], { common: 99, magic: 99, rare: 99 });
    expect(st.salvage).toBe(false);
    expect(st.reroll).toBe(false);
    expect(st.fuse).toBe(false);
    expect(st.lockReason).toBe('legendary');
  });

  test('one common: salvage on; reroll needs shards', () => {
    const it = item({ rarity: 'common' });
    const broke = resolveForgeActions([it], zero);
    expect(broke.salvage).toBe(true);
    expect(broke.reroll).toBe(false);
    expect(broke.lockReason).toBe('insufficient-shards');

    const rich = resolveForgeActions([it], { common: 2, magic: 0, rare: 0 });
    expect(rich.salvage).toBe(true);
    expect(rich.reroll).toBe(true);
    expect(rich.lockReason).toBeNull();
  });

  test('three same-slot commons enable fuse only', () => {
    const trio = [
      item({ slot: 'gloves', rarity: 'common', instanceId: 'a' }),
      item({ slot: 'gloves', rarity: 'common', instanceId: 'b' }),
      item({ slot: 'gloves', rarity: 'common', instanceId: 'c' }),
    ];
    const st = resolveForgeActions(trio, zero);
    expect(st.salvage).toBe(false);
    expect(st.reroll).toBe(false);
    expect(st.fuse).toBe(true);
    expect(st.lockReason).toBeNull();
  });

  test('relaxed recipe: cross-slot same-rarity trios fuse (incl. rare→legendary)', () => {
    const commons = resolveForgeActions([
      item({ slot: 'weapon', rarity: 'common', instanceId: 'a' }),
      item({ slot: 'helm', rarity: 'common', instanceId: 'b' }),
      item({ slot: 'belt', rarity: 'common', instanceId: 'c' }),
    ], zero);
    expect(commons.fuse).toBe(true);
    expect(commons.lockReason).toBeNull();

    const rares = resolveForgeActions([
      item({ slot: 'ring', rarity: 'rare', instanceId: 'r1' }),
      item({ slot: 'amulet', rarity: 'rare', instanceId: 'r2' }),
      item({ slot: 'boots', rarity: 'rare', instanceId: 'r3' }),
    ], zero);
    expect(rares.fuse).toBe(true);
    expect(rares.lockReason).toBeNull();
  });

  test('mixed rarity trio → wrong-recipe', () => {
    const st = resolveForgeActions([
      item({ slot: 'weapon', rarity: 'common', instanceId: 'a' }),
      item({ slot: 'helm', rarity: 'magic', instanceId: 'b' }),
      item({ slot: 'belt', rarity: 'common', instanceId: 'c' }),
    ], zero);
    expect(st.salvage).toBe(false);
    expect(st.fuse).toBe(false);
    expect(st.lockReason).toBe('wrong-recipe');
  });

  test('mixed placement → wrong-recipe', () => {
    const st = resolveForgeActions([
      item({ slot: 'weapon', rarity: 'common' }),
      item({ slot: 'helm', rarity: 'common' }),
    ], zero);
    expect(st.salvage).toBe(false);
    expect(st.fuse).toBe(false);
    expect(st.lockReason).toBe('wrong-recipe');
  });
});
