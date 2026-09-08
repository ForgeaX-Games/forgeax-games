// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
import { mulberry32 } from './rng';
import type { BiomePlan, Domain, Placement, RegionProvider, RNG } from './types';

export type PlacementGate<P> = (p: P, prop: string) => boolean;
export type FootRadius = (prop: string, sizeU: number) => number;

function randInt([lo, hi]: [number, number], rng: RNG): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function lerp([lo, hi]: [number, number], rng: RNG): number {
  return lo + (hi - lo) * rng();
}

function weightedPick(weights: Record<string, number>, rng: RNG): string {
  let total = 0;
  for (const weight of Object.values(weights)) total += weight;
  let cursor = rng() * total;
  let last = '';
  for (const [key, weight] of Object.entries(weights)) {
    last = key;
    cursor -= weight;
    if (cursor < 0) return key;
  }
  return last;
}

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

export function scatterClusters<P>(
  domain: Domain<P>,
  regions: RegionProvider<P>,
  plan: BiomePlan,
  gate: PlacementGate<P>,
  footRadiusWorld: FootRadius,
  rng: RNG = mulberry32(plan.seed),
): Placement<P>[] {
  const out: Placement<P>[] = [];
  let nextClusterId = 0;

  const spacingOK = (q: P, prop: string, sizeU: number): boolean => {
    for (const b of out) {
      const minimum = (footRadiusWorld(prop, sizeU) + footRadiusWorld(b.prop, b.sizeU))
        * plan.minSpacingFactor;
      if (domain.dist(q, b.p) < minimum) return false;
    }
    return true;
  };

  for (const spec of plan.clusters) {
    const count = randInt(spec.count, rng);
    for (let c = 0; c < count; c++) {
      const clusterId = nextClusterId++;
      let seed: P | undefined;
      for (let attempt = 0; attempt < 80; attempt++) {
        const p = domain.samplePoint(rng);
        if ((regions(p)[spec.region] ?? 0) >= spec.regionMin && gate(p, '__seed__')) {
          seed = p;
          break;
        }
      }
      if (seed === undefined) continue;

      const radius = lerp(spec.radiusWorld, rng);
      const perCluster = randInt(spec.perCluster, rng);
      for (let i = 0; i < perCluster; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const q = domain.jitter(seed, radius * 0.5, rng);
          const prop = weightedPick(spec.props, rng);
          const sizeU = rng();
          const dark = rng() < plan.darkFraction;
          if (gate(q, prop) && spacingOK(q, prop, sizeU)) {
            out.push({
              p: q,
              prop,
              clusterId,
              kind: spec.kind,
              region: argmax(regions(q)),
              sizeU,
              dark,
            });
            break;
          }
        }
      }
    }
  }

  for (let i = 0; i < plan.strayBudget; i++) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = domain.samplePoint(rng);
      if (!gate(p, '__seed__')) continue;
      const region = argmax(regions(p));
      const table = plan.strayByRegion[region];
      if (table === undefined || Object.keys(table).length === 0) break;
      const prop = weightedPick(table, rng);
      const sizeU = rng();
      const dark = rng() < plan.darkFraction;
      if (gate(p, prop) && spacingOK(p, prop, sizeU)) {
        out.push({ p, prop, clusterId: -1, kind: 'stray', region, sizeU, dark });
        break;
      }
    }
  }

  return out;
}
