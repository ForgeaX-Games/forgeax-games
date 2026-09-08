#define_import_path hellforge_source::frost_slow

#import forgeax_view::common::{view, meshes}

// frost-slow.wgsl — persistent slow-state marker (ground ring / aura disc).
//
// Soft radial falloff with a slow pulse. Lifetime is owned by gameplay
// (status begin/end); this shader only paints the marker.
//
// Param ABI (matches fire-bolt / frost-fang):
//   baseColor (vec4) — frost status tint
//   metallic  (f32)  — TIME in seconds
//   roughness (f32)  — INTENSITY multiplier

struct FrostSlowUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : FrostSlowUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv         : vec2<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.uv = in.uv;
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let c = in.uv - vec2<f32>(0.5, 0.5);
  let r = length(c) * 2.0;
  if (r > 1.0) { return vec4<f32>(0.0); }
  // Soft ring: bright band near mid-radius, fade at centre and rim.
  let ring = smoothstep(0.15, 0.45, r) * (1.0 - smoothstep(0.65, 1.0, r));
  let pulse = 0.82 + 0.18 * sin(u.time * 3.2 + r * 6.0);
  let flakes = fract(sin(dot(floor(c * 18.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let amp = (ring * 0.85 + flakes * 0.12 * ring) * pulse * u.intensity;
  let ampSafe = min(amp, 0.95);
  let rgb = u.baseColor.rgb * ampSafe;
  return vec4<f32>(rgb, ampSafe);
}
