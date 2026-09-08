// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
export type RNG = () => number;

export interface Domain<P> {
  samplePoint(rng: RNG): P;
  jitter(p: P, sigmaWorld: number, rng: RNG): P;
  dist(a: P, b: P): number;
  areaWorld(): number;
}

export type RegionWeights = Record<string, number>;
export type RegionProvider<P> = (p: P) => RegionWeights;

export interface ClusterSpec {
  kind: string;
  region: string;
  regionMin: number;
  count: [number, number];
  radiusWorld: [number, number];
  perCluster: [number, number];
  props: Record<string, number>;
}

export interface BiomePlan {
  version: 1;
  seed: number;
  strayBudget: number;
  clusters: ClusterSpec[];
  strayByRegion: Record<string, Record<string, number>>;
  minSpacingFactor: number;
  darkFraction: number;
  provenance: { user_stated: string[]; defaulted: string[] };
}

export interface Placement<P> {
  p: P;
  prop: string;
  clusterId: number;
  kind: string;
  region: string;
  sizeU: number;
  dark: boolean;
}
