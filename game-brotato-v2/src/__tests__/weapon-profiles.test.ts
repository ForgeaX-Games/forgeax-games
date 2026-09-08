import { describe, expect, it } from 'vitest';
import { COMBAT } from '../config/combat.ts';
import { WEAPON_PROFILES } from '../../assets/lib/weapons/index.ts';

describe('M2 weapon profiles', () => {
  it('keeps each action inside its cooldown and exposes compact models', () => {
    for (const profile of Object.values(WEAPON_PROFILES)) {
      expect(profile.windup + profile.strike + profile.recover).toBeLessThanOrEqual(profile.cooldown);
      expect(profile.range).toBeGreaterThan(0);
      expect(profile.arcDegrees).toBeGreaterThan(0);
      expect(profile.model.parts.length).toBeGreaterThan(0);
      expect(profile.model.parts.every((part) => part.materialSlot < profile.model.materialSlots.length)).toBe(true);
    }
    expect(WEAPON_PROFILES.spear.thrustWidth).toBeGreaterThan(0);
    expect(WEAPON_PROFILES.spear.cooldown).toBe(2);
    expect(WEAPON_PROFILES.axe.cooldown).toBe(2);
    expect(COMBAT.weapons.modelGridSize).toBe(0.5);
    expect(COMBAT.weapons.modelScale).toBe(2);
  });

  it('keeps the authored spear and axe bounds below half a grid', () => {
    const extents = Object.values(WEAPON_PROFILES).map((profile) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const part of profile.model.parts) {
        let radius = 0;
        if (part.shape.kind === 'sphere' || part.shape.kind === 'torus' || part.shape.kind === 'cone' || part.shape.kind === 'capsule') radius = part.shape.radius;
        else if (part.shape.kind === 'box') radius = Math.max(part.shape.width, part.shape.depth) / 2;
        else radius = Math.max(part.shape.radiusTop, part.shape.radiusBottom);
        minX = Math.min(minX, part.position[0] - radius);
        maxX = Math.max(maxX, part.position[0] + radius);
        minZ = Math.min(minZ, part.position[2] - radius, part.position[2] + (part.shape.kind === 'cylinder' || part.shape.kind === 'cone' ? part.shape.height / 2 : radius));
        maxZ = Math.max(maxZ, part.position[2] + radius, part.position[2] + (part.shape.kind === 'cylinder' || part.shape.kind === 'cone' ? part.shape.height / 2 : radius));
      }
      return [maxX - minX, maxZ - minZ];
    });
    for (const [width, depth] of extents) {
      expect(width).toBeLessThanOrEqual(COMBAT.weapons.modelGridSize + 0.1);
      expect(depth).toBeLessThanOrEqual(COMBAT.weapons.modelGridSize + 0.1);
    }
  });
});
