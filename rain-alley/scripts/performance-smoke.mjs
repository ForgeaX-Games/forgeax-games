/** Browser diagnostic: real RAF intervals, independent of the game's clamped clock.
 * Invoke from the running preview: await import('/preview/host-games/rain-alley/scripts/performance-smoke.mjs').then(m => m.measurePerformance())
 * No gameplay state is changed. Warm probes before comparing steady-state runs.
 */
export async function measurePerformance({ durationMs = 8000, label = 'baseline' } = {}) {
  const { renderer, app, world } = window.__forgeax;
  const before = renderer.inspect();
  const intervals = [];
  const drawCpu = [], updateCpu = [];
  const originalDraw = app.renderer.draw, originalUpdate = world.update;
  app.renderer.draw = function (...args) {
    const start = performance.now();
    try { return originalDraw.apply(this, args); }
    finally { drawCpu.push(performance.now() - start); }
  };
  world.update = function (...args) {
    const start = performance.now();
    try { return originalUpdate.apply(this, args); }
    finally { updateCpu.push(performance.now() - start); }
  };
  const start = performance.now();
  try { await new Promise((resolve) => {
    let previous;
    let done = false;
    const deadline = setTimeout(() => { done = true; resolve(); }, durationMs + 1000);
    function tick(now) {
      if (done) return;
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (now - start >= durationMs) { done = true; clearTimeout(deadline); resolve(); }
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }); } finally { app.renderer.draw = originalDraw; world.update = originalUpdate; }
  const elapsedMs = performance.now() - start;
  const after = renderer.inspect();
  const sorted = [...intervals].sort((a, b) => a - b);
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const cpuSummary = values => {
    const a = values.sort((a,b)=>a-b);
    return { samples:a.length, median:a[Math.floor(a.length*.5)], p95:a[Math.floor(a.length*.95)] };
  };
  const result = {
    label, timestamp: new Date().toISOString(), elapsedMs,
    canvas: { width: document.querySelector('canvas').width, height: document.querySelector('canvas').height },
    visibility: document.visibilityState,
    raf: { samples: intervals.length, median: quantile(0.5), p95: quantile(0.95), over20ms: intervals.filter(x => x > 20).length, over50ms: intervals.filter(x => x > 50).length },
    renderedFrames: after.frame.frameId - before.frame.frameId,
    renderFps: (after.frame.frameId - before.frame.frameId) * 1000 / elapsedMs,
    updateIntervals: window.__rainFps.snapshot().frameMs,
    gpuTimestampAvailable: after.capabilities.timestampQuery,
    cpuMs: { rendererDraw: cpuSummary(drawCpu), worldUpdate: cpuSummary(updateCpu) },
    frustum: after.frustumStats,
    scene: after.renderScene,
    passes: after.perFramePassNames,
    probes: after.reflectionProbes,
  };
  result.pass = result.raf.p95 <= 18 && result.renderFps >= 58;
  return result;
}
