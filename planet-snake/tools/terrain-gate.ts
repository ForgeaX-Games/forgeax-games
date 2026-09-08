import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { TERRAIN_ALBEDO_WINDOWS } from '../src/terrain-calibration';
import { argmaxRegionOrOcean, regionAt } from '../src/regions';
import { PS_REGIONS, type PSRegion } from '../src/terrain-plan';
import { relief, terrainHeight, warpedField, type V3 } from '../src/surface';

const N = 200_000;
const SEED = 20260810;
const PERCENTILES = [1, 5, 50, 95, 99] as const;
const WINDOW_PERCENTILES = {
  bareMix: [55, 90],
  valleyShade: [10, 80],
} as const;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleSphere(rng: () => number): V3 {
  const y = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  return [radial * Math.cos(phi), y, radial * Math.sin(phi)];
}

const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalise = (p: V3): V3 => {
  const length = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / length, p[1] / length, p[2] / length];
};

/** Magnitude of the unit-sphere tangent gradient, in H units per radian. */
function terrainGradient(p: V3): number {
  const axis: V3 = Math.abs(p[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = normalise(cross(p, axis));
  const t2 = cross(p, t1);
  const e = 0.0025;
  const sample = (t: V3, sign: number): number => relief(normalise([
    p[0] + t[0] * e * sign,
    p[1] + t[1] * e * sign,
    p[2] + t[2] * e * sign,
  ]));
  const du = (sample(t1, 1) - sample(t1, -1)) / (2 * e);
  const dv = (sample(t2, 1) - sample(t2, -1)) / (2 * e);
  return Math.hypot(du, dv);
}

function percentile(sorted: readonly number[], p: number): number {
  assert.ok(sorted.length > 0, `cannot compute p${p} of an empty sample`);
  const index = (sorted.length - 1) * p / 100;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const t = index - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * t;
}

function quantiles(values: number[]): Record<number, number> {
  values.sort((a, b) => a - b);
  return Object.fromEntries(PERCENTILES.map((p) => [p, percentile(values, p)]));
}

const fmtQuantiles = (q: Record<number, number>): string => PERCENTILES
  .map((p) => `p${p}=${q[p]!.toFixed(6)}`)
  .join('  ');

const byRegion = Object.fromEntries(
  PS_REGIONS.map((region) => [region, [] as number[]]),
) as Record<PSRegion, number[]>;
const gradientByRegion = Object.fromEntries(
  PS_REGIONS.map((region) => [region, [] as number[]]),
) as Record<PSRegion, number[]>;
const field: number[] = [];
const worldHeight: number[] = [];
let maxWeightError = 0;
const rng = mulberry32(SEED);

for (let i = 0; i < N; i++) {
  const p = sampleSphere(rng);
  if (warpedField(p) <= 0) continue;
  const selected = argmaxRegionOrOcean(p);
  assert.notEqual(selected, 'ocean', 'land point classified as ocean');
  const h = relief(p);
  field.push(h);
  worldHeight.push(terrainHeight(p));
  byRegion[selected].push(h);
  gradientByRegion[selected].push(terrainGradient(p));

  const weights = regionAt(p);
  const sum = PS_REGIONS.reduce((total, region) => total + weights[region], 0);
  maxWeightError = Math.max(maxWeightError, Math.abs(1 - sum));
}

const fieldQ = quantiles(field);
const worldQ = quantiles(worldHeight);
const regionQ = Object.fromEntries(PS_REGIONS.map((region) => {
  assert.ok(byRegion[region].length > 0, `${region} received no land samples`);
  return [region, quantiles(byRegion[region])];
})) as Record<PSRegion, Record<number, number>>;
const gradientQ = Object.fromEntries(PS_REGIONS.map((region) => [
  region,
  quantiles(gradientByRegion[region]),
])) as Record<PSRegion, Record<number, number>>;

const bareLo = percentile(field, WINDOW_PERCENTILES.bareMix[0]);
const bareHi = percentile(field, WINDOW_PERCENTILES.bareMix[1]);
const valleyLo = percentile(field, WINDOW_PERCENTILES.valleyShade[0]);
const valleyHi = percentile(field, WINDOW_PERCENTILES.valleyShade[1]);

const windowCoverage = (lo: number, hi: number): { zero: number; varying: number; one: number } => {
  let zero = 0, varying = 0, one = 0;
  for (const value of field) {
    if (value <= lo) zero++;
    else if (value >= hi) one++;
    else varying++;
  }
  return { zero: zero / field.length, varying: varying / field.length, one: one / field.length };
};

const bareCoverage = windowCoverage(bareLo, bareHi);
const valleyCoverage = windowCoverage(valleyLo, valleyHi);
const pct = (value: number): string => `${(100 * value).toFixed(3)}%`;
const span = (q: Record<number, number>): number => q[95]! - q[5]!;

console.log(`TERRAIN GATE — ${N.toLocaleString()} area-uniform sphere samples, seed ${SEED}`);
console.log(`land samples  : ${field.length.toLocaleString()} (${pct(field.length / N)})`);
console.log(`H field       : ${fmtQuantiles(fieldQ)}`);
console.log(`world height  : ${fmtQuantiles(worldQ)}  (coast gate * amplitude included)`);
console.log('H by argmax region (land only):');
for (const region of PS_REGIONS) {
  console.log(`  ${region.padEnd(9)} n=${byRegion[region].length.toString().padStart(6)}  ${fmtQuantiles(regionQ[region])}  p95-p5=${span(regionQ[region]).toFixed(6)}`);
}
console.log('local slope |grad H| per radian by argmax region:');
for (const region of PS_REGIONS) {
  console.log(`  ${region.padEnd(9)} p50=${gradientQ[region][50]!.toFixed(6)}  p95=${gradientQ[region][95]!.toFixed(6)}  p99=${gradientQ[region][99]!.toFixed(6)}`);
}
console.log('albedo smoothstep calibration (H field, land only):');
console.log(`  bareMix     [p55=${bareLo.toFixed(6)}, p90=${bareHi.toFixed(6)}]  zero=${pct(bareCoverage.zero)} varying=${pct(bareCoverage.varying)} one=${pct(bareCoverage.one)}`);
console.log(`  valleyShade [p10=${valleyLo.toFixed(6)}, p80=${valleyHi.toFixed(6)}]  zero=${pct(valleyCoverage.zero)} varying=${pct(valleyCoverage.varying)} one=${pct(valleyCoverage.one)}`);
console.log(`soft-weight max |sum-1|: ${maxWeightError.toExponential(3)}`);

// 绝对幅度下限。上面几条断言全是**相对**关系（高地比草原高、比草原陡），而相对
// 关系靠「把整个星球缩小」一样能满足——Stage 2 首版就是这么过的 gate：归一化 H
// 的分位排序全对，世界单位的起伏却从 3.104 掉到 1.227，星球平了 2.5 倍，肉眼一看
// 就不对而 gate 全绿。所以这里必须有一条量到**世界单位**的硬下限。
// 3.0 的来源：改动前那版地形实测的陆地 terrainHeight p99-p1 = 3.104，留一点余量。
const worldSpan = worldQ[99]! - worldQ[1]!;
console.log(`land terrainHeight span (world units, p1..p99): ${worldSpan.toFixed(3)}`);
assert.ok(worldSpan >= 3.0,
  `terrain is too flat: land height span ${worldSpan.toFixed(3)} < 3.0 world units. `
  + '提高 TERRAIN_PLAN.amplitude —— 相对分位排序对了不代表星球还有起伏。');

assert.ok(regionQ.highland[50]! > regionQ.grassland[50]!, 'highland median must exceed grassland median');
assert.ok(span(regionQ.highland) > span(regionQ.grassland), 'highland p5-p95 span must exceed grassland');
assert.ok(gradientQ.highland[50]! > gradientQ.grassland[50]!, 'highland median slope must exceed grassland');
assert.ok(bareCoverage.varying > 0.25, 'bareMix is effectively constant');
assert.ok(valleyCoverage.varying > 0.60, 'valleyShade is effectively constant');
assert.ok(maxWeightError < 1e-12, `soft weights do not normalise: ${maxWeightError}`);

const generated = `// Generated by \`bun tools/terrain-gate.ts --write\`. Do not hand-edit.
export const TERRAIN_ALBEDO_WINDOWS = {
  sampleCount: ${field.length},
  seed: ${SEED},
  bareMix: { lo: ${bareLo.toFixed(8)}, hi: ${bareHi.toFixed(8)}, loPercentile: 55, hiPercentile: 90 },
  valleyShade: { lo: ${valleyLo.toFixed(8)}, hi: ${valleyHi.toFixed(8)}, loPercentile: 10, hiPercentile: 80 },
} as const;
`;

if (process.argv.includes('--write')) {
  writeFileSync(new URL('../src/terrain-calibration.ts', import.meta.url), generated);
  console.log('WROTE src/terrain-calibration.ts');
} else {
  const epsilon = 5e-9;
  assert.equal(TERRAIN_ALBEDO_WINDOWS.sampleCount, field.length, 'calibration sample count is stale; run with --write');
  assert.equal(TERRAIN_ALBEDO_WINDOWS.seed, SEED, 'calibration seed is stale; run with --write');
  assert.ok(Math.abs(TERRAIN_ALBEDO_WINDOWS.bareMix.lo - bareLo) <= epsilon, 'bareMix.lo is stale; run with --write');
  assert.ok(Math.abs(TERRAIN_ALBEDO_WINDOWS.bareMix.hi - bareHi) <= epsilon, 'bareMix.hi is stale; run with --write');
  assert.ok(Math.abs(TERRAIN_ALBEDO_WINDOWS.valleyShade.lo - valleyLo) <= epsilon, 'valleyShade.lo is stale; run with --write');
  assert.ok(Math.abs(TERRAIN_ALBEDO_WINDOWS.valleyShade.hi - valleyHi) <= epsilon, 'valleyShade.hi is stale; run with --write');
  console.log('PASS: terrain ordering, roughness, soft weights, and calibration are current');
}
