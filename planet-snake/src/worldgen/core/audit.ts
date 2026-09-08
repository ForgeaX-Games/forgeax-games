// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
import type { Domain, Placement, RegionProvider, RNG } from './types';
import type { FootRadius } from './scatter';

function argmax(weights: Record<string, number>): string {
  let best = 'none';
  let max = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (weight > max) {
      best = key;
      max = weight;
    }
  }
  return best;
}

export function auditRegions<P>(
  domain: Domain<P>,
  regions: RegionProvider<P>,
  n: number,
  rng: RNG,
): {
  n: number;
  areaFraction: Record<string, number>;
  softMean: Record<string, number>;
} {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n must be a positive integer');
  const counts: Record<string, number> = {};
  const sums: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const weights = regions(domain.samplePoint(rng));
    const region = argmax(weights);
    counts[region] = (counts[region] ?? 0) + 1;
    for (const [key, weight] of Object.entries(weights)) {
      counts[key] ??= 0;
      sums[key] = (sums[key] ?? 0) + weight;
    }
  }
  return {
    n,
    areaFraction: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count / n])),
    softMean: Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, sum / n])),
  };
}

export function auditPlacements<P>(
  domain: Domain<P>,
  placements: Placement<P>[],
  footRadiusWorld: FootRadius,
): {
  total: number;
  perRegion: Record<string, { count: number; byProp: Record<string, number> }>;
  clarkEvans: Record<string, number | 'n/a'>;
  spacingViolations: number;
} {
  const perRegion: Record<string, { count: number; byProp: Record<string, number> }> = {};
  const byKind: Record<string, Placement<P>[]> = {};
  for (const placement of placements) {
    const region = perRegion[placement.region] ??= { count: 0, byProp: {} };
    region.count++;
    region.byProp[placement.prop] = (region.byProp[placement.prop] ?? 0) + 1;
    (byKind[placement.kind] ??= []).push(placement);
  }

  let spacingViolations = 0;
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]!;
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]!;
      const minimum = footRadiusWorld(a.prop, a.sizeU) + footRadiusWorld(b.prop, b.sizeU);
      if (domain.dist(a.p, b.p) < minimum) spacingViolations++;
    }
  }

  const clarkEvans: Record<string, number | 'n/a'> = {};
  for (const [kind, group] of Object.entries(byKind)) {
    if (group.length < 15) {
      clarkEvans[kind] = 'n/a';
      continue;
    }
    let nearestSum = 0;
    for (let i = 0; i < group.length; i++) {
      let nearest = Infinity;
      for (let j = 0; j < group.length; j++) {
        if (i !== j) nearest = Math.min(nearest, domain.dist(group[i]!.p, group[j]!.p));
      }
      nearestSum += nearest;
    }
    const observed = nearestSum / group.length;
    // Clark-Evans' planar Poisson expectation is only an approximation on a sphere.
    const expected = 0.5 * Math.sqrt(domain.areaWorld() / group.length);
    clarkEvans[kind] = observed / expected;
  }

  return { total: placements.length, perRegion, clarkEvans, spacingViolations };
}
