// mesh-collision.ts — per-node AABB collision for an imported GLB scene
// (UE-style "every static mesh = one collision box"). Built from the baked
// box list (tools/bake-colliders.mjs → assets/<name>.colliders.json).
//
// The FPS uses a kinematic character model: horizontal X/Z movement + a
// "feet Y" that follows the geometry under the character (step-up onto low
// ledges/stairs, blocked by taller boxes = walls). This gives "walk ON the
// mesh + collide with walls" without a full physics engine.

export type Box = readonly [
  nx: number, ny: number, nz: number, // min
  xx: number, xy: number, xz: number, // max
];

export interface MeshCollision {
  /** Highest walkable surface under (x,z) reachable from `fromFeet` by a
   *  step of at most STEP_UP. Returns that surface Y (feet rest height), or
   *  `fromFeet` if nothing is under the point. */
  floorAt(x: number, z: number, fromFeet: number): number;
  /** Slide a capsule (radius r, body from feet+STEP_UP up to feet+height)
   *  out of every box that is a WALL at that height band. Returns [x,z]. */
  slideXZ(nx: number, nz: number, r: number, feet: number, height: number): [number, number];
  readonly count: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** True if (x,z) has a floor near y≈0 and no wall within `r` at body height —
   *  i.e. a safe place to spawn a character. */
  isOpen(x: number, z: number, r: number): boolean;
}

const STEP_UP = 0.6;     // max ledge height the character auto-steps onto
const CELL = 3;          // spatial-grid cell size (world units)

export function buildMeshCollision(boxes: readonly Box[]): MeshCollision {
  // spatial grid over X/Z: cellKey → box indices whose XZ-AABB touches the cell
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    if (b[0] < minX) minX = b[0]; if (b[3] > maxX) maxX = b[3];
    if (b[2] < minZ) minZ = b[2]; if (b[5] > maxZ) maxZ = b[5];
  }
  const grid = new Map<number, number[]>();
  const gx = (x: number) => Math.floor((x - minX) / CELL);
  const gz = (z: number) => Math.floor((z - minZ) / CELL);
  const cols = Math.max(1, gx(maxX) + 1);
  const key = (cx: number, cz: number) => cz * cols + cx;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    for (let cx = gx(b[0]); cx <= gx(b[3]); cx++) {
      for (let cz = gz(b[2]); cz <= gz(b[5]); cz++) {
        const k = key(cx, cz);
        let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(i);
      }
    }
  }
  // gather candidate box indices near (x,z) within radius r
  const near = (x: number, z: number, r: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let cx = gx(x - r); cx <= gx(x + r); cx++) {
      for (let cz = gz(z - r); cz <= gz(z + r); cz++) {
        const arr = grid.get(key(cx, cz)); if (!arr) continue;
        for (const i of arr) if (!seen.has(i)) { seen.add(i); out.push(i); }
      }
    }
    return out;
  };

  return {
    count: boxes.length,
    bounds: { minX, maxX, minZ, maxZ },
    floorAt(x, z, fromFeet) {
      let best = -Infinity;
      for (const i of near(x, z, 0.01)) {
        const b = boxes[i];
        if (x < b[0] || x > b[3] || z < b[2] || z > b[5]) continue; // XZ contains point
        const top = b[4];
        if (top <= fromFeet + STEP_UP && top > best) best = top;
      }
      return best === -Infinity ? fromFeet : best;
    },
    slideXZ(nx, nz, r, feet, height) {
      const bodyLo = feet + STEP_UP;   // below this = walkable step, not a wall
      const bodyHi = feet + height;
      for (const i of near(nx, nz, r)) {
        const b = boxes[i];
        // only boxes that intersect the body's vertical band are walls
        if (b[4] <= bodyLo || b[1] >= bodyHi) continue;
        const minx = b[0] - r, maxx = b[3] + r, minz = b[2] - r, maxz = b[5] + r;
        if (nx > minx && nx < maxx && nz > minz && nz < maxz) {
          const pR = maxx - nx, pL = nx - minx, pT = maxz - nz, pB = nz - minz;
          const m = Math.min(pR, pL, pT, pB);
          if (m === pR) nx = maxx; else if (m === pL) nx = minx;
          else if (m === pT) nz = maxz; else nz = minz;
        }
      }
      return [nx, nz];
    },
    isOpen(x, z, r) {
      let hasFloor = false;
      for (const i of near(x, z, r)) {
        const b = boxes[i];
        // floor under the point near y≈0
        if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && b[4] > -1 && b[4] < 1) hasFloor = true;
        // wall within r at body band [0.3, 1.8] → not open
        if (b[4] > 0.3 && b[1] < 1.8) {
          if (x > b[0] - r && x < b[3] + r && z > b[2] - r && z < b[5] + r) return false;
        }
      }
      return hasFloor;
    },
  };
}
