#define_import_path hellforge_source::portal_vortex

#import forgeax_view::common::{view, meshes}

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

struct PortalUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : PortalUniforms;

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
  let r = length(c) * 2.0;                 // 0 centre → 1 rim
  if (r > 1.0) { return vec4<f32>(0.0); }
  let ang = atan2(c.y, c.x);
  // Two counter-rotating spiral arms + a slow radial pulse.
  let spiral = sin(ang * 3.0 - r * 9.0 + u.time * 2.6)
             + 0.5 * sin(ang * 5.0 + r * 7.0 - u.time * 3.4);
  let arm = clamp(spiral * 0.5 + 0.5, 0.0, 1.0);
  // Bright eye at the centre, soft fade at the rim.
  let eye = clamp(1.0 - r * 2.2, 0.0, 1.0);
  let rim = clamp(1.0 - r, 0.0, 1.0);
  let amp = (eye * 0.85 + arm * rim * 0.55) * u.intensity;
  let rgb = u.baseColor.rgb * amp;
  return vec4<f32>(rgb, amp);
}
