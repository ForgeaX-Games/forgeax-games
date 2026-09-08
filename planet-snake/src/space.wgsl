// Space background — replaces the photographic HDRI skybox.
//
// Why a post pass and not a skybox material: a fullscreen post effect is handed
// `sceneTexture` + `depthTexture`, and a depth of ~1.0 means "nothing was drawn
// here". That is exactly the background mask, so the whole far field can be
// synthesised here without touching the scene graph. It also puts the limb halo
// (added in a later pass) on the correct side of the planet silhouette for free.
//
// The reference footage has a near-black navy base, a broad low-frequency nebula
// band, and stars in several apparent size classes. An HDRI photograph cannot be
// used for this: its average luminance destroys the contrast the rim glow and
// bloom need in order to read at all.
//
// Ray reconstruction takes the camera basis rather than an inverse view-proj
// matrix — the game already computes that basis when it aims the camera, so this
// avoids shipping a matrix inverse into the params block.

struct FullscreenOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

struct SpaceParams {
  right    : vec4<f32>,   // xyz = camera right,   w = tan(fovY * 0.5)
  up       : vec4<f32>,   // xyz = camera up,      w = aspect
  forward  : vec4<f32>,   // xyz = camera forward, w = time (seconds)
  sun      : vec4<f32>,   // xyz = direction TO the sun, w = sun intensity
  cam      : vec4<f32>,   // xyz = camera position, w = planet radius
  shell    : vec4<f32>,   // x = atmosphere radius, y = near, z = far, w = water lift
  // Where the live water sheet is. x = unused, y = cos(0.94 * half), z =
  // cos(0.66 * half), w = unused... no: xyz would be the anchor. Kept as two
  // vec4s below instead.
  // NOT called `patch` — that is a reserved keyword in this shader language and
  // the composer rejects the whole file for it.
  sheet    : vec4<f32>,   // xyz = anchor (unit dir), w = cos(half)
  sheetFade: vec4<f32>,   // xy = sheet fade, z = eclipse 0..1, w = sun elevation
  eclipseAnchor: vec4<f32>, // xyz = TS-computed clamped eclipse centre
  // What the skills have pushed the sea into: 4 dents, two vec4s each.
  //   a: xyz = centre (unit dir), w = radius (world units)
  //   b: x = depth, y = rim, z = drive 0..1, w = unused
  dents    : array<vec4<f32>, 8>,
  // The wake: N x (xyz = world-space surface position, w = normalised age,
  // 0 at the head). Water normalises xyz; land keeps its radius so nearby
  // terrain at a different elevation cannot receive the trail.
  wake     : array<vec4<f32>, 16>,
};

/// Displacement of the live water sheet at a direction, world units.
///
/// THE SAME PROFILE src/water-patch.ts USES ON ITS VERTICES, duplicated because
/// this pass cannot see them. It is needed for two separate reasons and both
/// were failures before it existed:
///
///   the PAINTED SEA  is drawn on the planet sphere at a fixed radius. A hole
///                    in the sheet deeper than the 0.118 units of clearance
///                    would sink through it and show the paint inside the
///                    crater — which is what capped every dent this game could
///                    make at a tenth of a snake's width.
///   the WINDOW       that decides which pixels are sea at all is 0.30 wide
///                    around the sheet's rest height. A rim standing a unit
///                    proud falls out of it and loses its glints, its foam and
///                    its swell — the most expensive possible way to draw a
///                    highlight.
///
/// Returns (displacement, depression) — the second is how far DOWN, which is
/// what the painted sea has to follow.
fn waterDent(n : vec3<f32>) -> vec2<f32> {
  // GATED BY THE SHEET'S FOOTPRINT, and this is not a refinement.
  //
  // The sheet is a patch about eight units across that follows the snake;
  // outside it the sea is only the paint on the planet sphere, and that surface
  // has not moved. Lowering the paint radius out there means the actual
  // geometry no longer matches the radius the pass expects, the window closes,
  // and the sea stops being drawn at all — measured as a torn black wedge on
  // the far side of a dent whose rim reached past the patch edge.
  //
  // Faded rather than cut, so there is no step where the authority changes
  // hands.
  // THE SAME CURVE src/water-patch.ts fades its vertices by. sheet.w is the
  // cosine of the patch's half-extent; these two multipliers are the 0.94 and
  // 0.66 of that half-angle it uses, written as cosines of the same fractions.
  let inPatch = smoothstep(params.sheetFade.x, params.sheetFade.y, dot(n, params.sheet.xyz));
  if (inPatch <= 0.002) { return vec2<f32>(0.0, 0.0); }
  var disp = 0.0;
  var down = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let a = params.dents[i * 2];
    let b = params.dents[i * 2 + 1];
    if (b.z <= 0.002 || a.w <= 0.001) { continue; }
    let q = acos(clamp(dot(n, a.xyz), -1.0, 1.0)) * params.cam.w / a.w;
    if (q > 2.6) { continue; }
    // Flat floor, fast shoulder — the same profile src/water-patch.ts puts on
    // its vertices, and it has to stay the same one.
    let hole = select(0.0, (1.0 - q * q * q) * b.x, q < 1.0);
    let rq = (q - 1.25) / 0.5;
    let rim = exp(-rq * rq) * b.y;
    disp = disp + (rim - hole) * b.z;
    down = down + hole * b.z;
  }
  return vec2<f32>(disp, down) * inPatch;
}

// ── atmosphere ───────────────────────────────────────────────────────────────
//
// atmosphere.wgsl but re-parameterised for an observer OUTSIDE a small planet.
// Three changes were mandatory:
//
//  1. `origin` was hard-coded to vec3f(0, EARTH_R + 800, 0) — a ground observer,
//     which makes the sky a function of view direction alone. Here the camera
//     sits at |C| = 33.6 and each ray's chord through the shell depends on its
//     impact parameter, not its direction; two rays with the same direction from
//     different camera positions cut different chords.
//
//  2. `raySphereFar` returns only the far root because the origin is always
//     inside. From outside that silently skips the entry point and marches from
//     the camera through vacuum, so the shell is never sampled.
//
//  3. Lengths are NOT scaled geometrically. Faithful scaling of Earth's
//     6360/6420 km to radius 26 gives a shell 0.245 units thick, whose projected
//     width here is 0.67 degrees — about 10 px, where the measured reference
//     halos are 62-150 px. Instead H_R is chosen from the reference halo width
//     and beta follows from `beta_new = beta_old * (H_old / H_new)`, which keeps
//     beta*H — the vertical optical depth, the model's actual look constant —
//     invariant while letting the grazing depth follow from the new geometry.
//
// The reference behaviour this has to reproduce, measured per frame: f00 (sun
// behind the planet) peaks OUTSIDE the solid limb at +25 px, 3.5x the disc, and
// nearly achromatic; f03 peaks at +10 px and is distinctly blue-cyan; f04 (sun
// in front) has NO local maximum outside the limb at all — the halo must be able
// to vanish completely. That whole range is one function: the Mie phase swings
// 394x between mu=+1 and mu=-1.

// Shell thinned 5.25 -> 2.6 world units on 2026-08-03. At 5.25 the atmosphere
// was 20% of the planet radius (Earth's is ~1.5%) and the limb rendered as a
// thick white ring pasted around the disc rather than as the reference's thin
// bright edge. Optical depth is held constant through beta_new = beta_old *
// (H_old/H_new), so the hue that was fitted to the reference limb survives the
// change and only the THICKNESS moves.
const H_R : f32 = 0.35;
const H_M : f32 = 0.0525;
// Earth's Rayleigh coefficients are extremely blue-selective (R:G:B =
// 0.175:0.41:1.0), and ported verbatim they lay a heavy blue wash over the whole
// disc — from space that is physically what a real atmosphere does, but it is
// not what the reference shows. Its limb samples (0.396,0.481,0.520) in f03,
// i.e. 0.76:0.93:1.0 — barely blue-biased at all. Flattening beta to the
// measured ratio keeps the blue magnitude (so the grazing path still extinguishes
// blue first and the backlit limb core still goes warm-white, which f00 has) while
// removing the wash. This is an art-direction departure from the physics, taken
// deliberately because the target is the reference, not Earth.
const BETA_R : vec3<f32> = vec3<f32>(0.5750, 0.7036, 0.7566);
const BETA_M : f32 = 0.48;
/// Isotropic multiple-scattering amplitude, as a fraction of the single-scatter
/// coefficient. See the note at its use site for why it is bounded this way.
const MS_ISO : f32 = 0.035;
/// How much of the physical extinction is actually applied to the background.
const EXTINCTION : f32 = 0.38;
const MIE_G : f32 = 0.76;
// An isotropic multiple-scattering term was tried here and removed. Written as
// BETA_R * density * MS_BOOST/(4*PI) it carries NO phase weighting, so it lands
// the same amount of light on every pixel regardless of geometry — its blue
// contribution came out around 0.69, larger than the single-scattering term it
// was meant to supplement, and it turned the whole disc into a milky wash. The
// night-side floor on the terrain materials already covers what it was there
// for (keeping the unlit hemisphere off pure black).
const VIEW_STEPS : i32 = 16;
const LIGHT_STEPS : i32 = 8;

/// Both roots of |o + t*d|^2 = r^2. Returns (tNear, tFar); tFar < tNear signals
/// a miss. Unlike the original's far-root-only helper this is valid from outside.
fn raySphere2(o : vec3<f32>, d : vec3<f32>, r : f32) -> vec2<f32> {
  let b = dot(o, d);
  let c = dot(o, o) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2<f32>(1.0, -1.0); }
  let s = sqrt(disc);
  return vec2<f32>(-b - s, -b + s);
}

fn phaseRayleigh(mu : f32) -> f32 {
  // ASYMMETRIC, as an art decision, and the same kind of decision as flattening
  // BETA above. Rayleigh's phase is symmetric in mu, so the backscatter lobe
  // keeps full amplitude — and once BETA went near-neutral that lobe became a
  // bright NEUTRAL band on the anti-sun side, while Mie correctly died there.
  // Measured across the capture set, the halo was brightest where the sun was
  // not, which is the opposite of the reference. mu is +1 looking at the sun.
  let backlit = mix(0.08, 1.0, smoothstep(-0.2, 0.35, mu));
  return (3.0 / (16.0 * 3.14159265359)) * (1.0 + mu * mu) * backlit;
}

fn phaseMie(mu : f32, g : f32) -> f32 {
  let g2 = g * g;
  let n = (1.0 - g2) * (1.0 + mu * mu);
  let dd = (2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
  return (3.0 / (8.0 * 3.14159265359)) * n / dd;
}

/// Inscattered radiance along [tStart,tEnd], plus the transmittance the scene
/// behind it is attenuated by. `.rgb` = inscatter, `.a` = mean transmittance.
fn atmosphere(o : vec3<f32>, d : vec3<f32>, tStart : f32, tEnd : f32,
              sunDir : vec3<f32>, sunI : f32, rp : f32, ra : f32,
              msScale : f32) -> vec4<f32> {
  if (tEnd <= tStart) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let mu = dot(d, sunDir);
  let pr = phaseRayleigh(mu);
  let pm = phaseMie(mu, MIE_G);

  let seg = (tEnd - tStart) / f32(VIEW_STEPS);
  var odR = 0.0;
  var odM = 0.0;
  var acc = vec3<f32>(0.0);
  var ms = vec3<f32>(0.0);

  for (var i = 0; i < VIEW_STEPS; i = i + 1) {
    let t = tStart + seg * (f32(i) + 0.5);
    let p = o + d * t;
    // h is clamped at zero. A sample that lands BELOW the surface makes h
    // negative, and exp(-h/0.35) then overflows to +Inf; the very next line
    // multiplies it by att, which is exp(-Inf) = 0, and 0 * Inf is NaN. The
    // three channels carry different BETA_R, so the NaN reaches the framebuffer
    // as saturated red / blue / magenta / cyan blobs hugging the silhouette —
    // the "blocky RGB corruption" this project opened with, and the reason bloom
    // and the tonemap were both falsified as causes: it is produced HERE, in the
    // atmosphere integral, after everything else has drawn. There is no air
    // below the ground, so clamping is also the physically correct thing to do.
    let h = max(length(p) - rp, 0.0);
    let dR = exp(-h / H_R) * seg;
    let dM = exp(-h / H_M) * seg;
    odR += dR;
    odM += dM;

    // Light ray. A sample whose path to the sun re-enters the planet is in the
    // planet's own shadow and contributes nothing — this is what carves the
    // terminator into the halo instead of ringing the whole disc evenly.
    let toSun = raySphere2(p, sunDir, ra);
    let blocked = raySphere2(p, sunDir, rp);
    if (blocked.y > 0.0 && blocked.x > 0.0) { continue; }

    let lseg = max(toSun.y, 0.0) / f32(LIGHT_STEPS);
    var lR = 0.0;
    var lM = 0.0;
    for (var j = 0; j < LIGHT_STEPS; j = j + 1) {
      let lp = p + sunDir * (lseg * (f32(j) + 0.5));
      let lh = max(length(lp) - rp, 0.0);
      lR += exp(-lh / H_R) * lseg;
      lM += exp(-lh / H_M) * lseg;
    }

    let tau = BETA_R * (odR + lR) + vec3<f32>(BETA_M) * 1.1 * (odM + lM);
    let att = exp(-tau);
    acc += att * (BETA_R * dR * pr + vec3<f32>(BETA_M) * dM * pm);

    // Multiple scattering, isotropic.
    //
    // At grazing angles the optical depth reaches ~4, so the shell is opaque and
    // the background behind it is fully extinguished. Single scattering alone
    // then leaves a BLACK BAND wherever the phase functions are weak, which is
    // most of the limb away from the sun — and the reference has no black band
    // at any angle. Real air does not either: the second and later bounces are
    // what light a twilight sky.
    //
    // A previous attempt at this term washed the whole disc white. Two things
    // were wrong with it and are fixed here: it had no attenuation factor, so
    // it grew without bound along the ray, and its amplitude exceeded single
    // scattering outright. This one is carried by the same `att` the single
    // scattering uses — so it dies in the planet's shadow exactly as the direct
    // term does — and is capped at a fraction of it.
    ms += att * (BETA_R * dR + vec3<f32>(BETA_M) * dM) * (MS_ISO * msScale);
  }

  // Extinction floor. Physically the grazing shell is opaque; as ART it must not
  // be, because the reference shows the nebula through it. Halving the extinction
  // keeps the limb reading as air rather than as a hole cut in the starfield.
  // Bounded. acc/ms are per-channel sums whose coefficients differ per channel
  // (BETA_R is (0.575,0.704,0.757)), so any overflow here does not blow up to
  // white — it blows up to a DIFFERENT value per channel, which reaches the
  // framebuffer as a hue sweep across whatever object is in front of it. Clamping
  // is a guard, not a root-cause fix: the intermittent limb artefact this is
  // aimed at grew within a single page load and could not be reproduced from a
  // fixed state, so it has not been isolated.
  acc = clamp(acc, vec3<f32>(0.0), vec3<f32>(24.0));
  ms = clamp(ms, vec3<f32>(0.0), vec3<f32>(24.0));
  let trans = exp(-(BETA_R * odR + vec3<f32>(BETA_M) * odM));
  let softened = mix(vec3<f32>(1.0), trans, EXTINCTION);
  return vec4<f32>((acc + ms) * sunI, dot(softened, vec3<f32>(0.3333)));
}

@vertex
fn vs_main(@builtin(vertex_index) i : u32) -> FullscreenOutput {
  var x : f32 = -1.0;
  var y : f32 = -1.0;
  if (i == 1u) { x = 3.0; }
  if (i == 2u) { y = 3.0; }
  var out : FullscreenOutput;
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return out;
}

@group(1) @binding(0) var sceneTexture : texture_2d<f32>;
@group(1) @binding(1) var sceneSampler : sampler;
@group(1) @binding(2) var<uniform> params : SpaceParams;
@group(1) @binding(3) var depthTexture : texture_depth_2d;
@group(1) @binding(4) var depthSampler : sampler;

// ── surface field, injected at registration ─────────────────────────────────
//
// STUBS. The vite shader plugin validates this file with naga_oil at BUILD
// time, so every identifier the file uses must already exist here; space.ts
// then swaps this whole block for the real emitters out of src/surface.ts.
// Splicing against a bare `// @@MARKER@@` comment does NOT work — the build
// validation fails first with "no definition in scope for identifier".
//
// The one definition of the coastline stays in surface.ts. A second copy here
// would drift from the coast the surface material paints, which is the class of
// bug that once planted props on painted water.
// @@SURFACE_BEGIN@@
fn ps_hash(g : vec3<f32>) -> f32 {
  return fract(sin(dot(g, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
}
fn ps_vnoise(x : vec3<f32>) -> f32 { return ps_hash(floor(x)); }
fn ps_fbm(x : vec3<f32>) -> f32 { return ps_vnoise(x); }
fn ps_landField(p : vec3<f32>) -> f32 { return -1.0; }
// @@SURFACE_END@@

/// The wake as a distance field on the sphere.
///
/// Reference frames (reference/frames/snake/f06, f09) show ONE broad soft-edged
/// white mass many body-widths across, with a finer combed texture trailing
/// behind it and no straight edge anywhere. Three swept ribbons cannot read like
/// that however they are tuned — a mesh has a silhouette and a field does not —
/// so this replaces them: every water pixel measures its angular distance to the
/// recent trail and the foam falls out of that.
///
/// This is also the shape of the reference's own deformation buffer: a field the
/// surface queries, rather than a mesh laid over it.
fn wakeField(n : vec3<f32>, t : f32, spreadScale : f32, rp : f32, wave : f32) -> vec3<f32> {
  // x = coverage, y = age at the nearest point, z = distance from the centre
  // line normalised by the local half-width. z is what lets the land reading
  // build a PROFILE across the furrow (groove in the middle, berm outside)
  // instead of one flat value.
  // Distance to the trail's SEGMENTS, not to its samples — point distance makes
  // the wake a string of beads. Distance keeps the exact minimum so width stays
  // metric; AGE alone is blended with exp(-40 d), preventing sharp-turn spokes
  // without letting the number of nearby segments inflate the field.
  var acc = 0.0;
  var accAge = 0.0;
  var best = 9.0;
  for (var i = 0; i < 15; i = i + 1) {
    let a = params.wake[i];
    let b = params.wake[i + 1];
    if (a.w > 1.5 || b.w > 1.5) { continue; }
    let ad = normalize(a.xyz);
    let bd = normalize(b.xyz);
    let ab = bd - ad;
    let den = max(dot(ab, ab), 1e-8);
    let u = clamp(dot(n - ad, ab) / den, 0.0, 1.0);
    let q = normalize(ad + ab * u);
    let d = length(n - q);
    let w = exp(-d * 40.0);
    best = min(best, d);
    acc = acc + w;
    accAge = accAge + w * mix(a.w, b.w, u);
  }
  // Keep distance exact and blend only age. `-log(sum(exp(-k*d))) / k` is not
  // a distance unless the sum is normalised: several nearby segments make it
  // negative and expand the visible wake by multiple world units. Exact minimum
  // distance is continuous; weighted age retains the smooth segment hand-off.
  if (acc < 4e-11) { return vec3<f32>(0.0, 1.0, 9.0); }
  let bestAge = clamp(accAge / acc, 0.0, 1.0);

  // `wave` scallops the edge. On LAND a furrow has two straight parallel walls,
  // so it stays 0 there; on WATER the boundary is a set of waves peeling off the
  // hull, and a smooth oval edge is the one thing water never has. The phase
  // drifts with time so the scallops travel outward instead of sitting still.
  // Lower frequency and softened, then broken up by noise. A pure high-frequency
  // sine on a smooth parameter gives regular sawtooth teeth, which reads as a
  // gear rather than as water.
  let scallop = 1.0 + wave * (0.08 * sin(bestAge * 31.0 + t * 1.4)
                            + 0.07 * (ps_fbm(n * 26.0 + vec3<f32>(0.0, t * 0.09, 0.0)) - 0.5) * 2.0);
  // Half-width in WORLD UNITS (divided by rp, so it does not change with the
  // planet's size). The 1.24-unit-wide body starts a matching 1.24-unit wake;
  // the oldest visible foam opens gently to 1.68 units. Edge variation is kept
  // below 15%, so it roughens the silhouette without turning it into a halo.
  let spread = ((0.62 + 0.22 * bestAge) / rp) * spreadScale * scallop;
  // No discernible boundary in the reference at all, so the falloff is wider
  // than the core and starts almost at the centre line.
  var cov = 1.0 - smoothstep(spread * 0.15, spread, best);
  // Lobe the outline with drifting noise so the mass is organic rather than a
  // swept tube's silhouette. TWO octaves multiplied, the reference's foam form
  // (`foam * (0.35 + 1.5 * fn2 * (0.5 + 0.7 * fn3))`): the coarse one lobes the
  // outline, the fine one BOILS inside it, and because they drift on different
  // headings at different speeds the froth churns instead of sliding past as
  // one printed sheet. Only the water reads coverage — the land trail keys off
  // z and age — so the land furrow is untouched by this.
  // fr3 at 24/rad put a value-noise cell at 1.5 world units — and where the
  // product bottomed out, the clamp floor cut flat-bottomed holes the SIZE AND
  // SHAPE of those cells: dark square slabs floating in the froth (the exact
  // "flat axis-aligned squares" failure surface.ts documents for high-frequency
  // value noise). Lower frequency, higher floor: the holes stay — the reference
  // wake has them — but as soft dips, not stamped plates.
  let fr2 = ps_fbm(n * 9.0 + vec3<f32>(t * 0.11, t * 0.05, 0.0));
  let fr3 = ps_fbm(n * 16.0 - vec3<f32>(0.0, t * 0.14, t * 0.08));
  cov = cov * clamp(0.45 + 1.35 * fr2 * (0.5 + 0.7 * fr3), 0.0, 1.30);
  // Full strength through the first half, then rounded off — that is what makes
  // it read as a MASS with two rounded ends. A power curve tapers from the very
  // start and reads as a long wedge however it is tuned.
  cov = cov * smoothstep(1.0, 0.45, bestAge);
  return vec3<f32>(clamp(cov, 0.0, 1.0), bestAge, best / max(spread, 1e-5));
}

/// Land reads the same trail in WORLD SPACE. Using only unit directions makes
/// a valley point and a neighbouring ridge point look close even when their
/// rendered surfaces are over a body radius apart; the dark trail then appears
/// through the slope and through geometry standing above it.
///
/// x = radial gap from the recorded ground, y = age, z = distance / half-width.
fn landWakeField(wp : vec3<f32>, rp : f32) -> vec3<f32> {
  var acc = 0.0;
  var accAge = 0.0;
  var best = 9e9;
  var bestRadius = 0.0;
  let blendScale = 40.0 / rp;
  for (var i = 0; i < 15; i = i + 1) {
    let a = params.wake[i];
    let b = params.wake[i + 1];
    if (a.w > 1.5 || b.w > 1.5) { continue; }
    let ab = b.xyz - a.xyz;
    let den = max(dot(ab, ab), 1e-8);
    let u = clamp(dot(wp - a.xyz, ab) / den, 0.0, 1.0);
    let q = a.xyz + ab * u;
    let d = length(wp - q);
    let w = exp(-d * blendScale);
    if (d < best) {
      best = d;
      bestRadius = length(q);
    }
    acc = acc + w;
    accAge = accAge + w * mix(a.w, b.w, u);
  }
  if (acc < 4e-11) { return vec3<f32>(9.0, 1.0, 9.0); }
  let bestAge = clamp(accAge / acc, 0.0, 1.0);
  // Full profile (groove plus pale shoulder) stays within 0.94..1.12 world
  // units: slightly narrower than the 1.24-unit body that made it. The previous
  // 0.47..0.85 half-width let the shoulder reach nearly two units across and
  // visually merged with the body's ordinary cast shadow.
  let spread = 0.42 + 0.08 * bestAge;
  let radialGap = abs(length(wp) - bestRadius);
  return vec3<f32>(radialGap, bestAge, best / max(spread, 1e-5));
}

/// The land trail: ground the snake has just pushed through, darkened.
///
/// Same field as the wake, different reading. The reference (f03) shows a soft
/// dark smudge following the body — no trench, no raised shoulders, and no edge
/// anywhere. The two swept ribbons this replaces (a dark groove plus brighter
/// berms) had all three, because a mesh has a silhouette and a field does not.
///
/// Returns how much to darken, 0..1.
fn landTrail(wp : vec3<f32>, t : f32, rp : f32) -> f32 {
  let r = length(wp);
  // Gross reject only. The recorded trail radius below performs the precise
  // ground-layer test; this band merely skips sky/remote geometry without
  // dropping the tallest authored highlands.
  if (r < rp - 0.2 || r > rp + 3.2) { return 0.0; }
  let n = wp / max(r, 1e-4);
  let dry = smoothstep(-0.004, 0.030, ps_landField(n));
  if (dry <= 0.002) { return 0.0; }
  // Narrower than the wake: a body-width furrow, not a spreading foam mass.
  let wk = landWakeField(wp, rp);
  // Trail samples are dense near the head and coarser at the faded tail. This
  // tolerance covers >99% of the mesh's interpolation deviation while rejecting
  // the snake body and adjacent terrain layers.
  if (wk.x > mix(0.24, 0.32, wk.y)) { return 0.0; }
  if (wk.z > 1.15) { return 0.0; }

  // A PROFILE across the furrow, which is what the reference actually shows
  // (reference frame f08): a dark groove down the middle with a pale
  // RAISED berm either side, and a fine comb running across both. One flat
  // darkening had none of that and read as a smudge.
  //
  // Nothing is displaced — the terrain mesh is static. The berm is a light band
  // where a raised shoulder would catch the sun, which at this camera distance
  // is most of what a berm looks like anyway.
  let groove = 1.0 - smoothstep(0.0, 0.62, wk.z);
  let berm = smoothstep(0.42, 0.74, wk.z) * (1.0 - smoothstep(0.86, 1.12, wk.z));
  // The comb cuts ACROSS the trail — it is keyed to the ALONG-path parameter, so
  // the ridges run perpendicular to travel like a ploughed track.
  //
  // MUCH weaker and finer than the first attempt. At 260 cycles and 0.30 depth
  // it rendered as a row of hard horizontal bars stuck to the snake's tail — a
  // caterpillar-track decal, not a texture. It also fades IN with age, so the
  // ground right behind the head is smooth and the pattern only emerges further
  // back, which is the order the reference shows too.
  let comb = 0.5 + 0.5 * sin(wk.y * 620.0);
  let combFade = smoothstep(0.10, 0.45, wk.y);
  let age = smoothstep(1.0, 0.25, wk.y);
  // Positive darkens, negative brightens — see the call site.
  return (groove * (0.34 + 0.08 * comb * combFade)
        - berm * (0.10 + 0.06 * comb * combFade)) * dry * age;
}

/// Animated ocean, done HERE and not in the surface material.
///
/// The forward pass has no clock. The view uniform carries worldViewProj, the
/// light, the cascades — and no time (checked against the composed source, not
/// assumed), and there is no updateMaterial to push one through per frame. So
/// everything the water material draws is a pure function of world position and
/// the sea renders as a frozen texture however it is tinted. That is the whole
/// of "the water is not alive".
///
/// This pass does have a clock (params.forward.w) and it has depth, so it can
/// reconstruct where every scene pixel is and put the motion back from outside.
/// It costs one extra term on pixels that are already being shaded.
/// Animated wave HEIGHT on the sphere. This exists so the sea can have a moving
/// NORMAL, which is the one thing the forward pass structurally cannot give it:
/// ps_waves in surface.ts perturbs the water normal too, but takes only position
/// — no clock reaches that pass — so those crests are frozen solid.
///
/// Why a frozen normal is not a cosmetic problem: with the sea shaded off an
/// essentially smooth sphere normal, the sun's mirror lobe is ONE large coherent
/// region, so the glint can only ever be a single big blob that slides about. It
/// was blowing out to pure white for exactly that reason, and rougher/dimmer only
/// traded the blowout for a deader sheet. Real water scatters the same energy
/// across thousands of separate crests, and it is the MOTION of those crests that
/// reads as alive.
///
/// Directional trains, not drifting fbm. A plane wave along a heading is
/// `sin(dot(n, heading) * k - t * w)`: advancing the phase with t makes the
/// crests TRAVEL. Translating an fbm by t instead slides the whole field past
/// like a conveyor belt, which is what the shimmer term below used to do.
fn psWaveH(n : vec3<f32>, t : f32) -> f32 {
  let d1 = vec3<f32>(0.31, 0.12, -0.94);
  let d2 = vec3<f32>(-0.77, 0.35, 0.53);
  let d3 = vec3<f32>(0.62, -0.20, 0.75);
  // 130/95/62 per radian is a crest every 1.7 / 2.4 / 3.6 world units at this
  // radius. Deliberately below the 220 that surface.ts records as aliasing into
  // "corduroy" — the sparkle here gets its fineness from a NARROW SPECULAR LOBE,
  // not from cranking the field, which is the alias-safe way to buy the same
  // density.
  let a = sin(dot(n, d1) * 130.0 - t * 1.90);
  let b = sin(dot(n, d2) * 95.0 - t * 1.45);
  let c = sin(dot(n, d3) * 62.0 - t * 1.05);
  // Breaks the regularity, and it is doing more work than "not a woven grid".
  // Three pure sines give a SMOOTH normal field, so a narrow specular lobe
  // sweeps across it in continuous bands — the glint came out as streaks. Real
  // glitter needs the normal broken up so the lobe is satisfied at scattered
  // points instead of along curves. Two octaves, the finer one kept under the
  // 0.62-world-unit cell where value noise starts aliasing into flat squares.
  // Detail CUT HARD (0.55 -> 0.22) and the 44-per-radian octave dropped
  // outright. Both were added when this pass was the only thing giving the sea
  // any structure; the water patch now carries real geometric waves, so these
  // stopped breaking up a bare sine field and started laying a SECOND
  // independent ripple field on top of a real one. Measured on open water, the
  // post pass was the dominant source of the fine mottle (hi-freq 1.76 with it,
  // 1.50 without) — two stacked normal fields at similar frequencies, which is
  // what "too much noise, tiring to look at" is made of.
  let detail = (ps_fbm(n * 22.0 + d1 * (t * 0.22)) - 0.5) * 2.0;
  return a * 0.34 + b * 0.30 + c * 0.22 + detail * 0.22;
}

/// Perturbed water normal: central differences of psWaveH in the tangent plane.
/// Tangent frame from the least-aligned axis, same construction as ps_surface,
/// so there is no pole degeneracy.
fn psWaveNormal(n : vec3<f32>, t : f32) -> vec3<f32> {
  let ax = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9);
  let t1 = normalize(cross(n, ax));
  let t2 = cross(n, t1);
  let e = 0.0009;
  let hu = psWaveH(normalize(n + t1 * e), t) - psWaveH(normalize(n - t1 * e), t);
  let hv = psWaveH(normalize(n + t2 * e), t) - psWaveH(normalize(n - t2 * e), t);
  let g = (t1 * hu + t2 * hv) / (2.0 * e);
  // g runs to ~130 (unit amplitude at 130 per radian), so this scale puts a crest
  // face near 16 degrees off vertical. Below this the normals stay bunched around
  // the sphere's and too few crests ever satisfy the lobe to read as glitter.
  return normalize(n - g * 0.0021);
}

/// machinery (world-space cells, one jittered round disc per cell, partial
/// occupancy, footprint fade), with the FIRING CONDITION adapted.
///
/// Their facet model tilts a micro-facet 0.10-0.36 rad off the normal and asks
/// pow(dot(facet, H), 780) — physically honest, and correct for their camera,
/// which grazes the field. Measured on OURS (top-down at a sphere, directional
/// sun), H swings with the view ray fast enough that the annulus where any
/// facet can align contracts to a ring 15-50 PIXELS wide around the mirror
/// point: about 25 cells, expected hits under one per frame. Two dye passes
/// showed exactly zero. Physical alignment from this camera can only ever
/// restate the GGX blob.
///
/// So the facet is replaced by an ENVELOPE around the sun's mirror direction
/// (pow(dot(n, H), width)): each cell still owns a disc, a brightness and a
/// BLINK phase, but eligibility comes from sitting inside the sun path, which
/// is where sparkle lives when you look DOWN at real water. Cells stay nailed
/// to the (drifting) world grid, so the sparkles ride the current instead of
/// crawling with the camera.
fn glintOctave3(p : vec3<f32>, cell : f32, env : f32, t : f32) -> f32 {
  let id = floor(p / cell);
  let r  = vec3<f32>(ps_hash(id), ps_hash(id + vec3<f32>(19.0, 7.0, 3.0)),
                     ps_hash(id + vec3<f32>(41.0, 13.0, 29.0)));
  let r2 = vec3<f32>(ps_hash(id + vec3<f32>(5.0, 37.0, 11.0)),
                     ps_hash(id + vec3<f32>(23.0, 3.0, 17.0)),
                     ps_hash(id + vec3<f32>(53.0, 47.0, 7.0)));
  // Occupancy: which cells hold a crystal at all.
  if (r2.x > 0.55) { return 0.0; }

  let centre = (id + 0.5 + (r - 0.5) * 0.72) * cell;
  let d = length(p - centre) / (cell * 0.19);
  let disc = clamp(1.0 - d * d, 0.0, 1.0);
  if (disc <= 0.0) { return 0.0; }

  // Sharp-attack blink, on ~1/3 of the time — a crest tips through the mirror
  // condition and back. A sparkle that never blinks reads as embedded grit.
  let blink = smoothstep(0.35, 0.85, 0.5 + 0.5 * sin(t * (1.1 + r2.z * 3.1) + r.z * 6.28318530718));
  // Per-cell brightness spread, so the field is salt, not confetti.
  let bright = 0.35 + 0.65 * r2.y * r2.y;
  return disc * blink * bright * env;
}

/// Full glint response — the reference's snowGlints shape (two octaves, footprint
/// fades, matte-when-overhead bias) around the envelope firing model above.
fn waterGlints(wp : vec3<f32>, n : vec3<f32>, dir : vec3<f32>, sun : vec3<f32>,
               t : f32, dist : f32, foam : f32) -> f32 {
  let V = -dir;
  let NdotV = clamp(dot(n, V), 0.0, 1.0);
  let NdotL = clamp(dot(n, sun), 0.0, 1.0);
  if (NdotL <= 0.02) { return 0.0; }

  // The sun-path envelope: wide enough to read as a FIELD of sparkles around
  // the glare rather than restating it, tight enough to stay a path.
  let H = normalize(V + sun);
  var env = pow(clamp(dot(n, H), 0.0, 1.0), 28.0);
  // CHURNED water is exempt from the sun-path envelope. The reference's wake is
  // not a fog bank — it is thousands of bright grains, and they sparkle in
  // every direction because broken water throws facets at every angle. This is
  // also the reference's own coupling (glint intensity * (0.6 + 0.8 * foam)); the
  // envelope stays for the calm sheet, where sparkle away from the sun path
  // would read as noise.
  env = max(env, clamp(foam, 0.0, 1.0) * 0.60);
  // A floor of the reference's grazing falloff — the sea near the limb keeps a
  // little extra life without the snow gate's kill-everything exponent.
  let graze = 0.35 + 0.65 * pow(1.0 - NdotV, 1.5);
  let gate = env * graze * smoothstep(0.02, 0.30, NdotL);
  if (gate <= 0.002) { return 0.0; }

  // Cells drift with the slow current so the field is alive between blinks.
  let p = wp + vec3<f32>(0.31, 0.12, -0.94) * (t * 0.14);

  // Footprint fade, with the foreshortening term explicit: toward the limb one
  // pixel covers 1/NdotV more surface, which is where the fine octave would
  // otherwise alias into a shimmering carpet.
  let fpx = dist * 0.0006 / max(NdotV, 0.06);

  var sum = 0.0;
  // Each octave lives between TWO fades. The far fade is the reference's (cell drops
  // under a few pixels -> aliasing shimmer). The NEAR fade is ours: their cells
  // are centimetres seen from metres away and can never fill the screen, but a
  // 1-unit cell twelve units from this camera is a 50-pixel blob, and a sparkle
  // that big reads as a pearl floating on the water. An octave only exists
  // while its disc projects to sparkle size.
  let cellA = 0.20;
  let farA = smoothstep(cellA * 0.55, cellA * 2.2, fpx);
  let nearA = smoothstep(26.0, 55.0, cellA / max(fpx, 1e-5));
  if (farA < 1.0 && nearA < 1.0) {
    sum += glintOctave3(p, cellA, 1.0, t) * (1.0 - farA) * (1.0 - nearA);
  }
  let cellB = 0.52;
  let farB = smoothstep(cellB * 0.55, cellB * 2.2, fpx);
  let nearB = smoothstep(26.0, 55.0, cellB / max(fpx, 1e-5));
  if (farB < 1.0 && nearB < 1.0) {
    sum += glintOctave3(p + vec3<f32>(53.1, 17.9, 91.3), cellB, 1.0, t) * (1.0 - farB) * (1.0 - nearB) * 1.2;
  }
  return sum * gate;
}

fn oceanShimmer(wp : vec3<f32>, dir : vec3<f32>, sun : vec3<f32>, t : f32, rp : f32, dist : f32) -> vec3<f32> {
  let r = length(wp);
  // The sea is a clean sphere at the planet radius (terrainHeight is identically
  // zero at and below the waterline), so a tight shell around it is an exact
  // water test — and it excludes the snake, the props and the wake standing on
  // top, which a purely directional test would wrongly light up.
  // TWO surfaces, one window. The sea is painted on the planet sphere at
  // rp + 0.05, and the live sheet (src/water-patch.ts) floats params.shell.w
  // above that — so a single window centred on the painted sea drops the sheet
  // out of the band the moment the lift exceeds it, and the patch renders as a
  // dark quadrilateral that has lost its sky reflection and swell. Taking the
  // nearer of the two distances accepts both and still excludes what stands on
  // top: the snake's body starts ~0.35 above rp, well past this window.
  let dent = waterDent(normalize(wp));
  // The paint follows the hole DOWN, so a crater never shows the flat sea
  // painted underneath it; the sheet's window follows the whole displacement,
  // so a rim keeps its water shading however far it stands proud.
  let dPaint = abs(r - rp - 0.05 + dent.y);
  let dSheet = abs(r - rp - 0.05 - params.shell.w - dent.x);
  let band = 1.0 - smoothstep(0.06, 0.30, min(dPaint, dSheet));
  if (band <= 0.002) { return vec3<f32>(0.0); }
  let n = wp / max(r, 1e-4);
  // The SAME field the surface material paints the coast with. A second
  // definition here would drift from that coastline — the exact class of bug
  // that once planted props on painted water.
  let f = ps_landField(n);
  let wet = 1.0 - smoothstep(-0.030, -0.004, f);

  // ── breathing surf ────────────────────────────────────────────────────────
  // The forward pass's shoreline foam is static — ps_vnoise(p * 90) with no
  // clock — so every coast wears the same lace forever. the reference's foam is
  // "broken up by a drifting noise so it is a froth rather than a painted
  // band"; this is that, plus a slow push-pull of the band's CENTRE across the
  // waterline so the surf line itself advances and retreats. Computed before
  // the open-water early-out because it lives exactly where `wet` dies.
  // Width is in RAW field units, not angular distance — the exact trap
  // surface.ts documents ("a kilometre-wide cream river... wherever the field
  // flattened out"). Dividing by |grad| would cost four more field taps per
  // pixel, so instead the window is kept TIGHT and biased to the water side
  // (centre at f = -0.0014), and the first cut's 0.0060 half-width — which wore
  // every coast as a fat glowing rind — is nearly halved.
  let heave = 0.0010 * sin(t * 0.9 + ps_fbm(n * 14.0) * 6.28318530718);
  let surfBand = 1.0 - smoothstep(0.0002, 0.0034, abs(f + 0.0014 + heave));
  let surfN = ps_fbm(n * 55.0 + vec3<f32>(t * 0.10, 0.0, -t * 0.07));
  let surf = surfBand * smoothstep(0.45, 0.80, surfN) * band;

  if (wet <= 0.002 && surf <= 0.002) { return vec3<f32>(0.0); }

  // Two crossing trains, drifting on different headings at different speeds.
  // Crossing is what reads as water: one train alone is a conveyor belt, and the
  // eye picks that up immediately.
  let d1 = vec3<f32>(0.31, 0.12, -0.94);
  let d2 = vec3<f32>(-0.77, 0.35, 0.53);
  // Kept LOW on purpose. At 34 and 57 the noise cell is under a world unit and
  // the sea is tens of units away, so adjacent pixels jump whole cells and the
  // value noise breaks into flat axis-aligned squares — it read as tiling
  // artefacts laid over the water, not as waves.
  let w1 = ps_fbm(n * 11.0 + d1 * (t * 0.16));
  let w2 = ps_fbm(n * 19.0 + d2 * (t * 0.11));
  let churn = w1 * 0.62 + w2 * 0.38;

  // Glint: a REAL specular lobe evaluated against the animated wave normal,
  // rather than the old `smoothstep(churn) * pow(dot(n, h), 3)`. That earlier
  // form multiplied a scalar noise by a scalar half-vector test, so its bright
  // area was governed by the noise threshold and its shape by the SPHERE's
  // normal — a single broad patch that slid around. Feeding a per-pixel normal
  // into a narrow lobe is what turns the same energy into separate crests that
  // each catch the sun at their own moment.
  let wn = psWaveNormal(n, t);
  let h = normalize(sun - dir);
  let ndh = clamp(dot(wn, h), 0.0, 1.0);
  let ndl = clamp(dot(wn, sun), 0.0, 1.0);
  // Roughness WIDENS with view distance. This is ordinary specular
  // antialiasing: a fixed narrow lobe over a field this fine turns into
  // crawling single-pixel fireflies out at the limb, where one pixel covers
  // many crests. Widening the lobe is the analytic stand-in for averaging them.
  let rough = clamp(0.105 + dist * 0.0018, 0.105, 0.30);
  let a2 = rough * rough * rough * rough;
  let dd = ndh * ndh * (a2 - 1.0) + 1.0;
  let ggx = a2 / (3.14159265 * dd * dd);
  // Schlick on water's real F0. Grazing angles go near-mirror, which is why a
  // sea reads bright toward the horizon and dark underfoot.
  let fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(wn, -dir), 0.0, 1.0), 5.0);
  var spec = ggx * fres * ndl * 0.045;
  // This pass runs AFTER the tonemap (urp-pipeline.ts:394), so anything added
  // here lands in display space where there is no headroom left — an unbounded
  // GGX peak (order 1e3 at this roughness) would clip instantly and we would be
  // back to a white hole. Roll it off locally and cap the contribution below the
  // clip point.
  let crest = (spec / (1.0 + spec)) * 0.50;

  // ── sky reflection ────────────────────────────────────────────────────────
  // The sun lobe above only lights the sea where the mirror direction happens to
  // be on screen, which in play is a minority of frames — everywhere else the
  // wave normals were computed and then had nothing to show for themselves. What
  // makes real water read as water away from the glare is not the sun at all, it
  // is the SKY it reflects, broken up by those same normals. (The old scalar
  // glint carried a hand-placed `0.10 +` floor for exactly this reason; this is
  // the term that floor was standing in for.)
  //
  // Fresnel does the shaping for free: near-vertical viewing reflects ~2% and the
  // water stays its own colour, while toward the limb it goes near-mirror and the
  // sea brightens — which is the behaviour that reads as a real water surface
  // rather than a tinted sheet.
  let refl = reflect(dir, wn);
  let skyT = clamp(dot(refl, n) * 1.4, 0.0, 1.0);
  let skyCol = mix(vec3<f32>(0.60, 0.72, 0.85), vec3<f32>(0.26, 0.42, 0.68), skyT);
  let skyRefl = skyCol * fres * 0.34;

  // A slow swell under the sparkle so the whole sheet breathes instead of only
  // the highlights twinkling.
  let swell = (ps_fbm(n * 5.0 + d2 * (t * 0.055)) - 0.5) * 1.4 + 0.5;

  let k = band * wet;

  // ── wake ──────────────────────────────────────────────────────────────────
  let wk = wakeField(n, t, 1.0, rp, 1.0);
  let foam = wk.x * k;
  // The combed ripple the reference shows trailing the white mass: fine
  // parallel texture that only appears where the foam has already thinned.
  // Frequency kept moderate — the sea is tens of units away and a fine field
  // aliases into flat cells long before it reads as ripples.
  // The combed ripple trailing the mass. Two scales crossed at different
  // frequencies read as fine parallel texture at this distance; one alone reads
  // as noise. Gated to where the mass has thinned, which is where the reference
  // shows it.
  // GATED BY WAKE PRESENCE (wk.z), not only by age. The field's miss sentinel
  // returns y = 1.0, and smoothstep(0.10, 0.55, y) is fully OPEN at 1 — so this
  // term was painting the entire ocean, with a hard straight seam along the
  // early-out's best = 0.6 chord where y snapped from real age to the sentinel.
  // That seam is the "faint angular edge" two rounds of turning frames kept
  // showing. z is 9.0 at the sentinel, so a z-fade kills the term outside the
  // wake and closes continuously across the boundary.
  let comb = smoothstep(0.40, 0.62, ps_fbm(n * 46.0 + vec3<f32>(0.0, t * 0.03, 0.0)))
           * smoothstep(0.35, 0.70, ps_fbm(n * 17.0 + vec3<f32>(t * 0.02, 0.0, 0.0)))
           * (1.0 - smoothstep(0.05, 0.40, wk.x))
           * smoothstep(0.10, 0.55, wk.y)
           * (1.0 - smoothstep(0.85, 1.0, wk.y))
           * (1.0 - smoothstep(1.2, 1.6, wk.z)) * k;

  // Discrete sparkle, the reference's own intensity dial (glintIntensity 0.55),
  // boosted a little where foam churns the surface exactly as their water does
  // (`* (0.6 + 0.8 * max(foam, milk))`). Rolled off before it can clip: this
  // pass writes display-space values.
  // the reference adds `sun * g * 0.7` in HDR, where sun radiance runs ~17 — the
  // sparkle SATURATES and reads as a white point. We write display-space values
  // after the tonemap, so the same g barely tints a pixel: pre-gain it hard,
  // then roll off just under clipping. A sparkle that is not near-white is not
  // a sparkle, it is dust.
  let g = waterGlints(wp, n, dir, sun, t, dist, wk.x) * 30.0 * (0.6 + 0.8 * wk.x);
  let glint = (g / (1.0 + g)) * 0.58;

  return k * (vec3<f32>(1.00, 0.985, 0.94) * crest
            + vec3<f32>(1.00, 0.99, 0.95) * glint
            + skyRefl
            + vec3<f32>(0.30, 0.52, 0.60) * clamp(swell, 0.0, 1.0) * 0.10)
       + vec3<f32>(0.97, 0.985, 1.00) * (foam * 0.36 + comb * 0.34 + surf * 0.13);
}

fn hash3(p : vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3));
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}

fn hash3v(p : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(hash3(p), hash3(p + 17.7), hash3(p + 39.3));
}

fn valueNoise(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

fn fbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i = i + 1) {
    v += a * valueNoise(q);
    q *= 2.03;
    a *= 0.5;
  }
  return v;
}

/// One octave of stars. `scale` sets apparent density; `power` sharpens the
/// point (higher = tighter, so bigger scales stay pinpricks instead of blobs).
/// Only a fraction of cells are populated, otherwise the sky reads as noise
/// rather than as stars.
fn starLayer(dir : vec3<f32>, scale : f32, power : f32, occupancy : f32, twinkle : f32) -> f32 {
  let p = dir * scale;
  let cell = floor(p);
  let local = fract(p);
  let h = hash3v(cell);
  if (h.x > occupancy) { return 0.0; }
  let centre = vec3<f32>(h.y, h.z, hash3(cell + 5.5));
  let d = length(local - centre);
  let core = pow(clamp(1.0 - d * 1.6, 0.0, 1.0), power);
  // Slow, shallow scintillation. Fully static stars look like dead pixels.
  let phase = h.y * 6.2831853 + params.forward.w * 1.7;
  let flicker = 1.0 - twinkle + twinkle * (0.5 + 0.5 * sin(phase));
  return core * flicker * (0.35 + 0.65 * h.z);
}

// Levels are calibrated against the reference footage rather than by eye, from
// HUD-free patches of the upper-middle sky (8-bit, post-tonemap — this pass runs
// after tonemap and FXAA, urp-pipeline.ts:394):
//   f09: mean 38.1, RGB (21,38,55), P50 36, P90 54, max 70
//   f02: mean 41.5, RGB (33,37,54), P50 41, P90 48, max 103
// Two things this corrected. First, an earlier measurement that included the
// score panel reported "0.2% of background pixels saturated" and sent me chasing
// clipped-white stars — the reference has NO saturated stars at all; its
// brightest is ~100/255. Second, the sky is markedly GREEN-shifted (f09 green is
// nearly double its red), which reads as the planet's own airglow rather than a
// neutral starfield.
// The spread matters as much as the level: reference P90-P50 is 7-18, so the
// nebula is a wide, soft, structured lift — not a flat wash (an earlier pass at
// P90-P50 = 3 looked dead).
/// The sun, as a drawn object.
///
/// the reference's frames are ORGANISED around it: a small hot disc sitting inside a
/// glow that fills a quarter of the sky and washes everything near it toward
/// white. Ours had no sun at all — the light existed only as a direction — so
/// the single strongest compositional element of the look was simply absent.
///
/// Two lobes, because one never reads right: a tight one for the disc's own
/// halo and a very wide, weak one for the sky-scale wash. The disc itself is a
/// smoothstep rather than a hard cut so it survives the tonemap without aliasing.
fn sunDisc(dir : vec3<f32>, sunDir : vec3<f32>) -> vec3<f32> {
  let c = clamp(dot(dir, sunDir), -1.0, 1.0);
  let disc = smoothstep(0.99965, 0.99992, c);
  let tight = pow(max(c, 0.0), 2600.0);
  let mid = pow(max(c, 0.0), 90.0);
  // Measured off the reference f04: the disc is ~5% of frame width and the bright
  // wash around it reaches ~32%. A single lobe cannot do both, so there are
  // three: disc, a mid halo, and a very wide sky-scale wash.
  let wide = pow(max(c, 0.0), 10.0);
  let warm = vec3<f32>(1.0, 0.955, 0.885);
  let cool = vec3<f32>(0.72, 0.82, 1.0);
  return warm * (disc * 26.0 + tight * 9.0 + mid * 0.9)
       + mix(cool, warm, 0.55) * wide * 0.42;
}

/// The eclipse centre is computed in main.ts and shared with the real hand mesh.
/// This pass only paints the corona, annular light and sky grade around that
/// direction; the opaque mesh supplies the silhouette and depth occlusion.
fn eclipseSky(col0 : vec3<f32>, dir : vec3<f32>, eclipse : f32) -> vec3<f32> {
  if (eclipse <= 0.0001) { return col0; }

  let observerUp = normalize(params.cam.xyz);
  let playerUp = normalize(params.sheet.xyz);
  let sunDir = normalize(params.sun.xyz);
  var bearingRaw = sunDir - playerUp * dot(sunDir, playerUp);
  if (dot(bearingRaw, bearingRaw) < 1e-6) {
    bearingRaw = params.forward.xyz - playerUp * dot(params.forward.xyz, playerUp);
  }
  let bearing = normalize(bearingRaw);
  let anchor = normalize(params.eclipseAnchor.xyz);
  var skyUpRaw = observerUp - anchor * dot(observerUp, anchor);
  if (dot(skyUpRaw, skyUpRaw) < 1e-6) { skyUpRaw = params.up.xyz; }
  let skyUp = normalize(skyUpRaw);
  let skyRight = normalize(cross(skyUp, anchor));
  let denom = max(dot(dir, anchor), 0.05);
  let uv = vec2<f32>(dot(dir, skyRight), dot(dir, skyUp)) / denom;

  // Totality still has a low warm ring around the entire horizon. The sunward
  // half is broader and brighter; the anti-solar half keeps only the floor and
  // is cooled toward deep purple. Using a soft cosine lobe (with a low power)
  // keeps a readable slope even when the camera is centred exactly anti-sun,
  // where both frame edges lead back toward the brighter side of the ring.
  let sunTangentRaw = bearing - observerUp * dot(bearing, observerUp);
  let rayTangentRaw = dir - observerUp * dot(dir, observerUp);
  let rayTangent = normalize(rayTangentRaw);
  var azimuthCos = 1.0;
  if (dot(sunTangentRaw, sunTangentRaw) > 1e-6) {
    azimuthCos = dot(rayTangent, normalize(sunTangentRaw));
  }
  let towardSun = pow(clamp(0.5 + 0.5 * azimuthCos, 0.0, 1.0), 0.45);
  let impact = length(cross(params.cam.xyz, dir));
  let horizonBand = 0.32 + 0.68 * exp(-max(impact - params.cam.w, 0.0) * 0.16);
  let away = 1.0 - towardSun;
  let purpleCover = vec3<f32>(0.62, 0.48, 0.88);
  var col = col0 * mix(vec3<f32>(1.0), purpleCover, eclipse * away * horizonBand * 0.62);
  let horizonGold = vec3<f32>(1.0, 0.34, 0.055);
  col += horizonGold * eclipse * horizonBand * (0.105 + 0.255 * towardSun);

  // 曾经这两个量叫 totality / sunUp，因为它们是给天上那只手用的。手已经
  // 删掉（真几何体的爪影和日冕摆在一起互相拖累，光晕本身更好看），但这两个量本来
  // 描述的就不是手：一个是全食进程，一个是太阳在不在地平线以上。改成它们真正的
  // 名字，免得下一个人去找一只不存在的手。
  let totality = smoothstep(0.58, 0.96, eclipse);
  let sunUp = smoothstep(-0.105, 0.035, params.sheetFade.w);

  // Before the fingers resolve, a growing occluder and annular corona carry the
  // eclipse read. At totality the disc is gone and only the hand silhouette is
  // authoritative.
  let ringRadius = mix(0.045, 0.36, smoothstep(0.05, 0.78, eclipse));
  let ringDist = abs(length(uv) - ringRadius);
  let discMask = 1.0 - smoothstep(ringRadius - 0.018, ringRadius + 0.012, length(uv));
  let ringLife = 1.0 - smoothstep(0.72, 1.0, eclipse);
  let ringCore = exp(-ringDist * 105.0) * 2.6;
  let ringGlow = exp(-ringDist * 18.0) * 0.72;

  // The shader disc yields to the depth-writing hand mesh as it grows in.
  let shadow = discMask * (1.0 - totality) * sunUp;
  col *= 1.0 - shadow * 0.995;
  let gold = vec3<f32>(1.0, 0.54, 0.10);
  col += gold * (ringCore + ringGlow) * ringLife * smoothstep(0.02, 0.16, eclipse) * sunUp;

  // A radial backlight is intentionally painted *behind* the geometry. The
  // post pass runs only for background pixels, so the opaque black mesh cuts
  // its real claw-and-sleeve outline out of this glow without needing another
  // SDF copy of the hand.
  let coronaRadius = mix(0.16, 0.30, totality);
  let coronaDist = abs(length(uv) - coronaRadius);
  let edgeNoise = 0.76 + 0.42 * hash3(floor(dir * 310.0 + params.forward.w * 0.35));
  let corona = (exp(-coronaDist * 34.0) * 2.8 + exp(-coronaDist * 8.0) * 0.62)
             * totality * edgeNoise * sunUp;
  let backGlow = exp(-length(uv) * 3.4) * 0.22 * totality * sunUp;
  col += gold * (corona + backGlow);
  return col;
}

fn spaceBackground(dir : vec3<f32>) -> vec3<f32> {
  // BASE IS LINEAR, AND THAT IS THE WHOLE STORY OF WHY THIS WAS TOO BRIGHT.
  //
  // It used to be vec3(0.078, 0.132, 0.196), set from a reading of the
  // reference's "quiet sky" as display (21,38,55). Two things were wrong with
  // that. The sample included the atmosphere halo, so it read the lit sky near
  // the limb rather than deep space; and the value was written into a LINEAR
  // slot, where 0.078 encodes to about 76 on screen, not 21.
  //
  // Measured properly — the darkest corner of the frame, across all ten
  // reference frames — deep space there is display (16,18,28), median
  // luminance 17.8, with 70.4% of pixels under 20. Ours had median 47.8 and
  // ZERO pixels under 20: a milky floor over a third of the frame that nothing
  // could ever be darker than. The stars were never the problem (our P99 101
  // against their 98); the floor was.
  //
  // (16,18,28) display is about (0.0052, 0.0061, 0.0116) linear.
  var col = vec3<f32>(0.0055, 0.0068, 0.0125);

  // Nebula: two decorrelated low-frequency fields, one cool violet and one
  // teal, masked into a broad band so it does not wrap the whole sky evenly.
  // The exponents are deliberately low — a high power gives dramatic wisps, but
  // the reference's nebula is a wide even lift (P90-P50 of only 5 in f02).
  let band = exp(-pow(dot(dir, normalize(vec3<f32>(0.35, 0.9, -0.2))) * 1.35, 2.0));
  let n1 = fbm(dir * 2.1 + vec3<f32>(11.3, 4.7, 2.9));
  let n2 = fbm(dir * 3.4 + vec3<f32>(-7.1, 22.5, 8.3));
  let violet = vec3<f32>(0.42, 0.30, 0.72);
  let teal   = vec3<f32>(0.14, 0.42, 0.55);
  let neb = band * (pow(clamp(n1, 0.0, 1.0), 1.4) * 1.10 + pow(clamp(n2, 0.0, 1.0), 1.8) * 0.70);
  col += neb * mix(violet, teal, clamp(n2 * 1.4, 0.0, 1.0)) * 0.95;

  // A second, unbanded field so the sky has structure away from the main band
  // too. Without it everything outside the band is a flat plate and P90 collapses
  // onto P50.
  let wide = pow(clamp(fbm(dir * 1.35 + vec3<f32>(31.7, 2.2, -14.6)), 0.0, 1.0), 1.6);
  // Scaled with the base. This is a LIFT off the floor, so leaving it while the
  // floor dropped would just reinstate the floor with extra steps.
  col += wide * vec3<f32>(0.0060, 0.0125, 0.0160);

  // Dust lanes: darken where a third field is dense, so the nebula gets
  // structure instead of reading as an even wash. Shallow, for the same reason
  // the exponents above are low.
  let dust = pow(clamp(fbm(dir * 5.2 + vec3<f32>(3.3, -9.1, 14.0)), 0.0, 1.0), 2.0);
  col *= mix(1.0, 0.72, band * dust);

  // Stars: three apparent size classes. Cores are boosted past 1.0 on purpose —
  // a real star is a clipped point, and the reference has 0.2% of background
  // pixels fully saturated. Widening the core (d * 1.6 rather than d * 2.0)
  // makes a pixel actually land on one instead of stepping over it.
  var s = 0.0;
  s += starLayer(dir,  85.0, 10.0, 0.070, 0.25) * 3.20;   // bright, sparse, clips white
  s += starLayer(dir, 180.0, 15.0, 0.085, 0.35) * 1.10;   // mid
  s += starLayer(dir, 360.0, 22.0, 0.100, 0.45) * 0.42;   // faint dust of stars
  // Slight blue-white bias; a few stars pull warm.
  let starTint = mix(vec3<f32>(0.75, 0.85, 1.0), vec3<f32>(1.0, 0.92, 0.78),
                     hash3(floor(dir * 85.0)));
  col += s * starTint;

  return col;
}

/// Display-space eclipse grade. Its floor is deliberately not black: at
/// totality the darkest multiplier is 0.40 before a mild purple temperature
/// shift, while highlights retain up to 0.62. The power-shaped luminance term
/// makes rock/tree midtones survive and lets emissive food, dust and the gate
/// separate without touching any material every frame.
fn eclipseGrade(col : vec3<f32>, pixel : vec2<f32>, eclipse : f32) -> vec3<f32> {
  if (eclipse <= 0.0001) { return col; }
  let displayLuma = clamp(dot(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)),
                              vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let highlight = pow(displayLuma, 0.45);
  let multiplier = mix(1.0, 0.40 + 0.22 * highlight, eclipse);
  let purple = mix(vec3<f32>(1.0), vec3<f32>(0.98, 0.86, 1.11), eclipse * 0.62);
  var graded = col * multiplier * purple;

  // This pass is post-tonemap and usually lands in an 8-bit target. One stable
  // sub-code-value dither breaks the broad purple shadow bands without visible
  // temporal crawling or materially lifting the black hand.
  let n = fract(sin(dot(floor(pixel), vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
  graded += vec3<f32>(n * eclipse * (0.72 / 255.0));
  return max(graded, vec3<f32>(0.0));
}

// ── volumetric light shafts: REMOVED ──────────────────────────────
//
// A 24-step radial march over sky visibility, ported constant-for-constant from
// straight-edged translucent WEDGES over the water, very obvious while turning
// and invisible in a still. Deleted rather than tuned, because the shape is what
// the effect MATHEMATICALLY IS in this shot:
//
//   - God rays need an occluder with STRUCTURE silhouetted against sky -- a tree
//     line, a ridge with gaps. the reference has a ground-level camera and dune
//     crests. We look DOWN at a sphere.
//   - Measured here, this depth buffer's range is compressed enough that the
//     ocean surface itself passes the march's sky test. The only fragments that
//     read as occluders are the snake and the props right next to it -- so the
//     apex of every wedge sat on the snake.
//   - Confirmed by isolation: SHAFT_STRENGTH = 0.0 made the wedges vanish
//     entirely. Lowering it 0.30 -> 0.16, feathering the binary sky test into a
//     ramp, and gating on the fragment's own depth all failed, each for the same
//     reason -- they change the level, not the geometry.
//
// The atmosphere shell below already supplies the limb glow this was reaching
// for, and removing it takes 24 texture fetches per pixel off the post pass.

@fragment
fn fs_main(in : FullscreenOutput) -> @location(0) vec4<f32> {

  let scene = textureSample(sceneTexture, sceneSampler, in.uv).rgb;
  let ndcDepth = textureSample(depthTexture, depthSampler, in.uv);

  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let dir = normalize(
    params.forward.xyz +
    params.right.xyz * (ndc.x * params.right.w * params.up.w) +
    params.up.xyz * (ndc.y * params.right.w)
  );

  // Anything the geometry pass did not write is far field (fog.wgsl uses the
  // same >= 0.9999 test). Background pixels get the star field; geometry keeps
  // whatever the scene drew. Both then go through the atmosphere, which is what
  // puts the halo on BOTH sides of the silhouette — the reference glow bleeds a
  // little over the disc, and gating it on background only leaves a hard edge.
  let eclipse = clamp(params.sheetFade.z, 0.0, 1.0);
  var base = scene;
  var sceneT = 1e9;
  var scuff = 0.0;
  if (ndcDepth >= 0.9999) {
    let sunFade = 1.0 - smoothstep(0.02, 0.94, eclipse);
    base = spaceBackground(dir) + sunDisc(dir, normalize(params.sun.xyz)) * sunFade;
    base = eclipseSky(base, dir, eclipse);
  } else {
    // Linearised view depth, then along-ray distance.
    let near = params.shell.y;
    let far = params.shell.z;
    let viewZ = near * far / (far - ndcDepth * (far - near));
    sceneT = viewZ / max(dot(dir, params.forward.xyz), 1e-3);
  }

  let camPos = params.cam.xyz;
  let rp = params.cam.w;
  let ra = params.shell.x;

  // Ocean motion, added to the scene BEFORE the atmosphere so the sparkle is
  // fogged by the same aerial perspective everything else on the surface is.
  if (sceneT < 1e8) {
    let wp = camPos + dir * sceneT;
    base = base + oceanShimmer(wp, dir, normalize(params.sun.xyz), params.forward.w, rp, sceneT);
    // The land trail is applied at the very END, after the atmosphere. Applied
    // here it was almost invisible: the aerial-perspective term is ADDITIVE and
    // lands on top, so darkening the scene colour first just gets filled back in.
    scuff = landTrail(wp, params.forward.w, rp);
  }

  let shell = raySphere2(camPos, dir, ra);
  if (shell.y <= 0.0 || shell.y < shell.x) {
    let outCol = clamp(base, vec3<f32>(0.0), vec3<f32>(4.0));
    return vec4<f32>(eclipseGrade(outCol, in.position.xy, eclipse), 1.0);
  }
  var t0 = max(shell.x, 0.0);
  var t1 = shell.y;

  // Clip on the planet's near root: the shell behind the solid body must not be
  // integrated, otherwise the disc gets a uniform wash instead of a limb ring.
  let solid = raySphere2(camPos, dir, rp);
  if (solid.y > 0.0 && solid.x > 0.0) { t1 = min(t1, solid.x); }
  t1 = min(t1, sceneT);

  // Aerial perspective is weighted DOWN over the planet itself. Physically the
  // same air is in front of the surface as beside it, but at this optical depth
  // the isotropic term lays a broad white wash over the whole disc near the
  // limb, and the reference has a THIN bright rim there with the terrain colours
  // reading clean behind it. Keeping the term at full strength only where the
  // ray misses the planet puts the glow where the reference puts it.
  // FEATHERED, not switched. This was `select(0.22, 1.0, sceneT > 1e8)` — a
  // 4.5x step in inscatter exactly at the geometry/background boundary, which at
  // the limb IS the sea. That step is the hard inner edge that made the halo
  // read as a painted outline stroke rather than as air. The blend runs on the
  // ray's impact parameter (|camPos x dir| for unit dir is the perpendicular
  // distance from the planet centre to the ray), so it feathers over two world
  // units of limb and knows nothing about what the ray happened to hit.
  let limbBlend = smoothstep(rp - 1.0, rp + 1.0, length(cross(camPos, dir)));
  let msScale = mix(0.22, 1.0, limbBlend);
  let air = atmosphere(camPos, dir, t0, t1, normalize(params.sun.xyz), params.sun.w, rp, ra, msScale);

  // Aerial perspective over the PLANET, as opposed to beside it. Measured on a
  // matched land-filled view, our terrain came out at B/R 0.67 against the
  // reference's 0.37 — the inscatter is additive and blue, and at full strength
  // it tints the entire disc. Scaling it down over geometry keeps the terrain
  // colours the palette actually specifies; the limb still hazes more than the
  // centre because its path through the shell is genuinely longer.
  // The SAME feather, so extinction and inscatter cannot expose two separate
  // boundaries a pixel apart.
  let apr = mix(0.15, 1.0, limbBlend);
  // (Historical note: the shaft term that used to be added here had to appear on
  // BOTH exits. It was only on the shell-miss return, so the beams
  // cut off exactly where a ray starts crossing the atmosphere ring — a hard
  // circular seam around the limb. (codex 5.6 finding #4)
  // SOFT KNEE on the inscatter. This pass runs after the tonemap and writes
  // display-space values, while `air` scales with a sun intensity of 7 — so near
  // the limb it lands well above 1.0 and everything there clips to the same
  // white. That is what gives the band its constant width and its slab edge: not
  // thickness, saturation. Same idiom the crest term uses two hundred lines up.
  let airDisplay = (air.rgb / (vec3<f32>(1.0) + air.rgb)) * 0.82;
  let lit = base * mix(1.0, air.a, apr) + airDisplay * apr;
  let outCol = clamp(lit * (1.0 - scuff), vec3<f32>(0.0), vec3<f32>(4.0));
  return vec4<f32>(eclipseGrade(outCol, in.position.xy, eclipse), 1.0);
}
