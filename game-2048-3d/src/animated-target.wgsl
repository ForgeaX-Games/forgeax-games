#define_import_path game_default::animated_target

#import forgeax_view::common::{view, meshes}

struct AnimatedTargetUniforms {
  baseColor : vec4<f32>,
  time : f32,
}

@group(1) @binding(0) var<uniform> animated : AnimatedTargetUniforms;

struct VsIn {
  @location(0) pos : vec3<f32>,
  @location(1) uv : vec2<f32>,
}

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.uv = in.uv;
  return out;
}

fn hue_shift(color : vec3<f32>, phase : f32) -> vec3<f32> {
  let c = cos(phase);
  let s = sin(phase);
  let axis = vec3<f32>(0.57735);
  return color * c + cross(axis, color) * s + axis * dot(axis, color) * (1.0 - c);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let radial = 1.0 - min(distance(in.uv, vec2<f32>(0.5)) * 1.8, 1.0);
  let phase = animated.time * 2.0 + (in.uv.x - in.uv.y) * 3.14159;
  let shifted = hue_shift(animated.baseColor.rgb, phase);
  let glow = 0.72 + radial * 0.28;
  return vec4<f32>(max(shifted * glow, vec3<f32>(0.0)), animated.baseColor.a);
}
