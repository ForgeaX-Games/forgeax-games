// Runtime glTF loader — fetches a .glb, parses it with the engine's pure-function
// glTF pipeline, registers its meshes + materials (WITH decoded textures) as
// engine assets, and caches a ready-to-spawn node list keyed by path.
// `instantiateScene` reads the cache synchronously (GltfRef → real geometry);
// the caller (editor sync / game boot) drives the async load and re-instantiates
// when it lands.
//
// Why a cache instead of loading inside instantiateScene: instantiateScene is
// synchronous and runs on EVERY doc edit. Parsing + decoding a multi-MB GLB on
// each edit would be unusable, so the bytes are parsed + uploaded ONCE here and
// the resulting node list is reused.
//
// Textures: parseGlb decodes geometry + material params but NOT the embedded
// image bytes (it exposes neither buffers nor bufferViews). So we re-read the
// GLB container ourselves to slice each image's PNG/JPEG bytes out of the BIN
// chunk, decode them to RGBA via the browser image path, and register them as
// TextureAssets — otherwise every texture-driven material renders as its (white)
// baseColorFactor. Decode is browser-only (createImageBitmap / OffscreenCanvas);
// in a non-browser context (unit tests) it is skipped and materials fall back to
// flat color.
import { parseGlb, gltfDocToSceneAsset, meshIrToMeshAsset, toMaterialAsset } from '@forgeax/engine-gltf';

/** A node ready to spawn: component data keyed by component name (Transform,
 *  MeshFilter, MeshRenderer, …) exactly as gltfDocToSceneAsset emits it. */
export interface LoadedGltfNode { components: Record<string, Record<string, unknown>> }
export interface LoadedGltf { nodes: ReadonlyArray<LoadedGltfNode> }

interface RegistryLike { register(desc: unknown): { unwrap(): unknown } }
/** Minimal slice of the engine World used for asset allocation. The engine
 *  removed AssetRegistry.register; shared assets are now minted via
 *  `world.allocSharedRef(brand, payload)` which returns a u32 column handle
 *  directly (no Result / no .unwrap()). */
interface WorldLike { allocSharedRef(target: string, payload: unknown): unknown }

const cache = new Map<string, LoadedGltf>();
const inflight = new Map<string, Promise<LoadedGltf | null>>();

/** Synchronous cache lookup used by instantiateScene. null = not loaded yet. */
export function getLoadedGltf(path: string): LoadedGltf | null {
  return cache.get(path) ?? null;
}

/** True once a path's GLB has been parsed + registered (so a caller can decide
 *  whether to kick off `loadGltfRuntime`). */
export function isGltfLoaded(path: string): boolean {
  return cache.has(path);
}

// ── GLB container reader ──────────────────────────────────────────────────────
// parseGlb hides the raw buffers, but embedded textures live as bufferView
// slices of the BIN chunk, so we read the container directly. GLB layout: a
// 12-byte header (magic 'glTF', version, total length) followed by 4-byte-
// aligned chunks, each `[u32 length][u32 type][bytes]`. JSON chunk type =
// 0x4E4F534A ('JSON'), BIN chunk type = 0x004E4942 ('BIN\0').
interface GlbJson {
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string; name?: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
  textures?: Array<{ source?: number; sampler?: number }>;
}
function readGlbContainer(buf: ArrayBuffer): { json: GlbJson; bin: Uint8Array | null } | null {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
  const total = Math.min(dv.getUint32(8, true), buf.byteLength);
  let off = 12;
  let json: GlbJson | null = null;
  let bin: Uint8Array | null = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    off += 8;
    if (off + len > buf.byteLength) break;
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, len))) as GlbJson;
    } else if (type === 0x004e4942) {
      bin = new Uint8Array(buf, off, len);
    }
    off += len; // GLB chunk lengths are already 4-byte aligned (padded).
  }
  return json ? { json, bin } : null;
}

// Decode raw image bytes to RGBA pixels via the browser image pipeline. Returns
// null outside a browser (no createImageBitmap / OffscreenCanvas) so unit tests
// degrade to flat-color materials instead of throwing.
async function decodeImageToRgba(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  const g = globalThis as unknown as {
    createImageBitmap?: (b: Blob) => Promise<{ width: number; height: number; close(): void }>;
    OffscreenCanvas?: new (w: number, h: number) => { getContext(t: '2d'): CanvasRenderingContext2D | null };
  };
  if (typeof g.createImageBitmap !== 'function' || typeof g.OffscreenCanvas !== 'function') return null;
  // Copy into a standalone ArrayBuffer (the slice may be a view over the GLB).
  const blob = new Blob([bytes.slice()], { type: mime });
  const bmp = await g.createImageBitmap(blob);
  try {
    const canvas = new g.OffscreenCanvas(bmp.width, bmp.height);
    const cx = canvas.getContext('2d');
    if (!cx) return null;
    cx.drawImage(bmp as unknown as CanvasImageSource, 0, 0);
    const img = cx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: bmp.width, height: bmp.height, data: img.data };
  } finally {
    bmp.close();
  }
}

// Build a glTF-texture-index → registered TextureAsset handle map by decoding
// every texture's source image. baseColor/emissive textures are sRGB; normal /
// metallic-roughness textures are linear (a format↔colorSpace mismatch is a hard
// error in the registry, so the two must agree). Failures are skipped, not fatal.
async function buildTextureHandles(
  container: { json: GlbJson; bin: Uint8Array | null } | null,
  doc: { textures?: readonly unknown[]; materials: readonly { metallicRoughnessTexture?: number; normalTexture?: number }[] },
  world: WorldLike,
): Promise<Map<number, unknown>> {
  const handles = new Map<number, unknown>();
  if (!container || !container.bin) return handles;
  const { json, bin } = container;
  const textures = json.textures;
  if (!textures) return handles;
  const bufferViews = json.bufferViews ?? [];
  const images = json.images ?? [];

  // Texture indices used as linear data (normal / metallic-roughness) must NOT
  // be sRGB-decoded; everything else is treated as color (sRGB).
  const linear = new Set<number>();
  for (const m of doc.materials) {
    if (typeof m.metallicRoughnessTexture === 'number') linear.add(m.metallicRoughnessTexture);
    if (typeof m.normalTexture === 'number') linear.add(m.normalTexture);
  }

  const texCount = textures.length;
  await Promise.all(
    Array.from({ length: texCount }, (_v, texIndex) => (async () => {
      try {
        const tex = textures[texIndex];
        const imgIndex = tex?.source;
        if (typeof imgIndex !== 'number') return;
        const img = images[imgIndex];
        if (!img || typeof img.bufferView !== 'number') return; // external-URI images unsupported
        const bv = bufferViews[img.bufferView];
        if (!bv) return;
        const start = bv.byteOffset ?? 0;
        const slice = bin.subarray(start, start + bv.byteLength);
        const decoded = await decodeImageToRgba(slice, img.mimeType ?? 'image/png');
        if (!decoded) return;
        const isLinear = linear.has(texIndex);
        // Generate a full mip chain. The engine's default sampler is trilinear
        // (`mipmapFilter:'linear'`) + repeat; without mips, minified/tiled
        // surfaces alias into dense moiré ("过度密集"). The engine builds the
        // mip levels on upload from `mipmap:true` + `mipLevelCount`.
        const mipLevelCount = Math.floor(Math.log2(Math.max(decoded.width, decoded.height))) + 1;
        const texAsset = {
          kind: 'texture' as const,
          width: decoded.width,
          height: decoded.height,
          format: (isLinear ? 'rgba8unorm' : 'rgba8unorm-srgb'),
          data: decoded.data,
          colorSpace: (isLinear ? 'linear' : 'srgb'),
          mipmap: true,
          mipLevelCount,
        };
        handles.set(texIndex, world.allocSharedRef('TextureAsset', texAsset));
      } catch {
        /* skip this texture — material falls back to flat color */
      }
    })()),
  );
  return handles;
}

// Force a material double-sided. Imported CAD/SketchUp scenes commonly use
// negative-scale (mirror) node transforms, which flip triangle winding; with the
// engine's default back-face cull those meshes render inside-out ("spiky" holes).
// cullMode:'none' renders both faces, which is the right default for an imported
// static environment. Rebuilds the (readonly) passes with a renderState override.
function asDoubleSided(mat: { passes?: readonly Record<string, unknown>[] } & Record<string, unknown>): unknown {
  const passes = (mat.passes ?? []).map((p) => ({
    ...p,
    renderState: { ...((p.renderState as Record<string, unknown>) ?? {}), cullMode: 'none' },
  }));
  return { ...mat, passes };
}

/**
 * Fetch + parse + register a GLB once; resolves to its spawnable node list (or
 * null on failure). Concurrent calls for the same path share one in-flight
 * promise. `fetchBytes` lets the caller choose the transport (the editor uses
 * the server's `/api/files/raw`); `assets` is the engine asset registry.
 */
export function loadGltfRuntime(
  path: string,
  fetchBytes: (path: string) => Promise<ArrayBuffer>,
  _assets: RegistryLike,
  world: WorldLike,
): Promise<LoadedGltf | null> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  const live = inflight.get(path);
  if (live) return live;

  const p = (async (): Promise<LoadedGltf | null> => {
    try {
      const buf = await fetchBytes(path);
      // parseGlb wants an ArrayBuffer and returns a Result<GltfDoc>; it also
      // rejects external-URI GLBs (must be a self-contained .glb).
      const res = await parseGlb(buf as never, path) as {
        ok: boolean;
        value?: { meshes: readonly unknown[]; materials: readonly { metallicRoughnessTexture?: number; normalTexture?: number }[]; textures?: readonly unknown[] };
        error?: unknown;
      };
      if (!res?.ok || !res.value) {
        console.warn('[scene] parseGlb rejected:', path, res?.error);
        return null;
      }
      const doc = res.value;

      // Register one MeshAsset per glTF mesh. parseGlb splits each glTF
      // primitive into its own doc.meshes (MeshIr) row, all sharing
      // `meshIndex`; engine #317 (multi-section / multi-material) requires
      // grouping primitives by `meshIndex` and passing the array to
      // `meshIrToMeshAsset` so it produces one MeshAsset with N submeshes.
      // The bridge then expects `meshHandles` keyed by glTF mesh-index (not
      // flat MeshIr index) and pairs `materials[i] <-> submeshes[i]`
      // positionally.
      const meshHandles = new Map<number, unknown>();
      const meshIndices = new Set<number>();
      for (const m of doc.meshes as readonly { meshIndex: number }[]) meshIndices.add(m.meshIndex);
      for (const meshIndex of meshIndices) {
        const prims = (doc.meshes as readonly { meshIndex: number }[]).filter((m) => m.meshIndex === meshIndex);
        if (prims.length === 0) continue;
        meshHandles.set(meshIndex, world.allocSharedRef('MeshAsset', meshIrToMeshAsset(prims as never)));
      }

      // Decode + upload embedded textures (browser only; parseGlb keeps neither
      // buffers nor decoded images), then wire them into double-sided materials.
      const textureHandles = await buildTextureHandles(readGlbContainer(buf), doc as never, world);
      const materialHandles = new Map<number, unknown>();
      doc.materials.forEach((m, i) => {
        const mat = toMaterialAsset(m as never, { textureHandles: textureHandles as never });
        materialHandles.set(i, world.allocSharedRef('MaterialAsset', asDoubleSided(mat as never)));
      });

      // Node structure comes from the engine bridge — now the single source of
      // truth for glTF→scene mapping (multi-primitive + hierarchy, fixed
      // 2026-06). This loader's only additions over the bridge are runtime
      // texture upload + double-sided materials (both done above at the asset
      // level), so the bridge's node list is used verbatim.
      // Engine #316 renamed SceneAsset.nodes -> entities (SceneNode -> SceneEntity).
      const scene = gltfDocToSceneAsset(doc as never, { meshHandles, materialHandles } as never) as {
        entities: ReadonlyArray<{ components: Record<string, Record<string, unknown>> }>;
      };
      const loaded: LoadedGltf = { nodes: scene.entities.map((n) => ({ components: n.components })) };
      cache.set(path, loaded);
      return loaded;
    } catch (e) {
      // Leave it uncached so a later edit can retry; surface why for debugging.
      console.warn('[scene] runtime glTF load failed:', path, (e as Error)?.message ?? e);
      return null;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, p);
  return p;
}

/** Test/debug: drop a cached entry (or all). */
export function _clearGltfCache(path?: string): void {
  if (path) { cache.delete(path); inflight.delete(path); }
  else { cache.clear(); inflight.clear(); }
}
