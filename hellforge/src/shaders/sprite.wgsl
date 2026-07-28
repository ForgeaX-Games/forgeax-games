#define_import_path hellforge::sprite

#import forgeax_view::common::{view, meshes}

// sprite.wgsl — the one uber sprite shader (PR8 T1/T2).
//
// Textured billboard quad with flipbook UV animation, UV-noise distortion and
// alpha-erosion fade — the primitive commercial fire/ice/lightning is built
// from (untextured emissive spheres cannot express it; plan §0 anchor).
// Geometry is HANDLE_QUAD (unit XY plane facing +Z, UV full [0..1]², V=0 at
// image top); one material instance per live particle, params mutated per
// tick (same-object mutation is the sanctioned upload route, fx.ts).
//
// Param ABI (matches registerMaterialShader paramSchema declaration order —
// numerics run-merge into the material UBO at @group(1) @binding(0), then
// each texture2d entry auto-pairs a filtering sampler BEFORE its texture):
//   baseColor   (vec4) — HDR tint; alpha = master opacity
//   frame       (f32)  — fractional flipbook frame (written per tick)
//   frames      (f32)  — total frames (1 = static)
//   cols / rows (f32)  — flipbook grid (row 0 = TOP, V=0-at-top convention)
//   billboard   (f32)  — 0 = use Transform as-is, 1 = spherical, 2 = cylindrical
//   distort     (f32)  — UV-noise distortion strength (0 = off; sane 0.02-0.10)
//   time        (f32)  — seconds, scrolled for distortion (mutated per frame)
//   erosion     (f32)  — 0..1 alpha-erosion fade (0 = none)
//   blendFrames (f32)  — 1 = lerp to next frame by fract(frame)
//   sheet       (texture2d) — flipbook atlas
//   noise       (texture2d) — tileable fbm, bound ALWAYS (declared textures
//                             must be bound even when distort = 0)

struct SpriteUniforms {
  baseColor   : vec4<f32>,
  frame       : f32,
  frames      : f32,
  cols        : f32,
  rows        : f32,
  billboard   : f32,
  distort     : f32,
  time        : f32,
  erosion     : f32,
  blendFrames : f32,
};

@group(1) @binding(0) var<uniform> u : SpriteUniforms;
@group(1) @binding(1) var sheetSampler : sampler;
@group(1) @binding(2) var sheet : texture_2d<f32>;
@group(1) @binding(3) var noiseSampler : sampler;
@group(1) @binding(4) var noiseTex : texture_2d<f32>;

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
  let m = meshes[idx].worldFromLocal;
  var world : vec4<f32>;
  if (u.billboard < 0.5) {
    // Decal / world-aligned quad — Transform is authoritative.
    world = m * vec4<f32>(in.pos, 1.0);
  } else {
    // Billboard: anchor at the entity translation, uniform scale from the
    // world matrix X column, basis from the camera (msdf-text precedent).
    let anchor = m[3].xyz;
    let scale = length(m[0].xyz);
    let toCam = view.cameraPos - anchor;
    let dist = length(toCam);
    if (dist < 1e-4) {
      // Camera sits on the anchor — no facing solution; keep the transform.
      world = m * vec4<f32>(in.pos, 1.0);
    } else {
      let fwd = toCam / dist;
      if (u.billboard > 1.5) {
        // Cylindrical (Y-locked, e.g. loot beams / flame columns): rotate
        // around world up only; fall back to +X when the camera is overhead.
        let fh = vec3<f32>(fwd.x, 0.0, fwd.z);
        var right = vec3<f32>(1.0, 0.0, 0.0);
        if (length(fh) > 1e-4) {
          right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), normalize(fh)));
        }
        world = vec4<f32>(anchor + (right * in.pos.x + vec3<f32>(0.0, 1.0, 0.0) * in.pos.y) * scale, 1.0);
      } else {
        // Spherical: fully camera-facing. Guard the straight-up/down case so
        // cross() stays well-conditioned (msdf-text Finding 7 precedent).
        var upRef = vec3<f32>(0.0, 1.0, 0.0);
        if (abs(fwd.y) > 0.999) {
          upRef = vec3<f32>(0.0, 0.0, 1.0);
        }
        let right = normalize(cross(upRef, fwd));
        let up = cross(fwd, right);
        world = vec4<f32>(anchor + (right * in.pos.x + up * in.pos.y) * scale, 1.0);
      }
    }
  }
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.uv = in.uv;
  return out;
}

// One flipbook cell. row 0 = image TOP (V=0-at-top matches the sheet layout).
fn cellUv(uv : vec2<f32>, frame : f32) -> vec2<f32> {
  let total = max(u.frames, 1.0);
  let cols = max(u.cols, 1.0);
  let rows = max(u.rows, 1.0);
  // Positive float mod (frame is clamped >= 0 by the caller).
  let f = floor(frame) - floor(floor(frame) / total) * total;
  let col = f - floor(f / cols) * cols;
  let row = floor(f / cols);
  return (uv + vec2<f32>(col, row)) / vec2<f32>(cols, rows);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  var uv = in.uv;
  // UV-noise distortion: two octave samples scrolled upward at different
  // speeds, masked toward the quad TOP (flame tip) so the base stays anchored.
  if (u.distort > 0.0) {
    let n1 = textureSample(noiseTex, noiseSampler, uv + vec2<f32>(0.0, 0.0 - u.time * 0.9)).r;
    let n2 = textureSample(noiseTex, noiseSampler, uv * 2.0 + vec2<f32>(0.37, 0.0 - u.time * 1.7)).r;
    let verticalMask = 1.0 - uv.y;
    uv = uv + (vec2<f32>(n1, n2) - vec2<f32>(0.5, 0.5)) * u.distort * verticalMask;
  }

  let frame0 = clamp(u.frame, 0.0, max(u.frames - 1.0, 0.0));
  var tex = textureSample(sheet, sheetSampler, cellUv(uv, frame0));
  if (u.blendFrames > 0.5 && u.frames > 1.0) {
    // Wrap to frame 0 at the loop end so looping flames blend seamlessly.
    let total = max(u.frames, 1.0);
    let f1 = (floor(frame0) + 1.0) - floor((floor(frame0) + 1.0) / total) * total;
    let tex1 = textureSample(sheet, sheetSampler, cellUv(uv, f1));
    tex = mix(tex, tex1, fract(frame0));
  }

  var a = tex.a;
  if (u.erosion > 0.0) {
    a = clamp((a - u.erosion) / max(1.0 - u.erosion, 0.001), 0.0, 1.0);
  }
  a = a * u.baseColor.a;
  // Premultiplied-style output: correct for BOTH additive one/one and
  // premult one/one-minus-src-alpha blends (HDR rgb > 1 feeds bloom).
  return vec4<f32>(u.baseColor.rgb * tex.rgb * a, a);
}
