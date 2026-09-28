import { describe, expect, test } from 'bun:test';
import {
  WEAPONS,
  createArsenal,
  selectWeapon,
  reload,
  tickWeapon,
  follow,
  spreadDegrees,
} from '../src/fps/weapons';

describe('FPS arsenal timing and transitions', () => {
  test('automatic rates stay consistent at 30, 60 and 144 Hz', () => {
    for (const index of WEAPONS.flatMap((w, i) =>
      w.mode === 'auto' ? [i] : [],
    )) {
      const counts = [30, 60, 144].map((hz) => {
        const s = createArsenal();
        s.selected = index;
        s.ammo[index] = 1000;
        let count = 0;
        for (let frame = 0; frame < hz * 2; frame++)
          if (tickWeapon(s, frame / hz, 1 / hz, true, frame === 0)) count++;
        return count;
      });
      const expected = WEAPONS[index].rpm / 30;
      for (const count of counts)
        expect(Math.abs(count - expected)).toBeLessThanOrEqual(1);
    }
  });
  test('holding semi automatic only fires on the input edge', () => {
    const s = createArsenal();
    s.selected = 4;
    expect(tickWeapon(s, 0, 1 / 60, true, true)).toBe(true);
    for (let i = 1; i < 120; i++)
      expect(tickWeapon(s, i / 60, 1 / 60, true, false)).toBe(false);
    expect(s.ammo[4]).toBe(WEAPONS[4].magazine - 1);
  });
  test('one burst produces exactly three shots after trigger release', () => {
    const s = createArsenal();
    s.selected = 6;
    for (let i = 0; i < 60; i++)
      tickWeapon(s, i / 60, 1 / 60, i === 0, i === 0);
    expect(s.ammo[6]).toBe(27);
  });
  test('switch cancels reload and preserves each magazine', () => {
    const s = createArsenal();
    s.ammo[0] = 3;
    expect(reload(s, 0)).toBe(true);
    expect(selectWeapon(s, 4, 0.3)).toBe(true);
    expect(s.reloadEnd).toBe(0);
    selectWeapon(s, 0, 4);
    tickWeapon(s, 5, 0.016, false, false);
    expect(s.ammo[0]).toBe(3);
    expect(reload(s, 5)).toBe(true);
    tickWeapon(s, 6.8, 0.016, true, true);
    expect(s.ammo[0]).toBe(3);
    tickWeapon(s, 7, 0.016, false, false);
    expect(s.ammo[0]).toBe(30);
  });
  test('switch delay blocks shots; empty weapon begins reload; stalls never batch shots', () => {
    const s = createArsenal();
    selectWeapon(s, 1, 0);
    expect(tickWeapon(s, 0.2, 0.016, true, true)).toBe(false);
    expect(tickWeapon(s, 0.3, 0.016, true, true)).toBe(true);
    const before = s.ammo[1];
    tickWeapon(s, 10, 0.05, true, false);
    expect(s.ammo[1]).toBe(before - 1);
    s.ammo[1] = 0;
    expect(tickWeapon(s, 11, 0.016, true, false)).toBe(false);
    expect(s.reloadEnd).toBeGreaterThan(11);
  });
  test('all weapons accessible, ADS tighter, exponential recovery independent of Hz', () => {
    const s = createArsenal();
    selectWeapon(s, -1, 0);
    expect(s.selected).toBe(11);
    selectWeapon(s, 12, 1);
    expect(s.selected).toBe(0);
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(12);
    for (const w of WEAPONS)
      expect(spreadDegrees(w, 1, 0, 0)).toBeLessThan(spreadDegrees(w, 0, 0, 0));
    const result = [30, 60, 144].map((hz) => {
      let x = 0;
      for (let i = 0; i < hz; i++) x = follow(x, 1, 4, 1 / hz);
      return x;
    });
    expect(result[0]).toBeCloseTo(result[2], 10);
  });
  test('shell reload commits one round at a time and can be interrupted without a free full tube', () => {
    const s = createArsenal();
    s.selected = 10;
    s.ammo[10] = 0;
    reload(s, 0);
    tickWeapon(s, 1.19, 0.016, false, false);
    expect(s.ammo[10]).toBe(0);
    tickWeapon(s, 1.21, 0.016, false, false);
    expect(s.ammo[10]).toBe(1);
    tickWeapon(s, 1.5, 0.016, true, true);
    expect(s.reloadEnd).toBe(0);
    expect(s.ammo[10]).toBe(1);
    expect(tickWeapon(s, 1.6, 0.016, true, true)).toBe(false);
    expect(tickWeapon(s, 1.7, 0.016, true, true)).toBe(true);
    expect(s.ammo[10]).toBe(0);
  });
  test('switching out of a shell reload keeps only inserted rounds; an uninterrupted tube finishes', () => {
    const s = createArsenal();
    s.selected = 11;
    s.ammo[11] = 3;
    reload(s, 0);
    tickWeapon(s, 1.8, 0.016, false, false);
    expect(s.ammo[11]).toBe(5);
    selectWeapon(s, 0, 2);
    selectWeapon(s, 11, 3);
    tickWeapon(s, 6, 0.016, false, false);
    expect(s.ammo[11]).toBe(5);
    reload(s, 6);
    tickWeapon(s, 9, 0.016, false, false);
    expect(s.ammo[11]).toBe(8);
    expect(s.reloadEnd).toBe(0);
  });
});
