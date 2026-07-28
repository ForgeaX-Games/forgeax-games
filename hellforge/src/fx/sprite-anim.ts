// Sprite flipbook / fade animation helpers (PR8 T1).
// Pure + deterministic — no engine imports — so sprite timing is unit-testable
// in bun. Consumed by fx/sprite.ts (per-tick param feed) and mirrored by
// sprite.wgsl's flipbook math.

/**
 * Flipbook frame for a particle of `age` seconds.
 * Returns a FRACTIONAL frame (sprite.wgsl blends by fract when blendFrames=1).
 * - `fps <= 0` or `frames <= 1` → static frame 0.
 * - loop off: clamps at the last frame (age past the clip holds the end).
 * - loop on: wraps modulo `frames`.
 */
export function frameAt(age: number, fps: number, frames: number, loop: boolean): number {
  if (frames <= 1 || fps <= 0) return 0;
  const f = age * fps;
  if (f <= 0) return 0;
  if (loop) return f % frames;
  return Math.min(f, frames - 1);
}

/**
 * Alpha-erosion fade: 0 until `age/life` crosses `fadeStartFrac`, then ramps
 * linearly to 1 at end of life (fed to sprite.wgsl `erosion`).
 * - `age < 0` → 0; `age >= life` → 1 (unless the fade never starts).
 * - `fadeStartFrac >= 1` → fade never begins within the lifetime → 0.
 */
export function erosionAt(age: number, life: number, fadeStartFrac: number): number {
  if (life <= 0) return 1;
  const start = Math.min(Math.max(fadeStartFrac, 0), 1);
  if (start >= 1) return 0;
  const t = age / life;
  if (t <= start) return 0;
  if (t >= 1) return 1;
  return (t - start) / (1 - start);
}
