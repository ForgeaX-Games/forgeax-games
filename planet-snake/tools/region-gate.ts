import assert from 'node:assert/strict';

import { fbm, relief, warpedField, type V3 } from '../src/surface';
import { regionAt, argmaxRegionOrOcean, type PSRegion } from '../src/regions';

const N = 200_000;
const SEED = 20260807;
const BASELINE = { iceCapLo: 5.0, iceCapHi: 7.0, land: 80.71, grass: 67.25, dry: 4.72 };

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
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  return [radial * Math.cos(phi), z, radial * Math.sin(phi)];
}

// FIXED 2026-08-07 (Opus 5, verifying Sol's output). The original local argmax
// here had two defects and they compounded:
//   1. no ocean check — over water all five weights are 0 (11.92% of the sphere
//      measured), and
//   2. `best` was seeded with 'iceCap' and only replaced on a STRICT >,
//      so every all-zero point silently voted iceCap.
// Result: iceCap read 16.35% instead of its true 3.17%. Use the module's own
// argmaxRegionOrOcean so the gate and the game classify identically — a second
// copy of a classification rule is the same defect class as a second copy of
// the noise.

const pct = (count: number, denominator = N): number => 100 * count / denominator;
const fmt = (value: number): string => `${value.toFixed(3)}%`;
const delta = (actual: number, baseline: number): string => `${actual >= baseline ? '+' : ''}${(actual - baseline).toFixed(3)}pp`;

const rng = mulberry32(SEED);
let land = 0;
let clearlyGrass = 0;
let clearlyDry = 0;
let ocean = 0;
let iceCapHalf = 0;   // Stage 1 冻结门；Stage 2 归一化后不再等于纬度带解析面积
const byRegion: Record<PSRegion, number> = {
  iceCap: 0,
  dry: 0,
  highland: 0,
  beach: 0,
  grassland: 0,
};
let reliefMin = Infinity;
let reliefMax = -Infinity;
let reliefSum = 0;

for (let i = 0; i < N; i++) {
  const p = sampleSphere(rng);
  const isLand = warpedField(p) > 0;
  if (isLand) {
    land++;
    const dryField = fbm(p[0] * 3.2 + 11, p[1] * 3.2 + 3, p[2] * 3.2 + 7);
    if (dryField <= 0.52) clearlyGrass++;
    if (dryField >= 0.66) clearlyDry++;
  }
  const w = regionAt(p);
  if (w.iceCap >= 0.5) iceCapHalf++;
  const a = argmaxRegionOrOcean(p);
  if (a === 'ocean') ocean++; else byRegion[a]++;

  const height = relief(p);
  reliefMin = Math.min(reliefMin, height);
  reliefMax = Math.max(reliefMax, height);
  reliefSum += height;
}

const iceCapPct = pct(iceCapHalf);          // 断言对象：iceCap>=0.5 的面积
const iceCapArgmaxPct = pct(byRegion.iceCap);
const landPct = pct(land);
const grassPct = pct(clearlyGrass, land);
const dryPct = pct(clearlyDry, land);

console.log(`REGION GATE — ${N.toLocaleString()} area-uniform sphere samples, seed ${SEED}`);
console.log(`iceCap>=0.5   : ${fmt(iceCapPct)}  gate [${BASELINE.iceCapLo.toFixed(1)}%, ${BASELINE.iceCapHi.toFixed(1)}%]  (归一化软权重)`);
console.log(`iceCap argmax : ${fmt(iceCapArgmaxPct)}  (print-only)`);
console.log(`ocean argmax  : ${fmt(pct(ocean))}`);
console.log(`land          : ${fmt(landPct)}  baseline ${BASELINE.land.toFixed(2)}%  delta ${delta(landPct, BASELINE.land)}`);
console.log(`land grass    : ${fmt(grassPct)}  baseline ${BASELINE.grass.toFixed(2)}%  delta ${delta(grassPct, BASELINE.grass)}`);
console.log(`land dry      : ${fmt(dryPct)}  baseline ${BASELINE.dry.toFixed(2)}%  delta ${delta(dryPct, BASELINE.dry)}`);
console.log('argmax area (print-only):');
console.log(`  beach ${fmt(pct(byRegion.beach))}  highland ${fmt(pct(byRegion.highland))}  grassland ${fmt(pct(byRegion.grassland))}`);
console.log(`terrain H     : min ${reliefMin.toFixed(6)}  max ${reliefMax.toFixed(6)}  mean ${(reliefSum / N).toFixed(6)}`);

assert.ok(iceCapPct >= BASELINE.iceCapLo && iceCapPct <= BASELINE.iceCapHi,
  `iceCap>=0.5 area ${fmt(iceCapPct)} is outside 5.0-7.0%`);
assert.ok(Math.abs(landPct - BASELINE.land) <= 0.5,
  `land delta ${delta(landPct, BASELINE.land)} exceeds ±0.5pp`);
assert.ok(Math.abs(grassPct - BASELINE.grass) <= 0.5,
  `land grass delta ${delta(grassPct, BASELINE.grass)} exceeds ±0.5pp`);
assert.ok(Math.abs(dryPct - BASELINE.dry) <= 0.5,
  `land dry delta ${delta(dryPct, BASELINE.dry)} exceeds ±0.5pp`);
console.log('PASS: all frozen calibration gates satisfied');
