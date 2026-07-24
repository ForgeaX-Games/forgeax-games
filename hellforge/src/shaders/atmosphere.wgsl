// hellforge::atmosphere — HDR-chain vignette + haze (pre-tonemap).
//
// Graph placement (see src/render-pipeline.ts):
//   shadow* → skybox → main → bloom* → atmosphere → tonemap → fxaa
//
// Depth sampling under URP+tonemap is not available without engine work
// (plan §9). This pass uses screen-space radial vignette + vertical haze only.
//
// Writes rgba16float HDR into `hdrGraded`; engine tonemap/bloom stay intact.

struct FullscreenOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

struct AtmosphereParams {
  // 0..0.8 — corner darken strength (F10 暗角)
  vignette : f32,
  // 0..1 — vertical ash/haze strength (F10 雾气)
  haze : f32,
  // -1..1 — warm/cool shift for haze tint (F10 色温)
  atmoTemp : f32,
  _pad : f32,
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
@group(1) @binding(2) var<uniform> params : AtmosphereParams;

const VIGNETTE_INNER : f32 = 0.32;
const VIGNETTE_OUTER : f32 = 1.05;

@fragment
fn fs_main(in : FullscreenOutput) -> @location(0) vec4<f32> {
  let hdr = textureSample(screenTexture, screenSampler, in.uv).rgb;

  // Radial vignette (screen-space). Pre-tonemap multiply so bloom peaks at
  // center stay bright while edges fall toward black.
  let center = vec2<f32>(0.5, 0.42);
  let dist = length((in.uv - center) * vec2<f32>(1.15, 1.0));
  let vigMask = smoothstep(VIGNETTE_INNER, VIGNETTE_OUTER, dist);
  let vigStrength = clamp(params.vignette, 0.0, 0.8);
  var color = hdr * (1.0 - vigStrength * vigMask);

  // Vertical haze: vault darkening + horizon ash wash (replaces CSS #hf-rs-haze).
  let hazeStr = clamp(params.haze, 0.0, 1.0);
  let t = clamp(params.atmoTemp, -1.0, 1.0);
  let hazeColor = vec3<f32>(
    0.055 + 0.04 * t,
    0.018,
    0.010 - 0.006 * t,
  );
  let vault = smoothstep(0.0, 0.28, 1.0 - in.uv.y);
  let horizon = smoothstep(0.35, 0.72, in.uv.y) * (1.0 - smoothstep(0.78, 1.0, in.uv.y));
  let hazeW = hazeStr * clamp(0.55 * vault + 0.85 * horizon, 0.0, 1.0);
  color = mix(color, hazeColor, hazeW);

  return vec4<f32>(color, 1.0);
}
