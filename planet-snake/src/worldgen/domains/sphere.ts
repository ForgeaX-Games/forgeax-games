// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
import { gaussianPair } from '../core/gaussian';
import type { Domain } from '../core/types';

export type V3 = [number, number, number];

function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: V3): V3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function sphereDomain(R: number): Domain<V3> {
  if (!Number.isFinite(R) || R <= 0) throw new RangeError('R must be positive');
  return {
    samplePoint(rng) {
      const z = 2 * rng() - 1;
      const phi = 2 * Math.PI * rng();
      const radial = Math.sqrt(Math.max(0, 1 - z * z));
      return [radial * Math.cos(phi), radial * Math.sin(phi), z];
    },
    jitter(p, sigmaWorld, rng) {
      if (!Number.isFinite(sigmaWorld) || sigmaWorld < 0) throw new RangeError('sigmaWorld must be non-negative');
      const n = normalize(p);
      const absolute = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
      const axis: V3 = absolute[0] <= absolute[1] && absolute[0] <= absolute[2]
        ? [1, 0, 0]
        : absolute[1] <= absolute[2] ? [0, 1, 0] : [0, 0, 1];
      const t1 = normalize(cross(n, axis));
      const t2 = cross(n, t1);
      const [g1, g2] = gaussianPair(rng);
      const sigmaAngle = sigmaWorld / R;
      return normalize([
        n[0] + (t1[0] * g1 + t2[0] * g2) * sigmaAngle,
        n[1] + (t1[1] * g1 + t2[1] * g2) * sigmaAngle,
        n[2] + (t1[2] * g1 + t2[2] * g2) * sigmaAngle,
      ]);
    },
    dist(a, b) {
      const cosine = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      return Math.acos(cosine) * R;
    },
    areaWorld() {
      return 4 * Math.PI * R * R;
    },
  };
}
