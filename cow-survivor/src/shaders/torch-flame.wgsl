#define_import_path cow_survivor::torch_flame

#import forgeax_view::common::{view, meshes}

// torch-flame.wgsl — animated flame for the night-graveyard lanterns
// (Decor_LanternGlow_*). The mesh is the same emissive cube the level pack
// authored; this shader paints a vertical flame gradient over it (hot core
// at bottom, fading + flickering toward the tip) using a cheap value-noise.
//
// Param mapping (Material UBO 48-byte schema):
//   baseColor (vec4) — flame tint (green for graveyard lanterns, orange
//                      for warmer torches)
//   metallic  (f32)  — TIME (game writes wall-clock seconds)
//   roughness (f32)  — INTENSITY (1..3)

struct TorchUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : TorchUniforms;

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

fn hash13(p : vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}
fn noise3(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n00 = mix(hash13(i + vec3<f32>(0,0,0)), hash13(i + vec3<f32>(1,0,0)), u.x);
  let n10 = mix(hash13(i + vec3<f32>(0,1,0)), hash13(i + vec3<f32>(1,1,0)), u.x);
  let n01 = mix(hash13(i + vec3<f32>(0,0,1)), hash13(i + vec3<f32>(1,0,1)), u.x);
  let n11 = mix(hash13(i + vec3<f32>(0,1,1)), hash13(i + vec3<f32>(1,1,1)), u.x);
  return mix(mix(n00, n10, u.y), mix(n01, n11, u.y), u.z);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let t = u.time;
  // Vertical coordinate normalized to [0,1] (cube local Y is [-0.5, 0.5]).
  let h = clamp(in.localPos.y + 0.5, 0.0, 1.0);
  // Lateral falloff so the flame is brighter at the cube center, dimmer at
  // its rim — reads like a candle wisp rather than a glowing block.
  let lat = length(vec2<f32>(in.localPos.x, in.localPos.z)) * 2.0;
  let latMask = exp(-lat * 2.2);
  // Flicker noise — drift vertically over time so the flame appears to
  // rise from the wick.
  let n = noise3(vec3<f32>(in.localPos.x * 5.0, h * 4.0 - t * 2.5, in.localPos.z * 5.0));
  let flick = 0.7 + 0.3 * n;
  // Heat falloff: bright bottom, fading to zero at the top.
  let heat = pow(1.0 - h, 1.4);
  // Tip wobble: stretches the flame slightly with noise.
  let mask = clamp(heat * (0.85 + 0.4 * n) - 0.05, 0.0, 1.0);
  // Color: start at baseColor (cold tip → warm base shift). Drop the
  // +(0.25, 0.18, 0.05) additive bias which lifted the heat-side color
  // off the baseColor hue toward warm-white.
  let coolTip = u.baseColor.rgb * 0.5;
  let hot     = u.baseColor.rgb * 1.4;
  let col = mix(coolTip, hot, heat);
  // amp factor 4.0 → 0.9. Combined with intensity 1.4 the peak is 1.26
  // instead of 5.6, so the post-ACES output stays close to baseColor's hue
  // (was saturating to near-white for green/orange torches near player).
  let amp = mask * latMask * flick * 0.9 * u.intensity;
  // Transparent queue: alpha = amp so the cube's dark corners are fully
  // transparent. Without this the cube footprint wrote opaque dark color
  // outside the visible flame, painting a "block" above the lantern.
  return vec4<f32>(col * amp, amp);
}
