import { describe, expect, it } from 'bun:test';

import { canMove, cloneGame, createGame, directionFromSwipe, move, restart, type Game2048 } from '../game-2048';
import { BEST_SCORE_KEY, persistBestScore, readBestScore, type BestScoreStorage } from '../best-score';

const game = (grid: number[], score = 0): Game2048 => ({
  grid, score, moves: 0, over: false, won: false,
  acknowledgedWin: false, spawnedIndex: null, mergedIndices: [],
});
const noFour = () => 0;

describe('2048 rules', () => {
  it('maps swipe vectors through one thresholded direction owner', () => {
    expect(directionFromSwipe({ x: 100, y: 100 }, { x: 40, y: 108 })).toBe('left');
    expect(directionFromSwipe({ x: 100, y: 100 }, { x: 170, y: 94 })).toBe('right');
    expect(directionFromSwipe({ x: 100, y: 100 }, { x: 105, y: 40 })).toBe('up');
    expect(directionFromSwipe({ x: 100, y: 100 }, { x: 96, y: 180 })).toBe('down');
    expect(directionFromSwipe({ x: 100, y: 100 }, { x: 118, y: 112 })).toBeNull();
  });

  it('starts with exactly two tiles', () => {
    const created = createGame(noFour);
    expect(created.grid.filter(Boolean)).toHaveLength(2);
    expect(created.grid.slice(0, 2)).toEqual([2, 2]);
    expect(created.spawnedIndex).toBe(1);
  });

  it('uses the second random sample for the spawned tile value', () => {
    const samples = [0, 0.95, 0.99, 0.1];
    const created = createGame(() => samples.shift() ?? 0);
    expect(created.grid[0]).toBe(4);
    expect(created.grid[15]).toBe(2);
  });

  it('compresses and merges each pair only once', () => {
    const result = move(game([2, 2, 2, 2, ...Array(12).fill(0)]), 'left', noFour);
    expect(result.changed).toBe(true);
    expect(result.game.grid.slice(0, 4)).toEqual([4, 4, 2, 0]);
    expect(result.game.score).toBe(8);
  });

  it('does not spawn or mutate score after an illegal move', () => {
    const start = game([2, 4, 8, 16, ...Array(12).fill(0)], 42);
    const result = move(start, 'left', noFour);
    expect(result).toEqual({ changed: false, game: start });
  });

  it('supports vertical movement and detects the winning tile', () => {
    const result = move(game([1024, 0, 0, 0, 1024, ...Array(11).fill(0)]), 'up', noFour);
    expect(result.game.grid[0]).toBe(2048);
    expect(result.game.won).toBe(true);
  });

  it('maps right and down without changing merge order', () => {
    const right = move(game([2, 2, 4, 4, ...Array(12).fill(0)]), 'right', noFour).game;
    expect(right.grid.slice(0, 4)).toEqual([2, 0, 4, 8]);
    expect(right.mergedIndices).toEqual([3, 2]);

    const down = move(game([2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]), 'down', noFour).game;
    expect([down.grid[0], down.grid[4], down.grid[8], down.grid[12]]).toEqual([2, 0, 4, 8]);
  });

  it('preserves immutable undo snapshots and resets all run state', () => {
    const start = game([2, 2, ...Array(14).fill(0)], 16);
    const snapshot = cloneGame(start);
    const moved = move(start, 'left', noFour).game;
    expect(snapshot).not.toBe(start);
    expect(snapshot.grid).not.toBe(start.grid);
    expect(start.grid).toEqual([2, 2, ...Array(14).fill(0)]);
    expect(moved.moves).toBe(1);
    expect(restart(moved, noFour)).toMatchObject({ score: 0, moves: 0, won: false, over: false });
  });

  it('detects game over only when full and no adjacent pair remains', () => {
    expect(canMove([2,4,2,4,4,2,4,2,2,4,2,4,4,2,4,2])).toBe(false);
    expect(canMove([2,4,2,4,4,2,4,2,2,4,2,4,4,2,2,4])).toBe(true);
  });

  it('persists only valid non-negative best scores and degrades when storage is unavailable', () => {
    const values = new Map<string, string>();
    const storage: BestScoreStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
    expect(readBestScore(storage)).toBe(0);
    persistBestScore(storage, 4096);
    expect(values.get(BEST_SCORE_KEY)).toBe('4096');
    expect(readBestScore(storage)).toBe(4096);
    values.set(BEST_SCORE_KEY, '-4');
    expect(readBestScore(storage)).toBe(0);
    expect(readBestScore({ getItem: () => { throw new Error('denied'); }, setItem: () => {} })).toBe(0);
  });
});
