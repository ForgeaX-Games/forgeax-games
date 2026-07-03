// Per-ability bespoke cast VFX — the data-driven dispatch that replaces the
// generic color-keyed cast_flash for abilities that have a distinctive effect in
// the Three.js source `web/effects/AbilityVFX.ts`.
//
// The VfxSystem's `ability:used` handler looks each cast ability up here: an
// entry spawns its `kind` (a VfxKind) at either the caster or the cast target
// point, in addition to (or instead of) the generic cast glow. Abilities NOT in
// this table fall back to the generic cast_flash tinted by AbilityDef.visualColor.
//
// This is the SSOT for the AbilityVFX long-tail port: adding a bespoke ability
// visual = add its VfxKind builder to vfx-system.ts + one row here. The stateful
// multi-frame per-entity effects from the source (flame-dash trail, cloak fade,
// lurker burrow, blink in/out, shield/prismatic charges) need their own per-entity
// update systems and are tracked as a remaining seam — this table covers the
// one-shot AOE/burst abilities that map cleanly onto the transient-particle model.

import type { VfxKind } from '../systems/vfx-system';

export interface AbilityVfxSpec {
  /** The VfxKind to spawn for this ability's cast. */
  kind: VfxKind;
  /** Fire at the cast target point (true) or at the caster (false, default). */
  atTarget?: boolean;
  /** Effect size (world units — e.g. blast radius). Passed as VfxOpts.size. */
  size?: number;
  /** RGB 0..1 override; else the kind's own default palette. */
  color?: [number, number, number];
  /** If false, SUPPRESS the generic cast_flash (this bespoke effect replaces it). */
  keepCastFlash?: boolean;
}

const RANGE = 1.84; // grid→world (matches the ability data's cell scale)

/**
 * Bespoke ability VFX table, keyed by abilityId.
 *
 * EMP (Ghost): a point-targeted electromagnetic burst that lands at the cast
 * point (radius 2.5 cells) — port of AbilityVFX `_createEMPExplosion`. Fires the
 * `emp` kind AT THE TARGET (not the caster — the ghost lobs it), so the generic
 * caster cast_flash is kept (the throw) and the EMP burst reads at the landing.
 */
const ABILITY_VFX: Record<string, AbilityVfxSpec> = {
  emp: { kind: 'emp', atTarget: true, size: 2.5 * RANGE, keepCastFlash: true },
};

export function getAbilityVfx(abilityId: string): AbilityVfxSpec | undefined {
  return ABILITY_VFX[abilityId];
}
