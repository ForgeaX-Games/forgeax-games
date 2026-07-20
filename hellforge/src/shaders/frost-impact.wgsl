#define_import_path hellforge::frost_impact

#import forgeax_view::common::{view, meshes}

// frost-impact.wgsl — collision-aligned Frost Fang impact flash.
//
// Short-lived sphere/orb at the hit point. Soft radial falloff from the
// facing centre so the flash reads as a crack of ice, not a white bloom.
//
// Param ABI (matches fire-bolt / frost-fang):
//   baseColor (vec4) — impact tint
//   metallic  (f32)  — TIME in seconds
//   roughness (f32)  — INTENSITY multiplier

struct FrostImpactUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : FrostImpactUniforms;

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
  return fract(sin(dot(p, vec3<f32>(91.7, 173.3, 53.1))) * 43758.5453);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.worldNrm);
  let v = normalize(view.cameraPos - in.worldPos);
  let facing = clamp(dot(n, v), 0.0, 1.0);
  // Crack rings that crawl outward with time.
  let ring = abs(sin(facing * 12.0 - u.time * 14.0));
  let crack = hash3(floor(n * 7.0 + vec3<f32>(u.time * 6.0, 0.0, u.time * 3.0)));
  let amp = (0.35 + 0.70 * facing * facing + 0.20 * ring * facing) * (0.85 + 0.25 * crack) * u.intensity;
  let ampSafe = min(amp, 1.05);
  let alpha = clamp(facing * 1.8, 0.0, 1.0) * clamp(ampSafe, 0.0, 1.0);
  let rgb = u.baseColor.rgb * ampSafe;
  return vec4<f32>(rgb, alpha);
}
