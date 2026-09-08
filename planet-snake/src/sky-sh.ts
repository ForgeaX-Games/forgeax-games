// Spherical-harmonic irradiance solved from the same atmosphere the sky is
// drawn with.
//
// This is the term the audit called the whole aesthetic: the reference's look hangs
// on the ratio between a WARM direct sun and a COOL sky ambient, and it gets the
// cool half by projecting its own baked sky into 9 SH coefficients rather than
// by sampling an environment map (src/render/sky.js:288-342).
//
// We were still taking ambient from the stock Skylight, whose source is the
// HDRI photograph the background no longer shows. That is a near-neutral fill
// bearing no relation to the sky actually on screen, and it is what every
// desaturation fight in this project was really against: measured, raising
// Skylight 0.16 -> 0.42 took water saturation 0.46 -> 0.34 and land 0.27 -> 0.20.
// More of it is more grey, so no albedo value can win.
//
// the reference bakes a 64x32 sky, reads it back and reduces on the CPU. Ours never
// needs to reach the GPU at all: the same Nishita model is evaluated in TS over
// the same 64x32 lat-long grid, projected, and the nine coefficients are inlined
// into the grafted shader source as constants. No readback, no new bindings, and
// the ambient is recomputed only when the sun moves — which here is never.

const SH_W = 64;
const SH_H = 32;

// Same constants as src/space.wgsl — see the note there on why beta is flattened
// off Earth's Rayleigh ratio and why lengths are not scaled geometrically.
const H_R = 0.35;
const H_M = 0.0525;
const BETA_R: readonly [number, number, number] = [0.575, 0.7036, 0.7566];
const BETA_M = 0.48;
const MIE_G = 0.76;
const VIEW_STEPS = 10;
const LIGHT_STEPS = 5;

type V3 = [number, number, number];

const dot3 = (a: readonly number[], b: readonly number[]): number =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Both roots of |o + t*d|^2 = r^2; far < near signals a miss. */
function raySphere2(o: V3, d: V3, r: number): [number, number] {
  const b = dot3(o, d);
  const c = dot3(o, o) - r * r;
  const disc = b * b - c;
  if (disc < 0) return [1, -1];
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

const phaseR = (mu: number): number => (3 / (16 * Math.PI)) * (1 + mu * mu);

function phaseM(mu: number, g: number): number {
  const g2 = g * g;
  const n = (1 - g2) * (1 + mu * mu);
  const d = (2 + g2) * (1 + g2 - 2 * g * mu) ** 1.5;
  return (3 / (8 * Math.PI)) * (n / Math.max(d, 1e-4));
}

/**
 * Sky radiance along a ray leaving a point just above the surface. Mirrors
 * `atmosphere()` in space.wgsl; fewer steps because this is a one-off reduction
 * over 2048 samples and the result is convolved down to nine numbers anyway.
 */
function skyRadiance(dir: V3, sunDir: V3, rp: number, ra: number, sunI: number): V3 {
  const origin: V3 = [0, rp + H_R * 0.05, 0];
  // Rotate the frame so the observer's local up is +Y — the projection below
  // works in that frame, and the planet is a sphere so any point will do.
  const shell = raySphere2(origin, dir, ra);
  if (shell[1] <= 0) return [0, 0, 0];
  const solid = raySphere2(origin, dir, rp);
  let t1 = shell[1];
  if (solid[1] > 0 && solid[0] > 0) t1 = Math.min(t1, solid[0]);
  const t0 = Math.max(shell[0], 0);
  if (t1 <= t0) return [0, 0, 0];

  const mu = dot3(dir, sunDir);
  const pr = phaseR(mu);
  const pm = phaseM(mu, MIE_G);
  const seg = (t1 - t0) / VIEW_STEPS;
  let odR = 0;
  let odM = 0;
  const acc: V3 = [0, 0, 0];

  for (let i = 0; i < VIEW_STEPS; i++) {
    const t = t0 + seg * (i + 0.5);
    const p: V3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const h = Math.max(Math.hypot(p[0], p[1], p[2]) - rp, 0);
    const dR = Math.exp(-h / H_R) * seg;
    const dM = Math.exp(-h / H_M) * seg;
    odR += dR;
    odM += dM;

    const blocked = raySphere2(p, sunDir, rp);
    if (blocked[1] > 0 && blocked[0] > 0) continue;
    const toSun = raySphere2(p, sunDir, ra);
    const lseg = Math.max(toSun[1], 0) / LIGHT_STEPS;
    let lR = 0;
    let lM = 0;
    for (let j = 0; j < LIGHT_STEPS; j++) {
      const q = lseg * (j + 0.5);
      const lp: V3 = [p[0] + sunDir[0] * q, p[1] + sunDir[1] * q, p[2] + sunDir[2] * q];
      const lh = Math.max(Math.hypot(lp[0], lp[1], lp[2]) - rp, 0);
      lR += Math.exp(-lh / H_R) * lseg;
      lM += Math.exp(-lh / H_M) * lseg;
    }
    for (let c = 0; c < 3; c++) {
      const tau = BETA_R[c]! * (odR + lR) + BETA_M * 1.1 * (odM + lM);
      const att = Math.exp(-tau);
      acc[c] += att * (BETA_R[c]! * dR * pr + BETA_M * dM * pm);
    }
  }
  return [acc[0] * sunI, acc[1] * sunI, acc[2] * sunI];
}

/**
 * Nine SH coefficients (RGB each) of the sky's radiance, in the frame where the
 * observer's up is +Y. Projection follows sky.js:296-342 exactly, including the
 * `sinθ · (2π/W) · (π/H)` solid angle per texel.
 */
export function solveSkySh(
  sunDirWorld: readonly [number, number, number],
  planetRadius: number,
  atmosRadius: number,
  sunIntensity: number,
): number[][] {
  // The projection frame has up = +Y, so the sun has to come in expressed the
  // same way — only its elevation relative to up matters for the irradiance.
  const elev = dot3(sunDirWorld, [0, 1, 0]);
  const horiz = Math.sqrt(Math.max(0, 1 - elev * elev));
  const sunDir: V3 = [horiz, elev, 0];

  const sh: number[][] = Array.from({ length: 9 }, () => [0, 0, 0]);
  const dOmega = ((2 * Math.PI) / SH_W) * (Math.PI / SH_H);

  for (let y = 0; y < SH_H; y++) {
    const theta = ((y + 0.5) / SH_H) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const w = st * dOmega;
    for (let x = 0; x < SH_W; x++) {
      const phi = ((x + 0.5) / SH_W - 0.5) * 2 * Math.PI;
      const d: V3 = [st * Math.sin(phi), ct, st * Math.cos(phi)];
      const rad = skyRadiance(d, sunDir, planetRadius, atmosRadius, sunIntensity);

      const Y = [
        0.282095,
        0.488603 * d[1],
        0.488603 * d[2],
        0.488603 * d[0],
        1.092548 * d[0] * d[1],
        1.092548 * d[1] * d[2],
        0.315392 * (3 * d[2] * d[2] - 1),
        1.092548 * d[0] * d[2],
        0.546274 * (d[0] * d[0] - d[1] * d[1]),
      ];
      for (let c = 0; c < 9; c++) {
        sh[c]![0] += rad[0] * Y[c]! * w;
        sh[c]![1] += rad[1] * Y[c]! * w;
        sh[c]![2] += rad[2] * Y[c]! * w;
      }
    }
  }
  return sh;
}

/**
 * The Ramamoorthi & Hanrahan convolution, emitted as WGSL with the coefficients
 * baked in. Cheap enough that a cubemap lookup would only cost bandwidth, which
 * is the reason the reference uses it too.
 */
/** `normalVar` is the WGSL expression the SH lobes are evaluated against. It is
 *  a parameter because the night side needs a SMOOTHER normal than the shading
 *  one: sky irradiance is the ONLY light out there and it is looked up per
 *  normal, so a normal carrying the terrain's high-frequency bump turns the
 *  ambient itself into speckle. */
export function shIrradianceWgsl(sh: number[][], varName: string, normalVar = 'ps_N'): string {
  const v = (i: number): string =>
    `vec3<f32>(${sh[i]!.map((x) => x.toFixed(6)).join(', ')})`;
  return `
    // SH irradiance — Ramamoorthi & Hanrahan, coefficients solved on the CPU
    // from the same atmosphere the background is drawn with (src/sky-sh.ts).
    let ${varName} =
        ${v(0)} * 0.886227
      + ${v(1)} * (2.0 * 0.511664) * ${normalVar}.y
      + ${v(2)} * (2.0 * 0.511664) * ${normalVar}.z
      + ${v(3)} * (2.0 * 0.511664) * ${normalVar}.x
      + ${v(4)} * (2.0 * 0.429043) * ${normalVar}.x * ${normalVar}.y
      + ${v(5)} * (2.0 * 0.429043) * ${normalVar}.y * ${normalVar}.z
      + ${v(6)} * (0.743125 * ${normalVar}.z * ${normalVar}.z - 0.247708)
      + ${v(7)} * (2.0 * 0.429043) * ${normalVar}.x * ${normalVar}.z
      + ${v(8)} * 0.429043 * (${normalVar}.x * ${normalVar}.x - ${normalVar}.y * ${normalVar}.y);
`;
}
