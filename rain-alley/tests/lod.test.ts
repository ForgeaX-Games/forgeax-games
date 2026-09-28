import { expect, test } from 'bun:test';
import { useFarEnemyLod } from '../src/fps/lod-policy';
test('enemy LOD does not flicker during rapid motion around the far threshold', () => {
  let far = false;
  const levels = [17, 21, 23, 21, 22, 19, 18, 21, 23].map(d => far = useFarEnemyLod(far, d));
  expect(levels).toEqual([false, false, true, true, true, true, false, false, true]);
});
test('a teleport into close combat immediately restores full detail', () => {
  expect(useFarEnemyLod(true, 1)).toBe(false);
  expect(useFarEnemyLod(false, 90)).toBe(true);
  expect(useFarEnemyLod(true, NaN)).toBe(false);
});
