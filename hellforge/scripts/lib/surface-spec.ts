// Surface-material spec for the shared-prop roughness A/B + den floor variant
// (N4 #15). Single source of truth shared by the bake scripts and the
// surface-materials tests:
//
//   ground (prop-ground)  0.97 — near-matte, barely moved from 0.96
//                                  (writer: scripts/bake-ground.ts)
//   path  (prop-path)     0.85 — trampled earth, slight specular sheen
//   floorB (prop-den-floor-b) 0.78 — slick wet stone, narrow highlights
//   wall  (prop-den-wall) 0.93 — rough rock, broad highlights
//   floorC (prop-den-floor-c) 0.78 — derived floor variant, same surface
//
// prop-path / floor-b / wall carry a metallic-roughness texture; per glTF the
// scalar MULTIPLIES the texture (engine shader: a = max(roughness, .04) ×
// tex[G]), so the A/B differentiation only edits roughnessFactor — textures
// stay untouched.

export const SURFACE_ROUGHNESS = {
  ground: 0.97,
  path: 0.85,
  floorB: 0.78,
  wall: 0.93,
  floorC: 0.78,
} as const;

/** Den floor GLB the variant is derived from. */
export const FLOOR_VARIANT_SOURCE = 'prop-den-floor-b';
/** Derived grime variant GLB (same geometry, re-textured base_color). */
export const FLOOR_VARIANT_STEM = 'prop-den-floor-c';
/** Share of den floor slabs that use the grime variant (floor-b stays primary). */
export const FLOOR_VARIANT_WEIGHT = 0.3;
/** Albdeo derivation params (see scripts/make-floor-c-albedo.py). */
export const FLOOR_VARIANT_ALBEDO = {
  desaturate: 0.6,
  brightness: 0.82,
  hueShift: 8, // PIL H channel 0-255 (~360°): +8 ≈ +11°
} as const;
