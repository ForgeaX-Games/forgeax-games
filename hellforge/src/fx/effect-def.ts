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

export type EmitterKind = 'burst' | 'pop' | 'rise' | 'custom';

/** Particle integration mode — mirrors FxSystem particle modes. */
export type EmitterMode = 'shrink' | 'rise' | 'pop';

export type BehaviorType = 'gravity' | 'drag' | 'customStep';

export type SubEmitterTrigger = 'onSpawn' | 'onDeath' | 'atAge';

export interface EffectBudget {
  readonly maxEmitters: number;
  readonly maxParticles: number;
  readonly maxTrails: number;
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
const EMITTER_KINDS = new Set<string>(['burst', 'pop', 'rise', 'custom']);
const EMITTER_MODES = new Set<string>(['shrink', 'rise', 'pop']);
const BEHAVIOR_TYPES = new Set<string>(['gravity', 'drag', 'customStep']);
const SUB_TRIGGERS = new Set<string>(['onSpawn', 'onDeath', 'atAge']);

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
        errors.push(`${path}.kind must be one of burst|pop|rise|custom`);
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
