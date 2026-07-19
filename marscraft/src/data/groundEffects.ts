/**
 * MarsCraft -> forgeax-engine — ground-effect type table (Milestone M9 chunk 3)
 * =============================================================================
 * Port of the Three.js source `web/data/groundEffects.ts`. Each entry defines a
 * persistent ground AoE zone (flame trail, corrosive bile, ...):
 *   - `effects`: the AbilityEffect list applied (per `tickInterval`) to every
 *     enemy inside the zone (same-type+player overlap is deduped to one tick).
 *   - visual config (color / opacity / pulse) used by the renderer.
 *
 * Comments translated to English/ASCII; structure + numbers verbatim.
 */

import type { AbilityEffect } from './abilities';

export interface GroundEffectTypeDef {
  id: string;
  displayName: string;
  /** Effects applied each tick to enemies in range. */
  effects: AbilityEffect[];
  /** Tick interval (seconds). */
  tickInterval: number;
  /** Whether allies are affected (default false). */
  affectsFriendly: boolean;

  // ── visual config ──
  /** Primary tint (packed 0xRRGGBB). */
  color: number;
  /** Base opacity. */
  opacity: number;
  /** Pulse amplitude (opacity wobble; 0 = no pulse). */
  pulseAmplitude: number;
  /** Pulse frequency (Hz). */
  pulseFrequency: number;
}

export const GROUND_EFFECT_TYPES: Record<string, GroundEffectTypeDef> = {
  flame_trail: {
    id: 'flame_trail',
    displayName: 'Flame Trail',
    effects: [
      { type: 'damage', amount: 6, damageType: 'spell' },
      {
        type: 'apply_debuff',
        debuffId: 'raider_scorch',
        duration: 4,
        modifiers: [],
        stackMode: 'refresh',
      },
    ],
    tickInterval: 0.5,
    affectsFriendly: false,
    color: 0xff4400,
    opacity: 0.9,
    pulseAmplitude: 0.1,
    pulseFrequency: 2.0,
  },

  corrosive_bile: {
    id: 'corrosive_bile',
    displayName: 'Corrosive Bile',
    effects: [
      { type: 'damage', amount: 12, damageType: 'spell' },
      {
        type: 'apply_debuff',
        debuffId: 'corrosive_bile_slow',
        duration: 1,
        modifiers: [{ stat: 'moveSpeed', mode: 'multiply', value: -0.3 }],
        stackMode: 'refresh',
      },
    ],
    tickInterval: 0.5,
    affectsFriendly: false,
    color: 0x44cc00,
    opacity: 0.75,
    pulseAmplitude: 0.08,
    pulseFrequency: 1.5,
  },
};

/** Lookup by id (undefined for unknown). */
export function getGroundEffectDef(id: string): GroundEffectTypeDef | undefined {
  return GROUND_EFFECT_TYPES[id];
}
