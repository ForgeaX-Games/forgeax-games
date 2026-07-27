// Boot / zone-transition load tracker (PR11 T2) — drives a DETERMINATE
// loading bar from real asset-load completions instead of the old fixed-38%
// indeterminate sweep.
//
// Design notes
// ------------
// Phases are registered up-front with an item count and a per-item weight;
// every load call site reports each item as it settles (success OR failure —
// the bar tracks "work finished", not "work succeeded"). `fraction()` is the
// weight-normalised sum, and `onChange` only ever fires on INCREASE, so the
// bar is guaranteed monotonic (§5.4).
//
// Weights are RELATIVE. We default `weightPerItem = 1` (count-based) so the
// bar advances uniformly per real completion — honest without claiming byte
// accuracy. Source analysis of the engine asset-runtime (T1's two engine
// unknowns, resolved from code — not yet a live waterfall) shows the browser
// downloads COOKED pack artifacts (`.pack.json` + `.bin`), not raw GLBs, and
// that the hero GLB is cache-warm from the CharSelect preview — so raw-GLB
// byte weights would front-load the bar and lie (§9 "Progress bar lies").
// Swap in cooked-byte weights via `weightPerItem` once T6's live before/after
// waterfall lands.

export interface LoadTrackerSnapshot {
  readonly fraction: number;
  readonly totalItems: number;
  readonly doneItems: number;
}

export class LoadTracker {
  private readonly phases = new Map<string, { items: number; weight: number; done: number }>();
  private totalWeight = 0;
  private readonly listeners = new Set<(fraction: number) => void>();
  private lastEmitted = 0;

  /**
   * Register a phase. `items` = how many individual load completions it
   * expects (>= 1); `weightPerItem` = relative cost of one item (default 1 =
   * count-based). Registering the same id twice is a wiring bug — throws.
   */
  register(id: string, items: number, weightPerItem = 1): this {
    if (this.phases.has(id)) throw new Error(`LoadTracker: duplicate phase '${id}'`);
    if (!Number.isFinite(items) || items < 1) throw new Error(`LoadTracker: '${id}' items must be >= 1`);
    if (!Number.isFinite(weightPerItem) || weightPerItem <= 0) {
      throw new Error(`LoadTracker: '${id}' weightPerItem must be > 0`);
    }
    this.phases.set(id, { items, weight: weightPerItem, done: 0 });
    this.totalWeight += items * weightPerItem;
    return this;
  }

  /** Mark `n` items in phase `id` complete (clamped to the registered count). */
  complete(id: string, n = 1): void {
    const p = this.phases.get(id);
    if (p === undefined) return; // unknown phase — tolerate (load skipped on this path)
    p.done = Math.min(p.items, p.done + Math.max(0, n));
    this.emit();
  }

  /** Mark an entire phase complete regardless of per-item reports. */
  completePhase(id: string): void {
    const p = this.phases.get(id);
    if (p === undefined) return;
    p.done = p.items;
    this.emit();
  }

  /** Weight-normalised completion in [0, 1]. Monotonic while done only grows. */
  fraction(): number {
    if (this.totalWeight <= 0) return 0;
    let w = 0;
    for (const p of this.phases.values()) w += p.done * p.weight;
    return Math.min(1, w / this.totalWeight);
  }

  /** Current progress + raw item counts (tests / diagnostics). */
  snapshot(): LoadTrackerSnapshot {
    let total = 0;
    let done = 0;
    for (const p of this.phases.values()) {
      total += p.items;
      done += p.done;
    }
    return { fraction: this.fraction(), totalItems: total, doneItems: done };
  }

  /**
   * Subscribe to progress. Fires synchronously on each INCREASE only
   * (monotonic guarantee); never fires on a stall/decrease. Returns unsubscribe.
   */
  onChange(cb: (fraction: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const f = this.fraction();
    if (f <= this.lastEmitted) return; // monotonic — never report a stall or decrease
    this.lastEmitted = f;
    for (const cb of this.listeners) cb(f);
  }
}
