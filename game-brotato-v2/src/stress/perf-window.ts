import { STRESS } from '../config/stress.ts';

export interface PerfWindowState {
  samples: Array<{ age: number; fps: number }>;
  minFps: number;
  belowWarnSeconds: number;
  belowFreezeSeconds: number;
}

export interface PerfVerdict {
  readonly fps: number;
  readonly minFps: number;
  readonly warn: boolean;
  readonly freeze: boolean;
}

export function createPerfWindow(): PerfWindowState {
  return { samples: [], minFps: 0, belowWarnSeconds: 0, belowFreezeSeconds: 0 };
}

/** Mutating reducer used by the browser HUD and deterministic unit tests. */
export function pushFrame(
  state: PerfWindowState,
  deltaSeconds: number,
  config: typeof STRESS.perf = STRESS.perf,
): PerfVerdict {
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const instantaneousFps = delta > 0 ? 1 / delta : 0;
  for (const sample of state.samples) sample.age += delta;
  state.samples.push({ age: 0, fps: instantaneousFps });
  while ((state.samples[0]?.age ?? 0) > config.windowSeconds) state.samples.shift();

  const fps = state.samples.length === 0
    ? 0
    : state.samples.reduce((sum, sample) => sum + sample.fps, 0) / state.samples.length;
  state.minFps = state.minFps === 0 ? fps : Math.min(state.minFps, fps);
  state.belowWarnSeconds = fps < config.warnFps ? state.belowWarnSeconds + delta : 0;
  state.belowFreezeSeconds = fps < config.freezeFps ? state.belowFreezeSeconds + delta : 0;
  const reached = (elapsed: number, threshold: number): boolean => elapsed + 1e-9 >= threshold;
  return {
    fps,
    minFps: state.minFps,
    warn: reached(state.belowWarnSeconds, config.warnHoldSeconds),
    freeze: reached(state.belowFreezeSeconds, config.freezeHoldSeconds),
  };
}
