#define_import_path cow_survivor::particle

#import forgeax_view::common::{view, meshes, instances}

// particle.wgsl — generic instanced-particle material. ONE entity carries
// `Instances { transforms: Float32Array(N*16) }`; each particle is one
// column-major mat4 in that array. The shader composes:
//
//   world = meshes[0].worldFromLocal * instances[i].localFromInstance * pos
//
// `meshes[0]` is the EMITTER entity's transform (kept at identity in the
// game so the per-particle transforms are directly world-space).
// `instances[i]` is the per-particle TRS picked up via @builtin(instance_index).
//
// The material is registered at queue:3000 (Transparent) with ADDITIVE blend
// (one + one), depthWriteEnabled=false. Each particle's geometry (sphere or
// thin cube) is a small bright "blob"; the fragment paints a soft circular
// falloff using local coords, so even a cube reads as a fuzzy mote.
//
// Param mapping (slot 1/2 of the standard 48-byte FX uniform):
//   baseColor (vec4) — particle tint
//   metallic  (f32)  — TIME (wall-clock seconds, drives optional flicker)
//   roughness (f32)  — INTENSITY multiplier (1..6; higher = brighter halo)

struct ParticleUniforms {
  baseColor : vec4<f32>,
  time      : f32,
  intensity : f32,
};

@group(1) @binding(0) var<uniform> u : ParticleUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) localPos   : vec3<f32>,
  @location(1) iIdx       : f32,   // instance_index passed to fragment
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  // IMPORTANT: drop the per-entity worldFromLocal multiply. Each per-
  // particle `localFromInstance` we pack on the CPU is already a full
  // world-space TRS (translation = particle world pos, columns 0..2 carry
  // scale + Y-rotation). Using only the instance matrix means the
  // emitter entity's own Transform doesn't propagate into particle
  // positions — and dead particles (HIDE_MAT4 → translation (0, -1000, 0,
  // 1), scale 0) cleanly clip below the floor without any base-mesh ghost
  // appearing at the entity origin.
  let instanceLocal = instances[idx].localFromInstance;
  let world = instanceLocal * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.localPos = in.pos;
  out.iIdx = f32(idx);
  return out;
}

// Per-instance hash for tiny color jitter so a cluster of 60 particles
// reads as 60 distinct sparks rather than one merged glow blob.
fn hash11(p : f32) -> f32 {
  let q = fract(p * 0.1031);
  return fract(q * (q + 33.33));
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  // Soft circular falloff in local space.
  let d = length(in.localPos) * 2.0;
  let core = clamp(1.0 - d, 0.0, 1.0);
  let glow = core * core;
  // Per-instance brightness jitter — VERY narrow now (0.92..1.08) so a
  // cluster reads as the SAME hue instead of one bright outlier saturating
  // the cluster to white.
  let jitter = 0.92 + 0.16 * hash11(in.iIdx + 0.5);
  // amp peak ≈ 0.15 × intensity. With additive blend, even 8 overlapping
  // particles only sum to ~1.2 — under the ACES tonemap roll-off so the
  // cluster preserves baseColor's hue (no drift to orange/yellow/white).
  // The previous 0.6 amp let 3-4 overlaps saturate; the global "screen
  // gradually brightens to yellow/white as combat continues" effect came
  // entirely from that accumulation.
  let amp = glow * u.intensity * jitter * 0.15;
  // NO hot-blend. The previous `mix(baseColor, vec3(1, 0.95, 0.85), glow*0.15)`
  // added cream highlights to the particle CORE — combined with additive
  // overlap, the core of any cluster trended toward yellow-white. Render at
  // baseColor flat. baseColor IS the per-emitter hue (fire emFire is red-
  // orange, ice emIce is cyan, etc.) and particles should stay in-hue.
  let col = u.baseColor.rgb;
  return vec4<f32>(col * amp, amp);
}
