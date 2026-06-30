#define_import_path cow_survivor::ice_shard

#import forgeax_view::common::{view, meshes}

// ice-shard.wgsl — crystalline ice projectile material. Reads as faceted
// ice with internal refraction lines + a cold halo. Used by the ice
// weapon's bullets.
//
// Param mapping:
//   baseColor (vec4) — ice tint (pale blue)
//   metallic  (f32)  — TIME seconds (drives refraction line motion)
//   roughness (f32)  — INTENSITY (1..3)

struct IceUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : IceUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) localPos   : vec3<f32>,
  @location(1) localNormal: vec3<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let world = meshes[idx].worldFromLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.localPos = in.pos;
  out.localNormal = in.normal;
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let t = u.time;
  // Faceted brightness: faces facing "up-front" are brighter than
  // back-facing ones. Cheap fresnel-ish approximation using local normal.
  let facing = max(0.0, dot(normalize(in.localNormal), vec3<f32>(0.0, 0.3, 1.0)));
  // Internal "crystal lines" — striped pattern drifting with time gives
  // the bullet a "liquid-in-crystal" feel.
  let stripeCoord = in.localPos.x * 6.0 + in.localPos.y * 4.0 + t * 2.0;
  let stripe = abs(sin(stripeCoord * 3.14));
  let stripeMask = smoothstep(0.6, 0.95, stripe);
  // Cold edge halo: edges of the mesh (away from center) glow cooler.
  let edge = length(in.localPos) * 1.6;
  let halo = smoothstep(0.6, 1.2, edge) * 0.6;
  // Single-tone ice: keep baseColor identity, slightly brighter on
  // facets and stripes. Previous vec3(0.95, 0.97, 1.0) lineTint mixed
  // toward NEAR-WHITE wherever the stripe hit — combined with high amp
  // and ACES, the ice shard read as "white blob with cyan halo" instead
  // of "cyan crystal". Now line accent is just a brighter shade of the
  // same baseColor hue.
  let baseTint = u.baseColor.rgb * (0.55 + facing * 0.55);
  let lineTint = u.baseColor.rgb * 1.4 + vec3<f32>(0.05, 0.10, 0.10);
  let col = mix(baseTint, lineTint, stripeMask * 0.55);
  let haloTint = u.baseColor.rgb * 0.85 + vec3<f32>(0.0, 0.05, 0.10);
  // (`final` is a WGSL reserved keyword — name this `outRgb`.)
  let outRgb = col + haloTint * halo;
  // amp factor 1.6 → 0.7 because the colour now rides at baseColor
  // brightness (no white core to "punch through"). Peak ≈ 0.7 ×
  // u.intensity (~1.4) ≈ 1.0, well inside ACES colour-preserving range.
  let amp = (0.4 + stripeMask * 0.3) * u.intensity * 0.5;
  // Transparent queue: alpha = halo+stripe presence so corners that don't
  // contribute to crystal/halo are see-through, not opaque PBR cube.
  let a = clamp(0.55 + halo + stripeMask * 0.4, 0.0, 1.0);
  return vec4<f32>(outRgb * amp, a);
}
