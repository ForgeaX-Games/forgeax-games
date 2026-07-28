// EffectDef — declarative VFX data model (PR2b T1).
// Pure types + validator; no engine imports. Runtime executor is T2.

import { checkEffectBudget } from './budget';

/** Palette keys — keep in sync with FxColor in ../fx.ts (no import; fx.ts pulls engine). */
export type EffectColor =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'blood'
  | 'gold'
  | 'shadow'
  | 'heal';

export type EmitterKind = 'burst' | 'pop' | 'rise' | 'custom' | 'sprite';

/** Particle integration mode — mirrors FxSystem particle modes. */
export type EmitterMode = 'shrink' | 'rise' | 'pop';

export type BehaviorType = 'gravity' | 'drag' | 'customStep';

export type SubEmitterTrigger = 'onSpawn' | 'onDeath' | 'atAge';

export interface EffectBudget {
  readonly maxEmitters: number;
  readonly maxParticles: number;
  readonly maxTrails: number;
}

/** Sprite emitter presentation (PR8 T1) — textured billboard quads. */
export interface SpriteDef {
  /** Sheet registry id (fx/textures.ts) — validated at spawn, not here. */
  readonly sheet: string;
  readonly fps?: number;
  readonly loop?: boolean;
  readonly blend?: 'additive' | 'premult';
  readonly billboard?: 'none' | 'spherical' | 'cylindrical';
  /** UV-noise distortion strength (0 = off; sane 0.02-0.10). */
  readonly distort?: number;
  readonly size?: number;
  /** Scale lerp target over life (default = size). */
  readonly endSize?: number;
  /** Erosion fade start as a fraction of life. */
  readonly fadeOutFrac?: number;
  /**
   * Per-particle life in seconds (PR8 T3). Default: 0.9 (spriteBurst one-shot).
   * Emitters with a particle life beyond the executor's DEFAULT_LIFE.sprite
   * backstop (1.0s) must also declare EmitterDef.life so the spawn lease
   * outlives the particle.
   */
  readonly life?: number;
  /**
   * Ground-residue route (PR8 T3): flat stationary decal clamped to ground
   * height instead of a radial burst. Defaults: blend premult, life 2.5s.
   */
  readonly decal?: boolean;
  /**
   * Gravity override (radial route only) — negative falls (default −7),
   * positive floats upward (rise-style embers).
   */
  readonly gy?: number;
}

export interface EmitterDef {
  readonly id: string;
  readonly kind: EmitterKind;
  readonly color: EffectColor;
  readonly count: number;
  /** Burst radial speed (burst kind). */
  readonly speed?: number;
  /** Impact flash scale (pop kind). */
  readonly size?: number;
  /** Rise mote radial spawn radius (rise kind) — maps to FxSystem.rise spread. */
  readonly spread?: number;
  readonly life?: number;
  readonly mode?: EmitterMode;
  /** Required when kind is 'sprite' (PR8 T1); ignored by other kinds. */
  readonly sprite?: SpriteDef;
}

export interface BehaviorDef {
  readonly id: string;
  readonly type: BehaviorType;
  readonly params: Readonly<Record<string, number | string | boolean>>;
}

export interface TrailDef {
  readonly id: string;
  readonly width?: number;
  readonly life?: number;
  readonly color?: EffectColor;
}

export interface SubEmitterDef {
  readonly id: string;
  readonly parentEmitterId: string;
  readonly trigger: SubEmitterTrigger;
  readonly atAge?: number;
  readonly childEmitterId: string;
}

export interface EffectDef {
  readonly emitters: readonly EmitterDef[];
  readonly behaviors: readonly BehaviorDef[];
  readonly trails: readonly TrailDef[];
  readonly subEmitters: readonly SubEmitterDef[];
  readonly budget: EffectBudget;
  /** Escape hatch id for per-frame procedural hooks (executor T2). */
  readonly customStep?: string;
}

export type ValidateEffectDefResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: string[] };

const EFFECT_COLORS = new Set<string>([
  'fire', 'ice', 'lightning', 'blood', 'gold', 'shadow', 'heal',
]);
const EMITTER_KINDS = new Set<string>(['burst', 'pop', 'rise', 'custom', 'sprite']);
const EMITTER_MODES = new Set<string>(['shrink', 'rise', 'pop']);
const BEHAVIOR_TYPES = new Set<string>(['gravity', 'drag', 'customStep']);
const SUB_TRIGGERS = new Set<string>(['onSpawn', 'onDeath', 'atAge']);
const SPRITE_BLENDS = new Set<string>(['additive', 'premult']);
const SPRITE_BILLBOARDS = new Set<string>(['none', 'spherical', 'cylindrical']);

/** Sprite emitter numeric fields that must be >= 0 when set. */
const SPRITE_NUMERIC_FIELDS = ['fps', 'distort', 'size', 'endSize', 'fadeOutFrac', 'life'] as const;

/** Validate a SpriteDef block; `path` scopes error messages. Unknown keys tolerated. */
function validateSpriteDef(sprite: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(sprite)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(sprite.sheet)) {
    errors.push(`${path}.sheet must be a non-empty string`);
  }
  if (sprite.blend !== undefined && (!isNonEmptyString(sprite.blend) || !SPRITE_BLENDS.has(sprite.blend))) {
    errors.push(`${path}.blend must be one of additive|premult when set`);
  }
  if (sprite.billboard !== undefined && (!isNonEmptyString(sprite.billboard) || !SPRITE_BILLBOARDS.has(sprite.billboard))) {
    errors.push(`${path}.billboard must be one of none|spherical|cylindrical when set`);
  }
  if (sprite.loop !== undefined && typeof sprite.loop !== 'boolean') {
    errors.push(`${path}.loop must be a boolean when set`);
  }
  if (sprite.decal !== undefined && typeof sprite.decal !== 'boolean') {
    errors.push(`${path}.decal must be a boolean when set`);
  }
  for (const key of SPRITE_NUMERIC_FIELDS) {
    if (sprite[key] !== undefined && !isNonNegNumber(sprite[key])) {
      errors.push(`${path}.${key} must be a number >= 0 when set`);
    }
  }
  // gy may be negative (gravity) or positive (buoyancy) — any finite number.
  if (sprite.gy !== undefined && (typeof sprite.gy !== 'number' || !Number.isFinite(sprite.gy))) {
    errors.push(`${path}.gy must be a finite number when set`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonNegNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Validate an EffectDef for tests and future dev-mode asserts.
 * Accepts unknown so incomplete / malformed fixtures can be checked.
 */
export function validateEffectDef(def: unknown): ValidateEffectDefResult {
  const errors: string[] = [];

  if (!isPlainObject(def)) {
    return { ok: false, errors: ['EffectDef must be an object'] };
  }

  if (!('budget' in def) || def.budget === undefined) {
    errors.push('budget is required');
  } else if (!isPlainObject(def.budget)) {
    errors.push('budget must be an object');
  } else {
    const b = def.budget;
    for (const key of ['maxEmitters', 'maxParticles', 'maxTrails'] as const) {
      if (!(key in b) || b[key] === undefined) {
        errors.push(`budget.${key} is required`);
      } else if (!isNonNegNumber(b[key])) {
        errors.push(`budget.${key} must be a number >= 0`);
      }
    }
  }

  const emitterIds = new Set<string>();
  const emitters = def.emitters;
  let emittersStructOk = false;
  if (!Array.isArray(emitters)) {
    errors.push('emitters must be an array');
  } else {
    emittersStructOk = true;
    for (let i = 0; i < emitters.length; i++) {
      const e = emitters[i];
      const path = `emitters[${i}]`;
      if (!isPlainObject(e)) {
        errors.push(`${path} must be an object`);
        emittersStructOk = false;
        continue;
      }
      if (!isNonEmptyString(e.id)) {
        errors.push(`${path}.id must be a non-empty string`);
        emittersStructOk = false;
      } else if (emitterIds.has(e.id)) {
        errors.push(`${path}.id duplicate emitter id "${e.id}"`);
        emittersStructOk = false;
      } else {
        emitterIds.add(e.id);
      }
      if (!isNonEmptyString(e.kind) || !EMITTER_KINDS.has(e.kind)) {
        errors.push(`${path}.kind must be one of burst|pop|rise|custom|sprite`);
      }
      if (!isNonEmptyString(e.color) || !EFFECT_COLORS.has(e.color)) {
        errors.push(`${path}.color must be a known EffectColor`);
      }
      if (!isNonNegNumber(e.count)) {
        errors.push(`${path}.count must be a number >= 0`);
        emittersStructOk = false;
      }
      if (e.speed !== undefined && !isNonNegNumber(e.speed)) {
        errors.push(`${path}.speed must be a number >= 0 when set`);
      }
      if (e.size !== undefined && !isNonNegNumber(e.size)) {
        errors.push(`${path}.size must be a number >= 0 when set`);
      }
      if (e.spread !== undefined && !isNonNegNumber(e.spread)) {
        errors.push(`${path}.spread must be a number >= 0 when set`);
      }
      if (e.life !== undefined && !isNonNegNumber(e.life)) {
        errors.push(`${path}.life must be a number >= 0 when set`);
      }
      if (e.mode !== undefined && (!isNonEmptyString(e.mode) || !EMITTER_MODES.has(e.mode))) {
        errors.push(`${path}.mode must be one of shrink|rise|pop when set`);
      }
      if (e.kind === 'sprite') {
        if (e.sprite === undefined) {
          errors.push(`${path}.sprite is required when kind is sprite`);
          emittersStructOk = false;
        } else {
          validateSpriteDef(e.sprite, `${path}.sprite`, errors);
        }
      }
    }
  }

  const behaviors = def.behaviors;
  if (!Array.isArray(behaviors)) {
    errors.push('behaviors must be an array');
  } else {
    for (let i = 0; i < behaviors.length; i++) {
      const b = behaviors[i];
      const path = `behaviors[${i}]`;
      if (!isPlainObject(b)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      if (!isNonEmptyString(b.id)) {
        errors.push(`${path}.id must be a non-empty string`);
      }
      if (!isNonEmptyString(b.type) || !BEHAVIOR_TYPES.has(b.type)) {
        errors.push(`${path}.type must be one of gravity|drag|customStep`);
      }
      if (!isPlainObject(b.params)) {
        errors.push(`${path}.params must be an object`);
      }
    }
  }

  const trails = def.trails;
  let trailsStructOk = false;
  if (!Array.isArray(trails)) {
    errors.push('trails must be an array');
  } else {
    trailsStructOk = true;
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      const path = `trails[${i}]`;
      if (!isPlainObject(t)) {
        errors.push(`${path} must be an object`);
        trailsStructOk = false;
        continue;
      }
      if (!isNonEmptyString(t.id)) {
        errors.push(`${path}.id must be a non-empty string`);
        trailsStructOk = false;
      }
      if (t.width !== undefined && !isNonNegNumber(t.width)) {
        errors.push(`${path}.width must be a number >= 0 when set`);
      }
      if (t.life !== undefined && !isNonNegNumber(t.life)) {
        errors.push(`${path}.life must be a number >= 0 when set`);
      }
      if (
        t.color !== undefined
        && (!isNonEmptyString(t.color) || !EFFECT_COLORS.has(t.color))
      ) {
        errors.push(`${path}.color must be a known EffectColor when set`);
      }
    }
  }

  const subEmitters = def.subEmitters;
  let subEmittersStructOk = false;
  if (!Array.isArray(subEmitters)) {
    errors.push('subEmitters must be an array');
  } else {
    subEmittersStructOk = true;
    for (let i = 0; i < subEmitters.length; i++) {
      const s = subEmitters[i];
      const path = `subEmitters[${i}]`;
      if (!isPlainObject(s)) {
        errors.push(`${path} must be an object`);
        subEmittersStructOk = false;
        continue;
      }
      if (!isNonEmptyString(s.id)) {
        errors.push(`${path}.id must be a non-empty string`);
        subEmittersStructOk = false;
      }
      if (!isNonEmptyString(s.parentEmitterId)) {
        errors.push(`${path}.parentEmitterId must be a non-empty string`);
        subEmittersStructOk = false;
      } else if (Array.isArray(emitters) && !emitterIds.has(s.parentEmitterId)) {
        errors.push(
          `${path}.parentEmitterId "${s.parentEmitterId}" does not match any emitter id`,
        );
        subEmittersStructOk = false;
      }
      if (!isNonEmptyString(s.childEmitterId)) {
        errors.push(`${path}.childEmitterId must be a non-empty string`);
        subEmittersStructOk = false;
      } else if (Array.isArray(emitters) && !emitterIds.has(s.childEmitterId)) {
        errors.push(
          `${path}.childEmitterId "${s.childEmitterId}" does not match any emitter id`,
        );
        subEmittersStructOk = false;
      }
      if (!isNonEmptyString(s.trigger) || !SUB_TRIGGERS.has(s.trigger)) {
        errors.push(`${path}.trigger must be one of onSpawn|onDeath|atAge`);
      } else if (s.trigger === 'atAge') {
        if (!isNonNegNumber(s.atAge)) {
          errors.push(`${path}.atAge must be a number >= 0 when trigger is atAge`);
        }
      }
    }
  }

  if (def.customStep !== undefined && !isNonEmptyString(def.customStep)) {
    errors.push('customStep must be a non-empty string when set');
  }

  // Budget exceed checks share execution-demand semantics with EffectExecutor (T4).
  if (
    emittersStructOk
    && trailsStructOk
    && subEmittersStructOk
    && isPlainObject(def.budget)
    && isNonNegNumber(def.budget.maxEmitters)
    && isNonNegNumber(def.budget.maxParticles)
    && isNonNegNumber(def.budget.maxTrails)
  ) {
    const budgetResult = checkEffectBudget({
      emitters: emitters as EffectDef['emitters'],
      trails: trails as EffectDef['trails'],
      subEmitters: subEmitters as EffectDef['subEmitters'],
      budget: def.budget as unknown as EffectDef['budget'],
    });
    if (!budgetResult.ok) errors.push(...budgetResult.errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
