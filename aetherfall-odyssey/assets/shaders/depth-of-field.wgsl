struct Params {
  focalDistance: f32,
  nearClip: f32,
  farClip: f32,
  mode: f32,
  aperture: f32,
  maxBlurPixels: f32,
  unused0: f32,
  unused1: f32,
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
  let nearClip = params.nearClip;
  let farClip = params.farClip;
  return nearClip * farClip / max(farClip - depth * (farClip - nearClip), 0.0001);
}

fn circleOfConfusion(depth: f32) -> f32 {
  let distance = linearDepth(depth);
  let focusDistance = max(params.focalDistance, 0.001);
  let normalized = abs(distance - focusDistance) / max(distance, 0.001);
  return clamp(normalized * params.aperture * 18.0, 0.0, params.maxBlurPixels);
}

fn sampleColor(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(
    sceneColor,
    sceneSampler,
    clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)),
    0.0,
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOutput {
  var x: f32 = -1.0;
  var y: f32 = -1.0;
  if (vertexIndex == 1u) { x = 3.0; }
  if (vertexIndex == 2u) { y = 3.0; }
  var output: FullscreenOutput;
  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return output;
}

@fragment
fn fs_main(input: FullscreenOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(sceneColor, 0));
  let uv = input.uv;
  let depthDimensions = vec2<i32>(textureDimensions(sceneDepth, 0));
  let depthPosition = vec2<i32>(clamp(
    uv * vec2<f32>(depthDimensions),
    vec2<f32>(0.0),
    vec2<f32>(depthDimensions - vec2<i32>(1)),
  ));
  let depth = textureLoad(sceneDepth, depthPosition, 0);
  let radius = circleOfConfusion(depth);
  if (params.mode < 0.5 || radius < 0.25) {
    return sampleColor(uv);
  }

  let texel = 1.0 / dimensions;
  var result = sampleColor(uv);
  var weight = 1.0;

  if (params.mode < 1.5) {
    let offsets = array<vec2<f32>, 8>(
      vec2<f32>(-1.0, -1.0), vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0),
      vec2<f32>(-1.0, 0.0), vec2<f32>(1.0, 0.0),
      vec2<f32>(-1.0, 1.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0),
    );
    for (var i = 0u; i < 8u; i++) {
      let sampleWeight = 1.0 / (1.0 + dot(offsets[i], offsets[i]));
      result += sampleColor(uv + offsets[i] * texel * radius) * sampleWeight;
      weight += sampleWeight;
    }
  } else {
    for (var i = 0u; i < 12u; i++) {
      let angle = 6.2831853 * f32(i) / 12.0;
      let ring = vec2<f32>(cos(angle), sin(angle));
      result += sampleColor(uv + ring * texel * radius);
      weight += 1.0;
    }
  }
  return result / weight;
}
