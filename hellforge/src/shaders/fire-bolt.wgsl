#define_import_path hellforge_source::fire_bolt

#pragma variant_axis STORAGE_BUFFER_AVAILABLE
#pragma variant_axis COVERAGE_ONLY

#import forgeax_view::common::{view, meshes}
#import forgeax_scene_temporal::{packSceneTemporalV1WithValidity}
#import forgeax_material::parameters::{material}

// fire-bolt.wgsl — the witch's Fire Bolt projectile body.
//
// IMPORTANT GEOMETRY FACT (the bug the first version shipped): the engine
// sphere is a hollow SURFACE mesh — every fragment's localPos has the SAME
// radius, so any mask computed from length(localPos) is a constant (and a
// radial falloff like `1 - d*d` evaluates to ~0 → fully transparent ball).
// A sphere body shader must shade by SURFACE quantities instead. We use the
// view angle: facing = dot(N, V) is 1 at the silhouette centre and 0 at the
// rim, which gives the classic hot-core / soft-rim fireball falloff.
//
// Colour discipline (cow-survivor ACES lessons): amplitude peaks ≤ ~1.1 and
// the hue never leaves baseColor's family, so ACES keeps it saturated red-
// orange instead of clipping to white. Premultiplied alpha — overlapping
// bolts occlude, never sum.
//
// Param ABI (matches registerMaterialShader paramSchema):
//   baseColor (vec4) — flame tint
//   metallic  (f32)  — TIME in seconds (mutated every frame by fx.ts)
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
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn shadeFx(in : VsOut) -> vec4<f32> {
  let n = normalize(in.worldNrm);
  let v = normalize(view.cameraPos - in.worldPos);
  // 1 at the silhouette centre, 0 at the rim.
  let facing = clamp(dot(n, v), 0.0, 1.0);
  // Living-flame wobble: value noise over the surface normal, scrolled by
  // metallic. Modulates BRIGHTNESS only (±18%), never the hue.
  let wob = hash3(floor(n * 5.0 + vec3<f32>(0.0, material.metallic * 7.0, material.metallic * 3.0)));
  let flick = 0.82 + 0.36 * wob;
  // Hot core, soft rim: quadratic-in-facing profile.
  let amp = (0.25 + 0.85 * facing * facing) * flick * material.roughness;
  let alpha = clamp(facing * 1.6, 0.0, 1.0) * clamp(amp, 0.0, 1.0);
  let rgb = material.baseColor.rgb * amp;
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
