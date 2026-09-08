import { STRESS } from '../config/stress.ts';

export interface RampInput {
  readonly elapsed: number;
  readonly frozenAt: number | undefined;
  readonly liveEnemies: number;
  readonly availableSlots: number;
}

export interface RampOutput {
  readonly targetEnemies: number;
  readonly spawnCount: number;
  readonly capacityShortfall: number;
}

/** Pure target-count controller for the pressure pool. */
export function stepStressRamp(input: RampInput, config: typeof STRESS.ramp = STRESS.ramp): RampOutput {
  const elapsed = Number.isFinite(input.elapsed) ? Math.max(0, input.elapsed) : 0;
  const freezeAt = input.frozenAt === undefined || !Number.isFinite(input.frozenAt)
    ? elapsed
    : Math.max(0, input.frozenAt);
  const targetEnemies = Math.min(
    config.hardCap,
    config.startEnemies + config.growthPerSecond * Math.min(elapsed, freezeAt),
  );
  const wanted = Math.min(
    config.spawnBudgetPerTick,
    Math.max(0, Math.floor(targetEnemies - Math.max(0, input.liveEnemies))),
  );
  const available = Math.max(0, Math.floor(input.availableSlots));
  const spawnCount = Math.min(wanted, available);
  return {
    targetEnemies,
    spawnCount,
    capacityShortfall: Math.max(0, wanted - spawnCount),
  };
}
