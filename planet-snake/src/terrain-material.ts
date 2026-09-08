// Terrain material — the reference's subsurface shading grafted onto the engine's
// standard PBR.
//
// WHY THIS SHAPE, AND NOT A .wgsl FILE
//
// A game-directory .wgsl containing `#import forgeax_view::common::{...}` is
// served verbatim: the vite shader plugin's only predicate is the `.wgsl`
// suffix and it does not run naga_oil composition for these files. The module
// transform then 500s, and because the game module imports it, `loadGame` fails
// and the engine swaps in its fallback scene — one unresolvable import takes the
// whole game down. (src/space.wgsl works only because it has no imports; the
// post-process channel accepts raw WGSL.)
//
// The way through is that the registry hands back the engine's own
// ALREADY-COMPOSED source at runtime:
//
//   shader.findMaterialArtifact('forgeax::default-standard-pbr')
//     -> { ok, value: { source, paramSchema } }
//
// 40201 characters of post-naga_oil WGSL, and an EMPTY paramSchema — the
// standard material's UBO layout is fixed rather than schema-derived. So we can
// take that source, splice a new fragment tail into it, register it under our
// own identifier, and keep authoring materials with `Materials.standard({...})`
// exactly as before. No build-system change.
//
// WHAT IS PORTED, AND WHAT IS NOT
//
// `wrapDiffuse`, `backScatter`, and the `snowSubsurface` tint/lobe construction
// including its shallowTint (0.94,0.965,1.0) and deepTint (0.55,0.72,1.0).
//
// The honest caveat: the reference *replaces* its diffuse lobe with the wrapped one.
// Here the engine has already accumulated a Lambert diffuse by the time we get
// control, and rewriting that would mean surgery inside mangled composed code
// around the light loop. So this ADDS the difference (wrapped minus Lambert)
// rather than substituting. The visible effect — light carried past the
// terminator, and a blue-tinted rather than merely dark shadow side — is the
// same; the arithmetic is not identical to the original.
//
// Also not ported: glints and the three tiled detail-normal scales. The audit
// established those are near-field terms gated on distance and grazing angle,
// and this planet is viewed from tens of units away where both are faded out.

// Registered under the RESERVED `forgeax::` prefix on purpose, and the reason is
// structural rather than cosmetic. A user-prefixed shader has its bind-group
// layout DERIVED from paramSchema; an engine-prefixed one uses the fixed stock
// layout. This shader IS the engine's own composed source with one fragment tail
// replaced, so it needs the stock layout exactly — supplying a schema instead
// builds a different BGL than the source expects and the material bind group
// fails validation with "Binding entry sampler not set", because the derived
// layout has no samplers in it.
//
// Reproducing the stock 4-BGL contract by hand through paramSchema would mean
// restating the material UBO, eight textures and their samplers, and the seven
// skylight bindings — all of which would then have to be kept in step with the
// engine's own shader as it changes. Borrowing the prefix keeps that coupling
// where it belongs: in the engine.
import { shIrradianceWgsl, solveSkySh } from './sky-sh';
import { hashFnWgsl, surfaceModuleWgsl } from './surface';
import type { Renderer } from '@forgeax/engine-render';
import {
  findMaterialArtifact,
  installMaterialArtifact,
  isEngineBridgeContractError,
} from './engine-bridge';

export const TERRAIN_SHADER_ID = 'forgeax::planet-snake-terrain';
export const FLESH_SHADER_ID = 'forgeax::planet-snake-flesh';

/** The engine's stock material, whose composed source we graft onto. */
const BASE_ID = 'forgeax::default-standard-pbr';

/**
 * The replacement tail for `fs_main`. `color` holds the finished radiance at
 * this point — the same place the reference applies its occlusion and cave tint —
 * and `in_1` / `material` / the view uniform are all still in scope.
 *
 * `VIEW` is substituted with the mangled name of the view global, which
 * naga_oil rewrites per composition, so it cannot be hard-coded.
 */
export interface GraftParams {
  /** 0 = thin edge, 1 = deep body. Drives BOTH the tint and the lobe, and they
   *  run opposite to intuition: a THIN edge transmits brightly over a wide angle
   *  because the path through it is short from almost anywhere, while a deep
   *  body transmits little and only close to straight-through. Giving the deep
   *  case the broader lobe lights everything evenly and reads as haze rather
   *  than as translucency. */
  thickness: number;
  /** Extra light carried past the terminator by the wrapped lobe. */
  wrap: number;
  /** Back-scatter amplitude. */
  sss: number;
  /** How far the shadow side is pushed toward blue. */
  cave: number;
  /** 9 RGB spherical-harmonic coefficients of the sky, solved on the CPU. */
  sh?: number[][];
  /** Ambient strength applied to the SH irradiance. */
  ambient?: number;
  /** Take albedo, roughness and normal from the procedural planet surface
   *  instead of from the material uniform. See src/surface.ts. */
  surface?: boolean;
  /** The water-patch variant of `surface` (see src/water-patch.ts). Three
   *  differences, all fitted to a mesh whose normal MOVES: roughness/F0 become
   *  those of a live water surface (the painted sheet's 0.60/0.030 exist to
   *  hide a frozen normal's coherent glare — on real waves they just kill the
   *  glint), and fragments over land are discarded so the painted beach and
   *  foam line stay authoritative at the coast. */
  water?: boolean;
  /** Anisotropic body highlight along the mesh tangent, plus a fresnel rim.
   *  The reference's snake carries ONE continuous highlight that slides along
   *  the body as it moves — not a specular dot per segment — and that is a
   *  tangent-aligned lobe, not an isotropic one. */
  snake?: boolean;
  /** Replace the engine's fixed-radius PCF with PCSS: search for blockers, size
   *  the penumbra from how far they sit above the receiver, then run the SAME
   *  kernel at that radius. Contact stays sharp, distant shadow edges go soft. */
  pcss?: boolean;
  /** Penumbra growth per unit of normalised blocker-receiver depth gap. Fitted
   *  rather than derived: the sun's angular size and the cascade's depth range
   *  both fold into it. */
  pcssSoft?: number;
  /** Dielectric F0 override for the whole material. The stock 0.04 makes a
   *  glossy body mirror the environment, and the environment here is a blue
   *  skylight — an ADDITIVE blue that does not scale with albedo, which is what
   *  held the snake at B/R 0.97 against the reference's 0.77 through three
   *  rounds of albedo tuning. The reference's body is a diffuse glowing material
   *  (its measured cross-section is flat, contrast 1.29), so a low F0 is also
   *  the physically apt choice; the gloss it still needs comes from the
   *  tangent-aligned lobe and the fresnel rim, both of which are warm. */
  specF0?: number;
  /** A lifted body of water — the Maelstrom's helices (src/maelstrom.ts).
   *
   *  the reference's four water spells all draw one object: a swept surface with a
   *  radius and a foam channel, "because a carve's wall of snow and a bent wave
   *  of slush are the same object". This is that object for us. It reads
   *  tangent.w as an overall FADE so a helix can rise and die without the mesh
   *  being rebuilt for it, and it is fresnel-forward: water lifted into the air
   *  is legible almost entirely by what it reflects at its rim. */
  spout?: boolean;
  /** The Ribbon's body (src/waterribbon.ts). The spout variant was tried first
   *  and it is the wrong object: spout is thin, bright and almost all rim,
   *  which is right for a helix of torn spray and turns a thrown STREAM into a
   *  strip of milky plastic. A bent body of water has a colour — you see
   *  through it into a blue-green — and it goes white only where it FOAMS: at
   *  the head tearing through the air, wherever it drags on the ground, and
   *  wherever the motion has stretched it thin enough to tear. So the foam is
   *  computed per ring on the CPU and arrives in uv.y, and the hue is the
   *  water's own rather than the sun's. */
  ribbon?: boolean;
  /** Grass blades (src/grass.ts).
   *
   *  A blade is a thin quad standing on end, so its normal points SIDEWAYS
   *  while the ground it grows out of points up. Shaded with the terrain
   *  variant it therefore samples a completely different part of the sky than
   *  the ground does, and picks up a grazing specular on top: measured on a
   *  yellow-olive terrain, the blades rendered cream-white, steel-blue and
   *  near-black, and not one of them was the olive its own albedo says it is.
   *  Scattered shards of the wrong hue are worse than no grass.
   *
   *  So a blade takes the GROUND's ambient direction, not its own. It is a
   *  thing growing out of a surface and it should be lit like part of that
   *  surface; the only thing its own normal is allowed to decide is how much
   *  direct sun it catches. */
  grass?: boolean;
  /** A shed skin (src/slough.ts). Reads two free per-vertex channels the
   *  ribbon writes, because the forward pass has no clock and this thing has to
   *  visibly dry out: uv.y is the travelling PEEL SEAM and tangent.w is
   *  remaining LIFE (1 fresh, 0 gone). */
  skin?: boolean;
  /** Airborne spray grains (src/particles.ts). Turns a flat opaque billboard
   *  into the reference's snow-spray puff: a wobbled DISC rather than a quad, a
   *  soft alpha edge, a reconstructed SPHERICAL normal so a grain has a lit and
   *  a dark side, and forward scatter so it lights up when you look through it
   *  Requires an alpha-blended material — see the sprayMat renderState. */
  spray?: boolean;
  /** How much of the sunless light (sky ambient + night floor) this material
   *  keeps past the terminator. 1 keeps all of it.
   *
   *  For grass this is the fix for the last of the night-side speckle. The
   *  sunless terms are the ONLY light out there, and sky irradiance is
   *  normal-dependent — a vertical blade faces a different part of the sky than
   *  the flat ground it stands in, and catches a brighter part of it. Fading
   *  the blades into the dark lets them read as silhouettes rather than as
   *  thousands of pale slivers, which is also what grass does at night. */
  nightFade?: number;
  /** Night-side floor, as a fraction of the surface's OWN albedo. A flat
   *  emissive would wash the dark side grey; tinting by albedo keeps each
   *  biome's hue where the sun does not reach. */
  nightFloor?: number;
}

/**
 *
 * The quad's own uv is the disc coordinate; the billboard basis is recovered
 * from the interpolated world normal (which IS the camera-facing axis of the
 * instance matrix) and world tangent (its right axis, carrying the per-particle
 * roll), so no extra vertex stream or uniform is needed.
 */
function sprayModuleWgsl(): string {
  return `
${hashFnWgsl('ps_sprayHash')}

/// Radius of this fragment within its grain, 0 at the centre, >1 outside.
///
/// Wobbled, and that is the whole point of the function: "a perfectly circular
/// puff is the tell that gives billboards away" (spray.fragment.wgsl). The seed
/// comes from the billboard tangent, which is constant across one grain and
/// differs between grains because each carries its own roll.
fn ps_sprayR(uv : vec2<f32>, seed : vec3<f32>) -> f32 {
  let c = uv * 2.0 - vec2<f32>(1.0);
  let ang = atan2(c.y, c.x);
  let wob = 1.0 + 0.34 * (ps_sprayHash(vec3<f32>(cos(ang), sin(ang), 0.7) * 2.4 + seed * 37.0) - 0.5) * 2.0;
  return sqrt(dot(c, c)) / max(wob, 0.45);
}

/// Spherical normal reconstructed from the billboard's own coordinates, so a
/// grain shades as a little ball rather than as a flat disc.
fn ps_sprayNormal(uv : vec2<f32>, bn : vec3<f32>, bt : vec3<f32>) -> vec3<f32> {
  let c = uv * 2.0 - vec2<f32>(1.0);
  let nz = sqrt(max(0.0, 1.0 - clamp(dot(c, c), 0.0, 1.0)));
  // NaN-safe in the same shape as the snake's tangent guard: a degenerate
  // tangent must fall into the SELECTED branch, and every comparison against
  // NaN is false.
  let t0 = bt - bn * dot(bt, bn);
  let tl = length(t0);
  let t = select(vec3<f32>(1.0, 0.0, 0.0), t0 / max(tl, 1e-4), tl > 1e-4);
  let b = cross(bn, t);
  return normalize(t * c.x + b * c.y + bn * nz);
}

/// Henyey-Greenstein, normalised over the sphere — the forward-scatter lobe.
fn ps_sprayHG(mu : f32, g : f32) -> f32 {
  let g2 = g * g;
  let d = max(1.0 + g2 - 2.0 * g * mu, 1e-4);
  return (1.0 - g2) / (12.566370614 * d * sqrt(d));
}
`;
}

function tailWgsl(view: string, p: GraftParams): string {
  return `
    // ── the reference subsurface ────────────────────────────
    let ps_N = ${p.surface ? 'ps_surf.nrm' : p.spray ? 'ps_sprayNormal(in_1.uv, normalize(in_1.worldNormal), in_1.worldTangent.xyz)' : 'normalize(in_1.worldNormal)'};
    let ps_L = normalize(-${view}.lightDir);
    let ps_V = normalize(${view}.cameraPos - in_1.worldPos);
    let ps_NdotL = dot(ps_N, ps_L);

    // wrapDiffuse(NdotL, w) with w = 0.62, the value the reference settled on.
    // Subtracting the Lambert the engine already applied leaves only the extra
    // light carried around the terminator, which is the part we want.
    let ps_w = 0.62;
    let ps_denom = (1.0 + ps_w) * (1.0 + ps_w);
    let ps_wrap = max(0.0, (ps_NdotL + ps_w) / ps_denom);
    let ps_lambert = max(0.0, ps_NdotL);
    let ps_extra = max(0.0, ps_wrap - ps_lambert);

    // backScatter: H is built from +L (not -L). Building it the other way
    // inverts the lobe so it peaks with the sun BEHIND the camera and dies
    // looking into it — the exact opposite of translucency, and the surface
    // reads flat in the one direction it should be most alive.
    let ps_thickness = ${p.thickness};
    let ps_radius = 1.0;
    let ps_H = normalize(ps_L + ps_N * (0.28 * ps_radius));
    let ps_vh = pow(clamp(dot(ps_V, -ps_H), 0.0, 1.0), mix(3.0, 9.0, ps_thickness));
    let ps_back = ps_vh * mix(1.0, 0.30, ps_thickness);

    // Deeper material scatters longer and returns bluer — red is absorbed first
    // over any appreciable path. This is why shadows read blue rather than
    // merely dark.
    let ps_shallowTint = vec3<f32>(0.94, 0.965, 1.0);
    let ps_deepTint = vec3<f32>(0.55, 0.72, 1.0);
    let ps_tint = mix(ps_shallowTint, ps_deepTint, clamp(ps_thickness * ps_radius, 0.0, 1.0));

    let ps_albedo = ${p.surface ? 'ps_surf.albedo' : p.skin
      ? 'mix(material.baseColor.xyz, vec3<f32>(0.66, 0.63, 0.52), clamp(1.0 - in_1.worldTangent.w, 0.0, 1.0) * 0.85)'
      : 'material.baseColor.xyz'};

    // ── shadow gate ─────────────────────────────────────────────────────────
    // The engine's \`color\` is shadowed; everything this tail ADDS was not, so a
    // pixel in shadow lost its direct light and then had the wrap lobe and the
    // back-scatter handed straight back. That is why cast shadows only ever
    // reached 0.1-0.25% of the frame: they were being filled in as fast as they
    // were drawn. Zeroing wrap/sss/ambient made them appear immediately, which
    // is what pinned it.
    //
    // The shadow factor lives inside the engine's mangled light loop and is not
    // reachable from here, so it is ESTIMATED: compare the luminance the engine
    // actually produced against the unshadowed direct term this pixel would have
    // had. Stated plainly because it is an approximation — \`color\` also carries
    // ambient and IBL, so the estimate never reaches 0 and shadows stay soft
    // rather than black. That is the right side to err on here.
    //
    // Only the DIRECT-light terms are gated. Sky ambient and the night floor are
    // not blocked by a tree and keep their full value.
    let ps_lum = vec3<f32>(0.2126, 0.7152, 0.0722);
    let ps_refDirect = dot(${view}.lightColor * ps_albedo * ps_lambert, ps_lum);
    let ps_shadowRaw = clamp(dot(color, ps_lum) / max(ps_refDirect, 1e-3), 0.0, 1.0);
    // Curved, because the raw ratio never reaches 0 — \`color\` carries ambient and
    // IBL that no tree blocks, so a fully shadowed pixel still reads around 0.3.
    // The smoothstep spends the range where the shadow actually is.
    let ps_shadowEst = smoothstep(0.12, 0.80, ps_shadowRaw);
    // ── and it is only BELIEVED where the sun is properly up ────────────────
    //
    // The estimate divides by ps_lambert, which goes to zero at the terminator.
    // A ratio with a vanishing denominator does not fade out — it becomes a
    // near-binary function of the normal, and this terrain's normals change by a
    // lot from vertex to vertex. Measured across the same land at two sun
    // angles: at noon the 99th-percentile luminance step across one pixel is 4
    // and 6.6% of the ground is dark; at the terminator it is 34 and 22.2%. That
    // is the razor-edged black blotching over a quarter of the land, and it is
    // not albedo — the albedo terms are identical in both frames.
    //
    // The weight is the GEOMETRIC sun elevation at this point, which depends on
    // world position and not on the normal, so it is smooth across the surface
    // however bumpy that surface is. Where the sun is low the estimate is simply
    // not consulted, and the terms it gates are governed by their own smooth
    // sun gates instead.
    let ps_sunEl = dot(normalize(in_1.worldPos), ps_L);
    let ps_shadow = mix(1.0, ps_shadowEst,
      smoothstep(0.02, 0.26, ps_sunEl) * smoothstep(0.02, 0.22, ps_lambert));

    // ── sun-presence gate ───────────────────────────────────────────────────
    // The wrap lobe and the back-scatter are both TRANSMITTED SUNLIGHT, and the
    // shadow estimate above cannot stand in for that: past the terminator
    // ps_lambert is 0, so ps_refDirect collapses to its 1e-3 floor and
    // ps_shadowRaw saturates to "fully lit". Both terms then ran at FULL
    // strength across the whole night side, where there is no sun to transmit —
    // and because both are NORMAL-dependent, every grass blade and every
    // relief facet caught a different amount of them. That is what a night-side
    // capture reads as bright speckle over dark ground.
    //
    // Measured, zeroing the pair on a night-side land frame dropped the
    // high-frequency energy 2.27 -> 1.00 and the local contrast 31.0 -> 14.9:
    // over half of "the dark side is noisy and tiring on the eyes" was this one
    // saturating estimate.
    //
    // The window keeps the part that is real. wrapDiffuse exists to carry light
    // PAST the terminator, so it must survive just beyond NdotL = 0; it is only
    // DEEP night that has to go quiet. Sky ambient and the night floor are not
    // gated — neither of them comes from the sun, and neither varies with the
    // normal, so neither speckles.
    let ps_sunUp = smoothstep(-0.30, -0.02, ps_NdotL);
    let ps_sss = ${view}.lightColor * ps_tint * ps_back * ${p.sss} * ps_shadow * ps_sunUp;
    let ps_wrapLight = ${view}.lightColor * ps_albedo * ps_extra * ${p.wrap} * ps_shadow * ps_sunUp;

    // Cave tint on finished radiance: the shadowed fraction is pushed toward
    // blue instead of toward neutral black. the reference multiplies by an AO term
    // here as well; there is no AO channel on this material, so only the tint
    // is carried over.
    let ps_shadowed = clamp(1.0 - ps_wrap * 1.6, 0.0, 1.0);
    let ps_caveTint = mix(vec3<f32>(1.0), vec3<f32>(0.74, 0.86, 1.14), ps_shadowed * ${p.cave});
    // A/B at 0.95 blend halved the frame mean (95.2 -> 50.4). The tint's value
    // is the HUE shift on the shadow side — measured shadow B/R went 1.91 -> 2.25,
    // which is the effect worth having — not the luminance loss that came with
    // it. Dialed back to keep the shift and drop the darkening.

    // ── local horizon ───────────────────────────────────────────────────────
    // On a sphere the sun is up or down according to the POSITION, not the
    // normal: past the terminator nothing there is lit, whatever a given facet
    // happens to be facing. The engine lights per-NORMAL, so a vertical grass
    // blade on the night side still collected a full Lambert term — where the
    // ground reads NdotL -0.55 a blade standing on it can read +0.84 — and the
    // dark side came out carpeted in pale slivers brighter than the soil they
    // stand in. Props and every relief facet do the same thing more weakly,
    // which is the rest of the speckle.
    //
    // The engine's own colour cannot be unpicked into direct and ambient from
    // here (and no backticks in this comment: it lives inside tailWgsl's
    // template literal), so it is dimmed as a whole below the horizon and the
    // graft's own
    // sky ambient (which already exists to replace the stock skylight) and
    // night floor carry the night. Those two vary smoothly with the normal
    // instead of stepping with a Lambert, which is what stops the speckle.
    let ps_horizon = smoothstep(-0.06, 0.05, dot(normalize(in_1.worldPos), ps_L));
    let ps_lit = color * mix(0.22, 1.0, ps_horizon);

    // Albedo compression for the SUNLESS terms.
    //
    // Sky ambient and the night floor are the only light past the terminator,
    // and both are strictly proportional to albedo — so the terrain's blotch
    // pattern arrives at FULL contrast in the dark. sRGB then makes it worse:
    // its slope is steepest near black, so the same albedo RATIO spans far more
    // display levels down there than it does in daylight. That is the
    // camouflage-patchwork half of "the dark side is tiring".
    //
    // Pulling the albedo toward its own luminance as the sun leaves keeps every
    // biome's hue where the sun does reach and lets the night settle toward one
    // tone, which is also what a real night does to colour vision.
    let ps_flat = vec3<f32>(dot(ps_albedo, ps_lum));
    // 0.55 -> 0.75. Flatter chroma at midnight is what stops a tree reading as
    // saturated green in the dark: at night every surviving term is
    // albedo-proportional, so a fully saturated albedo stays fully saturated
    // however dim it gets, and the night looked like the day with the lights out.
    let ps_duskAlbedo = mix(mix(ps_albedo, ps_flat, 0.75), ps_albedo, ps_sunUp);

    // The normal the SKY is looked up with. Past the terminator sky irradiance
    // is the only light there is, so every wrinkle in the shading normal —
    // ps_surface's sub-vertex bump runs at 26 per radian — becomes a brightness
    // wrinkle with nothing to wash it out. Blending toward the geometric normal
    // as the sun leaves keeps the daylight look exactly as fitted and lets the
    // night settle.
${p.grass
  ? '    // A blade is lit by the sky its GROUND sees. See the note on `grass`.\n'
    + '    let ps_ambN = normalize(in_1.worldPos);'
  : '    let ps_ambN = normalize(mix(normalize(in_1.worldNormal), ps_N, mix(0.30, 1.0, ps_horizon)));'}
${p.sh ? shIrradianceWgsl(p.sh, 'ps_sky', 'ps_ambN') : '    let ps_sky = vec3<f32>(0.0);'}
    // Sky ambient. This replaces what the stock Skylight was contributing: a
    // near-neutral fill derived from an HDRI the background no longer shows,
    // which is what flattened every colour in the scene. The SH here comes from
    // the atmosphere actually on screen, so the ambient is the sky's own colour
    // and the warm-sun / cool-sky ratio the look depends on finally exists.
    let ps_sunless = ${p.nightFade !== undefined ? `mix(${p.nightFade}, 1.0, ps_horizon)` : '1.0'};
    // The cool grade, GATED ON NIGHT. Applied flat it would tint the daylight
    // palette too — ps_sunless is 1.0 in daylight for most variants, so an
    // ungated multiply reaches noon.
    let ps_nightGrade = mix(vec3<f32>(1.0), vec3<f32>(0.84, 0.91, 1.10), 1.0 - ps_horizon);
    let ps_ambient = ps_sky * ps_duskAlbedo * ${p.ambient ?? 1} * ps_sunless * ps_nightGrade;

${p.snake ? `
    // ── Kajiya-Kay anisotropic highlight ────────────────────────────────────
    // The ribbon carries its travel direction in worldTangent (see ribbon.ts:
    // "the tangent runs along the spine"), which is exactly the axis the lobe
    // has to align to. Shifting the shifted-tangent slightly toward the normal
    // moves the band off the exact silhouette so it reads as lying ON the body.
    // NaN-SAFE, and it has to be. The bots' bodies are sphere meshes whose
    // tangent attribute is degenerate at the poles; the first version tested
    // \`length(ps_T0) < 1e-4\` and took the safe branch when TRUE — but every
    // comparison involving NaN is FALSE, so a NaN tangent skipped the guard,
    // normalize() propagated it, and the segment rendered as saturated garbage.
    // Written this way the safe branch is the one NaN falls into.
    let ps_T0 = in_1.worldTangent.xyz - ps_N * dot(in_1.worldTangent.xyz, ps_N);
    let ps_tlen = length(ps_T0);
    let ps_T = select(vec3<f32>(0.0, 1.0, 0.0), ps_T0 / max(ps_tlen, 1e-4), ps_tlen > 1e-4);
    let ps_Ts = normalize(ps_T + ps_N * 0.30);
    let ps_tl = dot(ps_Ts, ps_L);
    let ps_tv = dot(ps_Ts, ps_V);
    let ps_aniso = pow(
      max(0.0, sqrt(max(0.0, 1.0 - ps_tl * ps_tl)) * sqrt(max(0.0, 1.0 - ps_tv * ps_tv)) - ps_tl * ps_tv),
      26.0,
    );
    // Fresnel rim. On a tube this lights both long edges, which is what gives
    // the reference body its glass-like read against the dark ground.
    let ps_fres = pow(1.0 - clamp(dot(ps_N, ps_V), 0.0, 1.0), 3.2);
    // Both dialled back from the values fitted when this body was meant to read
    // as WARM WHITE. It is teal now (measured off the reference), and a white
    // rim covering most of a thin tube simply painted over that colour — the
    // body came out silver with teal only surviving at the head.
    let ps_body =
        ${view}.lightColor * vec3<f32>(1.0, 0.98, 0.93) * ps_aniso * 0.09
      // The rim is WARM white, not cyan. A cyan rim covers most of a thin tube
      // on screen and dragged the whole body to B/R 1.05 against the reference's
      // 0.77 — the cyan belongs only at the head and tail.
      // Both of these are WHITE and do not scale with albedo, which is what was
      // bleaching the body: with them zeroed it measured G/R 2.06 / B/R 1.48
      // against the reference's 1.80 / 1.62, and with them at their old strength
      // 1.43 / 1.06. Halving the albedo had barely moved it — the colour was
      // never the problem.
      //
      // The reference does have one bright line along the top of the body, so
      // the aniso lobe stays — narrowed (exponent 64) and much weaker, so it
      // reads as a streak instead of a sheen. The fresnel rim is the broad one
      // and on a thin tube it covers nearly the whole silhouette; it keeps only
      // enough to round the edge.
      // THE ADDITIVE FRESNEL RIM IS GONE. The reference this body is fitted to
      // has a DARKER edge, not a brighter one — its cross-section measures
      // 181/225/230/179, so the silhouette is the dim part and that is what
      // makes a tube read as round. A white rim added at the edge does the
      // opposite: it flattens the tube into a lit outline. Replaced by a
      // multiplicative edge occlusion on the final colour, below.
      ;

    // Extremity tint. Measured off the reference: the body is near-white and
    // WARM through its middle — (239,225,184), B/R 0.77 — and the cyan is
    // confined to the head bulb and the tail tip. Ours used to be teal along its
    // whole length (B/R 1.04), which is most of why it read as a plastic pipe.
    // uv.y is the along-body parameter the ribbon writes (0 at the head, 1 at
    // the tail); on the head sphere it is latitude, which tints its crown and
    // chin and is fine because that mesh is cyan to begin with.
    // uv.y is a HEAD MASK written by the ribbon: 1 at the tip, falling to 0 over
    // the same world distance the bulb occupies. Keyed to normalised position
    // instead, the tint and the bulb were different sizes and the head read as a
    // stopper stuck on a bottle neck.
    let ps_head = clamp(in_1.uv.y, 0.0, 1.0);
    // Full tint out to u = 0.35, which is 0.88 world units — the bulb's widest
    // point is at 0.62. smoothstep(0.15, 0.85) put full tint only inside 0.2
    // units, so the cyan sat on the very tip while the bulb behind it stayed
    // pale, and the head read as a stopper rather than as a head.
    let ps_endTint = mix(vec3<f32>(1.0), vec3<f32>(0.42, 0.90, 0.93),
                         smoothstep(0.0, 0.35, ps_head) * 0.80);

    // Warm correction, FITTED rather than derived — stated plainly because it is
    // the one term here that is not physics.
    //
    // The body measured B/R 0.93 against the reference's 0.77, and the excess is
    // additive: cutting the albedo's blue by 21% moved the render by 0.04, and
    // lowering F0 to 0.008 moved it another 0.02. Chasing the remaining source
    // cost three rounds and each candidate (aerial perspective, SH ambient, IBL
    // specular) was falsified by A/B. The reference's body is warm white; this
    // scales blue to land on it. Same class of decision as the flattened
    // Rayleigh beta in space.wgsl: fitted to the footage, not to a derivation.
    // The scale is far below the ratio it has to produce, because it acts BEFORE
    // the tonemap: at these levels the body sits in Reinhard's compressed region,
    // where a 17% cut pre-tonemap moved the displayed value by 6%.
    // NEUTRAL. This used to be (1.0, 0.925, 0.565) — a blue-killing warm
    // correction fitted to a "reference body B/R 0.77" that turns out to have
    // been measured off something other than the player snake: f01/f04/f09 put
    // it at B/R 1.15-1.62, a saturated teal. Cutting blue by 44% was fighting
    // the albedo, so it goes.
    let ps_warmBody = vec3<f32>(1.0, 1.0, 1.0);
    // BODY only. Multiplied across the whole tube it also hit the head, whose
    // cyan lives in the blue channel — the bulb came out pale celery and
    // stopped reading as a head. The head mask already exists; gate on it.
    let ps_warm = mix(ps_warmBody, vec3<f32>(1.0), smoothstep(0.05, 0.45, ps_head));
` : '    let ps_body = vec3<f32>(0.0);'}
${p.spray ? `
    // ── airborne grain (the reference spray.fragment.wgsl) ───────────────────────
    // The grain is a DISC, not the quad it is drawn on. Everything crude about
    // the old spray came from skipping this: hard square corners, no falloff,
    // and a fade done by shrinking a solid stamp.
    let ps_r = ps_sprayR(in_1.uv, in_1.worldTangent.xyz);
    if (ps_r > 1.0) { discard; }
    // Soft powder edge. Their harder "clod" variant needs a per-grain kind
    // channel, and the instance transform has no spare slot to carry one — the
    // w row is load-bearing for the projection — so this is powder only, which
    // is the read that dominates their footage anyway.
    let ps_edge = pow(clamp(1.0 - ps_r * ps_r, 0.0, 1.0), 1.6);
    // Deliberately low. "Powder is close to transparent on its own; density has
    // to come from many grains overlapping, or a single one turns into a decal."
    let ps_alpha = ps_edge * 0.38;
    if (ps_alpha < 0.004) { discard; }

    // Forward scatter: looking through the puff toward the sun it is BRIGHTER
    // than what is behind it and warm; down-sun it is a dim grey. That swing is
    // "the entire difference between spray catching the light and grey smoke".
    // The coefficient stays small on purpose — a phase function is normalised
    // over the sphere, and using it as a bare multiplier on radiance overstates
    // the peak by an order of magnitude and clips the grain to flat white.
    let ps_mu = dot(-ps_V, ps_L);
    let ps_fwd = ps_sprayHG(ps_mu, 0.55) * 0.85;
    let ps_scatter = ${view}.lightColor * ps_albedo * ps_fwd * mix(0.25, 1.0, ps_shadow);
` : '    let ps_scatter = vec3<f32>(0.0);'}
${p.spout ? `
    // ── lifted water ────────────────────────────────────────────────────────
    // Fresnel does nearly all the work. A tube of water in the air is dark
    // through its belly and bright along every edge where the view grazes it —
    // get that wrong and it reads as a coloured plastic pipe, which is exactly
    // what the reference's water note warns about.
    let ps_fade = clamp(in_1.worldTangent.w, 0.0, 1.0);
    // Rim exponent RAISED and weight cut hard. On a tube this thin nearly every
    // pixel is a grazing pixel, so a broad fresnel covers the entire silhouette
    // and the helix comes out as a white ribbon — the same failure this project
    // already recorded for the snake's own body rim. Narrow it and let the
    // water's own colour carry the body of the tube.
    let ps_rim = pow(1.0 - clamp(dot(ps_N, ps_V), 0.0, 1.0), 5.0);
    let ps_spout = vec3<f32>(0.80, 0.95, 1.00) * ps_rim * 0.42
                 + vec3<f32>(0.24, 0.52, 0.70) * 0.58;
` : ''}${p.ribbon ? `
    // ── bent water ──────────────────────────────────────────────────────────
    // Three terms, and the order of the argument matters more than the numbers:
    // a colour you look THROUGH, a fresnel edge, and foam on top of both.
    let ps_fade = clamp(in_1.worldTangent.w, 0.0, 1.0);
    let ps_foam = clamp(in_1.uv.y, 0.0, 1.0);
    // Narrow, like the spout's and for the same reason: on a tube this thin
    // almost every pixel is a grazing pixel, so a broad fresnel covers the whole
    // silhouette and the body comes out white — which is exactly the failure
    // this variant exists to fix.
    let ps_rim = pow(1.0 - clamp(dot(ps_N, ps_V), 0.0, 1.0), 4.0);
    // Scaled to CARRY the shading rather than tint it. The standard terms are
    // still summed underneath, and a red-substitution test proved the graft was
    // live all along — the stream was white because ps_lit on a mid-blue albedo
    // already reaches white under this sun, so a 0.1-0.5 water tint added on top
    // changed nothing. The albedo is now nearly black (see the material) and the
    // colour arrives entirely from here.
    let ps_deep = vec3<f32>(0.16, 0.55, 0.80);
    let ps_shal = vec3<f32>(0.52, 1.05, 1.25);
    // Thin water is paler than thick water — the fade channel doubles as a
    // rough optical depth, so the drained tail lightens as it goes.
    let ps_water = mix(ps_deep, ps_shal, clamp(0.35 + 0.45 * (1.0 - ps_fade), 0.0, 1.0));
    let ps_ribbon = ps_water
                  + vec3<f32>(0.62, 0.80, 0.92) * ps_rim * 0.55
                  + vec3<f32>(0.90, 0.96, 1.00) * ps_foam * 0.85;
` : ''}${p.skin ? `
    // ── shed skin ───────────────────────────────────────────────────────────
    // It DESICCATES rather than fades. A skin that just dissolves reads as a
    // despawning effect; one that drains toward parchment, goes translucent and
    // keeps its shape reads as something that was left behind. The alpha is
    // what finally takes it, and it goes last.
    let ps_life = clamp(in_1.worldTangent.w, 0.0, 1.0);
    let ps_dry = 1.0 - ps_life;
    // The peel seam. One narrow bright band running head to tail, and the only
    // moment this material is allowed a highlight — everything else about a
    // shed skin is dull by definition.
    let ps_seam = clamp(in_1.uv.y, 0.0, 1.0);
    let ps_seamGlow = vec3<f32>(0.62, 1.00, 0.86) * pow(ps_seam, 1.6) * 5.5;
` : ''}
    // ── the moon ────────────────────────────────────────────────────────────
    // A fixed direction, as a compile-time constant, and that is legal here for
    // one reason: THE SUN NEVER MOVES in this game, so neither does the moon.
    // The forward pass has no clock and no per-frame material update, so a
    // literal is the only way directional light can exist in it at all.
    //
    // The night had no directional light of any kind — a documented round killed
    // all of it to stop a speckle artefact, and what was left (sky ambient plus a
    // flat albedo floor) has no direction, so nothing on the night side had form.
    // It was not night, it was the day dimmer.
    //
    // GRASS READS THE MOON WITH THE GROUND'S NORMAL, not its own. That speckle
    // round measured high-frequency energy going 2.27 -> 1.00 when normal-
    // dependent night light was gated off, and a moon is exactly that light
    // coming back. A blade is a thing growing out of a surface; it takes that
    // surface's moonlight, the same argument the ambient normal already makes.
    let ps_moonN = ${p.grass ? 'normalize(in_1.worldPos)' : 'ps_N'};
    // About 24 degrees off anti-sun, so the moon's terminator does not mirror
    // the sun's and the two never draw the same line.
    let ps_moonDir = normalize(vec3<f32>(-0.20, -0.72, -0.66));
    let ps_moonColor = vec3<f32>(0.36, 0.44, 0.60);
    // 0.16 is a CEILING, not a taste value. The speckle it guards against came
    // from wrap 3.2 and sss 2.4 riding a light colour near 7; this is two orders
    // below that, and it is the tripwire if the artefact ever returns.
    let ps_moon = ps_duskAlbedo * ps_moonColor
                * max(dot(ps_moonN, ps_moonDir), 0.0) * (1.0 - ps_horizon) * 0.16;
${p.snake ? `    // Night self-glow. ref0 帧里夜面的蛇是全场最亮的物体——整条发光，
    // 不只是边缘。material 的 emissive 到不了这里（graft 换掉了整个 return），
    // 所以光在尾部自己加。乘 albedo 是既有原则：白光会把暗面洗灰，按底色染色
    // 才保得住青绿。ps_sunless 让它只在夜面亮起，白天完全不参与。
    let ps_selfGlow = ps_albedo * 0.55 * ps_sunless;
    // The snake has to be the brightest silhouette at night rather than the
    // hardest thing to find. Narrow, cool, and night-only.
    let ps_nightRim = ps_moonColor * pow(1.0 - clamp(dot(ps_N, ps_V), 0.0, 1.0), 4.0) * (1.0 - ps_horizon) * 0.10;
` : ''}    let ps_night = ps_duskAlbedo * ${p.nightFloor ?? 0} * ps_sunless * ps_nightGrade;
    // The snake's edge, DARKENED rather than lit. 0.20 lands the silhouette on
    // the reference's 179 against a 225-230 middle; the 1.5 exponent keeps the
    // loss near the edge instead of dimming the whole body. CLAMPED: on a
    // back-facing pixel the dot goes negative, pow of a value above one runs
    // away, and the occlusion would come out NEGATIVE.
    let ps_edgeOcclusion = 1.0 - 0.20 * pow(1.0 - clamp(dot(ps_N, ps_V), 0.0, 1.0), 1.5);
    let ps_final = (ps_lit + ps_wrapLight + ps_ambient + ps_sss * ps_albedo + ps_night + ps_moon${p.snake ? ' + ps_nightRim + ps_selfGlow' : ''} + ps_body + ps_scatter${p.skin ? ' + ps_seamGlow' : ''}${p.spout ? ' + ps_spout' : ''}${p.ribbon ? ' + ps_ribbon' : ''}) * ps_caveTint${p.snake ? ' * ps_endTint * ps_warm * ps_edgeOcclusion' : ''};
    // Backstop. Everything above is guarded individually, but a NaN reaching the
    // framebuffer is the single most expensive failure this project has had —
    // it cost two sessions as an unexplained "blocky RGB corruption" — so the
    // last statement checks for it outright. x != x is true only for NaN.
    let ps_bad = ps_final.x != ps_final.x || ps_final.y != ps_final.y || ps_final.z != ps_final.z;
    // Clamped as well as NaN-checked. A finite but per-channel-wild value paints
    // the same hue sweep a NaN does, and the x != x check is one a compiler is free
    // to fold away under fast-math assumptions — so the bound does the work the
    // predicate might not.
    let ps_safe = clamp(select(ps_final, ps_albedo * 0.15, ps_bad), vec3<f32>(0.0), vec3<f32>(12.0));
${p.ribbon
    ? '    // Premultiplied. A body of water is mostly OPAQUE where it is thick and\n'
      + '    // turns glassy only at its drained ends — the first pass rode the same\n'
      + '    // fresnel-weighted alpha the spout uses and the stream read as a sheet\n'
      + '    // of cling film you could see the terrain through.\n'
      + '    let ps_ribA = clamp(0.62 + 0.22 * ps_rim + 0.16 * ps_foam, 0.0, 1.0) * ps_fade;\n'
      + '    if (ps_ribA < 0.004) { discard; }\n'
      + '    return vec4<f32>(ps_safe * ps_ribA, ps_ribA);'
    : p.spout
    ? '    // Premultiplied, and the alpha rides the fade channel so a helix can\n'
      + '    // rise and retire without the mesh being rebuilt around it.\n'
      + '    let ps_spoutA = clamp(0.24 + 0.40 * ps_rim, 0.0, 1.0) * ps_fade;\n'
      + '    if (ps_spoutA < 0.004) { discard; }\n'
      + '    return vec4<f32>(ps_safe * ps_spoutA, ps_spoutA);'
    : p.skin
    ? '    // Translucency is the LAST thing to go, and it is driven by the same\n'
      + '    // life channel as the drying. Premultiplied, matching the blend state.\n'
      + '    let ps_skinA = clamp(0.30 + 0.62 * ps_life, 0.0, 1.0);\n'
      + '    return vec4<f32>(ps_safe * ps_skinA, ps_skinA);'
    : p.spray
    ? '    // PREMULTIPLIED. The blend state is (one, one-minus-src-alpha), so the\n'
      + '    // colour has to arrive already scaled by alpha; handing it straight\n'
      + '    // through would make every grain as bright as an opaque one.\n'
      + '    return vec4<f32>(ps_safe * ps_alpha, ps_alpha);'
    : '    return vec4<f32>(ps_safe, material.baseColor.w);'}
`;
}

/**
 * Splice PCSS into the composed source's directional-shadow kernel. Returns the
 * new source, or undefined if any anchor moved — in which case the caller keeps
 * the stock material rather than shipping a half-applied graft.
 */
function installPcss(src: string, soft: number): string | undefined {
  const sm = src.match(/var\s+(shadowMapX_naga_oil_mod_X\w+)\s*:\s*texture_depth_2d;/);
  if (!sm) {
    console.warn('[planet-snake] pcss: shadow map global not found');
    return undefined;
  }
  const SM = sm[1];

  const fn = `
/// Blocker search -> penumbra radius, as a multiple of the base kernel offset.
///
/// Eight taps on a ring, read with textureLoad: no comparison sampler and no
/// derivative, which also makes it safe in divergent control flow (an
/// implicit-LOD sample there is undefined behaviour, and in this project that
/// failure mode produced whole screens of blocky RGB garbage).
///
/// The light is DIRECTIONAL, so its shadow projection is orthographic and the
/// textbook (dRecv - dBlocker) / dBlocker ratio does not apply — under a parallel
/// light the penumbra grows with the raw gap, not with its ratio to the blocker's
/// distance. So the difference is used directly, with the sun's angular size and
/// the cascade's depth range folded into one fitted constant.
const PS_PCSS_SEARCH : f32 = 3.5;
const PS_PCSS_SOFT : f32 = ${soft};
const PS_PCSS_MAX : f32 = 5.0;

fn ps_pcssRadius(uv : vec2<f32>, texel : vec2<f32>, recv : f32,
                 lo : vec2<f32>, hi : vec2<f32>) -> f32 {
  let dims = vec2<f32>(textureDimensions(${SM}, 0));
  var sum = 0.0;
  var n = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    let a = f32(i) * 0.7853981634;
    let o = vec2<f32>(cos(a), sin(a)) * texel * PS_PCSS_SEARCH;
    let p = clamp(uv + o, lo, hi);
    let d = textureLoad(${SM}, vec2<i32>(p * dims), 0);
    let isBlocker = d < recv;
    sum = sum + select(0.0, d, isBlocker);
    n = n + select(0.0, 1.0, isBlocker);
  }
  // No blocker: keep the base kernel. Written with select rather than an early
  // return so the taps above stay in uniform control flow.
  let avg = sum / max(n, 1.0);
  return select(1.0, clamp(1.0 + (recv - avg) * PS_PCSS_SOFT, 1.0, PS_PCSS_MAX), n > 0.5);
}
`;

  // The function has to be declared before the lighting code that calls it, and
  // WGSL has no forward declarations — so it goes immediately after the shadow
  // sampler global, which is the last of the bindings it depends on.
  const ssLine = src.match(/var\s+shadowSamplerX_naga_oil_mod_X\w+\s*:\s*sampler_comparison;/);
  if (!ssLine) {
    console.warn('[planet-snake] pcss: shadow sampler global not found');
    return undefined;
  }
  let out = src.replace(ssLine[0], `${ssLine[0]}\n${fn}`);

  const anchor = 'let halfI = i32(half);';
  const offs = 'let offsetUv = clamp((uv_2 + (vec2<f32>(f32(_e131), f32(_e133)) * texel_1)), tileLo, tileHi);';
  if (!out.includes(anchor) || !out.includes(offs)) {
    console.warn('[planet-snake] pcss: kernel anchors moved — keeping stock PCF');
    return undefined;
  }
  out = out
    .replace(anchor, `${anchor}\n    let ps_pen = ps_pcssRadius(uv_2, texel_1, adjustedDepth, tileLo, tileHi);`)
    .replace(offs, 'let offsetUv = clamp((uv_2 + (vec2<f32>(f32(_e131), f32(_e133)) * texel_1 * ps_pen)), tileLo, tileHi);');
  return out;
}

/**
 * Build the grafted source and register it. Returns the identifier on success,
 * or undefined when anything about the graft did not hold — in which case the
 * caller keeps the stock material rather than rendering something broken.
 *
 * Idempotent per page load: the registry rejects a same-name re-register
 * outright, which HMR would otherwise trip on every save.
 */
const installedIds = new Set<string>();

export function installGraftedShader(
  renderer: Renderer | undefined,
  id: string,
  params: GraftParams,
): string | undefined {
  if (renderer === undefined) return undefined;
  if (installedIds.has(id)) return id;

  const found = findMaterialArtifact(renderer, BASE_ID);
  if (!found?.ok) {
    console.warn('[planet-snake] terrain shader: base material not found');
    return undefined;
  }
  let src: string = found.value.source;

  if (params.pcss) {
    // PCSS, grafted into the engine's own cascaded shadow path rather than
    // replacing it. The engine already computes the cascade, the bias and the
    // tile bounds; the only thing missing is that its PCF kernel is a FIXED
    // radius, so every shadow edge in the frame has the same hardness however
    // far the caster is from the surface. That uniform hardness is what made the
    // first attempt at enabling shadows here read as wrong.
    //
    // The graft is two lines. A blocker search runs once per pixel right after
    // `halfI` — the last value computed before the kernel loop, so everything it
    // needs is already in scope — and the loop's tap offset is scaled by the
    // radius it returns. The kernel, the taps, the bias and the tile clamp all
    // remain the engine's.
    //
    // This runs BEFORE fs_main is located: it edits the mangled lighting
    // function, which sits earlier in the source, and splicing after the offsets
    // were taken would leave every later index pointing at the wrong character.
    // OPTIONAL, and it must stay optional. `installPcss` already warns and
    // returns undefined when the engine's PCF kernel moves out from under the
    // anchors — its own message is "keeping stock PCF", which is the whole
    // intent: softer shadow edges are an enhancement, not a prerequisite.
    // Aborting the graft here contradicted that message and cost the entire
    // shader. The engine bump to b2e0503a moved those anchors, so the surface
    // graft returned undefined, `withShader` fell through to the stock
    // material, and that material is `baseColor [1,1,1,1]` because EVERY
    // colour on this planet — biome, water depth, beach, foam, ice — is
    // decided by the graft. The whole world rendered pure white, and the only
    // console evidence was a warning that said the fallback was fine.
    //
    // Bridge rule: a failed optional enhancement degrades only itself. It must
    // never make the whole material graft return undefined.
    const pcssed = installPcss(src, params.pcssSoft ?? 90);
    if (pcssed) src = pcssed;
  }

  // naga_oil mangles module globals per composition, so the view uniform's name
  // has to be read out of the source rather than assumed.
  const viewName = src.match(/var<uniform>\s+(viewX_naga_oil_mod_X\w+)\s*:/)?.[1];
  if (!viewName) {
    console.warn('[planet-snake] terrain shader: could not locate the view global');
    return undefined;
  }

  // Anchor on the final return of fs_main. fs_gbuffer has its own return and
  // must not be touched, so the search is bounded to the fs_main body.
  const fsStart = src.indexOf('fn fs_main');
  const fsEnd = src.indexOf('@fragment', fsStart + 1);
  if (fsStart < 0 || fsEnd < 0) {
    console.warn('[planet-snake] terrain shader: fs_main not found');
    return undefined;
  }
  const body = src.slice(fsStart, fsEnd);
  // The engine's fs_main tail moved. It used to end `return vec4<f32>(color, alpha);`,
  // which this graft replaced wholesale with tailWgsl. The current codegen finishes
  // `color`, runs it through applySceneFog, and returns the fogged temp:
  //   let _eN = <view>; let _eM = color; let _eP = applySceneFog(_eN, _eM, alpha, in.worldPos); return _eP;
  // tailWgsl owns the return and rebuilds the output from `color` (still in scope
  // above this block), so anchoring on — and replacing — the whole fog+return tail
  // both restores the graft and drops the now-unused fog temps. Keep the legacy
  // vec4 form as a fallback so an engine that reverts still grafts.
  const retMatch =
    body.match(
      /\n\s*let _e\d+ = \w+;\n\s*let _e\d+ = color;\n\s*let _e\d+ = applySceneFog\([^;]*\);\n\s*return _e\d+;\n/,
    ) ?? body.match(/\n\s*return vec4<f32>\([^\n]*\);\n/);
  if (!retMatch) {
    console.warn('[planet-snake] terrain shader: fs_main return not found');
    return undefined;
  }
  let newBody = body.replace(retMatch[0], `\n${tailWgsl(viewName, params)}\n`);
  let prelude = '';

  if (params.surface) {
    // Three single-line splices inside fs_main, each unique in the composed
    // source. Taking albedo/roughness/normal at their point of ORIGIN rather
    // than correcting the finished colour afterwards is what keeps the engine's
    // own shadows, IBL and light loop doing their job on procedural values —
    // rewriting the result would have meant re-implementing all of it.
    // naga_oil emits SSA: `material.baseColor.rgb * baseSample.rgb` arrives as
    // `(_e22.xyz * _e13.xyz)` and applyTBN carries a mangled module suffix, so
    // the anchors match the SHAPE of each statement rather than its authored
    // text. Each is verified to fire; a miss aborts the graft rather than
    // silently registering a shader that ignores half of what it was asked for.
    // The water-patch variant reuses every splice point with three different
    // right-hand sides — see GraftParams.water.
    const w = params.water === true;
    const splices: [RegExp, string][] = [
      [
        /let albedo = \(+_e\d+\.xyz \* _e\d+\.xyz\)(?: \* _e\d+\.xyz\))*;/,
        w
          ? 'let ps_surf = ps_surface(IN.worldPos, IN.worldNormal);\n  if (ps_landField(normalize(IN.worldPos)) > -0.0015) { discard; }\n  let ps_wfade = clamp(IN.worldTangent.w, 0.0, 1.0);\n  let albedo = ps_surf.albedo;'
          : 'let ps_surf = ps_surface(IN.worldPos, IN.worldNormal);\n  let albedo = ps_surf.albedo;',
      ],
      [/\n(\s*)a = max\(_e\d+, 0\.04f\);/,
       w ? '\n$1a = mix(max(ps_surf.rough, 0.04f), 0.38f, ps_wfade);'
         : '\n$1a = max(ps_surf.rough, 0.04f);'],
      // The IBL path keeps its own copy of roughness, so water needs both or it
      // stays matte in the reflection while being mirror-smooth in the direct
      // highlight.
      [/let iblRoughness = \(max\(_e\d+, 0\.04f\) \* _e\d+\);/,
       w ? 'let iblRoughness = mix(max(ps_surf.rough, 0.04f), 0.38f, ps_wfade);'
         : 'let iblRoughness = max(ps_surf.rough, 0.04f);'],
      [/let (_e\d+) = applyTBN\w*\([^;]*\);/, 'let $1 = ps_surf.nrm;'],
      // Dielectric F0, per pixel. Left at the stock 0.04 the terrain carries a
      // uniform sheen that swamps a dark albedo; see PsSurface.spec.
      [/let (f0_\w+) = mix\(\(vec3\(0\.04f\) \* specularTint\), albedo, \w+\);/,
       w ? 'let $1 = vec3<f32>(mix(ps_surf.spec, 0.048f, ps_wfade));'
         : 'let $1 = mix(vec3<f32>(ps_surf.spec), albedo, 0.0);'],
    ];
    const paramName = body.match(/fn fs_main\s*\(\s*(\w+)\s*:/)?.[1] ?? 'in_1';
    for (const [re, to] of splices) {
      if (!re.test(newBody)) {
        console.warn(`[planet-snake] surface splice missed: ${re}`);
        return undefined;
      }
      newBody = newBody.replace(re, to.replace(/\bIN\b/g, paramName));
    }
    prelude = surfaceModuleWgsl();
  } else {
    if (params.specF0 !== undefined) {
      const f0re = /let (f0_\w+) = mix\(\(vec3\(0\.04f\) \* specularTint\), albedo, \w+\);/;
      if (f0re.test(newBody)) {
        newBody = newBody.replace(f0re, `let $1 = vec3<f32>(${params.specF0});`);
      } else {
        console.warn('[planet-snake] specF0 splice missed');
      }
    }
    // applyTBN is replaced on EVERY variant, not just the procedural surface.
    //
    // It normalises the interpolated tangent, and the bots' body segments are
    // sphere meshes whose tangent attribute is degenerate — normalize() of that
    // returns NaN, the shading normal goes NaN, and every term downstream
    // follows, so the engine's own `color` arrives NaN and the segment renders as
    // saturated garbage. The material-level NaN backstop could not help: it falls
    // back TO `color`, which was the poisoned value.
    //
    // None of these materials carries a normal map, so the tangent frame buys
    // nothing here; the interpolated world normal is the whole answer. The
    // degenerate case is routed to +Y rather than normalized, because a NaN
    // comparison is false and must land on the safe branch.
    const nMatch = /let (_e\d+) = applyTBN\w*\([^;]*\);/;
    if (nMatch.test(newBody)) {
      newBody = newBody.replace(nMatch, params.spray
        // The ENGINE's own diffuse has to see the spherical normal too, not just
        // this graft's tail — that is what gives a grain a lit and a dark side
        // instead of one flat shade across the disc.
        ? 'let $1 = ps_sprayNormal(in_1.uv, select(vec3<f32>(0.0, 1.0, 0.0), normalize(in_1.worldNormal), dot(in_1.worldNormal, in_1.worldNormal) > 1e-12), in_1.worldTangent.xyz);'
        : 'let $1 = select(vec3<f32>(0.0, 1.0, 0.0), normalize(in_1.worldNormal), dot(in_1.worldNormal, in_1.worldNormal) > 1e-12);');
    } else {
      console.warn('[planet-snake] normal splice missed on a non-surface variant');
    }
    if (params.spray) prelude = sprayModuleWgsl();
  }

  // WGSL has no forward declarations, so the surface functions have to land
  // above fs_main — immediately before its `@fragment` attribute.
  const attrIdx = src.lastIndexOf('@fragment', fsStart);
  const cut = prelude && attrIdx >= 0 ? attrIdx : fsStart;
  let grafted =
    src.slice(0, cut) +
    (prelude ? `${prelude}\n\n` : '') +
    src.slice(cut, fsStart) +
    newBody +
    src.slice(fsEnd);

  // Collapse the extra UV sets.
  //
  // VsIn declares locations 0-3 (pos/normal/uv/tangent) AND 6-12 (uv1..uv7).
  // Our procedural meshes are the 12-float layout — locations 0-3 only — so a
  // pipeline built from this source against them fails validation with
  // "Vertex attribute slot 12 used in vs_main is not present in the VertexState".
  //
  // The stock material survives that because it is a MULTI-VARIANT shader: the
  // pipeline key in the error carries #CLUSTER_FORWARD_AVAILABLE /
  // #STORAGE_BUFFER_AVAILABLE, and findMaterialArtifact hands back exactly one
  // composed variant. Registering that single variant under a new identifier
  // loses the engine's variant selection, so the source has to be made valid for
  // the only vertex layout this game actually uses.
  //
  // Nothing is lost: every mesh here carries one UV set, so uv1..uv7 could only
  // ever have resolved to it anyway. The material's per-texture "coordinates"
  // selectors still work — they now all select the same set.
  let seenUvCopy = false;
  grafted = grafted
    .replace(/\s*@location\((?:6|7|8|9|10|11|12)\)\s+uv[1-7]_:\s*vec2<f32>,/g, '')
    .replace(/\b(in(?:_\d+)?|out(?:_\d+)?)\.uv[1-7]_\b/g, '$1.uv')
    // Keep the FIRST uv copy, drop the duplicates. The previous form deleted
    // every one of them — including the original `out.uv = in.uv;` that the
    // stock vertex shader needs — so VsOut.uv was never assigned and every
    // grafted material read uv as ZERO. It went unnoticed because the surface
    // shader keys off worldPos; it surfaced the moment the ribbon started
    // carrying a head mask in uv.y and the mask arrived as a constant 0.
    .replace(/^([ \t]*)out(?:_\d+)?\.uv\s*=\s*in(?:_\d+)?\.uv;[ \t]*$/gm, (m) => {
      if (seenUvCopy) return '';
      seenUvCopy = true;
      return m;
    });
  // fs_temporal calls projectPbrSceneTemporal with struct members (`in_N.uv`,
  // `in_N.uv1_`, …). After the member-access collapse above they all become
  // `in_N.uv` — collapse the trailing run to exactly two args (uv0 + uv1).
  grafted = grafted.replace(
    /(projectPbrSceneTemporal\w*\([\s\S]*?, in_\d+\.uv, in_\d+\.uv)(?:, in_\d+\.uv)+(\))/g,
    '$1$2',
  );
  // Functions that take uv0_..uv7_ as separate parameters become invalid once
  // uv1_..uv7_ are renamed to `uv`. Collapse to uv0_ + uv1_ before that rename.
  grafted = grafted.replace(
    /fn (transformedPbrTemporalUv\w*)\(([^)]*)\) -> vec2<f32> \{([\s\S]*?)\n\}/g,
    (_, fnName, params, body) => {
      const newParams = params.replace(/, uv[2-7]_: vec2<f32>/g, '');
      const newBody = body.replace(/\buv[2-7]_\b/g, 'uv1_');
      return `fn ${fnName}(${newParams}) -> vec2<f32> {${newBody}\n}`;
    },
  );
  grafted = grafted.replace(
    /fn (projectPbrSceneTemporal\w*)\(([^)]*)\)/g,
    (_, fnName, params) => `fn ${fnName}(${params.replace(/, uv[2-7]_\d+: vec2<f32>/g, '')})`,
  );
  grafted = grafted.replace(
    /(transformedPbrTemporalUv\w*|projectPbrSceneTemporal\w*)\(([^)]*)\)/g,
    (match, fnName, args) => {
      if (match.startsWith('fn ')) return match;
      return `${fnName}(${args.replace(/, uv[2-7]_\d+/g, '')})`;
    },
  );
  grafted = grafted.replace(/\buv[1-7]_\b/g, 'uv');
  const dedupeStructUvFields = (blk: string): string => {
    let seen = false;
    return blk
      .split('\n')
      .filter((line) => {
        if (!/@location\(\d+\) uv: vec2<f32>,/.test(line)) return true;
        if (seen) return false;
        seen = true;
        return true;
      })
      .join('\n');
  };
  // VsOut and TemporalVsOut both pick up duplicate `uv` fields after the global
  // rename above — dedupe both or WebGPU rejects the module as invalid WGSL.
  grafted = grafted.replace(/struct VsOut \{[\s\S]*?\n\}/, dedupeStructUvFields);
  grafted = grafted.replace(/struct TemporalVsOut \{[\s\S]*?\n\}/, dedupeStructUvFields);

  try {
    installMaterialArtifact(renderer, id, {
      source: grafted,
      paramSchema: found.value.paramSchema ?? [],
    });
  } catch (e) {
    if (isEngineBridgeContractError(e)) throw e;
    console.error(`[planet-snake] graft ${id} install failed:`, (e as Error)?.message ?? e);
    return undefined;
  }
  installedIds.add(id);
  return id;
}

/**
 * The two grafts this game uses. Terrain is a deep body — narrow transmission
 * lobe, strongly blue-shifted. Flesh is a thin one, which is what makes the
 * snake read as translucent when the sun is behind it.
 */
export function installGrafts(
  renderer: Renderer | undefined,
  sky: { sunDir: readonly [number, number, number]; planetRadius: number; atmosRadius: number; sunIntensity: number },
): { terrain?: string; flesh?: string; surface?: string; body?: string; prop?: string; water?: string; spray?: string; skin?: string; spout?: string; ribbon?: string; grass?: string } {
  // One 64x32 reduction at boot. The sun does not move in this game, so this
  // never needs recomputing — which is why the coefficients can be inlined as
  // shader constants rather than shipped through a uniform.
  const sh = solveSkySh(sky.sunDir, sky.planetRadius, sky.atmosRadius, sky.sunIntensity);
  return {
    // Grass blades and bot bodies. `ambient` 1.0 -> 0.50: past the terminator
    // sky ambient is the ONLY light, and at 1.0 against the ground's 0.45 every
    // blade came out more than twice as bright as the soil it stands in —
    // thousands of pale slivers over dark ground, which is the "亮光点点" half
    // of the night-side complaint. Matching the ground is what makes grass
    // disappear into the dark the way grass does.
    terrain: installGraftedShader(renderer, 'forgeax::planet-snake-terrain', {
      thickness: 0.55, wrap: 3.2, sss: 2.4, cave: 0.34, sh, ambient: 0.50, nightFloor: 0.02,
      nightFade: 0.30,
    }),
    flesh: installGraftedShader(renderer, 'forgeax::planet-snake-flesh', {
      thickness: 0.12, wrap: 2.2, sss: 5.5, cave: 0.18, sh, ambient: 0.75, nightFloor: 0.02,
    }),
    // The snake body. Thin-material transmission plus the tangent-aligned
    // highlight; the head, the ribbon and the bots all share it.
    body: installGraftedShader(renderer, 'forgeax::planet-snake-body', {
      // sss started at 5.0, inherited from the `flesh` variant, and blew the body
      // to pure white (255,255,255 measured along the ribbon). thickness 0.10
      // puts the back-scatter exponent at 3.6, so the lobe is wide, and the view
      // uniform's lightColor already carries the light's intensity — the product
      // saturated over most of the tube. The highlight has to come from the
      // tangent-aligned lobe, not from transmission.
      thickness: 0.10, wrap: 0.40, sss: 0.62, cave: 0.0, sh, ambient: 0.20, specF0: 0.02,
      nightFloor: 0.025, snake: true,
    }),
    // The Maelstrom's lifted water. Thin, bright, almost all rim.
    spout: installGraftedShader(renderer, 'forgeax::planet-snake-spout', {
      thickness: 0.10, wrap: 0.8, sss: 1.6, cave: 0.0, sh, ambient: 0.5,
      specF0: 0.02, nightFloor: 0.0, spout: true,
    }),
    // The Ribbon's bent water. Wrap and sss well up: most of what you look at
    // is light that went INTO the stream and came out somewhere else, which is
    // the whole reason water reads as water and not as glass.
    // Every standard term turned DOWN, hard. ps_ribbon is added on top of
    // lit + wrap + ambient + sss, so generous values there mean the water's own
    // colour arrives on a surface that is already at full white and the stream
    // renders as a milky strip whatever hue you give it — measured, the foam
    // channel averaged 0.19 while the body was still blowing out, which ruled
    // the foam out and left the lighting. The colour has to come from
    // ps_ribbon; these only need to keep it from going black at night.
    ribbon: installGraftedShader(renderer, 'forgeax::planet-snake-ribbon', {
      thickness: 0.06, wrap: 0.22, sss: 0.26, cave: 0.0, sh, ambient: 0.13,
      specF0: 0.02, nightFloor: 0.0, ribbon: true,
    }),
    // Grass blades. Specular OFF — a grazing highlight on a quad seen edge-on is
    // a white sliver, and there are thousands of them.
    grass: installGraftedShader(renderer, 'forgeax::planet-snake-grass', {
      thickness: 0.10, wrap: 0.30, sss: 0.22, cave: 0.0, sh, ambient: 0.46,
      specF0: 0.0, nightFloor: 0.014, nightFade: 0.30, grass: true,
    }),
    // A shed skin. Thin-material transmission like the body it came from, but
    // with the body variant's anisotropic highlight and warm tint gone: the one
    // highlight a skin gets is the peel seam, and it is over in under a second.
    skin: installGraftedShader(renderer, 'forgeax::planet-snake-skin', {
      thickness: 0.16, wrap: 0.55, sss: 0.30, cave: 0.10, sh, ambient: 0.30,
      specF0: 0.010, nightFloor: 0.02, skin: true,
    }),
    // Airborne spray grains. Low ambient and no cave tint: what a grain reads
    // by is the sun through it (the forward-scatter lobe), and piling the
    // terrain variant's additive terms on top of a translucent speck just
    // washes it to grey — the exact failure the reference warns about.
    spray: installGraftedShader(renderer, 'forgeax::planet-snake-spray', {
      thickness: 0.06, wrap: 1.4, sss: 0.0, cave: 0.0, sh, ambient: 0.55,
      specF0: 0.02, nightFloor: 0.0, spray: true,
    }),
    // Surface props — rocks, trunks, canopies.
    //
    // Not the `terrain` variant, which they used to share with the grass. That
    // one is tuned for the planet's own huge surface and adds a lot on top of
    // the light loop (wrap 3.2, ambient 1.0, sss 2.4). On a small object filling
    // few pixels the sum lands high enough that Reinhard's compressed region
    // eats the saturation: MEASURED, a canopy authored at albedo G/R 2.31 came
    // out at 1.32 and a trunk authored at B/R 0.42 came out at 0.70 — every prop
    // rendered as pastel. The additive terms are dialled back here and the
    // dielectric F0 with them, since the stock 0.04 against a blue skylight is an
    // additive blue that does not scale with albedo (the same term that held the
    // snake's body at B/R 0.97; see specF0 above).
    prop: installGraftedShader(renderer, 'forgeax::planet-snake-prop', {
      thickness: 0.45, wrap: 2.2, sss: 1.4, cave: 0.22, sh, ambient: 0.42,
      specF0: 0.012, nightFloor: 0.03,
    }),
    // The planet itself: one sphere, one draw, every biome decided per pixel.
    surface: installGraftedShader(renderer, 'forgeax::planet-snake-surface', {
      thickness: 0.55, wrap: 3.2, sss: 2.4, cave: 0.10, sh, ambient: 0.45,
      // 0.055 -> 0.032: the moon puts back as shaped light what this took as flat.
      surface: true, nightFloor: 0.032, pcss: true,
    }),
    // The moving water sheet (src/water-patch.ts). Same tail, same field, same
    // lighting as `surface` — identical by construction wherever both draw the
    // sea — differing only at the three splice points GraftParams.water names.
    water: installGraftedShader(renderer, 'forgeax::planet-snake-water', {
      thickness: 0.55, wrap: 3.2, sss: 2.4, cave: 0.10, sh, ambient: 0.45,
      surface: true, water: true, nightFloor: 0.032, pcss: true,
    }),
  };
}

/**
 * Point a material's FORWARD pass at a grafted shader, leaving every other pass
 * alone. The shadow-caster pass in particular must stay on the stock module —
 * only fs_main was grafted, and a depth-only pass has no use for subsurface
 * shading anyway.
 *
 * `Materials.standard` hard-codes the module, but what it returns is a plain
 * POD, so rewriting it afterwards is the intended kind of edit rather than a
 * workaround.
 */
// biome-ignore lint/suspicious/noExplicitAny: MaterialAsset POD
export function withShader<T extends { passes: any[] }>(mat: T, shaderId: string | undefined): T {
  if (!shaderId) return mat;
  for (const p of mat.passes) {
    const isForward = p?.name === 'forward' || p?.name === 'Forward';
    if (isForward && p.program) p.program.module = shaderId;
  }
  return mat;
}
