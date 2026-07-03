// MarsCraft terrain — ported from the Three.js `web/world/Terrain.ts`
// (`_buildTerrainMesh` + `_getTerrainColor` + `getHeightAt` + `_buildBoxWalls`)
// to the forgeax-engine (WebGPU ECS).
//
// ── How the source coloring is preserved ─────────────────────────────────────
// The Three.js terrain is ONE PlaneGeometry mesh with a per-VERTEX color buffer
// + `vertexColors:true`. forgeax's standard PBR material has no per-vertex color
// channel — a material carries a single `baseColor`. So we faithfully approximate
// the source by:
//   1. computing the SAME per-vertex Mars color the source computes
//      (`getTerrainColor`, the exact noise math from `_getTerrainColor`),
//   2. assigning each TRIANGLE a representative color (average of its 3 vertices),
//      quantized into a small palette of buckets,
//   3. building one heightfield MeshAsset per color bucket (only that bucket's
//      triangles), each spawned with a tinted child of the lit PBR base material.
// Result: recognizable Mars regions (regolith / sand / rock / cliff / lava / …)
// instead of a flat tint, within forgeax's per-material-color constraint.
//
// Positions/normals/UVs come straight from `map.heightData` (gridResolution²,
// indexed `z*res + x` exactly as the source). Per-vertex normals are computed
// from the heightfield. The mesh uses the 8-floats/vertex interleaved layout
// (`meshFromInterleaved`: pos3 + normal3 + uv2).

import {
  Transform,
  MeshFilter,
  MeshRenderer,
  createBoxGeometry,
  meshFromInterleaved,
  quat,
  type Handle,
  type MaterialAsset,
  type MeshAsset,
} from '@forgeax/engine-runtime';
import type { World } from '@forgeax/engine-ecs';
import type { AssetGuid } from '@forgeax/engine-pack/guid';
import { TerrainType, type MapConfig } from '../mapgen/types';
import {
  getThemePalette,
  DEFAULT_THEME,
  type TerrainThemePalette,
} from './terrain-themes';

type RGB = [number, number, number];

export interface Terrain {
  /** Bilinear-interpolated terrain height at a world XZ (copy of source `getHeightAt`). */
  heightAt(worldX: number, worldZ: number): number;
}

// ── per-vertex color (ported verbatim from Terrain.ts `_getTerrainColor`) ────
// Returns raw RGB (0..1) instead of a THREE.Color. The cross-product sine/cosine
// noise that breaks up sinusoidal banding is preserved exactly.
function getTerrainColor(
  p: TerrainThemePalette,
  terrain: TerrainType,
  height: number,
  nx: number,
  nz: number,
): RGB {
  const s1 = Math.sin(nx * 23.7 + nz * 17.3);
  const c1 = Math.cos(nx * 19.1 + nz * 29.7);
  const s2 = Math.sin(nx * 47.3 + nz * 37.1);
  const c2 = Math.cos(nx * 61.9 + nz * 53.3);

  const lo = s1 * c1; // low-freq blotches (-1..1)
  const mid = s1 * s2 + c1 * c2; // mid-freq (-2..2)
  const hi = s2 * c2; // high-freq detail (-1..1)
  const uhi = Math.sin(nx * 97.7 + nz * 83.9) * Math.cos(nx * 113.3 + nz * 71.7); // ultra-high

  switch (terrain) {
    case TerrainType.Regolith: {
      const r = p.regolith[0] + (lo * 0.04 + hi * 0.02) + uhi * 0.01 + height * 0.02;
      const g = p.regolith[1] + (lo * 0.04 + hi * 0.02) * 0.5 + uhi * 0.008 + height * 0.012;
      const b = p.regolith[2] + mid * 0.005;
      return [r, g, b];
    }
    case TerrainType.Sand: {
      const dune = lo * 0.035 + mid * 0.012;
      const glint = Math.max(0, uhi) * 0.05;
      return [
        p.sand[0] + dune + glint,
        p.sand[1] + dune * 0.7 + glint * 0.5,
        p.sand[2] + dune * 0.3,
      ];
    }
    case TerrainType.Rock: {
      const grain = mid * 0.02 + uhi * 0.015;
      const vein = Math.abs(hi) < 0.12 ? -0.035 : 0.0;
      return [
        p.rock[0] + grain + vein,
        p.rock[1] + grain * 0.8 + vein,
        p.rock[2] + grain * 0.6 + vein + lo * 0.015,
      ];
    }
    case TerrainType.Ice: {
      const frost = lo * 0.03 + hi * 0.02;
      return [0.7 + frost * 0.4, 0.75 + frost * 0.6, 0.8 + frost];
    }
    case TerrainType.Crater: {
      const depth = lo * 0.02 + hi * 0.01;
      const spark = uhi > 0.7 ? 0.04 : 0.0;
      return [
        p.crater[0] + depth + spark,
        p.crater[1] + depth * 0.6 + spark * 0.4,
        p.crater[2] + depth * 0.3,
      ];
    }
    case TerrainType.Cliff: {
      const layer = lo * 0.04 + mid * 0.015;
      const crack = Math.abs(hi) < 0.08 ? -0.04 : 0.0;
      return [
        p.cliff[0] + layer + crack - height * 0.012,
        p.cliff[1] + layer * 0.6 + crack - height * 0.012,
        p.cliff[2] + layer * 0.8 + crack,
      ];
    }
    case TerrainType.Ramp: {
      const tex = lo * 0.03 + mid * 0.01;
      return [p.ramp[0] + tex + uhi * 0.015, p.ramp[1] + tex * 0.7, p.ramp[2] + tex * 0.3];
    }
    case TerrainType.Lava: {
      const flow = Math.sin(nx * 41.3 + nz * 29.7) * Math.cos(nx * 17.2 + nz * 53.1);
      if (flow > 0.45) return [0.18, 0.06, 0.03];
      const t = (Math.sin(nx * 23.1 + nz * 11.9) + 1) * 0.5;
      // lerp(base, target, t)
      return [
        0.95 + (0.85 - 0.95) * t,
        0.35 + (0.18 - 0.35) * t,
        0.05 + (0.02 - 0.05) * t,
      ];
    }
    case TerrainType.Water: {
      const shimmer = s1 * c2 * 0.04;
      const k = Math.abs(lo) * 0.3;
      return [
        0.08 + (0.05 - 0.08) * k,
        0.18 + (0.12 - 0.18) * k,
        0.42 + (0.32 - 0.42) * k + shimmer,
      ];
    }
    case TerrainType.Void: {
      const k = Math.abs(lo) * 0.2;
      return [0.05 + (0.02 - 0.05) * k, 0.03 + (0.01 - 0.03) * k, 0.08 + (0.04 - 0.08) * k];
    }
    default:
      return [p.regolith[0], p.regolith[1], p.regolith[2]];
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Bilinear height sample — ported from Terrain.ts `getHeightAt`. */
function sampleHeight(map: MapConfig, worldX: number, worldZ: number): number {
  const res = map.gridResolution;
  const gx = ((worldX + map.width / 2) / map.width) * (res - 1);
  const gz = ((worldZ + map.height / 2) / map.height) * (res - 1);
  const x0 = Math.max(0, Math.min(res - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(res - 2, Math.floor(gz)));
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const fx = gx - x0;
  const fz = gz - z0;
  const h00 = map.heightData[z0 * res + x0];
  const h10 = map.heightData[z0 * res + x1];
  const h01 = map.heightData[z1 * res + x0];
  const h11 = map.heightData[z1 * res + x1];
  return (
    h00 * (1 - fx) * (1 - fz) +
    h10 * fx * (1 - fz) +
    h01 * (1 - fx) * fz +
    h11 * fx * fz
  );
}

/**
 * Build the Mars terrain into `world` and return a `Terrain` handle exposing
 * `heightAt`. Spawns one heightfield MeshAsset per color bucket + cliff box walls.
 *
 * @param world    the ECS world
 * @param baseGuid the lit PBR base-material GUID (tinted per color bucket)
 * @param litMaterial factory that mints a tinted child of `baseGuid`
 * @param map      the generated MapConfig (heightData indexed `z*res + x`)
 */
export function buildTerrain(
  world: World,
  baseGuid: AssetGuid,
  litMaterial: (rgb: RGB, opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>,
  map: MapConfig,
): Terrain {
  const palette = getThemePalette(map.theme ?? DEFAULT_THEME);
  const res = map.gridResolution;
  const W = map.width;
  const H = map.height;

  // ── 1. world-space vertex positions (X,Z grid, Y = heightData) + per-vertex color ──
  // Grid index i = row*res + col = z*res + x (source convention, preserved).
  const vertCount = res * res;
  const px = new Float32Array(vertCount);
  const py = new Float32Array(vertCount);
  const pz = new Float32Array(vertCount);
  const vColor: RGB[] = new Array(vertCount);

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const i = row * res + col;
      const height = map.heightData[i] ?? 0;
      // grid -> world: source PlaneGeometry spans [-W/2, W/2] across res-1 segments.
      const wx = (col / (res - 1)) * W - W / 2;
      const wz = (row / (res - 1)) * H - H / 2;
      px[i] = wx;
      py[i] = height;
      pz[i] = wz;

      const nx = col / (res - 1);
      const nz = row / (res - 1);
      const terrain = (map.terrainTypes[i] ?? TerrainType.Regolith) as TerrainType;
      let color: RGB;
      if (map.trenchGrid && map.trenchGrid[i] > 0) {
        // trench floor: uniform dark (glow overlay carries the real color in source)
        color = [0.06, 0.02, 0.01];
      } else {
        color = getTerrainColor(palette, terrain, height, nx, nz);
      }
      // border mask: multiply down to 10% brightness (source `multiplyScalar(0.10)`)
      if (map.borderGrid && map.borderGrid[i] > 0) {
        color = [color[0] * 0.1, color[1] * 0.1, color[2] * 0.1];
      }
      vColor[i] = [clamp01(color[0]), clamp01(color[1]), clamp01(color[2])];
    }
  }

  // ── 2. per-vertex normals from the heightfield (central differences) ──────────
  // dx along +col is W/(res-1); dz along +row is H/(res-1). Surface normal of a
  // heightfield z=f(x,y) is (-df/dx, 1, -df/dz) normalized. Border cells use the
  // one-sided neighbor (clamped index), matching computeVertexNormals' behavior
  // closely enough for shading.
  const nrmX = new Float32Array(vertCount);
  const nrmY = new Float32Array(vertCount);
  const nrmZ = new Float32Array(vertCount);
  const cellW = W / (res - 1);
  const cellH = H / (res - 1);
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const i = row * res + col;
      const xL = col > 0 ? col - 1 : col;
      const xR = col < res - 1 ? col + 1 : col;
      const zD = row > 0 ? row - 1 : row;
      const zU = row < res - 1 ? row + 1 : row;
      const hL = map.heightData[row * res + xL] ?? 0;
      const hR = map.heightData[row * res + xR] ?? 0;
      const hD = map.heightData[zD * res + col] ?? 0;
      const hU = map.heightData[zU * res + col] ?? 0;
      const dhdx = (hR - hL) / ((xR - xL) * cellW || cellW);
      const dhdz = (hU - hD) / ((zU - zD) * cellH || cellH);
      let nX = -dhdx;
      let nY = 1;
      let nZ = -dhdz;
      const len = Math.hypot(nX, nY, nZ) || 1;
      nrmX[i] = nX / len;
      nrmY[i] = nY / len;
      nrmZ[i] = nZ / len;
    }
  }

  // ── 3. group triangles by quantized color bucket → one MeshAsset per bucket ──
  // Two triangles per grid quad: (a,b,d) and (a,d,c), where
  //   a = (row,col)      b = (row,col+1)
  //   c = (row+1,col)    d = (row+1,col+1)
  // Winding matches a +Y-up surface (CCW seen from above).
  const QUANT = 12; // color buckets per channel → up to 12³ keys, but terrain uses few
  function bucketKey(c: RGB): number {
    const r = Math.min(QUANT - 1, Math.floor(c[0] * QUANT));
    const g = Math.min(QUANT - 1, Math.floor(c[1] * QUANT));
    const b = Math.min(QUANT - 1, Math.floor(c[2] * QUANT));
    return (r * QUANT + g) * QUANT + b;
  }

  interface Bucket {
    sum: RGB;
    count: number;
    // local-vertex remap: global vertex index -> local index within this bucket
    remap: Map<number, number>;
    verts: number[]; // global vertex indices, in local order
    indices: number[]; // local triangle indices
  }
  const buckets = new Map<number, Bucket>();

  function triColor(i0: number, i1: number, i2: number): RGB {
    const a = vColor[i0];
    const b = vColor[i1];
    const c = vColor[i2];
    return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  }

  function pushTri(i0: number, i1: number, i2: number): void {
    const col = triColor(i0, i1, i2);
    const key = bucketKey(col);
    let bk = buckets.get(key);
    if (!bk) {
      bk = { sum: [0, 0, 0], count: 0, remap: new Map(), verts: [], indices: [] };
      buckets.set(key, bk);
    }
    bk.sum[0] += col[0];
    bk.sum[1] += col[1];
    bk.sum[2] += col[2];
    bk.count++;
    for (const gi of [i0, i1, i2]) {
      let li = bk.remap.get(gi);
      if (li === undefined) {
        li = bk.verts.length;
        bk.remap.set(gi, li);
        bk.verts.push(gi);
      }
      bk.indices.push(li);
    }
  }

  for (let row = 0; row < res - 1; row++) {
    for (let col = 0; col < res - 1; col++) {
      const a = row * res + col;
      const b = row * res + (col + 1);
      const c = (row + 1) * res + col;
      const d = (row + 1) * res + (col + 1);
      pushTri(a, c, d);
      pushTri(a, d, b);
    }
  }

  // ── 4. emit one heightfield MeshAsset per bucket, spawn tinted ───────────────
  for (const bk of buckets.values()) {
    const n = bk.verts.length;
    const interleaved = new Float32Array(n * 8); // pos3 + normal3 + uv2
    for (let li = 0; li < n; li++) {
      const gi = bk.verts[li];
      const base = li * 8;
      interleaved[base + 0] = px[gi];
      interleaved[base + 1] = py[gi];
      interleaved[base + 2] = pz[gi];
      interleaved[base + 3] = nrmX[gi];
      interleaved[base + 4] = nrmY[gi];
      interleaved[base + 5] = nrmZ[gi];
      // UV = grid fraction
      const col = gi % res;
      const r = (gi - col) / res;
      interleaved[base + 6] = col / (res - 1);
      interleaved[base + 7] = r / (res - 1);
    }
    const indices =
      n > 65535 ? new Uint32Array(bk.indices) : new Uint16Array(bk.indices);
    const mesh = meshFromInterleaved(interleaved, indices) as MeshAsset;
    const handle: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', mesh);
    const tint: RGB = [bk.sum[0] / bk.count, bk.sum[1] / bk.count, bk.sum[2] / bk.count];
    world.spawn(
      { component: Transform, data: { posX: 0, posY: 0, posZ: 0 } },
      { component: MeshFilter, data: { assetHandle: handle } },
      {
        component: MeshRenderer,
        data: { materials: [litMaterial(tint, { roughness: 0.9, metallic: 0.05 })] },
      },
    );
  }

  // ── 5. cliff box walls from cliffEdges (ported from `_buildBoxWalls`) ─────────
  buildCliffWalls(world, baseGuid, litMaterial, map, palette);

  return {
    heightAt: (worldX: number, worldZ: number) => sampleHeight(map, worldX, worldZ),
  };
}

// Sample the high-side terrain texture color for a cliff wall segment
// (ported from Terrain.ts `_sampleWallColor`).
function sampleWallColor(
  map: MapConfig,
  palette: TerrainThemePalette,
  cx: number,
  cz: number,
  perpX: number,
  perpZ: number,
  targetLevel: number,
  res: number,
  cellW: number,
  cellH: number,
): RGB {
  const cliffLevels = map.cliffLevels as number[];
  for (const sign of [1, -1]) {
    const sx = cx + perpX * sign * 1.2;
    const sz = cz + perpZ * sign * 1.2;
    const col = Math.round((sx + map.width / 2) / cellW);
    const row = Math.round((sz + map.height / 2) / cellH);
    if (col < 0 || col >= res || row < 0 || row >= res) continue;
    const idx = row * res + col;
    if (cliffLevels[idx] === targetLevel) {
      const terrain = map.terrainTypes[idx] as TerrainType;
      const height = map.heightData[idx] ?? 0;
      const nx = col / (res - 1);
      const nz = row / (res - 1);
      return getTerrainColor(palette, terrain, height, nx, nz);
    }
  }
  return [0.32, 0.25, 0.2];
}

function buildCliffWalls(
  world: World,
  _baseGuid: AssetGuid,
  litMaterial: (rgb: RGB, opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>,
  map: MapConfig,
  palette: TerrainThemePalette,
): void {
  if (!map.cliffEdges || map.cliffEdges.length === 0) return;

  const CLIFF_VIS_H = 2.0;
  const WALL_THICKNESS = 1.4;
  const WALL_EXTEND_FACTOR = 1.2;
  const BOTTOM_SINK = 0.4;
  const TOP_INSET = 0.15;
  const res = map.gridResolution;
  const cellW = map.width / (res - 1);
  const cellH = map.height / (res - 1);

  // Reusable unit box mesh (1×1×1) — scaled per wall via Transform.scale.
  const boxRes = createBoxGeometry(1, 1, 1, 1, 1, 1);
  if (!boxRes.ok) return;
  const boxHandle: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', boxRes.value as MeshAsset);

  const borderGrid = map.borderGrid;

  for (const edge of map.cliffEdges) {
    const dx = edge.x2 - edge.x1;
    const dz = edge.z2 - edge.z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;

    const levelDiff = edge.highLevel - edge.lowLevel;
    const wallH = levelDiff * CLIFF_VIS_H;
    if (wallH < 0.1) continue;

    const cx = (edge.x1 + edge.x2) / 2;
    const cz = (edge.z1 + edge.z2) / 2;
    const baseY = edge.lowLevel * CLIFF_VIS_H - BOTTOM_SINK;
    const wallHExt = wallH + BOTTOM_SINK - TOP_INSET;
    const boxLen = len + WALL_THICKNESS * WALL_EXTEND_FACTOR;

    // rotate about Y by -atan2(dz, dx) so the box's local X lies along the edge.
    const rotY = -Math.atan2(dz, dx);
    const q = quat.create();
    quat.fromAxisAngle(q, [0, 1, 0], rotY);

    // wall color: sample high-side terrain, darken (side face gets less light).
    const perpX = -dz / len;
    const perpZ = dx / len;
    let wc = sampleWallColor(map, palette, cx, cz, perpX, perpZ, edge.highLevel, res, cellW, cellH);
    wc = [wc[0] * 0.8, wc[1] * 0.8, wc[2] * 0.8];

    // border mask (expand check to cover endpoints + perpendicular ±2 cells).
    if (borderGrid) {
      const checkPts: Array<{ x: number; z: number }> = [
        { x: cx, z: cz },
        { x: cx + perpX * cellW, z: cz + perpZ * cellH },
        { x: cx - perpX * cellW, z: cz - perpZ * cellH },
        { x: cx + perpX * cellW * 2, z: cz + perpZ * cellH * 2 },
        { x: cx - perpX * cellW * 2, z: cz - perpZ * cellH * 2 },
        { x: edge.x1, z: edge.z1 },
        { x: edge.x2, z: edge.z2 },
      ];
      for (const pt of checkPts) {
        const bc = Math.round((pt.x + map.width / 2) / cellW);
        const br = Math.round((pt.z + map.height / 2) / cellH);
        if (bc >= 0 && bc < res && br >= 0 && br < res && borderGrid[br * res + bc] > 0) {
          wc = [wc[0] * 0.125, wc[1] * 0.125, wc[2] * 0.125];
          break;
        }
      }
    }

    world.spawn(
      {
        component: Transform,
        data: {
          posX: cx,
          posY: baseY + wallHExt / 2,
          posZ: cz,
          quatX: q[0],
          quatY: q[1],
          quatZ: q[2],
          quatW: q[3],
          scaleX: boxLen,
          scaleY: wallHExt,
          scaleZ: WALL_THICKNESS,
        },
      },
      { component: MeshFilter, data: { assetHandle: boxHandle } },
      {
        component: MeshRenderer,
        data: { materials: [litMaterial([clamp01(wc[0]), clamp01(wc[1]), clamp01(wc[2])], { roughness: 0.92, metallic: 0.04 })] },
      },
    );
  }
}
