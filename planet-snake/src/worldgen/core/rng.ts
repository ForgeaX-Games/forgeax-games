// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
import type { RNG } from './types';

export function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
