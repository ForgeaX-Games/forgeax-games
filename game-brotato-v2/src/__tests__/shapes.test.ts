import { describe, expect, it } from 'vitest';
import { AXE_PROFILE } from '../../assets/lib/weapons/axe.ts';
import { SPEAR_PROFILE } from '../../assets/lib/weapons/spear.ts';
import { hitsShape, hitsSweep, hitsThrust } from '../combat/shapes.ts';

describe('M2 attack shapes', () => {
  it('keeps spear reach narrow and bounded', () => {
    expect(hitsThrust(0, 0, 0, 1, SPEAR_PROFILE, 0, 4, 0.1)).toBe(true);
    expect(hitsThrust(0, 0, 0, 1, SPEAR_PROFILE, 0, 4.5, 0.1)).toBe(false);
    expect(hitsThrust(0, 0, 0, 1, SPEAR_PROFILE, 0.6, 2, 0.1)).toBe(false);
  });

  it('uses the axe fan and shortest angle across the ±pi boundary', () => {
    expect(hitsSweep(0, 0, 0, 1, AXE_PROFILE, 0, 2, 0.1)).toBe(true);
    expect(hitsSweep(0, 0, 0, 1, AXE_PROFILE, 0, -2, 0.1)).toBe(false);
    expect(hitsSweep(0, 0, 0, 1, AXE_PROFILE, Math.sin(Math.PI * 65 / 180) * 2, Math.cos(Math.PI * 65 / 180) * 2, 0.1)).toBe(true);
    expect(hitsShape(0, 0, Math.sin(Math.PI - 0.1), Math.cos(Math.PI - 0.1), AXE_PROFILE, Math.sin(-Math.PI + 0.1) * 2, Math.cos(-Math.PI + 0.1) * 2, 0.1)).toBe(true);
  });
});
