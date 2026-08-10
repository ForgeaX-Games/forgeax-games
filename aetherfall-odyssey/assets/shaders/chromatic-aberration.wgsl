struct FullscreenOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct ChromaticParams {
  intensity: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> FullscreenOutput {
  var x = -1.0;
  var y = -1.0;
  if (index == 1u) { x = 3.0; }
  if (index == 2u) { y = 3.0; }
  var output: FullscreenOutput;
  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return output;
}

@group(1) @binding(0) var sceneTexture: texture_2d<f32>;
@group(1) @binding(1) var sceneSampler: sampler;
@group(1) @binding(2) var<uniform> params: ChromaticParams;

@fragment
fn fs_main(input: FullscreenOutput) -> @location(0) vec4<f32> {
  let shift = params.intensity;
  return vec4<f32>(
    textureSample(sceneTexture, sceneSampler, input.uv + vec2<f32>(shift, -shift)).r,
    textureSample(sceneTexture, sceneSampler, input.uv + vec2<f32>(-shift, 0.0)).g,
    textureSample(sceneTexture, sceneSampler, input.uv + vec2<f32>(0.0, shift)).b,
    1.0,
  );
}
