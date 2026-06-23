// SceneDocument ↔ engine-native scene pack codec.
//
// The editor's interactive authoring model is a SceneDocument (inline materials,
// names, euler rotation — convenient for editing + AI). On disk we persist the
// engine's NATIVE pack format instead of a Studio `scene.json`:
//
//   { schemaVersion, kind:'internal-text-package', assets: [
//       { guid, kind:'scene',    payload:{kind:'scene', nodes}, refs:[guid…] },
//       { guid, kind:'material', payload:{kind:'material', passes, paramValues}, refs:[] },
//       …
//   ] }
//
// Scene-node handle fields (MeshFilter.assetHandle / MeshRenderer.material) hold
// refs-INDEX integers into the scene asset's `refs[]`, which carry GUID strings —
// exactly the engine's `room.pack.json` shape. Materials are split into their own
// `kind:'material'` assets (deduped by content, stable GUID). Meshes reference the
// engine's built-in cube/sphere GUIDs, or a fixed Studio cylinder GUID.
//
// Entity NAMES (no native Transform field for them) are stored via the engine
// `Name` component, so the round-trip preserves Hierarchy names + the `Player`
// gameplay convention.

import type { SceneDocument, EntityId, TransformData, MeshData, MaterialData, LightData, ColliderData } from './types';

// Engine built-in mesh GUIDs (asset-registry.ts BUILTIN_MESH_GUIDS).
export const CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
export const SPHERE_GUID = '95730fd2-9846-5f84-8658-0b3c971eb263';
// Fixed Studio cylinder GUID — registered at app boot (editor + games) since the
// engine has no built-in cylinder. Stable so packs can reference it portably.
export const CYLINDER_GUID = 'c1111111-0000-5000-8000-000000000001';

interface PackAsset { guid: string; kind: string; payload: unknown; refs: string[] }
export interface ScenePack { schemaVersion: string; kind: 'internal-text-package'; assets: PackAsset[] }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Deterministic UUID-shaped string from a key (stable material GUIDs across
 *  saves). FNV-1a over four salted passes → 128 bits → 8-4-4-4-12 hex, with the
 *  version nibble forced to 5 and the variant bits to 0b10xx (RFC-valid shape). */
export function stableGuid(key: string): string {
  const fnv = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  const a = hex(fnv('a|' + key)), b = hex(fnv('b|' + key)), c = hex(fnv('c|' + key)), d = hex(fnv('d|' + key));
  const all = (a + b + c + d).slice(0, 32).split('');
  all[12] = '5';                                   // version 5
  all[16] = (parseInt(all[16]!, 16) & 0x3 | 0x8).toString(16); // variant 10xx
  const s = all.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// ── material content ↔ payload ────────────────────────────────────────────────
function matKey(m: MaterialData | undefined): string {
  const albedo = typeof m?.albedo === 'string' ? m.albedo : '#cccccc';
  const metallic = num(m?.metallic, 0), roughness = num(m?.roughness, 0.8);
  const emissive = typeof m?.emissive === 'string' ? m.emissive : '#000000';
  const ei = num(m?.emissiveIntensity, 1);
  const shading = m?.shading === 'unlit' ? 'unlit' : 'standard';
  return `${shading}|${albedo}|${metallic}|${roughness}|${emissive}|${ei}`;
}
function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [0.8, 0.8, 0.8, 1];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}
function rgbaToHex(c: ReadonlyArray<number | undefined> | undefined): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const [r = 0.8, g = 0.8, b = 0.8] = c ?? [];
  return `#${h(r)}${h(g)}${h(b)}`;
}
function matToPayload(m: MaterialData | undefined): { kind: 'material'; passes: unknown[]; paramValues: Record<string, unknown> } {
  const albedo = typeof m?.albedo === 'string' ? m.albedo : '#cccccc';
  const shading = m?.shading === 'unlit' ? 'unlit' : 'standard';
  const shader = shading === 'unlit' ? 'forgeax::default-unlit' : 'forgeax::default-standard-pbr';
  const paramValues: Record<string, unknown> = { baseColor: hexToRgba(albedo) };
  if (shading === 'standard') {
    paramValues.metallic = num(m?.metallic, 0);
    paramValues.roughness = num(m?.roughness, 0.8);
    const emissive = typeof m?.emissive === 'string' ? m.emissive : '#000000';
    const ei = num(m?.emissiveIntensity, 1);
    const e = hexToRgba(emissive);
    if ((e[0] || e[1] || e[2]) && ei > 0) { paramValues.emissive = [e[0], e[1], e[2]]; paramValues.emissiveIntensity = ei; }
  }
  return { kind: 'material', passes: [{ name: 'Forward', shader, tags: { LightMode: 'Forward' }, queue: 2000 }], paramValues };
}
function payloadToMat(payload: { passes?: Array<{ shader?: string }>; paramValues?: Record<string, unknown> } | undefined): MaterialData {
  const pv = payload?.paramValues ?? {};
  const shading = payload?.passes?.[0]?.shader === 'forgeax::default-unlit' ? 'unlit' : 'standard';
  const mat: MaterialData = { albedo: rgbaToHex(pv.baseColor as number[]), shading };
  if (shading === 'standard') {
    mat.metallic = num(pv.metallic, 0);
    mat.roughness = num(pv.roughness, 0.8);
    if (pv.emissive) { mat.emissive = rgbaToHex(pv.emissive as number[]); mat.emissiveIntensity = num(pv.emissiveIntensity, 1); }
  }
  return mat;
}

const meshGuidForKind = (k: MeshData['kind']): string => (k === 'sphere' ? SPHERE_GUID : k === 'cylinder' ? CYLINDER_GUID : CUBE_GUID);
const kindForMeshGuid = (g: string): MeshData['kind'] => (g === SPHERE_GUID ? 'sphere' : g === CYLINDER_GUID ? 'cylinder' : 'cube');

// quaternion → euler (XYZ, degrees) — for round-tripping authored rotation.
function quatToEuler(qx: number, qy: number, qz: number, qw: number): { rotX: number; rotY: number; rotZ: number } {
  const sinr = 2 * (qw * qx + qy * qz), cosr = 1 - 2 * (qx * qx + qy * qy);
  const rx = Math.atan2(sinr, cosr);
  const sinp = 2 * (qw * qy - qz * qx);
  const ry = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const siny = 2 * (qw * qz + qx * qy), cosy = 1 - 2 * (qy * qy + qz * qz);
  const rz = Math.atan2(siny, cosy);
  const deg = (r: number) => Math.round((r * 180 / Math.PI) * 1e4) / 1e4;
  return { rotX: deg(rx), rotY: deg(ry), rotZ: deg(rz) };
}
const DEG2RAD = Math.PI / 180;
function eulerToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const cx = Math.cos(rx * DEG2RAD / 2), sx = Math.sin(rx * DEG2RAD / 2);
  const cy = Math.cos(ry * DEG2RAD / 2), sy = Math.sin(ry * DEG2RAD / 2);
  const cz = Math.cos(rz * DEG2RAD / 2), sz = Math.sin(rz * DEG2RAD / 2);
  // XYZ order
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/** SceneDocument → native scene pack JSON. */
export function docToPack(doc: SceneDocument): ScenePack {
  const matAssets = new Map<string, PackAsset>(); // guid → asset
  const matGuidByKey = new Map<string, string>();
  const sceneRefs: string[] = [];
  const refIdx = (guid: string): number => { let i = sceneRefs.indexOf(guid); if (i < 0) { i = sceneRefs.length; sceneRefs.push(guid); } return i; };

  const nodes: Array<{ localId: number; components: Record<string, Record<string, unknown>> }> = [];
  const nodeDocIds: EntityId[] = [];                 // parallel to nodes[]: which doc id each came from
  const docIdToLocalId = new Map<EntityId, number>(); // for writing ChildOf.parent below
  let localId = 0;
  for (const id of doc.order) {
    const node = doc.entities[id];
    if (!node || node.hidden) continue;
    const comps = node.components ?? {};
    const t = comps.Transform as TransformData | undefined;
    const light = comps.Light as LightData | undefined;
    const mesh = comps.Mesh as MeshData | undefined;
    const material = comps.Material as MaterialData | undefined;
    const collider = comps.Collider as ColliderData | undefined;

    const isRenderable = !!t && (mesh !== undefined || material !== undefined);
    const isLight = !!light && light.type !== undefined;
    // Keep transform-only entities (empty roots) too — they anchor a hierarchy.
    if (!isRenderable && !isLight && !t) continue;

    const c: Record<string, Record<string, unknown>> = {};
    if (node.name) c.Name = { value: node.name };
    if (t || isLight) {
      const data: Record<string, number> = {
        posX: num(t?.x, 0), posY: num(t?.y, 0), posZ: num(t?.z, 0),
        scaleX: num(t?.scaleX, 1), scaleY: num(t?.scaleY, 1), scaleZ: num(t?.scaleZ, 1),
      };
      const rx = num(t?.rotX, 0), ry = num(t?.rotY, 0), rz = num(t?.rotZ, 0);
      if (rx || ry || rz) { const q = eulerToQuat(rx, ry, rz); data.quatX = q[0]; data.quatY = q[1]; data.quatZ = q[2]; data.quatW = q[3]; }
      c.Transform = data;
    }
    if (isRenderable) {
      c.MeshFilter = { assetHandle: refIdx(meshGuidForKind(mesh?.kind)) };
      const key = matKey(material);
      let mg = matGuidByKey.get(key);
      if (mg === undefined) { mg = stableGuid('mat|' + key); matGuidByKey.set(key, mg); matAssets.set(mg, { guid: mg, kind: 'material', payload: matToPayload(material), refs: [] }); }
      c.MeshRenderer = { material: refIdx(mg) };
    }
    if (collider?.shape && collider.shape !== 'none') c.Collider = { shape: collider.shape, ...(collider.radius !== undefined ? { radius: collider.radius } : {}) };
    if (isLight) {
      const [r, g, b] = hexToRgba(typeof light!.color === 'string' ? light!.color : '#ffffff');
      const intensity = num(light!.intensity, 1);
      if (light!.type === 'directional') {
        c.DirectionalLight = { directionX: num(light!.directionX, -0.4), directionY: num(light!.directionY, -1), directionZ: num(light!.directionZ, -0.3), colorR: r, colorG: g, colorB: b, intensity };
        if (light!.castShadow) c.DirectionalLightShadow = { mapSize: 2048, orthoHalfExtent: 16, farPlane: 60 };
      } else {
        c.PointLight = { colorR: r, colorG: g, colorB: b, intensity, range: num(light!.range, 0) };
      }
    }
    nodes.push({ localId, components: c });
    nodeDocIds.push(id);
    docIdToLocalId.set(id, localId);
    localId++;
  }

  // Write hierarchy back as ChildOf.parent = the parent's pack localId.
  for (let i = 0; i < nodes.length; i++) {
    const parent = doc.entities[nodeDocIds[i]!]?.parent;
    if (parent !== null && parent !== undefined && docIdToLocalId.has(parent)) {
      nodes[i]!.components.ChildOf = { parent: docIdToLocalId.get(parent)! };
    }
  }

  const sceneGuid = stableGuid('scene|' + (doc.order.join(',')));
  // Engine #316 renamed SceneAsset.nodes -> entities (SceneNode -> SceneEntity).
  // The pack scanner schema (`packages/pack/src/schema-compiled.ts`) requires
  // `entities` on `kind: 'scene'` payloads.
  const sceneAsset: PackAsset = { guid: sceneGuid, kind: 'scene', payload: { kind: 'scene', entities: nodes }, refs: sceneRefs };
  return { schemaVersion: '1.0.0', kind: 'internal-text-package', assets: [sceneAsset, ...matAssets.values()] };
}

/** Native scene pack JSON → SceneDocument (inline materials reconstructed). */
export function packToDoc(pack: ScenePack): SceneDocument {
  const scene = pack.assets.find((a) => a.kind === 'scene');
  const matByGuid = new Map(pack.assets.filter((a) => a.kind === 'material').map((a) => [a.guid, a.payload as Parameters<typeof payloadToMat>[0]]));
  const entities: Record<number, SceneDocument['entities'][number]> = {};
  const order: EntityId[] = [];
  let nextId = 1;
  // Engine #316 renamed SceneAsset.nodes -> entities. Read both: the new
  // `entities` field for fresh writes; the legacy `nodes` field for any
  // scene.pack.json files still on disk from before the rename.
  type RawNode = { localId: number; components: Record<string, Record<string, unknown>> };
  const payload = scene?.payload as { entities?: RawNode[]; nodes?: RawNode[] } | undefined;
  const refs = scene?.refs ?? [];
  // Hierarchy: pack ChildOf.parent holds a pack localId; map it to the doc id we
  // assign here so the editor doc keeps the parent/child relationship.
  const localIdToDocId = new Map<number, EntityId>();
  const pendingParent: Array<[EntityId, number]> = [];
  for (const n of payload?.entities ?? payload?.nodes ?? []) {
    const cc = n.components ?? {};
    const docComps: Record<string, unknown> = {};
    const name = (cc.Name?.value as string) ?? `Entity_${n.localId}`;
    const tr = cc.Transform as Record<string, number> | undefined;
    if (tr) {
      const td: TransformData = { x: num(tr.posX, 0), y: num(tr.posY, 0), z: num(tr.posZ, 0), scaleX: num(tr.scaleX, 1), scaleY: num(tr.scaleY, 1), scaleZ: num(tr.scaleZ, 1) };
      if (tr.quatX || tr.quatY || tr.quatZ || (tr.quatW !== undefined && tr.quatW !== 1)) {
        const e = quatToEuler(num(tr.quatX, 0), num(tr.quatY, 0), num(tr.quatZ, 0), num(tr.quatW, 1));
        td.rotX = e.rotX; td.rotY = e.rotY; td.rotZ = e.rotZ;
      }
      docComps.Transform = td;
    }
    const mf = cc.MeshFilter as { assetHandle?: number } | undefined;
    if (mf?.assetHandle !== undefined) docComps.Mesh = { kind: kindForMeshGuid(refs[mf.assetHandle] ?? CUBE_GUID) };
    const mr = cc.MeshRenderer as { material?: number } | undefined;
    if (mr?.material !== undefined) docComps.Material = payloadToMat(matByGuid.get(refs[mr.material] ?? ''));
    if (cc.Collider) docComps.Collider = cc.Collider;
    const dl = cc.DirectionalLight as Record<string, number> | undefined;
    const pl = cc.PointLight as Record<string, number> | undefined;
    if (dl) {
      docComps.Light = { type: 'directional', color: rgbaToHex([dl.colorR, dl.colorG, dl.colorB]), intensity: num(dl.intensity, 1), directionX: num(dl.directionX, -0.4), directionY: num(dl.directionY, -1), directionZ: num(dl.directionZ, -0.3), ...(cc.DirectionalLightShadow ? { castShadow: true } : {}) };
    } else if (pl) {
      docComps.Light = { type: 'point', color: rgbaToHex([pl.colorR, pl.colorG, pl.colorB]), intensity: num(pl.intensity, 1), range: num(pl.range, 0) };
    }
    const id = nextId++;
    entities[id] = { id, name, parent: null, components: docComps };
    order.push(id);
    localIdToDocId.set(n.localId, id);
    const childOf = cc.ChildOf as { parent?: number } | undefined;
    if (childOf?.parent !== undefined) pendingParent.push([id, childOf.parent]);
  }
  // Resolve parent links now that every localId has a doc id.
  for (const [docId, parentLocalId] of pendingParent) {
    const pd = localIdToDocId.get(parentLocalId);
    const ent = entities[docId];
    if (pd !== undefined && ent) ent.parent = pd;
  }
  return { version: '1', nextId, entities, order };
}

/** True if a parsed JSON object looks like a native scene pack (vs a SceneDocument). */
export function isScenePack(obj: unknown): obj is ScenePack {
  return !!obj && typeof obj === 'object' && (obj as { kind?: string }).kind === 'internal-text-package' && Array.isArray((obj as { assets?: unknown }).assets);
}
