// One-shot loading marks for Hellforge boot (LOADING-PERFORMANCE-EXECUTION-PLAN §2.2).
// No PerformanceObserver — the browser harness owns Long Task / Resource / Navigation.

import { createPerfProbe, type PerfProbe, type PerfProbeSnapshot } from './perf-probe';

export const HF_LOADING_MARKS = Object.freeze([
  'hf:bootstrap-start',
  'hf:click-gate-visible',
  'hf:intro-complete',
  'hf:title-visible',
  'hf:title-interactive',
  'hf:camp-load-start',
  'hf:camp-assets-ready',
  'hf:character-confirmed',
  'hf:runtime-load-start',
  'hf:runtime-assets-ready',
  'hf:camp-playable',
  'hf:first-stable-frame',
] as const);

export type HfLoadingMarkName = (typeof HF_LOADING_MARKS)[number];

export type LoadingPerfMarkEntry = {
  readonly startTime: number;
};

export type LoadingPerfMeasureEntry = {
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
};

export type LoadingPerfSnapshot = {
  readonly generation: number;
  readonly marks: Partial<Record<HfLoadingMarkName, LoadingPerfMarkEntry>>;
  readonly measures: readonly LoadingPerfMeasureEntry[];
  readonly probe: PerfProbeSnapshot;
};

type MeasureSpec = {
  readonly name: string;
  readonly start: HfLoadingMarkName | 'navigationStart';
  readonly end: HfLoadingMarkName;
};

const MEASURE_SPECS: readonly MeasureSpec[] = [
  {
    name: 'hf:measure:navigationStart-to-click-gate-visible',
    start: 'navigationStart',
    end: 'hf:click-gate-visible',
  },
  {
    name: 'hf:measure:intro-complete-to-title-interactive',
    start: 'hf:intro-complete',
    end: 'hf:title-interactive',
  },
  {
    name: 'hf:measure:camp-load-start-to-camp-assets-ready',
    start: 'hf:camp-load-start',
    end: 'hf:camp-assets-ready',
  },
  {
    name: 'hf:measure:character-confirmed-to-camp-playable',
    start: 'hf:character-confirmed',
    end: 'hf:camp-playable',
  },
  {
    name: 'hf:measure:runtime-load-start-to-runtime-assets-ready',
    start: 'hf:runtime-load-start',
    end: 'hf:runtime-assets-ready',
  },
  {
    name: 'hf:measure:camp-playable-to-first-stable-frame',
    start: 'hf:camp-playable',
    end: 'hf:first-stable-frame',
  },
];

export type LoadingPerfSession = {
  readonly generation: number;
  readonly probe: PerfProbe;
  mark(name: HfLoadingMarkName): void;
  snapshot(): LoadingPerfSnapshot;
  end(): void;
};

type HfHost = { __hf?: Record<string, unknown> };

function hfHost(): HfHost {
  return (typeof window !== 'undefined' ? window : globalThis) as HfHost;
}

let active: LoadingPerfSession | null = null;
let nextGeneration = 1;

function clearTimeline(): void {
  const perf = globalThis.performance;
  if (perf === undefined) return;
  for (const name of HF_LOADING_MARKS) {
    try { perf.clearMarks(name); } catch { /* bun/browser variance */ }
  }
  for (const spec of MEASURE_SPECS) {
    try { perf.clearMeasures(spec.name); } catch { /* bun/browser variance */ }
  }
}

function createSession(): LoadingPerfSession {
  const generation = nextGeneration++;
  const probe = createPerfProbe(600);
  const marks = new Map<HfLoadingMarkName, number>();
  const measures = new Map<string, LoadingPerfMeasureEntry>();
  let ended = false;

  const emitMeasures = (end: HfLoadingMarkName): void => {
    const perf = globalThis.performance;
    for (const spec of MEASURE_SPECS) {
      if (spec.end !== end || measures.has(spec.name)) continue;
      const endTime = marks.get(spec.end);
      if (endTime === undefined) continue;
      const startTime = spec.start === 'navigationStart' ? 0 : marks.get(spec.start);
      if (startTime === undefined) continue;
      const duration = Math.max(0, endTime - startTime);
      const entry = { name: spec.name, startTime, duration };
      measures.set(spec.name, entry);
      try {
        perf?.measure?.(spec.name, { start: startTime, duration });
      } catch { /* measure is DevTools sugar; snapshot is SSOT */ }
    }
  };

  return {
    generation,
    probe,
    mark(name) {
      if (ended || marks.has(name)) return;
      const startTime = globalThis.performance?.now?.() ?? Date.now();
      marks.set(name, startTime);
      try { globalThis.performance?.mark?.(name); } catch { /* */ }
      emitMeasures(name);
    },
    snapshot() {
      const markOut: Partial<Record<HfLoadingMarkName, LoadingPerfMarkEntry>> = {};
      for (const [name, startTime] of marks) markOut[name] = { startTime };
      return {
        generation,
        marks: markOut,
        measures: [...measures.values()],
        probe: probe.snapshot(),
      };
    },
    end() {
      ended = true;
    },
  };
}

/** Start a Play generation. Clears prior marks so Stop→Play cannot reuse them. */
export function beginLoadingPerfSession(): LoadingPerfSession {
  active?.end();
  clearTimeline();
  active = createSession();
  return active;
}

export function endLoadingPerfSession(): void {
  active?.end();
  active = null;
  clearTimeline();
}

export function getLoadingPerfSession(): LoadingPerfSession | null {
  return active;
}

/** No-op when no session (intro/shell unit tests, leftover rAF). */
export function markLoading(name: HfLoadingMarkName): void {
  active?.mark(name);
}

export function snapshotLoadingPerf(): LoadingPerfSnapshot {
  return active?.snapshot() ?? {
    generation: 0,
    marks: {},
    measures: [],
    probe: createPerfProbe(1).snapshot(),
  };
}

export function attachLoadingPerfToHf(): void {
  const host = hfHost();
  const prev = typeof host.__hf === 'object' && host.__hf !== null ? host.__hf : {};
  host.__hf = {
    ...prev,
    loadingPerf: () => snapshotLoadingPerf(),
  };
}

/**
 * Copy shell-era `loadingPerf` onto the runtime `__hf` object without spreading
 * that object (spreading would evaluate getters like `witchRoot`).
 */
export function preserveShellHfKeys(next: Record<string, unknown>): Record<string, unknown> {
  const prev = hfHost().__hf;
  if (typeof prev?.loadingPerf === 'function' && typeof next.loadingPerf !== 'function') {
    next.loadingPerf = prev.loadingPerf;
  }
  return next;
}

export function detachHellforgeHf(): void {
  delete hfHost().__hf;
}

type Raf = (cb: (time: number) => void) => number;

/** Two rAFs after camp-playable; resets the 600-frame probe (plan §5.4). */
export function scheduleFirstStableFrame(raf: Raf = requestAnimationFrame): void {
  const generation = active?.generation;
  raf(() => {
    raf(() => {
      if (active === null || active.generation !== generation) return;
      active.probe.reset();
      active.mark('hf:first-stable-frame');
    });
  });
}
