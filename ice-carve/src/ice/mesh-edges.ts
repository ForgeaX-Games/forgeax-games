import { meshFromInterleaved } from '@forgeax/engine-runtime';
import type { MeshAsset } from '@forgeax/engine-types';

import type { IceGrid } from './ice-grid';

const INPUT_FLOATS_PER_VERTEX = 8;

type Pt = [number, number, number];

const FACES: ReadonlyArray<{ dx: number; dy: number; dz: number; nx: number; ny: number; nz: number }> = [
  { dx: 1, dy: 0, dz: 0, nx: 1, ny: 0, nz: 0 },
  { dx: -1, dy: 0, dz: 0, nx: -1, ny: 0, nz: 0 },
  { dx: 0, dy: 1, dz: 0, nx: 0, ny: 1, nz: 0 },
  { dx: 0, dy: -1, dz: 0, nx: 0, ny: -1, nz: 0 },
  { dx: 0, dy: 0, dz: 1, nx: 0, ny: 0, nz: 1 },
  { dx: 0, dy: 0, dz: -1, nx: 0, ny: 0, nz: -1 },
];

function faceCorners(
  grid: IceGrid,
  cx: number, cy: number, cz: number,
  face: { dx: number; dy: number; dz: number },
): Pt[] {
  const h = grid.subCell * 0.5;
  const ox = face.dx * h, oy = face.dy * h, oz = face.dz * h;
  if (face.dx !== 0) {
    const px = cx + ox;
    return [
      [px, cy - h, cz - h], [px, cy - h, cz + h],
      [px, cy + h, cz + h], [px, cy + h, cz - h],
    ];
  }
  if (face.dy !== 0) {
    const py = cy + oy;
    return [
      [cx - h, py, cz - h], [cx + h, py, cz - h],
      [cx + h, py, cz + h], [cx - h, py, cz + h],
    ];
  }
  const pz = cz + oz;
  return [
    [cx - h, cy - h, pz], [cx + h, cy - h, pz],
    [cx + h, cy + h, pz], [cx - h, cy + h, pz],
  ];
}

function edgeKey(a: Pt, b: Pt): string {
  const q = (n: number) => Math.round(n * 8000);
  const ka = `${q(a[0])},${q(a[1])},${q(a[2])}`;
  const kb = `${q(b[0])},${q(b[1])},${q(b[2])}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function uniqueNormalDirs(normals: Pt[]): Pt[] {
  const dirs: Pt[] = [];
  for (const n of normals) {
    let dup = false;
    for (const d of dirs) {
      const dot = n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!;
      if (Math.abs(dot) > 0.99) { dup = true; break; }
    }
    if (!dup) dirs.push(n);
  }
  return dirs;
}

function pickRibbonNormal(normals: Pt[]): Pt {
  const dirs = uniqueNormalDirs(normals);
  if (dirs.length === 1) return dirs[0]!;
  let sx = 0, sy = 0, sz = 0;
  for (const d of dirs) { sx += d[0]!; sy += d[1]!; sz += d[2]!; }
  const len = Math.hypot(sx, sy, sz);
  if (len < 1e-8) return dirs[0]!;
  return [sx / len, sy / len, sz / len];
}

function shouldDrawSilhouetteEdge(normals: Pt[]): boolean {
  if (normals.length <= 1) return true;
  return uniqueNormalDirs(normals).length > 1;
}

function pushEdgeQuad(
  verts: number[],
  indices: number[],
  a: Pt,
  b: Pt,
  nx: number, ny: number, nz: number,
  halfW: number,
): void {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-8) return;
  const px = (dy * nz - dz * ny) / len * halfW;
  const py = (dz * nx - dx * nz) / len * halfW;
  const pz = (dx * ny - dy * nx) / len * halfW;
  const base = verts.length / INPUT_FLOATS_PER_VERTEX;
  for (const [x, y, z] of [
    [a[0]! + px, a[1]! + py, a[2]! + pz],
    [b[0]! + px, b[1]! + py, b[2]! + pz],
    [b[0]! - px, b[1]! - py, b[2]! - pz],
    [a[0]! - px, a[1]! - py, a[2]! - pz],
  ] as const) {
    verts.push(x, y, z, nx, ny, nz, 0, 0);
  }
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function collectExposedFaceEdges(
  grid: IceGrid,
): Map<string, { a: Pt; b: Pt; normals: Pt[] }> {
  const edgeMap = new Map<string, { a: Pt; b: Pt; normals: Pt[] }>();
  const s = grid.subSize;

  for (let z = 0; z < s; z++) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!grid.isSubFilled(x, y, z)) continue;
        const [cx, cy, cz] = grid.subLocalCenter(x, y, z);
        for (const face of FACES) {
          if (grid.isSubFilled(x + face.dx, y + face.dy, z + face.dz)) continue;
          const corners = faceCorners(grid, cx, cy, cz, face);
          const n: Pt = [face.nx, face.ny, face.nz];
          for (let i = 0; i < 4; i++) {
            const a = corners[i]!;
            const b = corners[(i + 1) % 4]!;
            const k = edgeKey(a, b);
            let entry = edgeMap.get(k);
            if (!entry) {
              entry = { a, b, normals: [] };
              edgeMap.set(k, entry);
            }
            entry.normals.push(n);
          }
        }
      }
    }
  }
  return edgeMap;
}

function buildEdgeMeshFromMap(
  edgeMap: Map<string, { a: Pt; b: Pt; normals: Pt[] }>,
  halfW: number,
  filter: (normals: Pt[]) => boolean,
): MeshAsset {
  const verts: number[] = [];
  const indices: number[] = [];

  for (const { a, b, normals } of edgeMap.values()) {
    if (!filter(normals)) continue;
    const rn = pickRibbonNormal(normals);
    pushEdgeQuad(verts, indices, a, b, rn[0]!, rn[1]!, rn[2]!, halfW);
  }

  if (verts.length === 0) {
    return meshFromInterleaved(new Float32Array(0), new Uint32Array(0));
  }
  return meshFromInterleaved(new Float32Array(verts), new Uint32Array(indices));
}

/** Full voxel grid lines on every exposed face perimeter. */
export function buildIceEdgeMesh(grid: IceGrid): MeshAsset {
  const edgeMap = collectExposedFaceEdges(grid);
  const seen = new Set<string>();
  const verts: number[] = [];
  const indices: number[] = [];
  const halfW = grid.subCell * 0.035;

  for (const { a, b, normals } of edgeMap.values()) {
    const k = edgeKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    const n = normals[0]!;
    pushEdgeQuad(verts, indices, a, b, n[0]!, n[1]!, n[2]!, halfW);
  }

  if (verts.length === 0) {
    return meshFromInterleaved(new Float32Array(0), new Uint32Array(0));
  }
  return meshFromInterleaved(new Float32Array(verts), new Uint32Array(indices));
}

/** Outer silhouette + crease edges only — no internal voxel grid on flat faces. */
export function buildIceSilhouetteEdgeMesh(grid: IceGrid): MeshAsset {
  const edgeMap = collectExposedFaceEdges(grid);
  return buildEdgeMeshFromMap(edgeMap, grid.subCell * 0.055, shouldDrawSilhouetteEdge);
}
