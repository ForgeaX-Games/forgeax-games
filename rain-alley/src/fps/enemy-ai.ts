/** Bounded navigation and enemy intent, independent from rendering/physics. */
export type Point = readonly [number, number];
export type Obstacle = {
  readonly center: readonly number[];
  readonly size: readonly number[];
};
const CELL = 0.6,
  MIN_X = -21,
  MIN_Z = -73,
  WIDTH = 98,
  DEPTH = 122;
export function createNavigation(proxies: readonly Obstacle[]) {
  const obstacles = proxies.filter(
    (p) =>
      p.center[1] + p.size[1] / 2 > 0.8 && p.center[1] - p.size[1] / 2 < 1.9,
  );
  const free = new Uint8Array(WIDTH * DEPTH);
  const point = (id: number): Point => [
    MIN_X + (id % WIDTH) * CELL,
    MIN_Z + Math.floor(id / WIDTH) * CELL,
  ];
  for (let id = 0; id < free.length; id++) {
    const [x, z] = point(id);
    const floor = proxies.some(
      (p) =>
        Math.abs(x - p.center[0]) <= p.size[0] / 2 &&
        Math.abs(z - p.center[2]) <= p.size[2] / 2 &&
        p.center[1] + p.size[1] / 2 >= -0.02 &&
        p.center[1] + p.size[1] / 2 <= 0.5,
    );
    free[id] = Number(
      floor &&
        !obstacles.some(
          (p) =>
            Math.abs(x - p.center[0]) < p.size[0] / 2 + 0.28 &&
            Math.abs(z - p.center[2]) < p.size[2] / 2 + 0.28,
        ),
    );
  }
  const near = ([x, z]: Point) => {
    const cx = Math.round((x - MIN_X) / CELL),
      cz = Math.round((z - MIN_Z) / CELL);
    for (let r = 0; r <= 4; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx,
            nz = cz + dz,
            id = nz * WIDTH + nx;
          if (nx >= 0 && nx < WIDTH && nz >= 0 && nz < DEPTH && free[id])
            return id;
        }
    return -1;
  };
  return {
    path(from: Point, to: Point): Point[] {
      const start = near(from),
        goal = near(to);
      if (start < 0 || goal < 0) return [];
      const queue = [start],
        parent = new Int32Array(free.length).fill(-1);
      parent[start] = start;
      // Breadth-first on a fixed .6m grid; no diagonal wall/door cutting.
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        if (id === goal) break;
        const x = id % WIDTH,
          z = Math.floor(id / WIDTH);
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx,
            nz = z + dz,
            next = nz * WIDTH + nx;
          if (
            nx < 0 ||
            nx >= WIDTH ||
            nz < 0 ||
            nz >= DEPTH ||
            !free[next] ||
            parent[next] !== -1
          )
            continue;
          parent[next] = id;
          queue.push(next);
        }
      }
      if (parent[goal] === -1) return [];
      const result: Point[] = [];
      for (let id = goal; id !== start; id = parent[id]) result.push(point(id));
      return result.reverse();
    },
  };
}
export type EnemyState = 'patrol' | 'chase' | 'windup' | 'recover' | 'dead';
export function damageAfterCover(
  visible: boolean,
  distance: number,
  melee: boolean,
) {
  return visible && distance <= (melee ? 1.8 : 23) ? (melee ? 17 : 6) : 0;
}
