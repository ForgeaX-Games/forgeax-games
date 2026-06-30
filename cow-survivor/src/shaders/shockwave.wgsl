#define_import_path cow_survivor::shockwave

#import forgeax_view::common::{view, meshes}

// shockwave.wgsl — expanding ring on a thin Y-flat cube placed at the
// blast point. The ring radius grows from 0 to 1 over the entity's
// lifetime; its trailing edge fades toward the center, the leading edge
// has a slight chromatic split for "impact" energy.
//
// Param mapping (Material UBO 48-byte slot schema):
//   baseColor (vec4) — shockwave tint (gold/red/cyan ...)
//   metallic  (f32)  — LIFETIME progress, 0..1 (game writes age/lifetime
//                      every frame; at >=1 the entity is despawned)
//   roughness (f32)  — RING_SHARPNESS (1..6; higher = thinner ring)

struct ShockwaveUniforms {
  baseColor : vec4<f32>,
  progress  : f32,
  sharpness : f32,
};

@group(1) @binding(0) var<uniform> u : ShockwaveUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) localXz : vec2<f32>,  // -0.5..0.5 cube footprint
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.localXz = vec2<f32>(in.pos.x, in.pos.z);
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  // Distance from the cube's center in local XZ (max ~0.71 at corners).
  let r = length(in.localXz) * 2.0;  // remap so center = 0, edge = 1.0

  // Lead radius travels 0 → 1 over the lifetime. Visible ring is a THIN
  // BAND centered at `lead` so the shape is always an expanding annulus.
  let lead = u.progress;
  let bandHalf = clamp(1.0 / max(u.sharpness * 2.0, 2.0), 0.025, 0.25);
  let dist = abs(r - lead);
  let ringMask = 1.0 - smoothstep(0.0, bandHalf, dist);
  let fade = 1.0 - smoothstep(0.7, 1.0, lead);

  let inside = step(r, lead);
  let warm = u.baseColor.rgb;
  let coolShift = vec3<f32>(0.6, 0.85, 1.0);
  let rgb = mix(mix(warm, coolShift, 0.4), warm, inside);

  let glow = ringMask * fade * 5.5;
  // The material runs in the TRANSPARENT queue (no depth prepass), so we
  // output (premultiplied-additive) color and the band's alpha — outside
  // the band alpha is 0, so the ground below shows through cleanly.
  // Without this we got an opaque "black square shadow" of the cube
  // footprint because the depth prepass had already occluded the ground
  // even when the fragment shader discarded.
  return vec4<f32>(rgb * glow, glow);
}
