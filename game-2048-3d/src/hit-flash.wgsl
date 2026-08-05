#define_import_path game_default::hit_flash

#import forgeax_view::common::{view, meshes}

struct HitFlashUniforms {
  baseColor : vec4<f32>,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> hit_flash : HitFlashUniforms;

struct VsIn {
  @location(0) pos : vec3<f32>,
};

struct VsOut {
  @builtin(position) clip : vec4<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  // MaterialAsset uses the public premultiplied-alpha preset. Keep the
  // emitted RGB premultiplied so the blend equation remains correct for
  // arbitrary hit opacity values.
  return vec4<f32>(hit_flash.baseColor.rgb * hit_flash.intensity * hit_flash.baseColor.a, hit_flash.baseColor.a);
}
