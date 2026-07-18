// reshape-scene.ts — de-stretch + author a hand-maintained scene pack
// (rogue-encampment / any internal-text-package scene) via a human-readable
// overrides file. No in-app editor: this is the external authoring loop.
//
//   bun scripts/reshape-scene.ts init  <pack>   # seed <pack>.overrides.json
//   bun scripts/reshape-scene.ts apply <pack>   # write overrides back into <pack>
//   bun scripts/reshape-scene.ts dump  <pack>   # print Name → transform
//
// overrides.json schema (keyed by entity Name):
//   {
//     "Boulder_1": { "mesh": "keep", "scale": 0.75, "ground": true },
//     "Hut1_Wall_N": { "mesh": "cube" },
//     "Crate_2": { "mesh": "keep", "pos": [-3.4, 0.28, -5.7], "scale": 0.55 },
//     "GateColumnL": { "mesh": "cube", "rotYDeg": 0 }
//   }
//
// Fields:
//   mesh    "keep" (current mesh, uniform-scaled) | "cube" (builtin CUBE) | "<prop-stem>" (swap)
//   pos     [x,y,z] absolute; omit = keep original
//   scale   uniform number OR [x,y,z]; omit = keep original (cube entities usually keep)
//   rotYDeg Y rotation in degrees; omit = keep original
//   ground  true → set Transform.pos[1] so the GLB bbox bottom sits at y=0 (decor)
//
// init classifies each mesh entity: chunky GLB in a panel/slab/line slot →
// "cube" (boxes have no UV stretch); volumetric decor → "keep" uniform +
// grounded. Lights are skipped. Edit the seeded file, then `apply`.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CUBE_GUID, ensureRefGuid, readPack, writePack, findSceneAsset, readPropBBox,
  readPropAssets, proposeOverride, applyOverride, getTransform,
  quatFromRotYDeg, remindReload, tileLinear, tileGrid,
  type Override, type TileSlot,
} from './lib/scene-authoring';
import { mulberry32 } from '../src/dungeon-layout';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

function overridesPath(packPath: string): string {
  return packPath.replace(/\.pack\.json$/, '.overrides.json');
}

/** Build meshGUID → prop stem by scanning every prop sidecar. */
function buildGuidToStem(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of readdirSync(propsDir)) {
    if (!f.endsWith('.glb.meta.json')) continue;
    const stem = f.replace(/\.glb\.meta\.json$/, '');
    try {
      const s = JSON.parse(readFileSync(join(propsDir, f), 'utf8')) as {
        subAssets?: Array<{ kind: string; guid: string }>;
      };
      const mesh = s.subAssets?.find((x) => x.kind === 'mesh');
      if (mesh) map.set(mesh.guid, stem);
    } catch { /* skip unreadable sidecar */ }
  }
  return map;
}

function cmdInit(packPath: string): void {
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const guidToStem = buildGuidToStem();

  const overrides: Record<string, Override> = {};
  let skipped = 0;
  for (const e of scene.payload.entities) {
    if (!e.components.MeshFilter) { skipped++; continue; } // lights etc.
    const name = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
    const idx = e.components.MeshFilter.assetHandle as number;
    const guid = scene.refs[idx];
    const stem = guid && guid !== CUBE_GUID ? guidToStem.get(guid) : undefined;
    const bbox = stem ? readPropBBox(propsDir, stem) : null;
    const ov = proposeOverride(e, bbox);
    // Seed explicit pos/rotYDeg so the user sees concrete numbers to nudge.
    const t = getTransform(e);
    if (ov.mesh === 'cube') {
      // Keep the original (box) transform — record it so `apply` is a no-op
      // unless the user edits, and `dump` matches.
      ov.pos = [+t.pos[0].toFixed(4), +t.pos[1].toFixed(4), +t.pos[2].toFixed(4)];
      ov.scale = [+t.scale[0].toFixed(4), +t.scale[1].toFixed(4), +t.scale[2].toFixed(4)];
      const ry = quatToRotYDeg(t);
      if (Math.abs(ry) > 1e-3) ov.rotYDeg = +ry.toFixed(3);
      ov.ground = false;
    } else {
      ov.pos = [+t.pos[0].toFixed(4), /* pos[1] recomputed by ground */ 0, +t.pos[2].toFixed(4)];
      if (!ov.ground) ov.pos[1] = +t.pos[1].toFixed(4);
      const ry = quatToRotYDeg(t);
      if (Math.abs(ry) > 1e-3) ov.rotYDeg = +ry.toFixed(3);
    }
    overrides[name] = ov;
  }

  const out = overridesPath(packPath);
  writeFileSync(out, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  const cube = Object.values(overrides).filter((o) => o.mesh === 'cube').length;
  const keep = Object.values(overrides).filter((o) => o.mesh === 'keep').length;
  console.log(`init → ${out}: ${Object.keys(overrides).length} entities (cube=${cube} keep=${keep}), skipped ${skipped} non-mesh`);
}

function cmdApply(packPath: string, overridesFile?: string): void {
  const ovPath = overridesFile ?? overridesPath(packPath);
  const overrides = JSON.parse(readFileSync(ovPath, 'utf8')) as Record<string, Override>;
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);

  // Cube-reverted entities should NOT keep their prop (textured) material — a
  // prop texture mapped 0-1 across a 4 m cube face re-introduces the stretch we
  // just removed. Relink them to one plain ashen "StructBox" material so the
  // architecture reads as clean untextured boxes (hellforge ash theme).
  const boxMatGuid = 'a5102010-0000-4000-8000-000000000001';
  const hasBoxMat = pack.assets.some((a) => a.guid === boxMatGuid);
  if (!hasBoxMat) {
    pack.assets.push({
      guid: boxMatGuid,
      kind: 'material',
      payload: {
        kind: 'material',
        passes: [{ name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 }],
        paramValues: { baseColor: [0.28, 0.20, 0.16, 1], metallic: 0.02, roughness: 0.92 },
      },
      refs: [],
    });
  }
  const boxMatIdx = ensureRefGuid(scene, boxMatGuid);

  let applied = 0;
  let missing = 0;
  const byName = new Map<string, typeof scene.payload.entities[number]>();
  for (const e of scene.payload.entities) {
    const name = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
    byName.set(name, e);
  }
  for (const [name, ov] of Object.entries(overrides)) {
    const e = byName.get(name);
    if (!e) { missing++; console.warn(`  ⚠ override "${name}": no such entity`); continue; }
    if (!e.components.MeshFilter) { missing++; continue; }
    applyOverride(scene, e, ov, propsDir);
    if (ov.mesh === 'cube') {
      e.components.MeshRenderer = { materials: [boxMatIdx] };
    }
    applied++;
  }
  writePack(packPath, pack);
  console.log(`apply → ${packPath}: ${applied} entities updated, ${missing} unmatched (from ${ovPath})`);
  remindReload(packPath);
}

function cmdDump(packPath: string): void {
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const fmt = (n: number): string => +n.toFixed(2).toString();
  for (const e of scene.payload.entities) {
    const name = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
    const t = getTransform(e);
    const mf = e.components.MeshFilter;
    const idx = mf?.assetHandle as number | undefined;
    const guid = idx != null ? scene.refs[idx] : undefined;
    const mesh = !mf ? 'light' : guid === CUBE_GUID ? 'CUBE' : (guid?.slice(0, 8) ?? '?');
    const ry = quatToRotYDeg(t);
    console.log(
      `${name.padEnd(22)} pos(${fmt(t.pos[0])},${fmt(t.pos[1])},${fmt(t.pos[2])}) ` +
      `scale(${fmt(t.scale[0])},${fmt(t.scale[1])},${fmt(t.scale[2])})` +
      (Math.abs(ry) > 1e-3 ? ` rotY=${ry.toFixed(1)}` : '') +
      ` mesh=${mesh}`,
    );
  }
}

function quatToRotYDeg(t: ReturnType<typeof getTransform>): number {
  if (Math.abs(t.quat[0]) < 1e-6 && Math.abs(t.quat[2]) < 1e-6) {
    return (Math.atan2(t.quat[1], t.quat[3]) * 2 * 180) / Math.PI;
  }
  return 0;
}

const fmt = (n: number): string => +n.toFixed(2).toString();

// ── tiling (thin-panel regen path) ─────────────────────────────────────────
//
//   bun scripts/reshape-scene.ts tile-init  <pack>   # seed <pack>.tiles.json
//   bun scripts/reshape-scene.ts tile-apply <pack>   # replace walls/roofs/fences
//                                                      with tiled thin panels
//
// tiles.json schema (keyed by entity Name):
//   {
//     "Hut1_Wall_N": { "panel": "prop-wall-panel", "mode": "linear",
//       "slot": { "pos": [-6,1.2,-6], "size": [4,2.4,0.3], "rotYDeg": 0 } },
//     "Hut1_Roof":   { "panel": "prop-roof-panel",  "mode": "grid",
//       "slot": { "pos": [-6,2.5,-7.85], "size": [4.2,0.2,4.2], "rotYDeg": 0 } }
//   }
//
// tile-init captures each Wall/Roof/Fence entity's current transform as the
// "slot" (run it on the cube-reshaped pack so the slot is the clean box). The
// user generates the thin panels (THIN-PANEL-ASSET-SPEC.md), points `panel` at
// the right stem, then `tile-apply` replaces each slot with N uniform-scaled,
// unstretched panel segments. Idempotent: re-run removes old `<name>__t*`
// segments and re-tiles from the stored slot.

interface TileSpec {
  panel: string;
  /** Optional panel pool — tile-apply picks one member per slot (seeded by slot
   *  name) so sibling huts/walls get different textures. Falls back to `panel`. */
  panels?: string[];
  mode: 'linear' | 'grid';
  slot: TileSlot;
}

function tilesPath(packPath: string): string {
  return packPath.replace(/\.pack\.json$/, '.tiles.json');
}

/** FNV-1a string hash → uint32 (deterministic per-slot pool pick, no RNG needed). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function cmdTileInit(packPath: string): void {
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const tiles: Record<string, TileSpec> = {};
  for (const e of scene.payload.entities) {
    if (!e.components.MeshFilter) continue;
    const name = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
    const m = name.match(/(Wall|Roof|Fence)/i);
    if (!m) continue;
    const kind = m[1]!.toLowerCase();
    const panel = kind === 'roof' ? 'prop-roof-panel' : kind === 'fence' ? 'prop-fence-panel' : 'prop-wall-panel';
    const mode: 'linear' | 'grid' = kind === 'roof' ? 'grid' : 'linear';
    const t = getTransform(e);
    tiles[name] = {
      panel, mode,
      slot: {
        pos: [+t.pos[0].toFixed(4), +t.pos[1].toFixed(4), +t.pos[2].toFixed(4)],
        size: [+t.scale[0].toFixed(4), +t.scale[1].toFixed(4), +t.scale[2].toFixed(4)],
        rotYDeg: +quatToRotYDeg(t).toFixed(3),
      },
    };
  }
  const out = tilesPath(packPath);
  writeFileSync(out, `${JSON.stringify(tiles, null, 2)}\n`, 'utf8');
  console.log(`tile-init → ${out}: ${Object.keys(tiles).length} tile slots (Wall/Roof/Fence).`);
  console.log(`  Edit each \`panel\` stem to match your generated thin panels, then: bun scripts/reshape-scene.ts tile-apply ${packPath}`);
}

function ensureBoxMat(pack: ReturnType<typeof readPack>, scene: ReturnType<typeof findSceneAsset>): number {
  const boxMatGuid = 'a5102010-0000-4000-8000-000000000001';
  if (!pack.assets.some((a) => a.guid === boxMatGuid)) {
    pack.assets.push({
      guid: boxMatGuid,
      kind: 'material',
      payload: {
        kind: 'material',
        passes: [{ name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 }],
        paramValues: { baseColor: [0.28, 0.20, 0.16, 1], metallic: 0.02, roughness: 0.92 },
      },
      refs: [],
    });
  }
  return ensureRefGuid(scene, boxMatGuid);
}

function cmdTileApply(packPath: string): void {
  const tPath = tilesPath(packPath);
  const tiles = JSON.parse(readFileSync(tPath, 'utf8')) as Record<string, TileSpec>;
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const boxMatIdx = ensureBoxMat(pack, scene);
  const ents = scene.payload.entities;

  // Per entry: only remove the original + old tiles once the panel is confirmed
  // present (missing panels leave the slot untouched). Idempotent on re-run.
  const remove = new Set<typeof ents[number]>();
  let nextId = ents.reduce((m, e) => Math.max(m, e.localId), -1);
  const newEnts: typeof ents = [];
  let applied = 0, missing = 0, segCount = 0;

  for (const [name, spec] of Object.entries(tiles)) {
    // Per-SLOT variant: pick one pool member (seeded by slot name) for the whole
    // slot — walls/roofs stay coherent within a slot, vary across sibling huts.
    const pool = spec.panels ?? [spec.panel];
    const stem = pool[hashStr(name) % pool.length]!;
    const { bbox, meshGuid, materialGuid } = readPropAssets(propsDir, stem);
    if (!meshGuid) {
      missing++;
      console.warn(`  ⚠ ${name}: panel "${stem}" has no mesh sidecar — skipping (generate it first)`);
      continue;
    }
    for (const e of ents) {
      const en = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
      if (en === name || en.startsWith(`${name}__t`)) remove.add(e);
    }
    const segs = spec.mode === 'grid' ? tileGrid(spec.slot, bbox) : tileLinear(spec.slot, bbox);
    const meshIdx = ensureRefGuid(scene, meshGuid);
    const matIdx = materialGuid ? ensureRefGuid(scene, materialGuid) : boxMatIdx;
    for (let j = 0; j < segs.length; j++) {
      const s = segs[j];
      const q = quatFromRotYDeg(s.rotYDeg);
      newEnts.push({
        localId: ++nextId,
        components: {
          Name: { value: `${name}__t${j}` },
          Transform: {
            pos: [s.pos[0], s.pos[1], s.pos[2]],
            scale: [s.scale[0], s.scale[1], s.scale[2]],
            quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
          },
          MeshFilter: { assetHandle: meshIdx },
          MeshRenderer: { materials: [matIdx] },
        },
      });
    }
    segCount += segs.length;
    applied++;
  }

  scene.payload.entities = ents.filter((e) => !remove.has(e)).concat(newEnts);
  writePack(packPath, pack);
  console.log(`tile-apply → ${packPath}: ${applied} slots tiled (${segCount} segments), ${missing} missing panels (from ${tPath})`);
  remindReload(packPath);
}

/** Drop overrides for tiled parent slots; seed {mesh:"keep"} for every __t* segment. */
function cmdSyncOverrides(packPath: string): void {
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const tPath = tilesPath(packPath);
  const ovPath = overridesPath(packPath);
  const tiledParents = new Set<string>();
  if (existsSync(tPath)) {
    const tiles = JSON.parse(readFileSync(tPath, 'utf8')) as Record<string, unknown>;
    for (const name of Object.keys(tiles)) tiledParents.add(name);
  }
  const entityNames = new Set<string>();
  for (const e of scene.payload.entities) {
    const name = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
    entityNames.add(name);
  }
  const old: Record<string, Override> = existsSync(ovPath)
    ? JSON.parse(readFileSync(ovPath, 'utf8')) as Record<string, Override>
    : {};
  const next: Record<string, Override> = {};
  let kept = 0;
  let dropped = 0;
  let seeded = 0;
  for (const [name, ov] of Object.entries(old)) {
    if (tiledParents.has(name) || !entityNames.has(name)) { dropped++; continue; }
    next[name] = ov;
    kept++;
  }
  for (const name of entityNames) {
    if (!name.includes('__t') || next[name]) continue;
    next[name] = { mesh: 'keep' };
    seeded++;
  }
  writeFileSync(ovPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`sync-overrides → ${ovPath}: kept ${kept}, dropped ${dropped} stale, seeded ${seeded} tile segments`);
}

/** Apply seeded size + rotation jitter to Path tile segments (the only camp tiled
 *  strips that are currently uniform AND safe to jitter). prop-path is rectangular
 *  (2×0.865) so only 180° flips preserve the footprint; 90° would swap axes and
 *  misalign the grid. Camp decor (boulder/crate/deadtree) is already hand-authored
 *  in overrides.json; fences + hut wall/roof segments stay aligned (structural /
 *  per-slot clean). Idempotent via a fixed seed. Run AFTER apply/tile-apply. */
function cmdJitter(packPath: string): void {
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const rnd = mulberry32(20260708);
  let jittered = 0, skipped = 0;
  for (const e of scene.payload.entities) {
    const name = (e.components.Name?.value as string) ?? `__localId_${e.localId}`;
    if (!/^Path_\d+__t\d+$/.test(name)) { skipped++; continue; }
    const t = e.components.Transform;
    if (!t) continue;
    const rotRad = Math.floor(rnd() * 2) === 1 ? Math.PI : 0;   // 0° or 180° flip
    t.quat = [0, +Math.sin(rotRad / 2).toFixed(6), 0, +Math.cos(rotRad / 2).toFixed(6)];
    const sMod = 0.9 + rnd() * 0.2;                             // ±10% uniform scale
    t.scale = [
      +(t.scale[0] * sMod).toFixed(4),
      +(t.scale[1] * sMod).toFixed(4),
      +(t.scale[2] * sMod).toFixed(4),
    ];
    jittered++;
  }
  writePack(packPath, pack);
  console.log(`jitter → ${packPath}: ${jittered} Path segments jittered (180° flip + ±10% scale), ${skipped} skipped`);
  remindReload(packPath);
}

// ── scatter (seeded decor placement) ────────────────────────────────────────
//
//   bun scripts/reshape-scene.ts scatter <pack>   # place decor from <pack>.scatter.json
//
// scatter.json schema:
//   {
//     "seed": 20260708,
//     "groups": [
//       { "name": "DeadBranchL", "pool": ["prop-deadtree-branch"], "count": 3,
//         "area": { "kind": "rect", "x": [-20, -4], "z": [15, 26] },
//         "scale": [0.5, 0.85], "minGap": 3 },
//       { "name": "Firewood", "pool": ["prop-campfire-log"], "count": 3,
//         "area": { "kind": "ring", "center": [0, 0], "rMin": 1.1, "rMax": 1.9 },
//         "scale": [0.35, 0.5], "minGap": 0.8 }
//     ]
//   }
//
// Each member: pool pick, seeded position inside the area, full-random Y spin,
// uniform scale in [min,max], grounded on the GLB bbox, prop material wired.
// minGap rejection-samples against the group's placed members (24 tries, then
// place anyway). Idempotent: entities are named Scatter_<group>_<i> and every
// existing Scatter_* is wiped before re-placing — same seed → same layout.

interface ScatterArea {
  kind: 'rect' | 'ring';
  x?: [number, number]; z?: [number, number];            // rect
  center?: [number, number]; rMin?: number; rMax?: number; // ring
}
interface ScatterGroup {
  name: string;
  pool: string[];
  count: number;
  area: ScatterArea;
  scale: [number, number];
  minGap?: number;
}

function scatterPath(packPath: string): string {
  return packPath.replace(/\.pack\.json$/, '.scatter.json');
}

function cmdScatter(packPath: string): void {
  const sPath = scatterPath(packPath);
  const cfg = JSON.parse(readFileSync(sPath, 'utf8')) as { seed: number; groups: ScatterGroup[] };
  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const rnd = mulberry32(cfg.seed);

  // wipe previous scatter output (idempotent re-place)
  const before = scene.payload.entities.length;
  scene.payload.entities = scene.payload.entities.filter((e) => {
    const n = (e.components.Name?.value as string) ?? '';
    return !n.startsWith('Scatter_');
  });
  const wiped = before - scene.payload.entities.length;

  let nextId = scene.payload.entities.reduce((m, e) => Math.max(m, e.localId), -1);
  let placed = 0, missing = 0;
  for (const g of cfg.groups) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < g.count; i++) {
      const stem = g.pool[Math.floor(rnd() * g.pool.length)]!;
      const { bbox, meshGuid, materialGuid } = readPropAssets(propsDir, stem);
      if (!meshGuid) {
        missing++;
        console.warn(`  ⚠ ${g.name}[${i}]: "${stem}" has no mesh sidecar — skipping`);
        continue;
      }
      // seeded position: rejection-sample against the group's own minGap
      let px = 0, pz = 0;
      for (let t = 0; t < 24; t++) {
        if (g.area.kind === 'ring') {
          const [cx, cz] = g.area.center ?? [0, 0];
          const r0 = g.area.rMin ?? 0, r1 = g.area.rMax ?? 1;
          const r = Math.sqrt(r0 * r0 + rnd() * (r1 * r1 - r0 * r0)); // area-uniform
          const th = rnd() * Math.PI * 2;
          px = cx + Math.cos(th) * r; pz = cz + Math.sin(th) * r;
        } else {
          const [x0, x1] = g.area.x ?? [0, 0];
          const [z0, z1] = g.area.z ?? [0, 0];
          px = x0 + rnd() * (x1 - x0); pz = z0 + rnd() * (z1 - z0);
        }
        const gap = g.minGap ?? 0;
        if (!gap || pts.every(([qx, qz]) => (qx - px) ** 2 + (qz - pz) ** 2 >= gap * gap)) break;
      }
      pts.push([px, pz]);
      const us = g.scale[0] + rnd() * (g.scale[1] - g.scale[0]);
      const q = quatFromRotYDeg(rnd() * 360);
      const meshIdx = ensureRefGuid(scene, meshGuid);
      const matIdx = materialGuid ? ensureRefGuid(scene, materialGuid) : ensureBoxMat(pack, scene);
      scene.payload.entities.push({
        localId: ++nextId,
        components: {
          Name: { value: `Scatter_${g.name}_${i}` },
          Transform: {
            pos: [+px.toFixed(4), +(-bbox.min[1] * us).toFixed(4), +pz.toFixed(4)],
            quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
            scale: [+us.toFixed(4), +us.toFixed(4), +us.toFixed(4)],
          },
          MeshFilter: { assetHandle: meshIdx },
          MeshRenderer: { materials: [matIdx] },
        },
      });
      placed++;
    }
  }
  writePack(packPath, pack);
  console.log(`scatter → ${packPath}: wiped ${wiped} old, placed ${placed} (${missing} missing) from ${sPath}`);
  remindReload(packPath);
}

// ── CLI ───────────────────────────────────────────────────────────────────
const [cmd, packArg, ovArg] = process.argv.slice(2) as [string | undefined, string | undefined, string | undefined];
const packPath = packArg ?? join(gameRoot, 'assets', 'scenes', 'rogue-encampment.pack.json');

if (cmd === 'init') cmdInit(packPath);
else if (cmd === 'apply') cmdApply(packPath, ovArg);
else if (cmd === 'tile-init') cmdTileInit(packPath);
else if (cmd === 'tile-apply') cmdTileApply(packPath);
else if (cmd === 'sync-overrides') cmdSyncOverrides(packPath);
else if (cmd === 'jitter') cmdJitter(packPath);
else if (cmd === 'scatter') cmdScatter(packPath);
else if (cmd === 'dump') cmdDump(packPath);
else {
  console.error('usage: bun scripts/reshape-scene.ts <init|apply|tile-init|tile-apply|sync-overrides|jitter|scatter|dump> [pack] [overrides]');
  console.error('  default pack: assets/scenes/rogue-encampment.pack.json');
  process.exit(1);
}
