import { meshFromInterleaved } from '@forgeax/engine-runtime';
import type { MeshAsset } from '@forgeax/engine-types';

import type { IceGrid } from './ice-grid';

/** meshFromInterleaved input stride: pos(3) + normal(3) + uv(2). */
const INPUT_FLOATS_PER_VERTEX = 8;

const FACES: ReadonlyArray<{ dx: number; dy: number; dz: number; nx: number; ny: number; nz: number }> = [
  { dx: 1, dy: 0, dz: 0, nx: 1, ny: 0, nz: 0 },
  { dx: -1, dy: 0, dz: 0, nx: -1, ny: 0, nz: 0 },
  { dx: 0, dy: 1, dz: 0, nx: 0, ny: 1, nz: 0 },
  { dx: 0, dy: -1, dz: 0, nx: 0, ny: -1, nz: 0 },
  { dx: 0, dy: 0, dz: 1, nx: 0, ny: 0, nz: 1 },
  { dx: 0, dy: 0, dz: -1, nx: 0, ny: 0, nz: -1 },
];

/** One quad per exposed sub-voxel face. */
export function buildIceMesh(grid: IceGrid): MeshAsset {
  const verts: number[] = [];
  const indices: number[] = [];
  const half = grid.subCell * 0.5;
  const s = grid.subSize;

  const pushQuad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
  ) => {
    const base = verts.length / INPUT_FLOATS_PER_VERTEX;
    for (const [px, py, pz] of [
      [ax, ay, az], [bx, by, bz], [cx, cy, cz], [dx, dy, dz],
    ] as const) {
      verts.push(px, py, pz, nx, ny, nz, 0, 0);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  for (let z = 0; z < s; z++) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!grid.isSubFilled(x, y, z)) continue;
        const [cx, cy, cz] = grid.subLocalCenter(x, y, z);
        for (const face of FACES) {
          if (grid.isSubFilled(x + face.dx, y + face.dy, z + face.dz)) continue;
          const nx = face.nx, ny = face.ny, nz = face.nz;
          const ox = nx * half, oy = ny * half, oz = nz * half;
          if (nx !== 0) {
            const px = cx + ox;
            pushQuad(
              px, cy - half, cz - half,
              px, cy - half, cz + half,
              px, cy + half, cz + half,
              px, cy + half, cz - half,
              nx, ny, nz,
            );
          } else if (ny !== 0) {
            const py = cy + oy;
            pushQuad(
              cx - half, py, cz - half,
              cx + half, py, cz - half,
              cx + half, py, cz + half,
              cx - half, py, cz + half,
              nx, ny, nz,
            );
          } else {
            const pz = cz + oz;
            pushQuad(
              cx - half, cy - half, pz,
              cx + half, cy - half, pz,
              cx + half, cy + half, pz,
              cx - half, cy + half, pz,
              nx, ny, nz,
            );
          }
        }
      }
    }
  }

  if (verts.length === 0) {
    return meshFromInterleaved(new Float32Array(0), new Uint32Array(0));
  }
  return meshFromInterleaved(new Float32Array(verts), new Uint32Array(indices));
}
