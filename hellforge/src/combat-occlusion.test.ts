import { expect, test } from 'bun:test';
import { firstCombatBlock } from './combat-occlusion';

test('sweeps intermediate walls even when both endpoints are open', () => {
  const hit = firstCombatBlock(0, 0, 10, 0, x => x < 4 || x > 4.3);
  expect(hit).not.toBeNull();
  expect(hit![0]).toBeGreaterThanOrEqual(4);
  expect(hit![0]).toBeLessThan(4.15);
  expect(firstCombatBlock(10, 0, 0, 0, x => x < 4 || x > 4.3)).not.toBeNull();
});

test('clear and zero-length segments remain valid', () => {
  expect(firstCombatBlock(0, 0, 12, 8, () => true)).toBeNull();
  expect(firstCombatBlock(0, 0, 0, 0, () => true)).toBeNull();
  expect(firstCombatBlock(0, 0, 0, 0, () => false)).toEqual([0, 0]);
});
