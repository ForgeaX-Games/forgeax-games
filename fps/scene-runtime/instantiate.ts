// doc → world instantiator. Projects a SceneDocument onto a real forgeax world
// using the SAME engine the game plays on. Called by:
//   • editor-runtime/engine/sync.ts  (rebuild on every doc edit — WYSIWYG)
//   • games' main.ts                 (▶ Play: fetch scene.json → instantiate)
// One mapping, two callers ⇒ what you edit is what plays.
//
// HDR convention: material emissive / light color are stored as a NORMALIZED hex
// hue plus a magnitude (emissiveIntensity / light intensity). The engine computes
// radiance = color × intensity, so multiplying a ≤1 hue by an HDR intensity
// reproduces values whose channels exceed 1 — while keeping the hue editable with
// an ordinary color picker in the Inspector.
import {
  Transform,
  MeshFilter,
  MeshRenderer,
  DirectionalLight,
  PointLight,
  Materials,
  HANDLE_CUBE,
  HANDLE_SPHERE,
  createSphereGeometry,
  createCylinderGeometry,
  quat,
} from '@forgeax/engine-runtime';
import { getLoadedGltf } from './gltf-runtime';
import type {
  SceneDocument,
  EntityId,
  TransformData,
  MeshData,
  MaterialData,
  LightData,
  ColliderData,
  Collider,
} from './types';

// ── minimal structural engine surface (avoids leaking the engine's full,
//    partly-untyped surface; we only use this slice) ──────────────────────────
/** forgeax entities are opaque numeric ids; we only store/return them. */
type Entity = number;
type Handle = unknown;
interface Result<T> { ok: boolean; value?: T; unwrap(): T; }
export interface WorldLike {
  spawn(...componentDatas: unknown[]): Result<Entity>;
  /** Engine removed AssetRegistry.register; shared assets are now minted via
   *  `world.allocSharedRef(brand, payload)` which returns a u32 column handle
   *  directly (NOT a Result — no .unwrap()). */
  allocSharedRef(target: string, payload: unknown): Handle;
}
export interface AssetsLike {
  /** Legacy slot kept for source-compat with older call sites; the live paths
   *  now allocate via `world.allocSharedRef`. */
  register?(desc: unknown): Result<Handle>;
}
export interface InstantiateCtx {
  world: WorldLike;
  assets: AssetsLike;
  /** Optional: resolve a Material.materialAsset GUID to a ready material handle.
   *  Returns null/undefined → fall back to the entity's inline PBR fields. The
   *  caller pre-loads GUID assets (async) and passes a sync lookup here, so the
   *  instantiator itself stays synchronous. */
  resolveMaterialAsset?: (guid: string) => Handle | null | undefined;
}

export interface InstantiateResult {
  /** doc entity id → a REPRESENTATIVE spawned forgeax entity (for selection /
   *  live-drag lookup). A single doc entity (e.g. a GltfRef) can expand to many
   *  world entities; this maps to just the first, so it is NOT sufficient for
   *  teardown — use `all` for that. */
  entities: Map<EntityId, Entity>;
  /** EVERY forgeax entity spawned by this call, in spawn order. A rebuild MUST
   *  despawn all of these — despawning only `entities.values()` leaks the extra
   *  entities a GltfRef expands into, leaving overlapping duplicate geometry
   *  (z-fighting / flicker) on the next rebuild. */
  all: Entity[];
  /** collision primitives projected from Collider-bearing entities (XZ plane). */
  colliders: Collider[];
}

/** 6-digit hex (#rrggbb) → [r,g,b,1] in 0..1. Bad input → mid-grey. */
export function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [0.8, 0.8, 0.8, 1];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}
function hexToRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex);
  return [r, g, b];
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const DEG2RAD = Math.PI / 180;

/**
 * Build the forgeax world from `doc`. Mesh geometries + materials are registered
 * on demand and cached for the call (identical materials share one handle).
 */
export function instantiateScene(doc: SceneDocument, ctx: InstantiateCtx): InstantiateResult {
  const { world } = ctx;
  const entities = new Map<EntityId, Entity>();
  const all: Entity[] = [];
  const colliders: Collider[] = [];

  // ── mesh handle cache (cube is prebuilt; sphere/cylinder registered once) ──
  const meshCache = new Map<string, Handle>();
  const meshHandle = (kind: MeshData['kind']): Handle => {
    if (kind === 'sphere' || kind === 'cylinder') {
      const cached = meshCache.get(kind);
      if (cached !== undefined) return cached;
      const geo = kind === 'sphere'
        ? createSphereGeometry(1, 20, 14)
        : createCylinderGeometry(0.5, 0.5, 1, 18);
      const h = world.allocSharedRef('MeshAsset', (geo as { unwrap(): unknown }).unwrap());
      meshCache.set(kind, h);
      return h;
    }
    return HANDLE_CUBE;
  };

  // ── material handle cache (keyed by resolved content) ──
  const matCache = new Map<string, Handle>();
  const materialHandle = (m: MaterialData | undefined): Handle => {
    // A referenced material ASSET (GUID) wins over inline PBR when the caller can
    // resolve it (pre-loaded). Otherwise fall through to the inline fields.
    if (m?.materialAsset && ctx.resolveMaterialAsset) {
      const resolved = ctx.resolveMaterialAsset(m.materialAsset);
      if (resolved !== null && resolved !== undefined) return resolved;
    }
    const albedo = typeof m?.albedo === 'string' ? m.albedo : '#cccccc';
    const metallic = num(m?.metallic, 0);
    const roughness = num(m?.roughness, 0.8);
    const emissiveHex = typeof m?.emissive === 'string' ? m.emissive : '#000000';
    const emissiveIntensity = num(m?.emissiveIntensity, 1);
    const shading = m?.shading === 'unlit' ? 'unlit' : 'standard';
    const key = `${shading}|${albedo}|${metallic}|${roughness}|${emissiveHex}|${emissiveIntensity}`;
    const cached = matCache.get(key);
    if (cached !== undefined) return cached;

    let desc: unknown;
    if (shading === 'unlit') {
      desc = Materials.unlit(hexToRgba(albedo));
    } else {
      const e = hexToRgb(emissiveHex);
      const hasEmissive = (e[0] || e[1] || e[2]) && emissiveIntensity > 0;
      desc = Materials.standard({
        baseColor: hexToRgba(albedo),
        roughness,
        metallic,
        ...(hasEmissive ? { emissive: e, emissiveIntensity } : {}),
      });
    }
    const h = world.allocSharedRef('MaterialAsset', desc);
    matCache.set(key, h);
    return h;
  };

  for (const id of doc.order) {
    const node = doc.entities[id];
    if (!node || node.hidden) continue;
    const comps = node.components ?? {};
    const t = comps.Transform as TransformData | undefined;
    const light = comps.Light as LightData | undefined;
    const mesh = comps.Mesh as MeshData | undefined;
    const material = comps.Material as MaterialData | undefined;
    const collider = comps.Collider as ColliderData | undefined;

    const gltfRef = comps.GltfRef as { path?: string; nodeCount?: number; meshCount?: number } | undefined;

    const px = num(t?.x, 0), py = num(t?.y, 0), pz = num(t?.z, 0);
    const sx = num(t?.scaleX, 1), sy = num(t?.scaleY, 1), sz = num(t?.scaleZ, 1);

    // Collider projection (XZ): box half-extents from Transform scale; cylinder
    // from radius. Collected for ANY entity with a Transform + Collider — even an
    // invisible collider-only node (e.g. a watchtower's center box) that spawns
    // no mesh. floor/trim/decor carry shape 'none' (or no Collider) → skipped.
    if (t) {
      const shape = collider?.shape;
      if (shape === 'box') {
        colliders.push({ shape: 'box', x: px, z: pz, hw: sx / 2, hd: sz / 2 });
      } else if (shape === 'cylinder') {
        colliders.push({ shape: 'cylinder', x: px, z: pz, r: num(collider?.radius, Math.max(sx, sz) / 2) });
      }
    }

    // GltfRef: reference to a whole GLB. If the bytes have been loaded by the
    // runtime loader (gltf-runtime.ts), spawn the GLB's REAL meshes — one engine
    // entity per glTF node — offset by this ref entity's transform. Until the
    // async load lands (or if it fails), fall back to a tinted placeholder cube
    // so the entity is still visible + selectable.
    if (gltfRef && t) {
      const loaded = gltfRef.path ? getLoadedGltf(gltfRef.path) : null;
      if (loaded && loaded.nodes.length > 0) {
        let first: Entity | undefined;
        for (const node of loaded.nodes) {
          const nc = node.components;
          const nt = (nc.Transform ?? {}) as Record<string, number>;
          // Compose with the ref entity: translate by (px,py,pz), scale by (sx,sy,sz).
          // (Ref rotation is not composed in v1 — imports start at identity.)
          const data: Record<string, number> = {
            posX: px + num(nt.posX, 0) * sx, posY: py + num(nt.posY, 0) * sy, posZ: pz + num(nt.posZ, 0) * sz,
            scaleX: sx * num(nt.scaleX, 1), scaleY: sy * num(nt.scaleY, 1), scaleZ: sz * num(nt.scaleZ, 1),
            quatX: num(nt.quatX, 0), quatY: num(nt.quatY, 0), quatZ: num(nt.quatZ, 0), quatW: num(nt.quatW, 1),
          };
          const parts: unknown[] = [{ component: Transform, data }];
          if (nc.MeshFilter) parts.push({ component: MeshFilter, data: nc.MeshFilter });
          if (nc.MeshRenderer) parts.push({ component: MeshRenderer, data: nc.MeshRenderer });
          if (parts.length === 1) continue; // transform-only node — nothing to draw
          const ent = world.spawn(...parts).unwrap();
          all.push(ent);
          if (first === undefined) first = ent;
        }
        // Map the doc id to a representative entity so the ref stays selectable.
        if (first !== undefined) { entities.set(id, first); continue; }
      }
      // Not loaded yet → placeholder cube (the loader will trigger a resync).
      const xfData: Record<string, number> = { posX: px, posY: py, posZ: pz, scaleX: sx, scaleY: sy, scaleZ: sz };
      const placeholderMat = world.allocSharedRef('MaterialAsset', Materials.standard({ baseColor: [0.4, 0.7, 1, 0.6], roughness: 0.5, metallic: 0.2 }));
      const entity = world.spawn(
        { component: Transform, data: xfData },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [placeholderMat] } },
      ).unwrap();
      entities.set(id, entity);
      all.push(entity);
      continue;
    }

    // What makes this entity renderable: it has a Transform AND (a Mesh or a
    // Material). A Transform-less node with only children is organizational.
    const isRenderable = !!t && (mesh !== undefined || material !== undefined);
    const isLight = !!light && light.type !== undefined;
    if (!isRenderable && !isLight) continue;

    const parts: unknown[] = [];
    if (t || isLight) {
      const data: Record<string, number> = { posX: px, posY: py, posZ: pz, scaleX: sx, scaleY: sy, scaleZ: sz };
      // rotation: euler degrees (rotX/Y/Z) → quaternion. Identity is omitted so
      // axis-aligned entities (the common case) keep the engine default.
      const rx = num(t?.rotX, 0), ry = num(t?.rotY, 0), rz = num(t?.rotZ, 0);
      if (rx || ry || rz) {
        const q = quat.create();
        quat.fromEuler(q, rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ');
        data.quatX = q[0]; data.quatY = q[1]; data.quatZ = q[2]; data.quatW = q[3];
      }
      parts.push({ component: Transform, data });
    }
    if (isRenderable) {
      parts.push({ component: MeshFilter, data: { assetHandle: meshHandle(mesh?.kind) } });
      parts.push({ component: MeshRenderer, data: { materials: [materialHandle(material)] } });
    }
    if (isLight) {
      if (light!.type === 'directional') {
        // Shadow config is merged onto DirectionalLight (engine #479
        // feat-20260621): castShadow gates the 9 shadow fields living on the
        // same component. Opt-in via Light.castShadow. Engine feat-20260613-csm
        // removed orthoHalfExtent (per-cascade AABB now auto-fits the visible
        // scene) and added cascade fields. cascadeCount: 4 with mapSize: 2048 →
        // 2×2 atlas of size 4096 (under Chrome's maxTextureDimension2D=8192).
        // 4 cascades give the near tier ~5-10 m of high-density shadow coverage
        // so building edges throw crisp ground shadows (SketchUp-style) instead
        // of the soft multi-meter blob a single 2048 cascade produces over a
        // 100 m+ frustum.
        parts.push({
          component: DirectionalLight,
          data: {
            directionX: num(light!.directionX, -0.4),
            directionY: num(light!.directionY, -1),
            directionZ: num(light!.directionZ, -0.3),
            ...rgbIntensity(light!),
            castShadow: !!light!.castShadow,
            ...(light!.castShadow
              ? { cascadeCount: 4, mapSize: 2048, farPlane: 80, nearPlane: 0.1 }
              : {}),
          },
        });
      } else {
        parts.push({
          component: PointLight,
          data: { ...rgbIntensity(light!), range: num(light!.range, 0) },
        });
      }
    }

    const r = world.spawn(...parts);
    if (r.ok && r.value !== undefined) { entities.set(id, r.value); all.push(r.value); }
  }

  return { entities, all, colliders };
}

/** Light color/intensity → engine colorR/G/B + intensity (color is the hue, the
 *  HDR magnitude lives in intensity; engine computes color × intensity). */
function rgbIntensity(l: LightData): { colorR: number; colorG: number; colorB: number; intensity: number } {
  const [r, g, b] = hexToRgb(typeof l.color === 'string' ? l.color : '#ffffff');
  return { colorR: r, colorG: g, colorB: b, intensity: num(l.intensity, 1) };
}

// ── Native engine SceneAsset path ────────────────────────────────────────────
// `buildNativeScene` projects a SceneDocument onto the engine's NATIVE scene
// pipeline: it registers MeshAsset/MaterialAsset handles, builds a `SceneAsset`
// POD ({kind:'scene', nodes:[{localId, components}]}) using the engine's own
// component schemas (Transform posX.. / MeshFilter / MeshRenderer / DirectionalLight
// / PointLight), registers it, and returns the handle.
// The caller (editor sync / game boot) then uses the ENGINE-NATIVE
// `assets.instantiate(handle, world)` + `world.sceneInstances` API instead of a
// hand-rolled `world.spawn` loop — so Edit and Play render through the same
// engine-native scene-instance machinery.
//
// Handle fields hold raw registered Handle values (not GUID strings); the engine's
// `_resolveSceneGuids` passes non-string values through unchanged, so no pack/GUID
// is needed for in-memory rendering (pack GUIDs are a persistence concern, layered
// on top separately).

/** One scene entity projected to engine components (the unit of incremental diff). */
export interface SceneEntity {
  /** doc entity id (the node's localId in the built SceneAsset = its array index). */
  docId: EntityId;
  /** engine component name → POD data (Transform posX.. / MeshFilter / MeshRenderer /
   *  DirectionalLight / PointLight). */
  components: Record<string, Record<string, unknown>>;
}

/** Persistent mesh/material handle caches — pass the SAME object across calls so a
 *  re-projection reuses handles for UNCHANGED content (no re-register, no leak,
 *  and stable handle values so the incremental diff sees "no change"). */
export interface SceneCaches { mesh: Map<string, Handle>; mat: Map<string, Handle>; }
export function makeSceneCaches(): SceneCaches { return { mesh: new Map(), mat: new Map() }; }

/** Engine component tokens keyed by name — for `world.set(entity, token, data)`
 *  incremental patching (the editor maps a changed component name → its token). */
export const SCENE_COMPONENT_TOKENS: Readonly<Record<string, unknown>> = {
  Transform, MeshFilter, MeshRenderer, DirectionalLight, PointLight,
};

export interface SceneEntitiesResult { entities: SceneEntity[]; colliders: Collider[]; }

/**
 * Project `doc` into a flat list of engine-component entities (the SSOT for both
 * the full native build and the incremental diff-patch). Registers mesh/material
 * handles via `caches` (persistent across calls → unchanged content keeps its
 * handle). Pure data: does NOT touch the world.
 */
export function sceneEntities(doc: SceneDocument, ctx: InstantiateCtx, caches: SceneCaches = makeSceneCaches()): SceneEntitiesResult {
  const { world } = ctx;
  const colliders: Collider[] = [];
  const entities: SceneEntity[] = [];

  const meshHandle = (kind: MeshData['kind']): Handle => {
    if (kind === 'sphere') return HANDLE_SPHERE;
    if (kind === 'cylinder') {
      const cached = caches.mesh.get('cylinder');
      if (cached !== undefined) return cached;
      const geo = createCylinderGeometry(0.5, 0.5, 1, 18);
      const h = world.allocSharedRef('MeshAsset', (geo as { unwrap(): unknown }).unwrap());
      caches.mesh.set('cylinder', h);
      return h;
    }
    return HANDLE_CUBE;
  };

  const materialHandle = (m: MaterialData | undefined): Handle => {
    if (m?.materialAsset && ctx.resolveMaterialAsset) {
      const resolved = ctx.resolveMaterialAsset(m.materialAsset);
      if (resolved !== null && resolved !== undefined) return resolved;
    }
    const albedo = typeof m?.albedo === 'string' ? m.albedo : '#cccccc';
    const metallic = num(m?.metallic, 0);
    const roughness = num(m?.roughness, 0.8);
    const emissiveHex = typeof m?.emissive === 'string' ? m.emissive : '#000000';
    const emissiveIntensity = num(m?.emissiveIntensity, 1);
    const shading = m?.shading === 'unlit' ? 'unlit' : 'standard';
    const key = `${shading}|${albedo}|${metallic}|${roughness}|${emissiveHex}|${emissiveIntensity}`;
    const cached = caches.mat.get(key);
    if (cached !== undefined) return cached;
    let desc: unknown;
    if (shading === 'unlit') {
      desc = Materials.unlit(hexToRgba(albedo));
    } else {
      const e = hexToRgb(emissiveHex);
      const hasEmissive = (e[0] || e[1] || e[2]) && emissiveIntensity > 0;
      desc = Materials.standard({ baseColor: hexToRgba(albedo), roughness, metallic, ...(hasEmissive ? { emissive: e, emissiveIntensity } : {}) });
    }
    const h = world.allocSharedRef('MaterialAsset', desc);
    caches.mat.set(key, h);
    return h;
  };

  const transformData = (px: number, py: number, pz: number, sx: number, sy: number, sz: number, t?: TransformData): Record<string, number> => {
    const data: Record<string, number> = { posX: px, posY: py, posZ: pz, scaleX: sx, scaleY: sy, scaleZ: sz };
    const rx = num(t?.rotX, 0), ry = num(t?.rotY, 0), rz = num(t?.rotZ, 0);
    if (rx || ry || rz) {
      const q = quat.create();
      quat.fromEuler(q, rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ');
      data.quatX = q[0]; data.quatY = q[1]; data.quatZ = q[2]; data.quatW = q[3];
    }
    return data;
  };

  // Entities referenced as a parent must be spawned even if they have no mesh/light
  // (an empty transform-only root) — otherwise children can't parent to them and the
  // hierarchy collapses (e.g. a box-man's invisible root). Collect them up front.
  const parentIds = new Set<EntityId>();
  for (const id of doc.order) {
    const p = doc.entities[id]?.parent;
    if (p !== null && p !== undefined) parentIds.add(p);
  }

  for (const id of doc.order) {
    const node = doc.entities[id];
    if (!node || node.hidden) continue;
    const comps = node.components ?? {};
    const t = comps.Transform as TransformData | undefined;
    const light = comps.Light as LightData | undefined;
    const mesh = comps.Mesh as MeshData | undefined;
    const material = comps.Material as MaterialData | undefined;
    const collider = comps.Collider as ColliderData | undefined;
    const gltfRef = comps.GltfRef as { path?: string } | undefined;

    const px = num(t?.x, 0), py = num(t?.y, 0), pz = num(t?.z, 0);
    const sx = num(t?.scaleX, 1), sy = num(t?.scaleY, 1), sz = num(t?.scaleZ, 1);

    if (t) {
      const shape = collider?.shape;
      if (shape === 'box') colliders.push({ shape: 'box', x: px, z: pz, hw: sx / 2, hd: sz / 2 });
      else if (shape === 'cylinder') colliders.push({ shape: 'cylinder', x: px, z: pz, r: num(collider?.radius, Math.max(sx, sz) / 2) });
    }

    // GltfRef (GLB): native GLB→SceneAsset is deferred (engine glTF cook gap);
    // emit a tinted placeholder cube so the ref stays visible + selectable.
    if (gltfRef && t) {
      const placeholderMat = caches.mat.get('__gltf_placeholder__') ?? world.allocSharedRef('MaterialAsset', Materials.standard({ baseColor: [0.4, 0.7, 1, 0.6], roughness: 0.5, metallic: 0.2 }));
      caches.mat.set('__gltf_placeholder__', placeholderMat);
      entities.push({ docId: id, components: {
        Transform: transformData(px, py, pz, sx, sy, sz, t),
        MeshFilter: { assetHandle: HANDLE_CUBE },
        MeshRenderer: { materials: [placeholderMat] },
      } });
      continue;
    }

    const isRenderable = !!t && (mesh !== undefined || material !== undefined);
    const isLight = !!light && light.type !== undefined;
    // Keep transform-only entities that are parents (empty roots) — they render
    // nothing but anchor their children's hierarchy.
    const isParentRoot = !!t && parentIds.has(id);
    if (!isRenderable && !isLight && !isParentRoot) continue;

    const components: Record<string, Record<string, unknown>> = {};
    if (t || isLight) components.Transform = transformData(px, py, pz, sx, sy, sz, t);
    if (isRenderable) {
      components.MeshFilter = { assetHandle: meshHandle(mesh?.kind) };
      // engine #317: MeshRenderer.material (single) -> materials[] (one slot per submesh).
      components.MeshRenderer = { materials: [materialHandle(material)] };
    }
    if (isLight) {
      if (light!.type === 'directional') {
        // Shadow fields merged onto DirectionalLight (engine #479); castShadow gates them.
        components.DirectionalLight = {
          directionX: num(light!.directionX, -0.4),
          directionY: num(light!.directionY, -1),
          directionZ: num(light!.directionZ, -0.3),
          ...rgbIntensity(light!),
          castShadow: !!light!.castShadow,
          ...(light!.castShadow
            ? { cascadeCount: 4, mapSize: 2048, farPlane: 80, nearPlane: 0.1 }
            : {}),
        };
      } else {
        components.PointLight = { ...rgbIntensity(light!), range: num(light!.range, 0) };
      }
    }
    entities.push({ docId: id, components });
  }

  // Emit ChildOf from the doc's parent links. The engine SceneInstanceContainer
  // resolves ChildOf.parent as the node's localId (= its index in this entities
  // array) and remaps it to the spawned Entity (topo-sorted, parents first).
  const indexByDocId = new Map<EntityId, number>(entities.map((e, i) => [e.docId, i]));
  for (let i = 0; i < entities.length; i++) {
    const parent = doc.entities[entities[i]!.docId]?.parent;
    if (parent !== null && parent !== undefined && indexByDocId.has(parent)) {
      entities[i]!.components.ChildOf = { parent: indexByDocId.get(parent)! };
    }
  }

  return { entities, colliders };
}

export interface NativeSceneResult {
  /** Registered SceneAsset handle — pass to `assets.instantiate(handle, world)`. */
  sceneHandle: Handle;
  /** scene-node localId → doc entity id. */
  docIdByLocalId: Map<number, EntityId>;
  /** collision primitives projected from Collider-bearing entities (XZ plane). */
  colliders: Collider[];
}

/** Project `doc` into a registered native `SceneAsset` (localId = list index). */
export function buildNativeScene(doc: SceneDocument, ctx: InstantiateCtx, caches?: SceneCaches): NativeSceneResult {
  const { entities, colliders } = sceneEntities(doc, ctx, caches);
  const nodes = entities.map((e, i) => ({ localId: i, components: e.components }));
  const docIdByLocalId = new Map<number, EntityId>(entities.map((e, i) => [i, e.docId]));
  // Engine #316 renamed SceneAsset.nodes -> entities (SceneNode -> SceneEntity).
  const sceneHandle = ctx.world.allocSharedRef('SceneAsset', { kind: 'scene', entities: nodes });
  return { sceneHandle, docIdByLocalId, colliders };
}

/** Result of a native scene instantiate (engine SceneInstance + doc→entity map). */
export interface NativeInstance {
  /** doc entity id → live engine entity (selection / live-drag / gameplay lookup). */
  byDoc: Map<EntityId, Entity>;
  /** engine SceneInstanceId — pass to `world.sceneInstances.despawnInstance(id)`. */
  instanceId: number;
  /** collision primitives (XZ) projected from Collider-bearing entities. */
  colliders: Collider[];
}

// Register a precomputed entity list as a SceneAsset and instantiate it natively.
// Shared by instantiateNative + the editor's incremental full-rebuild path.
function instantiateEntityList(entities: SceneEntity[], ctx: InstantiateCtx): { byDoc: Map<EntityId, Entity>; instanceId: number } | null {
  const nodes = entities.map((e, i) => ({ localId: i, components: e.components }));
  const w = ctx.world as unknown as {
    sceneInstances: {
      byRef(id: number): { mapping(): ReadonlyMap<number, number> } | undefined;
      setSceneAssetResolver(fn: (h: unknown) => unknown): void;
    };
  };
  const a = ctx.assets as unknown as {
    get(h: unknown): unknown;
    instantiate(handle: unknown, world: unknown): { ok: boolean; value?: number };
  };
  try { w.sceneInstances.setSceneAssetResolver((h) => a.get(h)); } catch { /* older engine */ }
  // Engine #316 renamed SceneAsset.nodes -> entities (SceneNode -> SceneEntity).
  // Engine removed AssetRegistry.register; the SceneAsset POD is now minted as a
  // shared column handle via world.allocSharedRef, then instantiated natively.
  const sceneHandle = ctx.world.allocSharedRef('SceneAsset', { kind: 'scene', entities: nodes });
  const res = a.instantiate(sceneHandle, ctx.world);
  if (!res.ok || res.value === undefined) return null;
  const instanceId = res.value;
  const m = w.sceneInstances.byRef(instanceId)?.mapping();
  const byDoc = new Map<EntityId, Entity>();
  if (m) for (const [localId, entity] of m) {
    const docId = entities[localId]?.docId;
    if (docId !== undefined) byDoc.set(docId, entity);
  }
  return { byDoc, instanceId };
}

/**
 * One-call native instantiate: build a SceneAsset from `doc` and spawn it through
 * the ENGINE-NATIVE `assets.instantiate` + `world.sceneInstances` path. Returns the
 * doc→entity map, the instance id (teardown), and colliders. Null if it failed.
 *
 * Used by games (▶ Play). The editor (✎ Edit) uses `sceneEntities` +
 * `instantiateSceneEntities` directly for incremental diff-patch.
 */
export function instantiateNative(doc: SceneDocument, ctx: InstantiateCtx, caches?: SceneCaches): NativeInstance | null {
  const { entities, colliders } = sceneEntities(doc, ctx, caches);
  const r = instantiateEntityList(entities, ctx);
  return r ? { byDoc: r.byDoc, instanceId: r.instanceId, colliders } : null;
}

/** Instantiate a precomputed entity list natively (editor incremental full-rebuild). */
export function instantiateSceneEntities(entities: SceneEntity[], ctx: InstantiateCtx): { byDoc: Map<EntityId, Entity>; instanceId: number } | null {
  return instantiateEntityList(entities, ctx);
}
