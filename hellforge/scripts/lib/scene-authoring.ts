// scene-authoring.ts — shared helpers for editing hellforge scene packs.
//
// Used by scripts/bake-dungeon.ts (dungeon) and scripts/reshape-scene.ts (camp).
// Zero external deps: GLB bbox is read straight off the glTF JSON chunk's
// POSITION accessor min/max (every generated prop carries them — verified).
// Editing is surgical: only Transform + MeshFilter.assetHandle are touched;
// refs[] / materials are left to reflow + fix-prop-materials, so this is
// orthogonal to the existing asset-link pipeline.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Engine builtin cube mesh GUID (same constant every pack uses — see AGENTS.md).
export const CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface TransformData {
  posX: number; posY: number; posZ: number;
  quatX: number; quatY: number; quatZ: number; quatW: number;
  scaleX: number; scaleY: number; scaleZ: number;
}

export interface Entity {
  localId: number;
  components: Record<string, Record<string, unknown>>;
}

export interface SceneAsset {
  guid: string;
  kind: 'scene';
  refs: string[];
  payload: { entities: Entity[] };
}

export interface Pack {
  schemaVersion: string;
  kind: string;
  assets: Array<SceneAsset | { guid: string; kind: string; payload: unknown; refs?: string[] }>;
}

// ── pack I/O ──────────────────────────────────────────────────────────────

export function readPack(packPath: string): Pack {
  return JSON.parse(readFileSync(packPath, 'utf8')) as Pack;
}

export function writePack(packPath: string, pack: Pack): void {
  for (const a of pack.assets) {
    if (a.kind === 'scene') pruneUnusedRefs(a as SceneAsset);
  }
  writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
}

/** Compact `scene.refs` to only the GUIDs an entity actually references
 *  (MeshFilter.assetHandle + MeshRenderer.materials[]), remapping every handle.
 *
 *  Why this exists: external authoring scripts (bake-ground, swap-cube-props)
 *  repoint entities to freshly-generated refs but leave the OLD ref GUIDs as
 *  ORPHANS in refs[]. The engine's loadByGuid recurses into EVERY entry of
 *  refs[] (not just used ones), so an orphan whose sidecar was overwritten
 *  (its GUID now 404s on __import) fails the WHOLE scene load → the editor
 *  falls back to the demo seed ("场景资源完全消失"). The editor's own save path
 *  only ever emits used refs; pruning on write mirrors that so external edits
 *  self-heal instead of accumulating land-mine orphans. */
export function pruneUnusedRefs(scene: SceneAsset): void {
  // Collect every handle any entity references. MeshFilter.assetHandle +
  // MeshRenderer.materials[] are the mesh/material edges.
  const readHandles = (e: Entity, sink: (h: number) => void): void => {
    const mf = e.components?.MeshFilter as { assetHandle?: number } | undefined;
    if (typeof mf?.assetHandle === 'number') sink(mf.assetHandle);
    const mr = e.components?.MeshRenderer as { materials?: number[] } | undefined;
    if (Array.isArray(mr?.materials)) for (const h of mr.materials) if (typeof h === 'number') sink(h);
  };
  const used = new Set<number>();
  for (const e of scene.payload.entities) readHandles(e, (h) => used.add(h));
  const keep = [...used].filter((h) => h >= 0 && h < scene.refs.length).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  const newRefs: string[] = [];
  for (const oldH of keep) {
    remap.set(oldH, newRefs.length);
    newRefs.push(scene.refs[oldH]!);
  }
  if (newRefs.length === scene.refs.length) return; // already compact
  const map = (h: number): number => (remap.has(h) ? remap.get(h)! : h);
  for (const e of scene.payload.entities) {
    const mf = e.components?.MeshFilter as { assetHandle?: number } | undefined;
    if (mf && typeof mf.assetHandle === 'number') mf.assetHandle = map(mf.assetHandle);
    const mr = e.components?.MeshRenderer as { materials?: number[] } | undefined;
    if (mr && Array.isArray(mr.materials)) mr.materials = mr.materials.map(map);
  }
  scene.refs = newRefs;
}

export function findSceneAsset(pack: Pack): SceneAsset {
  const s = pack.assets.find((a) => a.kind === 'scene') as SceneAsset | undefined;
  if (!s) throw new Error('pack: no scene asset');
  return s;
}

/** Find `guid` in scene.refs, appending it if missing. Returns the index. */
export function ensureRefGuid(scene: SceneAsset, guid: string): number {
  const i = scene.refs.indexOf(guid);
  if (i >= 0) return i;
  scene.refs.push(guid);
  return scene.refs.length - 1;
}

// ── GLB bbox (zero-dep) ───────────────────────────────────────────────────
// GLB = 12-byte header + chunks {u32 len, char[4] type, bytes}. The JSON chunk
// holds the glTF doc; POSITION accessors carry min/max (glTF spec-required for
// POSITION). We union every mesh primitive's POSITION accessor.

const GLB_MAGIC = 0x46546c67; // 'glTF'

export function measureGlbBBox(glbPath: string): BBox {
  const buf = readFileSync(glbPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) {
    return unitBBox();
  }
  let off = 12;
  let json: glTFDoc | null = null;
  let bin: Buffer | null = null;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(data.toString('utf8')) as glTFDoc;
    else if (type === 'BIN\x00') bin = data;
    off += 8 + len;
  }
  if (!json) return unitBBox();

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let touched = false;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const ai = prim.attributes?.POSITION;
      if (ai == null) continue;
      const acc = json.accessors?.[ai];
      if (!acc || acc.type !== 'VEC3') continue;
      if (acc.min && acc.max) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], acc.min[i]!);
          max[i] = Math.max(max[i], acc.max[i]!);
        }
        touched = true;
      } else if (bin && acc.bufferView != null) {
        // Fallback: scan the BIN stream (FLOAT, componentType 5126).
        scanAccessorFloat3(json, acc, bin, min, max);
        touched = true;
      }
    }
  }
  if (!touched) return unitBBox();
  return {
    min, max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function unitBBox(): BBox {
  return { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] };
}

function scanAccessorFloat3(
  doc: glTFDoc, acc: glTFAccessor, bin: Buffer,
  min: number[], max: number[],
): void {
  const bv = doc.bufferViews?.[acc.bufferView!];
  if (!bv) return;
  const stride = bv.byteStride ?? 12;
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset + off, acc.count * stride);
  for (let i = 0; i < acc.count; i++) {
    const o = i * stride;
    for (let c = 0; c < 3; c++) {
      const v = dv.getFloat32(o + c * 4, true);
      if (Number.isFinite(v)) {
        min[c] = Math.min(min[c], v);
        max[c] = Math.max(max[c], v);
      }
    }
  }
}

interface glTFDoc {
  meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number } }> }>;
  accessors?: glTFAccessor[];
  bufferViews?: Array<{ byteOffset?: number; byteStride?: number }>;
}
interface glTFAccessor {
  type: string; count: number; bufferView?: number; byteOffset?: number;
  min?: number[]; max?: number[];
}

// ── prop bbox via sidecar (cached) ────────────────────────────────────────
// Reads `<stem>.glb.meta.json` to find the source GLB filename, then measures.
// Falls back to a unit box (with a warning) when the sidecar/GLB is missing.

const bboxCache = new Map<string, BBox>();

export function readPropBBox(propsDir: string, stem: string): BBox {
  const cached = bboxCache.get(stem);
  if (cached) return cached;
  let bbox = unitBBox();
  try {
    const sidecar = JSON.parse(readFileSync(join(propsDir, `${stem}.glb.meta.json`), 'utf8')) as {
      source?: string; subAssets?: Array<{ kind: string }>;
    };
    const src = sidecar.source ?? `${stem}.glb`;
    bbox = measureGlbBBox(join(propsDir, src));
  } catch (e) {
    console.warn(`  ⚠ ${stem}: bbox unavailable (${(e as Error).message}) — unit box`);
  }
  bboxCache.set(stem, bbox);
  return bbox;
}

/** Read a prop's mesh GUID, material GUID, and bbox from its sidecar + GLB. */
export function readPropAssets(propsDir: string, stem: string): {
  bbox: BBox; meshGuid: string | null; materialGuid: string | null;
} {
  const bbox = readPropBBox(propsDir, stem);
  let meshGuid: string | null = null;
  let materialGuid: string | null = null;
  try {
    const sidecar = JSON.parse(readFileSync(join(propsDir, `${stem}.glb.meta.json`), 'utf8')) as {
      subAssets?: Array<{ kind: string; guid: string }>;
    };
    meshGuid = sidecar.subAssets?.find((a) => a.kind === 'mesh')?.guid ?? null;
    materialGuid = sidecar.subAssets?.find((a) => a.kind === 'material')?.guid ?? null;
  } catch { /* bbox warning already emitted by readPropBBox */ }
  return { bbox, meshGuid, materialGuid };
}

// ── transform helpers ─────────────────────────────────────────────────────

export function quatFromRotYDeg(deg: number): [number, number, number, number] {
  const r = (deg * Math.PI) / 180;
  return [0, Math.sin(r / 2), 0, Math.cos(r / 2)];
}

/** Write the full Transform component (replaces all fields). */
export function setTransform(e: Entity, t: TransformData): void {
  e.components.Transform = { ...t };
}

/** Patch only the given Transform fields (keeps the rest). */
export function patchTransform(e: Entity, patch: Partial<TransformData>): void {
  const cur = (e.components.Transform ?? {}) as Partial<TransformData>;
  e.components.Transform = { ...cur, ...patch };
}

/** Point an entity's MeshFilter at a ref index (cube or prop mesh GUID). */
export function setMeshHandle(scene: SceneAsset, e: Entity, guid: string): void {
  const idx = ensureRefGuid(scene, guid);
  e.components.MeshFilter = { assetHandle: idx };
}

export function getTransform(e: Entity): TransformData {
  const t = (e.components.Transform ?? {}) as Partial<TransformData>;
  return {
    posX: t.posX ?? 0, posY: t.posY ?? 0, posZ: t.posZ ?? 0,
    quatX: t.quatX ?? 0, quatY: t.quatY ?? 0, quatZ: t.quatZ ?? 0, quatW: t.quatW ?? 1,
    scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1, scaleZ: t.scaleZ ?? 1,
  };
}

// ── de-stretch proposal heuristic ─────────────────────────────────────────
// Treats the entity's max scale value as the intended world size (metres) and
// the prop's natural bbox as its shape. Uniform scale = max(scale) / max(bbox).
// If uniforming would puff the thin axis past 2× the slot's intended thin size,
// the GLB is the wrong shape for a panel/slab/line slot → revert to CUBE
// (boxes stretch fine and have no UV distortion). Otherwise keep the GLB,
// uniform-scaled and grounded (unless it's an effect that sits at a height).

export interface Override {
  /** "keep" = current mesh, uniform-scaled; "cube" = builtin CUBE; "<stem>" = swap to that prop GLB. */
  mesh: string;
  pos?: [number, number, number];
  /** Uniform single number, or [x,y,z] for per-axis (cube). Omit = keep original. */
  scale?: number | [number, number, number];
  rotYDeg?: number;
  /** Ground posY so the prop's bbox bottom sits at y=0. */
  ground?: boolean;
}

const EFFECT_NAME = /Glow|Flame|Light|Ember/i;

export function proposeOverride(e: Entity, bbox: BBox | null): Override {
  const t = getTransform(e);
  const S = [t.scaleX, t.scaleY, t.scaleZ];
  const sMax = Math.max(...S);
  const sMin = Math.min(...S);
  const name = (e.components.Name?.value as string) ?? '';

  // No bbox (e.g. CUBE fallback) → keep mesh, keep transform.
  if (!bbox) return { mesh: 'keep' };

  const B = bbox.size;
  const bMax = Math.max(...B);
  const us = sMax > 0 && bMax > 0 ? sMax / bMax : 1;
  const newThin = Math.min(B[0], B[1], B[2]) * us;
  const tooChunky = newThin > 2 * sMin;

  if (tooChunky) {
    // Panel / slab / line slot + chunky GLB → a thin box reads better than a
    // puffed block. Keep the entity's original (non-uniform) box transform.
    return { mesh: 'cube' };
  }

  // Volumetric decor → keep GLB, uniform-scaled to the intended footprint.
  // Effects (glow/flame/light) keep their authored height (don't ground).
  const isEffect = EFFECT_NAME.test(name);
  return {
    mesh: 'keep',
    scale: +us.toFixed(4),
    ground: !isEffect,
  };
}

/** Apply an override to an entity (idempotent). `propsDir` resolves "<stem>". */
export function applyOverride(
  scene: SceneAsset, e: Entity, ov: Override, propsDir: string,
): void {
  if (!e.components.MeshFilter) return; // lights / non-mesh entities: skip

  // mesh swap
  if (ov.mesh === 'cube') {
    setMeshHandle(scene, e, CUBE_GUID);
  } else if (ov.mesh !== 'keep') {
    // "<stem>" → read prop mesh GUID from sidecar
    const sidecar = JSON.parse(readFileSync(join(propsDir, `${ov.mesh}.glb.meta.json`), 'utf8')) as {
      subAssets?: Array<{ kind: string; guid: string }>;
    };
    const mesh = sidecar.subAssets?.find((s) => s.kind === 'mesh');
    if (mesh) setMeshHandle(scene, e, mesh.guid);
  }

  const cur = getTransform(e);
  const pos = ov.pos ?? [cur.posX, cur.posY, cur.posZ];
  const rotYDeg = ov.rotYDeg ?? quatToRotYDeg(cur);

  let scale: [number, number, number];
  if (Array.isArray(ov.scale)) scale = ov.scale;
  else if (typeof ov.scale === 'number') scale = [ov.scale, ov.scale, ov.scale];
  else scale = [cur.scaleX, cur.scaleY, cur.scaleZ];

  let posY = pos[1];
  if (ov.ground && ov.mesh !== 'cube') {
    const stem = ov.mesh === 'keep' ? null : ov.mesh;
    const bbox = stem ? readPropBBox(propsDir, stem) : guessCurrentBBox(scene, e, propsDir);
    posY = -bbox.min[1] * scale[1];
  }

  const q = quatFromRotYDeg(rotYDeg);
  setTransform(e, {
    posX: pos[0], posY, posZ: pos[2],
    quatX: q[0], quatY: q[1], quatZ: q[2], quatW: q[3],
    scaleX: scale[0], scaleY: scale[1], scaleZ: scale[2],
  });
}

/** For "keep" overrides we don't know the stem → resolve via the current ref GUID. */
function guessCurrentBBox(scene: SceneAsset, e: Entity, propsDir: string): BBox {
  const idx = e.components.MeshFilter?.assetHandle as number | undefined;
  if (idx == null) return unitBBox();
  const guid = scene.refs[idx];
  if (!guid || guid === CUBE_GUID) return unitBBox();
  // Scan prop sidecars for a matching mesh GUID.
  for (const f of readdirSync(propsDir)) {
    if (!f.endsWith('.glb.meta.json')) continue;
    try {
      const s = JSON.parse(readFileSync(join(propsDir, f), 'utf8')) as {
        source?: string; subAssets?: Array<{ kind: string; guid: string }>;
      };
      const mesh = s.subAssets?.find((x) => x.kind === 'mesh');
      if (mesh?.guid === guid) return readPropBBox(propsDir, f.replace(/\.glb\.meta\.json$/, ''));
    } catch { /* skip */ }
  }
  return unitBBox();
}

function quatToRotYDeg(t: TransformData): number {
  // Inverse of quatFromRotYDeg for a pure Y rotation.
  if (Math.abs(t.quatX) < 1e-6 && Math.abs(t.quatZ) < 1e-6) {
    const ang = Math.atan2(t.quatY, t.quatW) * 2;
    return (ang * 180) / Math.PI;
  }
  return 0;
}

// ── tiling ────────────────────────────────────────────────────────────────
// Tile a thin panel across a structural slot, uniform-scaled (no stretch),
// so a generated GLB fills a long/thin slot with real texture instead of a
// plain box. The panel's natural frame is (length=X, height=Y, thickness=Z).

export interface TileSlot {
  pos: [number, number, number];
  size: [number, number, number];
  rotYDeg: number;
}
export interface TileSegment {
  pos: [number, number, number];
  scale: [number, number, number];  // non-uniform: visible face uniform, depth squashed
  rotYDeg: number;
}

const ROT_Y = (deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)]; // [sin, cos] for Y rotation of (x,z)
};

/**
 * 1D tiling for walls / fences. The panel's natural frame is (length=X,
 * height=Y, depth=Z). We uniform-scale X & Y to the slot's height (so the
 * visible FRONT face keeps its texture unstretched), then SQUASH the depth Z
 * down to the slot's thin horizontal dimension — turning a chunky 1.5 m-deep
 * wall block into a 0.3 m-thick wall panel with the front-face texture intact.
 * Tile along the slot's longer horizontal axis; rotate 90° when that axis is Z.
 * Segments are bottom-aligned to the slot's bottom (walls sit on the ground).
 */
export function tileLinear(slot: TileSlot, panel: BBox): TileSegment[] {
  const [sx, sy, sz] = slot.size;
  const longIsZ = sz > sx;
  const slotLong = longIsZ ? sz : sx;
  const thinH = Math.min(sx, sz);                                    // slot's thin horizontal = target depth
  const us = sy > 0 && panel.size[1] > 0 ? sy / panel.size[1] : 1;  // fit height (visible-face uniform)
  // Adaptive depth: if the panel is already thin enough (uniform depth ≤ slot),
  // keep it uniform (pristine — zero distortion). Only squash if the panel is
  // chunkier than the slot (avoids overflow / bunker-thick walls).
  const depthScale = panel.size[2] > 0 ? Math.min(us, thinH / panel.size[2]) : us;
  const segLen = panel.size[0] * us;                                 // panel length (visible, unstretched)
  const N = Math.max(1, Math.ceil(slotLong / segLen));               // cover (overlap ok)
  const slotBottomY = slot.pos[1] - sy / 2;
  const posY = slotBottomY - panel.min[1] * us;                      // bottom-align
  const panelRotY = slot.rotYDeg + (longIsZ ? 90 : 0);              // panel length → slot long axis
  const [ss, cs] = ROT_Y(slot.rotYDeg);                             // offset rotates with the SLOT
  const out: TileSegment[] = [];
  for (let i = 0; i < N; i++) {
    const localOff = N === 1
      ? 0
      : -slotLong / 2 + segLen / 2 + (i / (N - 1)) * (slotLong - segLen);
    // Nudge each successive segment ~2 mm along the slot's THIN (depth) axis so
    // overlapping front faces don't share a plane (avoids Z-fighting). The step
    // is invisible but resolves the depth-buffer fight on the visible face.
    const depthNudge = i * 0.002;
    const lx = longIsZ ? depthNudge : localOff;
    const lz = longIsZ ? localOff : depthNudge;
    const wx = lx * cs - lz * ss;
    const wz = lx * ss + lz * cs;
    out.push({
      pos: [+(slot.pos[0] + wx).toFixed(4), +posY.toFixed(4), +(slot.pos[2] + wz).toFixed(4)],
      scale: [+us.toFixed(4), +us.toFixed(4), +depthScale.toFixed(4)],
      rotYDeg: +panelRotY.toFixed(3),
    });
  }
  return out;
}

/**
 * 2D grid tiling for flat roofs. The panel's natural frame is (length=X,
 * thickness=Y, width=Z). We uniform-scale X & Z to cover the roof (so the
 * visible TOP face keeps its texture ~unstretched), then SQUASH the thickness
 * Y down to the slot's thin Y — turning a 1.8 m-thick roof block into a 0.2 m
 * flat slab with the top texture intact.
 */
export function tileGrid(slot: TileSlot, panel: BBox): TileSegment[] {
  const [sx, sy, sz] = slot.size;
  const pX = panel.size[0], pY = panel.size[1], pZ = panel.size[2];
  const Nx = Math.max(1, Math.round(sx / pX));
  const Nz = Math.max(1, Math.round(sz / pZ));
  const us = Math.max(sx / (Nx * pX), sz / (Nz * pZ)) || 1;          // cover both axes
  // Adaptive thickness: uniform (pristine) if the panel is already thin enough,
  // else squash to the slot's thin Y.
  const depthScale = pY > 0 ? Math.min(us, sy / pY) : us;
  const segLenX = pX * us, segLenZ = pZ * us;
  const posY = slot.pos[1] - panel.min[1] * depthScale;
  const [ss, cs] = ROT_Y(slot.rotYDeg);
  const out: TileSegment[] = [];
  for (let i = 0; i < Nx; i++) {
    for (let j = 0; j < Nz; j++) {
      const offX = Nx === 1 ? 0 : -sx / 2 + segLenX / 2 + (i / (Nx - 1)) * (sx - segLenX);
      const offZ = Nz === 1 ? 0 : -sz / 2 + segLenZ / 2 + (j / (Nz - 1)) * (sz - segLenZ);
      const wx = offX * cs - offZ * ss;
      const wz = offX * ss + offZ * cs;
      // Nudge each segment ~2 mm UP so overlapping top faces don't Z-fight.
      const yNudge = (i * Nz + j) * 0.002;
      out.push({
        pos: [+(slot.pos[0] + wx).toFixed(4), +(posY + yNudge).toFixed(4), +(slot.pos[2] + wz).toFixed(4)],
        scale: [+us.toFixed(4), +depthScale.toFixed(4), +us.toFixed(4)],
        rotYDeg: +slot.rotYDeg.toFixed(3),
      });
    }
  }
  return out;
}
