// Deterministic external-asset-package meta for kit GLBs.
// Mirrors wb-ai-asset external-meta-cook GUID rules so scene refs stay stable
// without importing marketplace (not always present in games worktrees).

import { createHash } from 'node:crypto';

export interface KitSubAsset {
  readonly guid: string;
  readonly sourceIndex: number;
  readonly kind: string;
  readonly name?: string;
}

export interface KitExternalMeta {
  readonly schemaVersion: 1;
  readonly kind: 'external-asset-package';
  readonly importer: 'gltf';
  readonly source: string;
  readonly importSettings: { readonly defaultSceneIndex: number };
  readonly subAssets: KitSubAsset[];
}

function hexToUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function meshGuid(contentHash: string, sourceIndex: number): string {
  const h = createHash('sha256').update(`${contentHash}:${sourceIndex}`).digest('hex');
  return hexToUuid(h);
}

function subGuid(contentHash: string, kind: string, sourceIndex: number): string {
  const h = createHash('sha256').update(`${contentHash}:${kind}:${sourceIndex}`).digest('hex');
  return hexToUuid(h);
}

interface GlTFJson {
  readonly meshes?: ReadonlyArray<{ readonly name?: string }>;
  readonly materials?: ReadonlyArray<{ readonly name?: string }>;
  readonly scenes?: ReadonlyArray<{ readonly name?: string }>;
  readonly images?: ReadonlyArray<{ readonly name?: string }>;
  readonly scene?: number;
}

function parseGlbJson(glbBytes: Uint8Array): GlTFJson | null {
  if (glbBytes.length < 20) return null;
  const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLen = view.getUint32(12, true);
  if (jsonLen <= 0 || 20 + jsonLen > glbBytes.length) return null;
  try {
    return JSON.parse(new TextDecoder().decode(glbBytes.subarray(20, 20 + jsonLen))) as GlTFJson;
  } catch {
    return null;
  }
}

/** Cook engine `.glb.meta.json` from authored kit GLB bytes. */
export function cookKitMeta(
  glbBytes: Uint8Array,
  contentHash: string,
  source: string,
): KitExternalMeta | null {
  const json = parseGlbJson(glbBytes);
  if (!json?.meshes?.length) return null;
  const bareHash = contentHash.replace(/^sha256:/, '');
  const subAssets: KitSubAsset[] = [];

  json.meshes.forEach((mesh, sourceIndex) => {
    subAssets.push({
      guid: meshGuid(bareHash, sourceIndex),
      sourceIndex,
      kind: 'mesh',
      ...(mesh.name ? { name: mesh.name } : {}),
    });
  });
  for (let i = 0; i < (json.materials ?? []).length; i++) {
    const m = json.materials![i]!;
    subAssets.push({
      guid: subGuid(bareHash, 'material', i),
      sourceIndex: i,
      kind: 'material',
      ...(m.name ? { name: m.name } : {}),
    });
  }
  for (let i = 0; i < (json.scenes ?? []).length; i++) {
    const s = json.scenes![i]!;
    subAssets.push({
      guid: subGuid(bareHash, 'scene', i),
      sourceIndex: i,
      kind: 'scene',
      ...(s.name ? { name: s.name } : {}),
    });
  }
  for (let i = 0; i < (json.images ?? []).length; i++) {
    const img = json.images![i]!;
    subAssets.push({
      guid: subGuid(bareHash, 'texture', i),
      sourceIndex: i,
      kind: 'texture',
      ...(img.name ? { name: img.name } : {}),
    });
  }

  return {
    schemaVersion: 1,
    kind: 'external-asset-package',
    importer: 'gltf',
    source,
    importSettings: { defaultSceneIndex: json.scene ?? 0 },
    subAssets,
  };
}
