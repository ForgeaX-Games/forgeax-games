#define_import_path cow_survivor::fire_trail

#import forgeax_view::common::{view, meshes}

// fire-trail.wgsl — SOLID RED fireball, no brightness modulation.
//
// User requirement (locked goal): the fire bullet must stay RED throughout
// its flight, with NO gradient and NO pulse/flicker. Previous versions used
// noise + heat (tail→head gradient) + flick (time-driven brightness) to give
// the bullet a "living flame" feel, but every variant of that produced some
// shade of red→orange→yellow→white as ACES desaturated the brightest pixels.
// We give up the procedural flame look entirely and render the bullet as a
// SOFT-EDGED CONSTANT-COLOR sphere.
//
// Param mapping:
//   baseColor (vec4) — flame tint (set in fire-trail.fx.json: (1, 0.10, 0.03))
//   metallic  (f32)  — TIME seconds (ignored by this shader; kept for ABI)
//   roughness (f32)  — INTENSITY (kept for ABI; default 1.4)

struct FireUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : FireUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) localPos   : vec3<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.localPos = in.pos;
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  // Radial mask from sphere center → soft round footprint.
  // localPos for a unit sphere is in [-0.5, 0.5]³, so length is up to ~0.87.
  let d = length(in.localPos) * 2.0;          // 0 at center, ~1 at surface
  // Soft falloff: 1 at center, 0 at d=1 — sphere reads as a clean
  // round bullet rather than a hard cube silhouette.
  let mask = clamp(1.0 - d * d, 0.0, 1.0);
  // CONSTANT colour everywhere — no heat gradient, no flick, no time.
  // amp = mask * 0.55. Peak fragment is u.baseColor.rgb * 0.55, so for
  // baseColor (1, 0.10, 0.03) the peak HDR pixel is (0.55, 0.055, 0.0165).
  // After ACES Narkowicz the on-screen pixel is ~RGB (167, 14, 5) — a pure
  // RED that does NOT desaturate, does NOT pulse, does NOT shift hue across
  // the bullet body. Intensity is intentionally ignored: any non-constant
  // multiplier reintroduces brightness variation that ACES would translate
  // into red→orange→yellow drift.
  let amp = mask * 0.55;
  // Premultiplied-alpha output. dst factor `one-minus-src-alpha` on the host
  // side means overlapping bullets OCCLUDE rather than sum — multiple bullets
  // in flight cannot accumulate to brighter than a single bullet at a pixel.
  return vec4<f32>(u.baseColor.rgb * amp, amp);
}
