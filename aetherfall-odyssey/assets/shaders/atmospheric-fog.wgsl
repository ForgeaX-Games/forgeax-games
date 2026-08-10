struct Params {
  nearClip: f32,
  farClip: f32,
  density: f32,
  startDistance: f32,
  fogColor: vec3<f32>,
  maxOpacity: f32,
};

@group(1) @binding(0) var sceneColor: texture_2d<f32>;
@group(1) @binding(1) var sceneSampler: sampler;
@group(1) @binding(2) var<uniform> params: Params;
@group(1) @binding(3) var sceneDepth: texture_depth_2d;
@group(1) @binding(4) var depthSampler: sampler;

struct FullscreenOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn linearDepth(depth: f32) -> f32 {
  return params.nearClip * params.farClip /
    max(params.farClip - depth * (params.farClip - params.nearClip), 0.0001);
}

fn interleavedGradientNoise(position: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(position, vec2<f32>(0.06711056, 0.00583715))));
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOutput {
  var x = -1.0;
  var y = -1.0;
  if (vertexIndex == 1u) { x = 3.0; }
  if (vertexIndex == 2u) { y = 3.0; }
  var output: FullscreenOutput;
  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return output;
}

@fragment
fn fs_main(input: FullscreenOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sceneDepth, 0));
  let depthPosition = vec2<i32>(clamp(
    input.uv * vec2<f32>(dimensions),
    vec2<f32>(0.0),
    vec2<f32>(dimensions - vec2<i32>(1)),
  ));
  let depth = textureLoad(sceneDepth, depthPosition, 0);
  let distance = linearDepth(depth);
  let groundBias = mix(1.18, 0.88, smoothstep(0.15, 0.85, input.uv.y));
  let opticalDepth = max(distance - params.startDistance, 0.0) * params.density * groundBias;
  var fogAmount = min(1.0 - exp(-opticalDepth), params.maxOpacity);
  let dither = (interleavedGradientNoise(vec2<f32>(depthPosition)) - 0.5) / 255.0;
  fogAmount = clamp(fogAmount + dither, 0.0, params.maxOpacity);
  let source = textureSampleLevel(sceneColor, sceneSampler, input.uv, 0.0);
  return vec4<f32>(mix(source.rgb, params.fogColor, fogAmount), source.a);
}
