// Pure FX lifecycle bookkeeping — testable without a World / renderer.
// FxSystem owns the entities; this tracker owns the counts used by
// window.__hf debug probes and combat-run cleanup assertions.

export interface FxLifecycleSnapshot {
  /** Live skill projectiles (SkillSystem feeds this). */
  projectiles: number;
  /** Transient particles (bursts / pops / shatter shards). */
  particles: number;
  /** Active slow-status markers keyed by monster stable id. */
  slowMarkers: number;
  /** Sum of projectiles + particles + slow markers. */
  effects: number;
}

/**
 * Bookkeeping for frost / combat FX lifetimes. No ECS handles — keys are
 * stable monster ids (`Monster.id`) so handle reuse cannot leak markers.
 */
export class FxLifecycleTracker {
  projectiles = 0;
  particles = 0;
  private readonly slows = new Map<string, number>(); // id → until (wall-clock s)

  setProjectiles(n: number): void {
    this.projectiles = Math.max(0, n | 0);
  }

  setParticles(n: number): void {
    this.particles = Math.max(0, n | 0);
  }

  /** Begin or refresh a slow marker for `id` until wall-clock `until`. */
  beginSlow(id: string, until: number): void {
    const prev = this.slows.get(id) ?? 0;
    this.slows.set(id, Math.max(prev, until));
  }

  /** End a slow marker immediately (death / area / cleanup). */
  endSlow(id: string): boolean {
    return this.slows.delete(id);
  }

  hasSlow(id: string): boolean {
    return this.slows.has(id);
  }

  slowUntil(id: string): number {
    return this.slows.get(id) ?? 0;
  }

  /** Drop markers whose until ≤ now. Returns ids that expired. */
  expireSlows(now: number): string[] {
    const gone: string[] = [];
    for (const [id, until] of this.slows) {
      if (until <= now) {
        this.slows.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  /** Clear every tracked count (projectile expiry batch / area / cleanup). */
  clearAll(): void {
    this.projectiles = 0;
    this.particles = 0;
    this.slows.clear();
  }

  /** Clear only status markers (particles may still be dying out). */
  clearSlows(): void {
    this.slows.clear();
  }

  snapshot(): FxLifecycleSnapshot {
    const slowMarkers = this.slows.size;
    return {
      projectiles: this.projectiles,
      particles: this.particles,
      slowMarkers,
      effects: this.projectiles + this.particles + slowMarkers,
    };
  }
}
