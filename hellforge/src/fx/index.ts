export {
  validateEffectDef,
  type BehaviorDef,
  type BehaviorType,
  type EffectBudget,
  type EffectColor,
  type EffectDef,
  type EmitterDef,
  type EmitterKind,
  type EmitterMode,
  type SubEmitterDef,
  type SubEmitterTrigger,
  type TrailDef,
  type ValidateEffectDefResult,
} from './effect-def';

export {
  assertEffectBudget,
  checkEffectBudget,
  effectExecutionDemand,
  FX_DEV_ASSERTS,
  fxDevAssertsEnabled,
  setFxDevAsserts,
  type BudgetCheckResult,
  type EffectExecutionDemand,
} from './budget';

export {
  EffectExecutor,
  type EffectExecutorStats,
  type EffectHandle,
  type FxSpawnLease,
  type FxSpawnPort,
  type Vec3,
} from './executor';
