#define_import_path cow_survivor::explosion_fireball

#import forgeax_view::common::{view, meshes}

// explosion-fireball.wgsl — expanding spherical fireball for grenade /
// fire-weapon AoE / boss-death blasts. The mesh is a unit sphere whose
// world scale comes from the spawn caller (radius). The shader paints a
// turbulent fireball that grows + fades in `lifetime` seconds.
//
// Param mapping:
//   baseColor (vec4) — fireball tint (orange-yellow default; cyan for ice-
//                      based explosions; toxic green for poison-bombs)
//   metallic  (f32)  — LIFETIME progress 0..1
//   roughness (f32)  — TURBULENCE scale (1..4; higher = more chaotic noise)

struct FireballUniforms {
  baseColor : vec4<f32>,
  progress  : f32,
  turbulence: f32,
};

@group(1) @binding(0) var<uniform> u : FireballUniforms;

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
// Layered noise (FBM) for "lumpy fire blobs" — only 3 octaves to keep
// per-fragment cost low; the bloom pass does most of the brightening.
fn fbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i = 0u; i < 3u; i = i + 1u) {
    v = v + amp * noise3(p * freq);
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return v;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let t = u.progress;       // 0..1 lifetime
  // Distance from sphere center (the mesh is built as a unit sphere
  // around 0; surface radius is 0.5 in local space).
  let r = length(in.localPos) * 2.0;
  // Effective fireball radius grows from 0.05 to 1.0 quickly, then holds.
  let grow = mix(0.05, 1.0, smoothstep(0.0, 0.45, t));
  // Edge feathering: pixels near `grow` fade; outside `grow` are zero.
  let edge = 1.0 - smoothstep(grow * 0.8, grow, r);
  // Hot core: bright at center, dimmer at edge.
  let coreHeat = pow(1.0 - r, 1.6) * (1.0 - smoothstep(0.4, 1.0, t));
  // Turbulent noise sampled in 3D — gives lumpy "real fire blobs" rather
  // than a smooth blob. Use local position + time for evolution.
  let n = fbm(in.localPos * u.turbulence * 4.0 + vec3<f32>(t * 3.0, t * 1.5, t * 2.0));
  // Combine: hotter at center, lumpy via noise, hard edge mask.
  let intensity = (coreHeat * 1.8 + 0.4) * (0.6 + 0.8 * n) * edge;
  // Color gradient: stay in the baseColor hue family — slightly brighter
  // at the hot core, darker at the edges. Previous mix(baseColor, hot=
  // (1.0, 0.95, 0.6), ...) blew the core to near-white-yellow which then
  // saturated through ACES; now the fireball reads as ORANGE throughout.
  let warm = u.baseColor.rgb * 0.7;
  let bright = u.baseColor.rgb * 1.4 + vec3<f32>(0.05, 0.05, 0.0);
  let col = mix(warm, bright, smoothstep(0.4, 1.4, coreHeat * 1.5));
  // Overall fade so the fireball dies out in the second half.
  let fade = 1.0 - smoothstep(0.55, 1.0, t);
  // amp factor 6.0 → 1.4. With baseColor (1, 0.45, 0.1) the previous peak
  // RGB was (26.8, 12.6, 3.5) — after ACES Narkowicz both R and G clamped
  // to ~1.0, so the explosion core read as PURE WHITE. With amp * 1.4 the
  // peak RGB drops to (~6.3, 2.9, 0.8) — still HDR + bloom-eligible, but
  // ACES preserves the orange hue (R rolls off to ~0.9 while G/B stay
  // proportional). Each fire-weapon impact now reads as ORANGE BLAST not
  // WHITE FLASH — kills the "fire bullet → white" stream illusion.
  let amp = intensity * fade * 1.4;
  // The material runs in the TRANSPARENT queue (no depth prepass) so we
  // output an additive color + alpha = amp. Outside the visible fireball,
  // amp ≈ 0 → fully transparent, so the ground/enemies below show
  // through. With the previous opaque queue + discard, the depth prepass
  // had already written the sphere's footprint, painting a black silhouette
  // on the ground beneath every blast.
  return vec4<f32>(col * amp, amp);
}
