import { CELL_SIZE, GRID_SIZE, SUB_VOXELS_PER_AXIS } from '../core/constants';

/** Axis-aligned voxel grid with 2×2×2 sub-cells per macro cell (8-bit mask). */
export class IceGrid {
  readonly size: number;
  readonly cell: number;
  readonly subDiv = SUB_VOXELS_PER_AXIS;
  private readonly cells: Uint8Array;

  constructor(size = GRID_SIZE, cell = CELL_SIZE, fill = true) {
    this.size = size;
    this.cell = cell;
    this.cells = new Uint8Array(size * size * size);
    if (fill) this.fillSolid();
  }

  get subSize(): number {
    return this.size * this.subDiv;
  }

  get subCell(): number {
    return this.cell / this.subDiv;
  }

  private idx(x: number, y: number, z: number): number {
    return x + y * this.size + z * this.size * this.size;
  }

  private subBit(sx: number, sy: number, sz: number): number {
    return 1 << (sx + sy * this.subDiv + sz * this.subDiv * this.subDiv);
  }

  private macroOfSub(gsx: number, gsy: number, gsz: number): [number, number, number, number, number, number] {
    const mx = (gsx / this.subDiv) | 0;
    const my = (gsy / this.subDiv) | 0;
    const mz = (gsz / this.subDiv) | 0;
    const sx = gsx - mx * this.subDiv;
    const sy = gsy - my * this.subDiv;
    const sz = gsz - mz * this.subDiv;
    return [mx, my, mz, sx, sy, sz];
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size && y < this.size && z < this.size;
  }

  inSubBounds(gsx: number, gsy: number, gsz: number): boolean {
    const ss = this.subSize;
    return gsx >= 0 && gsy >= 0 && gsz >= 0 && gsx < ss && gsy < ss && gsz < ss;
  }

  /** Macro cell has any sub-voxel filled. */
  isFilled(x: number, y: number, z: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    return this.cells[this.idx(x, y, z)] !== 0;
  }

  isSubFilled(gsx: number, gsy: number, gsz: number): boolean {
    if (!this.inSubBounds(gsx, gsy, gsz)) return false;
    const [mx, my, mz, sx, sy, sz] = this.macroOfSub(gsx, gsy, gsz);
    return (this.cells[this.idx(mx, my, mz)] & this.subBit(sx, sy, sz)) !== 0;
  }

  setFilled(x: number, y: number, z: number, v: boolean): void {
    if (!this.inBounds(x, y, z)) return;
    this.cells[this.idx(x, y, z)] = v ? 0xff : 0;
  }

  clearSub(gsx: number, gsy: number, gsz: number): boolean {
    if (!this.inSubBounds(gsx, gsy, gsz)) return false;
    const [mx, my, mz, sx, sy, sz] = this.macroOfSub(gsx, gsy, gsz);
    const i = this.idx(mx, my, mz);
    const bit = this.subBit(sx, sy, sz);
    if ((this.cells[i]! & bit) === 0) return false;
    this.cells[i]! &= ~bit;
    return true;
  }

  fillSolid(): void {
    this.cells.fill(0xff);
  }

  /** Local-space center of macro voxel (grid centered on origin). */
  voxelLocalCenter(x: number, y: number, z: number): [number, number, number] {
    const half = (this.size * this.cell) / 2;
    return [
      (x + 0.5) * this.cell - half,
      (y + 0.5) * this.cell - half,
      (z + 0.5) * this.cell - half,
    ];
  }

  /** Local-space center of sub-voxel. */
  subLocalCenter(gsx: number, gsy: number, gsz: number): [number, number, number] {
    const half = (this.size * this.cell) / 2;
    const sc = this.subCell;
    return [
      (gsx + 0.5) * sc - half,
      (gsy + 0.5) * sc - half,
      (gsz + 0.5) * sc - half,
    ];
  }
}

/** Remove sub-voxels whose world X is past the blade plane (finer than macro-cell cuts). */
export function cutByWorldPlane(
  grid: IceGrid,
  bladeWorldX: number,
  worldFromLocal: (lx: number, ly: number, lz: number) => [number, number, number],
): number {
  let removed = 0;
  const ss = grid.subSize;
  for (let z = 0; z < ss; z++) {
    for (let y = 0; y < ss; y++) {
      for (let x = 0; x < ss; x++) {
        if (!grid.isSubFilled(x, y, z)) continue;
        const [lx, ly, lz] = grid.subLocalCenter(x, y, z);
        const [wx] = worldFromLocal(lx, ly, lz);
        if (wx > bladeWorldX && grid.clearSub(x, y, z)) removed++;
      }
    }
  }
  return removed;
}

/** True if any filled sub-voxel has an empty 6-neighbor (surface exists). */
export function hasExposedSurface(grid: IceGrid): boolean {
  const ss = grid.subSize;
  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ] as const;
  for (let z = 0; z < ss; z++) {
    for (let y = 0; y < ss; y++) {
      for (let x = 0; x < ss; x++) {
        if (!grid.isSubFilled(x, y, z)) continue;
        for (const [dx, dy, dz] of dirs) {
          if (!grid.isSubFilled(x + dx, y + dy, z + dz)) return true;
        }
      }
    }
  }
  return false;
}
