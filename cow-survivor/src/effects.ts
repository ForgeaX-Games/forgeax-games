// Effect tuning is game behavior, not a second asset transport. Visual geometry and
// materials that belong to a scene are native SceneAssets; this table describes
// runtime-only lifetime, pool, and shader parameter policy for the FxSystem.

export interface EffectAsset {
  /** Match the registered material-shader id (e.g. `cow_survivor::lightning`). */
  readonly shader: string;
  readonly geometry: 'cube' | 'cube-disc' | 'sphere';
  /** Default lifetime (seconds). Skill effects use this; scene effects live as
   * long as the SceneAsset entity they decorate. */
  readonly lifetime: number;
  readonly scale: [number, number, number];
  readonly yPos?: number;
  readonly params: {
    baseColor: [number, number, number];
    metallic: number;
    roughness: number;
  };
  readonly poolSize: number;
  /** Scene-effect binding rule owned by Cow's gameplay layer. */
  readonly attachTo?: { namePrefix?: string; namePrefixes?: readonly string[] };
}

export type EffectAssets = Readonly<Record<string, EffectAsset>>;

/**
 * Runtime-only effect policy. These values used to be duplicated in fetched
 * `.fx.json` blobs; keeping them here makes the game module the sole source for
 * behavior while all authored visual assets travel through AssetRegistry GUIDs.
 */
export const EFFECT_ASSETS: EffectAssets = {
  'lightning-bolt': {
    shader: 'cow_survivor::lightning', geometry: 'cube', lifetime: 0.4,
    scale: [0.22, 0.22, 1.06],
    params: { baseColor: [0.95, 0.85, 1.0], metallic: 0, roughness: 1.4 },
    poolSize: 1,
  },
  'shockwave-ring': {
    shader: 'cow_survivor::shockwave', geometry: 'cube-disc', lifetime: 0.55,
    scale: [9, 0.12, 9], yPos: 0.06,
    params: { baseColor: [1, 0.75, 0.25], metallic: 1, roughness: 4 },
    poolSize: 16,
  },
  'torch-flame': {
    shader: 'cow_survivor::torch_flame', geometry: 'cube', lifetime: 0.5,
    scale: [1, 1, 1],
    params: { baseColor: [0.55, 1, 0.45], metallic: 0, roughness: 1.8 },
    poolSize: 1,
    attachTo: { namePrefix: 'Decor_LanternGlow_' },
  },
  'rune-glow': {
    shader: 'cow_survivor::rune_glow', geometry: 'cube', lifetime: 0.5,
    scale: [1, 1, 1],
    params: { baseColor: [0.55, 0.35, 1], metallic: 0, roughness: 1.4 },
    poolSize: 1,
    attachTo: { namePrefixes: ['Decor_SteleRune', 'AltarRune'] },
  },
  'explosion-fireball': {
    shader: 'cow_survivor::explosion_fireball', geometry: 'sphere', lifetime: 0.45,
    scale: [2.4, 2.4, 2.4], yPos: 0.6,
    params: { baseColor: [1, 0.45, 0.1], metallic: 0, roughness: 2.2 },
    poolSize: 8,
  },
  'fire-trail': {
    shader: 'cow_survivor::fire_trail', geometry: 'cube', lifetime: 0.5,
    scale: [1, 1, 1],
    params: { baseColor: [1, 0.1, 0.03], metallic: 0, roughness: 1.4 },
    poolSize: 1,
  },
  'ice-shard': {
    shader: 'cow_survivor::ice_shard', geometry: 'cube', lifetime: 0.5,
    scale: [1, 1, 1],
    params: { baseColor: [0.6, 0.85, 1], metallic: 0, roughness: 1.4 },
    poolSize: 1,
  },
};

/** Walk an effect asset's attachTo prefixes. */
export function effectAttachPrefixes(asset: EffectAsset): readonly string[] {
  if (!asset.attachTo) return [];
  if (asset.attachTo.namePrefixes) return asset.attachTo.namePrefixes;
  if (asset.attachTo.namePrefix) return [asset.attachTo.namePrefix];
  return [];
}
