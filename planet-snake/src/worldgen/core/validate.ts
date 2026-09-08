// VENDORED from worldgen 上游仓 @ 2026-08-07 — 改动请改上游后重新复制
import type { BiomePlan } from './types';

function fail(message: string): never {
  throw new TypeError(`Invalid biome plan: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function range(value: unknown, name: string, integer: boolean): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail(`${name} must be a [min,max] pair`);
  const [lo, hi] = value;
  if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isFinite(lo) || !Number.isFinite(hi)
    || lo < 0 || hi < lo || (integer && (!Number.isInteger(lo) || !Number.isInteger(hi)))) {
    fail(`${name} is invalid`);
  }
  return [lo, hi];
}

function weights(value: unknown, name: string, allowEmpty: boolean): void {
  const table = record(value, name);
  const entries = Object.entries(table);
  if (!allowEmpty && entries.length === 0) fail(`${name} must not be empty`);
  let total = 0;
  for (const [key, weight] of entries) {
    if (!key || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) fail(`${name} has an invalid weight`);
    total += weight;
  }
  if (entries.length > 0 && total <= 0) fail(`${name} must contain a positive weight`);
}

export function validateBiomePlan(plan: unknown, regionIds: Iterable<string>): asserts plan is BiomePlan {
  const value = record(plan, 'root');
  const known = new Set(regionIds);
  if (value.version !== 1) fail('version must be 1');
  if (typeof value.seed !== 'number' || !Number.isFinite(value.seed)) fail('seed must be finite');
  if (!Number.isInteger(value.strayBudget) || (value.strayBudget as number) < 0) fail('strayBudget must be a non-negative integer');
  if (typeof value.minSpacingFactor !== 'number' || !Number.isFinite(value.minSpacingFactor)
    || value.minSpacingFactor < 0) fail('minSpacingFactor must be non-negative');
  if (typeof value.darkFraction !== 'number' || !Number.isFinite(value.darkFraction)
    || value.darkFraction < 0 || value.darkFraction > 1) fail('darkFraction must be in [0,1]');
  if (!Array.isArray(value.clusters)) fail('clusters must be an array');

  for (let i = 0; i < value.clusters.length; i++) {
    const spec = record(value.clusters[i], `clusters[${i}]`);
    if (typeof spec.kind !== 'string' || !spec.kind) fail(`clusters[${i}].kind must be non-empty`);
    if (typeof spec.region !== 'string' || !known.has(spec.region)) fail(`clusters[${i}].region is unknown`);
    if (typeof spec.regionMin !== 'number' || !Number.isFinite(spec.regionMin)
      || spec.regionMin < 0 || spec.regionMin > 1) fail(`clusters[${i}].regionMin must be in [0,1]`);
    range(spec.count, `clusters[${i}].count`, true);
    range(spec.radiusWorld, `clusters[${i}].radiusWorld`, false);
    range(spec.perCluster, `clusters[${i}].perCluster`, true);
    weights(spec.props, `clusters[${i}].props`, false);
  }

  const stray = record(value.strayByRegion, 'strayByRegion');
  for (const [region, table] of Object.entries(stray)) {
    if (!known.has(region)) fail(`strayByRegion.${region} is unknown`);
    weights(table, `strayByRegion.${region}`, true);
  }

  const provenance = record(value.provenance, 'provenance');
  for (const key of ['user_stated', 'defaulted']) {
    if (!Array.isArray(provenance[key]) || !(provenance[key] as unknown[]).every((item) => typeof item === 'string')) {
      fail(`provenance.${key} must be a string array`);
    }
  }
}
