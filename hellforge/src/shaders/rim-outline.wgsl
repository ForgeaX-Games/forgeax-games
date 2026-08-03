#define_import_path hellforge::rim_outline

#import forgeax_view::common::{view, meshes}

// rim-outline.wgsl — G2-B spike: material-level fresnel rim ("true silhouette
// bright edge") for Hellforge N4 lighting/decor.
//
// SKINNED-MESH VERDICT (read before touching this file): user-registered
// material shaders CANNOT render on skinned meshes in the current c0 engine.
// The evidence (QA worktree, feat-20260731-hellforge-n3-studio engine src):
//
//   - packages/render/src/render-system-extract.ts:3021-3041 (feat-20260611
//     D-5 bidirectional fail-fast): `hasSkinSkel && !isPbrSkinMaterial`
//     routes SkinMaterialMismatchError (errors/render.ts:593-610,
//     code='skin-material-mismatch') and `continue`s — a skinned entity
//     whose first-pass material shader is not `'forgeax::pbr-skin'` is
//     dropped from the draw list entirely.
//   - packages/render/src/record/main-pass-geometry.ts:152-311: the skin
//     palette bind group + skin PSO probe are hard-wired to
//     SKIN_MATERIAL_SHADER_ID = 'forgeax::pbr-skin' (pbr-pipeline.ts:570);
//     the group(2) layout for a skin entry is the 2-entry
//     pbr-skin-mesh-array BGL (pbr-pipeline.ts:602-637 buildPbrSkinLayouts).
//   - packages/render/src/renderer/renderer-factory.ts:1296-1303: user
//     shaders build their pipeline layout with the 1-entry
//     `pipelineState.meshBindGroupLayout` — even if extract were bypassed,
//     binding the 2-entry skin BG against a user pipeline reproduces the
//     R1-class BGL-mismatch device error.
//
// Consequence: the joint-palette binding (@group(2)@binding(1), see
// packages/shader/src/default-standard-pbr-skin.wgsl:143-147) is only ever
// connected to `forgeax::pbr-skin`. A user shader cannot receive it.
// Therefore this shader ships the NON-SKINNED vertex stage (fire-bolt.wgsl
// idiom, `meshes[idx].worldFromLocal`), usable on unskinned primitives:
// fallback PartSpec monster parts, GLB nodes without a Skin component, and
// decor props. Applying it to a skinned entity is EXPECTED to fire
// skin-material-mismatch and draw nothing — see rim-outline.ts header for
// the QA checklist that confirms this.
//
// Future engine support (NOT implemented here): a skinned user-shader ABI
// would mirror default-standard-pbr-skin.wgsl — @group(2)@binding(0) meshes
// + @group(2)@binding(1) palette storage buffer, @location(4) skinIndex +
// @location(5) skinWeight attributes (6-attribute / 72-byte vertex layout,
// renderer-factory.ts:158-161), skinMatrix = Σ w_i * palette[skinIndex_i],
// and the 2-entry pbr-skin-mesh-array BGL wired per-shader in
// buildPbrSkinLayouts. Until then the layout below is the only runnable one.
//
// Param ABI (matches registerMaterialShader paramSchema, declaration order =
// UBO layout order, fire-bolt.wgsl precedent):
//   rimColor    (vec4) — rim tint
//   rimPower    (f32)  — fresnel falloff exponent (higher = thinner edge)
//   rimIntensity(f32)  — additive brightness multiplier
//
// Output: additive emissive rim edge, no lighting. Blend state (one/one)
// comes from the material renderState (see RIM_RENDER_STATE in rim-outline.ts).
// Unlike fire-bolt's premultiplied body, the rim must SUM onto the underlying
// silhouette — one/one keeps overlapping rim fragments from occluding.

struct RimUniforms {
  rimColor     : vec4<f32>,
  rimPower     : f32,
  rimIntensity : f32,
};

@group(1) @binding(0) var<uniform> u : RimUniforms;

struct VsIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
};
struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos   : vec3<f32>,
  @location(1) worldNrm   : vec3<f32>,
};

@vertex
fn vs_main(in : VsIn, @builtin(instance_index) idx : u32) -> VsOut {
  let m = meshes[idx].worldFromLocal;
  let world = m * vec4<f32>(in.pos, 1.0);
  var out : VsOut;
  out.clip = view.worldViewProj * world;
  out.worldPos = world.xyz;
  out.worldNrm = normalize((m * vec4<f32>(in.normal, 0.0)).xyz);
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.worldNrm);
  let v = normalize(view.cameraPos - in.worldPos);
  // Fresnel rim: dot(N,V) is 1 at the silhouette centre and ~0 at the rim
  // (same geometry fact fire-bolt.wgsl documents). Inverting + pow gives the
  // "true silhouette bright edge" — zero at the face, peak at the limb.
  let facing = clamp(dot(n, v), 0.0, 1.0);
  let rim = pow(1.0 - facing, u.rimPower);
  let amp = rim * u.rimIntensity;
  return vec4<f32>(u.rimColor.rgb * amp, amp);
}
