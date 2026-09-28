#define_import_path hellforge_source::portal_vortex

#pragma variant_axis STORAGE_BUFFER_AVAILABLE
#pragma variant_axis COVERAGE_ONLY

#import forgeax_view::common::{view, meshes}
#import forgeax_scene_temporal::{packSceneTemporalV1WithValidity}
#import forgeax_material::parameters::{material}

// portal-vortex.wgsl — swirling portal disc (cave entrance / return portal).
//
// Applied to a flat quad lying on the ground (or standing upright). A spiral
// interference pattern rotates around the centre; soft radial falloff at the
// rim. Premultiplied alpha so overlapping FX never sum past the tint.
//
// Param ABI:
//   baseColor (vec4) — portal tint
//   metallic  (f32)  — TIME in seconds (mutated every frame by fx.ts)
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
  let r = length(c) * 2.0;                 // 0 centre → 1 rim
  if (r > 1.0) { return vec4<f32>(0.0); }
  let ang = atan2(c.y, c.x);
  // Two counter-rotating spiral arms + a slow radial pulse.
  let spiral = sin(ang * 3.0 - r * 9.0 + material.metallic * 2.6)
             + 0.5 * sin(ang * 5.0 + r * 7.0 - material.metallic * 3.4);
  let arm = clamp(spiral * 0.5 + 0.5, 0.0, 1.0);
  // Bright eye at the centre, soft fade at the rim.
  let eye = clamp(1.0 - r * 2.2, 0.0, 1.0);
  let rim = clamp(1.0 - r, 0.0, 1.0);
  let amp = (eye * 0.85 + arm * rim * 0.55) * material.roughness;
  let rgb = material.baseColor.rgb * amp;
  return vec4<f32>(rgb, amp);
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
