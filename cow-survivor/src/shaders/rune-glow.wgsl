#define_import_path cow_survivor::rune_glow

#import forgeax_view::common::{view, meshes}

// rune-glow.wgsl — magical pulsing glyph for the obsidian-stele runes
// (Decor_SteleRune_*) and the altar runes (AltarRune1/2). The mesh is the
// thin emissive slab the level pack authored; the shader paints a band of
// flowing light that walks across the slab and pulses in intensity.
//
// Param mapping:
//   baseColor (vec4) — rune tint (purple by default)
//   metallic  (f32)  — TIME
//   roughness (f32)  — INTENSITY (1..3)

struct RuneUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : RuneUniforms;

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
  let t = u.time;
  // Narrow running stripe walking along the slab's longest axis.
  let phase = fract(in.localPos.x * 2.0 + t * 0.35);
  let band = smoothstep(0.42, 0.5, 1.0 - abs(phase - 0.5) * 2.0);
  let breath = 0.65 + 0.35 * sin(t * 1.6);
  // Tone-down: previous `hot = baseColor*1.2 + vec3(0.4, 0.25, 0.6)` and
  // `glow = band * breath * intensity * 0.9` made the AltarRune slab at
  // level1's (0, 0.015, 0) — *directly under the player spawn* — pulse from
  // purple (~RGB 165,119,208) to near-white (~0.86, 0.76, 0.93 post-ACES)
  // as `breath` cycled. Fire bullets fly OUT of the player and visually pass
  // over this pulsing slab, so the user perceived their fire bullets as
  // "red → purple → brighter → white". Keep the rune visible but DIM —
  // pure baseColor (no R/G/B additive bias), peak glow ~0.18 instead of 1.26,
  // so the post-ACES peak is ~RGB (60, 30, 70) — a subtle deep-purple pulse
  // that no longer competes with the bullet stream.
  let hot = u.baseColor.rgb;
  let glow = band * breath * u.intensity * 0.18;
  // Transparent queue: alpha = glow so the slab is invisible between
  // pulses. Without this the cube footprint wrote opaque rgb*0 / dark
  // ambient, painting a "block" floating above the lantern.
  return vec4<f32>(hot * glow, glow);
}
