import { meshFromInterleaved } from '@forgeax/engine-runtime';
import type { MeshAsset } from '@forgeax/engine-types';

import type { IceGrid } from './ice-grid';

const INPUT_FLOATS_PER_VERTEX = 8;

const FACES: ReadonlyArray<{ dx: number; dy: number; dz: number }> = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

type Pt = [number, number, number];

function intersectEdge(a: Pt, b: Pt, planeX: number): Pt | null {
  const ax = a[0], bx = b[0];
  const eps = 1e-7;
  if ((ax - planeX) * (bx - planeX) > eps) return null;
  if (Math.abs(bx - ax) < eps) return Math.abs(ax - planeX) < eps ? [planeX, a[1]!, a[2]!] : null;
  const t = (planeX - ax) / (bx - ax);
  if (t < -eps || t > 1 + eps) return null;
  return [planeX, a[1]! + t * (b[1]! - a[1]!), a[2]! + t * (b[2]! - a[2]!)];
}

function faceCornersLocal(
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

function appendLineQuad(
  verts: number[],
  indices: number[],
  a: Pt,
  b: Pt,
  halfW: number,
): void {
  const dy = b[1]! - a[1]!;
  const dz = b[2]! - a[2]!;
  const len = Math.hypot(dy, dz);
  if (len < 1e-6) return;
  const py = (-dz / len) * halfW;
  const pz = (dy / len) * halfW;
  const base = verts.length / INPUT_FLOATS_PER_VERTEX;
  for (const [x, y, z] of [
    [a[0]!, a[1]! + py, a[2]! + pz],
    [b[0]!, b[1]! + py, b[2]! + pz],
    [b[0]!, b[1]! - py, b[2]! - pz],
    [a[0]!, a[1]! - py, a[2]! - pz],
  ] as const) {
    verts.push(x, y, z, 1, 0, 0, 0, 0);
  }
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/**
 * Cut trace in workpiece local space — parented to ice transform.
 * Rebuild when position/rotation changes; empty mesh when blade plane misses the ice.
 */
export function buildCutContourLocalMesh(
  grid: IceGrid,
  bladeWorldX: number,
  toWorld: (lx: number, ly: number, lz: number) => Pt,
  toLocal: (wx: number, wy: number, wz: number) => Pt,
  lineWidth = 0.009,
): MeshAsset {
  const verts: number[] = [];
  const indices: number[] = [];
  const halfW = lineWidth * 0.5;
  const s = grid.subSize;

  for (let z = 0; z < s; z++) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!grid.isSubFilled(x, y, z)) continue;
        const [cx, cy, cz] = grid.subLocalCenter(x, y, z);
        for (const face of FACES) {
          if (grid.isSubFilled(x + face.dx, y + face.dy, z + face.dz)) continue;
          const localCorners = faceCornersLocal(grid, cx, cy, cz, face);
          const w = localCorners.map(([lx, ly, lz]) => toWorld(lx, ly, lz));
          const hits: Pt[] = [];
          for (let i = 0; i < 4; i++) {
            const p = intersectEdge(w[i]!, w[(i + 1) % 4]!, bladeWorldX);
            if (p) hits.push(p);
          }
          if (hits.length < 2) continue;
          const la = toLocal(hits[0]![0], hits[0]![1], hits[0]![2]);
          const lb = toLocal(hits[1]![0], hits[1]![1], hits[1]![2]);
          appendLineQuad(verts, indices, la, lb, halfW);
        }
      }
    }
  }

  if (verts.length === 0) {
    return meshFromInterleaved(new Float32Array(0), new Uint32Array(0));
  }
  return meshFromInterleaved(new Float32Array(verts), new Uint32Array(indices));
}
