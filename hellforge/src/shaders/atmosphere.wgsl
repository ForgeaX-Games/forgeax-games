#define_import_path hellforge_source::atmosphere

// Standard features receive display-encoded color. Native Fog applies depth
// haze before tonemap; this pass only attenuates the edges in linear light.
struct FullscreenOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
struct AtmosphereParams { vignette: f32, haze: f32, atmoTemp: f32, _pad: f32 };
@group(1) @binding(0) var screenTexture: texture_2d<f32>;
@group(1) @binding(1) var screenSampler: sampler;
@group(1) @binding(2) var<uniform> params: AtmosphereParams;
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> FullscreenOutput {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var out: FullscreenOutput;
  out.position = vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(xy.x, 1.0 - xy.y);
  return out;
}
@fragment fn fs_main(in: FullscreenOutput) -> @location(0) vec4<f32> {
  let color = textureSample(screenTexture, screenSampler, in.uv);
  let distance = length((in.uv - vec2<f32>(0.5, 0.42)) * vec2<f32>(1.15, 1.0));
  let attenuation = 1.0 - clamp(params.vignette, 0.0, 0.8) * smoothstep(0.32, 1.05, distance);
  return vec4<f32>(color.rgb * pow(attenuation, 1.0 / 2.2), color.a);
}
