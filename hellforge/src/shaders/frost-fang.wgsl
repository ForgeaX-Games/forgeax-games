#define_import_path hellforge::frost_fang

#import forgeax_view::common::{view, meshes}

// frost-fang.wgsl — Frost Fang projectile crystal core + trail body.
//
// Geometry note (same as fire-bolt): engine sphere/cube meshes are hollow
// surfaces. Shade by view-facing + facet hash, never by length(localPos).
//
// Colour discipline: cyan–ice family stays under ~1.05 peak so ACES does not
// wash to white. Premultiplied alpha — overlapping bolts occlude, never sum.
//
// Param ABI (matches registerMaterialShader paramSchema / fire-bolt):
//   baseColor (vec4) — ice tint
//   metallic  (f32)  — TIME in seconds (mutated every frame by fx.ts)
//   roughness (f32)  — INTENSITY multiplier

struct FrostUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : FrostUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos   : vec3<f32>,
  @location(1) worldNrm   : vec3<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let m = meshes[idx].worldFromLocal;
  let world = m * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.worldPos = world.xyz;
  out.worldNrm = normalize((m * vec4<f32>(in.normal, 0.0)).xyz);
  return out;
}

fn hash3(p : vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.worldNrm);
  let v = normalize(view.cameraPos - in.worldPos);
  let facing = clamp(dot(n, v), 0.0, 1.0);
  // Faceted crystal: quantize the normal for hard shard edges.
  let facet = hash3(floor(n * 4.0));
  let spark = hash3(floor(n * 9.0 + vec3<f32>(0.0, u.time * 4.5, u.time * 2.1)));
  let shimmer = 0.88 + 0.22 * facet + 0.12 * spark;
  // Hot icy core, soft rim; keep amp ≤ ~1.05 for ACES.
  let amp = (0.28 + 0.72 * facing * facing) * shimmer * u.intensity;
  let ampSafe = min(amp, 1.05);
  let alpha = clamp(facing * 1.55, 0.0, 1.0) * clamp(ampSafe, 0.0, 1.0);
  let rgb = u.baseColor.rgb * ampSafe;
  return vec4<f32>(rgb, alpha);
}
