import { describe, expect, test } from 'bun:test';
import { canMove, createGame, move, type Game2048 } from './game-2048';

function game(grid: number[]): Game2048 {
  return {
    grid,
    score: 0,
    moves: 0,
    over: false,
    won: false,
    spawnedIndex: null,
    mergedIndices: [],
  };
}

describe('2048 rules', () => {
  test('starts with two tiles', () => {
    const values = [0.05, 0.2, 0.55, 0.3];
    const created = createGame(() => values.shift() ?? 0);
    expect(created.grid.filter(Boolean)).toHaveLength(2);
  });

  test('merges each pair once and scores it', () => {
    const result = move(game([2, 2, 2, 2, ...Array(12).fill(0)]), 'left', () => 0.99);
    expect(result.changed).toBe(true);
    expect(result.game.grid.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(result.game.score).toBe(8);
  });

  test('detects a blocked board', () => {
    expect(canMove([
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ])).toBe(false);
  });
});
