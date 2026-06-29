#define_import_path cow_survivor::lightning

#import forgeax_view::common::{view, meshes}

// lightning.wgsl — emissive electrified material for chain-lightning bolts
// (and the matching `lightningSpark` puff at jump points). The bolt is a
// thin cube stretched along its X axis between two enemies; the shader
// turns the cube's surface into a bright flickering electric trail.
//
// Param mapping (Material UBO 48-byte schema, slot order = paramSchema):
//   baseColor (vec4)  — bolt main color (purple-white default)
//   metallic  (f32)   — TIME from the game (game writes elapsed seconds)
//   roughness (f32)   — INTENSITY multiplier (0..2)

struct LightningUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : LightningUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) localPos : vec3<f32>,  // mesh-local for noise lookup
  @location(1) uvOut    : vec2<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.localPos = in.pos;
  out.uvOut = in.uv;
  return out;
}

// Cheap hash + value-noise for the flicker trail. Both <30 instructions on
// the GPU; the bolt is on-screen for ~0.18s so transient cost is what
// matters, not steady-state.
fn hash13(p : vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn noise3(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let t = u.time;

  // Distance from the bolt's central axis — the cube stretches along its
  // local Z (after the segYaw rotation), thin in X and Y. Take radial
  // distance in the XY plane so the bright "electrified line" runs
  // straight down the middle of the cube regardless of orientation.
  let off = vec2<f32>(in.localPos.x, in.localPos.y) * 2.0;
  let coreDist = length(off);

  // Two-tier flicker:
  //   • slow noise drift (axis * 4 + time * 6) — the wandering jitter
  //     along the bolt
  //   • fast sin pulse (time * 22) — the strobe brightness
  // Combined they read as electricity, not as TV static. Coordinate uses
  // the bolt's length axis (localPos.z) so the noise visibly travels
  // ALONG the bolt frame to frame.
  let n = noise3(vec3<f32>(in.localPos.z * 4.0 + t * 6.0, t * 5.0, 0.0));
  let strobe = 0.65 + 0.35 * sin(t * 22.0 + n * 6.28);

  // Sharpened bright core — exp(-x*9) gives a tighter centerline than the
  // old exp(-x*7). The center of the bolt now reads as "hot wire" instead
  // of a wide smear.
  let core = exp(-coreDist * 9.0) * (0.55 + 0.6 * n) * strobe;

  // Outer halo softens beyond the core; lower amplitude so bloom does
  // most of the haloing.
  let halo = exp(-coreDist * 2.2) * 0.30 * (0.4 + 0.6 * n);

  let glow = core + halo;
  let rgb = u.baseColor.rgb * (glow * 5.0 * u.intensity);
  // Transparent queue: alpha = glow so the cube outside the bolt's core
  // is fully transparent. With alpha=1 + opaque queue, the segment cube
  // wrote a black silhouette everywhere it didn't paint the bolt.
  return vec4<f32>(rgb, glow);
}
