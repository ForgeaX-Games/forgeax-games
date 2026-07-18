// cinema-post.wgsl — single-fragment cinematic post-process for cow-survivor.
//
// Pipeline shape (see src/render-pipeline.ts):
//   shadow -> skybox -> main -> bloom (HDR) -> cinema-post -> swap-chain
//
// The pass replaces both the engine's tonemap and FXAA — we sample the HDR
// `hdrComposited` (alias of hdrColor / bloom-composited rgba16float) and
// apply ACES filmic tonemap + vignette + radial chromatic aberration in one
// fragment, writing LDR to the swap-chain's rgba8unorm-srgb attachment (the
// engine handles the linear->sRGB encode on store).
//
// Why bake tonemap into the cinema pass: the engine's `addTonemapPass` is
// hardcoded to write to the swap-chain via a private storage-view path,
// leaving no slot for a downstream LDR effect that reads the post-tonemap
// frame. Folding tonemap into our own fragment is the cleanest way to keep
// total control over the LDR composition order — and ACES is ~10 lines.
//
// Knobs are baked in (the engine's per-pass param-UBO path is not yet
// plumbed through addFullscreenPass — fullscreen-post-process-pass.ts F-3
// dispatcher).

struct FullscreenOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i : u32) -> FullscreenOutput {
  var x : f32 = -1.0;
  var y : f32 = -1.0;
  if (i == 1u) { x = 3.0; }
  if (i == 2u) { y = 3.0; }
  let u : f32 = (x + 1.0) * 0.5;
  let v : f32 = 1.0 - (y + 1.0) * 0.5;
  var out : FullscreenOutput;
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>(u, v);
  return out;
}

@group(1) @binding(0) var screenTexture : texture_2d<f32>;
@group(1) @binding(1) var screenSampler : sampler;

// — knobs ————————————————————————————————————————————————————————————————

const EXPOSURE          : f32 = 1.15;    // pre-tonemap multiplier
const VIGNETTE_STRENGTH : f32 = 0.55;    // 0..1 corner darkness
const VIGNETTE_INNER    : f32 = 0.45;    // < this distance untouched
const VIGNETTE_OUTER    : f32 = 1.05;    // > this distance fully dark
// Chromatic aberration: subtle. Each channel is sampled INDEPENDENTLY
// from the original screen texture (no shared blur step) so bright
// emissive HDR pixels don't smear a green ghost along the radial
// direction — the earlier "G-channel comes from a radial blur that R/B
// don't touch" bug. Offset is constant + clamped, so corners can't
// sample outside [0,1].
const CA_AMOUNT         : f32 = 0.0014;

// — ACES filmic tonemap (Krzysztof Narkowicz approximation) ————————————

fn aces(x : vec3<f32>) -> vec3<f32> {
  let a : f32 = 2.51;
  let b : f32 = 0.03;
  let c : f32 = 2.43;
  let d : f32 = 0.59;
  let e : f32 = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Linear -> sRGB gamma encode (the swap-chain view handles this on store
// for an `rgba8unorm-srgb` attachment, so the fragment writes linear values
// and the GPU encodes; no manual gamma here).

@fragment
fn fs_main(in : FullscreenOutput) -> @location(0) vec4<f32> {
  let center = vec2<f32>(0.5, 0.5);
  let toCenter = in.uv - center;
  let dist = length(toCenter);

  // No chromatic aberration / radial blur — those were producing colored
  // fringes around bright emissive objects, which read as buggy artifacts
  // (rightly so: HDR pixels exceed [0,1], so per-channel offset samples
  // amplify any color separation). The pass is now ONLY tonemap + vignette
  // — clean atmospheric layer that doesn't ghost objects. Skill / scene
  // shader effects live in their own materials, not in this pass.
  let hdr = textureSample(screenTexture, screenSampler, in.uv).rgb;

  // ACES tonemap (HDR -> LDR).
  let mapped = aces(hdr * EXPOSURE);

  // Vignette (post-tonemap so darker corners come from final luminance).
  let mask = smoothstep(VIGNETTE_INNER, VIGNETTE_OUTER, dist);
  let darken = 1.0 - VIGNETTE_STRENGTH * mask;

  return vec4<f32>(mapped * darken, 1.0);
}
