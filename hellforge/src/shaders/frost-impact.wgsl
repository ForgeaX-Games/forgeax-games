#define_import_path hellforge_source::frost_impact

#pragma variant_axis STORAGE_BUFFER_AVAILABLE
#pragma variant_axis COVERAGE_ONLY

#import forgeax_view::common::{view, meshes}
#import forgeax_scene_temporal::{packSceneTemporalV1WithValidity}
#import forgeax_material::parameters::{material}

// frost-impact.wgsl — collision-aligned Frost Fang impact flash.
//
// Short-lived sphere/orb at the hit point. Soft radial falloff from the
// facing centre so the flash reads as a crack of ice, not a white bloom.
//
// Param ABI (matches fire-bolt / frost-fang):
//   baseColor (vec4) — impact tint
//   metallic  (f32)  — TIME in seconds
//   roughness (f32)  — INTENSITY multiplier


struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos   : vec3<f32>,
  @location(1) worldNrm   : vec3<f32>,
  @location(2) currentClip : vec4<f32>,
  @location(3) previousClip : vec4<f32>,
  @location(4) @interpolate(flat) motionValid : f32,
};

fn fxVertex(in : VsIn, idx : u32) -> VsOut {
  let m = meshes[idx].worldFromLocal;
  let world = m * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.currentClip = view.temporalCurrentViewProj * world;
#if STORAGE_BUFFER_AVAILABLE == true
  out.previousClip = view.temporalPreviousViewProj * meshes[idx].previousWorldFromLocal * vec4<f32>(in.pos, 1.0);
  out.motionValid = meshes[idx].temporal.y;
#else
  out.previousClip = out.currentClip;
  out.motionValid = 0.0;
#endif
  out.worldPos = world.xyz;
  out.worldNrm = normalize((m * vec4<f32>(in.normal, 0.0)).xyz);
  return out;
}

fn hash3(p : vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(91.7, 173.3, 53.1))) * 43758.5453);
}

fn shadeFx(in : VsOut) -> vec4<f32> {
  let n = normalize(in.worldNrm);
  let v = normalize(view.cameraPos - in.worldPos);
  let facing = clamp(dot(n, v), 0.0, 1.0);
  // Crack rings that crawl outward with metallic.
  let ring = abs(sin(facing * 12.0 - material.metallic * 14.0));
  let crack = hash3(floor(n * 7.0 + vec3<f32>(material.metallic * 6.0, 0.0, material.metallic * 3.0)));
  let amp = (0.35 + 0.70 * facing * facing + 0.20 * ring * facing) * (0.85 + 0.25 * crack) * material.roughness;
  let ampSafe = min(amp, 1.05);
  let alpha = clamp(facing * 1.8, 0.0, 1.0) * clamp(ampSafe, 0.0, 1.0);
  let rgb = material.baseColor.rgb * ampSafe;
  return vec4<f32>(rgb, alpha);
}

// Both passes use identical geometry and animated alpha. Fully reactive FX
// reject stale flipbook/noise history while retaining genuine object/camera motion.
@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  return fxVertex(in, idx);
}

@vertex
fn vs_temporal(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  return fxVertex(in, idx);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  return shadeFx(in);
}

@fragment
fn fs_temporal(in : VsOut) -> @location(0) vec4<f32> {
  if (shadeFx(in).a <= 0.0) { discard; }
#ifdef COVERAGE_ONLY
  return vec4<f32>(1.0);
#else
  return packSceneTemporalV1WithValidity(
    in.currentClip, in.previousClip, view.temporalProjection, 1.0, in.motionValid >= 0.5,
  );
#endif
}
