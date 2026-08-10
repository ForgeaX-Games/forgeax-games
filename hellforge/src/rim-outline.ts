// G2-B spike (N4 lighting/decor): material-level fresnel rim — "true
// silhouette bright edge" for Hellforge enemies / decor.
//
// ── SKINNED-MESH FEASIBILITY VERDICT (investigated 2026-08-02) ─────────────
// NOT FEASIBLE in the current c0 engine: a game-registered material shader
// cannot render on a skinned mesh — the joint palette is hard-wired to the
// engine-reserved `forgeax::pbr-skin` shader and the engine fail-fasts any
// skinned entity whose first-pass material shader is not that id. Evidence
// (engine source in the QA worktree
// `qa-20260731-hellforge-n3-studio/packages/editor/packages/engine/packages`):
//
//   render/src/render-system-extract.ts:3021-3041  — feat-20260611 D-5
//     bidirectional fail-fast: `hasSkinSkel && !isPbrSkinMaterial` routes
//     SkinMaterialMismatchError (render/src/errors/render.ts:593-610,
//     code='skin-material-mismatch', hint: "load the mesh via the gltf
//     importer ... or remove the Skin component") and `continue`s — the
//     entity is dropped from the draw list before any record-stage binding.
//   render/src/record/main-pass-geometry.ts:177,211-227 — skin entry =
//     `entry.source.skin !== undefined` (independent of materialShaderId);
//     the skin PSO probe + 2-entry group(2) bind group are keyed to
//     SKIN_MATERIAL_SHADER_ID = 'forgeax::pbr-skin' (pbr-pipeline.ts:570).
//   render/src/pbr-pipeline.ts:602-637 — buildPbrSkinLayouts: only the skin
//     pipeline layout carries the 2-entry pbr-skin-mesh-array BGL
//     (binding 0 meshes + binding 1 palette).
//   render/src/renderer/renderer-factory.ts:1296-1303 — user-material
//     pipeline layouts are built with the 1-entry `meshBindGroupLayout`, so
//     even a bypassed extract would hit the R1-class BGL-mismatch device
//     error binding the skin BG against a user pipeline.
//   shader/src/default-standard-pbr-skin.wgsl:143-160 — the palette ABI
//     itself (@group(2)@binding(1) array<mat4x4<f32>>, @location(4)
//     skinIndex / @location(5) skinWeight, 6-attribute / 72-byte vertex
//     layout per renderer-factory.ts:158-161) is only consumed by that one
//     engine shader.
//
// Consequence: hellforge::rim-outline ships a NON-SKINNED vertex stage
// (fire-bolt.wgsl idiom) and is only applicable to unskinned primitives:
// fallback PartSpec monster parts (monsters.ts:600-622), GLB nodes without a
// Skin component, and decor props. Applying it to a skinned entity is
// EXPECTED to fire skin-material-mismatch and draw nothing — that is part of
// the spike's verification, not a bug.
//
// ── QA SPIKE CHECKLIST (owner) ──────────────────────────────────────────────
// 1. Register: `ensureRimOutlineRegistered(app)` returns true; re-calling is
//    idempotent (second call swallows 'already registered'). Console shows
//    no `registerMaterialShader(...) threw` warning.
// 2. Unskinned target: applyRimOutline to a fallback-part monster (or a
//    non-Skin GLB node) → silhouette bright edge visible; rim gets thinner
//    as rimPower ↑ and brighter as rimIntensity ↑ (keep amplitude peaks
//    ≤ ~1.1 per ACES lessons, fire-bolt header). Tint switches per kind.
// 3. Skinned target (the spike's core question): applyRimOutline to the
//    enemy GLB's Skin entity (monsters.ts instEntities) → EXPECTED:
//    SkinMaterialMismatchError routed (code skin-material-mismatch) and the
//    entity stops drawing. Revert the apply on skinned entities afterward.
//    This confirms extract-level enforcement — no user shader can reach the
//    joint palette today (feasibility answer: NO).
// 4. Flag: RIM_OUTLINE_ENABLED stays false → zero behaviour change without
//    explicit integration (no registration, no material table, no apply).
// 5. Debug switch: installRimOutlineDebugSwitch(window) exposes
//    `window.__hf.rimOutline` (enabled / shaderId / tintKinds) mirroring the
//    main.ts:1915 `__hf` console-debug pattern.
//
// Everything in this module is new-file spike code; integration hooks (main.ts
// wiring) are intentionally left to the main agent. Flag defaults OFF.

import { MeshRenderer, Materials } from '@forgeax/engine-render';
import type { Handle, MaterialAsset } from '@forgeax/engine-types';
import type { EntityHandle, World } from '@forgeax/engine-ecs';

import rimOutlineShader from './shaders/rim-outline.wgsl';
import { registerMaterialShaderDual } from './register-material-shader';

export type MatHandle = Handle<'MaterialAsset', 'shared'>;

/** UBO-facing params — declaration order must match the WGSL struct (rim-outline.wgsl `RimUniforms`). */
export type RimOutlineParams = {
  rimColor: [number, number, number, number];
  rimPower: number;
  rimIntensity: number;
};

/** ShaderRegistry identifier (user-side namespace, no `forgeax::` reserved prefix). */
export const RIM_OUTLINE_SHADER_ID = 'hellforge::rim-outline';

/**
 * Spike master flag — default OFF. No registration, table or apply runs
 * unless an integrator explicitly wires the module (and flips this constant
 * or toggles the debug switch).
 */
export const RIM_OUTLINE_ENABLED = false;

/** Registration ABI — declaration order is the binding/UBO layout (see wgsl). */
export const RIM_OUTLINE_PARAM_SCHEMA = [
  { name: 'rimColor', type: 'color' },
  { name: 'rimPower', type: 'f32' },
  { name: 'rimIntensity', type: 'f32' },
] as const;

/** Shared-rim tint kinds — one shared material per kind, never per-entity clones. */
export const RIM_TINT_KINDS = ['ember', 'frost', 'brimstone'] as const;
export type RimTintKind = (typeof RIM_TINT_KINDS)[number];

const RIM_TINT_DEFS: Record<RimTintKind, { c: [number, number, number]; power: number; intensity: number }> = {
  // Hellforge palette discipline: rim stays inside the base hue family,
  // amplitudes modest (ACES peak ≤ ~1.1).
  ember: { c: [1.0, 0.35, 0.08], power: 3.0, intensity: 1.0 },
  frost: { c: [0.45, 0.8, 1.0], power: 3.0, intensity: 1.0 },
  brimstone: { c: [0.75, 0.9, 0.25], power: 3.0, intensity: 1.0 },
};

/** Additive one/one — the rim must SUM onto the silhouette, never occlude (unlike fire-bolt's premult body). */
const RIM_RENDER_STATE = {
  depthWriteEnabled: false,
  depthCompare: 'less' as const,
  cullMode: 'none' as const,
  blend: {
    color: { srcFactor: 'one' as const, dstFactor: 'one' as const, operation: 'add' as const },
    alpha: { srcFactor: 'one' as const, dstFactor: 'one' as const, operation: 'add' as const },
  },
};

/**
 * Idempotent `hellforge::rim-outline` registration (safeRegister idiom —
 * 'already registered' swallowed). Dual API: current Engine
 * `installMaterialArtifact`, Engine c0 `registerMaterialShader`. Returns
 * true when the registry exists and the shader is (now or already)
 * registered; false when the registry is unavailable (Edit mode) → caller
 * must skip rim materials.
 */
export function ensureRimOutlineRegistered(app: unknown): boolean {
  return registerMaterialShaderDual(
    app,
    RIM_OUTLINE_SHADER_ID,
    { source: rimOutlineShader.wgsl, paramSchema: RIM_OUTLINE_PARAM_SCHEMA },
    'hellforge/rim-outline',
  );
}

/**
 * Per-kind SHARED rim material table (world.allocSharedRef — one material
 * per tint kind, strictly no per-entity clone; fx.ts:259-265 precedent).
 *
 * Blind Pack-v2 dual shape (fx.ts:268-302): older engines expect
 * `MaterialPass.shader + paramValues`; newer engines use
 * `program.module + values` — probed once from a Materials.standard pass.
 */
export type RimMaterialTable = Record<RimTintKind, MatHandle>;

export function buildRimMaterialTable(world: World): RimMaterialTable {
  const probePass = Materials.standard({
    baseColor: [1, 1, 1, 1],
    roughness: 0.5,
    metallic: 0,
  }).passes?.[0] as { shader?: string; program?: unknown } | undefined;
  const customPassShaderShape = typeof probePass?.shader === 'string';

  const mkCustomMat = (params: RimOutlineParams): MatHandle => {
    if (customPassShaderShape) {
      return world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
        kind: 'material',
        passes: [{
          name: 'Forward',
          shader: RIM_OUTLINE_SHADER_ID,
          tags: { LightMode: 'Forward' },
          queue: 3000,
          passKind: 'forward',
          renderState: RIM_RENDER_STATE,
        }],
        paramValues: params as never,
      } as unknown as MaterialAsset);
    }
    return world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
      kind: 'material',
      passes: [{
        name: 'Forward',
        program: { module: RIM_OUTLINE_SHADER_ID },
        renderState: { ...RIM_RENDER_STATE, tags: { LightMode: 'Forward' }, queue: 3000 },
      }],
      values: params as never,
    });
  };

  const table = {} as RimMaterialTable;
  for (const kind of RIM_TINT_KINDS) {
    const def = RIM_TINT_DEFS[kind];
    table[kind] = mkCustomMat({
      rimColor: [def.c[0], def.c[1], def.c[2], 1],
      rimPower: def.power,
      rimIntensity: def.intensity,
    });
  }
  return table;
}

/**
 * Swap MeshRenderer.materials to the shared rim material for a group of
 * entities (GLB instEntities use case). One kind per call; `kind` defaults
 * to 'ember'. Returns the number of entities applied. Skinned entities will
 * draw NOTHING (extract-level SkinMaterialMismatchError) — see module header.
 */
export function applyRimOutline(
  world: World,
  entities: readonly EntityHandle[],
  table: RimMaterialTable,
  kind: RimTintKind = 'ember',
): number {
  const mat = table[kind];
  if (mat === undefined) return 0;
  let applied = 0;
  for (const e of entities) {
    if (e === undefined || e === 0) continue;
    world.set(e, MeshRenderer, { materials: [mat] });
    applied += 1;
  }
  return applied;
}

/**
 * Debug switch mirroring the main.ts:1915 `__hf` console pattern — merges a
 * `rimOutline` read-only panel into `target.__hf` (no clobber of existing
 * keys). Gives the spike owner a console-visible status surface without
 * touching main.ts.
 */
export function installRimOutlineDebugSwitch(target: { __hf?: unknown }): void {
  const prev =
    typeof target.__hf === 'object' && target.__hf !== null
      ? (target.__hf as Record<string, unknown>)
      : {};
  target.__hf = {
    ...prev,
    rimOutline: {
      enabled: RIM_OUTLINE_ENABLED,
      shaderId: RIM_OUTLINE_SHADER_ID,
      tintKinds: [...RIM_TINT_KINDS],
    },
  };
}
