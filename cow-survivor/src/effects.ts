// effects.ts — load .fx.json asset files at game start and expose them as
// runtime EffectAsset records.
//
// Three categories share the same JSON shape:
//
//   • Skill effects (lightning-bolt, shockwave-ring) — spawned per game
//     event from fx.ts (chain hit / blast / kill).
//   • Scene effects (torch-flame, rune-glow) — bound at level-load time to
//     existing scene entities matched by Name prefix (`attachTo`).
//     Their material gets swapped from the level pack's plain emissive
//     standard material to a custom shader that animates the entity.
//
// New effect = drop `assets/effects/<name>.fx.json` + the matching WGSL +
// `.wgsl.meta.json` sidecar in src/shaders/.

export interface EffectAsset {
  /** Match the registered material-shader id (e.g. `cow_survivor::lightning`). */
  readonly shader: string;
  readonly geometry: 'cube' | 'cube-disc' | 'sphere';
  /** Default lifetime (seconds). Skill effects use this; scene effects
   *  live as long as the entity they attach to. */
  readonly lifetime: number;
  readonly scale: [number, number, number];
  readonly yPos?: number;
  readonly params: {
    baseColor: [number, number, number];
    metallic: number;
    roughness: number;
  };
  readonly poolSize: number;
  /** Scene-effect binding: at level load, the FX system swaps materials
   *  on any scene entity whose Name starts with one of these prefixes. */
  readonly attachTo?: { namePrefix?: string; namePrefixes?: readonly string[] };
}

export type EffectAssets = Readonly<Record<string, EffectAsset>>;

const ASSET_NAMES = [
  'lightning-bolt',
  'shockwave-ring',
  'torch-flame',
  'rune-glow',
  'explosion-fireball',
  'fire-trail',
  'ice-shard',
] as const;

export async function loadEffectAssets(moduleUrl: string): Promise<EffectAssets> {
  const out: Record<string, EffectAsset> = {};
  await Promise.all(ASSET_NAMES.map(async (name) => {
    try {
      const res = await fetch(new URL(`./assets/effects/${name}.fx.json`, moduleUrl), { cache: 'no-store' });
      if (!res.ok) return;
      const raw = await res.json() as Partial<EffectAsset> & {
        spawn?: { lifetime?: number; scale?: [number, number, number]; yPos?: number };
        poolSize?: number;
        attachTo?: EffectAsset['attachTo'];
      };
      const spawn = raw.spawn ?? {};
      const params = raw.params ?? { baseColor: [1, 1, 1], metallic: 0, roughness: 1 };
      out[name] = {
        shader: raw.shader ?? '',
        geometry: (raw.geometry as EffectAsset['geometry']) ?? 'cube',
        lifetime: spawn.lifetime ?? raw.lifetime ?? 0.5,
        scale: spawn.scale ?? raw.scale ?? [1, 1, 1],
        ...(spawn.yPos !== undefined ? { yPos: spawn.yPos } : {}),
        params: {
          baseColor: params.baseColor as [number, number, number],
          metallic: params.metallic ?? 0,
          roughness: params.roughness ?? 1,
        },
        poolSize: raw.poolSize ?? 1,
        ...(raw.attachTo ? { attachTo: raw.attachTo } : {}),
      };
    } catch (err) {
      console.warn(`[effects] failed to load ${name}.fx.json:`, (err as Error).message);
    }
  }));
  return out;
}

/** Walk an effect asset's attachTo prefixes and return the matched name
 *  prefixes (callers iterate scene nodes against these). */
export function effectAttachPrefixes(a: EffectAsset): readonly string[] {
  if (!a.attachTo) return [];
  if (a.attachTo.namePrefixes) return a.attachTo.namePrefixes;
  if (a.attachTo.namePrefix) return [a.attachTo.namePrefix];
  return [];
}
