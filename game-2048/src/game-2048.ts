export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Game2048 {
  readonly grid: readonly number[];
  readonly score: number;
  readonly moves: number;
  readonly over: boolean;
  readonly won: boolean;
  readonly acknowledgedWin: boolean;
  readonly spawnedIndex: number | null;
  readonly mergedIndices: readonly number[];
}

export interface MoveResult {
  readonly changed: boolean;
  readonly game: Game2048;
}

export type RandomSource = () => number;

export interface Point {
  readonly x: number;
  readonly y: number;
}

const SIZE = 4;
const CELL_COUNT = SIZE * SIZE;

export function directionFromSwipe(start: Point, end: Point, minimumDistance = 24): Direction | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < minimumDistance) return null;
  return Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down' : 'up');
}

export function cloneGame(game: Game2048): Game2048 {
  return { ...game, grid: [...game.grid], mergedIndices: [...game.mergedIndices] };
}

export function createGame(random: RandomSource = Math.random): Game2048 {
  return spawn(spawn({
    grid: Array<number>(CELL_COUNT).fill(0), score: 0, moves: 0,
    over: false, won: false, acknowledgedWin: false,
    spawnedIndex: null, mergedIndices: [],
  }, random), random);
}

export function restart(_game: Game2048, random: RandomSource = Math.random): Game2048 {
  return createGame(random);
}

export function move(game: Game2048, direction: Direction, random: RandomSource = Math.random): MoveResult {
  const next = Array<number>(CELL_COUNT).fill(0);
  const mergedIndices: number[] = [];
  let gained = 0;

  for (let outer = 0; outer < SIZE; outer++) {
    const source = Array.from({ length: SIZE }, (_, inner) => game.grid[indexFor(direction, outer, inner)] ?? 0);
    const collapsed = collapse(source);
    gained += collapsed.gained;
    for (let inner = 0; inner < SIZE; inner++) {
      const index = indexFor(direction, outer, inner);
      next[index] = collapsed.values[inner] ?? 0;
      if (collapsed.mergedAt.includes(inner)) mergedIndices.push(index);
    }
  }

  const changed = next.some((value, index) => value !== game.grid[index]);
  if (!changed) return { changed: false, game };
  const moved: Game2048 = {
    ...game,
    grid: next,
    score: game.score + gained,
    moves: game.moves + 1,
    won: game.won || next.some((value) => value >= 2048),
    spawnedIndex: null,
    mergedIndices,
  };
  const spawned = spawn(moved, random);
  return { changed: true, game: { ...spawned, over: !canMove(spawned.grid) } };
}

export function canMove(grid: readonly number[]): boolean {
  if (grid.some((value) => value === 0)) return true;
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const value = grid[row * SIZE + col];
      if (col + 1 < SIZE && value === grid[row * SIZE + col + 1]) return true;
      if (row + 1 < SIZE && value === grid[(row + 1) * SIZE + col]) return true;
    }
  }
  return false;
}

function spawn(game: Game2048, random: RandomSource): Game2048 {
  const empty = game.grid.flatMap((value, index) => value === 0 ? [index] : []);
  if (empty.length === 0) return { ...game, spawnedIndex: null };
  const pick = empty[Math.min(empty.length - 1, Math.floor(random() * empty.length))]!;
  const grid = [...game.grid];
  grid[pick] = random() < 0.9 ? 2 : 4;
  return { ...game, grid, spawnedIndex: pick };
}

function collapse(line: readonly number[]): { values: number[]; gained: number; mergedAt: number[] } {
  const values = line.filter((value) => value !== 0);
  const output: number[] = [];
  const mergedAt: number[] = [];
  let gained = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (value === values[index + 1]) {
      output.push(value * 2);
      gained += value * 2;
      mergedAt.push(output.length - 1);
      index++;
    } else {
      output.push(value);
    }
  }
  while (output.length < SIZE) output.push(0);
  return { values: output, gained, mergedAt };
}

function indexFor(direction: Direction, outer: number, inner: number): number {
  if (direction === 'left') return outer * SIZE + inner;
  if (direction === 'right') return outer * SIZE + (SIZE - 1 - inner);
  if (direction === 'up') return inner * SIZE + outer;
  return (SIZE - 1 - inner) * SIZE + outer;
}
