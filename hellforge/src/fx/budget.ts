// EffectDef budget enforcement (PR2b T4).
// Soft-reject stays production-safe; dev asserts fail loudly.

import type { EffectDef } from './effect-def';

export type BudgetCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: string[] };

export interface EffectExecutionDemand {
  readonly emitters: number;
  readonly particles: number;
  readonly trails: number;
}

type BudgetSlice = Pick<EffectDef, 'emitters' | 'subEmitters' | 'trails' | 'budget'>;

function childEmitterIds(def: BudgetSlice): Set<string> {
  const ids = new Set<string>();
  for (const s of def.subEmitters) ids.add(s.childEmitterId);
  return ids;
}

function emitterById(def: BudgetSlice, id: string) {
  for (const e of def.emitters) {
    if (e.id === id) return e;
  }
  return undefined;
}

/**
 * Runtime acquisition demand: root emitters + one charge per sub-emitter edge.
 * Matches EffectExecutor.play preflight (children are not double-counted as roots).
 */
export function effectExecutionDemand(def: BudgetSlice): EffectExecutionDemand {
  const children = childEmitterIds(def);
  let emitters = 0;
  let particles = 0;

  for (const emitter of def.emitters) {
    if (children.has(emitter.id)) continue;
    emitters++;
    particles += emitter.count;
  }
  for (const sub of def.subEmitters) {
    const child = emitterById(def, sub.childEmitterId);
    if (!child) continue;
    emitters++;
    particles += child.count;
  }

  return { emitters, particles, trails: def.trails.length };
}

/** Non-throwing budget check used by validateEffectDef and soft reject paths. */
export function checkEffectBudget(def: BudgetSlice): BudgetCheckResult {
  const demand = effectExecutionDemand(def);
  const errors: string[] = [];
  const { maxEmitters, maxParticles, maxTrails } = def.budget;

  if (demand.emitters > maxEmitters) {
    errors.push(
      `execution demand emitters ${demand.emitters} exceeds budget.maxEmitters ${maxEmitters}`,
    );
  }
  if (demand.particles > maxParticles) {
    errors.push(
      `execution demand particles ${demand.particles} exceeds budget.maxParticles ${maxParticles}`,
    );
  }
  if (demand.trails > maxTrails) {
    errors.push(
      `trails length ${demand.trails} exceeds budget.maxTrails ${maxTrails}`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function readViteEnv(): { DEV?: boolean; PROD?: boolean } | undefined {
  // Match hellforge's import.meta.env.DEV pattern (see dev-skill-fixture.ts).
  // tsconfig.check.json may omit Vite ImportMeta.env typings.
  return (import.meta as ImportMeta & { env?: { DEV?: boolean; PROD?: boolean } }).env;
}

function defaultFxDevAsserts(): boolean {
  const env = readViteEnv();
  if (env?.PROD === true) return false;
  if (env?.DEV === false) return false;
  if (env?.DEV === true) return true;
  // Avoid bare `process` (browser tsc has no @types/node).
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  if (nodeEnv === 'production') {
    return false;
  }
  // Outside production (incl. bun test without Vite env) → loud by default.
  return true;
}

/**
 * Mutable flag — defaults true outside production.
 * Tests flip this to exercise the production soft-reject path.
 */
export let FX_DEV_ASSERTS = defaultFxDevAsserts();

export function setFxDevAsserts(enabled: boolean): void {
  FX_DEV_ASSERTS = enabled;
}

export function fxDevAssertsEnabled(): boolean {
  return FX_DEV_ASSERTS;
}

/**
 * Dev-only hard fail for over-budget defs.
 * No-op when FX_DEV_ASSERTS is false (production / soft-reject tests).
 */
export function assertEffectBudget(def: BudgetSlice): void {
  if (!FX_DEV_ASSERTS) return;
  const result = checkEffectBudget(def);
  if (result.ok) return;
  const message = `EffectDef exceeds budget: ${result.errors.join('; ')}`;
  console.error(message);
  throw new Error(message);
}
