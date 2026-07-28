import { describe, expect, test } from 'bun:test';
import { emptyEquipment, type Equipment, type ItemInstance, type ItemSlot } from './items';
import { wornSlotForCompare } from './inventory-ui';

function stubItem(slot: ItemSlot, id: string, score: number): ItemInstance {
  return {
    instanceId: id,
    slot,
    rarity: 'common',
    name: id,
    ilvl: 1,
    reqLevel: 1,
    affixes: [],
    score,
  };
}

describe('PR10 T5 inventory wornSlotForCompare', () => {
  test('single-slot items resolve to that EquipSlot', () => {
    const eq = emptyEquipment();
    expect(wornSlotForCompare(eq, 'weapon')).toBe('weapon');
    eq.weapon = stubItem('weapon', 'w', 10);
    expect(wornSlotForCompare(eq, 'weapon')).toBe('weapon');
  });

  test('rings: prefer empty slot (emptier) over occupied', () => {
    const eq: Equipment = emptyEquipment();
    eq.ring1 = stubItem('ring', 'r1', 50);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring2');
    eq.ring1 = null;
    eq.ring2 = stubItem('ring', 'r2', 50);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring1');
  });

  test('rings: both filled → weaker score', () => {
    const eq: Equipment = emptyEquipment();
    eq.ring1 = stubItem('ring', 'strong', 90);
    eq.ring2 = stubItem('ring', 'weak', 20);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring2');
    eq.ring1 = stubItem('ring', 'weak2', 5);
    eq.ring2 = stubItem('ring', 'strong2', 80);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring1');
  });
});
