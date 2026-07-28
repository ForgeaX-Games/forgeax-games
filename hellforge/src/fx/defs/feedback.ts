// Death dissolve — PR8 T7 feedback layer. Skinned GLB materials can't be
// eroded per-entity, so the "dissolve" is a sprite envelope around the dying
// monster layered ON TOP of the legacy gibs (physical chunks stay): a flipbook
// pop at the moment of death, then slow smoke wisps + hot embers escaping the
// body while the death clip plays.
//
// Tint per emitter (FxSystem.spriteTint from the emitter color):
//  • flash/embers stay in the fire/blood death language; wisps take 'blood'
//    so the premult smoke reads as dark body-mist, not campfire gray.
//  • Monster-family tinting (imp → fire, charred → shadow, …) is future work —
//    the EffectDef data model has one static color per emitter; per-kind
//    variants would need call-site recolors the executor doesn't support yet.

import type { EffectDef } from '../effect-def';

export const deathDissolveDef: EffectDef = {
  emitters: [
    // One flipbook pop at the moment of death (16-frame impact sheet @24fps).
    {
      id: 'dissolve-flash', kind: 'sprite', color: 'blood', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 1.4,
      },
    },
    // Slow rising smoke envelope — 4-frame smoke variants cycling.
    {
      id: 'dissolve-wisps', kind: 'sprite', color: 'blood', count: 10, speed: 1.2,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.7, endSize: 1.3, fadeOutFrac: 0.4,
      },
    },
    // Hot motes escaping the body.
    {
      id: 'dissolve-embers', kind: 'sprite', color: 'fire', count: 14, speed: 2.4,
      sprite: {
        sheet: 'glow', blend: 'additive', billboard: 'spherical',
        size: 0.3, fadeOutFrac: 0.25,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // 3 emitters · 1+10+14 = 25 particles
  budget: { maxEmitters: 3, maxParticles: 28, maxTrails: 0 },
};

/** Slaglord variant — counts ×1.6 (10→16, 14→22), flash size 1.4→2.2. */
export const bossDeathDissolveDef: EffectDef = {
  emitters: [
    {
      id: 'dissolve-flash', kind: 'sprite', color: 'blood', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 2.2,
      },
    },
    {
      id: 'dissolve-wisps', kind: 'sprite', color: 'blood', count: 16, speed: 1.2,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.7, endSize: 1.3, fadeOutFrac: 0.4,
      },
    },
    {
      id: 'dissolve-embers', kind: 'sprite', color: 'fire', count: 22, speed: 2.4,
      sprite: {
        sheet: 'glow', blend: 'additive', billboard: 'spherical',
        size: 0.3, fadeOutFrac: 0.25,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // 3 emitters · 1+16+22 = 39 particles
  budget: { maxEmitters: 3, maxParticles: 40, maxTrails: 0 },
};

// ── Element hit reactions (PR8 T7) ──────────────────────────────────────────
// On-monster reactions to a hit — played alongside (not instead of) the
// projectile impact burst. Single-emitter defs; call sites slice the whole
// beat. Side-by-side readability is the acceptance bar (§5.4): fire = hot
// spark streaks, frost = crystalline shards, arc = lightning polylines.

export const hitFireDef: EffectDef = {
  emitters: [
    {
      id: 'sparks', kind: 'sprite', color: 'fire', count: 8, speed: 3.5,
      sprite: {
        sheet: 'spark', blend: 'additive', billboard: 'spherical',
        size: 0.28, fadeOutFrac: 0.3,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  budget: { maxEmitters: 1, maxParticles: 8, maxTrails: 0 },
};

export const hitFrostDef: EffectDef = {
  emitters: [
    {
      id: 'shards', kind: 'sprite', color: 'ice', count: 8, speed: 2.8,
      sprite: {
        sheet: 'shard', fps: 8, loop: false,
        blend: 'additive', billboard: 'spherical',
        size: 0.28, fadeOutFrac: 0.3,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  budget: { maxEmitters: 1, maxParticles: 8, maxTrails: 0 },
};

export const hitArcDef: EffectDef = {
  emitters: [
    {
      id: 'arcs', kind: 'sprite', color: 'lightning', count: 7, speed: 3.0,
      sprite: {
        sheet: 'bolt', fps: 12, loop: false,
        blend: 'additive', billboard: 'spherical',
        size: 0.42, fadeOutFrac: 0.25,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  budget: { maxEmitters: 1, maxParticles: 7, maxTrails: 0 },
};
