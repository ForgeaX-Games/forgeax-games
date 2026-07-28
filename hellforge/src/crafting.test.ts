import { describe, expect, test } from 'bun:test';
import {
  canFuse,
  canReroll,
  canSalvage,
  buildFuseResult,
  buildRerollResult,
  rarityStepUp,
  rerollCost,
  salvageYield,
  SALVAGE_YIELD,
  type MaterialTier,
} from './crafting';
import type { Item, ItemInstance } from './items';

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

describe('PR10 T2 crafting SSOT — yield/cost table (L5)', () => {
  test('SALVAGE_YIELD: common→2, magic→3, rare→4', () => {
    expect(SALVAGE_YIELD.common).toBe(2);
    expect(SALVAGE_YIELD.magic).toBe(3);
    expect(SALVAGE_YIELD.rare).toBe(4);
  });

  test('salvageYield returns matching-tier shards; rerollCost equals that yield', () => {
    const tiers: MaterialTier[] = ['common', 'magic', 'rare'];
    for (const tier of tiers) {
      const it = item({ rarity: tier });
      const yield_ = salvageYield(it);
      const cost = rerollCost(it);
      expect(yield_).not.toBeNull();
      expect(cost).not.toBeNull();
      expect(yield_![tier]).toBe(SALVAGE_YIELD[tier]);
      expect(cost).toEqual(yield_);
      // other tiers zero
      for (const t of tiers) {
        if (t !== tier) expect(yield_![t]).toBe(0);
      }
    }
  });

  test('rarityStepUp: common→magic→rare; rare is ceiling (null)', () => {
    expect(rarityStepUp('common')).toBe('magic');
    expect(rarityStepUp('magic')).toBe('rare');
    expect(rarityStepUp('rare')).toBeNull();
  });
});

describe('PR10 T2 crafting SSOT — validators', () => {
  test('legendary → canSalvage/canReroll/canFuse all false', () => {
    const legend = item({
      rarity: 'legendary',
      legendary: 'slag-staff',
      name: '熔渣之杖',
    });
    expect(canSalvage(legend)).toBe(false);
    expect(canReroll(legend)).toBe(false);
    expect(canFuse([legend, legend, legend])).toBe(false);
    expect(salvageYield(legend)).toBeNull();
    expect(rerollCost(legend)).toBeNull();
    expect(buildRerollResult(legend)).toBeNull();
    expect(buildFuseResult([legend, legend, legend])).toBeNull();
  });

  test('fuse rejects mixed slot, mixed rarity, rare ceiling, wrong count', () => {
    const a = item({ slot: 'weapon', rarity: 'common', ilvl: 2 });
    const b = item({ slot: 'helm', rarity: 'common', ilvl: 2 });
    const c = item({ slot: 'weapon', rarity: 'magic', ilvl: 2 });
    const rare = item({ slot: 'weapon', rarity: 'rare', ilvl: 3 });

    expect(canFuse([a, b, item({ slot: 'weapon', rarity: 'common' })])).toBe(false); // mixed slot
    expect(canFuse([a, c, item({ slot: 'weapon', rarity: 'common' })])).toBe(false); // mixed rarity
    expect(canFuse([rare, rare, rare])).toBe(false); // rare ceiling
    expect(canFuse([a, a])).toBe(false); // wrong count
    expect(canFuse([a, a, a, a])).toBe(false);

    // happy: 3 same-slot same-rarity below rare
    expect(canFuse([a, a, a])).toBe(true);
    expect(canFuse([
      item({ slot: 'gloves', rarity: 'magic', ilvl: 1 }),
      item({ slot: 'gloves', rarity: 'magic', ilvl: 4 }),
      item({ slot: 'gloves', rarity: 'magic', ilvl: 2 }),
    ])).toBe(true);
  });

  test('non-legendary craftables: canSalvage + canReroll true', () => {
    for (const rarity of ['common', 'magic', 'rare'] as const) {
      const it = item({ rarity });
      expect(canSalvage(it)).toBe(true);
      expect(canReroll(it)).toBe(true);
    }
  });
});

describe('PR10 T2 crafting SSOT — result builders', () => {
  test('re-roll preserves slot/rarity/ilvl, mints new affixes + instanceId', () => {
    const src = item({
      instanceId: 'src-fixed',
      slot: 'belt',
      rarity: 'magic',
      ilvl: 5,
      name: '旧腰带',
      affixes: [{ stat: 'maxHp', v: 10, label: '+10 生命上限' }],
      score: 10,
    });
    const out = buildRerollResult(src);
    expect(out).not.toBeNull();
    expect(out!.slot).toBe('belt');
    expect(out!.rarity).toBe('magic');
    expect(out!.ilvl).toBe(5);
    expect(out!.instanceId).not.toBe(src.instanceId);
    expect(out!.instanceId.length).toBeGreaterThan(8);
    // fresh roll — not a clone of the source affix list / name
    expect(out!.name).not.toBe(src.name);
    // second call also mints a distinct instanceId
    const out2 = buildRerollResult(src);
    expect(out2!.instanceId).not.toBe(out!.instanceId);
  });

  test('fuse → step rarity, max(ilvl), same slot, fresh instanceId', () => {
    const inputs: Item[] = [
      item({ slot: 'ring', rarity: 'common', ilvl: 2, instanceId: 'a' }),
      item({ slot: 'ring', rarity: 'common', ilvl: 7, instanceId: 'b' }),
      item({ slot: 'ring', rarity: 'common', ilvl: 4, instanceId: 'c' }),
    ];
    const out = buildFuseResult(inputs);
    expect(out).not.toBeNull();
    expect(out!.slot).toBe('ring');
    expect(out!.rarity).toBe('magic');
    expect(out!.ilvl).toBe(7);
    expect(out!.instanceId).not.toBe('a');
    expect(out!.instanceId).not.toBe('b');
    expect(out!.instanceId).not.toBe('c');

    const magicTrio = [
      item({ slot: 'offhand', rarity: 'magic', ilvl: 3 }),
      item({ slot: 'offhand', rarity: 'magic', ilvl: 1 }),
      item({ slot: 'offhand', rarity: 'magic', ilvl: 5 }),
    ];
    const up = buildFuseResult(magicTrio);
    expect(up!.rarity).toBe('rare');
    expect(up!.ilvl).toBe(5);
    expect(up!.slot).toBe('offhand');
  });
});
