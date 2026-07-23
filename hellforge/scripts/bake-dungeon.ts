// Bake the Slagdeep Hollow dungeon into an editable scene pack.
//
//   bun scripts/bake-dungeon.ts
//   bun scripts/fix-prop-materials.ts assets/scenes/slagdeep-hollow.pack.json
//
// Re-run after ANY change to the den generator (pipeline stages, seed, decor).
// writePack() prunes orphan refs[] entries on save.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CUBE_GUID, readPropBBox, remindReload, tileGrid, writePack,
} from './lib/scene-authoring';
import { DUNGEON_SCENE_GUID, DUNGEON_SEED, mulberry32, quatY, type GeoKind } from '../src/dungeon-layout';
import { resolveDungeonLayout } from '../src/dungeon-pipeline';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

// Fixed material GUIDs (generated once; NEVER regenerate).
const MATS: Record<GeoKind, {
  guid: string; name: string;
  base: [number, number, number, number]; rough: number;
  emissive?: [number, number, number]; ei?: number;
}> = {
  floorA:    { guid: '3f7a9c21-1b6e-4a02-8f3d-6c2e91b0a4d1', name: 'DenFloorA', base: [0.16, 0.13, 0.14, 1], rough: 0.9 },
  floorB:    { guid: '84d2f0b5-7e19-4c68-b2a7-0d5c3e8f16a2', name: 'DenFloorB', base: [0.13, 0.11, 0.13, 1], rough: 0.9 },
  wall:      { guid: 'c1e85d73-2f4a-4b90-a6c8-9b7e0d241f83', name: 'DenWall', base: [0.24, 0.17, 0.15, 1], rough: 0.9 },
  torchPost: { guid: '5b09e6f4-8d31-4e57-92ab-4f8c1a6d0e74', name: 'DenTorchPost', base: [0.2, 0.13, 0.08, 1], rough: 0.9 },
  flame:     { guid: 'a76c3e18-0b5f-4d29-8e61-7d3a9f0c25b5', name: 'DenFlame', base: [1, 0.5, 0.12, 1], rough: 0.9, emissive: [1, 0.45, 0.10], ei: 2.2 },
  brazier:   { guid: '29f4b8a6-6c07-4f83-b1d5-5e9c2a7f38c6', name: 'DenBrazier', base: [0.45, 0.08, 0.03, 1], rough: 0.9, emissive: [1, 0.12, 0.03], ei: 1.2 },
  rubble:    { guid: 'e83a1d59-9f62-4a14-87c3-2b0e6d8f41d7', name: 'DenRubble', base: [0.30, 0.26, 0.25, 1], rough: 0.9 },
  bone:      { guid: '60d7f2c4-3a85-4c96-9e07-8c4b1e5a72e8', name: 'DenBone', base: [0.62, 0.56, 0.44, 1], rough: 0.7 },
  slag:      { guid: 'b52e8a07-4d93-4e60-a3f9-1a6d0c9b53f9', name: 'DenSlag', base: [0.40, 0.06, 0.02, 1], rough: 0.5, emissive: [0.55, 0.06, 0.01], ei: 0.35 },
  crate:     { guid: '9a1c3b5e-2d4f-4e8a-9c01-7b3f6d8e0a12', name: 'DenCrate', base: [0.45, 0.30, 0.18, 1], rough: 0.85 },
};

type Policy = 'cube' | 'ground' | 'keep' | 'tile' | 'floorGrid' | 'post';

// Per-kind de-stretch policy.
const POLICY: Record<GeoKind, Policy> = {
  floorA: 'floorGrid',
  floorB: 'floorGrid',
  wall: 'tile',
  torchPost: 'post',
  slag: 'ground',
  flame: 'keep',
  brazier: 'ground',
  rubble: 'ground',
  bone: 'ground',
  crate: 'ground',
};

// Per-kind asset POOL (variant selection breaks mesh repetition). Walls use only
// prop-den-wall: it's a real wall mesh (2×1.49×1.14). prop-den-floor-a is a
// UPRIGHT slab (2×1.49×0.29) — wrong as a wall fill (depth stretch, see f203f24)
// and wrong flat-tiled as a floor (it would shatter into ~0.3 m strips), so it
// serves as COLLAPSED DEBRIS instead: pooled with rubble, uniform-scaled small
// and randomly spun by the 'ground' policy it reads as a fallen wall/floor shard.
// slag now alternates with prop-embercrack (both are low emissive ground pieces);
// torch posts render their real GLB via the 'post' policy (was: plain cube).
const PROP_POOL: Record<GeoKind, string[]> = {
  floorA: ['prop-den-floor-b'],
  floorB: ['prop-den-floor-b'],
  wall: ['prop-den-wall'],
  torchPost: ['prop-den-torch-post'],
  flame: ['prop-den-flame'],
  brazier: ['prop-den-brazier'],
  rubble: ['prop-den-rubble', 'prop-den-floor-a'],
  bone: ['prop-den-bone'],
  slag: ['prop-den-slag', 'prop-embercrack'],
  crate: ['prop-crate'],
};

const layout = resolveDungeonLayout(DUNGEON_SEED);
if (layout.roomCount < 1 || layout.geometry.length < 1) {
  throw new Error(
    'bake-dungeon: resolveDungeonLayout produced an empty dungeon — refusing silent bake',
  );
}
const kinds = Object.keys(MATS) as GeoKind[];

// Load mesh GUID + bbox for every (kind, variant) in the pools. refs[] is the
// flat list [CUBE, ...all pool mesh GUIDs, ...mats]; writePack prunes orphans.
interface PoolEntry { guid: string; bbox: ReturnType<typeof readPropBBox>; }
const poolEntries: Record<GeoKind, PoolEntry[]> = {} as Record<GeoKind, PoolEntry[]>;
for (const k of kinds) {
  poolEntries[k] = PROP_POOL[k].map((stem) => {
    const bbox = readPropBBox(propsDir, stem);
    let guid = CUBE_GUID;
    try {
      const sidecar = JSON.parse(
        readFileSync(join(propsDir, `${stem}.glb.meta.json`), 'utf8'),
      ) as { subAssets?: Array<{ guid: string; kind: string }> };
      const mesh = sidecar.subAssets?.find((s) => s.kind === 'mesh');
      if (!mesh?.guid) {
        console.warn(`  ⚠ ${stem}: no mesh — falling back to CUBE`);
      } else {
        guid = mesh.guid;
      }
    } catch (e) {
      console.warn(`  ⚠ ${stem}: sidecar missing (${(e as Error).message}) — CUBE`);
    }
    return { guid, bbox };
  });
}

const poolCount = kinds.reduce((n, k) => n + poolEntries[k].length, 0);
// ref index for (kind, variant): 1 + offset of kind within the flat pool list.
const propIdx = (k: GeoKind, vi: number): number => {
  let off = 1;
  for (const kk of kinds) {
    if (kk === k) return off + vi;
    off += poolEntries[kk].length;
  }
  throw new Error(`unknown kind ${k}`);
};
const poolBBox = (k: GeoKind, vi: number) => poolEntries[k][vi]!.bbox;
const matIdx = (k: GeoKind): number => 1 + poolCount + kinds.indexOf(k);

const refs: string[] = [
  CUBE_GUID,
  ...kinds.flatMap((k) => poolEntries[k].map((e) => e.guid)),
  ...kinds.map((k) => MATS[k].guid),
];
const cubeIdx = 0;

// Seeded RNG for visual variant + jitter. Separate stream from layout's `rnd`
// (XOR a salt) but still a pure function of DUNGEON_SEED → re-bake is identical.
// Visual-only: never moves an entity off the grid, so runtime walkability is
// unaffected (the dungeon-layout.ts "all randomness lives HERE" invariant holds
// for the GRID; prop choice + decor jitter are non-grid visual detail).
const vrand = mulberry32(DUNGEON_SEED ^ 0x5a5a5a5a);

const counters: Partial<Record<GeoKind, number>> = {};
let nextLocalId = 0;

type BakeTransform = { pos: number[]; scale: number[]; quat?: number[] };

const boxTransform = (g: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rotY?: number }): BakeTransform => {
  const t: BakeTransform = {
    pos: [+g.x.toFixed(4), +g.y.toFixed(4), +g.z.toFixed(4)],
    scale: [+g.sx.toFixed(4), +g.sy.toFixed(4), +g.sz.toFixed(4)],
  };
  if (g.rotY !== undefined) {
    const q = quatY(g.rotY);
    t.quat = [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)];
  }
  return t;
};

const entities = layout.geometry.flatMap((g) => {
  const policy = POLICY[g.kind];
  const n = (counters[g.kind] = (counters[g.kind] ?? 0) + 1);
  const makeEntity = (suffix: string, t: BakeTransform, meshIdx: number, mat?: number) => ({
    localId: nextLocalId++,
    components: {
      Name: { value: `Den_${g.kind}_${n}${suffix}` },
      Transform: t,
      MeshFilter: { assetHandle: meshIdx },
      MeshRenderer: { materials: [mat ?? matIdx(g.kind)] },
    },
  });

  const slot = { pos: [g.x, g.y, g.z] as [number, number, number], size: [g.sx, g.sy, g.sz] as [number, number, number], rotYDeg: g.rotY ?? 0 };
  const bb0 = poolBBox(g.kind, 0);  // primary-variant bbox (floorGrid uses variant 0 only)

  if (policy === 'floorGrid') {
    // tileGrid bottom-aligns the panel to slot.pos[1]. Layout floors store the
    // slab CENTRE (top at y=0 → centre = -sy/2); passing that centre made the
    // mesh top sit ~half-thickness above the walk plane → feet clipped into
    // stone. Pass the slab bottom so the walk surface lands at y=0.
    const floorSlot = {
      pos: [g.x, g.y - g.sy / 2, g.z] as [number, number, number],
      size: slot.size,
      rotYDeg: slot.rotYDeg,
    };
    const segs = tileGrid(floorSlot, bb0);
    return segs.map((s, j) => {
      // Per-segment 90° rotation: floor-b is a 2×2 square tile, so 90° steps
      // preserve the footprint and only rotate the mesh — breaks the grid look
      // if the tile geometry is even slightly asymmetric. s.rotYDeg is 0 for
      // floors, so this adds a clean 0/90/180/270° spin per tile.
      const rot90 = Math.floor(vrand() * 4) * 90;
      const q = quatY(s.rotYDeg + (rot90 * Math.PI) / 180);
      return makeEntity(`__t${j}`, {
        pos: [s.pos[0], s.pos[1], s.pos[2]],
        scale: [s.scale[0], s.scale[1], s.scale[2]],
        quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
      }, propIdx(g.kind, 0));
    });
  }

  if (policy === 'tile') {
    // Walls: tile the wall mesh as a GRID of near-native-size blocks so the FRONT
    // texels stay ~square (NO vertical stretch). The old approach scaled a 1.5 m
    // mesh to fill a 3.2 m wall, stretching the face ~2×; here each column instead
    // STACKS full-height crisp rows (scale y≈1) + a per-column partial top CAP, so
    // HEIGHT varies (jagged tops = the visible random dimension) while faces stay
    // undistorted. Columns span the run length at ~cell width. Depth fills the
    // cell (side faces hidden between contiguous segments). Alternating 180° Y
    // flips break the tile-repetition pattern without needing a second mesh.
    const pool = PROP_POOL[g.kind];
    const vi = Math.floor(vrand() * pool.length);
    const bb = poolBBox(g.kind, vi);
    const [nx, ny, nz] = bb.size;                  // native block size (~2×1.5×1.14)
    const isH = g.sx >= g.sz;                       // run long axis: H→X, V→Z
    const runLen = isH ? g.sx : g.sz;
    const depth = isH ? g.sz : g.sx;               // thin axis = CELL (2.4 m)
    const cols = Math.max(1, Math.round(runLen / nx));
    const colW = runLen / cols;
    const sxFit = colW / nx;                        // block length fit (~1.0–1.2)
    const szFit = depth / nz;                       // fill cell depth (hidden sides)
    const bottom = g.y - g.sy / 2;                 // ground plane (walls sit on floor)
    const baseRotY = isH ? 0 : Math.PI / 2;        // V-run: rotate block length onto Z
    const out: ReturnType<typeof makeEntity>[] = [];
    let idx = 0;
    for (let c = 0; c < cols; c++) {
      const off = -runLen / 2 + colW * (c + 0.5);
      const cxp = g.x + (isH ? off : 0);
      const czp = g.z + (isH ? 0 : off);
      // per-column height = N crisp full rows + a partial top cap (→ jagged top)
      const targetH = g.sy * (0.9 + vrand() * 0.45);      // ~2.9–4.3 m (g.sy = WALL_H)
      const rowsFull = Math.max(1, Math.floor(targetH / ny));
      let capScale = (targetH - rowsFull * ny) / ny;      // 0..1 top-cap fraction
      if (capScale < 0.5) capScale = 0;                    // <½ block → drop (no squished slivers; cap reads as a half-broken top stone)
      const rows = rowsFull + (capScale > 0 ? 1 : 0);
      for (let r = 0; r < rows; r++) {
        const isCap = capScale > 0 && r === rows - 1;
        const sy = isCap ? capScale : 1;
        const yPos = bottom + r * ny - bb.min[1] * sy;     // stack, bottom-align each row
        const flip = (r + c) % 2 === 1;                     // alternate flip breaks repetition
        const q = quatY(baseRotY + (flip ? Math.PI : 0));
        out.push(makeEntity(`__t${idx++}`, {
          pos: [+cxp.toFixed(4), +yPos.toFixed(4), +czp.toFixed(4)],
          scale: [+sxFit.toFixed(4), +sy.toFixed(4), +szFit.toFixed(4)],
          quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
        }, propIdx(g.kind, vi)));
      }
    }
    return out;
  }

  if (policy === 'cube') {
    return [makeEntity('', boxTransform(g), cubeIdx)];
  }

  if (policy === 'post') {
    // Upright fixture (torch post): uniform-scale the GLB to the item's HEIGHT
    // (g.sy), stand it on the floor, random Y spin. The old 'cube' policy drew a
    // plain box here, so prop-den-torch-post never actually appeared in the pack.
    const pool = PROP_POOL[g.kind];
    const vi = Math.floor(vrand() * pool.length);
    const bb = poolBBox(g.kind, vi);
    const us = bb.size[1] > 0 ? g.sy / bb.size[1] : 1;
    const us4 = +us.toFixed(4);
    const q = quatY(vrand() * Math.PI * 2);
    return [makeEntity('', {
      pos: [+g.x.toFixed(4), +(-bb.min[1] * us).toFixed(4), +g.z.toFixed(4)],
      scale: [us4, us4, us4],
      quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
    }, propIdx(g.kind, vi))];
  }

  if (policy === 'ground') {
    // Per-entity variant (slag pool → slag/embercrack) + noticeable jitter for
    // scatter decor (rubble/bone/slag/crate): ±20% uniform scale + full-random
    // Y rotation. Braziers stay aligned (symmetric, flanking the boss room).
    const pool = PROP_POOL[g.kind];
    const vi = Math.floor(vrand() * pool.length);
    const bbV = poolBBox(g.kind, vi);
    const bMax = Math.max(bbV.size[0], bbV.size[1], bbV.size[2]);
    const sMax = Math.max(g.sx, g.sy, g.sz);
    const jitterable = g.kind !== 'brazier';
    let us = bMax > 0 ? sMax / bMax : 1;
    if (jitterable) us *= 0.8 + vrand() * 0.4;   // ±20% size
    const us4 = +us.toFixed(4);
    const t: BakeTransform = {
      pos: [+g.x.toFixed(4), +(-bbV.min[1] * us).toFixed(4), +g.z.toFixed(4)],
      scale: [us4, us4, us4],
    };
    const rotY = jitterable ? vrand() * Math.PI * 2 : g.rotY;
    if (rotY !== undefined) {
      const q = quatY(rotY);
      t.quat = [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)];
    }
    return [makeEntity('', t, propIdx(g.kind, vi))];
  }

  return [makeEntity('', boxTransform(g), propIdx(g.kind, 0))];
});

const pack = {
  schemaVersion: '1.0.0',
  kind: 'internal-text-package',
  assets: [
    {
      guid: DUNGEON_SCENE_GUID,
      kind: 'scene',
      payload: { kind: 'scene', entities },
      refs,
    },
    ...kinds.map((k) => {
      const m = MATS[k];
      const paramValues: Record<string, unknown> = { baseColor: m.base, metallic: 0.02, roughness: m.rough };
      if (m.emissive) { paramValues.emissive = m.emissive; paramValues.emissiveIntensity = m.ei; }
      return {
        guid: m.guid,
        kind: 'material',
        payload: {
          kind: 'material',
          passes: [{ name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 }],
          paramValues,
        },
        refs: [],
      };
    }),
  ],
};

if (entities.length < 1) {
  throw new Error('bake-dungeon: zero entities — refusing silent bake');
}

const out = join(gameRoot, 'assets', 'scenes', 'slagdeep-hollow.pack.json');
mkdirSync(dirname(out), { recursive: true });
writePack(out, pack);

const byPolicy: Record<string, number> = {};
for (const g of layout.geometry) byPolicy[POLICY[g.kind]] = (byPolicy[POLICY[g.kind]] ?? 0) + 1;
console.log(`baked ${entities.length} entities (${layout.roomCount} rooms, seed ${DUNGEON_SEED}) → ${out}`);
console.log(`  policies: ${JSON.stringify(byPolicy)}`);

// bake writes flat placeholder mats (MATS.*); without this step walls/floors
// render clay-smooth (no albedo/normal). Same command the header documents.
const fix = Bun.spawnSync(['bun', 'scripts/fix-prop-materials.ts', out], {
  cwd: gameRoot,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (fix.exitCode !== 0) {
  throw new Error(`fix-prop-materials failed (exit ${fix.exitCode}) — den will look flat`);
}

remindReload(out);
