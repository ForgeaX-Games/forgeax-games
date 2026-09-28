#define_import_path hellforge_source::frost_slow

#pragma variant_axis STORAGE_BUFFER_AVAILABLE
#pragma variant_axis COVERAGE_ONLY

#import forgeax_view::common::{view, meshes}
#import forgeax_scene_temporal::{packSceneTemporalV1WithValidity}
#import forgeax_material::parameters::{material}

// frost-slow.wgsl — persistent slow-state marker (ground ring / aura disc).
//
// Soft radial falloff with a slow pulse. Lifetime is owned by gameplay
// (status begin/end); this shader only paints the marker.
//
// Param ABI (matches fire-bolt / frost-fang):
//   baseColor (vec4) — frost status tint
//   metallic  (f32)  — TIME in seconds
//   roughness (f32)  — INTENSITY multiplier


struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv         : vec2<f32>,
  @location(2) currentClip : vec4<f32>,
  @location(3) previousClip : vec4<f32>,
  @location(4) @interpolate(flat) motionValid : f32,
};

fn fxVertex(in : VsIn, idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
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
  out.uv = in.uv;
  return out;
}

fn shadeFx(in : VsOut) -> vec4<f32> {
  let c = in.uv - vec2<f32>(0.5, 0.5);
  let r = length(c) * 2.0;
  if (r > 1.0) { return vec4<f32>(0.0); }
  // Soft ring: bright band near mid-radius, fade at centre and rim.
  let ring = smoothstep(0.15, 0.45, r) * (1.0 - smoothstep(0.65, 1.0, r));
  let pulse = 0.82 + 0.18 * sin(material.metallic * 3.2 + r * 6.0);
  let flakes = fract(sin(dot(floor(c * 18.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let amp = (ring * 0.85 + flakes * 0.12 * ring) * pulse * material.roughness;
  let ampSafe = min(amp, 0.95);
  let rgb = material.baseColor.rgb * ampSafe;
  return vec4<f32>(rgb, ampSafe);
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
