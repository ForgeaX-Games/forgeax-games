import { expect, test } from 'bun:test';
import { createNavigation, damageAfterCover } from '../src/fps/enemy-ai';
import { CITY_COLLIDERS } from '../src/fps/city-collision';
import { CITY_LAYOUT } from '../src/fps/city-layout';
test('navigation goes around blocking walls and never crosses their expanded footprint', () => {
  const obstacles = [
    { center: [0, -0.1, -20], size: [40, 0.2, 40] },
    { center: [0, 1, -20], size: [1, 2, 9] },
  ];
  const path = createNavigation(obstacles).path([-3, -20], [3, -20]);
  expect(path.length).toBeGreaterThan(12);
  for (const [x, z] of path)
    expect(Math.abs(x) < 0.78 && Math.abs(z + 20) < 4.78).toBe(false);
});
test('covered player cannot take either ranged or melee damage; melee has finite reach', () => {
  expect(damageAfterCover(false, 1, false)).toBe(0);
  expect(damageAfterCover(false, 1, true)).toBe(0);
  expect(damageAfterCover(true, 3, true)).toBe(0);
  expect(damageAfterCover(true, 24, false)).toBe(0);
  expect(damageAfterCover(true, 1, true)).toBeGreaterThan(
    damageAfterCover(true, 1, false),
  );
});
test('main street patrol and shop escape paths remain connected', () => {
  const nav = createNavigation(CITY_COLLIDERS);
  expect(nav.path([-1.35, -13], [0, -3]).length).toBeGreaterThan(0);
  expect(nav.path([8, -36], [8, -28]).length).toBeGreaterThan(0);
  expect(nav.path([35, -52], [28, -52]).length).toBeGreaterThan(0);
});
test('both stair flights stay below controller step height and join one gallery', () => {
  const steps = CITY_LAYOUT.colliders.filter((p) =>
    p.name.startsWith('LC_STEP'),
  );
  expect(steps.length).toBe(40);
  for (let flight = 0; flight < 2; flight++) {
    const group = steps.filter((p) => p.name.startsWith(`LC_STEP_${flight}_`));
    for (let i = 1; i < group.length; i++)
      expect(
        Math.abs(group[i].center[1] - group[i - 1].center[1]),
      ).toBeLessThan(0.2);
  }
  expect(
    Math.max(...Object.values(CITY_LAYOUT.heightOverrides)),
  ).toBeLessThanOrEqual(12);
});
