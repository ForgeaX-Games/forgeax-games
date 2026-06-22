// SceneDocument — the authoritative scene format. The editor (✎ Edit) authors it
// through its command bus; games (▶ Play) fetch the SAME JSON and instantiate it
// via `instantiateScene`. Engine-agnostic data only (no engine handles leak in
// here) so the file is git-trackable, AI-readable, and portable.
//
// This is the权威定义 shared across editor-runtime, games, and the engine host.
// editor-runtime's core/types.ts re-exports these and adds its own EditorCommand.

export type EntityId = number;

/** Provenance: which Workbench source produced this instance (enables 编辑源
 *  round-trip back to the originating plugin). */
export interface EntitySource {
  plugin: string;
  docId: string;
}

export interface EntityNode {
  id: EntityId;
  name: string;
  parent: EntityId | null;
  components: Record<string, unknown>;
  source?: EntitySource;
  /** editor-only: hidden entities are not drawn in the viewport (authoring aid). */
  hidden?: boolean;
}

export interface SceneDocument {
  version: string;
  nextId: EntityId;
  entities: Record<EntityId, EntityNode>;
  /** spawn order; per-parent child order derived from `parent`. */
  order: EntityId[];
}

// ── Component value shapes (the fields instantiateScene reads) ────────────────
// All optional/defaulted so partial docs (hand-authored / older) still load.

export interface TransformData {
  x?: number; y?: number; z?: number;
  scaleX?: number; scaleY?: number; scaleZ?: number;
  /** euler degrees (optional; arena geometry is axis-aligned so usually absent). */
  rotX?: number; rotY?: number; rotZ?: number;
}

export type MeshKind = 'cube' | 'sphere' | 'cylinder';
export interface MeshData { kind?: MeshKind; }

export interface MaterialData {
  /** Reference to a material ASSET by GUID (from a .pack). When set AND the
   *  caller supplies a resolver that loads it, this WINS over the inline fields
   *  below — so a material can live in the asset system + be shared, instead of
   *  being inlined per entity. Empty → use the inline PBR fields. */
  materialAsset?: string;
  albedo?: string;            // #rrggbb base color (LDR)
  metallic?: number;          // 0..1
  roughness?: number;         // 0..1
  emissive?: string;          // #rrggbb (normalized hue; HDR magnitude in emissiveIntensity)
  emissiveIntensity?: number; // multiplier (carries >1 HDR magnitude)
  shading?: 'standard' | 'unlit';
}

export type LightType = 'point' | 'spot' | 'directional';
export interface LightData {
  type?: LightType;
  color?: string;             // #rrggbb (normalized hue; magnitude in intensity)
  intensity?: number;
  range?: number;             // point/spot falloff (0 = infinite)
  directionX?: number; directionY?: number; directionZ?: number; // directional only
  spotAngle?: number;
  castShadow?: boolean;
}

export type ColliderShape = 'none' | 'box' | 'cylinder';
export interface ColliderData {
  shape?: ColliderShape;
  /** cylinder radius; box half-extents derive from Transform scale. */
  radius?: number;
}

/** A collision primitive projected from an entity's Collider + Transform, in the
 *  XZ plane. Games map these to their own movement-collision structures. */
export type Collider =
  | { shape: 'box'; x: number; z: number; hw: number; hd: number }
  | { shape: 'cylinder'; x: number; z: number; r: number };
