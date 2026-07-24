#define_import_path hellforge::move_click

#import forgeax_view::common::{view, meshes}

// move-click.wgsl — Hellforge move-command cue.
// Four inward forged-iron chevrons with ember / magma glow (matches HUD gold+crimson).
// Drawn in LOCAL XZ on a flat cube decal (not mesh UV).
//
// Param ABI (matches frost-slow / fire-bolt):
//   baseColor (vec4) — magma tint
//   metallic  (f32)  — TIME in seconds
//   roughness (f32)  — INTENSITY / fade

struct MoveClickUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : MoveClickUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) localXZ    : vec2<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.localXZ = in.pos.xz;
  return out;
}

fn softBox(p: vec2<f32>, halfSize: vec2<f32>, softness: f32) -> f32 {
  let d = abs(p) - halfSize;
  let outside = length(max(d, vec2<f32>(0.0)));
  let inside = min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(0.0, softness, outside + inside);
}

fn hash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

// Broad forged chevron ">" (medieval bracket / arrowhead), pointing +X.
fn chevronPointingRight(p: vec2<f32>) -> f32 {
  // Slightly heavier arms than neon Dota cues — reads as forged metal.
  let armLen = 0.13;
  let armHalf = 0.028;
  let soft = 0.018;
  let c = 0.78;
  let s = 0.625;
  let pu = vec2<f32>(p.x * c + p.y * s, -p.x * s + p.y * c);
  let pl = vec2<f32>(p.x * c - p.y * s,  p.x * s + p.y * c);
  let upper = softBox(pu - vec2<f32>(-armLen * 0.5, 0.0), vec2<f32>(armLen * 0.5, armHalf), soft);
  let lower = softBox(pl - vec2<f32>(-armLen * 0.5, 0.0), vec2<f32>(armLen * 0.5, armHalf), soft);
  // Blunted tip (arrowhead, not neon point).
  let tip = softBox(p + vec2<f32>(0.01, 0.0), vec2<f32>(0.028, 0.022), soft);
  // Thin iron spine down the middle of the head.
  let spine = softBox(p + vec2<f32>(-0.02, 0.0), vec2<f32>(0.04, 0.008), soft) * 0.65;
  return max(max(max(upper, lower), tip), spine);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let p = in.localXZ;
  let r = length(p);
  if (r > 0.48) { return vec4<f32>(0.0); }

  let off = 0.21;
  let left  = chevronPointingRight(vec2<f32>(p.x + off, p.y));
  let right = chevronPointingRight(vec2<f32>(-p.x + off, p.y));
  let up    = chevronPointingRight(vec2<f32>(p.y + off, -p.x));
  let down  = chevronPointingRight(vec2<f32>(-p.y + off, p.x));
  let mask = max(max(left, right), max(up, down));
  if (mask < 0.02) { return vec4<f32>(0.0); }

  // Magma / ember: deep crimson core → hot orange → gold highlight.
  let cell = floor(p * 28.0);
  let crack = hash21(cell);
  let emberFlow = 0.55 + 0.45 * sin(u.time * 5.5 + crack * 6.28 + r * 10.0);
  let hot = smoothstep(0.35, 0.95, mask) * emberFlow;
  let cool = mask * (1.0 - hot * 0.35);

  let cDeep  = vec3<f32>(0.35, 0.04, 0.01);   // cooled slag
  let cLava  = vec3<f32>(0.95, 0.22, 0.04);   // magma
  let cGold  = vec3<f32>(1.0, 0.72, 0.22);    // HUD gold spark
  let tint = u.baseColor.rgb;
  var rgb = mix(cDeep, cLava * tint, cool);
  rgb = mix(rgb, cGold, hot * 0.55);

  // Soft pulse — forge glow, not neon strobe.
  let pulse = 0.88 + 0.12 * sin(u.time * 3.6);
  let amp = min(mask * pulse * u.intensity, 0.88);
  return vec4<f32>(rgb * (0.55 + amp * 0.7), amp * 0.8);
}
