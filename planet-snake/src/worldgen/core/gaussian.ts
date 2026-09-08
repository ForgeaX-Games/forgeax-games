// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
import type { RNG } from './types';

export function gaussianPair(rng: RNG): [number, number] {
  const radius = Math.sqrt(-2 * Math.log(1 - rng()));
  const angle = 2 * Math.PI * rng();
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}
