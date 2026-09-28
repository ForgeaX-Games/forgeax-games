// Game-side CPU/rAF frame-time probe + counter snapshot helpers (PR 0).
// No GPU timestamp queries — this engine has no path for GPU frame time.

export type PerfProbeSnapshot = {
  /** Sample count currently in the ring. */
  samples: number;
  /** Full recording duration and count; ring quantiles may cover less if wrapped. */
  recordedSeconds: number;
  recordedFrames: number;
  windowSeconds: number;
  /** Median rAF frame time in milliseconds. */
  medianMs: number | null;
  /** 95th-percentile rAF frame time in milliseconds. */
  p95Ms: number | null;
  /** Mean rAF frame time in milliseconds. */
  meanMs: number | null;
  /** Peak explicitly supplied folded-draw sample since last reset (or null). */
  foldedDrawsPeak: number | null;
  /** Last explicitly supplied folded-draw sample (or null if unavailable). */
  foldedDrawsLast: number | null;
  /** Game-owned transient / VFX pool high-water marks since last reset. */
  pools: Record<string, number>;
};

export type PerfProbe = {
  /** Record one frame duration in seconds (rAF / Time.delta). */
  recordFrame(dtSec: number): void;
  /** Record an explicitly supplied folded-draw sample; the SDK .38 reader supplies none. */
  observeFoldedDraws(value: number | null | undefined): void;
  /** Observe named pool / transient counts (keeps high-water marks). */
  observePools(counts: Record<string, number>): void;
  snapshot(): PerfProbeSnapshot;
  reset(): void;
};

function percentileSorted(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

export function createPerfProbe(capacity = 12000): PerfProbe {
  const ring = new Float64Array(Math.max(1, capacity));
  let write = 0;
  let count = 0;
  let recordedSeconds = 0;
  let recordedFrames = 0;
  let foldedDrawsPeak: number | null = null;
  let foldedDrawsLast: number | null = null;
  const poolHigh: Record<string, number> = {};

  return {
    recordFrame(dtSec) {
      if (!Number.isFinite(dtSec) || dtSec <= 0) return;
      const ms = dtSec * 1000;
      recordedSeconds += dtSec;
      recordedFrames += 1;
      ring[write] = ms;
      write = (write + 1) % ring.length;
      if (count < ring.length) count += 1;
    },
    observeFoldedDraws(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      foldedDrawsLast = value;
      foldedDrawsPeak = foldedDrawsPeak === null ? value : Math.max(foldedDrawsPeak, value);
    },
    observePools(counts) {
      for (const [k, v] of Object.entries(counts)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const prev = poolHigh[k];
        poolHigh[k] = prev === undefined ? v : Math.max(prev, v);
      }
    },
    snapshot() {
      const values: number[] = [];
      if (count === ring.length) {
        for (let i = 0; i < ring.length; i += 1) values.push(ring[i]!);
      } else {
        for (let i = 0; i < count; i += 1) values.push(ring[i]!);
      }
      values.sort((a, b) => a - b);
      const meanMs = values.length === 0
        ? null
        : values.reduce((a, b) => a + b, 0) / values.length;
      const mid = values.length === 0
        ? null
        : values.length % 2 === 1
          ? values[(values.length - 1) >> 1]!
          : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2;
      return {
        samples: values.length,
        recordedSeconds,
        recordedFrames,
        windowSeconds: values.reduce((sum, ms) => sum + ms, 0) / 1000,
        medianMs: mid,
        p95Ms: percentileSorted(values, 0.95),
        meanMs,
        foldedDrawsPeak,
        foldedDrawsLast,
        pools: { ...poolHigh },
      };
    },
    reset() {
      write = 0;
      count = 0;
      recordedSeconds = 0;
      recordedFrames = 0;
      foldedDrawsPeak = null;
      foldedDrawsLast = null;
      for (const k of Object.keys(poolHigh)) delete poolHigh[k];
    },
  };
}

/**
 * Read the SDK folded-draw metric when the public host contract exposes it.
 *
 * SDK .38 keeps `render.instancing.foldedDraws` in private owner metrics and
 * exposes no corresponding `Renderer.inspect()` field.  Do not read private
 * fields or walk `instanceCollections` here: neither is the metric's stated
 * semantics, and this function is called from the frame loop.  Keep the
 * compatibility seam, but report the metric as unavailable until the SDK
 * publishes a bounded public field for it.
 */
export function readFoldedDraws(_app: unknown): number | null {
  return null;
}
